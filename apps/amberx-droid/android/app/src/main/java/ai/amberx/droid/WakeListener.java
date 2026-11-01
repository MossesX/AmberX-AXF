package ai.amberx.droid;

import android.content.Context;
import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.os.Handler;
import android.os.Looper;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.List;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;
import org.json.JSONObject;
import org.vosk.LibVosk;
import org.vosk.LogLevel;
import org.vosk.Model;
import org.vosk.Recognizer;

/**
 * The silent wake listener (Oct 29 2026, Brett: "AmberX voice control constantly triggers tone but ActiveX doesn't —
 * make it like ActiveX"). Like ActiveX it idles on Vosk: offline, continuous, no recognizer restarts, so no system tone.
 *
 * - **Model:** `vosk-model-small-en-us-0.15` (~40 MB), downloaded once on first use into the app's files dir
 *   ([MODEL_URL], the one place the address lives) with progress on the overlay, so the APK stays small.
 * - **Listening:** its own thread reads the microphone (16 kHz mono PCM through `AudioRecord`) and feeds a Vosk
 *   `Recognizer`. Owning the audio loop (instead of Vosk's `SpeechService`) gives the input level for the overlay's
 *   graph from the same samples.
 * - **Wake phrases:** the grammar is only the phrases ([WakeRules#grammar]) plus "[unk]", so CPU stays low and nothing
 *   else is transcribed. A hit ([WakeRules#trigger]: sensitivity + level gate) releases the microphone and calls
 *   [Events#trigger]; WatchService then runs ONE Google utterance and starts this again.
 * - **Always armed:** no grammar (the model's whole vocabulary); every sentence it hears is a command.
 *
 * Every callback comes on the main thread.
 */
final class WakeListener {
    static final String MODEL_NAME = "vosk-model-small-en-us-0.15";
    static final String MODEL_URL = "https://alphacephei.com/vosk/models/" + MODEL_NAME + ".zip";
    private static final long MAX_DOWNLOAD = 200L * 1024 * 1024;
    private static final int RATE = 16_000;

    interface Events {
        /** "loading" | "downloading" (detail "42%") | "no-model" (detail = why) | "wake" | "armed" | "stopped" */
        void phase(String phase, String detail);
        /** recognizer-scale dB (-2..10), about ten a second */
        void level(float db);
        void heard(String text, boolean last);
        /** a wake phrase (text = what came with it, empty in wake mode), or always armed: phrase "" + the command */
        void trigger(String phrase, String text);
    }

    private final Context app;
    private final Events events;
    private final Handler main = new Handler(Looper.getMainLooper());
    private static Model model; // loaded once per process, shared by every start
    private static final Object MODEL_LOCK = new Object();
    private volatile Thread worker;
    private volatile String key = "";
    private volatile int generation;

    WakeListener(Context c, Events events) {
        this.app = c.getApplicationContext();
        this.events = events;
    }

    static File modelDir(Context c) { return new File(new File(c.getFilesDir(), "vosk"), MODEL_NAME); }

    static boolean modelReady(Context c) { return new File(modelDir(c), ".ready").exists(); }

    boolean running() { return worker != null; }

    /** Starts listening, or keeps listening when nothing changed (same phrases, mode and sensitivity). */
    void start(List<String> phrases, boolean armed, String sensitivity) {
        String k = (armed ? "armed|" : "wake|") + WakeRules.sensitivity(sensitivity) + "|" + String.join(",", phrases);
        if (worker != null && k.equals(key)) return;
        stop();
        key = k;
        final int gen = ++generation;
        final List<String> ps = new ArrayList<>(phrases);
        final String sens = WakeRules.sensitivity(sensitivity);
        Thread t = new Thread(() -> run(gen, ps, armed, sens), "amberx-wake");
        worker = t;
        t.start();
    }

    /** Stops and lets go of the microphone (within one 100 ms read). */
    void stop() {
        generation++;
        worker = null;
        key = "";
    }

    private boolean live(int gen) { return gen == generation; }

    private void post(int gen, Runnable r) { main.post(() -> { if (live(gen)) r.run(); }); }

