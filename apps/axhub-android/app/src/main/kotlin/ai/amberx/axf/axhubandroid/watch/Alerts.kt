package ai.amberx.axf.axhubandroid.watch

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import ai.amberx.axf.axhubandroid.MainActivity
import ai.amberx.axf.axhubandroid.R
import ai.amberx.axf.axhubandroid.hub.PendingApproval

/**
 * Notifications: a quiet ongoing one while watching, and a loud one per new approval that opens its page
 * in the app (full screen when Android allows it). The lock screen only ever shows "Approval waiting";
 * the command itself appears after the phone is unlocked, and the app never shows over the lock screen.
 */
object Alerts {
    const val CH_WATCH = "axhub.watch"
    const val CH_APPROVAL = "axhub.approvals"
    const val EXTRA_APPROVAL = "axhub.approvalId"
    const val EXTRA_OPEN_LIST = "axhub.openApprovals"
    const val ID_WATCH = 1
    private const val ID_SIGNIN = 2

    fun channels(context: Context) {
        val nm = context.getSystemService(NotificationManager::class.java) ?: return
        nm.createNotificationChannel(NotificationChannel(CH_WATCH, "Watching for approvals", NotificationManager.IMPORTANCE_MIN).apply {
            description = "Shown while AXHub checks the hub"; setShowBadge(false)
        })
        nm.createNotificationChannel(NotificationChannel(CH_APPROVAL, "Approvals waiting", NotificationManager.IMPORTANCE_HIGH).apply {
            description = "A call on axHub needs your approval"; enableVibration(true); lockscreenVisibility = Notification.VISIBILITY_PRIVATE
        })
    }

    fun canPost(context: Context): Boolean = Build.VERSION.SDK_INT < 33 || ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

    /** Android 14+ asks the user to allow full-screen alerts per app. */
    fun canFullScreen(context: Context): Boolean = Build.VERSION.SDK_INT < 34 || context.getSystemService(NotificationManager::class.java)?.canUseFullScreenIntent() == true

    private fun openIntent(context: Context, requestCode: Int, approvalId: String?): PendingIntent {
        val i = Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        if (approvalId != null) i.putExtra(EXTRA_APPROVAL, approvalId) else i.putExtra(EXTRA_OPEN_LIST, true)
        return PendingIntent.getActivity(context, requestCode, i, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }

    fun watching(context: Context, waiting: Int, note: String? = null): Notification =
        NotificationCompat.Builder(context, CH_WATCH)
            .setSmallIcon(R.drawable.ic_axhub_notify)
            .setContentTitle(if (waiting > 0) "$waiting approval${if (waiting == 1) "" else "s"} waiting" else "Watching axHub")
            .setContentText(note ?: "Tap to open AXHub")
            .setOngoing(true).setOnlyAlertOnce(true).setSilent(true)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setContentIntent(openIntent(context, 0, null))
            .build()

    fun approval(context: Context, a: PendingApproval, fullScreen: Boolean) {
        if (!canPost(context)) return
        val open = openIntent(context, a.id.hashCode(), a.id)
        val public = NotificationCompat.Builder(context, CH_APPROVAL).setSmallIcon(R.drawable.ic_axhub_notify).setContentTitle("Approval waiting").setContentText("Unlock to review").build()
        val n = NotificationCompat.Builder(context, CH_APPROVAL)
            .setSmallIcon(R.drawable.ic_axhub_notify)
            .setContentTitle("Approve ${a.tool}?")
            .setContentText(a.summary.lineSequence().firstOrNull()?.take(120) ?: "Tap to review")
            .setStyle(NotificationCompat.BigTextStyle().bigText(a.summary.take(400)))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE).setPublicVersion(public)
            .setAutoCancel(true)
            .setContentIntent(open)
            .addAction(0, "Review", open)
            .apply { if (fullScreen && canFullScreen(context)) setFullScreenIntent(open, true) }
            .build()
        runCatching { NotificationManagerCompat.from(context).notify(tag(a.id), 0, n) }
    }

    fun clearApproval(context: Context, id: String) { NotificationManagerCompat.from(context).cancel(tag(id), 0) }

    fun signedOut(context: Context) {
        if (!canPost(context)) return
        val n = NotificationCompat.Builder(context, CH_APPROVAL)
            .setSmallIcon(R.drawable.ic_axhub_notify).setContentTitle("Sign in to AXHub")
            .setContentText("Your hub session ended, so approvals can't be watched.")
            .setAutoCancel(true).setContentIntent(openIntent(context, ID_SIGNIN, null)).build()
        runCatching { NotificationManagerCompat.from(context).notify(ID_SIGNIN, n) }
    }

    private fun tag(id: String) = "approval:$id"
}
