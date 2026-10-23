package ai.amberx.axf.notifications

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
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
import ai.amberx.axf.kernel.alerts.AlertChange

/**
 * lib-notifications: channels, permission checks and the notification shapes AXF apps need, with the privacy rules built in.
 *
 * - [canPost]: POST_NOTIFICATIONS on Android 13+ (every post checks it first and does nothing without it);
 * - [canFullScreen]: Android 14+ asks the user to allow full-screen alerts per app;
 * - [ongoing]: the quiet "watching" notification for a foreground service;
 * - [alert]: a high-priority alert whose lock-screen version is only its public text (e.g. "Approval waiting"); full screen
 *   only when asked and allowed. Never shows the app over the lock screen (no `setShowWhenLocked` / turn-screen-on here);
 * - [notice]: a quiet one-off on a quiet channel; [cancel] / [cancelTag]: by id or by tag.
 * - [deliverAlert]: the hook for alert@1 deliveries (see [AlertNotifications]).
 *
 * Stateless; every call takes a [Context]. Registered by [NotificationsModule] as `axf.notifications`.
 */
public object AxfNotifications {

    /** Creates (or keeps) the given channels. Safe to call often; Android keeps the user's own changes. */
    public fun channels(context: Context, specs: List<ChannelSpec>) {
        val nm = context.getSystemService(NotificationManager::class.java) ?: return
        for (s in specs) {
            val ch = NotificationChannel(s.id, s.name, importance(s.importance))
            ch.description = s.description
            ch.setShowBadge(s.showBadge)
            ch.enableVibration(s.vibrate)
            s.lockScreen?.let { ch.lockscreenVisibility = visibility(it) }
            nm.createNotificationChannel(ch)
        }
    }

    public fun canPost(context: Context): Boolean =
        Build.VERSION.SDK_INT < 33 || ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

    /** Android 14+ asks the user to allow full-screen alerts per app. */
    public fun canFullScreen(context: Context): Boolean =
        Build.VERSION.SDK_INT < 34 || context.getSystemService(NotificationManager::class.java)?.canUseFullScreenIntent() == true

    /** Opens [activity] (new task, clear top, single top) with [extras]; immutable. */
    public fun activityIntent(context: Context, activity: Class<out Activity>, requestCode: Int, extras: Map<String, String> = emptyMap(), flags: Map<String, Boolean> = emptyMap()): PendingIntent {
        val i = Intent(context, activity).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        extras.forEach { (k, v) -> i.putExtra(k, v) }
        flags.forEach { (k, v) -> i.putExtra(k, v) }
        return PendingIntent.getActivity(context, requestCode, i, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }

    /** The ongoing, silent notification for a foreground service (pass it to `startForeground`, or [postOngoing] to update it). */
    public fun ongoing(context: Context, spec: OngoingSpec, open: PendingIntent?): Notification =
        NotificationCompat.Builder(context, spec.channel)
            .setSmallIcon(spec.smallIcon)
            .setContentTitle(spec.title)
            .setContentText(spec.text)
            .setOngoing(true).setOnlyAlertOnce(true).setSilent(true)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .apply { if (open != null) setContentIntent(open) }
            .build()

    /** Replaces the ongoing notification [id] (no-op without the permission). */
    @SuppressLint("MissingPermission") // canPost() checks POST_NOTIFICATIONS first
    public fun postOngoing(context: Context, id: Int, notification: Notification) {
        if (!canPost(context)) return
        runCatching { NotificationManagerCompat.from(context).notify(id, notification) }
    }

    /** The alert as a Notification (private, with a public version for the lock screen). */
    public fun buildAlert(context: Context, spec: AlertSpec, open: PendingIntent?): Notification {
        val public = NotificationCompat.Builder(context, spec.channel)
            .setSmallIcon(spec.smallIcon).setContentTitle(spec.publicTitle).setContentText(spec.publicText).build()
        val b = NotificationCompat.Builder(context, spec.channel)
            .setSmallIcon(spec.smallIcon)
            .setContentTitle(spec.title)
            .setContentText(spec.text)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE).setPublicVersion(public)
            .setAutoCancel(spec.autoCancel)
        spec.bigText?.let { b.setStyle(NotificationCompat.BigTextStyle().bigText(it)) }
        if (open != null) {
            b.setContentIntent(open)
            spec.actionLabel?.let { b.addAction(0, it, open) }
            if (spec.fullScreen && canFullScreen(context)) b.setFullScreenIntent(open, true)
        }
        return b.build()
    }

    /** Posts the alert under its tag (id 0). Returns false without the permission or when Android refused it. */
    @SuppressLint("MissingPermission") // canPost() checks POST_NOTIFICATIONS first
    public fun alert(context: Context, spec: AlertSpec, open: PendingIntent?): Boolean {
        if (!canPost(context)) return false
        return runCatching { NotificationManagerCompat.from(context).notify(spec.tag, 0, buildAlert(context, spec, open)) }.isSuccess
    }

    /** A quiet one-off notice under a numeric id. */
    @SuppressLint("MissingPermission") // canPost() checks POST_NOTIFICATIONS first
    public fun notice(context: Context, spec: NoticeSpec, open: PendingIntent?): Boolean {
        if (!canPost(context)) return false
        val n = NotificationCompat.Builder(context, spec.channel)
            .setSmallIcon(spec.smallIcon).setContentTitle(spec.title).setContentText(spec.text)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setAutoCancel(spec.autoCancel)
            .apply { if (open != null) setContentIntent(open) }
            .build()
        return runCatching { NotificationManagerCompat.from(context).notify(spec.id, n) }.isSuccess
    }

    public fun cancelTag(context: Context, tag: String) { runCatching { NotificationManagerCompat.from(context).cancel(tag, 0) } }
    public fun cancel(context: Context, id: Int) { runCatching { NotificationManagerCompat.from(context).cancel(id) } }

    /**
     * alert@1 hook: posts [change] as a device notification when its delivery targets include [AlertNotifications.DEVICE_CHANNEL]
     * (creates the two alert channels first). Not wired by default; see [AlertNotifications].
     */
    public fun deliverAlert(context: Context, change: AlertChange, smallIcon: Int, open: PendingIntent?): Boolean {
        val spec = AlertNotifications.plan(change, smallIcon) ?: return false
        channels(context, AlertNotifications.channels)
        return alert(context, spec, open)
    }

    private fun importance(i: ChannelImportance): Int = when (i) {
        ChannelImportance.MIN -> NotificationManager.IMPORTANCE_MIN
        ChannelImportance.LOW -> NotificationManager.IMPORTANCE_LOW
        ChannelImportance.DEFAULT -> NotificationManager.IMPORTANCE_DEFAULT
        ChannelImportance.HIGH -> NotificationManager.IMPORTANCE_HIGH
    }

    private fun visibility(l: LockScreen): Int = when (l) {
        LockScreen.PUBLIC -> Notification.VISIBILITY_PUBLIC
        LockScreen.PRIVATE -> Notification.VISIBILITY_PRIVATE
        LockScreen.SECRET -> Notification.VISIBILITY_SECRET
    }
}
