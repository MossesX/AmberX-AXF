package ai.amberx.droid;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.ConnectivityManager;
import android.net.Network;
import android.os.Handler;
import android.os.Looper;
import android.util.Base64;
import android.webkit.CookieManager;
import com.getcapacitor.JSObject;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.RandomAccessFile;
import java.security.MessageDigest;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
import org.json.JSONObject;

/**
 * Sends finished chunks to axHub and keeps each one on the phone until axHub confirms it.
 *
 * Where: axHub's data server (the store AmberX notes use, `PUT /data/<project>/…` with the phone's hub session), in
 * its own hub project (`amberx-recordings` by default) so recordings never eat the 100 MB the project's notes, plans
 * and logs share. The data server takes text documents of at most 64 KB, so a chunk goes up as numbered parts
 * (44 000 bytes of audio each, base64 in a small JSON document), then its index:
 *   output-recorder/parts/<id>/0000.json …   {"$axf":"audio-part@1","id","n","b64"}
 *   output-recorder/recordings/<id>.json      {"$axf":"audio-recording@1","id","name","startedAt",…,"parts","sha256"}
 * Confirmed = every part PUT answered 200 and the index read back from the hub has the same parts, bytes and SHA-256;
 * only then is the local file removed. Parts already sent are remembered (`uploadedParts`), so a retry carries on.
 *
 * Offline / hub down: the chunk stays queued; retries back off 30 s → 1 → 2 → 5 → 15 min, and run at once when the
 * network comes back, when a chunk closes, or when AmberX opens. Signed out of the hub or the hub project full: it
 * stops trying and says so (the page shows it). Local cap: see {@link #chunkClosed}. Web twin: output-recorder core.ts.
 */
final class OutputRecordUploader {
    private OutputRecordUploader() {}

    static final int PART_BYTES = 44_000;
    private static final long[] BACKOFF_MS = { 30_000, 60_000, 120_000, 300_000, 900_000 };

    private static final ExecutorService io = Executors.newSingleThreadExecutor();
    private static final Handler main = new Handler(Looper.getMainLooper());
    private static final AtomicBoolean busy = new AtomicBoolean(false);
    private static final AtomicBoolean again = new AtomicBoolean(false);
    private static volatile boolean watchingNet;
    private static int failures;
    private static Context app;
    private static final Runnable retry = () -> { if (app != null) kick(app); };

    /* ---------------------------------------------------------------- status (kept so the page shows it after a restart) */

    static JSObject status(Context c) {
        SharedPreferences p = c.getSharedPreferences(OutputRecordQueue.PREFS, Context.MODE_PRIVATE);
        List<JSONObject> q = OutputRecordQueue.list(c);
        long bytes = 0;
        for (JSONObject m : q) bytes += OutputRecordQueue.audio(c, m.optString("id")).length();
        JSObject o = new JSObject();
        o.put("upload", p.getString("up.state", "idle"));
        o.put("message", p.getString("up.message", ""));
        o.put("lastUploadAt", p.getString("up.lastAt", ""));
        o.put("nextTryAt", p.getString("up.nextAt", ""));
        o.put("waiting", q.size());
        o.put("waitingBytes", bytes);
        o.put("capBytes", OutputRecordQueue.settings(c).capMb * 1024L * 1024L);
        return o;
    }

    private static void setState(Context c, String state, String message, String nextAt) {
        SharedPreferences.Editor e = c.getSharedPreferences(OutputRecordQueue.PREFS, Context.MODE_PRIVATE).edit();
        e.putString("up.state", state).putString("up.message", message == null ? "" : message).putString("up.nextAt", nextAt == null ? "" : nextAt);
        if ("idle".equals(state) && message == null) e.putString("up.lastAt", OutputRecordService.iso(System.currentTimeMillis()));
        e.apply();
        JSObject ev = status(c);
        OutputRecordService.emit("queue", ev);
    }

    /* ---------------------------------------------------------------- triggers */

