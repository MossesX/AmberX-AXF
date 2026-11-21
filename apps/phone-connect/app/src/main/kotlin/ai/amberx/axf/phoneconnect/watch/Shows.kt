package ai.amberx.axf.phoneconnect.watch

import android.content.Context
import androidx.core.app.NotificationCompat
import ai.amberx.axf.phoneconnect.link.LinkRules
import ai.amberx.axf.phoneconnect.link.PhoneStore
import org.json.JSONObject

/**
 * notify.show and approval.show. Push without FCM: the watch service's link carries them.
 *
 * An approval is a high-priority notification with Approve and Deny (and Shelve on a countdown that offers it) on it.
 * A tap on an action is Brett's decision: it goes to the console over the device token as `by.kind: person` with a
 * fresh tap id (personOnly; the engine drops anything else), and the console passes it to the hub. The actions need
 * the phone unlocked, and the lock screen says only "Approval waiting". A tap on the body opens that approval in the
 * console. The app never decides by itself.
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

    private val ACTION_LABELS = mapOf("approve" to "Approve", "deny" to "Deny", "shelve" to "Shelve")

    private fun approval(ctx: Context, id: String, a: JSONObject): Outcome {
        val aid = a.optString("approvalId")
        val page = LinkRules.consoleApproval(PhoneStore(ctx).origin, aid) ?: return Outcome.Failed("validation", "An approval prompt needs its approval id.")
        val veto = a.optString("kind") == "veto"
        // one notification per approval: a prompt sent again replaces the first instead of stacking
        val nid = Notifier.idOf(aid)
        val open = Notifier.viewIntent(ctx, page, nid, chrome = true)
        val what = a.optString("title").ifBlank { a.optString("tool") }
        val title = if (veto) "Veto countdown: ${what.ifBlank { "a held call" }}" else "Approval waiting: ${what.ifBlank { "a request" }}"
        val left = a.optInt("secondsLeft", 0)
        val text = a.optString("summary").take(600) + if (left > 0) " (runs in ${left / 60} min ${left % 60} s unless you stop it)" else ""
        // the lock screen says only "Approval waiting"; the detail shows once unlocked
        val public = NotificationCompat.Builder(ctx, Notifier.CH_APPROVAL).setSmallIcon(android.R.drawable.ic_dialog_alert)
            .setContentTitle("Approval waiting").build()
        val b = NotificationCompat.Builder(ctx, Notifier.CH_APPROVAL).setSmallIcon(android.R.drawable.ic_dialog_alert)
            .setContentTitle(title).setContentText(text).setStyle(NotificationCompat.BigTextStyle().bigText(text))
            .setPriority(NotificationCompat.PRIORITY_HIGH).setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE).setPublicVersion(public)
            .setContentIntent(open).setAutoCancel(false)
        val actions = a.optJSONArray("actions")?.let { arr -> (0 until arr.length()).map { arr.optString(it) } } ?: listOf("approve", "deny")
        for (decision in LinkRules.DECISIONS) {
            if (decision !in actions) continue
            b.addAction(NotificationCompat.Action.Builder(0, ACTION_LABELS.getValue(decision), Notifier.decideIntent(ctx, id, aid, decision))
                .setAuthenticationRequired(true).build())
        }
        if (veto) {
            b.setFullScreenIntent(open, true)
            // once the countdown is over the hub has run it: the prompt goes by itself
            if (left > 0) b.setTimeoutAfter(left * 1000L)
        }
        // shown, not answered: the result is Brett's tap (WatchService.ACTION_DECIDE), or none at all
        return if (Notifier.post(ctx, nid, b.build())) Outcome.Pending("shown")
        else Outcome.Failed("consent_required", "Notifications are off for Phone Connect on this phone.")
    }
}
