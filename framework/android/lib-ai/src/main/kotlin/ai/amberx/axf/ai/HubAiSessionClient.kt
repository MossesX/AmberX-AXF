package ai.amberx.axf.ai

import ai.amberx.axf.kernel.ai.AI_SESSION_HOST
import ai.amberx.axf.kernel.ai.AiSessionClient
import ai.amberx.axf.kernel.ai.AiSessionRequest
import ai.amberx.axf.kernel.assistant.AssistantRules
import ai.amberx.axf.kernel.assistant.ChatContext
import ai.amberx.axf.kernel.live.LiveDetach
import ai.amberx.axf.kernel.live.LiveEvent
import ai.amberx.axf.kernel.live.LiveKinds
import ai.amberx.axf.kernel.live.LiveReplay
import ai.amberx.axf.kernel.live.LiveSessionInfo
import ai.amberx.axf.kernel.live.LiveState
import ai.amberx.axf.kernel.result.AxfFailure
import ai.amberx.axf.kernel.result.AxfResult
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.channelFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/** What a follower of a live session sees, in order. */
public sealed interface AiStreamItem {
    /** The hub's replay header: on `gap` or `reset` reload the full conversation, then follow on. */
    public data class Replay(val replay: LiveReplay, val state: LiveState?) : AiStreamItem
    public data class Event(val event: LiveEvent) : AiStreamItem
    /** Caught up and nothing is running; the follower polls again in [nextMs] (the session stays live on the hub). */
    public data class Idle(val lastSeq: Long, val nextMs: Long) : AiStreamItem
    /** The connection dropped; it reopens from the last seen seq in [delayMs]. */
    public data class Reconnecting(val attempt: Int, val delayMs: Long, val reason: String) : AiStreamItem
    /** A failure that retrying won't fix (signed out, no rights, session gone); the flow ends after it. */
    public data class Failed(val failure: AxfFailure) : AiStreamItem
    /** The session was closed on purpose; the flow ends after it. */
    public data class Ended(val lastSeq: Long) : AiStreamItem
}

/** Follow timing. Idle polling backs off from [idleMinMs] to [idleMaxMs]; failures back off to [retryMaxMs]. */
public data class AiLiveOptions(val idleMinMs: Long = 2_000, val idleMaxMs: Long = 15_000, val retryMaxMs: Long = 30_000, val maxRetries: Int = Int.MAX_VALUE)

/**
 * ai-modes@1 [AiSessionClient] on axHub: every session lives on the hub side (the assistant behind axHub's wall) and
 * never ends because this app, screen or phone went away — only [close] ends one. [attach]/[events] follow a session
 * across dropped connections: each reconnect resumes from the last seq seen (`since=`), the hub replays what was
 * missed, `gap`/`reset` tell the viewer to reload. Replaces the kernel's `axf.ai.session` placeholder when lib-ai is
 * installed (AiModule).
 */
