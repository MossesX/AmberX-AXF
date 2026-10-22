package ai.amberx.axf.patches.watch

import android.app.Notification
import android.app.PendingIntent
import android.content.Context
import ai.amberx.axf.hub.HubApproval
import ai.amberx.axf.hub.WatchPrefs
import ai.amberx.axf.kernel.engine.EmbedMessage
import ai.amberx.axf.notifications.AlertSpec
import ai.amberx.axf.notifications.AxfNotifications
import ai.amberx.axf.notifications.ChannelImportance
import ai.amberx.axf.notifications.ChannelSpec
import ai.amberx.axf.notifications.LockScreen
import ai.amberx.axf.notifications.NoticeSpec
import ai.amberx.axf.notifications.OngoingSpec
import ai.amberx.axf.patches.MainActivity
import ai.amberx.axf.patches.R

/** Patches' watcher state (hub address, seen approvals, interval) in its own preferences file. */
fun patchesPrefs(context: Context): WatchPrefs = WatchPrefs(context, "patches_watch")

/**
 * Patches serves the phone's notifications for the Console, Pilot and axHub (Brett, Oct 21 2026), on lib-notifications:
 * a quiet ongoing one while it watches, approvals waiting on the hub (loud, private on the lock screen, full screen when
 * allowed), the console's alerts (CI, deploys, builds, systems check: errors loud, the rest quiet) and whatever an app
 * in a tab sends while it's open (embed@1 `notify`). Tapping opens Patches on the right tab.
 */
object PatchesAlerts {
    const val CH_WATCH = "patches.watch"
    const val CH_APPROVAL = "patches.approvals"
    const val CH_ALERT = "patches.alerts"
    const val CH_APPS = "patches.apps"
    const val EXTRA_TAB = "patches.tab"
    const val EXTRA_APPROVAL = "patches.approvalId"
    const val ID_WATCH = 11
    private const val ID_SIGNIN = 12

    val channelSpecs: List<ChannelSpec> = listOf(
        ChannelSpec(CH_WATCH, "Watching", ChannelImportance.MIN, "Shown while Patches watches the hub and the console", lockScreen = null, showBadge = false),
        ChannelSpec(CH_APPROVAL, "Approvals waiting", ChannelImportance.HIGH, "A call on axHub needs your approval", LockScreen.PRIVATE, vibrate = true),
        ChannelSpec(CH_ALERT, "Console alerts", ChannelImportance.HIGH, "Builds, CI, deploys and systems check from the Dev Console", LockScreen.PRIVATE, vibrate = true),
        ChannelSpec(CH_APPS, "From the apps", ChannelImportance.DEFAULT, "What the Console, Pilot or axHub send while open in Patches", LockScreen.PRIVATE),
    )

    private fun open(context: Context, requestCode: Int, tab: String, approvalId: String? = null): PendingIntent =
        AxfNotifications.activityIntent(context, MainActivity::class.java, requestCode, extras = buildMap { put(EXTRA_TAB, tab); if (approvalId != null) put(EXTRA_APPROVAL, approvalId) })

    fun watching(context: Context, waiting: Int, alerts: Int, note: String? = null): Notification = AxfNotifications.ongoing(
        context,
        OngoingSpec(
            CH_WATCH,
            when {
                waiting > 0 -> "$waiting approval${if (waiting == 1) "" else "s"} waiting"
                alerts > 0 -> "$alerts console alert${if (alerts == 1) "" else "s"}"
                else -> "Patches is watching"
            },
            note ?: "axHub approvals and console alerts", R.drawable.ic_patches_notify,
        ),
        open(context, 0, "console"),
    )

    fun approval(context: Context, a: HubApproval, fullScreen: Boolean) = AxfNotifications.alert(context, AlertSpec(
        channel = CH_APPROVAL, tag = "approval:${a.id}", title = "Approve ${a.tool}?",
        text = a.summary.lineSequence().firstOrNull()?.take(120) ?: "Tap to review", bigText = a.summary.take(400),
        smallIcon = R.drawable.ic_patches_notify, publicTitle = "Approval waiting", publicText = "Unlock to review",
        fullScreen = fullScreen, actionLabel = "Review",
    ), open(context, a.id.hashCode(), "axhub", a.id))

    fun clearApproval(context: Context, id: String) = AxfNotifications.cancelTag(context, "approval:$id")

    /** A console alert (alert@1 from `/api/alerts`): errors on the loud channel, warnings too; info stays in the console. */
    fun consoleAlert(context: Context, key: String, title: String, body: String?, severity: String) = AxfNotifications.alert(context, AlertSpec(
        channel = CH_ALERT, tag = "alert:$key", title = title.take(120), text = body?.lineSequence()?.firstOrNull()?.take(120) ?: severity.replaceFirstChar { it.uppercase() },
        bigText = body?.take(400), smallIcon = R.drawable.ic_patches_notify, publicTitle = "Console alert", publicText = "Unlock to read",
        fullScreen = false, actionLabel = "Open",
    ), open(context, key.hashCode(), "console"))

    fun clearConsoleAlert(context: Context, key: String) = AxfNotifications.cancelTag(context, "alert:$key")

    /** What an app in a tab sent (embed@1 `notify`), checked and capped by the kernel before it gets here. */
    fun fromApp(context: Context, tab: String, label: String, m: EmbedMessage.Notify) = AxfNotifications.alert(context, AlertSpec(
        channel = if (m.level == "error" || m.level == "warning") CH_ALERT else CH_APPS,
        tag = "app:$tab:${m.tag ?: m.title.hashCode()}", title = "$label: ${m.title}", text = m.body ?: m.title,
        bigText = m.body, smallIcon = R.drawable.ic_patches_notify, publicTitle = label, publicText = "Unlock to read",
        fullScreen = false, actionLabel = "Open",
    ), open(context, (tab + m.title).hashCode(), tab))

    fun signedOut(context: Context, notAdmin: Boolean = false) = AxfNotifications.notice(context, NoticeSpec(
        CH_WATCH, ID_SIGNIN,
        if (notAdmin) "This hub account can't approve" else "Sign in to the hub in Patches",
        if (notAdmin) "Sign in with an admin account to get approvals." else "Your hub session ended, so approvals and alerts can't be watched.",
        R.drawable.ic_patches_notify,
    ), open(context, ID_SIGNIN, "axhub"))
}