    /**
     * A chunk was closed: hold the local cap, then send. Over the cap, `drop-oldest` removes the oldest unsent chunks
     * (never the one just closed); `stop` (the default) stops the recorder so nothing recorded is ever thrown away.
     */
    static void chunkClosed(Context c, String id) {
        OutputRecordQueue.Settings s = OutputRecordQueue.settings(c);
        long cap = s.capMb * 1024L * 1024L;
        if (OutputRecordQueue.bytes(c) > cap) {
            if ("drop-oldest".equals(s.whenFull)) {
                for (JSONObject m : OutputRecordQueue.list(c)) {
                    if (OutputRecordQueue.bytes(c) <= cap) break;
                    String old = m.optString("id");
                    if (old.equals(id)) continue;
                    OutputRecordQueue.removeLocal(c, old);
                    JSObject e = new JSObject();
                    e.put("id", old);
                    OutputRecordService.emit("dropped", e);
                }
            } else {
                c.startService(new Intent(c, OutputRecordService.class).setAction(OutputRecordService.ACTION_STOP)
                    .putExtra(OutputRecordService.EXTRA_REASON, "Stopped: the phone’s queue for axHub is full (" + s.capMb + " MB). It carries on uploading; start again once it’s sent."));
            }
        }
        kick(c);
    }

    /** Send what's queued now (one run at a time; a kick during a run runs again after it). */
    static void kick(Context c) {
        app = c.getApplicationContext();
        watchNetwork(app);
        main.removeCallbacks(retry);
        if (!busy.compareAndSet(false, true)) { again.set(true); return; }
        io.execute(() -> {
            try { run(app); } finally {
                busy.set(false);
                if (again.getAndSet(false)) kick(app);
            }
        });
    }

    private static void watchNetwork(Context c) {
        if (watchingNet) return;
        try {
            ConnectivityManager cm = (ConnectivityManager) c.getSystemService(Context.CONNECTIVITY_SERVICE);
            cm.registerDefaultNetworkCallback(new ConnectivityManager.NetworkCallback() {
                @Override public void onAvailable(Network n) { if (!OutputRecordQueue.list(c).isEmpty()) kick(c); }
            });
            watchingNet = true;
        } catch (RuntimeException ignored) { /* no network callback: the timer still retries */ }
    }

    /* ---------------------------------------------------------------- one run */

    /** Why a run stopped: try later (offline, hub down) or wait for the person (signed out, project full). */
    static final class Stop extends Exception {
        final String state;
        Stop(String state, String message) { super(message); this.state = state; }
    }

    private static void run(Context c) {
        List<JSONObject> q = OutputRecordQueue.list(c);
        if (q.isEmpty()) { failures = 0; setState(c, "idle", null, null); return; }
        setState(c, "uploading", "Sending " + q.size() + " to axHub", null);
        try {
            for (JSONObject m : q) send(c, m);
            failures = 0;
            setState(c, "idle", null, null);
        } catch (Stop s) {
            if ("offline".equals(s.state)) {
                long wait = BACKOFF_MS[Math.min(failures, BACKOFF_MS.length - 1)];
                failures++;
                setState(c, "offline", s.getMessage(), OutputRecordService.iso(System.currentTimeMillis() + wait));
                main.postDelayed(retry, wait);
            } else {
                setState(c, s.state, s.getMessage(), null);
            }
        }
    }

    static String hubUrl(String project, String path) { return HubRules.HUB + "/data/" + project + "/" + path; }
    static String partPath(String id, int n) { return "output-recorder/parts/" + id + "/" + String.format(Locale.US, "%04d", n) + ".json"; }
    static String indexPath(String id) { return "output-recorder/recordings/" + id + ".json"; }

