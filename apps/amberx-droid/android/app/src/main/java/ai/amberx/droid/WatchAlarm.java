package ai.amberx.droid;

import android.app.AlarmManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.PowerManager;
import android.os.SystemClock;
import android.provider.Settings;
import androidx.core.app.NotificationManagerCompat;
import org.json.JSONObject;

/**
 * What keeps approvals reaching the phone with AmberX closed (Nov 5 2026). The foreground service alone doesn't: a Handler
 * timer stops while the phone sleeps, and once Android kills the process a sticky restart may be refused a foreground
 * start, so the service stayed gone until the app was opened (the hub saw no sign of the phone for 11 hours).
 *
 * An exact alarm fires about once a minute, under a short wake lock: it tries to bring the service back (an exact alarm
 * may start one), and reads the feed itself when nobody read it lately ({@link WatchService#poll}), so the alert goes out
 * whether or not the service is up. Android caps these alarms while idle (about one a minute), which is inside the 90 s veto.
 */
public class WatchAlarm extends BroadcastReceiver {
    private static final long WAKE_MS = 25_000;
    private static Handler work;

    /** Next alarm: every minute, sooner while a command is held. */
    static long delayMs(int held) { return HubRules.watchDelayMs(held); }

    private static PendingIntent pending(Context c) {
        return PendingIntent.getBroadcast(c, 0, new Intent(c, WatchAlarm.class), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    static void arm(Context c, long delayMs) {
        AlarmManager am = c.getSystemService(AlarmManager.class);
        long at = SystemClock.elapsedRealtime() + delayMs;
        try {
            if (Build.VERSION.SDK_INT >= 31 && !am.canScheduleExactAlarms()) am.setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, at, pending(c));
            else am.setExactAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, at, pending(c));
        } catch (SecurityException e) {
            am.setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, at, pending(c));
        }
    }

    /** One handler: held-call timers are cancelled per handler. */
    private static synchronized Handler work() {
        if (work == null) {
            HandlerThread t = new HandlerThread("amberx-alarm");
            t.start();
            work = new Handler(t.getLooper());
        }
        return work;
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        Context app = context.getApplicationContext();
        if (!WatchService.prefs(app).getBoolean("on", false)) return;
        PendingResult done = goAsync();
        PowerManager.WakeLock lock = app.getSystemService(PowerManager.class).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "amberx:watch");
        lock.acquire(WAKE_MS);
        new Thread(() -> {
            long next = delayMs(0);
            try {
                if (WatchService.running == null) {
                    try { WatchService.refresh(app); } catch (RuntimeException ignored) { /* refused: the read below still alerts */ }
                }
                int every = WatchService.config(app).optInt("intervalSec", 30);
                if (!HubRules.feedFresh(WatchService.lastPollAt, System.currentTimeMillis(), every)) {
                    WatchService.channels(app);
                    next = Math.min(next, WatchService.poll(app, work()) <= 10_000L ? delayMs(1) : delayMs(0));
                }
            } catch (RuntimeException ignored) {
                /* the next alarm tries again */
            } finally {
                arm(app, next);
                if (lock.isHeld()) lock.release();
                done.finish();
            }
        }, "amberx-alarm-check").start();
    }

    /* ---------------------------------------------------------------- health */

    static JSONObject health(Context c) {
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        boolean channel = true;
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel ch = nm.getNotificationChannel(WatchService.CH_APPROVALS);
            NotificationChannel held = nm.getNotificationChannel(VetoAlerts.channelId("held"));
            channel = (ch == null || ch.getImportance() != NotificationManager.IMPORTANCE_NONE) && (held == null || held.getImportance() != NotificationManager.IMPORTANCE_NONE);
        }
        boolean exact = Build.VERSION.SDK_INT < 31 || c.getSystemService(AlarmManager.class).canScheduleExactAlarms();
        boolean battery = c.getSystemService(PowerManager.class).isIgnoringBatteryOptimizations(c.getPackageName());
        JSONObject o = new JSONObject();
        try {
            o.put("watching", WatchService.prefs(c).getBoolean("on", false))
                .put("service", WatchService.running != null)
                .put("notifications", NotificationManagerCompat.from(c).areNotificationsEnabled())
                .put("channels", channel)
                .put("battery", battery)
                .put("alarms", exact)
                .put("quiet", Quiet.on(c))
                .put("lastCheckAt", WatchService.lastPollAt)
                .put("status", WatchService.status.optString("status", "off"));
        } catch (Exception ignored) {}
        return o;
    }

    @android.annotation.SuppressLint("BatteryLife")
    static Intent fixIntent(Context c, String what) {
        Uri pkg = Uri.parse("package:" + c.getPackageName());
        if ("battery".equals(what)) return new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, pkg);
        if ("alarms".equals(what) && Build.VERSION.SDK_INT >= 31) return new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, pkg);
        return new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, c.getPackageName());
    }
}