public class HubAiSessionClient(
    private val transport: AiHubTransport,
    private val prefix: String = AiWire.DEFAULT_PREFIX,
    private val options: AiLiveOptions = AiLiveOptions(),
    private val scope: CoroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.Default),
) : AiSessionClient {
    override val host: String = AI_SESSION_HOST

    private suspend fun json(method: String, path: String, body: String? = null, what: String = "session", id: String = ""): AxfResult<kotlinx.serialization.json.JsonObject> {
        val res = try { transport.call(AiHubRequest(method, path, body)) } catch (e: CancellationException) { throw e } catch (e: Exception) { return AxfResult.err(unreachable(e)) }
        if (res.code !in 200..299) return AxfResult.err(AiWire.failure(res.code, res.body, what, id))
        val o = AiWire.parseObject(res.body.ifBlank { "{}" }) ?: return AxfResult.err(AxfFailure.Unexpected("The hub sent something unexpected."))
        return AxfResult.ok(o)
    }

    private fun unreachable(e: Exception): AxfFailure = AxfFailure.Unavailable("Can't reach the assistant at ${transport.origin}: ${e.message?.take(120) ?: "network error"}", cause = e)

    private fun badId(id: String): AxfResult.Err = AxfResult.Err(AxfFailure.Invalid("not a session id: ${id.take(40)}", "id"))

    /** Who is signed in and what the hub allows them (non-admins: plain chat unless the hub's users page says more). */
    public suspend fun account(): AxfResult<AiHubAccount> = json("GET", AiWire.me(prefix)).map(AiWire::account)

    override suspend fun available(): Boolean = account().isOk

    override suspend fun start(request: AiSessionRequest): AxfResult<LiveSessionInfo> {
        val created = json("POST", AiWire.conversations(prefix), AiWire.conversationBody(request), "conversation")
        val id = when (created) { is AxfResult.Err -> return created; is AxfResult.Ok -> AiWire.conversationId(created.value) }
            ?: return AxfResult.err(AxfFailure.Unexpected("The hub didn't return a session id."))
        when (val sent = turn(id, request.prompt, request.context, request)) { is AxfResult.Err -> return sent; is AxfResult.Ok -> {} }
        val now = System.currentTimeMillis()
        val fallback = LiveSessionInfo(id, request.sessionKind, request.title, if (request.needsApproval) LiveState.WAITING else LiveState.RUNNING, host, now, now, 0,
            meta = mapOf("mode" to request.mode))
        return when (val i = info(id)) {
            is AxfResult.Ok -> AxfResult.ok(i.value.copy(kind = request.sessionKind, meta = i.value.meta + ("mode" to request.mode)))
            is AxfResult.Err -> AxfResult.ok(fallback)
        }
    }

    private suspend fun turn(id: String, prompt: String, context: ChatContext?, request: AiSessionRequest?): AxfResult<Unit> {
        if (!AiWire.isSessionId(id)) return badId(id)
        if (prompt.isBlank()) return AxfResult.err(AxfFailure.Invalid("Say something first.", "prompt"))
        val res = try { transport.call(AiHubRequest("POST", AiWire.messages(id, prefix), AiWire.turnBody(prompt, context, request), "text/event-stream"), headersOnly = true) }
        catch (e: CancellationException) { throw e } catch (e: Exception) { return AxfResult.err(unreachable(e)) }
        return if (res.code in 200..299) AxfResult.ok(Unit) else AxfResult.err(AiWire.failure(res.code, res.body, "session", id))
    }

    override suspend fun send(id: String, prompt: String, context: ChatContext?): AxfResult<Unit> = turn(id, prompt, context, null)

    /** A turn that carries its mode (AiService uses this so the hub sees which mode each turn runs in). */
    public suspend fun send(id: String, request: AiSessionRequest): AxfResult<Unit> = turn(id, request.prompt, request.context, request)

    public suspend fun info(id: String): AxfResult<LiveSessionInfo> {
        if (!AiWire.isSessionId(id)) return badId(id)
        return json("GET", AiWire.session(id, prefix), id = id).flatMap { o ->
            AiWire.sessionInfo(o["session"], host)?.let { AxfResult.ok(it) } ?: AxfResult.err(AxfFailure.NotFound("session", id))
        }
    }

    override suspend fun stream(id: String, after: Long, max: Int): AxfResult<LiveReplay> {
        if (!AiWire.isSessionId(id)) return badId(id)
        return json("GET", AiWire.events(id, after, false, max, prefix), id = id).map(AiWire::replayPage)
    }

    override suspend fun stop(id: String): AxfResult<Unit> {
        if (!AiWire.isSessionId(id)) return badId(id)
        return json("POST", AiWire.stop(id, prefix), id = id).map { }
    }

    override suspend fun close(id: String): AxfResult<Unit> {
        if (!AiWire.isSessionId(id)) return badId(id)
        return json("POST", AiWire.close(id, prefix), id = id).flatMap { o ->
            if ((o["closed"] as? kotlinx.serialization.json.JsonPrimitive)?.content == "false") AxfResult.err(AxfFailure.NotFound("session", id)) else AxfResult.ok(Unit)
        }
    }

    override suspend fun list(): AxfResult<List<LiveSessionInfo>> = json("GET", AiWire.sessions(prefix)).map { AiWire.sessionList(it, host) }

    override suspend fun attach(id: String, after: Long, onEvent: (LiveEvent) -> Unit, onReplay: (LiveReplay) -> Unit): AxfResult<LiveDetach> {
        if (!AiWire.isSessionId(id)) return badId(id)
        val job = scope.launch {
            events(id, after).collect { item ->
                when (item) {
                    is AiStreamItem.Event -> onEvent(item.event)
                    is AiStreamItem.Replay -> onReplay(item.replay)
                    else -> {}
                }
            }
        }
        return AxfResult.ok(LiveDetach { job.cancel() })
    }

    /**
     * Follows a session for as long as it is collected: replay after [after], then live events; when the hub ends the
     * stream (caught up, idle) it polls again with backoff; when the connection drops it reconnects from the last seq.
     * Ends only on [AiStreamItem.Ended] (closed on purpose) or [AiStreamItem.Failed] (sign-in / rights / gone).
     * Cancelling the collector only detaches — the session keeps running on the hub.
     */
    public fun events(id: String, after: Long = 0): Flow<AiStreamItem> = channelFlow {
        if (!AiWire.isSessionId(id)) { send(AiStreamItem.Failed(AxfFailure.Invalid("not a session id", "id"))); return@channelFlow }
        var last = maxOf(0, after)
        var failures = 0
        var idleMs = options.idleMinMs
        while (isActive) {
            val lines = AiWire.SseLines()
            var closed = false
            var gone = false
            var fresh = false
            var replayState: LiveState? = null
            suspend fun frame(f: kotlinx.serialization.json.JsonObject?, event: String, seqFrame: ai.amberx.axf.kernel.assistant.SseFrame) {
                when (event) {
                    "replay" -> {
                        val (r, st) = AiWire.replayHeader(f ?: kotlinx.serialization.json.JsonObject(emptyMap()))
                        if (r.reset) last = 0
                        replayState = st
                        if (st == LiveState.CLOSED) closed = true
                        send(AiStreamItem.Replay(r, st))
                    }
                    "session" -> if ((f?.get("state") as? kotlinx.serialization.json.JsonPrimitive)?.content == "none") gone = true
                    else -> {
                        val ev = AiWire.frameEvent(seqFrame) ?: return
                        if (ev.seq <= last) return // already seen (a reconnect overlapping)
                        last = ev.seq
                        fresh = true
                        if (ev.kind == LiveKinds.CLOSE) closed = true
                        send(AiStreamItem.Event(ev))
                    }
                }
            }
            val res: AiHubResponse? = try {
                transport.stream(AiHubRequest("GET", AiWire.events(id, last, true, prefix = prefix), accept = "text/event-stream")) { line ->
                    lines.feed(line)?.let { fr -> frame(AiWire.parseObject(fr.data), fr.event, fr) }
                }.also { lines.flush()?.let { fr -> frame(AiWire.parseObject(fr.data), fr.event, fr) } }
            } catch (e: CancellationException) { throw e } catch (e: Exception) {
                failures += 1
                if (failures > options.maxRetries) { send(AiStreamItem.Failed(unreachable(e))); return@channelFlow }
                val wait = AssistantRules.reconnectDelayMs(failures, options.retryMaxMs)
                send(AiStreamItem.Reconnecting(failures, wait, e.message?.take(120) ?: "connection lost"))
                delay(wait)
                null
            }
            if (res == null) continue
            if (res.code !in 200..299) {
                val f = AiWire.failure(res.code, res.body, "session", id)
                if (AiWire.isFinal(f)) { send(AiStreamItem.Failed(f)); return@channelFlow }
                failures += 1
                if (failures > options.maxRetries) { send(AiStreamItem.Failed(f)); return@channelFlow }
                val wait = (f as? AxfFailure.Unavailable)?.retryAfterMs ?: AssistantRules.reconnectDelayMs(failures, options.retryMaxMs)
                send(AiStreamItem.Reconnecting(failures, wait, f.message))
                delay(wait)
                continue
            }
            failures = 0
            if (closed) { send(AiStreamItem.Ended(last)); return@channelFlow }
            // `none`: nothing on the hub under this id. Before any event it may not have started yet (keep polling);
            // after events it was closed and forgotten.
            if (gone && last > 0) { send(AiStreamItem.Ended(last)); return@channelFlow }
            idleMs = if (fresh || replayState == LiveState.RUNNING || replayState == LiveState.WAITING) options.idleMinMs else minOf(options.idleMaxMs, idleMs * 2)
            send(AiStreamItem.Idle(last, idleMs))
            delay(idleMs)
        }
    }
}
