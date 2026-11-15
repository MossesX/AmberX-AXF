package ai.amberx.axf.phoneconnect.commands

import ai.amberx.axf.phoneconnect.auth.ConsoleClient
import ai.amberx.axf.phoneconnect.auth.Session
import ai.amberx.axf.phoneconnect.notify.Channels
import ai.amberx.axf.phoneconnect.notify.Notifier
import ai.amberx.axf.phoneconnect.recorder.Recorder
import android.annotation.SuppressLint
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.Settings
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import org.json.JSONArray
import org.json.JSONObject

/**
 * The command channel: phone-connect@1 commands from the console's queue (delivered on the Monitor's poll), each run
 * and acked with a phone-result@1 ({deviceId, ok, data} or {deviceId, ok: false, error: {code, message}}).
 *   phone.open_url        bring Chrome (or the default browser) to the front on an amberxai.com https page; when
 *                         Android holds back a start from the background, a high-priority tap-to-open notification
 *   phone.notify          a notification on its channel (FYI, fix updates, alerts, approvals)
 *   phone.recorder_*      the Audio Output Recorder
 *   phone.approvals_watch the Monitor on or off
 */
object CommandRunner {
    fun runAll(context: Context, session: Session, commands: JSONArray?) {
        for (i in 0 until (commands?.length() ?: 0)) {
            val c = commands!!.optJSONObject(i) ?: continue
            val id = c.optString("id"); if (id.isBlank()) continue
            val result = runCatching { run(context, c) }.getOrElse { e -> err(if (e is IllegalArgumentException) "denied" else "unexpected", e.message ?: "failed") }
            runCatching { ConsoleClient(session).post("commands/$id/ack", result.put("deviceId", session.deviceId)) }
        }
    }

    fun run(context: Context, c: JSONObject): JSONObject {
        val args = c.optJSONObject("arguments") ?: JSONObject()
        return when (c.optString("tool")) {
            "phone.open_url" -> ok(JSONObject().put("opened", open(context, OpenUrlRules.allowed(args.optString("url")), OpenUrlRules.browserOf(args.optString("browser")))))
            "phone.notify" -> ok(JSONObject().put("shown", Notifier.show(context, c.optString("kind", kindOf(args)), args.optString("title"), args.optString("body"), args.optString("url"))))
            "phone.recorder_start" -> Recorder.start(context, args.optString("session_name"), args.optString("group"), args.optString("note"))
            "phone.recorder_stop" -> Recorder.stop(context)
            "phone.recorder_status" -> ok(Recorder.status(context))
            "phone.approvals_watch" -> ok(JSONObject().put("on", args.optBoolean("on", true)))
            else -> err("not_found", "This phone doesn't know ${c.optString("tool")}.")
        }
    }

    private fun kindOf(args: JSONObject) = when (args.optString("channel")) { "alerts" -> "alert"; "approvals" -> "approval"; else -> "fyi" }

    fun ok(data: JSONObject) = JSONObject().put("ok", true).put("data", data)
    fun err(code: String, message: String) = JSONObject().put("ok", false).put("error", JSONObject().put("code", code).put("message", message.take(600)))

    /** "browser" when it came to the front, "notification" when Android held the start back and a tap opens it. */
    @SuppressLint("MissingPermission")
    fun open(context: Context, url: String, browser: String): String {
        val view = Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)
        if (browser == "chrome" && runCatching { context.packageManager.getPackageInfo(OpenUrlRules.CHROME, 0) }.isSuccess) view.setPackage(OpenUrlRules.CHROME)
        // A foreground service may start an activity only with "display over other apps"; otherwise Android drops it.
        if (Settings.canDrawOverlays(context) && runCatching { context.startActivity(view) }.isSuccess) return "browser"
        val tap = PendingIntent.getActivity(context, url.hashCode(), view, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val n = NotificationCompat.Builder(context, Channels.ALERTS).setSmallIcon(android.R.drawable.ic_menu_view)
            .setContentTitle("Tap to open").setContentText(Uri.parse(url).host ?: url).setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_REMINDER).setAutoCancel(true).setContentIntent(tap)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE).build()
        NotificationManagerCompat.from(context).notify(url.hashCode(), n)
        return "notification"
    }
}
