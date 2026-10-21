package ai.amberx.axf.platform

import android.app.Application
import android.content.pm.ApplicationInfo
import ai.amberx.axf.assets.AssetLoader
import ai.amberx.axf.assets.AssetsModule
import ai.amberx.axf.kernel.AxfKernel
import ai.amberx.axf.kernel.Platform
import ai.amberx.axf.kernel.manifest.AxfManifest
import ai.amberx.axf.kernel.module.AxfModule
import ai.amberx.axf.kernel.module.BaseModule
import ai.amberx.axf.kernel.module.Capability
import ai.amberx.axf.kernel.module.ModuleContext
import ai.amberx.axf.kernel.module.PlaceholderModule
import ai.amberx.axf.kernel.platform.PermissionGateway
import ai.amberx.axf.kernel.platform.Telemetry
import ai.amberx.axf.kernel.platform.NoopTelemetry
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * Base Application for every AXF app. Reads `assets/axf/axf.manifest.json` and every bundled asset,
 * builds the kernel synchronously (so the first frame already has compiled tokens) and starts the
 * module graph on [appScope]. Override [modules] to add the app's modules.
 *
 *   class MyApp : AxfApplication() {
 *       override fun modules() = listOf(SettingsModule(), MyAppModule())
 *   }
 */
public abstract class AxfApplication : Application() {
    public val appScope: CoroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    public lateinit var kernel: AxfKernel
        private set
    public lateinit var permissions: AndroidPermissions
        private set
    private val _ready = MutableStateFlow(false)
    /** True once every module has started. The UI renders before that from the compiled bundle. */
    public val ready: StateFlow<Boolean> get() = _ready.asStateFlow()

    public val isDebuggable: Boolean get() = (applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0

    /** Path of the manifest inside the APK assets. */
    protected open val manifestPath: String = "axf/axf.manifest.json"

    /** App modules, in any order; the kernel sorts them by dependency. */
    protected abstract fun modules(): List<AxfModule>

    /** Override to plug a telemetry vendor. */
    protected open fun telemetry(): Telemetry = NoopTelemetry

    /** Override to tweak the platform (tests, flavors). */
    protected open fun platform(manifest: AxfManifest): Platform =
        AndroidPlatform.create(this, manifest.appId, versionName(), isDebuggable, telemetry(), permissions)

    protected open fun manifest(): AxfManifest {
        val text = assets.open(manifestPath).bufferedReader().use { it.readText() }
        return AxfManifest.parse(text) ?: throw IllegalStateException("Invalid $manifestPath")
    }

    /** Hook for apps that need to decorate the builder (extra asset types, storage key). */
    protected open fun configure(builder: AxfKernel.Builder): AxfKernel.Builder = builder

    override fun onCreate() {
        super.onCreate()
        permissions = AndroidPermissions(this)
        val manifest = manifest()
        val builder = AxfKernel.builder(manifest)
            .assets(AssetLoader.loadAll(this))
            .platform(platform(manifest))
            .modules(AndroidPlatformModule(permissions), AssetsModule(this), *modules().toTypedArray())
        kernel = configure(builder).build()
        // Secure window apps: WebView remote debugging off for the whole process, before any service or screen
        // touches a WebView (AxfActivity sets FLAG_SECURE on its window).
        if (manifest.android?.secureWindow == true) runCatching { android.webkit.WebView.setWebContentsDebuggingEnabled(false) }
        appScope.launch {
            kernel.start()
            _ready.value = true
        }
    }

    private fun versionName(): String = runCatching { packageManager.getPackageInfo(packageName, 0).versionName ?: "0.0.0" }.getOrDefault("0.0.0")

    public companion object {
        /** The running application, for places that only have a Context. */
        public fun from(context: android.content.Context): AxfApplication = context.applicationContext as? AxfApplication
            ?: throw IllegalStateException("Application must extend AxfApplication")
    }
}

/**
 * The platform module: registers the Android permission gateway and declares the device capabilities
 * the framework knows about but does not implement here (biometrics, camera, share sheet, …) as
 * placeholders, so feature modules can require them and the console lists what is still missing.
 */
public class AndroidPlatformModule(private val permissions: AndroidPermissions) : BaseModule(ID, "Android platform") {
    override val provides: List<Capability> = listOf(
        Capability("axf.permissions", "Runtime permissions through ActivityResult"),
        Capability("axf.kv", "SharedPreferences key-value store"),
        Capability("axf.secure", "EncryptedSharedPreferences secure store"),
        Capability("axf.files", "FileLayout on app storage"),
    )
    override fun register(ctx: ModuleContext) {
        ctx.services.register(PermissionGateway::class, permissions, "axf.permissions")
        ctx.services.register(AndroidPermissions::class, permissions)
    }
    public companion object {
        public const val ID: String = "ai.amberx.axf.platform"
        /** Device capabilities declared but not built yet; apps add the real module later. */
        public fun placeholders(): List<PlaceholderModule> = listOf(
            PlaceholderModule("ai.amberx.axf.platform.biometric", "Biometrics", listOf(Capability("android.biometric"))),
            PlaceholderModule("ai.amberx.axf.platform.camera", "Camera", listOf(Capability("android.camera"))),
            PlaceholderModule("ai.amberx.axf.platform.share", "Share sheet", listOf(Capability("android.share"))),
            PlaceholderModule("ai.amberx.axf.platform.notifications", "Notifications", listOf(Capability("android.notifications"))),
            PlaceholderModule("ai.amberx.axf.platform.work", "Background work", listOf(Capability("android.work"))),
        )
    }
}
