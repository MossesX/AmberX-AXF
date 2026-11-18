package ai.amberx.axf.phoneconnect.watch

import android.content.Context
import androidx.core.app.NotificationCompat
import ai.amberx.axf.phoneconnect.link.LinkRules
import ai.amberx.axf.phoneconnect.link.PhoneStore
import org.json.JSONObject

/**
 * notify.show and approval.show. Push without FCM: the watch service's link carries them. An approval is only ever
 * *shown* here: Approve and Deny open the hub's own approval page (rebuilt from the id, Brett's hub session there, the
 * hub's Origin + CSRF checks). The app never sends a decision over its device token.
 */
object Shows {
    fun register() {
        Commands.register("notify.show") { ctx, id, args -> notify(ctx, id, args) }
        Commands.register("approval.show") { ctx, id, args -> approval(ctx, id, args) }
    }

    private fun notify(ctx: Context, id: String, a: JSONObject): Outcome {
        val title = a.optString("title").take(120)
        if (title.isBlank()) return Outcome.Failed("validation", "A notification needs a title.")
        val kind = a.optString("kind", "fyi")
        val high = kind == "alert" || a.optString("priority") == "high"
        val url = a.optString("url").takeIf { LinkRules.openable(it) }
        val tap = if (url != null) Notifier.viewIntent(ctx, url, Notifier.idOf(id)) else Notifier.appIntent(ctx)
        val n = NotificationCompat.Builder(ctx, if (kind == "alert") Notifier.CH_ALERT else Notifier.CH_NOTIFY)
            .setSmallIcon(if (kind == "alert") android.R.drawable.stat_notify_error else android.R.drawable.stat_notify_chat)
            .setContentTitle(title).setContentText(a.optString("body").take(600))
            .setStyle(NotificationCompat.BigTextStyle().bigText(a.optString("body").take(600)))
            .setPriority(if (high) NotificationCompat.PRIORITY_HIGH else NotificationCompat.PRIORITY_DEFAULT)
            .setContentIntent(tap).setAutoCancel(true).build()
        return if (Notifier.post(ctx, Notifier.idOf(id), n)) Outcome.Done(JSONObject().put("shown", true))
        else Outcome.Failed("consent_required", "Notifications are off for Phone Connect on this phone.")
    }

    private fun approval(ctx: Context, id: String, a: JSONObject): Outcome {
        val aid = a.optString("approvalId")
        val page = LinkRules.approvalPage(PhoneStore(ctx).hub, aid) ?: return Outcome.Failed("validation", "An approval prompt needs its approval id.")
        val veto = a.optString("kind") == "veto"
        val open = Notifier.viewIntent(ctx, page, Notifier.idOf(id))
        val title = if (veto) "Veto countdown: ${a.optString("tool").ifBlank { "a held call" }}" else "Approval waiting: ${a.optString("tool").ifBlank { "a request" }}"
        val left = a.optInt("secondsLeft", 0)
        val text = a.optString("summary").take(600) + if (left > 0) " (runs in ${left / 60} min ${left % 60} s unless you stop it)" else ""
        // the lock screen says only "Approval waiting"; the detail shows once unlocked
        val public = NotificationCompat.Builder(ctx, Notifier.CH_APPROVAL).setSmallIcon(android.R.drawable.ic_dialog_alert)
            .setContentTitle("Approval waiting").build()
        val b = NotificationCompat.Builder(ctx, Notifier.CH_APPROVAL).setSmallIcon(android.R.drawable.ic_dialog_alert)
            .setContentTitle(title).setContentText(text).setStyle(NotificationCompat.BigTextStyle().bigText(text))
            .setPriority(NotificationCompat.PRIORITY_HIGH).setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE).setPublicVersion(public)
            .setContentIntent(open).setAutoCancel(true)
        val actions = a.optJSONArray("actions")?.let { arr -> (0 until arr.length()).map { arr.optString(it) } } ?: listOf("approve", "deny")
        // every action opens the hub page: the decision is made there, by Brett, never by this app
        if ("approve" in actions) b.addAction(0, "Approve", Notifier.viewIntent(ctx, page, Notifier.idOf("$id:approve")))
        if ("deny" in actions) b.addAction(0, "Deny", Notifier.viewIntent(ctx, page, Notifier.idOf("$id:deny")))
        if (veto) b.setFullScreenIntent(open, true)
        return if (Notifier.post(ctx, Notifier.idOf(id), b.build())) Outcome.Done(JSONObject().put("shown", true).put("page", "hub"))
        else Outcome.Failed("consent_required", "Notifications are off for Phone Connect on this phone.")
    }
}
