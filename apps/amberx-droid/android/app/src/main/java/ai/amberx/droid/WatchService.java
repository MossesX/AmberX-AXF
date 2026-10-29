package ai.amberx.droid;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.IBinder;
import android.os.Looper;
import android.speech.RecognitionListener;
import android.speech.SpeechRecognizer;
import android.webkit.CookieManager;
import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;
import androidx.core.content.ContextCompat;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * AmberX's background half: one foreground service that keeps watching while the app is closed or the screen is off.
 *
 * - **Approvals:** reads the hub's approvals feed with the phone's hub session every `intervalSec` (15–300 s; 5 min
 *   while signed out), raises one alert per new approval (tap = its page on the hub, in [HubWebActivity]) and, when
 *   auto-approval is on and the tool matches, approves it on the hub's own form ([HubRules#approve]).
 * - **Hands-free listening (Oct 27 2026):** its own switch (Voice control → Hands-free, on by default), independent of
 *   watching axHub. The on-device recognizer listens on screen and in the background for the wake phrases, or for
 *   everything when "always armed" is on. On screen a hit goes straight to the web side; with the app closed it opens
 *   AmberX (a full-screen alert where Android allows it). It never pauses: with hands-free on, the Speak button uses this
 *   same listener (the app takes the next thing heard as a command) instead of a second recognizer.
 * - **Detection overlay:** [DetectionOverlay], a floating window over other apps with the input level, dB, what was heard
 *   and quick settings (needs "Display over other apps").
 *
 * The watch config is the JSON the web side sends (`monitorStart`), the voice config what it sends with `voiceSet`; both
 * are kept in prefs so a reboot restarts them.
 */
public class WatchService extends Service {
    static final String PREFS = "amberx_watch";
    static final String ACTION_STOP = "ai.amberx.droid.STOP";
    static final String ACTION_CHECK = "ai.amberx.droid.CHECK";
    static final String CH_WATCH = "watch", CH_APPROVALS = "approvals", CH_WAKE = "wake", CH_CONSOLE = "console";
    private static final int ID_ONGOING = 1, ID_WAKE = 2;

    /** Last status, read by the plugin; [listener] gets every change. */
    static volatile JSONObject status = idle();
    static volatile StatusListener listener;
    /** True while MainActivity is on screen: hits go straight to the web side then. */
    static volatile boolean inApp;
    /** True while the Speak button's one-shot recognizer runs: hands-free pauses so they don't fight over the mic. */
    static volatile boolean appListening;
    /** The running service, for the plugin's live calls (overlay permission granted, …). */
    static volatile WatchService running;

    interface StatusListener { void changed(JSONObject status); }

    private HandlerThread thread;
    private Handler work;
    private final Handler main = new Handler(Looper.getMainLooper());
    private SpeechRecognizer recognizer;
    private boolean listening;
    private DetectionOverlay overlay;
    private long lastLevelEvent;

    static JSONObject idle() {
        JSONObject o = new JSONObject();
        try { o.put("running", false).put("listening", false).put("lastCheck", JSONObject.NULL).put("status", "off").put("waiting", 0); } catch (Exception ignored) {}
        return o;
    }

    static SharedPreferences prefs(Context c) { return c.getSharedPreferences(PREFS, MODE_PRIVATE); }

    static JSONObject config(Context c) {
        try { return new JSONObject(prefs(c).getString("config", "{}")); } catch (Exception e) { return new JSONObject(); }
    }

    static void start(Context c, JSONObject config) {
        prefs(c).edit().putString("config", config.toString()).putBoolean("on", true).apply();
        ContextCompat.startForegroundService(c, new Intent(c, WatchService.class));
    }

    static void stop(Context c) {
        prefs(c).edit().putBoolean("on", false).apply();
        if (handsFree(c)) refresh(c); // hands-free keeps the service (and the microphone) running on its own
        else c.startService(new Intent(c, WatchService.class).setAction(ACTION_STOP));
    }

    /* ---------------------------------------------------------------- voice config (hands-free + overlay) */

    static JSONObject voice(Context c) {
        try { return new JSONObject(prefs(c).getString("voice", "{}")); } catch (Exception e) { return new JSONObject(); }
    }

