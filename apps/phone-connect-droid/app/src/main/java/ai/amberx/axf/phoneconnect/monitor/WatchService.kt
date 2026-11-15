package ai.amberx.axf.phoneconnect.monitor

import ai.amberx.axf.phoneconnect.approvals.Approvals
import ai.amberx.axf.phoneconnect.auth.ConsoleClient
import ai.amberx.axf.phoneconnect.auth.HubRules
import ai.amberx.axf.phoneconnect.auth.Session
import ai.amberx.axf.phoneconnect.commands.CommandRunner
import ai.amberx.axf.phoneconnect.notify.Channels
import ai.amberx.axf.phoneconnect.overlay.OverlayStore
import ai.amberx.axf.phoneconnect.recorder.RecorderState
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleService
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import org.json.JSONObject

/**
 * Monitor: the phone watches with the screen off. One loop, every 15 s (backoff on failures, a minute when signed out):
 *   1. the console poll (devices/<id>/next): heartbeat, queued commands, settings, the auto-approval rules, the overlay config;
 *   2. axHub's approvals feed: new ones pop up and notify; a rule that covers one approves it (never destructive,
 *      personOnly, recorder_start or vps.run);
 * with a persistent low-priority notification while it runs. Switched off from the console (setting `monitor`).
 */
class WatchService : LifecycleService() {
    private var failures = 0
    @Volatile private var rules: AutoRules = AutoRules.NONE

    override fun onCreate() {
        super.onCreate()
        Channels.ensure(this)
        val open = PendingIntent.getActivity(this, 0, Intent(this, ai.amberx.axf.phoneconnect.SetupActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
        val n = NotificationCompat.Builder(this, Channels.MONITOR).setSmallIcon(android.R.drawable.stat_notify_sync)
            .setContentTitle("Monitor on").setContentText("Watching for approvals and alerts").setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW).setVisibility(NotificationCompat.VISIBILITY_SECRET).setContentIntent(open).build()
        ServiceCompat.startForeground(this, 2, n, if (Build.VERSION.SDK_INT >= 34) ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC else 0)
        lifecycleScope.launch(Dispatchers.IO) { loop() }
    }

    private suspend fun loop() {
        val session = Session.of(this)
        while (lifecycleScope.isActive) {
            if (!session.isSignedIn() || !session.isPaired()) { delay(HubRules.AUTH_RETRY_MS); continue }
            val wait = runCatching { round(session) }.getOrElse { failures++; HubRules.backoff(failures) }
            delay(wait)
        }
    }

    /** One round; the delay before the next. */
    private fun round(session: Session): Long {
        val state = JSONObject().put("recorder@1", RecorderState.of(this).report())
        val r = ConsoleClient(session).post("devices/${session.deviceId}/next", session.hello(state = state))
        val (verdict, wait) = HubRules.afterStatus(r.status, failures)
        if (verdict == "signed-out") { session.refresh(); return wait }
        if (r.status == 403 || r.status == 409) { session.unpaired(); return HubRules.AUTH_RETRY_MS }
        if (verdict != "ok") { failures++; return wait }
        failures = 0
        val j = JSONObject(r.body)
        val settings = j.optJSONObject("settings")
        rules = AutoRules.parse(j.optJSONObject("rules"))
        settings?.optJSONObject("overlay")?.let { OverlayStore.of(this).applyConfig(it) }
        settings?.let { Channels.applySwitches(this, it.optJSONObject("notify")) }
        CommandRunner.runAll(this, session, j.optJSONArray("commands"))
        if (settings?.optBoolean("monitor", true) == false) { stopSelf(); return ROUND_MS }

        val feed = Approvals.read(this)
        if (feed.status == "signed-out") session.refresh()
        val auto = feed.items.filter { rules.approves(it) != null }.map { it.id }.toSet()
        Approvals.show(this, feed, quiet = auto)
        for (id in auto) Approvals.decide(this, id, "approve")
        return ROUND_MS
    }

    companion object {
        const val ROUND_MS = 15_000L
        fun start(context: Context) = ContextCompat.startForegroundService(context, Intent(context, WatchService::class.java))
    }
}

/** After a reboot or an app update: the Monitor and the overlay come back for a set-up phone. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED && intent.action != Intent.ACTION_MY_PACKAGE_REPLACED) return
        val s = Session.of(context)
        if (!s.isSignedIn() || !s.isPaired()) return
        WatchService.start(context)
        if (android.provider.Settings.canDrawOverlays(context)) ai.amberx.axf.phoneconnect.overlay.OverlayService.start(context)
    }
}
