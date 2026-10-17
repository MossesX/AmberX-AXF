package ai.amberx.axf.kernel.interop

import ai.amberx.axf.kernel.AxfVersion
import ai.amberx.axf.kernel.contract.AuditEntry
import ai.amberx.axf.kernel.contract.AuditLog
import ai.amberx.axf.kernel.engine.ActionBus
import ai.amberx.axf.kernel.engine.ActionContext
import ai.amberx.axf.kernel.engine.UacEngine
import ai.amberx.axf.kernel.event.AxfEvent
import ai.amberx.axf.kernel.event.EventBus
import ai.amberx.axf.kernel.result.AxfFailure
import ai.amberx.axf.kernel.result.AxfResult
import ai.amberx.axf.kernel.result.AxfException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.filter
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject

/**
 * Capability `axf.interop` — the one gate between an app and every protocol. Holds action/event
 * descriptors and callables, publishes [AppSurface]s, runs guarded invocations, and drives the
 * lifecycle of contributed [ProtocolAdapter]s. Every external call is checked in this order:
 *
 *   1. the action has a descriptor whose exposure reaches the origin kind   (else not_found — LOCAL stays invisible)
 *   2. the caller's grants cover ActionMeta.requires and descriptor.requires (else denied)
 *   3. the app's current UAC role covers them too                          (else denied)
 *   4. input passes the descriptor's schema check                           (else validation)
 *   5. long-running actions go to the JobManager                            (else not_implemented while it's a placeholder)
 *
 * and is audited with caller, protocol, correlation id and outcome.
 */