    private static void send(Context c, JSONObject m) throws Stop {
        String id = m.optString("id");
        File f = OutputRecordQueue.audio(c, id);
        if (!OutputRecordQueue.isId(id) || !f.isFile()) return;
        String project = OutputRecordQueue.settings(c).project;
        String cookie = CookieManager.getInstance().getCookie(HubRules.HUB);
        if (cookie == null || cookie.isEmpty()) throw new Stop("signed-out", "Sign in to axHub in AmberX to send recordings.");
        try {
            long size = f.length();
            int parts = (int) ((size + PART_BYTES - 1) / PART_BYTES);
            String sha = m.optString("sha256", "");
            if (sha.isEmpty()) { sha = sha256(f); m.put("sha256", sha); m.put("parts", parts); OutputRecordQueue.writeMeta(c, id, m); }
            int from = Math.max(0, m.optInt("uploadedParts", 0));
            byte[] buf = new byte[PART_BYTES];
            try (RandomAccessFile raf = new RandomAccessFile(f, "r")) {
                for (int n = from; n < parts; n++) {
                    raf.seek((long) n * PART_BYTES);
                    int len = (int) Math.min(PART_BYTES, size - (long) n * PART_BYTES);
                    raf.readFully(buf, 0, len);
                    JSONObject doc = new JSONObject();
                    doc.put("$axf", "audio-part@1");
                    doc.put("id", id);
                    doc.put("n", n);
                    doc.put("b64", Base64.encodeToString(buf, 0, len, Base64.NO_WRAP));
                    put(project, partPath(id, n), doc.toString(), cookie);
                    m.put("uploadedParts", n + 1);
                    OutputRecordQueue.writeMeta(c, id, m);
                }
            }
            JSONObject index = new JSONObject();
            index.put("$axf", "audio-recording@1");
            index.put("id", id);
            index.put("name", m.optString("name", "Phone audio " + id.substring(0, 4) + "-" + id.substring(4, 6) + "-" + id.substring(6, 8) + " " + id.substring(9, 11) + ":" + id.substring(11, 13)));
            index.put("startedAt", m.optString("startedAt"));
            index.put("endedAt", m.optString("endedAt"));
            index.put("durationMs", m.optLong("durationMs"));
            index.put("bytes", size);
            index.put("mime", "audio/mp4");
            index.put("kbps", m.optInt("kbps"));
            index.put("channels", m.optInt("channels"));
            index.put("device", m.optString("device"));
            index.put("parts", parts);
            index.put("partBytes", PART_BYTES);
            index.put("sha256", sha);
            index.put("uploadedAt", OutputRecordService.iso(System.currentTimeMillis()));
            index.put("deleted", false);
            put(project, indexPath(id), index.toString(), cookie);
            // confirmed only by reading the index back
            HubRules.Reply r = HubRules.get(hubUrl(project, indexPath(id)), cookie);
            if (r.status != 200) throw new Stop("offline", "axHub didn’t confirm " + id + " (" + r.status + ").");
            JSONObject back = new JSONObject(r.body);
            if (back.optInt("parts") != parts || back.optLong("bytes") != size || !sha.equals(back.optString("sha256"))) {
                m.put("uploadedParts", 0);
                OutputRecordQueue.writeMeta(c, id, m);
                throw new Stop("offline", "axHub’s copy of " + id + " didn’t match: sending it again.");
            }
            OutputRecordQueue.removeLocal(c, id);
            JSObject e = new JSObject();
            e.put("id", id);
            OutputRecordService.emit("uploaded", e);
        } catch (Stop s) {
            throw s;
        } catch (IOException e) {
            throw new Stop("offline", "axHub can’t be reached (" + e.getMessage() + ").");
        } catch (Exception e) {
            throw new Stop("error", "Couldn’t send " + id + ": " + e.getMessage());
        }
    }

    private static void put(String project, String path, String body, String cookie) throws IOException, Stop {
        HubRules.Reply r = HubRules.put(HubRules.HUB, hubUrl(project, path), body, null, cookie);
        if (r.status == 200) return;
        if (r.status == 401 || r.status == 403 || (r.status >= 300 && r.status < 400)) throw new Stop("signed-out", "axHub refused the upload (" + r.status + "): sign in again, or ask for the data.write permission.");
        String msg = message(r.body);
        if (r.status == 400 && msg.contains("at most")) throw new Stop("hub-full", "axHub is full: " + msg + " Delete old recordings to make room.");
        if (r.status == 400 || r.status == 413) throw new Stop("error", "axHub refused " + path + ": " + msg);
        throw new Stop("offline", "axHub answered " + (r.status == 0 ? "nothing" : String.valueOf(r.status)) + ".");
    }

    private static String message(String body) {
        try { return new JSONObject(body).getJSONObject("error").optString("message", ""); }
        catch (Exception e) { return body == null ? "" : body.length() > 160 ? body.substring(0, 160) : body; }
    }

    static String sha256(File f) throws Exception {
        MessageDigest md = MessageDigest.getInstance("SHA-256");
        try (InputStream in = new FileInputStream(f)) {
            byte[] b = new byte[64 * 1024];
            for (int n; (n = in.read(b)) > 0; ) md.update(b, 0, n);
        }
        StringBuilder s = new StringBuilder();
        for (byte x : md.digest()) s.append(String.format(Locale.US, "%02x", x));
        return s.toString();
    }
}
