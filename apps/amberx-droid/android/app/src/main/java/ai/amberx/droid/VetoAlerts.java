package ai.amberx.droid;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.Handler;
import android.os.SystemClock;
import android.webkit.CookieManager;
import androidx.core.app.NotificationCompat;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import org.json.JSONObject;

/**
 * Veto notices on the phone (veto@1, Brett Oct 28 2026; Approve + Shelve, Oct 30 2026, axHub decision 104). A command
 * Claude sends through Vinnie is held by the hub for a countdown (90 s) and then run by the hub itself, unless Brett
 * stops it. For every held call in the approvals feed the watch service raises one card that changes with it: when the
 * timer starts (title, the command, a live countdown), when 30 seconds are left, and when it starts running; a shelved
 * call's card says it waits for him. The card carries **Deny**, **Approve** (run it now) and **Shelve** (pause the
 * countdown) as the hub allows; tapping it opens AmberX on the veto screen (the veto banner plugin's, `open` event).
 *
 * The notices, the veto screen and the alarm belong to the veto banner plugin (console `plugins/approvals-banner`),
 * which AmberX loads; this is its phone side (lib-hub `setVetoHost`, `native.ts installVetoHost`). The loud part is
 * [VetoAlarm] (its settings, the alarm stream); the cards themselves use plain notification channels.
 *
 * Every action posts `/auth/api/approvals/<id>/<deny|approve-now|shelve>` with the phone's hub session under the hub's
 * Origin + CSRF ([HubRules#act]). A held call is never auto-approved and never shown as an approval.
 */
final class VetoAlerts {
    private VetoAlerts() {}

    static final String PREFS = "amberx_veto";
    static final String ACTION_DENY = "ai.amberx.droid.VETO_DENY";
    static final String ACTION_APPROVE = "ai.amberx.droid.VETO_APPROVE";
    static final String ACTION_SHELVE = "ai.amberx.droid.VETO_SHELVE";
    static final String EXTRA_ID = "ai.amberx.droid.VETO_ID";
    static final String[] PHASES = { "held", "warning", "running" };
    private static final String TAG = "veto:";
    /** Card channels (fixed: the loud part is the alarm, configured in the banner plugin). */
    private static final String CH_PREFIX = "veto2_";