    /** Hands-free is on by default: a missing config means on. */
    static boolean handsFree(Context c) { return voice(c).optBoolean("handsFree", true); }

    /** Saves the voice config from the web side and starts or stops the service to match. */
    static void setVoice(Context c, JSONObject cfg) {
        String before = prefs(c).getString("voice", "{}");
        prefs(c).edit().putString("voice", cfg.toString()).apply();
        refresh(c);
        WatchService w = running;
        if (w != null && tuningChanged(before, cfg)) w.retune();
    }

    /** True when a setting that changes how the recognizer runs changed (online, beep, swears, lang). */
    static boolean tuningChanged(String before, JSONObject after) {
        try {
            JSONObject b = new JSONObject(before);
            for (String k : new String[] { "online", "beep", "swears", "lang" }) if (!String.valueOf(b.opt(k)).equals(String.valueOf(after.opt(k)))) return true;
        } catch (Exception e) { return true; }
        return false;
    }

    /** One quick-setting change made on the overlay (handsFree / alwaysArmed / overlay). */
    static void setVoiceFlag(Context c, String key, boolean value) {
        JSONObject v = voice(c);
        try { v.put(key, value); } catch (Exception ignored) {}
        setVoice(c, v);
        AmberxNativePlugin.voiceChanged(v);
    }

    /** Starts the service when watching or hands-free wants it, else stops it. */
    static void refresh(Context c) {
        boolean want = prefs(c).getBoolean("on", false) || handsFree(c);
        if (want) {
            try { ContextCompat.startForegroundService(c, new Intent(c, WatchService.class)); } catch (Exception ignored) { /* background start refused */ }
        } else c.startService(new Intent(c, WatchService.class).setAction(ACTION_STOP));
    }

    @Override public IBinder onBind(Intent intent) { return null; }

