package ai.amberx.axf.ai

import ai.amberx.axf.kernel.ai.AiModePolicy
import ai.amberx.axf.kernel.ai.AiSessionRequest
import ai.amberx.axf.kernel.assistant.ChatContext
import ai.amberx.axf.kernel.assistant.Sse
import ai.amberx.axf.kernel.assistant.SseFrame
import ai.amberx.axf.kernel.live.LiveEvent
import ai.amberx.axf.kernel.live.LiveReplay
import ai.amberx.axf.kernel.live.LiveSessionInfo
import ai.amberx.axf.kernel.live.LiveState
import ai.amberx.axf.kernel.result.AxfFailure
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.longOrNull

/*
 * The wire between lib-ai and the assistant behind axHub (pure: no I/O, unit-tested).
 *
 * Every AI session runs on the hub side, never in the app: the assistant host is the console's AI assistant
 * (apps/console-web/plugins/ai-assistant, live-session@1 host) reached THROUGH axHub's sign-in wall — Traefik asks
 * axHub (/auth/verify) before every request, so the hub account decides who may chat (non-admins get plain chat, more
 * per user from the hub's users page = UAC). Routes used (prefix [AiWire.DEFAULT_PREFIX]):
 *
 *   GET  /me                                    who is chatting + what the hub account allows
 *   POST /conversations                         {title, settings:{model?}} → {conversation:{id,…}}
 *   POST /conversations/{id}/messages           {content, context, mode, …} → SSE (the turn runs detached; we only read the status)
 *   GET  /sessions                              {items:[LiveSessionInfo…]}
 *   GET  /sessions/{id}                         {session: LiveSessionInfo|null}
 *   GET  /sessions/{id}/events?since&follow=1   SSE: `replay` header, then `id:/event:/data:` per event, ends when idle
 *   GET  /sessions/{id}/events?since&follow=0   one JSON page {events,next,gap,reset,more,state}
 *   POST /sessions/{id}/stop                    stops the running turn (the session stays open)
 *   POST /sessions/{id}/close                   the only way a session ends
 */
public object AiWire {
    public const val DEFAULT_PREFIX: String = "/api/plugins/ai-assistant"
    /** Where the assistant lives today: the Dev Console, behind axHub's wall. */
    public const val DEFAULT_ASSISTANT: String = "https://console.amberxai.com"
    /** JSON replies larger than this are refused. */
    public const val MAX_JSON_BYTES: Int = 2 * 1024 * 1024
    public const val SESSION_ID_MAX: Int = 128
    private val ID = Regex("^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")

    internal val json: Json = Json { ignoreUnknownKeys = true; isLenient = false }

    public fun isSessionId(id: String?): Boolean = id != null && ID.matches(id)

    // ------------------------------------------------------------ paths

    public fun me(prefix: String = DEFAULT_PREFIX): String = "$prefix/me"
    public fun conversations(prefix: String = DEFAULT_PREFIX): String = "$prefix/conversations"
    public fun messages(id: String, prefix: String = DEFAULT_PREFIX): String = "$prefix/conversations/$id/messages"
    public fun sessions(prefix: String = DEFAULT_PREFIX, includeClosed: Boolean = false): String = "$prefix/sessions" + if (includeClosed) "?closed=true" else ""
    public fun session(id: String, prefix: String = DEFAULT_PREFIX): String = "$prefix/sessions/$id"
    public fun events(id: String, after: Long, follow: Boolean, max: Int = 500, prefix: String = DEFAULT_PREFIX): String =
        "$prefix/sessions/$id/events?since=${maxOf(0, after)}&follow=${if (follow) 1 else 0}" + if (follow) "" else "&limit=${max.coerceIn(1, 2000)}"
    public fun stop(id: String, prefix: String = DEFAULT_PREFIX): String = "$prefix/sessions/$id/stop"
    public fun close(id: String, prefix: String = DEFAULT_PREFIX): String = "$prefix/sessions/$id/close"

    // ------------------------------------------------------------ bodies

    /** Body of POST /conversations: the title and (when chosen) the model; the hub clamps what a user may set. */
    public fun conversationBody(request: AiSessionRequest): String = JsonObject(buildMap {
        put("title", JsonPrimitive(request.title))
        if (request.model.isNotEmpty()) put("settings", JsonObject(mapOf("model" to JsonPrimitive(request.model))))
    }).toString()

