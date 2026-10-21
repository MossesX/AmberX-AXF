package ai.amberx.axf.axhubandroid.watch

import android.app.Notification
import android.app.PendingIntent
import android.content.Context
import ai.amberx.axf.axhubandroid.MainActivity
import ai.amberx.axf.axhubandroid.R
import ai.amberx.axf.hub.HubApproval
import ai.amberx.axf.hub.WatchPrefs
import ai.amberx.axf.notifications.AlertSpec
import ai.amberx.axf.notifications.AxfNotifications
import ai.amberx.axf.notifications.ChannelImportance
import ai.amberx.axf.notifications.ChannelSpec
import ai.amberx.axf.notifications.LockScreen
import ai.amberx.axf.notifications.NoticeSpec
import ai.amberx.axf.notifications.OngoingSpec

/** AXHub's watcher settings live in the app's original preferences file, so saved values carry over. */
fun hubPrefs(context: Context): WatchPrefs = WatchPrefs(context, "axhub_watch")

/**
 * AXHub's notifications on top of lib-notifications: a quiet ongoing one while watching, and a loud one per new approval
 * that opens its page in the app (full screen when Android allows it). The lock screen only ever shows "Approval waiting";
 * the command itself appears after the phone is unlocked, and the app never shows over the lock screen.
 */
object Alerts {
    const val CH_WATCH = "axhub.watch"
    const val CH_APPROVAL = "axhub.approvals"
    const val EXTRA_APPROVAL = "axhub.approvalId"
    const val EXTRA_OPEN_LIST = "axhub.openApprovals"
    const val ID_WATCH = 1
    private const val ID_SIGNIN = 2

    val channelSpecs: List<ChannelSpec> = listOf(
        ChannelSpec(CH_WATCH, "Watching for approvals", ChannelImportance.MIN, "Shown while AXHub checks the hub", lockScreen = null, showBadge = false),
        ChannelSpec(CH_APPROVAL, "Approvals waiting", ChannelImportance.HIGH, "A call on axHub needs your approval", LockScreen.PRIVATE, vibrate = true),
    )

    fun channels(context: Context) = AxfNotifications.channels(context, channelSpecs)
    fun canPost(context: Context): Boolean = AxfNotifications.canPost(context)
    fun canFullScreen(context: Context): Boolean = AxfNotifications.canFullScreen(context)

    private fun openIntent(context: Context, requestCode: Int, approvalId: String?): PendingIntent =
        if (approvalId != null) AxfNotifications.activityIntent(context, MainActivity::class.java, requestCode, extras = mapOf(EXTRA_APPROVAL to approvalId))
        else AxfNotifications.activityIntent(context, MainActivity::class.java, requestCode, flags = mapOf(EXTRA_OPEN_LIST to true))

    fun watching(context: Context, waiting: Int, note: String? = null): Notification = AxfNotifications.ongoing(
        context,
        OngoingSpec(CH_WATCH, if (waiting > 0) "$waiting approval${if (waiting == 1) "" else "s"} waiting" else "Watching axHub", note ?: "Tap to open AXHub", R.drawable.ic_axhub_notify),
        openIntent(context, 0, null),
    )

    fun updateWatching(context: Context, waiting: Int, note: String? = null) = AxfNotifications.postOngoing(context, ID_WATCH, watching(context, waiting, note))

    /** The alert for one approval (pure apart from the icon id; tested in AlertsTest). */
    fun approvalSpec(a: HubApproval, fullScreen: Boolean): AlertSpec = AlertSpec(
        channel = CH_APPROVAL,
        tag = tag(a.id),
        title = "Approve ${a.tool}?",
        text = a.summary.lineSequence().firstOrNull()?.take(120) ?: "Tap to review",
        bigText = a.summary.take(400),
        smallIcon = R.drawable.ic_axhub_notify,
        publicTitle = "Approval waiting",
        publicText = "Unlock to review",
        fullScreen = fullScreen,
        actionLabel = "Review",
    )

    fun approval(context: Context, a: HubApproval, fullScreen: Boolean) {
        AxfNotifications.alert(context, approvalSpec(a, fullScreen), openIntent(context, a.id.hashCode(), a.id))
    }

    fun clearApproval(context: Context, id: String) = AxfNotifications.cancelTag(context, tag(id))

    /** Not urgent: on the quiet channel. [notAdmin] = signed in, but the account can't approve. */
    fun signedOut(context: Context, notAdmin: Boolean = false) {
        AxfNotifications.notice(context, NoticeSpec(
            CH_WATCH, ID_SIGNIN,
            if (notAdmin) "This hub account can't approve" else "Sign in to AXHub",
            if (notAdmin) "Sign in with an admin account (or finish the hub's password change)." else "Your hub session ended, so approvals can't be watched.",
            R.drawable.ic_axhub_notify,
        ), openIntent(context, ID_SIGNIN, null))
    }

    fun tag(id: String) = "approval:$id"
}
