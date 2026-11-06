package ai.amberx.droid;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.speech.RecognitionListener;
import android.speech.SpeechRecognizer;
import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;
import androidx.core.content.ContextCompat;
import java.util.ArrayList;
import org.json.JSONObject;

/**
 * Gizmo's talk mode with the screen off (Nov 6 2026, Fable, build gizmo-rebuild-fable; Brett: "Talk mode works with
 * the screen off / app backgrounded"). A foreground service of type microphone that owns the listening half of a
 * conversation: one Google utterance at a time (partials and the final text go to the page as `talk` events), then it
 * waits while the page sends the text to Gizmo and speaks the reply, and listens again when the page says so
 * (`talkPhase`). The page keeps the conversation, the transcript and the speech; this service keeps the microphone,
 * the process and the notification alive while AmberX is in the background or the screen is off.
 *
 * - **One owner of the mic:** it takes the microphone through {@link MicGuard#acquire} (talk mode outranks Speak and
 *   hands-free, which pause and come back when it ends) and hands-free is told to step aside ({@link WatchService#appMic}).
 * - **Audio focus:** transient focus for the whole session ({@link AudioFocusGuard}); a call or another app taking it
 *   pauses the turns (`paused` event, reason) and they resume when the focus comes back; the policy's pause-for-calls
 *   and pause-for-other-apps switches (listener `talk`, {@link ListenerRegistry}) decide whether it yields.
 * - **Restarts back off:** a turn refused at once (busy, no audio) waits 1 s, 2 s, 4 s… and after the policy's retries
 *   the session stops with the error (shown in Listeners and said to the page); silence restarts at once; the tone
 *   stays muted on every turn but a start the person asked for with the sound switched on.
 * - **Stop from the notification:** the ongoing notification shows the last line heard or said and a Stop button;
 *   Stop ends the session everywhere (a `stopped` event with `why: notification`).
 * - **A page that went away** (no `talkPhase` / `talkStatus` for {@link #PAGE_TIMEOUT_MS}) ends the session, so the
 *   microphone is never held by a conversation nobody is having.
 */
public class TalkService extends Service {
    static final String ACTION_START = "ai.amberx.droid.talk.START";
    static final String ACTION_STOP = "ai.amberx.droid.talk.STOP";
    static final String EXTRA_REASON = "reason";
    static final String EXTRA_BY = "by";
    static final String CH_TALK = "talk";
    private static final int ID_ONGOING = 11;
    private static final String PREFS = "amberx.talk";
    /** No word from the page for this long = the conversation is over. */
    static final long PAGE_TIMEOUT_MS = 20 * 60_000;
    /** The page took this long to answer a final result: listen again anyway. */
    static final long THINK_TIMEOUT_MS = 120_000;

    static volatile TalkService running;
    private static volatile String lastStop = "";
    private static volatile long startedAt;

    private final Handler main = new Handler(Looper.getMainLooper());
    private SpeechRecognizer rec;
    private int gen;
    private boolean turnOpen;
    private long turnStartedAt;
    private int attempts;
    private boolean firstTurn = true;
    /** listening | thinking | speaking | paused */
    private volatile String phase = "listening";
    private volatile String line = "";
    private volatile String pausedWhy = "";
    private String lang = "en-US";
    private boolean listenWhileSpeaking;
    private AudioFocusGuard focus;
    private volatile boolean focusLost;
    private long pageSeenAt;
    private final Runnable pageWatch = this::checkPage;
    private final Runnable thinkWatch = () -> { if ("thinking".equals(phase)) { phase = "listening"; startTurn(); } };

    /* ---------------------------------------------------------------- the page's calls */

    /** Starts (or re-configures) talk mode: `lang`, `listenWhileSpeaking` (interrupt on), `sound` (the start tone, once). */
    static JSONObject start(Context c, JSONObject opts) {
        c.getApplicationContext().getSharedPreferences(PREFS, MODE_PRIVATE).edit().putString("opts", opts == null ? "{}" : opts.toString()).apply();
        ContextCompat.startForegroundService(c, new Intent(c, TalkService.class).setAction(ACTION_START));
        return status();
    }

