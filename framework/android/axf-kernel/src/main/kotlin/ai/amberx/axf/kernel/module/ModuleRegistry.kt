package ai.amberx.axf.kernel.module

import ai.amberx.axf.kernel.AxfVersion
import ai.amberx.axf.kernel.result.AxfFailure
import ai.amberx.axf.kernel.result.AxfResult

/**
 * Holds every module, orders them by dependency (deterministic, cycle-safe), and drives the lifecycle.
 * Modules can be added after start (dynamic feature modules): they are initialized and started on the spot.
 */
public class ModuleRegistry(private val ctx: () -> ModuleContext, private val onEvent: (String, ModuleState, String?) -> Unit = { _, _, _ -> }) {
    private val modules = LinkedHashMap<String, AxfModule>()
    private val states = LinkedHashMap<String, ModuleState>()
    private val errors = LinkedHashMap<String, String>()
    private var started = false

    public fun add(module: AxfModule): AxfResult<Unit> {
        if (module.apiLevel > AxfVersion.API_LEVEL) return AxfResult.err(AxfFailure.Invalid("Module ${module.id} needs kernel API level ${module.apiLevel}, this kernel is ${AxfVersion.API_LEVEL}"))
        if (module.id in modules) return AxfResult.err(AxfFailure.Invalid("Module ${module.id} is already registered"))
        modules[module.id] = module
        states[module.id] = ModuleState.REGISTERED
        for (c in module.provides) ctx().services.declarePlaceholder(c.id)
        onEvent(module.id, ModuleState.REGISTERED, null)
        return AxfResult.ok(Unit)
    }

    public fun get(id: String): AxfModule? = modules[id]
    public fun all(): List<AxfModule> = modules.values.toList()
    public fun state(id: String): ModuleState? = states[id]
    public fun isStarted(): Boolean = started

    /** Topological order; a module whose hard dependency is missing is marked FAILED and skipped. */
    public fun order(): AxfResult<List<AxfModule>> {
        val out = mutableListOf<AxfModule>()
        val visiting = mutableSetOf<String>()
        val done = mutableSetOf<String>()
        fun visit(m: AxfModule, chain: List<String>): Boolean {
            if (m.id in done) return true
            if (m.id in visiting) { fail(m.id, "Dependency cycle: ${(chain + m.id).joinToString(" → ")}"); return false }
            visiting += m.id
            for (d in m.dependsOn) {
                val dep = modules[d] ?: run { fail(m.id, "Missing dependency $d"); visiting -= m.id; return false }
                if (!visit(dep, chain + m.id)) { fail(m.id, "Dependency $d failed"); visiting -= m.id; return false }
            }
            for (d in m.optionalDependsOn) modules[d]?.let { visit(it, chain + m.id) }
            visiting -= m.id; done += m.id; out += m
            return true
        }
        for (m in modules.values.sortedBy { it.id }) visit(m, emptyList())
        return AxfResult.ok(out)
    }

    private fun fail(id: String, why: String) { states[id] = ModuleState.FAILED; errors[id] = why; onEvent(id, ModuleState.FAILED, why) }

    public fun registerAll() {
        for (m in order().getOrNull().orEmpty()) if (states[m.id] == ModuleState.REGISTERED) runCatching { m.register(ctx()) }.onFailure { fail(m.id, it.message ?: "register failed") }
    }

    public suspend fun startAll() {
        for (m in order().getOrNull().orEmpty()) if (states[m.id] == ModuleState.REGISTERED) lifecycle(m)
        started = true
    }

    private suspend fun lifecycle(m: AxfModule) {
        try {
            m.init(ctx()); states[m.id] = ModuleState.INITIALIZED; onEvent(m.id, ModuleState.INITIALIZED, null)
            m.start(ctx()); states[m.id] = ModuleState.STARTED; onEvent(m.id, ModuleState.STARTED, null)
        } catch (e: Exception) { fail(m.id, e.message ?: e::class.simpleName ?: "failed") }
    }

    /** Add + run a module after startup (dynamic feature). */
    public suspend fun addAndStart(module: AxfModule): AxfResult<Unit> {
        val r = add(module); if (!r.isOk) return r
        if (started) { runCatching { module.register(ctx()) }.onFailure { fail(module.id, it.message ?: "register failed") }; if (states[module.id] == ModuleState.REGISTERED) lifecycle(module) }
        return AxfResult.ok(Unit)
    }

    public suspend fun stopAll() {
        for (m in order().getOrNull().orEmpty().reversed()) if (states[m.id] == ModuleState.STARTED) { runCatching { m.stop(ctx()) }; states[m.id] = ModuleState.STOPPED; onEvent(m.id, ModuleState.STOPPED, null) }
        started = false
    }

    public suspend fun stop(id: String) { val m = modules[id] ?: return; if (states[id] == ModuleState.STARTED) { runCatching { m.stop(ctx()) }; states[id] = ModuleState.STOPPED; ctx().extensions.removeAllFrom(id); onEvent(id, ModuleState.STOPPED, null) } }

    public fun info(): List<ModuleInfo> = modules.values.map { m -> ModuleInfo(m.id, m.label, m.version, m.apiLevel, states[m.id] ?: ModuleState.REGISTERED, m.dependsOn, m.provides.map { it.id }, m.requires, m.placeholder, errors[m.id]) }

    /** Dependency graph as edges (from → to) for the console's graph view. */
    public fun edges(): List<Pair<String, String>> = modules.values.flatMap { m -> (m.dependsOn + m.optionalDependsOn).map { m.id to it } }
}