    @Override
    public void onCreate() {
        super.onCreate();
        running = this;
        channels(this);
        thread = new HandlerThread("amberx-watch");
        thread.start();
        work = new Handler(thread.getLooper());
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            stopListening();
            hideOverlay();
            ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE);
            setStatus(idle());
            stopSelf();
            return START_NOT_STICKY;
        }
        boolean watching = prefs(this).getBoolean("on", false);
        if (!watching && !handsFree(this)) { stopListening(); hideOverlay(); stopSelf(); return START_NOT_STICKY; }
        boolean wantMic = wantsMic() && micGranted();
        int type = ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE | (wantMic ? ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE : 0);
        try {
            ServiceCompat.startForeground(this, ID_ONGOING, ongoing(wantMic), Build.VERSION.SDK_INT >= 29 ? type : 0);
        } catch (Exception e) {
            // Android refused (e.g. a microphone service started from the background): run without the microphone.
            wantMic = false;
            try { ServiceCompat.startForeground(this, ID_ONGOING, ongoing(false), Build.VERSION.SDK_INT >= 29 ? ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE : 0); }
            catch (Exception again) { stopSelf(); return START_NOT_STICKY; }
        }
        work.removeCallbacksAndMessages(null);
        if (watching) work.post(this::check);
        else setStatus(listeningOnly());
        main.removeCallbacksAndMessages(null);
        if (wantMic) main.post(this::listenLoop); else stopListening();
        main.post(this::syncOverlay);
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        if (running == this) running = null;
        stopListening();
        hideOverlay();
        if (thread != null) thread.quitSafely();
        super.onDestroy();
    }

    /* ---------------------------------------------------------------- approvals */

    private JSONObject listeningOnly() {
        JSONObject s = new JSONObject();
        try { s.put("running", false).put("listening", listening).put("lastCheck", JSONObject.NULL).put("status", "off").put("waiting", 0); } catch (Exception ignored) {}
        return s;
    }

    private void check() {
        if (!prefs(this).getBoolean("on", false)) return;
        JSONObject cfg = config(this);
        String hub = HubRules.isHub(HubRules.HUB, cfg.optString("hub", "")) ? HubRules.HUB : null;
        int every = Math.max(15, Math.min(300, cfg.optInt("intervalSec", 30)));
        HubRules.Feed feed;
        int held = 0;
        if (hub == null) feed = new HubRules.Feed("unreachable", 0, new ArrayList<>());
        else {
            String cookie = CookieManager.getInstance().getCookie(hub);
            String body = null;
            try {
                HubRules.Reply r = HubRules.get(hub + HubRules.FEED_PATH, cookie);
                feed = HubRules.interpret(hub, r.status, r.body);
                body = r.body;
            } catch (Exception e) {
                feed = new HubRules.Feed("unreachable", 0, new ArrayList<>());
            }
            if ("ok".equals(feed.status)) {
                handleNew(hub, cookie, feed, cfg.optJSONObject("autoApprove"));
                // Held veto calls (veto@1): their own notifications with Deny, never treated as approvals.
                List<HubRules.Veto> vetoes = HubRules.vetoes(hub, body, System.currentTimeMillis());
                held = vetoes.size();
                VetoAlerts.update(this, work, vetoes);
            }
        }
        int alerts = cfg.optBoolean("consoleAlerts", true) ? consoleAlerts() : -1;
        JSONObject s = new JSONObject();
        try {
            s.put("running", true).put("listening", listening).put("lastCheck", Instant.now().toString())
                .put("status", feed.status).put("waiting", feed.count).put("alerts", alerts);
        } catch (Exception ignored) {}
        setStatus(s);
        long next = "signed-out".equals(feed.status) || "not-admin".equals(feed.status) ? 300_000L : every * 1000L;
        // While a command is held, read every 10 s so a Deny elsewhere takes its card away quickly.
        if (held > 0) next = Math.min(next, 10_000L);
        work.postDelayed(this::check, next);
    }

    /** Stops the scheduled notifications of one held call (it was denied). */
    void cancelVeto(String token) {
        if (work != null) work.removeCallbacksAndMessages(token);
    }

    private void handleNew(String hub, String cookie, HubRules.Feed feed, JSONObject auto) {
        SharedPreferences p = prefs(this);
        Set<String> seen = new HashSet<>(p.getStringSet("seen", new HashSet<>()));
        Set<String> now = new HashSet<>();
        NotificationManager nm = getSystemService(NotificationManager.class);
        for (HubRules.Approval a : feed.pending) {
            now.add(a.id);
            if (seen.contains(a.id)) continue;
            boolean approve = auto != null && HubRules.autoApproves(auto.optBoolean("on"), auto.optBoolean("all"), auto.optString("tools", ""), a.tool);
            if (approve && HubRules.approve(hub, a.id, cookie)) {
                nm.notify(a.id, 0, alert(CH_APPROVALS, "Auto-approved " + a.tool, a.summary, a.url, false));
            } else {
                soundThrough();
                nm.notify(a.id, 0, alert(CH_APPROVALS, "Approval waiting: " + a.tool, a.summary, a.url, true));
            }
        }
        for (String gone : seen) if (!now.contains(gone)) nm.cancel(gone, 0); // decided elsewhere: take its alert away
        p.edit().putStringSet("seen", now).apply();
    }

    /**
     * The Dev Console's open alerts (builds, CI, deploys, systems check), read with the phone's own session for the console
     * (the hub's sign-in wall lets a signed-in admin through). Errors and warnings alert once per change; resolved or read
     * ones are taken away. Returns how many are open, or -1 when the console can't be read (signed out, unreachable).
     */
    private int consoleAlerts() {
        String cookie = CookieManager.getInstance().getCookie(HubRules.CONSOLE);
        if (cookie == null) return -1;
        HubRules.Alerts a;
        try {
            HubRules.Reply r = HubRules.get(HubRules.CONSOLE + HubRules.ALERTS_PATH, cookie);
            a = HubRules.consoleAlerts(r.status, r.body);
        } catch (Exception e) {
            return -1;
        }
        if (a == null) return -1;
        SharedPreferences p = prefs(this);
        Set<String> seen = new HashSet<>(p.getStringSet("alertsSeen", new HashSet<>()));
        Set<String> now = new HashSet<>();
        NotificationManager nm = getSystemService(NotificationManager.class);
        for (String key : a.closed) nm.cancel("console:" + key, 0);
        for (HubRules.ConsoleAlert c : a.open) {
            now.add(c.stamp);
            if (seen.contains(c.stamp)) continue;
            nm.notify("console:" + c.key, 0, consoleAlert(c));
        }
        p.edit().putStringSet("alertsSeen", now).apply();
        return a.open.size();
    }

    /* ---------------------------------------------------------------- hands-free listening */

    /** Hands-free: the voice config's phrases; else (hands-free off) the watch's own, as before. */
    private List<String> phrases() {
        JSONArray a = handsFree(this) ? voice(this).optJSONArray("wakePhrases") : null;
        if (a == null && prefs(this).getBoolean("on", false)) a = config(this).optJSONArray("wakePhrases");
        if (a == null && handsFree(this) && !voice(this).has("wakePhrases")) a = new JSONArray().put("hey amberx").put("okay amberx");
        List<String> out = new ArrayList<>();
        for (int i = 0; a != null && i < a.length() && out.size() < 20; i++) {
            String s = a.optString(i, "").trim().toLowerCase(Locale.ROOT);
            if (!s.isEmpty()) out.add(s);
        }
        return out;
    }

    private boolean alwaysArmed() { return handsFree(this) && voice(this).optBoolean("alwaysArmed", false); }

    private boolean wantsMic() { return !phrases().isEmpty() || alwaysArmed(); }

    private String lang() {
        String l = voice(this).optString("lang", "");
        return l.isEmpty() ? config(this).optString("lang", "en-US") : l;
    }

    private boolean micGranted() {
        return ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED;
    }

    private void listenLoop() {
        boolean on = prefs(this).getBoolean("on", false) || handsFree(this);
        if (!on || !wantsMic() || !micGranted()) { stopListening(); return; }
        if (appListening) { pauseListening(); main.postDelayed(this::listenLoop, 1_000); return; } // the Speak button has the mic
        if (!SpeechRecognizer.isRecognitionAvailable(this)) { stopListening(); return; }
        if (recognizer == null) {
            // The online recognizer hears far better (Brett: "misses what I say"); the on-device one only when chosen.
            boolean offline = !voice(this).optBoolean("online", true);
            recognizer = offline && Build.VERSION.SDK_INT >= 31 && SpeechRecognizer.isOnDeviceRecognitionAvailable(this)
                ? SpeechRecognizer.createOnDeviceSpeechRecognizer(this) : SpeechRecognizer.createSpeechRecognizer(this);
            recognizer.setRecognitionListener(new Listener());
        }
        setListening(true);
        JSONObject v = voice(this);
        SpeechTuning.quiet(this, v); // no start/stop tone on every turn
        Intent i = SpeechTuning.request(lang(), v, true);
        try { recognizer.startListening(i); } catch (Exception e) { main.postDelayed(this::listenLoop, 5_000); }
    }

    /** Lets go of the microphone for a moment (the Speak button) without tearing the overlay down. */
    private void pauseListening() {
        if (recognizer != null) { try { recognizer.cancel(); } catch (Exception ignored) {} }
        setListening(false);
    }

    /** An approval alert's sound gets through the beep silencer, then it's silenced again. */
    private void soundThrough() {
        main.post(() -> SpeechTuning.loud(this));
        main.postDelayed(() -> { if (listening) SpeechTuning.quiet(this, voice(this)); }, 4_000);
    }

    /** Settings changed: the next turn uses them (a new recognizer for online / offline). */
    void retune() {
        main.post(() -> {
            if (recognizer != null) { try { recognizer.destroy(); } catch (Exception ignored) {} recognizer = null; }
            SpeechTuning.loud(this);
            listening = false;
            listenLoop();
        });
    }

    private void stopListening() {
        SpeechTuning.loud(this);
        setListening(false);
        if (recognizer != null) { try { recognizer.destroy(); } catch (Exception ignored) {} recognizer = null; }
    }

    private void setListening(boolean on) {
        if (listening == on) return;
        listening = on;
        if (overlay != null) overlay.setListening(on, alwaysArmed());
        try { JSONObject s = new JSONObject(status.toString()); s.put("listening", on); setStatus(s); } catch (Exception ignored) {}
    }

    private class Listener implements RecognitionListener {
        /** A wake phrase in what was heard: true when handled. Final results also run "always armed". */
        private boolean heard(Bundle b, boolean last) {
            ArrayList<String> said = b == null ? null : b.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
            if (said == null || said.isEmpty()) return false;
            JSONObject v = voice(WatchService.this);
            String top = SpeechTuning.clean(said.get(0), v);
            if (overlay != null) overlay.setHeard(top, last);
            AmberxNativePlugin.heard(top, last);
            // Act on the whole sentence only: a wake phrase caught mid-sentence used to cut the command off.
            if (!last) return false;
            for (String s : said) {
                String p = SpeechTuning.wakeHit(s, phrases());
                if (p != null) { woke(p, SpeechTuning.clean(s, v)); return true; }
            }
            if (alwaysArmed() && !top.trim().isEmpty()) { woke("", top); return true; }
            return false;
        }
        @Override public void onPartialResults(Bundle b) { heard(b, false); }
        @Override public void onResults(Bundle b) { heard(b, true); main.postDelayed(WatchService.this::listenLoop, 150); }
        @Override public void onError(int error) {
            // Silence or nothing understood: straight back to listening (the tone is silenced, so no beep loop).
            long wait = error == SpeechRecognizer.ERROR_RECOGNIZER_BUSY ? 3_000
                : error == SpeechRecognizer.ERROR_NO_MATCH || error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT ? 150 : 800;
            main.postDelayed(WatchService.this::listenLoop, wait);
        }
        @Override public void onReadyForSpeech(Bundle b) {}
        @Override public void onBeginningOfSpeech() {}
        @Override public void onRmsChanged(float db) {
            if (overlay != null) overlay.pushLevel(db);
            long now = System.currentTimeMillis();
            if (now - lastLevelEvent >= 100) { lastLevelEvent = now; AmberxNativePlugin.level(db); }
        }
        @Override public void onBufferReceived(byte[] b) {}
        @Override public void onEndOfSpeech() {}
        @Override public void onEvent(int t, Bundle b) {}
    }

    private void woke(String phrase, String text) {
        if (overlay != null) overlay.flashWake();
        // On screen: straight to the web side, no alert, no activity start.
        if (inApp && AmberxNativePlugin.wakeInApp(phrase, text)) return;
        Intent open = new Intent(this, MainActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP)
            .putExtra(MainActivity.EXTRA_WAKE, phrase).putExtra(MainActivity.EXTRA_WAKE_TEXT, text);
        PendingIntent pi = PendingIntent.getActivity(this, 2, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        String what = phrase.isEmpty() ? "Heard \"" + text + "\". Tap to run it." : "Heard \"" + phrase + "\". Tap to talk.";
        Notification n = new NotificationCompat.Builder(this, CH_WAKE)
            .setSmallIcon(R.mipmap.ic_launcher).setContentTitle("AmberX is listening").setContentText(what)
            .setPriority(NotificationCompat.PRIORITY_HIGH).setCategory(NotificationCompat.CATEGORY_CALL)
            .setContentIntent(pi).setFullScreenIntent(pi, true).setAutoCancel(true).setTimeoutAfter(30_000)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE).build();
        getSystemService(NotificationManager.class).notify(ID_WAKE, n);
        try { startActivity(open); } catch (Exception ignored) { /* background start refused: the alert opens it */ }
    }

    /* ---------------------------------------------------------------- detection overlay */

    /** Shows or hides the overlay to match the voice config (hands-free on, overlay on, permission granted). */
    void syncOverlay() {
        boolean want = handsFree(this) && voice(this).optBoolean("overlay", true) && DetectionOverlay.canDraw(this);
        if (want) {
            if (overlay == null) overlay = new DetectionOverlay(this);
            overlay.setColors(voice(this).optJSONObject("colors"));
            overlay.setListening(listening, alwaysArmed());
            overlay.setArmed(alwaysArmed());
            overlay.show();
        } else hideOverlay();
    }

    private void hideOverlay() {
        if (overlay != null) { overlay.hide(); overlay = null; }
    }

    /* ---------------------------------------------------------------- notifications */

    static void channels(Context c) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        nm.createNotificationChannel(new NotificationChannel(CH_WATCH, "Watching axHub", NotificationManager.IMPORTANCE_LOW));
        nm.createNotificationChannel(new NotificationChannel(CH_APPROVALS, "Approvals", NotificationManager.IMPORTANCE_HIGH));
        nm.createNotificationChannel(new NotificationChannel(CH_WAKE, "Wake phrase", NotificationManager.IMPORTANCE_HIGH));
        nm.createNotificationChannel(new NotificationChannel(CH_CONSOLE, "Console alerts", NotificationManager.IMPORTANCE_HIGH));
        VetoAlerts.channels(c);
    }

    private Notification ongoing(boolean mic) {
        PendingIntent open = PendingIntent.getActivity(this, 0, new Intent(this, MainActivity.class), PendingIntent.FLAG_IMMUTABLE);
        PendingIntent stop = PendingIntent.getService(this, 1, new Intent(this, WatchService.class).setAction(ACTION_STOP), PendingIntent.FLAG_IMMUTABLE);
        boolean watching = prefs(this).getBoolean("on", false);
        String hearing = alwaysArmed() ? "listening (always armed)" : "listening for " + String.join(" / ", phrases());
        String what = watching ? (mic ? "Watching axHub and " + hearing : "Watching axHub for approvals") : (mic ? "Hands-free: " + hearing : "Hands-free is waiting for the microphone");
        NotificationCompat.Builder b = new NotificationCompat.Builder(this, CH_WATCH)
            .setSmallIcon(R.mipmap.ic_launcher).setContentTitle("AmberX").setContentText(what)
            .setOngoing(true).setContentIntent(open);
        // Hands-free always listens: no Stop here (turn it off in Voice control). Watching axHub alone keeps its Stop.
        if (!handsFree(this)) b.addAction(0, "Stop", stop);
        return b.build();
    }

    private Notification alert(String channel, String title, String text, String url, boolean full) {
        Intent open = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP).putExtra(MainActivity.EXTRA_OPEN, url);
        PendingIntent pi = PendingIntent.getActivity(this, url.hashCode(), open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        NotificationCompat.Builder b = new NotificationCompat.Builder(this, channel)
            .setSmallIcon(R.mipmap.ic_launcher).setContentTitle(title).setContentText(text)
            .setPriority(NotificationCompat.PRIORITY_HIGH).setContentIntent(pi).setAutoCancel(true)
            // The lock screen shows only that something is waiting, never what.
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setPublicVersion(new NotificationCompat.Builder(this, channel).setSmallIcon(R.mipmap.ic_launcher).setContentTitle("Approval waiting").build());
        if (full) b.setCategory(NotificationCompat.CATEGORY_REMINDER);
        return b.build();
    }

    /** A console alert: tap opens the Dev Console in the browser (its own sign-in), never inside the app. */
    private Notification consoleAlert(HubRules.ConsoleAlert c) {
        Intent view = new Intent(Intent.ACTION_VIEW, android.net.Uri.parse(HubRules.CONSOLE)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        PendingIntent pi = PendingIntent.getActivity(this, ("console:" + c.key).hashCode(), view, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        String label = "critical".equals(c.severity) || "error".equals(c.severity) ? "Console error" : "Console warning";
        return new NotificationCompat.Builder(this, CH_CONSOLE)
            .setSmallIcon(R.mipmap.ic_launcher).setContentTitle(label + ": " + c.title).setContentText(c.body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(c.body))
            .setPriority(NotificationCompat.PRIORITY_HIGH).setContentIntent(pi).setAutoCancel(true)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setPublicVersion(new NotificationCompat.Builder(this, CH_CONSOLE).setSmallIcon(R.mipmap.ic_launcher).setContentTitle(label).build())
            .build();
    }

    private static void setStatus(JSONObject s) {
        status = s;
        StatusListener l = listener;
        if (l != null) l.changed(s);
    }
}
