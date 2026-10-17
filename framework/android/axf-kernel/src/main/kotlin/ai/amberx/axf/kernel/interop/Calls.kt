package ai.amberx.axf.kernel.interop

import ai.amberx.axf.kernel.contract.Principal
import ai.amberx.axf.kernel.result.AxfFailure
import ai.amberx.axf.kernel.result.AxfResult
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/* ---------- who is calling ---------- */

/** Where a call came from. Everything except UI/APP is external and goes through exposure + caller checks. */
public enum class OriginKind { UI, APP, LINKED_APP, REMOTE }

/**
 * An external caller, as authenticated by the adapter that received the call. Its [permissions] are
 * what the adapter granted (token scopes, pairing grants) — never the local user's UAC role.
 * An external call must pass BOTH the caller's grants and the app's current UAC role.
 */
public data class RemoteCaller(
    /** stable id from the adapter: token id, paired app id, hub client id */
    val id: String,
    /** adapter / protocol that authenticated it, e.g. `mcp`, `axf-link`, `axhub` */
    val via: String,
    val label: String? = null,
    /** granted permissions; same grammar as UAC (`*`, `ns.*`) */
    val permissions: Set<String> = emptySet(),
    /** when the caller acts on behalf of a known person */
    val principal: Principal? = null,
    val attributes: Map<String, String> = emptyMap(),
)

public data class CallOrigin(
    val kind: OriginKind,
    val caller: RemoteCaller? = null,
    /** protocol id + version that carried the call, e.g. `mcp/2025-06`, `axf-link@1` */
    val protocol: String? = null,
    /** trace id propagated across hops (hub → app → hub) */
    val correlationId: String? = null,
) {
    public val isExternal: Boolean get() = kind == OriginKind.LINKED_APP || kind == OriginKind.REMOTE

    public companion object {
        public val UI: CallOrigin = CallOrigin(OriginKind.UI)
        public val APP: CallOrigin = CallOrigin(OriginKind.APP)
        public fun remote(caller: RemoteCaller, protocol: String? = null, correlationId: String? = null): CallOrigin = CallOrigin(OriginKind.REMOTE, caller, protocol, correlationId)
        public fun linked(caller: RemoteCaller, correlationId: String? = null): CallOrigin = CallOrigin(OriginKind.LINKED_APP, caller, "axf-link@1", correlationId)
    }
}

/* ---------- actions that return values ---------- */

/** Progress or a partial result from a running call. */
public data class CallProgress(val fraction: Double? = null, val message: String? = null, val partial: JsonElement? = null)

/** Everything a [CallableAction] sees about the call in flight. */
public class ActionCall(
    public val id: String,
    public val input: JsonObject,
    public val origin: CallOrigin,
    public val progress: suspend (CallProgress) -> Unit = {},
    public val isCancelled: () -> Boolean = { false },
)

/**
 * An action that returns a value. Plain action-bus handlers return nothing (UI fire-and-forget);
 * anything meant to answer a remote caller registers a CallableAction for the same id.
 */
public fun interface CallableAction { public suspend fun call(call: ActionCall): AxfResult<JsonElement> }

/* ---------- long-running work ---------- */

public enum class JobState { QUEUED, RUNNING, SUCCEEDED, FAILED, CANCELLED }

public data class JobStatus(
    val jobId: String,
    val action: String,
    val state: JobState,
    val progress: CallProgress? = null,
    val result: JsonElement? = null,
    val error: WireError? = null,
    val startedAtMillis: Long = 0,
    val finishedAtMillis: Long? = null,
) {
    public val done: Boolean get() = state == JobState.SUCCEEDED || state == JobState.FAILED || state == JobState.CANCELLED
}

/**
 * Capability `axf.jobs`. Runs [ActionDescriptor.longRunning] actions in the background so a caller
 * gets a job id immediately and polls or subscribes. Typed placeholder until a module implements it
 * (likely on top of WorkScheduler for work that must survive process death).
 */
public interface JobManager {
    public suspend fun start(action: String, input: JsonObject, origin: CallOrigin): AxfResult<String>
    public fun status(jobId: String): JobStatus?
    public fun watch(jobId: String): Flow<JobStatus>
    public suspend fun cancel(jobId: String): AxfResult<Unit>
    public fun recent(limit: Int = 50): List<JobStatus>
}

