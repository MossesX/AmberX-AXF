package ai.amberx.axf.axhubandroid.watch

import android.annotation.SuppressLint
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import ai.amberx.axf.axhubandroid.hub.Feed
import ai.amberx.axf.axhubandroid.hub.HubClient
import ai.amberx.axf.axhubandroid.hub.HubState
import ai.amberx.axf.axhubandroid.hub.WatchPrefs
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/**
 * Checks the hub's approvals feed every few seconds while watching is on, and alerts once per new
 * approval. Runs as a foreground service (special use: watching for approval requests) so it keeps going
 * with the screen off; stops itself when watching is turned off.
 */
class ApprovalWatchService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var loop: Job? = null
    private var signedOutAlerted = false

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        Alerts.channels(this)
        val type = if (Build.VERSION.SDK_INT >= 34) ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE else 0
        try {
            ServiceCompat.startForeground(this, Alerts.ID_WATCH, Alerts.watching(this, 0), type)
        } catch (e: Exception) {
            // Android may refuse a restart from the background (ForegroundServiceStartNotAllowedException): stop quietly.
            stopSelf(); return
        }
        HubState.setRunning(true)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val prefs = WatchPrefs(this)
        if (!prefs.watching || intent?.action == ACTION_STOP) { stopSelf(); return START_NOT_STICKY }
        if (intent?.action == ACTION_CHECK_NOW || loop?.isActive != true) { loop?.cancel(); loop = scope.launch { pollLoop(prefs) } }
        return START_STICKY
    }

    @SuppressLint("MissingPermission") // every notify() is behind Alerts.canPost()
    private suspend fun pollLoop(prefs: WatchPrefs) {
        while (scope.isActive) {
            if (!prefs.watching) { stopSelf(); return }
            val f = HubClient.feed(prefs.base)
            HubState.update(f)
            val nm = androidx.core.app.NotificationManagerCompat.from(this)
            when (f) {
                is Feed.Ok -> {
                    signedOutAlerted = false
                    val ids = f.pending.map { it.id }
                    prefs.gone(ids).forEach { Alerts.clearApproval(this, it) } // decided elsewhere or expired
                    val fresh = f.pending.filter { !prefs.alerted(it.id) }
                    fresh.forEach { Alerts.approval(this, it, prefs.fullScreen) }
                    prefs.markAlerted(fresh.map { it.id }, keepOnly = ids)
                    if (Alerts.canPost(this)) runCatching { nm.notify(Alerts.ID_WATCH, Alerts.watching(this, f.count)) }
                }
                Feed.SignedOut, Feed.NotAdmin -> {
                    if (!signedOutAlerted) { Alerts.signedOut(this, notAdmin = f == Feed.NotAdmin); signedOutAlerted = true }
                    if (Alerts.canPost(this)) runCatching { nm.notify(Alerts.ID_WATCH, Alerts.watching(this, 0, if (f == Feed.NotAdmin) "This account isn't a hub admin" else "Signed out of the hub")) }
                }
                is Feed.Error -> if (Alerts.canPost(this)) runCatching { nm.notify(Alerts.ID_WATCH, Alerts.watching(this, 0, "Can't reach the hub right now")) }
            }
            // Signed out: nothing to watch until a sign-in, so check rarely (the app also checks on every open).
            delay(if (f == Feed.SignedOut || f == Feed.NotAdmin) SIGNED_OUT_MS else prefs.intervalSec * 1000L)
        }
    }

    override fun onDestroy() {
        HubState.setRunning(false)
        scope.cancel()
        super.onDestroy()
    }

    companion object {
        const val ACTION_STOP = "ai.amberx.axf.axhubandroid.STOP_WATCH"
        const val ACTION_CHECK_NOW = "ai.amberx.axf.axhubandroid.CHECK_NOW"
        private const val SIGNED_OUT_MS = 5 * 60_000L

        fun start(context: Context, checkNow: Boolean = false) {
            val i = Intent(context, ApprovalWatchService::class.java).apply { if (checkNow) action = ACTION_CHECK_NOW }
            runCatching { ContextCompat.startForegroundService(context, i) }
        }
        fun stop(context: Context) { context.stopService(Intent(context, ApprovalWatchService::class.java)) }
    }
}

/** Starts watching again after a restart (or an app update) when watching is on. */
class WatchBootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED && intent.action != Intent.ACTION_MY_PACKAGE_REPLACED) return
        if (WatchPrefs(context).watching) ApprovalWatchService.start(context)
    }
}