    /**
     * Body of a turn. `content` + `context` are what the assistant reads; the mode travels both as top-level fields
     * (`mode`, `sessionKind`, `readOnly`, `needsApproval`, `triggerId`) and in `context.extra.aiMode` so a host that
     * keeps only the context still knows which mode opened the turn.
     */
    public fun turnBody(prompt: String, context: ChatContext?, request: AiSessionRequest? = null): String = JsonObject(buildMap {
        put("content", JsonPrimitive(prompt))
        val extra = LinkedHashMap<String, JsonElement>()
        context?.extra?.let { extra.putAll(it) }
        if (request != null) {
            extra["aiMode"] = JsonPrimitive(request.mode)
            request.triggerId?.let { extra["triggerId"] = JsonPrimitive(it) }
        }
        val ctx = (context ?: ChatContext()).copy(extra = if (extra.isEmpty()) null else JsonObject(extra))
        put("context", ctx.toJson())
        if (request != null) {
            put("mode", JsonPrimitive(request.mode)); put("sessionKind", JsonPrimitive(request.sessionKind))
            put("readOnly", JsonPrimitive(request.readOnly)); put("needsApproval", JsonPrimitive(request.needsApproval))
            if (request.model.isNotEmpty()) put("model", JsonPrimitive(request.model))
            request.triggerId?.let { put("triggerId", JsonPrimitive(it)) }
        }
    }).toString()

    // ------------------------------------------------------------ parsing

    public fun parseObject(text: String): JsonObject? = runCatching { json.parseToJsonElement(text) as? JsonObject }.getOrNull()

    private fun JsonObject.s(k: String): String? = (this[k] as? JsonPrimitive)?.takeIf { it.isString }?.content
    private fun JsonObject.l(k: String): Long? = (this[k] as? JsonPrimitive)?.takeUnless { it.isString }?.longOrNull
    private fun JsonObject.b(k: String): Boolean? = (this[k] as? JsonPrimitive)?.takeUnless { it.isString }?.booleanOrNull

    /** A live-session@1 info object; null when it isn't one. `host` is always reported as [hostId] (the hub runs it). */
    public fun sessionInfo(e: JsonElement?, hostId: String): LiveSessionInfo? {
        val o = e as? JsonObject ?: return null
        val id = o.s("id")?.takeIf { isSessionId(it) } ?: return null
        val meta = (o["meta"] as? JsonObject)?.mapNotNull { (k, v) -> (v as? JsonPrimitive)?.let { k to it.content } }?.toMap() ?: emptyMap()
        val via = o.s("host")
        return LiveSessionInfo(
            id = id, kind = o.s("kind") ?: "assistant.chat", title = o.s("title"), state = LiveState.parse(o.s("state") ?: "idle"), host = hostId,
            createdAt = o.l("createdAt") ?: 0, updatedAt = o.l("updatedAt") ?: 0, lastSeq = o.l("lastSeq") ?: 0, viewers = (o.l("viewers") ?: 0).toInt(),
            meta = if (via != null && via != hostId) meta + ("via" to via) else meta,
        )
    }

    public fun sessionList(o: JsonObject, hostId: String): List<LiveSessionInfo> = (o["items"] as? JsonArray)?.mapNotNull { sessionInfo(it, hostId) } ?: emptyList()

    public fun event(e: JsonElement?): LiveEvent? {
        val o = e as? JsonObject ?: return null
        val seq = o.l("seq")?.takeIf { it > 0 } ?: return null
        val kind = o.s("kind")?.takeIf { it.isNotEmpty() } ?: return null
        return LiveEvent(seq, o.l("at") ?: 0, kind, o["data"]?.takeUnless { it is JsonNull })
    }

    /** The follow=0 page. */
    public fun replayPage(o: JsonObject): LiveReplay = LiveReplay(
        events = (o["events"] as? JsonArray)?.mapNotNull { event(it) } ?: emptyList(),
        next = o.l("next") ?: 0, gap = o.b("gap") ?: false, reset = o.b("reset") ?: false, more = o.b("more") ?: false,
    )

    /** The `replay` header of a follow=1 stream (events follow as their own frames). */
    public fun replayHeader(o: JsonObject): Pair<LiveReplay, LiveState?> =
        LiveReplay(emptyList(), o.l("next") ?: 0, o.b("gap") ?: false, o.b("reset") ?: false, o.b("more") ?: false) to o.s("state")?.let { LiveState.parse(it) }

