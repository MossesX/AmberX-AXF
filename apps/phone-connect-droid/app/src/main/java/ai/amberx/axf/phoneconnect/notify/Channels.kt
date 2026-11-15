package ai.amberx.axf.phoneconnect.notify

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.os.Build
import org.json.JSONObject

/**
 * Notification channels, matching the console plugin's notify.json types (phone-connect.fyi / fix-update / alert /
 * approval), plus the two quiet ones for the running services. The per-type switches come from the console's settings
 * on every poll (Settings → Plugins → Phone Connect → Notifications); a switched-off type is never shown.
 */
object Channels {
    const val FYI = "fyi"
    const val FIX_UPDATES = "fix-update"
    const val ALERTS = "alert"
    const val APPROVALS = "approval"
    const val MONITOR = "monitor"
    const val RECORDER = "recorder"
    val TYPES = listOf(FYI, FIX_UPDATES, ALERTS, APPROVALS)

    private data class Spec(val id: String, val name: String, val importance: Int, val description: String)
    private val SPECS = listOf(
        Spec(FYI, "FYI", NotificationManager.IMPORTANCE_LOW, "Worth knowing, nothing to do."),
        Spec(FIX_UPDATES, "Fix updates", NotificationManager.IMPORTANCE_DEFAULT, "A fix landed or a build moved on."),
        Spec(ALERTS, "Alerts", NotificationManager.IMPORTANCE_HIGH, "Something broke or needs a look."),
        Spec(APPROVALS, "Approvals", NotificationManager.IMPORTANCE_HIGH, "A held call waits for you."),
        Spec(MONITOR, "Monitor running", NotificationManager.IMPORTANCE_MIN, "Shown while the phone watches for approvals."),
        Spec(RECORDER, "Recorder running", NotificationManager.IMPORTANCE_LOW, "Shown while the recorder records."),
    )

    fun ensure(context: Context) {
        if (Build.VERSION.SDK_INT < 26) return
        val nm = context.getSystemService(NotificationManager::class.java)
        for (s in SPECS) nm.createNotificationChannel(NotificationChannel(s.id, s.name, s.importance).apply {
            description = s.description
            lockscreenVisibility = android.app.Notification.VISIBILITY_PRIVATE
        })
    }

    /** The console's switches ({fyi, fix-update, alert, approval}: true|false), kept for [enabled]. */
    fun applySwitches(context: Context, notify: JSONObject?) {
        if (notify == null) return
        val e = prefs(context).edit()
        for (t in TYPES) if (notify.has(t)) e.putBoolean(t, notify.optBoolean(t, true))
        e.apply()
    }

    fun enabled(context: Context, type: String): Boolean = type !in TYPES || prefs(context).getBoolean(type, true)

    /** fyi | fix-update | alert | approval, from a command's kind; anything else is FYI. */
    fun typeOf(kind: String?): String = if (kind in TYPES) kind!! else FYI

    private fun prefs(context: Context) = context.getSharedPreferences("phone-connect.notify", Context.MODE_PRIVATE)
}