    static void stop(Context c, String reason) {
        TalkService t = running;
        if (t != null) t.main.post(() -> t.end(reason, "app"));
        else { try { c.startService(new Intent(c, TalkService.class).setAction(ACTION_STOP).putExtra(EXTRA_REASON, reason).putExtra(EXTRA_BY, "app")); } catch (RuntimeException ignored) { /* not running */ } }
    }

    /** The page's half of the turn: `listening` (speak done: listen again), `thinking`, `speaking` (+ the line to show). */
    static JSONObject phase(String phase, String line) {
        TalkService t = running;
        if (t != null) t.main.post(() -> t.setPhase(phase, line));
        return status();
    }

    static JSONObject status() {
        TalkService t = running;
        JSONObject o = new JSONObject();
        try {
            o.put("running", t != null).put("phase", t == null ? "off" : t.phase).put("line", t == null ? "" : t.line)
                .put("since", t == null ? JSONObject.NULL : startedAt).put("pausedWhy", t == null ? "" : t.pausedWhy)
                .put("attempts", t == null ? 0 : t.attempts).put("lastStop", lastStop)
                .put("holdsMic", ListenerRules.TALK.equals(MicGuard.holder()));
        } catch (Exception ignored) {}
        if (t != null) t.pageSeenAt = System.currentTimeMillis();
        return o;
    }

    /** The listener-state@1 row for the Listeners panel. */
    static JSONObject row(Context c, String holder) {
        TalkService t = running;
        JSONObject o = new JSONObject();
        String state, detail = "";
        if (!ListenerRegistry.allowed(c, ListenerRules.TALK)) state = "off";
        else if (t == null) { state = "off"; detail = lastStop; }
        else if ("paused".equals(t.phase)) { state = "yielded"; detail = t.pausedWhy; }
        else { state = "on"; detail = "listening".equals(t.phase) ? "Listening" : "thinking".equals(t.phase) ? "Gizmo is thinking" : "Gizmo is talking"; }
        try {
            o.put("id", ListenerRules.TALK).put("side", "native").put("state", state).put("detail", detail).put("holdsMic", ListenerRules.TALK.equals(holder))
                .put("since", t == null ? 0 : startedAt).put("attempts", t == null ? 0 : t.attempts).put("policy", ListenerRegistry.policy(c, ListenerRules.TALK).json());
        } catch (Exception ignored) {}
        return o;
    }

    /* ---------------------------------------------------------------- the service */

    @Override public IBinder onBind(Intent intent) { return null; }

    @Override
    public void onCreate() {
        super.onCreate();
        channel(this);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String a = intent == null ? ACTION_START : intent.getAction();
        if (ACTION_STOP.equals(a)) {
            String by = intent.getStringExtra(EXTRA_BY);
            end(intent.getStringExtra(EXTRA_REASON), by == null ? "notification" : by);
            return START_NOT_STICKY;
        }
        begin();
        return START_NOT_STICKY; // a conversation never comes back by itself after the process dies
    }

    @Override
    public void onDestroy() {
        if (running == this) end("AmberX stopped the service.", "system");
        super.onDestroy();
    }

