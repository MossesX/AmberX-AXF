package ai.amberx.droid;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.webkit.CookieManager;
import com.getcapacitor.JSObject;
import java.security.SecureRandom;
import org.json.JSONObject;

/**
 * AmberX's AXPP link to axHub (axHub decision #108): the phone is the `amberx` device service, so Claude can drive the
 * Audio Output Recorder through axHub's MCP (`amberx.recorder_start|stop|status`).
 *
 * One background thread per process (started by the recorder plugin when AmberX opens and by {@link WatchService}, so it
 * keeps running while the watch is on): `hello` with the phone's hub session (capability `recorder@1`), then long polls
 * `/axpp/v1/next` and answers each call on `/axpp/v1/answer`. Signed out: it waits and tries again; nothing is sent
 * anywhere but the one hub ({@link HubRules#axpp}).
 *
 * Commands drive the existing recorder, never a new one:
 *  - `recorder.start` sets the session ({@link RecorderControl#sessionOf}) and opens the recorder's own consent flow
 *    ({@link OutputRecordStartActivity}: Android's capture prompt, every start) at once where Android lets it, plus a
 *    "Start recording: <session>" notification that opens it with one tap. Approval happened on axHub (Brett's Approve);
 *    Android's prompt is the phone's own second yes. The microphone is never involved.
 *  - `recorder.stop` stops it the same way the notification's Stop does.
 *  - `recorder.status` answers on/off, since, session, current file, uploaded parts and the queue.
 */
final class AxppLink {
    private AxppLink() {}

    static final String CAPABILITY = "recorder@1";
    static final int NOTE_PROMPT = 7312;
    private static final String CHANNEL = "amberx-recorder-remote";
    private static final int POLL_SECONDS = 25;
    private static Thread thread;
    private static Context app;
    private static final Handler main = new Handler(Looper.getMainLooper());

    /** Starts the link once per process (safe to call often). */
    static synchronized void ensure(Context c) {
        app = c.getApplicationContext();
        if (thread != null && thread.isAlive()) return;
        thread = new Thread(AxppLink::loop, "amberx-axpp");
        thread.setDaemon(true);
        thread.start();
    }

    static String deviceId(Context c) {
        SharedPreferences p = c.getSharedPreferences(OutputRecordQueue.PREFS, Context.MODE_PRIVATE);
        String id = p.getString("axpp.deviceId", "");
        if (id != null && id.matches("[A-Za-z0-9_-]{8,64}")) return id;
        StringBuilder b = new StringBuilder("amberx-");
        SecureRandom r = new SecureRandom();
        for (int i = 0; i < 16; i++) b.append(Integer.toHexString(r.nextInt(16)));
        p.edit().putString("axpp.deviceId", b.toString()).apply();
        return b.toString();
    }

    /* ---------------------------------------------------------------- the loop */

    private static void loop() {
        boolean welcomed = false;
        int failures = 0;
        while (true) {
            long wait = 0;
            try {
                String cookie = CookieManager.getInstance().getCookie(HubRules.HUB);
                if (cookie == null || cookie.isEmpty()) { welcomed = false; wait = 60_000; }
                else {
                    String id = deviceId(app);
                    if (!welcomed) {
                        HubRules.Reply r = HubRules.axpp("hello", hello(id).toString(), cookie, 15_000);
                        if (r.status == 200) { welcomed = true; failures = 0; }
                        else wait = r.status == 401 || r.status == 403 ? 60_000 : backoff(++failures);
                    }
                    if (welcomed) {
                        JSONObject ask = new JSONObject().put("deviceId", id).put("wait", POLL_SECONDS);
                        HubRules.Reply r = HubRules.axpp("next", ask.toString(), cookie, (POLL_SECONDS + 15) * 1000);
                        if (r.status == 200) { failures = 0; answer(id, new JSONObject(r.body), cookie); }
                        else if (r.status == 204) failures = 0;
                        else { welcomed = false; wait = r.status == 401 || r.status == 403 ? 60_000 : backoff(++failures); } // 404 = the hub restarted: hello again
                    }
                }
            } catch (Exception e) {
                welcomed = false;
                wait = backoff(++failures);
            }
            if (wait > 0) {
                try { Thread.sleep(wait); } catch (InterruptedException e) { return; }
            }
        }
    }

    private static long backoff(int failures) {
        long[] steps = { 5_000, 15_000, 30_000, 60_000 };
        return steps[Math.min(failures, steps.length) - 1];
    }

    private static JSONObject hello(String id) throws Exception {
        JSONObject state = new JSONObject().put(CAPABILITY, status(app));
        JSONObject p = new JSONObject()
            .put("deviceId", id)
            .put("name", (Build.MANUFACTURER + " " + Build.MODEL).trim())
            .put("app", "amberx-droid")
            .put("capabilities", new org.json.JSONArray().put(CAPABILITY))
            .put("state", state);
        return envelope("hello", null, p);
    }

    private static JSONObject envelope(String kind, String correlationId, JSONObject payload) throws Exception {
        JSONObject e = new JSONObject().put("protocol", "axpp@1").put("kind", kind).put("id", java.util.UUID.randomUUID().toString()).put("payload", payload);
        if (correlationId != null) e.put("correlationId", correlationId);
        return e;
    }