    private void run(int gen, List<String> phrases, boolean armed, String sens) {
        Model m;
        try { m = ensureModel(gen); }
        catch (Exception e) {
            String why = e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage();
            post(gen, () -> events.phase("no-model", why));
            // Try again in five minutes (no network yet, say) while still wanted.
            main.postDelayed(() -> { if (live(gen) && worker != null) { Thread again = new Thread(() -> run(gen, phrases, armed, sens), "amberx-wake"); worker = again; again.start(); } }, 300_000);
            return;
        }
        if (m == null || !live(gen)) return;
        listen(gen, m, phrases, armed, sens);
    }

    /* ---------------------------------------------------------------- the model: download once, load once */

    private Model ensureModel(int gen) throws Exception {
        synchronized (MODEL_LOCK) {
            if (model != null) return model;
            File dir = modelDir(app);
            if (!modelReady(app)) download(gen, dir);
            if (!live(gen)) return null;
            post(gen, () -> events.phase("loading", ""));
            LibVosk.setLogLevel(LogLevel.WARNINGS);
            model = new Model(dir.getAbsolutePath());
            return model;
        }
    }

    private void download(int gen, File dir) throws Exception {
        File root = dir.getParentFile();
        if (root == null || (!root.isDirectory() && !root.mkdirs())) throw new IllegalStateException("can't write the model folder");
        File zip = new File(root, MODEL_NAME + ".zip.part");
        main.post(() -> { if (worker != null) events.phase("downloading", "0%"); });
        HttpURLConnection c = (HttpURLConnection) new URL(MODEL_URL).openConnection();
        c.setConnectTimeout(15_000);
        c.setReadTimeout(30_000);
        try {
            if (c.getResponseCode() != 200) throw new IllegalStateException("model download answered " + c.getResponseCode());
            long total = c.getContentLengthLong();
            if (total > MAX_DOWNLOAD) throw new IllegalStateException("model download too big");
            try (InputStream in = c.getInputStream(); OutputStream out = new FileOutputStream(zip)) {
                byte[] buf = new byte[64 * 1024];
                long got = 0;
                int lastPct = -1, n;
                while ((n = in.read(buf)) > 0) {
                    out.write(buf, 0, n);
                    got += n;
                    if (got > MAX_DOWNLOAD) throw new IllegalStateException("model download too big");
                    int pct = total > 0 ? (int) (got * 100 / total) : -1;
                    // Shown by whichever start is current: a settings change mid-download doesn't restart it.
                    if (pct != lastPct && pct >= 0) { lastPct = pct; final String d = pct + "%"; main.post(() -> { if (worker != null) events.phase("downloading", d); }); }
                }
            }
        } finally {
            c.disconnect();
        }
        File tmp = new File(root, "unzip-" + System.currentTimeMillis());
        try {
            unzip(zip, tmp);
            File top = new File(tmp, MODEL_NAME);
            if (!top.isDirectory()) throw new IllegalStateException("model archive has no " + MODEL_NAME + " folder");
            deleteAll(dir);
            if (!top.renameTo(dir)) throw new IllegalStateException("can't move the model into place");
            if (!new File(dir, ".ready").createNewFile() && !modelReady(app)) throw new IllegalStateException("can't mark the model ready");
        } finally {
            deleteAll(tmp);
            //noinspection ResultOfMethodCallIgnored
            zip.delete();
        }
    }

    /** Unzips with every entry kept inside `to` (no "../" escapes). */
    private static void unzip(File zip, File to) throws Exception {
        String base = to.getCanonicalPath() + File.separator;
        try (ZipInputStream z = new ZipInputStream(new java.io.FileInputStream(zip))) {
            ZipEntry e;
            byte[] buf = new byte[64 * 1024];
            while ((e = z.getNextEntry()) != null) {
                File f = new File(to, e.getName());
                if (!f.getCanonicalPath().startsWith(base)) throw new IllegalStateException("bad entry in the model archive");
                if (e.isDirectory()) { f.mkdirs(); continue; }
                File parent = f.getParentFile();
                if (parent != null) parent.mkdirs();
                try (OutputStream out = new FileOutputStream(f)) {
                    int n;
                    while ((n = z.read(buf)) > 0) out.write(buf, 0, n);
                }
            }
        }
    }

