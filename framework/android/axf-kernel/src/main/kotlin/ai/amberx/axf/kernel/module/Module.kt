package ai.amberx.axf.kernel.module

import ai.amberx.axf.kernel.AxfVersion
import ai.amberx.axf.kernel.result.AxfFailure
import ai.amberx.axf.kernel.result.AxfResult
import kotlin.reflect.KClass

/**
 * A capability is something a module can provide and another can require, by id. Ids are namespaced
 * (`ai.amberx.axf.settings`, `axf.logging.sink`, `android.camera`). Declaring a capability nobody
 * provides is allowed: the kernel answers requests for it with a typed placeholder.
 */
public data class Capability(val id: String, val description: String = "", val sinceApiLevel: Int = 1)

/** Lifecycle every module goes through, in dependency order. */
public enum class ModuleState { REGISTERED, INITIALIZED, STARTED, STOPPED, FAILED }

/**
 * The module contract (Foundations: f.module). Every library, feature and app module implements it.
 * Modules declare what they provide/require; the kernel orders them by dependency, initializes, starts
 * and stops them, and exposes everything they register through extension points.
 */
public interface AxfModule {
    /** Namespaced id, e.g. `ai.amberx.axf.settings`. */
    public val id: String
    public val version: String get() = AxfVersion.FRAMEWORK
    /** Human label for the console's module manager. */
    public val label: String get() = id.substringAfterLast('.')
    /** Kernel API level this module was built against. The kernel refuses modules from a higher level. */
    public val apiLevel: Int get() = AxfVersion.API_LEVEL
    /** Module ids that must be initialized before this one. */
    public val dependsOn: List<String> get() = emptyList()
    /** Optional dependencies: used when present, never required. */
    public val optionalDependsOn: List<String> get() = emptyList()
    public val provides: List<Capability> get() = emptyList()
    public val requires: List<String> get() = emptyList()
    /** True for modules that only carry contracts + stubs (the console shows them as placeholders). */
    public val placeholder: Boolean get() = false

    /** Register extensions, actions, asset types, routes, settings. No I/O here. */
    public fun register(ctx: ModuleContext) {}
    /** Resolve dependencies, open storage. May suspend. */
    public suspend fun init(ctx: ModuleContext) {}
    /** Begin background work. */
    public suspend fun start(ctx: ModuleContext) {}
    public suspend fun stop(ctx: ModuleContext) {}
}

/** Convenience base class with all hooks optional. */
public abstract class BaseModule(override val id: String, override val label: String = id.substringAfterLast('.')) : AxfModule

/**
 * A declared-but-unbuilt module: the console lists it, its capabilities resolve to NotImplemented
 * placeholders, and the real implementation later replaces it without any caller changing.
 */
public open class PlaceholderModule(id: String, label: String, override val provides: List<Capability>, override val dependsOn: List<String> = emptyList()) : BaseModule(id, label) {
    override val placeholder: Boolean get() = true
}

/**
 * Typed placeholder for a capability nobody has implemented (Foundations: f.stubs). Callers get a
 * failure they can render instead of a crash; the devtools list every placeholder still in use.
 */
public class NotImplemented(public val capability: String) {
    public fun <T> fail(): AxfResult<T> = AxfResult.err(AxfFailure.NotImplemented(capability))
    public val failure: AxfFailure.NotImplemented get() = AxfFailure.NotImplemented(capability)
}

/** Graph diagnostics the console's module manager renders. */
public data class ModuleInfo(val id: String, val label: String, val version: String, val apiLevel: Int, val state: ModuleState, val dependsOn: List<String>, val provides: List<String>, val requires: List<String>, val placeholder: Boolean, val error: String? = null)

/** Everything a module can reach while registering/running. Interface so tests can fake it. */
public interface ModuleContext {
    public val extensions: ExtensionRegistry
    public val services: ServiceRegistry
    /** Opaque bag for cross-cutting kernel services; typed accessors live on AxfKernel. */
    public fun <T : Any> service(type: KClass<T>): T?
    public fun <T : Any> require(type: KClass<T>): T = service(type) ?: throw IllegalStateException("Service ${type.simpleName} is not registered")
}

public inline fun <reified T : Any> ModuleContext.service(): T? = service(T::class)
public inline fun <reified T : Any> ModuleContext.require(): T = require(T::class)