    /** Runs one call and posts its result (or error) back. */
    private static void answer(String deviceId, JSONObject call, String cookie) throws Exception {
        String callId = call.optString("id");
        JSONObject p = call.optJSONObject("payload");
        String tool = p == null ? "" : p.optString("tool");
        JSONObject args = p == null ? new JSONObject() : p.optJSONObject("arguments");
        JSONObject reply;
        try {
            if (!"call".equals(call.optString("kind")) || !RecorderControl.known(tool)) throw new IllegalArgumentException("AmberX doesn't know \"" + tool + "\".");
            JSONObject data = run(tool, args == null ? new JSONObject() : args);
            reply = envelope("result", callId, new JSONObject().put("data", data).put("state", new JSONObject().put(CAPABILITY, status(app))));
        } catch (Exception e) {
            reply = envelope("error", callId, new JSONObject().put("code", "unavailable").put("message", String.valueOf(e.getMessage())));
        }
        HubRules.axpp("answer", new JSONObject().put("deviceId", deviceId).put("envelope", reply).toString(), cookie, 15_000);
    }

    /* ---------------------------------------------------------------- the commands */

    static JSONObject run(String tool, JSONObject args) throws Exception {
        Context c = app;
        switch (tool) {
            case RecorderControl.START: {
                RecorderControl.Session s = RecorderControl.sessionOf(args);
                if (OutputRecordService.running) {
                    // already recording: the parts from now on carry this session's name and group
                    OutputRecordQueue.setSession(c, s);
                    OutputRecordQueue.sessionStarted(c, System.currentTimeMillis());
                    return status(c).put("alreadyRunning", true);
                }
                OutputRecordQueue.setSession(c, s);
                askToStart(c, s);
                return status(c).put("awaitingConsent", true);
            }
            case RecorderControl.STOP: {
                boolean was = OutputRecordService.running;
                if (was) c.startService(new Intent(c, OutputRecordService.class).setAction(OutputRecordService.ACTION_STOP).putExtra(OutputRecordService.EXTRA_REASON, "Stopped from axHub."));
                else OutputRecordQueue.clearSession(c);
                cancelPrompt(c);
                return status(c).put("running", false).put("wasRunning", was);
            }
            default:
                return status(c);
        }
    }

    /** What `recorder_status` shows: on/off, since, session, current file, uploaded parts, the queue; never the mic. */
    static JSONObject status(Context c) throws Exception {
        JSObject up = OutputRecordUploader.status(c);
        JSObject rec = OutputRecordService.status();
        JSONObject s = OutputRecordQueue.session(c);
        JSONObject o = new JSONObject()
            .put("running", OutputRecordService.running)
            .put("since", rec.has("startedAt") && !rec.isNull("startedAt") ? rec.getString("startedAt") : JSONObject.NULL)
            .put("currentFile", OutputRecordService.running && OutputRecordService.currentName != null ? OutputRecordService.currentName : JSONObject.NULL)
            .put("mic", false)
            .put("queue", new JSONObject()
                .put("waiting", up.getInteger("waiting", 0))
                .put("waitingBytes", up.optLong("waitingBytes"))
                .put("upload", up.getString("upload", "idle"))
                .put("message", up.getString("message", ""))
                .put("lastUploadAt", up.getString("lastUploadAt", "")));
        if (s != null) {
            o.put("session", s.optString("name")).put("group", s.optString("group")).put("parts", s.optInt("parts")).put("uploaded", s.optInt("uploaded"));
            if (!s.optString("note").isEmpty()) o.put("note", s.optString("note"));
        } else {
            o.put("session", JSONObject.NULL).put("uploaded", 0);
        }
        return o;
    }

    /* ---------------------------------------------------------------- the phone's own yes (Android's capture prompt) */

    /**
     * Opens the recorder's consent flow now (Android allows it while AmberX is on screen or may draw over other apps)
     * and posts a "Start recording: <session>" notification that opens it with one tap, in case Android held it back.
     */
    private static void askToStart(Context c, RecorderControl.Session s) {
        main.post(() -> {
            try { c.startActivity(OutputRecordStartActivity.intent(c)); } catch (RuntimeException ignored) { /* background start refused: the notification does it */ }
            NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && nm.getNotificationChannel(CHANNEL) == null) {
                NotificationChannel ch = new NotificationChannel(CHANNEL, "Recording asked from axHub", NotificationManager.IMPORTANCE_HIGH);
                ch.setDescription("A session recording approved on axHub, waiting for Android's capture prompt");
                nm.createNotificationChannel(ch);
            }
            PendingIntent open = PendingIntent.getActivity(c, 3, OutputRecordStartActivity.intent(c), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
            Notification.Builder b = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O ? new Notification.Builder(c, CHANNEL) : new Notification.Builder(c);
            b.setSmallIcon(android.R.drawable.ic_btn_speak_now)
                .setContentTitle("Start recording: " + s.name)
                .setContentText("Approved on axHub. Tap to allow Android's capture prompt (phone audio only, mic off).")
                .setContentIntent(open)
                .setAutoCancel(true);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) b.setTimeoutAfter(10 * 60_000L);
            nm.notify(NOTE_PROMPT, b.build());
        });
    }

    static void cancelPrompt(Context c) {
        ((NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE)).cancel(NOTE_PROMPT);
    }

    /** Android's prompt was refused or failed: the ask is over (the session was cleared by the caller). */
    static void consentRefused(Context c, String message) {
        cancelPrompt(c);
    }
}
