package ai.amberx.axf.phoneconnect.overlay

import ai.amberx.axf.phoneconnect.SetupActivity
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.provider.Settings
import android.view.Gravity
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.lifecycle.LifecycleService
import androidx.lifecycle.lifecycleScope
import androidx.savedstate.SavedStateRegistry
import androidx.savedstate.SavedStateRegistryController
import androidx.savedstate.SavedStateRegistryOwner
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.launch

/**
 * Everything visible after setup. A floating always-on-top toolbar that collapses to a small draggable button
 * (remembers its spot and state, shows the badge count), and popups for approvals, alerts and notifications that are
 * acted on in place. Themed live by the console's skin. Other parts (approvals, monitor, commands, recorder) talk to
 * the overlay through [OverlayStore] and [OverlayService.actionHandler].
 */
class OverlayService : LifecycleService(), SavedStateRegistryOwner {
    private val savedController = SavedStateRegistryController.create(this)
    override val savedStateRegistry: SavedStateRegistry get() = savedController.savedStateRegistry
    private lateinit var windows: OverlayWindows
    private lateinit var store: OverlayStore
    private var collapseAt = 0L

    override fun onCreate() {
        savedController.performRestore(null)
        super.onCreate()
        store = OverlayStore.of(this)
        windows = OverlayWindows(this, this, this)
        startForegroundQuietly()
        if (!Settings.canDrawOverlays(this)) { stopSelf(); return }
        lifecycleScope.launch { combine(store.expanded, store.config) { e, c -> e to c }.collect { (e, c) -> drawBar(e, c) } }
        lifecycleScope.launch { store.popups.collect { drawPopups(it) } }
        lifecycleScope.launch {
            while (true) {
                kotlinx.coroutines.delay(1000)
                val c = store.config.value
                if (store.expanded.value && c.autoCollapseMs > 0 && System.currentTimeMillis() > collapseAt) store.setExpanded(false)
            }
        }
    }

    override fun onDestroy() { if (::windows.isInitialized) windows.hideAll(); super.onDestroy() }

    private fun touch() { collapseAt = System.currentTimeMillis() + store.config.value.autoCollapseMs }

    private fun drawBar(expanded: Boolean, config: OverlayConfig) {
        val screenW = resources.displayMetrics.widthPixels
        val px = (config.buttonSize * resources.displayMetrics.density).toInt()
        val x = store.spotX.takeIf { it != Int.MIN_VALUE } ?: (screenW - px)
        val y = store.spotY.takeIf { it != Int.MIN_VALUE } ?: (resources.displayMetrics.heightPixels / 3)
        val lp = windows.params(Gravity.TOP or Gravity.START, x, y)
        if (expanded) {
            touch()
            windows.show(BAR, lp) {
                val badge by store.badge.collectAsState()
                val build by buildStatus.collectAsState()
                FloatingToolbar(config, badge, build) { a -> touch(); onAction(a) }
            }
        } else {
            windows.show(BAR, lp) {
                val badge by store.badge.collectAsState()
                FloatingButton(config, badge, onTap = { store.setExpanded(true) },
                    onDrag = { dx, dy -> windows.position(BAR)?.let { (px0, py0) -> windows.move(BAR, (px0 + dx).toInt(), (py0 + dy).toInt()) } },
                    onDragEnd = {
                        windows.position(BAR)?.let { (px0, py0) ->
                            val sx = snapX(px0, px, screenW, config.edgeSnap)
                            windows.move(BAR, sx, py0); store.spotX = sx; store.spotY = py0
                        }
                    })
            }
        }
    }

    private fun drawPopups(list: List<Popup>) {
        val shown = list.map { it.id }.toSet()
        for (id in drawn - shown) windows.hide(POPUP + id)
        for (p in list) {
            if (p.id in drawn) continue
            val style = store.config.value.popup(if (p.kind == "approval" || p.kind == "alert") p.kind else "notification")
            val lp = if (style.position == "from-button") windows.params(Gravity.TOP or Gravity.START, store.spotX.coerceAtLeast(0), store.spotY.coerceAtLeast(0), focusable = false)
            else windows.params(OverlayWindows.gravityOf(style.position))
            windows.show(POPUP + p.id, lp) { PopupCard(p, style, onAction = { pp, a -> popupHandler(this, pp, a) }, onGone = { store.dismiss(it.id) }) }
            cue(style)
        }
        drawn.clear(); drawn.addAll(shown)
    }

    private val drawn = mutableSetOf<String>()

    /** The popup type's sound and vibration, as the console set them. */
    private fun cue(style: PopupStyle) {
        if (style.vibrate) runCatching {
            val v = if (Build.VERSION.SDK_INT >= 31) (getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as android.os.VibratorManager).defaultVibrator
            else @Suppress("DEPRECATION") (getSystemService(Context.VIBRATOR_SERVICE) as android.os.Vibrator)
            v.vibrate(android.os.VibrationEffect.createOneShot(120, android.os.VibrationEffect.DEFAULT_AMPLITUDE))
        }
        if (style.sound) runCatching {
            android.media.RingtoneManager.getRingtone(this, android.media.RingtoneManager.getDefaultUri(android.media.RingtoneManager.TYPE_NOTIFICATION))?.play()
        }
    }

    private fun onAction(a: String) {
        when (a) {
            "collapse" -> store.setExpanded(false)
            else -> actionHandler(this, a)
        }
    }

    private fun startForegroundQuietly() {
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= 26) nm.createNotificationChannel(NotificationChannel(CHANNEL, "Phone Connect overlay", NotificationManager.IMPORTANCE_MIN))
        val open = PendingIntent.getActivity(this, 0, Intent(this, SetupActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
        val n: Notification = NotificationCompat.Builder(this, CHANNEL).setSmallIcon(android.R.drawable.stat_notify_sync)
            .setContentTitle("Phone Connect").setContentText("Toolbar on").setOngoing(true).setPriority(NotificationCompat.PRIORITY_MIN)
            .setVisibility(NotificationCompat.VISIBILITY_SECRET).setContentIntent(open).build()
        ServiceCompat.startForeground(this, 1, n, if (Build.VERSION.SDK_INT >= 34) ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE else 0)
    }

    companion object {
        const val BAR = "bar"
        const val POPUP = "popup:"
        const val CHANNEL = "overlay"
        /** The latest build status for the toolbar's build widget ("green", "red" or ""), set by the command channel. */
        val buildStatus = kotlinx.coroutines.flow.MutableStateFlow("")
        /** Toolbar actions (approvals, recorder, notifications, open:…), wired by the parts that own them. */
        @Volatile var actionHandler: (Context, String) -> Unit = { _, _ -> }
        /** Popup actions (approve, deny, shelve, open, dismiss), wired by the approvals and notify parts. */
        @Volatile var popupHandler: (Context, Popup, String) -> Unit = { _, _, _ -> }

        fun start(context: Context) {
            val i = Intent(context, OverlayService::class.java)
            if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(i) else context.startService(i)
        }
    }
}
