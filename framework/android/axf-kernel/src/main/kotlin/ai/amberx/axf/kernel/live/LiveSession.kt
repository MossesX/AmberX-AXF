package ai.amberx.axf.kernel.live

import ai.amberx.axf.kernel.result.AxfFailure
import ai.amberx.axf.kernel.result.AxfResult
import kotlinx.serialization.json.JsonElement

/*
 * Live sessions — live-session@1 (kernel API level 1). Same design as the web reference framework/core/live-session.ts;
 * conformance fixtures spec/fixtures/live-session.json (LiveSessionConformanceTest). Spec: framework/spec/LIVE-SESSIONS.md.
 *
 * A live session (an AI assistant chat, an agent run, a terminal) is OWNED BY A HOST, not by the screen showing it.
 * Closing the app only DETACHES a viewer; the session keeps running on its host and any device can ATTACH again and
 * REPLAY what it missed. A session ends only when it is closed on purpose — never on disconnect or idle.
 *
 * The kernel ships the contract only: [LiveEventLog], [LiveSessions.reduce] and [SessionHost], plus the typed
 * placeholder for capability `axf.live-sessions` (declared in AxfKernel). Hosts are modules: a local host and the
 * axHub host (session workers on the VPS, planned).
 */

public const val LIVE_SESSION_CONTRACT: String = "live-session@1"
public const val LIVE_SESSIONS_CAPABILITY: String = "axf.live-sessions"

/** IDLE: open, nothing running · RUNNING: producing events · WAITING: paused for the user · CLOSED: ended on purpose. */
public enum class LiveState(public val id: String) {
    IDLE("idle"), RUNNING("running"), WAITING("waiting"), CLOSED("closed");
    public companion object { public fun parse(s: String): LiveState = entries.firstOrNull { it.id == s } ?: IDLE }
}

/** Reserved lifecycle kinds. Every other kind belongs to the session's owner and is replayed as-is (open set). */
public object LiveKinds {
    public const val OPEN: String = "session.open"
    public const val CLOSE: String = "session.close"
    public const val TURN_START: String = "turn.start"
    public const val TURN_END: String = "turn.end"
    public const val WAIT: String = "wait"
    public const val RESUME: String = "resume"
    /** the host restarted while a turn was running; the turn is over, the session stays open */
    public const val INTERRUPTED: String = "interrupted"
    public val ALL: List<String> = listOf(OPEN, CLOSE, TURN_START, TURN_END, WAIT, RESUME, INTERRUPTED)
}

public data class LiveEvent(val seq: Long, val at: Long, val kind: String, val data: JsonElement? = null)

public data class LiveSessionInfo(
    val id: String,
    /** `assistant.chat`, `agent.run`, `terminal`… (open set) */
    val kind: String,
    val title: String? = null,
    val state: LiveState,
    /** `local`, `axhub`, … */
    val host: String,
    val createdAt: Long,
    val updatedAt: Long,
    val lastSeq: Long,
    val viewers: Int = 0,
    val meta: Map<String, String> = emptyMap(),
)

/** Reading a log after a seq the viewer already has; see framework/spec/LIVE-SESSIONS.md for each flag. */
public data class LiveReplay(val events: List<LiveEvent>, val next: Long, val gap: Boolean, val reset: Boolean, val more: Boolean)

public object LiveSessions {
    /** State after an event; only the reserved kinds change it. */
    public fun reduce(state: LiveState, kind: String): LiveState {
        if (state == LiveState.CLOSED) return LiveState.CLOSED
        return when (kind) {
            LiveKinds.CLOSE -> LiveState.CLOSED
            LiveKinds.TURN_START -> LiveState.RUNNING
            LiveKinds.RESUME -> if (state == LiveState.WAITING) LiveState.RUNNING else state
            LiveKinds.WAIT -> if (state == LiveState.RUNNING) LiveState.WAITING else state
            LiveKinds.TURN_END, LiveKinds.INTERRUPTED -> LiveState.IDLE
            else -> state
        }
    }
}

/** Bounded, append-only log with seq numbers 1, 2, 3… Thread-safe; same results as the web and Python logs. */
public class LiveEventLog(public val limit: Int = 4000, events: List<LiveEvent> = emptyList()) {
    private val items = ArrayDeque<LiveEvent>()
    private var last = 0L

    init { for (e in events) { items.addLast(e); last = maxOf(last, e.seq) }; trim() }

