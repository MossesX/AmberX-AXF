package ai.amberx.consoleapp;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;

/**
 * Phone notifications for the console (approvals waiting, alerts, finished builds): the page posts them with
 * {@code axfNative.notify({id, title, text, link, channel})}; a tap opens the app on {@code link} (a console URL or
 * {@code axf-console://open/<address>}). Only Brett's own links: anything else opens the console home.
 */
final class Notifier {
    private Notifier() {}

    static final String ALERTS = "alerts", APPROVALS = "approvals";

    static void channels(Context c) {
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        OverlayService.channel(nm);
        nm.createNotificationChannel(new NotificationChannel(ALERTS, "Console alerts", NotificationManager.IMPORTANCE_DEFAULT));
        nm.createNotificationChannel(new NotificationChannel(APPROVALS, "Approvals", NotificationManager.IMPORTANCE_HIGH));
    }

    /** Posts (or replaces, same id) one notification. Returns false when notifications aren't allowed. */
    static boolean show(Context c, String id, String title, String text, String link, String channel) {
        if (!Perms.has(c, Perms.NOTIFY)) return false;
        channels(c);
        String ch = APPROVALS.equals(channel) ? APPROVALS : ALERTS;
        String target = ShellRules.deepLink(link); // own sites or axf-console:// only; else home
        Intent open = new Intent(c, ConsoleActivity.class).setAction(Intent.ACTION_VIEW).setData(Uri.parse(target))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        int nid = idOf(id);
        Notification n = new Notification.Builder(c, ch)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(title == null ? "" : title)
            .setContentText(text == null ? "" : text)
            .setStyle(new Notification.BigTextStyle().bigText(text == null ? "" : text))
            .setAutoCancel(true)
            .setContentIntent(PendingIntent.getActivity(c, nid, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT))
            .build();
        c.getSystemService(NotificationManager.class).notify(nid, n);
        return true;
    }

    static void cancel(Context c, String id) {
        c.getSystemService(NotificationManager.class).cancel(idOf(id));
    }

    /** A stable notification id for the page's string id (never the toolbar's own id 1). */
    static int idOf(String id) {
        int h = (id == null ? "" : id).hashCode() & 0x7fffffff;
        return h <= OverlayService.NOTE_ID ? h + 2 : h;
    }
}
