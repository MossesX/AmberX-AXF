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
import android.speech.RecognizerIntent;
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
 * - **Wake phrase:** while the app isn't on screen and phrases are set, the on-device recognizer listens for them only;
 *   when one is heard it opens AmberX to talk (a full-screen alert where Android allows it).
 *
 * Its config is the JSON the web side sends (`monitorStart`), kept in prefs so a reboot restarts the watch.
 */
public class WatchService extends Service {
    static final String PREFS = "amberx_watch";
    static final String ACTION_STOP = "ai.amberx.droid.STOP";
    static final String ACTION_CHECK = "ai.amberx.droid.CHECK";
    static final String CH_WATCH = "watch", CH_APPROVALS = "approvals", CH_WAKE = "wake";
    private static final int ID_ONGOING = 1, ID_WAKE = 2;

    /** Last status, read by the plugin; [listener] gets every change. */
    static volatile JSONObject status = idle();
    static volatile StatusListener listener;
    /** True while MainActivity is on screen (the web side listens itself then). */
    static volatile boolean inApp;

    interface StatusListener { void changed(JSONObject status); }

    private HandlerThread thread;
    private Handler work;
    private final Handler main = new Handler(Looper.getMainLooper());
    private SpeechRecognizer recognizer;
    private boolean listening;

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
        c.startService(new Intent(c, WatchService.class).setAction(ACTION_STOP));
    }

    @Override public IBinder onBind(Intent intent) { return null; }

    @Override
    public void onCreate() {
        super.onCreate();
        channels(this);
        thread = new HandlerThread("amberx-watch");
        thread.start();
        work = new Handler(thread.getLooper());
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            stopListening();
            ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE);
            setStatus(idle());
            stopSelf();
            return START_NOT_STICKY;
        }
        if (!prefs(this).getBoolean("on", false)) { stopSelf(); return START_NOT_STICKY; }
        boolean wantMic = !phrases().isEmpty() && micGranted();
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
        work.post(this::check);
        if (wantMic) main.post(this::listenLoop); else stopListening();
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        stopListening();
        if (thread != null) thread.quitSafely();
        super.onDestroy();
    }

    /* ---------------------------------------------------------------- approvals */

    private void check() {
        JSONObject cfg = config(this);
        String hub = HubRules.isHub(HubRules.HUB, cfg.optString("hub", "")) ? HubRules.HUB : null;
        int every = Math.max(15, Math.min(300, cfg.optInt("intervalSec", 30)));
        HubRules.Feed feed;
        if (hub == null) feed = new HubRules.Feed("unreachable", 0, new ArrayList<>());
        else {
            String cookie = CookieManager.getInstance().getCookie(hub);
            try {
                HubRules.Reply r = HubRules.get(hub + HubRules.FEED_PATH, cookie);
                feed = HubRules.interpret(hub, r.status, r.body);
            } catch (Exception e) {
                feed = new HubRules.Feed("unreachable", 0, new ArrayList<>());
            }
            if ("ok".equals(feed.status)) handleNew(hub, cookie, feed, cfg.optJSONObject("autoApprove"));
        }
        JSONObject s = new JSONObject();
        try {
            s.put("running", true).put("listening", listening).put("lastCheck", Instant.now().toString())
                .put("status", feed.status).put("waiting", feed.count);
        } catch (Exception ignored) {}
        setStatus(s);
        long next = "signed-out".equals(feed.status) || "not-admin".equals(feed.status) ? 300_000L : every * 1000L;
        work.postDelayed(this::check, next);
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
                nm.notify(a.id, 0, alert(CH_APPROVALS, "Approval waiting: " + a.tool, a.summary, a.url, true));
            }
        }
        for (String gone : seen) if (!now.contains(gone)) nm.cancel(gone, 0); // decided elsewhere: take its alert away
        p.edit().putStringSet("seen", now).apply();
    }

    /* ---------------------------------------------------------------- wake phrase */

    private List<String> phrases() {
        List<String> out = new ArrayList<>();
        JSONArray a = config(this).optJSONArray("wakePhrases");
        for (int i = 0; a != null && i < a.length() && out.size() < 20; i++) {
            String s = a.optString(i, "").trim().toLowerCase(Locale.ROOT);
            if (!s.isEmpty()) out.add(s);
        }
        return out;
    }

    private boolean micGranted() {
        return ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED;
    }

    private void listenLoop() {
        if (!prefs(this).getBoolean("on", false) || phrases().isEmpty() || !micGranted()) { stopListening(); return; }
        if (inApp) { stopListening(); main.postDelayed(this::listenLoop, 3_000); return; } // the app listens itself on screen
        if (!SpeechRecognizer.isRecognitionAvailable(this)) { stopListening(); return; }
        if (recognizer == null) {
            recognizer = Build.VERSION.SDK_INT >= 31 && SpeechRecognizer.isOnDeviceRecognitionAvailable(this)
                ? SpeechRecognizer.createOnDeviceSpeechRecognizer(this) : SpeechRecognizer.createSpeechRecognizer(this);
            recognizer.setRecognitionListener(new Listener());
        }
        listening = true;
        Intent i = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE, config(this).optString("lang", "en-US"))
            .putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
            .putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true);
        try { recognizer.startListening(i); } catch (Exception e) { main.postDelayed(this::listenLoop, 5_000); }
    }

    private void stopListening() {
        listening = false;
        if (recognizer != null) { try { recognizer.destroy(); } catch (Exception ignored) {} recognizer = null; }
    }

    private class Listener implements RecognitionListener {
        private boolean heard(Bundle b) {
            ArrayList<String> said = b == null ? null : b.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
            if (said == null) return false;
            for (String s : said) {
                String t = s.toLowerCase(Locale.ROOT);
                for (String p : phrases()) if (t.contains(p)) { woke(p, s); return true; }
            }
            return false;
        }
        @Override public void onPartialResults(Bundle b) { if (heard(b) && recognizer != null) recognizer.cancel(); }
        @Override public void onResults(Bundle b) { heard(b); main.postDelayed(WatchService.this::listenLoop, 400); }
        @Override public void onError(int error) { main.postDelayed(WatchService.this::listenLoop, error == SpeechRecognizer.ERROR_RECOGNIZER_BUSY ? 3_000 : 800); }
        @Override public void onReadyForSpeech(Bundle b) {}
        @Override public void onBeginningOfSpeech() {}
        @Override public void onRmsChanged(float v) {}
        @Override public void onBufferReceived(byte[] b) {}
        @Override public void onEndOfSpeech() {}
        @Override public void onEvent(int t, Bundle b) {}
    }

    private void woke(String phrase, String text) {
        Intent open = new Intent(this, MainActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP)
            .putExtra(MainActivity.EXTRA_WAKE, phrase).putExtra(MainActivity.EXTRA_WAKE_TEXT, text);
        PendingIntent pi = PendingIntent.getActivity(this, 2, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification n = new NotificationCompat.Builder(this, CH_WAKE)
            .setSmallIcon(R.mipmap.ic_launcher).setContentTitle("AmberX is listening").setContentText("Heard \"" + phrase + "\". Tap to talk.")
            .setPriority(NotificationCompat.PRIORITY_HIGH).setCategory(NotificationCompat.CATEGORY_CALL)
            .setContentIntent(pi).setFullScreenIntent(pi, true).setAutoCancel(true).setTimeoutAfter(30_000)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE).build();
        getSystemService(NotificationManager.class).notify(ID_WAKE, n);
        try { startActivity(open); } catch (Exception ignored) { /* background start refused: the alert opens it */ }
    }

    /* ---------------------------------------------------------------- notifications */

    static void channels(Context c) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        nm.createNotificationChannel(new NotificationChannel(CH_WATCH, "Watching axHub", NotificationManager.IMPORTANCE_LOW));
        nm.createNotificationChannel(new NotificationChannel(CH_APPROVALS, "Approvals", NotificationManager.IMPORTANCE_HIGH));
        nm.createNotificationChannel(new NotificationChannel(CH_WAKE, "Wake phrase", NotificationManager.IMPORTANCE_HIGH));
    }

    private Notification ongoing(boolean mic) {
        PendingIntent open = PendingIntent.getActivity(this, 0, new Intent(this, MainActivity.class), PendingIntent.FLAG_IMMUTABLE);
        PendingIntent stop = PendingIntent.getService(this, 1, new Intent(this, WatchService.class).setAction(ACTION_STOP), PendingIntent.FLAG_IMMUTABLE);
        String what = mic ? "Watching axHub and listening for " + String.join(" / ", phrases()) : "Watching axHub for approvals";
        return new NotificationCompat.Builder(this, CH_WATCH)
            .setSmallIcon(R.mipmap.ic_launcher).setContentTitle("AmberX").setContentText(what)
            .setOngoing(true).setContentIntent(open).addAction(0, "Stop", stop).build();
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

    private static void setStatus(JSONObject s) {
        status = s;
        StatusListener l = listener;
        if (l != null) l.changed(s);
    }
}
