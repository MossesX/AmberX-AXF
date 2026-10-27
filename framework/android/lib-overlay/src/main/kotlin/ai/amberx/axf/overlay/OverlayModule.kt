package ai.amberx.axf.overlay

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.Settings as SysSettings
import ai.amberx.axf.kernel.AxfKernel
import ai.amberx.axf.kernel.asset.AssetTypes
import ai.amberx.axf.kernel.config.Config
import ai.amberx.axf.kernel.contract.SettingKind
import ai.amberx.axf.kernel.contract.SettingSpec
import ai.amberx.axf.kernel.contract.SettingsGroup
import ai.amberx.axf.kernel.engine.ActionMeta
import ai.amberx.axf.kernel.engine.OverlayData
import ai.amberx.axf.kernel.engine.OverlayEngine
import ai.amberx.axf.kernel.module.ActionContribution
import ai.amberx.axf.kernel.module.BaseModule
import ai.amberx.axf.kernel.module.Capability
import ai.amberx.axf.kernel.module.ExtensionPoints
import ai.amberx.axf.kernel.module.ModuleContext
import ai.amberx.axf.kernel.module.PlaceholderModule
import ai.amberx.axf.kernel.module.SettingsContribution
import ai.amberx.axf.kernel.platform.KeyValueStore
import ai.amberx.axf.kernel.runtime.AxfRuntime
import ai.amberx.axf.notifications.ChannelImportance
import ai.amberx.axf.notifications.ChannelSpec
import ai.amberx.axf.notifications.LockScreen
import ai.amberx.axf.notifications.OngoingSpec
import kotlinx.serialization.json.JsonPrimitive

/** The quiet ongoing notification the overlay service shows (a foreground service must). `openActivity` is what tapping it opens. */
public data class OverlayNotification(
    val smallIcon: Int,
    val title: String = "Overlay",
    val text: String = "Showing the overlay",
    val openActivity: Class<out Activity>? = null,
    val channelId: String = "overlay",
) {
    public val channel: ChannelSpec get() = ChannelSpec(channelId, "Overlay", ChannelImportance.LOW, "Shown while the overlay is on screen", LockScreen.PUBLIC, vibrate = false, showBadge = false)
    public fun ongoing(): OngoingSpec = OngoingSpec(channelId, title, text, smallIcon)
}

/**
 * The overlay service every module talks to (`axf.overlay`): [OverlayHost] on the Android side. Reads the active `overlay`
 * asset with the user's `axf.overlay.*` settings over it (OverlayEngine.withSettings), starts / stops [OverlayService] as the
 * pill is shown and hidden, checks the draw-over-apps permission and opens its system page. One per process: the service
 * finds it through [current].
 */
