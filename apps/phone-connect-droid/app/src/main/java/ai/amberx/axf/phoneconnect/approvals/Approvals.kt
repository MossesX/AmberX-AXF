package ai.amberx.axf.phoneconnect.approvals

import ai.amberx.axf.phoneconnect.auth.HubRules
import ai.amberx.axf.phoneconnect.auth.Session
import ai.amberx.axf.phoneconnect.notify.Channels
import ai.amberx.axf.phoneconnect.overlay.OverlayStore
import ai.amberx.axf.phoneconnect.overlay.Popup
import android.annotation.SuppressLint
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat

/**
 * Approvals on the phone: every waiting one pops up in the overlay with its reason (title + description) and its
 * buttons, and is decided right there with Brett's own hub session (Approve / Deny; a held veto call: Deny, Approve
 * now, Shelve). The notification behind it shows only "Approval waiting" on the lock screen.
 */
object Approvals {
    private val shown = mutableMapOf<String, Approval>()

    /** The feed, read with the phone's session. */
    fun read(context: Context): Feed {
        val s = Session.of(context)
        val r = runCatching { HubRules.request("GET", HubRules.HUB + HubRules.FEED_PATH, s.cookie()) }.getOrNull() ?: return Feed("unreachable", emptyList())
        return ApprovalFeed.parse(r.status, r.body)
    }

    /** New approvals pop up; decided or gone ones leave; the badge is the count. */
    fun show(context: Context, feed: Feed) {
        if (feed.status != "ok") return
        val store = OverlayStore.of(context)
        val ids = feed.items.map { it.id }.toSet()
        for (gone in shown.keys - ids) { store.dismiss(gone); NotificationManagerCompat.from(context).cancel(gone.hashCode()) }
        for (a in feed.items) if (a.id !in shown) {
            store.show(Popup(a.id, "approval", a.title, a.why + if (a.held && a.secondsLeft > 0) "\nRuns in ${a.secondsLeft}s unless you deny it." else "",
                actions = a.actions.map { if (it == "approve-now") "approve" else it }))
            notify(context, a)
        }
        shown.clear(); feed.items.associateByTo(shown) { it.id }
        store.setBadge(feed.items.size)
    }

    /** A popup's button: decided with the phone's own hub session. True when the hub took it. */
    fun decide(context: Context, id: String, action: String): Boolean {
        val a = shown[id] ?: return false
        val hubAction = ApprovalFeed.hubAction(a, action) ?: return false
        val s = Session.of(context)
        val csrf = s.csrf() ?: return false
        val ok = runCatching {
            if (a.held) HubRules.request("POST", HubRules.vetoActionUrl(id, hubAction)!!, s.cookie(), "{}", csrf).status == 200
            else {
                val r = HubRules.request("POST", HubRules.approvalApiUrl(id)!!, s.cookie(), "{\"action\":\"${if (hubAction == "deny") "decline" else "approve"}\"}", csrf)
                if (hubAction == "approve") HubRules.approvedReply(r.status, r.body) else HubRules.declinedReply(r.status, r.body)
            }
        }.getOrDefault(false)
        if (ok) { shown.remove(id); OverlayStore.of(context).dismiss(id); OverlayStore.of(context).setBadge(shown.size); NotificationManagerCompat.from(context).cancel(id.hashCode()) }
        return ok
    }

    fun current(): List<Approval> = shown.values.toList()

    /** Re-show every waiting approval (the toolbar's Approvals button). */
    fun showAll(context: Context) {
        val store = OverlayStore.of(context)
        for (a in shown.values) store.show(Popup(a.id, "approval", a.title, a.why, actions = a.actions.map { if (it == "approve-now") "approve" else it }))
    }

    @SuppressLint("MissingPermission")
    private fun notify(context: Context, a: Approval) {
        if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) return
        val open = PendingIntent.getActivity(context, a.id.hashCode(), Intent(context, ai.amberx.axf.phoneconnect.SetupActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
        NotificationManagerCompat.from(context).notify(a.id.hashCode(), lockScreenSafe(context, Channels.APPROVALS, a.title, a.why).setContentIntent(open).build())
    }

    /**
     * The lock screen shows only "Approval waiting": the content is private and its public version names nothing
     * (LockScreen.publicText). VISIBILITY_SECRET would hide even that line, so the content is VISIBILITY_PRIVATE with the
     * public version, which is what Android shows on a locked screen.
     */
    fun lockScreenSafe(context: Context, channel: String, title: String, text: String): NotificationCompat.Builder {
        val public = NotificationCompat.Builder(context, channel).setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle(LockScreen.publicText(channel)).build()
        return NotificationCompat.Builder(context, channel).setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle(title).setContentText(text).setStyle(NotificationCompat.BigTextStyle().bigText(text))
            .setVisibility(LockScreen.visibility(channel)).setPublicVersion(public)
            .setCategory(NotificationCompat.CATEGORY_REMINDER).setPriority(NotificationCompat.PRIORITY_HIGH).setAutoCancel(true)
    }
}

/** What the lock screen may show. Pure, unit tested. */
object LockScreen {
    fun publicText(channel: String): String = when (channel) {
        Channels.APPROVALS -> "Approval waiting"
        Channels.ALERTS -> "Alert"
        else -> "Phone Connect"
    }

    /** Every channel is private: locked, only the public version shows, so no title, tool or reason is ever on the lock screen. */
    fun visibility(@Suppress("UNUSED_PARAMETER") channel: String): Int = NotificationCompat.VISIBILITY_PRIVATE
}