    /** The id of a newly created conversation (= its live session id). */
    public fun conversationId(o: JsonObject): String? = ((o["conversation"] as? JsonObject)?.s("id") ?: o.s("id"))?.takeIf { isSessionId(it) }

    /** A stream frame as a live event (`id:` = seq). SSE has no time: `at` is 0 for streamed events. */
    public fun frameEvent(f: SseFrame): LiveEvent? {
        val seq = f.id ?: return null
        val data = runCatching { json.parseToJsonElement(f.data) }.getOrElse { JsonPrimitive(f.data) }
        return LiveEvent(seq, 0, f.event, data.takeUnless { it is JsonNull })
    }

    /** What the hub says about the signed-in account (`GET /me`). */
    public fun account(o: JsonObject): AiHubAccount {
        val admin = o.b("admin") ?: false
        val can = (o["can"] as? JsonObject)?.filter { (_, v) -> (v as? JsonPrimitive)?.booleanOrNull == true }?.keys?.toList() ?: emptyList()
        val perms = ((o["perms"] as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.takeIf { p -> p.isString }?.content } ?: emptyList())
        val modes = (o["aiModes"] as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.takeIf { p -> p.isString }?.content }
        val user = (o["user"] as? JsonObject)?.let { it.s("name") ?: it.s("id") } ?: o.s("user") ?: ""
        return AiHubAccount(user, admin, (can + perms).distinct(), modes)
    }

    // ------------------------------------------------------------ errors

    /** FastAPI's `{"detail": "…"}` (or `{"error": …}`) as a short message. */
    public fun detail(body: String): String? {
        val o = parseObject(body) ?: return null
        return ((o["detail"] ?: o["error"] ?: o["message"]) as? JsonPrimitive)?.content?.take(300)
    }

    /** HTTP status → typed failure. 3xx counts as signed out: the wall redirects to the hub's sign-in page, and a credential never follows a redirect. */
    public fun failure(code: Int, body: String, what: String = "session", id: String = ""): AxfFailure {
        val d = detail(body)
        return when {
            code in 300..399 || code == 401 -> AxfFailure.Denied(SIGN_IN, d ?: "Sign in to axHub first.")
            code == 403 -> AxfFailure.Denied("assistant", d ?: "Your hub account can't do that (an admin can allow it on the hub's users page).")
            code == 404 -> AxfFailure.NotFound(what, id, d ?: "No $what \"$id\" on the hub (or the AI assistant is turned off there).")
            code == 409 -> AxfFailure.Invalid(d ?: "A reply is already running in this session.", "busy")
            code == 400 || code == 422 -> AxfFailure.Invalid(d ?: "The hub refused the request ($code).")
            code == 429 || code >= 500 -> AxfFailure.Unavailable(d ?: "The hub answered $code.", if (code == 429) 10_000 else null)
            else -> AxfFailure.Unexpected(d ?: "The hub answered $code.")
        }
    }

    /** Permission id reported in a [AxfFailure.Denied] that means "not signed in to the hub". */
    public const val SIGN_IN: String = "axhub.signin"

    /** A stream failure that won't heal by retrying (sign in, rights, a session that is gone). */
    public fun isFinal(f: AxfFailure): Boolean = f is AxfFailure.Denied || f is AxfFailure.NotFound || f is AxfFailure.Invalid

    /** Accumulates SSE lines into frames (keep-alive comments and data-less blocks are dropped). */
    public class SseLines {
        private val block = StringBuilder()
        /** Feed one line (without its newline); returns a frame when a block ends. */
        public fun feed(line: String): SseFrame? {
            if (line.isEmpty()) {
                if (block.isEmpty()) return null
                val f = Sse.parseBlock(block.toString())
                block.setLength(0)
                return f
            }
            if (block.isNotEmpty()) block.append('\n')
            block.append(line.removeSuffix("\r"))
            return null
        }
        /** The unfinished block when a stream ends without its blank line. */
        public fun flush(): SseFrame? = if (block.isEmpty()) null else Sse.parseBlock(block.toString()).also { block.setLength(0) }
    }
}

/** The signed-in hub account as the assistant sees it (`GET /me`). */
public data class AiHubAccount(val user: String, val admin: Boolean, val perms: List<String>, val allowedModes: List<String>? = null) {
    /** The hub's answer as an ai-modes@1 policy (the hub is what enforces it). */
    public fun policy(): AiModePolicy = AiModePolicy(admin, perms, allowedModes)
}
