package ai.amberx.axf.overlay

import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.content.res.Configuration
import android.os.Build
import android.os.IBinder
import android.view.WindowManager
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import ai.amberx.axf.notifications.AxfNotifications
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch

/**
 * The foreground service (special use) that owns the overlay windows while the pill is shown: the pill window
 * (TYPE_APPLICATION_OVERLAY, draggable, touchable) and the strip window (untouchable, top-left) while the pill is hidden
 * but the strip is on. It decides nothing itself: it draws what [OverlayController] says, moves the window when the
 * position changes, applies the opacity, re-reads the config on asset swaps and settings changes, and stops when the
 * overlay is hidden with nothing left to show. Ported from the detection service's overlay half (the camera, the
 * trigger engine and the accessibility context stay in that app).
 *
 * Commands: [ACTION_SHOW] (default), [ACTION_HIDE], [ACTION_STOP]. A sticky restart with no module bound stops quietly.
 * Without the draw-over-apps permission the window add fails and the service stops; the module's `overlay.permission`
 * action opens the system page.
 */
public class OverlayService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var wm: WindowManager? = null
    private var pill: OverlayWindow? = null
    private var strip: OverlayWindow? = null
    private var bound: AxfOverlay? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        val o = AxfOverlay.current
        if (o == null) { stopSelf(); return }
        bound = o
        wm = getSystemService(WINDOW_SERVICE) as WindowManager
        if (!goForeground(o)) { stopSelf(); return }
        attachScreen(o)
        val c = o.controller
        scope.launch { o.runtime.compiled.collect { c.refreshConfig() } }
        scope.launch { o.kernel?.events?.events?.collect { e -> if (e.topic == "axf.settings.changed") c.refreshConfig() } }
        // what to draw: the pill while visible, the strip while hidden with the strip on and lines to show
        scope.launch {
            c.state.map { val showPill = it.visible && !it.hidden; Triple(showPill, it.config.strip.show && !showPill && !it.hidden, it.config.opacity) }.distinctUntilChanged().collect { (showPill, showStrip, opacity) ->
                if (showPill) showPill(o, opacity) else hidePill()
                if (showStrip && !showPill) showStrip(o, opacity) else hideStrip()
                if (!showPill && !showStrip) stopSelf()
            }
        }
        scope.launch { c.state.map { it.position }.distinctUntilChanged().collect { p -> pill?.update { x = p.x; y = p.y } } }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val o = bound ?: run { stopSelf(); return START_NOT_STICKY }
        when (intent?.action) {
            ACTION_HIDE -> o.controller.hide()
            ACTION_STOP -> { o.controller.hide(); stopSelf(); return START_NOT_STICKY }
            else -> if (intent != null) o.controller.show()   // a null intent is Android restarting us: keep what the state says
        }
        return START_STICKY
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        bound?.let { attachScreen(it) }
    }

    private fun attachScreen(o: AxfOverlay) {
        val dm = resources.displayMetrics
        o.controller.attachScreen(dm.widthPixels, dm.heightPixels, dm.density)
    }

    private fun showPill(o: AxfOverlay, opacity: Double) {
        val c = o.controller
        val w = pill ?: OverlayWindow(this, wm ?: return, OverlayWindow.pillParams(c.current.position.x, c.current.position.y, opacity.toFloat())).also { win ->
            win.setContent { OverlayRoot(o.runtime, o.kernel) { OverlayPill(c) } }
            pill = win
        }
        w.update { alpha = opacity.toFloat() }
        if (!w.added) {
            if (!o.canDraw() || !w.show()) {
                // no permission (or Android refused): the pill can't show; say so once and fall back to hidden
                o.runtime.terminal.once("overlay:no-permission", "overlay", "The overlay can't draw over other apps: grant \"Display over other apps\" (Settings → Overlay → Allow drawing over other apps).")
                c.hide()
                return
            }
        }
        c.setShown(true)
    }

    private fun hidePill() {
        pill?.destroy()
        pill = null
        bound?.controller?.setShown(false)
    }

    private fun showStrip(o: AxfOverlay, opacity: Double) {
        val w = strip ?: OverlayWindow(this, wm ?: return, OverlayWindow.stripParams(opacity.toFloat())).also { win ->
            win.setContent { OverlayRoot(o.runtime, o.kernel) { OverlayStrip(o.controller) } }
            strip = win
        }
        w.update { alpha = opacity.toFloat() }
        if (!w.added && o.canDraw()) w.show()
    }

    private fun hideStrip() { strip?.destroy(); strip = null }

    /** `startForeground` with the quiet ongoing notification. False when Android refused (a start from the background). */
    private fun goForeground(o: AxfOverlay): Boolean {
        val n = o.notification
        return try {
            AxfNotifications.channels(this, listOf(n.channel))
            val open = n.openActivity?.let { AxfNotifications.activityIntent(this, it, NOTIFICATION_ID) }
            val type = if (Build.VERSION.SDK_INT >= 34) ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE else 0
            ServiceCompat.startForeground(this, NOTIFICATION_ID, AxfNotifications.ongoing(this, n.ongoing(), open), type)
            true
        } catch (e: Exception) {
            false
        }
    }

    override fun onDestroy() {
        hidePill(); hideStrip()
        scope.cancel()
        bound = null
        super.onDestroy()
    }

    public companion object {
        public const val ACTION_SHOW: String = "ai.amberx.axf.overlay.SHOW"
        public const val ACTION_HIDE: String = "ai.amberx.axf.overlay.HIDE"
        public const val ACTION_STOP: String = "ai.amberx.axf.overlay.STOP"
        public const val NOTIFICATION_ID: Int = 4101

        public fun start(context: Context) { runCatching { ContextCompat.startForegroundService(context, Intent(context, OverlayService::class.java).setAction(ACTION_SHOW)) } }
        public fun hide(context: Context) { runCatching { context.startService(Intent(context, OverlayService::class.java).setAction(ACTION_HIDE)) } }
        public fun stop(context: Context) { runCatching { context.stopService(Intent(context, OverlayService::class.java)) } }
    }
}
