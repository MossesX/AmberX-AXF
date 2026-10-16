package ai.amberx.axf.kernel

import ai.amberx.axf.kernel.asset.AssetRegistry
import ai.amberx.axf.kernel.asset.AssetSource
import ai.amberx.axf.kernel.asset.AssetTypeRegistry
import ai.amberx.axf.kernel.asset.parseJsonObjectOf
import ai.amberx.axf.kernel.config.Config
import ai.amberx.axf.kernel.config.ConfigLayer
import ai.amberx.axf.kernel.engine.ActionMeta
import ai.amberx.axf.kernel.event.EventBus
import ai.amberx.axf.kernel.event.KernelEvent
import ai.amberx.axf.kernel.flags.FeatureFlags
import ai.amberx.axf.kernel.flags.Flag
import ai.amberx.axf.kernel.manifest.AxfManifest
import ai.amberx.axf.kernel.migrate.InMemoryLedger
import ai.amberx.axf.kernel.migrate.MigrationLedger
import ai.amberx.axf.kernel.migrate.MigrationRunner
import ai.amberx.axf.kernel.module.AxfModule
import ai.amberx.axf.kernel.module.ExtensionPoints
import ai.amberx.axf.kernel.module.ExtensionRegistry
import ai.amberx.axf.kernel.module.ModuleContext
import ai.amberx.axf.kernel.module.ModuleRegistry
import ai.amberx.axf.kernel.module.ServiceRegistry
import ai.amberx.axf.kernel.platform.AxfClock
import ai.amberx.axf.kernel.platform.AxfDispatchers
import ai.amberx.axf.kernel.platform.AxfLogger
import ai.amberx.axf.kernel.platform.CounterIdGenerator
import ai.amberx.axf.kernel.platform.FileLayout
import ai.amberx.axf.kernel.platform.HostInfo
import ai.amberx.axf.kernel.platform.IdGenerator
import ai.amberx.axf.kernel.platform.KeyValueStore
import ai.amberx.axf.kernel.platform.Log
import ai.amberx.axf.kernel.platform.MemoryKeyValueStore
import ai.amberx.axf.kernel.platform.NoopLogger
import ai.amberx.axf.kernel.platform.NoopPermissions
import ai.amberx.axf.kernel.platform.NoopTelemetry
import ai.amberx.axf.kernel.platform.PermissionGateway
import ai.amberx.axf.kernel.platform.SecureStore
import ai.amberx.axf.kernel.platform.SystemClock
import ai.amberx.axf.kernel.platform.Telemetry
import ai.amberx.axf.kernel.runtime.AxfRuntime
import ai.amberx.axf.kernel.runtime.ToastKind
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.serialization.json.JsonObject
import kotlin.random.Random
import kotlin.reflect.KClass

/** Everything the host (axf-platform-android, a test, a desktop port) injects. All optional; tests run on the in-memory defaults. */
public data class Platform(
    val clock: AxfClock = SystemClock,
    val ids: IdGenerator = CounterIdGenerator(),
    val dispatchers: AxfDispatchers = AxfDispatchers(),
    val store: KeyValueStore = MemoryKeyValueStore(),
    val secure: SecureStore? = null,
    val logger: AxfLogger = NoopLogger,
    val telemetry: Telemetry = NoopTelemetry,
    val permissions: PermissionGateway = NoopPermissions,
    val files: FileLayout? = null,
    val ledger: MigrationLedger = InMemoryLedger(),
    val host: HostInfo = HostInfo(AxfVersion.PORT, "", "", "", "", true, "en"),
    val random: Random = Random.Default,
)

/**
 * The kernel: one per app process. Owns the registries, the module graph, the runtime and the
 * cross-cutting services. Built through [AxfKernel.Builder]; started once by the host.
 *
 *   val kernel = AxfKernel.builder(manifestJson)
 *       .assets(bundledAssetJsons)
 *       .platform(androidPlatform)
 *       .modules(SettingsModule(), LoggingModule(), MyAppModule())
 *       .build()
 *   kernel.start()           // suspend: registers → init → start modules in dependency order
 *   kernel.runtime.swap("color-theme", "next")
 */
