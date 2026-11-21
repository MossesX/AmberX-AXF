package ai.amberx.axf.phoneconnect.watch

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import ai.amberx.axf.phoneconnect.MainActivity
import ai.amberx.axf.phoneconnect.link.LinkRules
import ai.amberx.axf.phoneconnect.link.LinkState
import ai.amberx.axf.phoneconnect.link.PhoneStore

/** The app's notification channels and the notifications the link shows. Every notification the console sends cleared its Notifications panel first. */
object Notifier {
    const val CH_LINK = "phone-connect.link"
    const val CH_OPEN = "phone-connect.open"
    const val CH_NOTIFY = "phone-connect.notify"
    const val CH_ALERT = "phone-connect.alert"
    const val CH_APPROVAL = "phone-connect.approval"
    const val ID_LINK = 1
    const val ID_REPAIR = 2

    fun channels(ctx: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val nm = ctx.getSystemService(NotificationManager::class.java) ?: return
        nm.createNotificationChannel(NotificationChannel(CH_LINK, "Link to the console", NotificationManager.IMPORTANCE_MIN))
        nm.createNotificationChannel(NotificationChannel(CH_OPEN, "Pages the console opens", NotificationManager.IMPORTANCE_HIGH))
        nm.createNotificationChannel(NotificationChannel(CH_NOTIFY, "Notes and fixes", NotificationManager.IMPORTANCE_DEFAULT))
        nm.createNotificationChannel(NotificationChannel(CH_ALERT, "Alerts", NotificationManager.IMPORTANCE_HIGH))
        nm.createNotificationChannel(NotificationChannel(CH_APPROVAL, "Approvals", NotificationManager.IMPORTANCE_HIGH))
    }

    fun linkNotification(ctx: Context, text: String) = NotificationCompat.Builder(ctx, CH_LINK)
        .setSmallIcon(android.R.drawable.stat_notify_sync).setContentTitle("Phone Connect").setContentText(text)
        .setOngoing(true).setOnlyAlertOnce(true).setContentIntent(appIntent(ctx)).build()

    fun appIntent(ctx: Context): PendingIntent = PendingIntent.getActivity(ctx, 0,
        Intent(ctx, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)

    /** A tap that opens [url] in the browser ([chrome]: Chrome when it is installed). */
    fun viewIntent(ctx: Context, url: String, request: Int, chrome: Boolean = false): PendingIntent = PendingIntent.getActivity(ctx, request,
        Pages.intent(ctx, url, chrome), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)

    /** A tap on Approve / Deny / Shelve: Brett's decision goes to the watch service, which sends it to the console. */
    fun decideIntent(ctx: Context, commandId: String, approvalId: String, decision: String): PendingIntent {
        val i = WatchService.decideIntent(ctx, commandId, approvalId, decision)
        val flags = PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        val request = idOf("$approvalId:$decision")
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) PendingIntent.getForegroundService(ctx, request, i, flags) else PendingIntent.getService(ctx, request, i, flags)
    }

    /** "Disconnected: tap to re-pair": the console refused this phone's key, so the link is over until it pairs again. */
    fun repairNotification(ctx: Context, why: String): android.app.Notification = NotificationCompat.Builder(ctx, CH_ALERT)
        .setSmallIcon(android.R.drawable.stat_notify_error).setContentTitle(LinkState.DISCONNECTED)
        .setContentText(why).setStyle(NotificationCompat.BigTextStyle().bigText("$why Approvals, pages and notifications don't arrive until it is paired again."))
        .setPriority(NotificationCompat.PRIORITY_HIGH).setCategory(NotificationCompat.CATEGORY_ERROR)
        .setContentIntent(appIntent(ctx)).setAutoCancel(true).build()

    /** What an approval notification turns into once Brett tapped: "Sending…", then the outcome. A tap opens it in the console. */
    fun approvalOutcome(ctx: Context, approvalId: String, text: String, done: Boolean): android.app.Notification {
        val b = NotificationCompat.Builder(ctx, CH_APPROVAL).setSmallIcon(android.R.drawable.ic_dialog_alert)
            .setContentTitle("Approval").setContentText(text).setStyle(NotificationCompat.BigTextStyle().bigText(text))
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE).setOnlyAlertOnce(true).setAutoCancel(true)
        LinkRules.consoleApproval(PhoneStore(ctx).origin, approvalId)?.let { b.setContentIntent(viewIntent(ctx, it, idOf(approvalId), chrome = true)) }
        if (!done) b.setProgress(0, 0, true)
        return b.build()
    }

    /** Posts one notification; false when Android won't let the app post (notifications off). */
    fun post(ctx: Context, id: Int, n: android.app.Notification): Boolean = try {
        if (!NotificationManagerCompat.from(ctx).areNotificationsEnabled()) false
        else { NotificationManagerCompat.from(ctx).notify(id, n); true }
    } catch (e: SecurityException) { false }

    fun idOf(commandId: String): Int = commandId.hashCode() and 0x7fffffff
}