    private static void deleteAll(File f) {
        if (f == null || !f.exists()) return;
        File[] kids = f.listFiles();
        if (kids != null) for (File k : kids) deleteAll(k);
        //noinspection ResultOfMethodCallIgnored
        f.delete();
    }

    /* ---------------------------------------------------------------- the audio loop */

    private void listen(int gen, Model m, List<String> phrases, boolean armed, String sens) {
        AudioRecord rec = null;
        Recognizer r = null;
        int session = 0;
        // Mic off (MicGuard): the one check before AmberX opens the microphone.
        if (!MicGuard.mayOpen(app)) { post(gen, () -> events.phase("stopped", "mic off")); return; }
        try {
            r = armed ? new Recognizer(m, RATE) : new Recognizer(m, RATE, WakeRules.grammarJson(phrases));
            int min = AudioRecord.getMinBufferSize(RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
            rec = new AudioRecord(MediaRecorder.AudioSource.VOICE_RECOGNITION, RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, Math.max(min, RATE));
            if (rec.getState() != AudioRecord.STATE_INITIALIZED) throw new IllegalStateException("the microphone is busy");
            session = rec.getAudioSessionId();
            MicGuard.claim(session); // ours: the watch service doesn't take it for another app's recording
            rec.startRecording();
            post(gen, () -> events.phase(armed ? "armed" : "wake", ""));
            short[] buf = new short[RATE / 10];
            double peak = 0;
            String lastPartial = "";
            while (live(gen)) {
                int n = rec.read(buf, 0, buf.length);
                if (n <= 0) continue;
                double level = WakeRules.levelOfDbfs(WakeRules.dbfs(buf, n));
                peak = Math.max(peak, level);
                final float db = (float) WakeRules.recognizerDb(level);
                post(gen, () -> events.level(db));
                boolean fin = r.acceptWaveForm(buf, n);
                if (fin) {
                    String text = WakeRules.clean(field(r.getResult(), "text"));
                    double p = peak;
                    peak = 0;
                    lastPartial = "";
                    if (text.isEmpty()) continue;
                    post(gen, () -> events.heard(text, true));
                    String hit = WakeRules.trigger(text, false, sens, p, phrases);
                    if (armed) {
                        if (p < WakeRules.minLevel(sens)) continue;
                        String phrase = hit == null ? "" : hit;
                        post(gen, () -> events.trigger(phrase, text));
                        // Armed keeps listening: the sentence was the command.
                    } else if (hit != null) {
                        fire(gen, hit);
                        return;
                    }
                } else if (!armed) {
                    String partial = WakeRules.clean(field(r.getPartialResult(), "partial"));
                    if (partial.isEmpty() || partial.equals(lastPartial)) continue;
                    lastPartial = partial;
                    post(gen, () -> events.heard(partial, false));
                    String hit = WakeRules.trigger(partial, true, sens, peak, phrases);
                    if (hit != null) { fire(gen, hit); return; }
                } else {
                    String partial = WakeRules.clean(field(r.getPartialResult(), "partial"));
                    if (!partial.isEmpty() && !partial.equals(lastPartial)) { lastPartial = partial; post(gen, () -> events.heard(partial, false)); }
                }
            }
        } catch (Exception e) {
            String why = e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage();
            post(gen, () -> events.phase("no-model", why));
        } finally {
            if (rec != null) { try { rec.stop(); } catch (Exception ignored) {} rec.release(); }
            MicGuard.release(session);
            if (r != null) r.close();
        }
    }

    /** A wake phrase: stop here (the microphone is released in `finally`), then tell WatchService. */
    private void fire(int gen, String phrase) {
        post(gen, () -> {
            stop();
            events.trigger(phrase, "");
        });
    }

    private static String field(String json, String name) {
        try { return new JSONObject(json).optString(name, ""); } catch (Exception e) { return ""; }
    }
}