public class AxfKernel private constructor(
    public val manifest: AxfManifest,
    public val platform: Platform,
    public val types: AssetTypeRegistry,
    public val registry: AssetRegistry,
    public val events: EventBus,
    public val extensions: ExtensionRegistry,
    public val services: ServiceRegistry,
    public val flags: FeatureFlags,
    public val config: Config,
    public val migrations: MigrationRunner,
    public val runtime: AxfRuntime,
    pendingModules: List<AxfModule>,
) {
    public val scope: CoroutineScope = CoroutineScope(SupervisorJob() + platform.dispatchers.default)
    public val log: Log = Log(platform.logger, "AxfKernel", platform.clock, "kernel")
    public val modules: ModuleRegistry = ModuleRegistry({ context }) { id, st, err -> events.emit(KernelEvent.ModuleStateChanged(id, st.name, err)) }
    public var started: Boolean = false
        private set
    public var startupMillis: Long = 0
        private set

    public val context: ModuleContext = object : ModuleContext {
        override val extensions: ExtensionRegistry get() = this@AxfKernel.extensions
        override val services: ServiceRegistry get() = this@AxfKernel.services
        override fun <T : Any> service(type: KClass<T>): T? = services.get(type)
    }

    init {
        services.register(AxfKernel::class, this, "axf.kernel")
        services.register(AxfRuntime::class, runtime, "axf.runtime")
        services.register(EventBus::class, events, "axf.events")
        services.register(FeatureFlags::class, flags, "axf.flags")
        services.register(Config::class, config, "axf.config")
        services.register(AxfLogger::class, platform.logger, "axf.logging")
        services.register(Telemetry::class, platform.telemetry, "axf.telemetry")
        services.register(PermissionGateway::class, platform.permissions, "axf.permissions")
        services.register(KeyValueStore::class, platform.store, "axf.kv")
        platform.secure?.let { services.register(SecureStore::class, it, "axf.secure") }
        platform.files?.let { services.register(FileLayout::class, it, "axf.files") }
        // Contracts with kernel defaults: anonymous session + in-memory audit; the scheduler stays a typed placeholder until a platform module registers one.
        services.register(ai.amberx.axf.kernel.contract.SessionProvider::class, ai.amberx.axf.kernel.contract.AnonymousSession(platform.clock.nowMillis()), "axf.session")
        services.register(ai.amberx.axf.kernel.contract.AuditLog::class, ai.amberx.axf.kernel.contract.MemoryAuditLog(), "axf.audit")
        services.register(ai.amberx.axf.kernel.contract.WorkRegistry::class, ai.amberx.axf.kernel.contract.WorkRegistry(), "axf.workers")
        services.declarePlaceholder("axf.work")
        services.declarePlaceholder("axf.plugins")
        services.register(ai.amberx.axf.kernel.contract.WindowManager::class, ai.amberx.axf.kernel.contract.WindowManager(), "axf.windows")
        services.register(ai.amberx.axf.kernel.data.QueryClient::class, ai.amberx.axf.kernel.data.QueryClient(scope, platform.clock), "axf.queries")
        for (p in ExtensionPoints.ALL) extensions.declare(p)
        for (flag in KernelFlags.ALL) flags.declare(flag)
        config.load(manifest.raw, ConfigLayer.MANIFEST, "manifest")
        pendingModules.forEach { m -> modules.add(m).onErr { log.e("module ${m.id}: ${it.message}") } }
        // Modules may contribute actions and asset types through extension points; bridge them into the runtime.
        extensions.onChange(ExtensionPoints.ACTIONS) { syncActions() }
        extensions.onChange(ExtensionPoints.ASSET_TYPES) { for (c in extensions.get(ExtensionPoints.ASSET_TYPES)) types.register(c.spec) }
    }

    private fun syncActions() { for (c in extensions.get(ExtensionPoints.ACTIONS)) runtime.actions.register(c.id, c.meta, c.handler) }

    /** Registers → migrates → inits → starts every module. Idempotent. */
    public suspend fun start() {
        if (started) return
        val t0 = platform.clock.nowMillis()
        events.emit(KernelEvent.Lifecycle("starting"))
        modules.registerAll()
        syncActions()
        for (c in extensions.get(ExtensionPoints.MIGRATIONS)) migrations.register(c.migration)
        migrations.run().onErr { log.e("migrations: ${it.message}"); runtime.toast(it.message, ToastKind.DANGER, "Migration failed") }
        for (src in extensions.get(ExtensionPoints.ASSET_SOURCES)) runCatching { src.load() }.getOrElse { log.w("asset source failed", it); emptyList() }.forEach { raw -> registry.register(raw, AssetSource.APP).takeIf { !it.ok }?.let { log.w("asset rejected: ${it.errors}") } }
        runtime.recompile()
        modules.startAll()
        started = true
        startupMillis = platform.clock.nowMillis() - t0
        platform.telemetry.timing("kernel.start", startupMillis)
        events.emit(KernelEvent.Lifecycle("started"))
        log.i("kernel started", "modules" to modules.all().size.toString(), "assets" to registry.count().toString(), "ms" to startupMillis.toString())
    }

    public suspend fun stop() { modules.stopAll(); started = false; events.emit(KernelEvent.Lifecycle("stopped")) }

    public suspend fun addModule(m: AxfModule): Unit = modules.addAndStart(m).onErr { log.e("module ${m.id}: ${it.message}") }.let { }

    /** Snapshot for the console's kernel-status screen. */
    public fun status(): KernelStatus = KernelStatus(
        frameworkVersion = AxfVersion.FRAMEWORK, apiLevel = AxfVersion.API_LEVEL, port = AxfVersion.PORT, started = started, startupMillis = startupMillis,
        modules = modules.info(), extensionPoints = extensions.report(), placeholders = services.placeholders(), assetCounts = registry.countByType(),
        assetTypes = types.ids(), actions = runtime.actions.list().map { it.first }, stubActions = runtime.actions.list().filter { it.second.stub }.map { it.first },
        flags = flags.snapshot(), loadErrors = runtime.loadErrors.map { "${it.first}: ${it.second.joinToString()}" },
    )

    public data class KernelStatus(
        val frameworkVersion: String, val apiLevel: Int, val port: String, val started: Boolean, val startupMillis: Long,
        val modules: List<ai.amberx.axf.kernel.module.ModuleInfo>, val extensionPoints: List<Triple<String, Int, String>>, val placeholders: List<String>,
        val assetCounts: Map<String, Int>, val assetTypes: List<String>, val actions: List<String>, val stubActions: List<String>, val flags: Map<String, Boolean>, val loadErrors: List<String>,
    )

    public class Builder(private val manifest: AxfManifest) {
        private val assets = mutableListOf<JsonObject>()
        private val modules = mutableListOf<AxfModule>()
        private var platform = Platform()
        private var types: AssetTypeRegistry = AssetTypeRegistry.builtin()
        private var storageKey: String? = null

        public fun assets(raw: Collection<JsonObject>): Builder = apply { assets += raw }
        public fun asset(raw: JsonObject): Builder = apply { assets += raw }
        public fun assetJson(texts: Collection<String>): Builder = apply { texts.forEach { t -> parseJsonObjectOf(t)?.let(assets::add) } }
        public fun modules(vararg m: AxfModule): Builder = apply { modules += m }
        public fun platform(p: Platform): Builder = apply { platform = p }
        public fun types(t: AssetTypeRegistry): Builder = apply { types = t }
        public fun storageKey(k: String): Builder = apply { storageKey = k }

        public fun build(): AxfKernel {
            val registry = AssetRegistry(types)
            val errors = mutableListOf<Pair<String, List<String>>>()
            for (raw in assets) registry.register(raw, AssetSource.BUILTIN).takeIf { !it.ok }?.let { errors += (raw["id"]?.toString() ?: "?") to it.errors }
            val events = EventBus()
            val runtime = AxfRuntime(manifest, registry, events, platform.store, platform.clock, platform.random, storageKey)
            runtime.loadErrors += errors
            val flags = FeatureFlags { id, on -> events.emit(KernelEvent.FlagChanged(id, on)) }
            val migrations = MigrationRunner(platform.ledger) { msg -> platform.logger.log(ai.amberx.axf.kernel.platform.LogEntry(platform.clock.nowMillis(), ai.amberx.axf.kernel.platform.LogLevel.INFO, "Migrations", msg)) }
            return AxfKernel(manifest, platform, types, registry, events, ExtensionRegistry(), ServiceRegistry(), flags, Config(), migrations, runtime, modules)
        }
    }

    public companion object {
        public fun builder(manifest: AxfManifest): Builder = Builder(manifest)
        public fun builder(manifestJson: String): Builder = Builder(AxfManifest.parse(manifestJson) ?: throw IllegalArgumentException("Invalid axf.manifest.json"))
        /** The standard asset-swap / role / stub actions every app has, for docs and the console. */
        public val BUILTIN_ACTIONS: List<Pair<String, ActionMeta>> get() = ai.amberx.axf.kernel.engine.StandardActions.ALL.toList()
    }
}

/** Flags the kernel itself declares. Modules declare their own. */
public object KernelFlags {
    public val HOT_RELOAD: Flag = Flag("axf.hotReload", "Reload assets from a URL/QR while developing", default = false)
    public val DEVTOOLS: Flag = Flag("axf.devtools", "Developer console and inspector", default = true)
    public val REMOTE_CONFIG: Flag = Flag("axf.remoteConfig", "Apply remote config/flags from the VPS", default = false)
    public val DYNAMIC_MODULES: Flag = Flag("axf.dynamicModules", "Allow modules to be added after startup", default = true)
    public val STRICT_ASSETS: Flag = Flag("axf.strictAssets", "Refuse to start when any bundled asset fails validation", default = false)
    public val ALL: List<Flag> = listOf(HOT_RELOAD, DEVTOOLS, REMOTE_CONFIG, DYNAMIC_MODULES, STRICT_ASSETS)
}
