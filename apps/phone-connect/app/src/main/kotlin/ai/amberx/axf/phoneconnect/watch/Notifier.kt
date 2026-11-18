package ai.amberx.axf.phoneconnect.watch

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import ai.amberx.axf.phoneconnect.MainActivity

/** The app's notification channels and the notifications the link shows. Every notification the console sends cleared its Notifications panel first. */
object Notifier {
    const val CH_LINK = "phone-connect.link"
    const val CH_OPEN = "phone-connect.open"
    const val CH_NOTIFY = "phone-connect.notify"
    const val CH_ALERT = "phone-connect.alert"
    const val CH_APPROVAL = "phone-connect.approval"
    const val ID_LINK = 1

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

    fun viewIntent(ctx: Context, url: String, request: Int): PendingIntent = PendingIntent.getActivity(ctx, request,
        Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)

    /** Posts one notification; false when Android won't let the app post (notifications off). */
    fun post(ctx: Context, id: Int, n: android.app.Notification): Boolean = try {
        if (!NotificationManagerCompat.from(ctx).areNotificationsEnabled()) false
        else { NotificationManagerCompat.from(ctx).notify(id, n); true }
    } catch (e: SecurityException) { false }

    fun idOf(commandId: String): Int = commandId.hashCode() and 0x7fffffff
}