/* ---------- calling out ---------- */

/** A service an outbound adapter can reach (an MCP server, an axHub service, another AXF app). */
public data class RemoteService(val id: String, val label: String, val via: String, val description: String? = null, val tools: List<ActionDescriptor> = emptyList())

/**
 * Capability `axf.remote` — how app code calls OUT, whatever protocol carries it. lib-mcp (as MCP client),
 * lib-hub (axHub connector) and axf-link register providers; app code only ever sees this interface.
 * Typed placeholder until one of them is installed.
 */
public interface RemoteServices {
    public suspend fun list(): AxfResult<List<RemoteService>>
    public suspend fun describe(service: String): AxfResult<RemoteService>
    public suspend fun call(service: String, tool: String, input: JsonObject, correlationId: String? = null): AxfResult<JsonElement>
}

/* ---------- one error model on the wire ---------- */

/**
 * The stable, protocol-neutral error every adapter emits and parses. Codes never change meaning;
 * new codes may be added (callers treat unknown codes as `unexpected`).
 */
public data class WireError(val code: String, val message: String, val retryable: Boolean = false, val retryAfterMs: Long? = null, val details: Map<String, String> = emptyMap()) {
    public fun toJson(): JsonObject = buildJsonObject {
        put("code", code); put("message", message); put("retryable", retryable)
        retryAfterMs?.let { put("retryAfterMs", it) }
        if (details.isNotEmpty()) put("details", JsonObject(details.mapValues { JsonPrimitive(it.value) }))
    }

    /** Back into the kernel's failure type (outbound adapters use this for replies). */
    public fun toFailure(): AxfFailure = when (code) {
        WireCodes.INVALID -> AxfFailure.Invalid(message, details["field"])
        WireCodes.NOT_IMPLEMENTED -> AxfFailure.NotImplemented(details["capability"] ?: "remote", message)
        WireCodes.DENIED -> AxfFailure.Denied(details["permission"] ?: "remote", message)
        WireCodes.NOT_FOUND -> AxfFailure.NotFound(details["what"] ?: "item", details["id"] ?: "", message)
        WireCodes.UNAVAILABLE -> AxfFailure.Unavailable(message, retryAfterMs)
        WireCodes.VALIDATION -> AxfFailure.Validation(message.split("; ").filter { it.isNotBlank() })
        else -> AxfFailure.Unexpected(message)
    }
}

public object WireCodes {
    public const val INVALID: String = "invalid"
    public const val NOT_IMPLEMENTED: String = "not_implemented"
    public const val DENIED: String = "denied"
    public const val NOT_FOUND: String = "not_found"
    public const val UNAVAILABLE: String = "unavailable"
    public const val VALIDATION: String = "validation"
    public const val UNEXPECTED: String = "unexpected"
    /** reserved for adapters (no AxfFailure equivalent yet) */
    public const val CANCELLED: String = "cancelled"
    public const val TIMEOUT: String = "timeout"
    public const val CONFIRMATION_REQUIRED: String = "confirmation_required"
}

/** Kernel failure → wire error. Exception text is never sent; only the user-presentable message. */
public fun AxfFailure.toWire(): WireError = when (this) {
    is AxfFailure.Invalid -> WireError(WireCodes.INVALID, message, details = listOfNotNull(field?.let { "field" to it }).toMap())
    is AxfFailure.NotImplemented -> WireError(WireCodes.NOT_IMPLEMENTED, message, details = mapOf("capability" to capability))
    is AxfFailure.Denied -> WireError(WireCodes.DENIED, message, details = mapOf("permission" to permission))
    is AxfFailure.NotFound -> WireError(WireCodes.NOT_FOUND, message, details = mapOf("what" to what, "id" to id))
    is AxfFailure.Unavailable -> WireError(WireCodes.UNAVAILABLE, message, retryable = true, retryAfterMs = retryAfterMs)
    is AxfFailure.Validation -> WireError(WireCodes.VALIDATION, message)
    is AxfFailure.Unexpected -> WireError(WireCodes.UNEXPECTED, "Unexpected error")
}