public class AxfInterop(
    override val appId: String,
    override val appVersion: String,
    private val bus: ActionBus,
    private val roleCan: (String?) -> Boolean,
    private val eventBus: EventBus,
    private val auditLog: () -> AuditLog?,
    private val jobManager: () -> JobManager?,
    private val now: () -> Long,
) : ProtocolHost {
    private val actionDescriptors = LinkedHashMap<String, ActionDescriptor>()
    private val callables = LinkedHashMap<String, CallableAction>()
    private val eventDescriptors = LinkedHashMap<String, EventDescriptor>()
    private val adapters = LinkedHashMap<String, ProtocolAdapter>()

    /* ---------- registration ---------- */

    public fun describe(descriptor: ActionDescriptor, callable: CallableAction? = null): () -> Unit {
        actionDescriptors[descriptor.id] = descriptor
        callable?.let { callables[descriptor.id] = it }
        return { if (actionDescriptors[descriptor.id] === descriptor) { actionDescriptors.remove(descriptor.id); callables.remove(descriptor.id) } }
    }

    public fun describeEvent(descriptor: EventDescriptor): () -> Unit {
        eventDescriptors[descriptor.topic] = descriptor
        return { if (eventDescriptors[descriptor.topic] === descriptor) eventDescriptors.remove(descriptor.topic) }
    }

    public fun descriptor(id: String): ActionDescriptor? = actionDescriptors[id]
    public fun descriptors(): List<ActionDescriptor> = actionDescriptors.values.toList()
    public fun eventDescriptors(): List<EventDescriptor> = eventDescriptors.values.toList()
    public fun adapters(): List<ProtocolAdapter> = adapters.values.toList()

    /** Actions that have a descriptor but no handler anywhere (console warning list). */
    public fun unbound(): List<String> = actionDescriptors.keys.filter { it !in callables && !bus.has(it) }

    /* ---------- ProtocolHost ---------- */

    override fun surface(kind: OriginKind): AppSurface = AppSurface(
        appId = appId, appVersion = appVersion, frameworkVersion = AxfVersion.FRAMEWORK, apiLevel = AxfVersion.API_LEVEL, audience = kind,
        actions = actionDescriptors.values.filter { it.reachableFrom(kind) && (it.id in callables || bus.has(it.id)) },
        events = eventDescriptors.values.filter { it.reachableFrom(kind) },
        protocols = adapters.values.map { it.info },
    )

    override val jobs: JobManager? get() = jobManager()

    override fun audit(entry: AuditEntry) { auditLog()?.record(entry) }

    override fun events(origin: CallOrigin): Flow<AxfEvent> = eventBus.events.filter { e ->
        if (!origin.isExternal) return@filter true
        val d = eventDescriptors[e.topic] ?: return@filter false
        d.reachableFrom(origin.kind) && UacEngine.hasPermission(origin.caller?.permissions ?: emptySet(), d.requires)
    }

    override suspend fun invoke(action: String, input: JsonObject, origin: CallOrigin, progress: suspend (CallProgress) -> Unit): AxfResult<JsonElement> {
        val result = guardedInvoke(action, input, origin, progress)
        if (origin.isExternal) audit(AuditEntry(
            atMillis = now(), principal = origin.caller?.principal?.id ?: origin.caller?.id ?: "unknown", action = action, target = origin.protocol,
            details = buildMap {
                put("origin", origin.kind.name.lowercase()); origin.caller?.let { put("caller", it.id); put("via", it.via) }
                origin.correlationId?.let { put("correlationId", it) }
                put("outcome", result.failureOrNull()?.toWire()?.code ?: "ok")
            },
            module = "interop",
        ))
        return result
    }

    private suspend fun guardedInvoke(action: String, input: JsonObject, origin: CallOrigin, progress: suspend (CallProgress) -> Unit): AxfResult<JsonElement> {
        val d = actionDescriptors[action]
        if (origin.isExternal) {
            if (d == null || !d.reachableFrom(origin.kind)) return AxfResult.err(AxfFailure.NotFound("action", action))
            val grants = origin.caller?.permissions ?: emptySet()
            for (perm in listOfNotNull(bus.get(action)?.requires, d.requires)) {
                if (!UacEngine.hasPermission(grants, perm) || !roleCan(perm)) return AxfResult.err(AxfFailure.Denied(perm))
            }
        }
        if (d != null) {
            val errors = JsonSchemas.check(d.input, input)
            if (errors.isNotEmpty()) return AxfResult.err(AxfFailure.Validation(errors))
            if (d.longRunning && origin.isExternal) {
                val jm = jobManager() ?: return AxfResult.err(AxfFailure.NotImplemented("axf.jobs"))
                return jm.start(action, input, origin).map { jsonObjectOf("jobId", it) }
            }
        }
        callables[action]?.let { c ->
            return try { c.call(ActionCall(action, input, origin, progress)) }
            catch (e: CancellationException) { throw e }
            catch (e: AxfException) { AxfResult.err(e.failure) }
            catch (e: Exception) { AxfResult.err(AxfFailure.Unexpected(e.message ?: e::class.simpleName ?: "error", e)) }
        }
        if (!bus.has(action)) return AxfResult.err(AxfFailure.NotFound("action", action))
        val args = d?.argOrder?.mapNotNull { input[it]?.argText() } ?: emptyList()
        val spec = if (args.isEmpty()) action else (listOf(action) + args).joinToString(":")
        return bus.dispatch(spec, ActionContext(extras = mapOf(EXTRA_INPUT to input, EXTRA_ORIGIN to origin))).map { JsonNull }
    }

    /* ---------- adapter lifecycle ---------- */

    /** Starts every adapter not already running. Failures are reported per adapter, never thrown. */
    public suspend fun startAdapters(contributed: List<ProtocolAdapter>, onError: (ProtocolAdapter, AxfFailure) -> Unit = { _, _ -> }) {
        for (a in contributed) {
            val key = a.info.tag + "@" + a.module
            if (adapters[key]?.state == AdapterState.RUNNING) continue
            adapters[key] = a
            a.start(this).onErr { onError(a, it) }
        }
    }

    public suspend fun stopAdapters() {
        for (a in adapters.values.reversed()) runCatching { a.stop() }
    }

    public companion object {
        /** ActionContext.extras keys set on bus dispatches that came through interop. */
        public const val EXTRA_INPUT: String = "axf.interop.input"
        public const val EXTRA_ORIGIN: String = "axf.interop.origin"
    }
}

private fun jsonObjectOf(key: String, value: String): JsonElement = JsonObject(mapOf(key to kotlinx.serialization.json.JsonPrimitive(value)))