    private void begin() {
        JSONObject opts;
        try { opts = new JSONObject(getSharedPreferences(PREFS, MODE_PRIVATE).getString("opts", "{}")); } catch (Exception e) { opts = new JSONObject(); }
        String l = opts.optString("lang", "");
        lang = l.isEmpty() ? "en-US" : l;
        listenWhileSpeaking = opts.optBoolean("listenWhileSpeaking", true);
        boolean restart = running == this;
        if (!restart) {
            if (!ListenerRegistry.allowed(this, ListenerRules.TALK)) { refuse("Talk mode is switched off in Listeners."); return; }
            if (!MicGuard.mayOpen(this)) { refuse("Mic off is on. Turn the mic back on to talk to Gizmo."); return; }
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) { refuse("The microphone isn't allowed."); return; }
            if (!SpeechRecognizer.isRecognitionAvailable(this)) { refuse("No speech recognizer on this phone."); return; }
            try {
                ServiceCompat.startForeground(this, ID_ONGOING, ongoing(), Build.VERSION.SDK_INT >= 29 ? ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE : 0);
            } catch (Exception e) {
                // Android 14+ refuses a microphone service started from the background: say so, don't half-run.
                refuse("Android wouldn't let talk mode start from the background. Open AmberX and start it again.");
                return;
            }
            running = this;
            startedAt = System.currentTimeMillis();
            lastStop = "";
            attempts = 0;
            firstTurn = true;
            phase = "listening";
            line = "";
            pausedWhy = "";
            focusLost = false;
            pageSeenAt = System.currentTimeMillis();
            MicGuard.acquire(ListenerRules.TALK);
            WatchService.appMic(true);
            if (focus == null) focus = new AudioFocusGuard(this, new Focus());
            focus.request();
            ListenerRegistry.error(ListenerRules.TALK, null);
            emit("started", null);
            main.removeCallbacks(pageWatch);
            main.postDelayed(pageWatch, PAGE_TIMEOUT_MS);
            startTurn();
        } else {
            refreshNote();
        }
        ListenerRegistry.changed();
    }

    private void refuse(String why) {
        lastStop = why;
        ListenerRegistry.error(ListenerRules.TALK, why);
        JSONObject e = new JSONObject();
        try { e.put("why", "refused").put("error", why); } catch (Exception ignored) {}
        emit("stopped", e);
        try { ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE); } catch (Exception ignored) {}
        stopSelf();
    }

    /** The session is over: the microphone and the focus go back, hands-free comes back, the page hears why. */
    private void end(String reason, String by) {
        if (running != this) { try { ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE); } catch (Exception ignored) {} stopSelf(); return; }
        running = null;
        main.removeCallbacksAndMessages(null);
        closeTurn();
        if (focus != null) focus.abandon();
        SpeechTuning.loud(this);
        MicGuard.releaseOwner(ListenerRules.TALK);
        WatchService.appMic(false);
        lastStop = reason == null || reason.isEmpty() ? ("notification".equals(by) ? "Stopped from the notification." : "Stopped.") : reason;
        JSONObject e = new JSONObject();
        try { e.put("why", by).put("reason", lastStop); } catch (Exception ignored) {}
        emit("stopped", e);
        try { ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE); } catch (Exception ignored) {}
        ListenerRegistry.changed();
        stopSelf();
    }

    private void checkPage() {
        if (running != this) return;
        if (System.currentTimeMillis() - pageSeenAt > PAGE_TIMEOUT_MS) { end("AmberX's page stopped answering, so talk mode ended.", "timeout"); return; }
        main.postDelayed(pageWatch, 60_000);
    }

    /* ---------------------------------------------------------------- phases */

    private void setPhase(String p, String l) {
        if (running != this) return;
        pageSeenAt = System.currentTimeMillis();
        if (l != null && !l.isEmpty()) line = l.length() > 120 ? l.substring(0, 120) + "…" : l;
        if (!"listening".equals(p) && !"thinking".equals(p) && !"speaking".equals(p)) { refreshNote(); return; }
        main.removeCallbacks(thinkWatch);
        if ("paused".equals(phase)) { pausedWhyKept = p; refreshNote(); return; } // yielded: remembered, applied when the mic is back
        phase = p;
        if ("listening".equals(p)) startTurn();
        else if ("speaking".equals(p)) { if (listenWhileSpeaking) startTurn(); else closeTurn(); }
        else { closeTurn(); main.postDelayed(thinkWatch, THINK_TIMEOUT_MS); }
        refreshNote();
        ListenerRegistry.changed();
    }
    private String pausedWhyKept = "listening";

    /** The policy's view of the scene right now: why talk mode must let go of the mic, or null. */
    private String yieldNow() {
        ListenerRules.Policy pol = ListenerRegistry.policy(this, ListenerRules.TALK);
        return ListenerRules.yieldReason(MicGuard.off(this), MicRules.callMode(MicGuard.mode(this)), false, false, focusLost, pol);
    }

    private void pause(String why) {
        if (!"paused".equals(phase)) pausedWhyKept = phase;
        phase = "paused";
        pausedWhy = why;
        closeTurn();
        JSONObject e = new JSONObject();
        try { e.put("reason", why).put("label", ListenerRules.yieldLabel(why)); } catch (Exception ignored) {}
        emit("paused", e);
        refreshNote();
        ListenerRegistry.changed();
        main.removeCallbacks(resumeCheck);
        main.postDelayed(resumeCheck, MicRules.CHECK_EVERY_MS);
    }
    private final Runnable resumeCheck = this::tryResume;
    private long freeSince = -1;

    private void tryResume() {
        if (running != this || !"paused".equals(phase)) return;
        String why = yieldNow();
        long now = System.currentTimeMillis();
        if ("mic-off".equals(why)) { end("Mic off was switched on.", "mic-off"); return; }
        if (why != null) { freeSince = -1; pausedWhy = why; main.postDelayed(resumeCheck, MicRules.CHECK_EVERY_MS); return; }
        if (freeSince < 0) freeSince = now;
        if (!ListenerRules.mayResume(pausedWhy, freeSince, now)) { main.postDelayed(resumeCheck, MicRules.CHECK_EVERY_MS); return; }
        freeSince = -1;
        phase = pausedWhyKept;
        pausedWhy = "";
        emit("resumed", null);
        if (focus != null && !focus.held()) focus.request();
        if ("listening".equals(phase) || "speaking".equals(phase) && listenWhileSpeaking) startTurn();
        refreshNote();
        ListenerRegistry.changed();
    }

    private class Focus implements AudioFocusGuard.Events {
        @Override public void lost(boolean transientLoss) {
            focusLost = true;
            if (ListenerRegistry.policy(TalkService.this, ListenerRules.TALK).pauseForOtherApps) pause(MicRules.callMode(MicGuard.mode(TalkService.this)) ? "call" : "other-app");
        }
        @Override public void regained() { focusLost = false; main.post(TalkService.this::tryResume); }
    }

    /* ---------------------------------------------------------------- turns */

    private void startTurn() {
        if (running != this || turnOpen) return;
        String why = yieldNow();
        if ("mic-off".equals(why)) { end("Mic off was switched on.", "mic-off"); return; }
        if (why != null) { pause(why); return; }
        if (!MicGuard.acquire(ListenerRules.TALK)) { pause("other-app"); return; }
        JSONObject voice = WatchService.voice(this);
        ListenerRules.Policy pol = ListenerRegistry.policy(this, ListenerRules.TALK);
        boolean tone = firstTurn && ListenerRules.startSound(pol, "user");
        if (!tone) SpeechTuning.quiet(this, voice); else SpeechTuning.loud(this);
        firstTurn = false;
        final int g = ++gen;
        SpeechRecognizer r = SpeechRecognizer.createSpeechRecognizer(this);
        rec = r;
        turnOpen = true;
        turnStartedAt = System.currentTimeMillis();
        r.setRecognitionListener(new Turn(g, voice));
        Intent i = SpeechTuning.request(lang, voice, false);
        try { r.startListening(i); } catch (Exception e) { turnEnded(g, SpeechRecognizer.ERROR_CLIENT); }
    }

    private void closeTurn() {
        gen++;
        turnOpen = false;
        SpeechRecognizer r = rec;
        rec = null;
        if (r != null) { try { r.cancel(); r.destroy(); } catch (Exception ignored) {} WatchService.recognizerEnded(); }
    }

    private class Turn implements RecognitionListener {
        private final int g;
        private final JSONObject voice;
        Turn(int g, JSONObject voice) { this.g = g; this.voice = voice; }
        private String top(Bundle b) {
            ArrayList<String> r = b == null ? null : b.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
            return r == null || r.isEmpty() ? "" : SpeechTuning.clean(r.get(0), voice);
        }
        @Override public void onPartialResults(Bundle b) {
            if (g != gen) return;
            String t = top(b);
            if (t.isEmpty()) return;
            JSONObject e = new JSONObject();
            try { e.put("text", t).put("final", false); } catch (Exception ignored) {}
            emit("heard", e);
        }
        @Override public void onResults(Bundle b) {
            if (g != gen) return;
            String t = top(b).trim();
            attempts = 0;
            ListenerRegistry.attempts(ListenerRules.TALK, 0);
            closeTurn();
            if (t.isEmpty()) { startTurn(); return; }
            line = t;
            JSONObject e = new JSONObject();
            try { e.put("text", t).put("final", true).put("phase", phase); } catch (Exception ignored) {}
            emit("heard", e);
            // Said while Gizmo talks (an interrupt, or an aside): the page decides; we keep listening meanwhile.
            if ("speaking".equals(phase)) { startTurn(); refreshNote(); return; }
            phase = "thinking";
            main.removeCallbacks(thinkWatch);
            main.postDelayed(thinkWatch, THINK_TIMEOUT_MS);
            refreshNote();
        }
        @Override public void onError(int error) { if (g == gen) turnEnded(g, error); }
        @Override public void onReadyForSpeech(Bundle b) {}
        @Override public void onBeginningOfSpeech() {}
        @Override public void onRmsChanged(float db) { AmberxNativePlugin.level(db); }
        @Override public void onBufferReceived(byte[] b) {}
        @Override public void onEndOfSpeech() {}
        @Override public void onEvent(int t, Bundle b) {}
    }

    /** A turn ended on an error: silence listens again; a refusal backs off and, past the policy's retries, ends talk mode. */
    private void turnEnded(int g, int error) {
        if (g != gen || running != this) return;
        long ran = System.currentTimeMillis() - turnStartedAt;
        closeTurn();
        ListenerRules.Policy pol = ListenerRegistry.policy(this, ListenerRules.TALK);
        if (WatchService.quietRecognizerError(error)) { attempts = 0; ListenerRegistry.attempts(ListenerRules.TALK, 0); main.postDelayed(this::startTurn, 150); return; }
        ListenerRules.EndPlan plan = ListenerRules.afterEnd(attempts, error == SpeechRecognizer.ERROR_RECOGNIZER_BUSY || error == SpeechRecognizer.ERROR_AUDIO ? 0 : ran, pol, WatchService.fatalRecognizerError(error));
        attempts = plan.attempts;
        ListenerRegistry.attempts(ListenerRules.TALK, plan.attempts);
        String why = WatchService.recognizerError(error);
        if (plan.gaveUp) {
            ListenerRegistry.error(ListenerRules.TALK, why);
            JSONObject e = new JSONObject();
            try { e.put("error", why); } catch (Exception ignored) {}
            emit("error", e);
            end("Talk mode stopped: " + why + ".", "error");
            return;
        }
        ListenerRegistry.error(ListenerRules.TALK, why + " · retry " + plan.attempts + (pol.retries >= 0 ? "/" + pol.retries : ""));
        main.postDelayed(this::startTurn, plan.delay);
    }

    /* ---------------------------------------------------------------- events + notification */

    private void emit(String kind, JSONObject data) {
        JSONObject e = data == null ? new JSONObject() : data;
        try { e.put("kind", kind).put("at", System.currentTimeMillis()).put("id", AmberxNativePlugin.eventId()); } catch (Exception ignored) {}
        AmberxNativePlugin.talkEvent(e);
    }

    static void channel(Context c) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        NotificationChannel ch = new NotificationChannel(CH_TALK, "Gizmo talk mode", NotificationManager.IMPORTANCE_LOW);
        ch.setDescription("Shown while you talk with Gizmo with the screen off; Stop ends it");
        nm.createNotificationChannel(ch);
    }

    private Notification ongoing() {
        PendingIntent open = PendingIntent.getActivity(this, 0, new Intent(this, MainActivity.class), PendingIntent.FLAG_IMMUTABLE);
        PendingIntent stop = PendingIntent.getService(this, 1, new Intent(this, TalkService.class).setAction(ACTION_STOP).putExtra(EXTRA_BY, "notification"), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        String what = "paused".equals(phase) ? ListenerRules.yieldLabel(pausedWhy) : "thinking".equals(phase) ? "Gizmo is thinking…" : "speaking".equals(phase) ? "Gizmo is talking" : "Listening…";
        String text = line.isEmpty() ? what : what + " · " + line;
        return new NotificationCompat.Builder(this, CH_TALK)
            .setSmallIcon(R.mipmap.ic_launcher).setContentTitle("Gizmo talk mode").setContentText(text)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(text))
            .setOngoing(true).setOnlyAlertOnce(true).setContentIntent(open).setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .addAction(0, "Stop", stop)
            .build();
    }

    private void refreshNote() {
        if (running != this) return;
        try { getSystemService(NotificationManager.class).notify(ID_ONGOING, ongoing()); } catch (Exception ignored) { /* notifications off */ }
    }
}
