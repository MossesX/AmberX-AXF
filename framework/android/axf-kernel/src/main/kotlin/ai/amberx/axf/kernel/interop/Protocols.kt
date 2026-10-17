package ai.amberx.axf.kernel.interop

import ai.amberx.axf.kernel.contract.AuditEntry
import ai.amberx.axf.kernel.event.AxfEvent
import ai.amberx.axf.kernel.result.AxfResult
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/* ---------- protocol adapters ---------- */

public enum class ProtocolDirection { INBOUND, OUTBOUND, BOTH }
public enum class AdapterState { STOPPED, STARTING, RUNNING, FAILED }

/** Identity of a protocol an adapter speaks. */
public data class ProtocolInfo(
    /** `mcp`, `axf-link`, `axhub`, `rest`, … */
    val id: String,
    /** protocol revision, e.g. `2025-06-18` for MCP, `1` for axf-link */
    val version: String,
    val label: String,
    val direction: ProtocolDirection,
    /** `streamable-http`, `stdio`, `websocket`, `android-ipc`, … */
    val transport: String,
) { public val tag: String get() = "$id/$version" }

/**
 * A protocol adapter (Foundations: interop). Contributed by modules through [ai.amberx.axf.kernel.module.ExtensionPoints.PROTOCOL_ADAPTERS].
 * Inbound adapters translate wire requests into [ProtocolHost.invoke] calls and kernel results back to the wire;
 * outbound adapters register a [RemoteServices] provider. Adapters authenticate callers and build the [RemoteCaller]
 * themselves — the kernel trusts nothing an adapter did not vouch for.
 */
public interface ProtocolAdapter {
    public val info: ProtocolInfo
    public val module: String
    public val state: AdapterState
    /** Human-readable endpoint for the console (`https://…/mcp`, `axf-link://com.example.app`). */
    public val endpoint: String? get() = null
    public suspend fun start(host: ProtocolHost): AxfResult<Unit>
    public suspend fun stop()
}

/**
 * What the kernel hands an adapter: the surface it may publish and a guarded way to invoke it —
 * never the kernel itself, so an adapter cannot reach LOCAL actions or bypass checks.
 */
public interface ProtocolHost {
    public val appId: String
    public val appVersion: String
    /** What a caller of this origin kind may see. */
    public fun surface(kind: OriginKind): AppSurface
    /** Runs an action with full exposure, permission and schema checks; external calls are audited. */
    public suspend fun invoke(action: String, input: JsonObject, origin: CallOrigin, progress: suspend (CallProgress) -> Unit = {}): AxfResult<JsonElement>
    /** Events the given origin may receive (filtered by [EventDescriptor] exposure and caller permissions). */
    public fun events(origin: CallOrigin): Flow<AxfEvent>
    /** The job manager when one is installed; null while `axf.jobs` is a placeholder. */
    public val jobs: JobManager?
    public fun audit(entry: AuditEntry)
}

/* ---------- the self-description an app publishes ---------- */

/**
 * `surface@1` — everything an app exposes to one class of caller. MCP adapters turn `actions` into tools,
 * axf-link publishes it to paired apps, the axHub connector registers it as a service. Same document everywhere.
 */
public data class AppSurface(
    val appId: String,
    val appVersion: String,
    val frameworkVersion: String,
    val apiLevel: Int,
    val audience: OriginKind,
    val actions: List<ActionDescriptor>,
    val events: List<EventDescriptor>,
    val protocols: List<ProtocolInfo>,
) {
    public fun toJson(): JsonObject = buildJsonObject {
        put("\$axf", FRAME)
        put("app", buildJsonObject { put("id", appId); put("version", appVersion) })
        put("framework", buildJsonObject { put("version", frameworkVersion); put("apiLevel", apiLevel) })
        put("audience", audience.name.lowercase())
        put("actions", JsonArray(actions.map { it.toJson() }))
        put("events", JsonArray(events.map { it.toJson() }))
        put("protocols", JsonArray(protocols.map { p -> buildJsonObject { put("id", p.id); put("version", p.version); put("transport", p.transport); put("direction", p.direction.name.lowercase()) } }))
    }

    public companion object { public const val FRAME: String = "surface@1" }
}

/** Contribution shape for [ai.amberx.axf.kernel.module.ExtensionPoints.ACTION_DESCRIPTORS]. `callable` is optional. */
public data class ActionDescriptorContribution(val descriptor: ActionDescriptor, val callable: CallableAction? = null)

/** Contribution shape for [ai.amberx.axf.kernel.module.ExtensionPoints.EVENT_DESCRIPTORS]. */
public data class EventDescriptorContribution(val descriptor: EventDescriptor)

/** Helper for adapters: a JSON element as plain text for positional action-bus args. */
internal fun JsonElement.argText(): String = (this as? JsonPrimitive)?.content ?: toString()