public class AxfOverlay internal constructor(
    context: Context,
    public val runtime: AxfRuntime,
    public val kernel: AxfKernel?,
    public val notification: OverlayNotification,
    private val config: () -> Config?,
    public val controller: OverlayController,
) : OverlayHost by controller {
    private val app: Context = context.applicationContext

    init {
        controller.onVisibility = { visible -> if (visible) OverlayService.start(app) else OverlayService.hide(app) }
        controller.canDrawCheck = { SysSettings.canDrawOverlays(app) }
        controller.permissionRequest = { openPermissionPage() }
        controller.dispatch = { spec -> runtime.dispatch(spec) }
    }

    /** The active asset's data with the user's settings over it. */
    public fun effectiveConfig(): OverlayData = effectiveConfig(runtime, config())

    /** Stops the service outright (pill and strip gone until the next show). */
    public fun stop() { controller.hide(); OverlayService.stop(app) }

    /** The system page where the user grants "Display over other apps" (new task: callable from anywhere). */
    public fun openPermissionPage() {
        runCatching { app.startActivity(Intent(SysSettings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:${app.packageName}")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
    }

    public companion object {
        /** The process-wide instance (set by [OverlayModule.register], cleared on stop); what [OverlayService] binds to. */
        @Volatile public var current: AxfOverlay? = null
            internal set

        /** The user's `axf.overlay.*` settings as the engine reads them (strings; unset = the asset decides). */
        public fun settingsValues(config: Config?): Map<String, String?> = OverlayEngine.Settings.ALL.values.associateWith { config?.string(it) }

        public fun effectiveConfig(runtime: AxfRuntime, config: Config?): OverlayData =
            OverlayEngine.withSettings(OverlayEngine.normalize(runtime.assetOrNull(AssetTypes.OVERLAY)?.data), settingsValues(config))
    }
}

/**
 * lib-overlay: the overlay@1 asset on Android. Registers [AxfOverlay] as `axf.overlay`, the Overlay settings group
 * (opacity, position lock, log panel, strip, mini screen, mini size, reset, permission) and the actions
 * `overlay.show` / `overlay.hide` / `overlay.toggle` / `overlay.mini` / `overlay.log` / `overlay.reset` / `overlay.permission`.
 *
 *   OverlayModule(this, OverlayNotification(R.drawable.ic_notification, "Overlay", "Showing the overlay", MainActivity::class.java))
 *
 * Then, from anywhere: `kernel.services.get<OverlayHost>()` (or `AxfOverlay.current`) → setChips / setChip / log.add /
 * setMiniContent / show. The app's manifest adds the service's special-use property (see the module manifest).
 */
public class OverlayModule(private val context: Context, private val notification: OverlayNotification, private val showOnStart: Boolean = false) : BaseModule(ID, "Overlay") {
    override val dependsOn: List<String> = listOf("ai.amberx.axf.notifications")
    override val provides: List<Capability> = listOf(
        Capability("axf.overlay", "The overlay@1 pill over other apps: chips, quick action, log panel, strip, mini-screen host"),
        Capability("android.overlay", "TYPE_APPLICATION_OVERLAY window owned by a foreground service"),
    )
    public lateinit var overlay: AxfOverlay
        private set

    override fun register(ctx: ModuleContext) {
        val runtime = ctx.require(AxfRuntime::class)
        val kernel = ctx.service(AxfKernel::class)
        val config = { ctx.service(Config::class) }
        val controller = OverlayController({ AxfOverlay.effectiveConfig(runtime, config()) }, ctx.service(KeyValueStore::class), hiddenProvider = { runtime.slotHidden(AssetTypes.OVERLAY) })
        overlay = AxfOverlay(context, runtime, kernel, notification, config, controller)
        AxfOverlay.current = overlay
        ctx.services.register(OverlayHost::class, overlay, "axf.overlay")
        ctx.services.register(AxfOverlay::class, overlay)

        val meta = { label: String -> ActionMeta(label, module = id) }
        ctx.extensions.contribute(ExtensionPoints.ACTIONS, id, ActionContribution("overlay.show", meta("Show the overlay")) { _, _ -> overlay.show() })
        ctx.extensions.contribute(ExtensionPoints.ACTIONS, id, ActionContribution("overlay.hide", meta("Hide the overlay")) { _, _ -> overlay.hide() })
        ctx.extensions.contribute(ExtensionPoints.ACTIONS, id, ActionContribution("overlay.toggle", meta("Show or hide the overlay")) { _, _ -> overlay.toggle() })
        ctx.extensions.contribute(ExtensionPoints.ACTIONS, id, ActionContribution("overlay.mini", meta("Expand or collapse the overlay's mini screen")) { _, _ -> overlay.toggleMini() })
        ctx.extensions.contribute(ExtensionPoints.ACTIONS, id, ActionContribution("overlay.log", meta("Show or hide the overlay's log panel")) { _, _ -> overlay.openLog(!controller.current.logOpen) })
        ctx.extensions.contribute(ExtensionPoints.ACTIONS, id, ActionContribution("overlay.reset", meta("Put the overlay back where it started")) { _, _ -> overlay.resetGeometry() })
        ctx.extensions.contribute(ExtensionPoints.ACTIONS, id, ActionContribution("overlay.permission", meta("Allow drawing over other apps")) { _, _ -> overlay.openPermissionPage() })
        ctx.extensions.contribute(ExtensionPoints.ACTIONS, id, ActionContribution("overlay.stop", meta("Stop the overlay service")) { _, _ -> overlay.stop() })

        val d = OverlayEngine.normalize(runtime.assetOrNull(AssetTypes.OVERLAY)?.data)
        ctx.extensions.contribute(ExtensionPoints.SETTINGS, id, SettingsContribution(settingsGroup(d)))
    }

    override suspend fun start(ctx: ModuleContext) { if (showOnStart) overlay.show() }
    override suspend fun stop(ctx: ModuleContext) { if (::overlay.isInitialized) { overlay.stop(); if (AxfOverlay.current === overlay) AxfOverlay.current = null } }

    public companion object {
        public const val ID: String = "ai.amberx.axf.overlay"
        public const val SETTINGS_GROUP: String = "overlay"

        /** The Overlay settings group; defaults come from the active asset so the UI starts where the asset does. */
        public fun settingsGroup(d: OverlayData, module: String = ID): SettingsGroup = SettingsGroup(SETTINGS_GROUP, "Overlay", "layers", module, order = 45, description = "The floating pill drawn over other apps.", settings = listOf(
            SettingSpec("axf.overlay.show", "Show the overlay", SettingKind.ACTION, "Put the pill on screen now", target = "overlay.show", icon = "layers", slot = AssetTypes.OVERLAY),
            SettingSpec(OverlayEngine.Settings.OPACITY, "Opacity", SettingKind.SLIDER, "How see-through the pill is", JsonPrimitive(d.opacity), min = OverlayEngine.Limits.OPACITY_MIN, max = OverlayEngine.Limits.OPACITY_MAX, step = 0.05, slot = AssetTypes.OVERLAY),
            SettingSpec(OverlayEngine.Settings.POSITION_LOCK, "Lock position", SettingKind.TOGGLE, "The pill stays where it is (no dragging)", JsonPrimitive(d.positionLock), slot = AssetTypes.OVERLAY),
            SettingSpec(OverlayEngine.Settings.LOG, "Log panel", SettingKind.TOGGLE, "The tappable log under the pill", JsonPrimitive(d.log.show), slot = AssetTypes.OVERLAY),
            SettingSpec(OverlayEngine.Settings.STRIP, "Strip while hidden", SettingKind.TOGGLE, "The last few lines in the corner while the pill is hidden", JsonPrimitive(d.strip.show), slot = AssetTypes.OVERLAY),
            SettingSpec(OverlayEngine.Settings.MINI, "Mini screen open at start", SettingKind.TOGGLE, "Start with the mini screen expanded", JsonPrimitive(d.mini.defaultOpen), slot = AssetTypes.OVERLAY),
            SettingSpec(OverlayEngine.Settings.SIZE, "Mini screen size", SettingKind.TEXT, "width,height in dp (${d.mini.width.min}–${d.mini.width.max} × ${d.mini.height.min}–${d.mini.height.max}); blank = the asset's ${d.mini.width.default},${d.mini.height.default}", JsonPrimitive(""), slot = AssetTypes.OVERLAY),
            SettingSpec("axf.overlay.reset", "Reset position and size", SettingKind.ACTION, "Forget where the pill was dragged and how the mini screen was resized", target = "overlay.reset", icon = "refresh", slot = AssetTypes.OVERLAY),
            SettingSpec("axf.overlay.permission", "Allow drawing over other apps", SettingKind.ACTION, "Opens the system page where you grant it", target = "overlay.permission", icon = "unlock"),
        ))

        /** What isn't built yet: the web pill, Bubbles and picture-in-picture as hosts. */
        public fun placeholders(): List<PlaceholderModule> = listOf(
            PlaceholderModule("ai.amberx.axf.overlay.web", "Web overlay", listOf(Capability("axf.overlay.web", "The web port's corner pill inside the page (same asset, same engine)"))),
            PlaceholderModule("ai.amberx.axf.overlay.bubbles", "Bubbles host", listOf(Capability("axf.overlay.bubbles", "Android Bubbles as an alternative host for the pill"))),
            PlaceholderModule("ai.amberx.axf.overlay.pip", "Picture-in-picture host", listOf(Capability("axf.overlay.pip", "A picture-in-picture activity as the mini-screen host"))),
        )
    }
}
