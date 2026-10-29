package ai.amberx.droid;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.media.AudioAttributes;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.SystemClock;
import android.provider.Settings;
import android.webkit.CookieManager;
import androidx.core.app.NotificationCompat;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Veto approvals on the phone (veto@1, Brett Oct 28 2026): a command Claude sends through Vinnie is held by the hub for a
 * countdown (3 minutes) and then run by the hub itself, unless Brett denies it. For every held call in the approvals feed
 * the watch service raises three notifications on one card: when the timer starts (title, the command, a live countdown,
 * Deny), when 30 seconds are left, and when it starts running. Each phase has its own channel made with the sound and
 * vibration chosen in AmberX (Settings → Plugins → Approvals; `vetoSettings` from the web side). Android channels can't
 * change once made, so a new choice makes a new channel (`veto_<phase>_<hash>`) and the old one is deleted.
 *
 * Deny (the notification action, or the app's Deny button through the plugin) posts `/auth/api/approvals/<id>/deny` with
 * the phone's hub session under the hub's Origin + CSRF ([HubRules#deny]), the same way auto-approval posts. A held call is
 * never auto-approved and never shown as an approval ([HubRules#interpret] skips it).
 */
final class VetoAlerts {
    private VetoAlerts() {}

    static final String PREFS = "amberx_veto";
    static final String ACTION_DENY = "ai.amberx.droid.VETO_DENY";
    static final String EXTRA_ID = "ai.amberx.droid.VETO_ID";
    static final String[] PHASES = { "held", "warning", "running" };
    private static final String TAG = "veto:";

    static SharedPreferences prefs(Context c) { return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE); }

    /* ---------------------------------------------------------------- channels (sound + vibration per phase) */

    static JSONObject config(Context c) {
        try { return new JSONObject(prefs(c).getString("config", "{}")); } catch (Exception e) { return new JSONObject(); }
    }

    /** Saves the alert config from the web side ({held, warning, running}: {sound, vibration[], vibrate}) and remakes channels. */
    static void configure(Context c, JSONObject cfg) {
        prefs(c).edit().putString("config", cfg == null ? "{}" : cfg.toString()).apply();
        channels(c);
    }

    private static JSONObject phaseCfg(Context c, String phase) {
        JSONObject p = config(c).optJSONObject(phase);
        if (p != null) return p;
        JSONObject d = new JSONObject();
        try {
            d.put("sound", "running".equals(phase) ? "default" : "alarm").put("vibrate", true)
                .put("vibration", new JSONArray(new long[] { 0, 150, 100, 150, 100, 150 }));
        } catch (Exception ignored) {}
        return d;
    }

    static Uri soundUri(String sound) {
        switch (sound == null ? "" : sound) {
            case "alarm": return Settings.System.DEFAULT_ALARM_ALERT_URI;
            case "ringtone": return Settings.System.DEFAULT_RINGTONE_URI;
            case "none": return null;
            default: return Settings.System.DEFAULT_NOTIFICATION_URI;
        }
    }

    static long[] pattern(JSONObject p) {
        JSONArray a = p.optJSONArray("vibration");
        if (a == null || a.length() == 0) return null;
        long[] out = new long[Math.min(a.length(), 20)];
        for (int i = 0; i < out.length; i++) out[i] = Math.max(0, Math.min(5000, a.optLong(i, 0)));
        return out;
    }

    static String channelId(Context c, String phase) {
        JSONObject p = phaseCfg(c, phase);
        String key = p.optString("sound", "default") + "|" + p.optBoolean("vibrate", true) + "|" + String.valueOf(p.optJSONArray("vibration"));
        return "veto_" + phase + "_" + Integer.toHexString(key.hashCode());
    }

    static void channels(Context c) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        Set<String> keep = new HashSet<>();
        for (String phase : PHASES) {
            JSONObject p = phaseCfg(c, phase);
            String id = channelId(c, phase);
            keep.add(id);
            if (nm.getNotificationChannel(id) != null) continue;
            String name = "held".equals(phase) ? "Held command: timer started" : "warning".equals(phase) ? "Held command: time running out" : "Held command: running";
            NotificationChannel ch = new NotificationChannel(id, name, NotificationManager.IMPORTANCE_HIGH);
            Uri sound = soundUri(p.optString("sound", "default"));
            AudioAttributes attrs = new AudioAttributes.Builder()
                .setUsage("alarm".equals(p.optString("sound")) ? AudioAttributes.USAGE_ALARM : AudioAttributes.USAGE_NOTIFICATION)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build();
            ch.setSound(sound, sound == null ? null : attrs);
            boolean vibrate = p.optBoolean("vibrate", true);
            ch.enableVibration(vibrate);
            long[] pat = pattern(p);
            if (vibrate && pat != null) ch.setVibrationPattern(pat);
            nm.createNotificationChannel(ch);
        }
        for (NotificationChannel ch : nm.getNotificationChannels()) {
            if (ch.getId().startsWith("veto_") && !keep.contains(ch.getId())) nm.deleteNotificationChannel(ch.getId());
        }
    }

    /* ---------------------------------------------------------------- the feed → notifications */

    private static Set<String> sent(Context c) { return new HashSet<>(prefs(c).getStringSet("sent", new HashSet<>())); }

    /**
     * Called by the watch service with every feed read: notifies phases reached and not sent yet, schedules the warning and
     * running ones on [work] at the local times they fall due, and takes cards away for calls the hub no longer holds
     * (denied or expired elsewhere). A call gone right when its time was up is shown as running.
     */
    static void update(Context c, Handler work, List<HubRules.Veto> held) {
        long now = System.currentTimeMillis();
        Set<String> was = sent(c);
        Set<String> next = new HashSet<>();
        Set<String> ids = new HashSet<>();
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        channels(c);
        for (HubRules.Veto v : held) {
            ids.add(v.id);
            work.removeCallbacksAndMessages(token(v.id));
            int left = (int) Math.max(0, Math.ceil((v.runsAtLocal() - now) / 1000.0));
            String phase = HubRules.vetoPhase(left);
            if (was.contains(v.id + ":denied")) { next.add(v.id + ":denied"); continue; }
            String fresh = null;
            for (String p : PHASES) {
                if (rank(p) > rank(phase)) break;
                next.add(v.id + ":" + p);
                if (!was.contains(v.id + ":" + p)) fresh = p; // first seen late: one card for the phase it's in
            }
            if (fresh != null) nm.notify(TAG + v.id, 0, card(c, v, fresh));
            if (rank(phase) < rank("warning")) schedule(c, work, v, "warning", v.runsAtLocal() - HubRules.VETO_WARNING_SECONDS * 1000L - now);
            if (rank(phase) < rank("running")) schedule(c, work, v, "running", v.runsAtLocal() - now);
            JSONObject seen = known(c);
            try { seen.put(v.id, new JSONObject().put("title", v.title).put("command", v.command).put("url", v.url).put("runsAt", v.runsAtLocal())); } catch (Exception ignored) {}
            prefs(c).edit().putString("known", seen.toString()).apply();
        }
        // Calls no longer held: their timers stop; their card goes, unless their time was up (then it ran).
        JSONObject known = known(c);
        Set<String> gone = new HashSet<>();
        for (String key : was) {
            String id = key.substring(0, key.lastIndexOf(':'));
            if (!ids.contains(id)) gone.add(id);
        }
        for (String id : gone) {
            work.removeCallbacksAndMessages(token(id));
            JSONObject k = known.optJSONObject(id);
            boolean due = k != null && k.optLong("runsAt", Long.MAX_VALUE) - 3000 <= now && !was.contains(id + ":denied");
            if (due && !was.contains(id + ":running")) {
                HubRules.Veto v = new HubRules.Veto(id, null, "vps.run", k.optString("title"), k.optString("command"), k.optString("url"), 0, now);
                nm.notify(TAG + id, 0, card(c, v, "running"));
            } else if (!due) nm.cancel(TAG + id, 0);
            known.remove(id);
        }
        prefs(c).edit().putStringSet("sent", next).putString("known", known.toString()).apply();
    }

    private static JSONObject known(Context c) {
        try { return new JSONObject(prefs(c).getString("known", "{}")); } catch (Exception e) { return new JSONObject(); }
    }

    /** Handler tokens compare by identity: one interned string per call. */
    static String token(String id) { return (TAG + id).intern(); }

    private static int rank(String phase) { return "held".equals(phase) ? 0 : "warning".equals(phase) ? 1 : 2; }

    private static void schedule(Context c, Handler work, HubRules.Veto v, String phase, long delayMs) {
        Context app = c.getApplicationContext();
        work.postAtTime(() -> {
            Set<String> s = sent(app);
            if (s.contains(v.id + ":" + phase) || s.contains(v.id + ":denied")) return;
            s.add(v.id + ":" + phase);
            prefs(app).edit().putStringSet("sent", s).apply();
            app.getSystemService(NotificationManager.class).notify(TAG + v.id, 0, card(app, v, phase));
        }, token(v.id), SystemClock.uptimeMillis() + Math.max(0, delayMs));
    }

    /** The one card for a call; each phase replaces it on its own channel (its own sound), with a live countdown until it runs. */
    static Notification card(Context c, HubRules.Veto v, String phase) {
        Intent open = new Intent(c, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_NEW_TASK).putExtra(MainActivity.EXTRA_VETO, v.id);
        PendingIntent tap = PendingIntent.getActivity(c, (TAG + v.id).hashCode(), open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        String what = v.command.isEmpty() ? v.tool : v.command;
        long runsAt = v.runsAtLocal();
        int left = (int) Math.max(0, Math.ceil((runsAt - System.currentTimeMillis()) / 1000.0));
        String title = "running".equals(phase) ? "Running now: " + v.title
            : "warning".equals(phase) ? left + " s left: " + v.title
            : "Runs in " + (left / 60) + ":" + String.format(java.util.Locale.ROOT, "%02d", left % 60) + ": " + v.title;
        NotificationCompat.Builder b = new NotificationCompat.Builder(c, channelId(c, phase))
            .setSmallIcon(R.mipmap.ic_launcher).setContentTitle(title).setContentText(what)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(what + ("running".equals(phase) ? "" : "\nDeny to stop it.")))
            .setPriority(NotificationCompat.PRIORITY_HIGH).setCategory(NotificationCompat.CATEGORY_ALARM)
            .setContentIntent(tap).setAutoCancel("running".equals(phase))
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setPublicVersion(new NotificationCompat.Builder(c, channelId(c, phase)).setSmallIcon(R.mipmap.ic_launcher).setContentTitle("Held command").build());
        if (!"running".equals(phase)) {
            b.setWhen(runsAt).setShowWhen(true).setUsesChronometer(true).setOngoing(true);
            if (Build.VERSION.SDK_INT >= 24) b.setChronometerCountDown(true);
            if (Build.VERSION.SDK_INT >= 26) b.setTimeoutAfter(Math.max(1000, runsAt - System.currentTimeMillis() + 5000));
            Intent deny = new Intent(c, Receiver.class).setAction(ACTION_DENY).putExtra(EXTRA_ID, v.id);
            PendingIntent pd = PendingIntent.getBroadcast(c, ("deny:" + v.id).hashCode(), deny, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            b.addAction(0, "Deny", pd);
        }
        return b.build();
    }

    /** A test of one phase's notification (Settings → Plugins → Approvals → Test). */
    static void test(Context c, String phase) {
        channels(c);
        HubRules.Veto v = new HubRules.Veto("00000000-0000-0000-0000-000000000000", null, "vps.run", "Test call", "echo hello",
            HubRules.HUB + HubRules.APPROVALS_PATH, "warning".equals(phase) ? 30 : "running".equals(phase) ? 0 : 180, System.currentTimeMillis());
        Notification n = card(c, v, phase);
        n.flags &= ~Notification.FLAG_ONGOING_EVENT;
        c.getSystemService(NotificationManager.class).notify("veto-test", 0, n);
    }

    /* ---------------------------------------------------------------- deny */

    /** Deny with the phone's hub session; on success the card says so (quietly) and every timer for it stops. 200 = denied. */
    static int deny(Context c, String id) {
        String hub = HubRules.HUB;
        int code = HubRules.deny(hub, id, CookieManager.getInstance().getCookie(hub));
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        if (code == 200) {
            Set<String> s = sent(c);
            s.add(id + ":denied");
            prefs(c).edit().putStringSet("sent", s).apply();
            WatchService w = WatchService.running;
            if (w != null) w.cancelVeto(token(id));
            nm.notify(TAG + id, 0, new NotificationCompat.Builder(c, WatchService.CH_APPROVALS)
                .setSmallIcon(R.mipmap.ic_launcher).setContentTitle("Denied").setContentText("It will not run.")
                .setSilent(true).setAutoCancel(true).setTimeoutAfter(15_000).build());
        }
        return code;
    }

    /** The notification's Deny action: runs off the main thread, then tells the app (if it's open). */
    public static final class Receiver extends BroadcastReceiver {
        @Override public void onReceive(Context context, Intent intent) {
            if (intent == null || !ACTION_DENY.equals(intent.getAction())) return;
            String id = intent.getStringExtra(EXTRA_ID);
            if (id == null) return;
            PendingResult done = goAsync();
            Context app = context.getApplicationContext();
            new Thread(() -> {
                try {
                    int code = deny(app, id);
                    AmberxNativePlugin.vetoEvent(id, code == 200 ? "denied" : "deny-failed", code == 200 ? null : (code < 0 ? "signed out of axHub" : "the hub answered " + code));
                    if (code != 200) {
                        Intent open = new Intent(app, HubWebActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK).putExtra(HubWebActivity.EXTRA_URL, HubRules.approvalUrl(HubRules.HUB, id));
                        try { app.startActivity(open); } catch (Exception ignored) { /* background start refused */ }
                    }
                } finally {
                    done.finish();
                }
            }, "amberx-veto-deny").start();
        }
    }
}