    static SharedPreferences prefs(Context c) { return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE); }

    /* ---------------------------------------------------------------- channels */

    static String channelId(String phase) { return CH_PREFIX + phase; }

    static void channels(Context c) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        Set<String> keep = new HashSet<>();
        for (String phase : new String[] { "held", "warning", "running", "shelved" }) {
            String id = channelId(phase);
            keep.add(id);
            if (nm.getNotificationChannel(id) != null) continue;
            String name = "held".equals(phase) ? "Held command: timer started" : "warning".equals(phase) ? "Held command: time running out"
                : "shelved".equals(phase) ? "Held command: shelved" : "Held command: running";
            NotificationChannel ch = new NotificationChannel(id, name, "shelved".equals(phase) ? NotificationManager.IMPORTANCE_DEFAULT : NotificationManager.IMPORTANCE_HIGH);
            ch.enableVibration(!"shelved".equals(phase));
            nm.createNotificationChannel(ch);
        }
        // The old per-sound channels (veto_<phase>_<hash>) went with the old settings.
        for (NotificationChannel ch : nm.getNotificationChannels()) {
            if ((ch.getId().startsWith("veto_") || ch.getId().startsWith(CH_PREFIX)) && !keep.contains(ch.getId())) nm.deleteNotificationChannel(ch.getId());
        }
    }

    /* ---------------------------------------------------------------- the feed → notifications */

    private static Set<String> sent(Context c) { return new HashSet<>(prefs(c).getStringSet("sent", new HashSet<>())); }

    /**
     * Called by the watch service with every feed read: notifies phases reached and not sent yet, schedules the warning and
     * running ones on [work] at the local times they fall due, schedules the alarm, shows shelved calls as waiting, and
     * takes cards away for calls the hub no longer holds (denied or expired elsewhere) or that were approved. A call gone
     * right when its time was up is shown as running.
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
            if (was.contains(v.id + ":denied") || was.contains(v.id + ":approved")) {
                next.add(v.id + (was.contains(v.id + ":denied") ? ":denied" : ":approved"));
                continue;
            }
            if (v.approvedNow) {
                // Approved (here or elsewhere): it runs now; no more notices, no alarm.
                next.add(v.id + ":approved");
                VetoAlarm.stop(c, work, v.id);
                nm.cancel(TAG + v.id, 0);
                continue;
            }
            for (String p : PHASES) if (was.contains(v.id + ":" + p)) next.add(v.id + ":" + p);
            if (v.shelved) {
                VetoAlarm.stop(c, work, v.id);
                next.add(v.id + ":shelved");
                if (!was.contains(v.id + ":shelved")) nm.notify(TAG + v.id, 0, card(c, v, "shelved"));
                remember(c, v);
                continue;
            }
            int left = (int) Math.max(0, Math.ceil((v.runsAtLocal() - now) / 1000.0));
            String phase = HubRules.vetoPhase(left);
            String fresh = null;
            for (String p : PHASES) {
                if (rank(p) > rank(phase)) break;
                next.add(v.id + ":" + p);
                if (!was.contains(v.id + ":" + p)) fresh = p; // first seen late: one card for the phase it's in
            }
            // Back from shelved (a hub that resumed it): show the countdown card again.
            if (fresh == null && was.contains(v.id + ":shelved")) fresh = phase;
            if (fresh != null) nm.notify(TAG + v.id, 0, card(c, v, fresh));
            if (rank(phase) < rank("warning")) schedule(c, work, v, "warning", v.runsAtLocal() - HubRules.VETO_WARNING_SECONDS * 1000L - now);
            if (rank(phase) < rank("running")) schedule(c, work, v, "running", v.runsAtLocal() - now);
            VetoAlarm.schedule(c, work, v);
            remember(c, v);
        }
        // Calls no longer held: their timers and alarm stop; their card goes, unless their time was up (then it ran).
        JSONObject known = known(c);
        Set<String> gone = new HashSet<>();
        for (String key : was) {
            String id = key.substring(0, key.lastIndexOf(':'));
            if (!ids.contains(id)) gone.add(id);
        }
        for (String id : gone) {
            work.removeCallbacksAndMessages(token(id));
            VetoAlarm.stop(c, work, id);
            JSONObject k = known.optJSONObject(id);
            boolean quiet = was.contains(id + ":denied") || was.contains(id + ":approved") || was.contains(id + ":shelved");
            boolean due = k != null && k.optLong("runsAt", Long.MAX_VALUE) - 3000 <= now && !quiet;
            if (due && !was.contains(id + ":running")) {
                HubRules.Veto v = new HubRules.Veto(id, null, "vps.run", k.optString("title"), k.optString("command"), k.optString("url"), 0, now);
                nm.notify(TAG + id, 0, card(c, v, "running"));
            } else if (!due && !was.contains(id + ":approved")) nm.cancel(TAG + id, 0);
            known.remove(id);
        }
        VetoAlarm.forget(c, ids);
        prefs(c).edit().putStringSet("sent", next).putString("known", known.toString()).apply();
    }

    private static void remember(Context c, HubRules.Veto v) {
        JSONObject seen = known(c);
        try { seen.put(v.id, new JSONObject().put("title", v.title).put("command", v.command).put("url", v.url).put("runsAt", v.runsAtLocal())); } catch (Exception ignored) {}
        prefs(c).edit().putString("known", seen.toString()).apply();
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
            if (s.contains(v.id + ":" + phase) || s.contains(v.id + ":denied") || s.contains(v.id + ":approved") || s.contains(v.id + ":shelved")) return;
            s.add(v.id + ":" + phase);
            prefs(app).edit().putStringSet("sent", s).apply();
            app.getSystemService(NotificationManager.class).notify(TAG + v.id, 0, card(app, v, phase));
        }, token(v.id), SystemClock.uptimeMillis() + Math.max(0, delayMs));
    }

    /** The one card for a call; each phase replaces it, with a live countdown until it runs and the actions the hub allows. */
    static Notification card(Context c, HubRules.Veto v, String phase) {
        Intent open = new Intent(c, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_NEW_TASK).putExtra(MainActivity.EXTRA_VETO, v.id);
        PendingIntent tap = PendingIntent.getActivity(c, (TAG + v.id).hashCode(), open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        String what = v.command.isEmpty() ? v.tool : v.command;
        long runsAt = v.runsAtLocal();
        int left = (int) Math.max(0, Math.ceil((runsAt - System.currentTimeMillis()) / 1000.0));
        boolean shelved = "shelved".equals(phase);
        boolean running = "running".equals(phase);
        String title = running ? "Running now: " + v.title
            : shelved ? "Shelved, waiting for you: " + v.title
            : "warning".equals(phase) ? left + " s left: " + v.title
            : "Runs in " + (left / 60) + ":" + String.format(java.util.Locale.ROOT, "%02d", left % 60) + ": " + v.title;
        String hint = running ? "" : shelved ? "\nApprove to run it, Deny to stop it." : "\nDeny stops it, Approve runs it now, Shelve pauses the countdown.";
        NotificationCompat.Builder b = new NotificationCompat.Builder(c, channelId(phase))
            .setSmallIcon(R.mipmap.ic_launcher).setContentTitle(title).setContentText(what)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(what + hint))
            .setPriority(shelved ? NotificationCompat.PRIORITY_DEFAULT : NotificationCompat.PRIORITY_HIGH)
            .setCategory(shelved ? NotificationCompat.CATEGORY_REMINDER : NotificationCompat.CATEGORY_ALARM)
            .setContentIntent(tap).setAutoCancel(running)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setPublicVersion(new NotificationCompat.Builder(c, channelId(phase)).setSmallIcon(R.mipmap.ic_launcher).setContentTitle("Held command").build());
        if (!running) {
            b.setOngoing(true);
            if (!shelved) {
                b.setWhen(runsAt).setShowWhen(true).setUsesChronometer(true);
                if (Build.VERSION.SDK_INT >= 24) b.setChronometerCountDown(true);
                if (Build.VERSION.SDK_INT >= 26) b.setTimeoutAfter(Math.max(1000, runsAt - System.currentTimeMillis() + 5000));
            }
            if (v.can("deny")) b.addAction(0, "Deny", action(c, ACTION_DENY, v.id));
            if (v.can("approve-now")) b.addAction(0, "Approve", action(c, ACTION_APPROVE, v.id));
            if (!shelved && v.can("shelve")) b.addAction(0, "Shelve", action(c, ACTION_SHELVE, v.id));
        }
        return b.build();
    }

    private static PendingIntent action(Context c, String what, String id) {
        Intent i = new Intent(c, Receiver.class).setAction(what).putExtra(EXTRA_ID, id);
        return PendingIntent.getBroadcast(c, (what + ":" + id).hashCode(), i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    /** A test of one phase's notification (Settings → Plugins → Approvals → Test). */
    static void test(Context c, String phase) {
        channels(c);
        HubRules.Veto v = new HubRules.Veto("00000000-0000-0000-0000-000000000000", null, "vps.run", "Test call", "echo hello",
            HubRules.HUB + HubRules.APPROVALS_PATH, "warning".equals(phase) ? 30 : "running".equals(phase) ? 0 : 90, System.currentTimeMillis());
        Notification n = card(c, v, phase);
        n.flags &= ~Notification.FLAG_ONGOING_EVENT;
        c.getSystemService(NotificationManager.class).notify("veto-test", 0, n);
    }

    /* ---------------------------------------------------------------- deny, approve, shelve */

    /**
     * Deny / Approve now / Shelve with the phone's hub session. On success every timer and the alarm for it stop, and the
     * card says what happened (Deny, Approve: quietly, then it goes; Shelve: the waiting card). 200 = done.
     */
    static int act(Context c, String id, String action) {
        String hub = HubRules.HUB;
        int code = HubRules.act(hub, id, action, CookieManager.getInstance().getCookie(hub));
        if (code != 200) return code;
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        Set<String> s = sent(c);
        WatchService w = WatchService.running;
        if (w != null) w.cancelVeto(token(id));
        VetoAlarm.stop(c, null, id);
        if ("shelve".equals(action)) {
            s.add(id + ":shelved");
            prefs(c).edit().putStringSet("sent", s).apply();
            JSONObject k = known(c).optJSONObject(id);
            HubRules.Veto v = new HubRules.Veto(id, null, "vps.run", k != null ? k.optString("title") : "Held command", k != null ? k.optString("command") : "",
                HubRules.approvalUrl(hub, id), 0, System.currentTimeMillis(), true, false, java.util.Arrays.asList("deny", "approve-now"));
            nm.notify(TAG + id, 0, card(c, v, "shelved"));
            return code;
        }
        s.add(id + ("deny".equals(action) ? ":denied" : ":approved"));
        prefs(c).edit().putStringSet("sent", s).apply();
        nm.notify(TAG + id, 0, new NotificationCompat.Builder(c, WatchService.CH_APPROVALS)
            .setSmallIcon(R.mipmap.ic_launcher).setContentTitle("deny".equals(action) ? "Denied" : "Approved")
            .setContentText("deny".equals(action) ? "It will not run." : "axHub runs it now.")
            .setSilent(true).setAutoCancel(true).setTimeoutAfter(15_000).build());
        return code;
    }

    static int deny(Context c, String id) { return act(c, id, "deny"); }

    /** The notification's Deny / Approve / Shelve: runs off the main thread, then tells the app (if it's open). */
    public static final class Receiver extends BroadcastReceiver {
        @Override public void onReceive(Context context, Intent intent) {
            if (intent == null) return;
            String what = intent.getAction();
            String action = ACTION_DENY.equals(what) ? "deny" : ACTION_APPROVE.equals(what) ? "approve-now" : ACTION_SHELVE.equals(what) ? "shelve" : null;
            String id = intent.getStringExtra(EXTRA_ID);
            if (action == null || id == null) return;
            PendingResult done = goAsync();
            Context app = context.getApplicationContext();
            new Thread(() -> {
                try {
                    int code = act(app, id, action);
                    String event = "deny".equals(action) ? "denied" : "shelve".equals(action) ? "shelved" : "approved";
                    AmberxNativePlugin.vetoEvent(id, code == 200 ? event : "failed", code == 200 ? null : (code < 0 ? "signed out of axHub" : "the hub answered " + code));
                    if (code != 200) {
                        Intent open = new Intent(app, HubWebActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK).putExtra(HubWebActivity.EXTRA_URL, HubRules.approvalUrl(HubRules.HUB, id));
                        try { app.startActivity(open); } catch (Exception ignored) { /* background start refused */ }
                    }
                } finally {
                    done.finish();
                }
            }, "amberx-veto-action").start();
        }
    }
}