    public val lastSeq: Long @Synchronized get() = last
    public val firstSeq: Long @Synchronized get() = items.firstOrNull()?.seq ?: (last + 1)
    public val size: Int @Synchronized get() = items.size
    @Synchronized public fun all(): List<LiveEvent> = items.toList()

    @Synchronized public fun append(kind: String, data: JsonElement?, at: Long): LiveEvent {
        val e = LiveEvent(++last, at, kind, data)
        items.addLast(e)
        trim()
        return e
    }

    @Synchronized public fun since(after: Long, max: Int = 500): LiveReplay {
        var from = maxOf(0L, after)
        var reset = false
        if (from > last) { reset = true; from = 0 }
        val first = items.firstOrNull()?.seq ?: (last + 1)
        val gap = !reset && items.isNotEmpty() && from < first - 1
        val fresh = items.filter { it.seq > from }
        val events = fresh.take(maxOf(0, max))
        return LiveReplay(events, events.lastOrNull()?.seq ?: from, gap, reset, fresh.size > events.size)
    }

    private fun trim() { while (items.size > limit) items.removeFirst() }
}

public data class LiveOpen(val kind: String, val title: String? = null, val meta: Map<String, String> = emptyMap())

/** Returned by [SessionHost.attach]; detaching never stops the session. */
public fun interface LiveDetach { public fun detach() }

/** Capability `axf.live-sessions`. Hosts are usually remote, so everything suspends and returns [AxfResult]. */
public interface SessionHost {
    public val id: String
    public val label: String
    public suspend fun available(): Boolean
    public suspend fun list(kind: String? = null, includeClosed: Boolean = false): AxfResult<List<LiveSessionInfo>>
    public suspend fun open(spec: LiveOpen): AxfResult<LiveSessionInfo>
    public suspend fun info(id: String): AxfResult<LiveSessionInfo>
    public suspend fun events(id: String, after: Long, max: Int = 500): AxfResult<LiveReplay>
    /** Replays everything after [after], then streams new events until detached. */
    public suspend fun attach(id: String, after: Long, onEvent: (LiveEvent) -> Unit, onReplay: (LiveReplay) -> Unit = {}): AxfResult<LiveDetach>
    /** Input for the session's owner (chat message, keystrokes…) as JSON. */
    public suspend fun send(id: String, input: JsonElement): AxfResult<Unit>
    /** Stops the running turn; the session stays open. */
    public suspend fun stop(id: String): AxfResult<Unit>
    /** The only way a session ends. */
    public suspend fun close(id: String): AxfResult<Unit>
}

/** Kernel default until a module registers a host. Never pretends to work. */
public object PlaceholderSessionHost : SessionHost {
    private val missing get() = AxfResult.err(AxfFailure.NotImplemented(LIVE_SESSIONS_CAPABILITY))
    override val id: String = "placeholder"
    override val label: String = "No session host"
    override suspend fun available(): Boolean = false
    override suspend fun list(kind: String?, includeClosed: Boolean): AxfResult<List<LiveSessionInfo>> = AxfResult.ok(emptyList())
    override suspend fun open(spec: LiveOpen): AxfResult<LiveSessionInfo> = missing
    override suspend fun info(id: String): AxfResult<LiveSessionInfo> = missing
    override suspend fun events(id: String, after: Long, max: Int): AxfResult<LiveReplay> = missing
    override suspend fun attach(id: String, after: Long, onEvent: (LiveEvent) -> Unit, onReplay: (LiveReplay) -> Unit): AxfResult<LiveDetach> = missing
    override suspend fun send(id: String, input: JsonElement): AxfResult<Unit> = missing
    override suspend fun stop(id: String): AxfResult<Unit> = missing
    override suspend fun close(id: String): AxfResult<Unit> = missing
}

/** Hosts by id (open registry): the chosen host, else the first registered, else the placeholder. */
public class SessionHosts {
    private val hosts = LinkedHashMap<String, SessionHost>()
    private var chosen: String = ""
    @Synchronized public fun register(h: SessionHost): () -> Unit { hosts[h.id] = h; return { synchronized(this) { if (hosts[h.id] === h) hosts.remove(h.id) } } }
    @Synchronized public fun list(): List<SessionHost> = hosts.values.toList()
    @Synchronized public fun get(id: String): SessionHost? = hosts[id]
    @Synchronized public fun choose(id: String) { chosen = id }
    @Synchronized public fun current(): SessionHost = hosts[chosen] ?: hosts.values.firstOrNull() ?: PlaceholderSessionHost
}
