package ai.amberx.droid;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Environment;
import android.os.ParcelFileDescriptor;
import android.provider.MediaStore;
import android.util.Base64;
import android.webkit.CookieManager;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginHandle;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.OutputStream;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONObject;

/**
 * The native half of the Audio Output Recorder plugin (`apps/console-web/plugins/output-recorder`, web seam
 * `web/bridge.ts`); every method there has its twin here. Records what the phone plays ({@link OutputRecordService}),
 * never the microphone; chunks go to axHub ({@link OutputRecordUploader}).
 *
 * Recordings on axHub are listed, played and deleted by the web page itself (the hub data server, like Notes); this
 * side only does what needs the phone: start/stop with Android's consent, the local queue, and `fetch` (a recording
 * from axHub saved to Music/AmberX Recorder so it can be shared or handed to Audio Extract).
 */
@CapacitorPlugin(name = "OutputRecorder")
public class OutputRecorderPlugin extends Plugin {
    static final String MUSIC_DIR = Environment.DIRECTORY_MUSIC + "/AmberX Recorder";
    private final ExecutorService io = Executors.newSingleThreadExecutor();

    @Override
    public void load() {
        OutputRecordService.listener = e -> notifyListeners("recorder", e, true);
        OutputRecordUploader.kick(getContext()); // AmberX opened: send whatever waited
        AxppLink.ensure(getContext()); // axHub can drive the recorder (amberx.recorder_*, axHub decision #108)
    }

    @Override
    protected void handleOnDestroy() {
        OutputRecordService.listener = null;
        io.shutdown();
    }

    private Context ctx() { return getContext(); }
    private ContentResolver cr() { return getContext().getContentResolver(); }

    /* ------------------------------------------------------------------ recorder */

    @PluginMethod
    public void status(PluginCall call) {
        io.execute(() -> {
            JSObject o = OutputRecordUploader.status(ctx());
            JSObject r = OutputRecordService.status();
            o.put("running", r.getBool("running"));
            o.put("startedAt", r.getString("startedAt"));
            o.put("settings", settingsJson());
            call.resolve(o);
        });
    }

    /** Opens the consent flow (audio permission once, notifications once, capture every time); `recorder` events follow. */
    @PluginMethod
    public void start(PluginCall call) {
        if (OutputRecordService.running) { call.resolve(); return; }
        try { getActivity().startActivity(OutputRecordStartActivity.intent(getActivity())); call.resolve(); }
        catch (RuntimeException e) { call.reject("The recorder couldn’t open Android’s prompt: " + e.getMessage()); }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        if (OutputRecordService.running) ctx().startService(new Intent(ctx(), OutputRecordService.class).setAction(OutputRecordService.ACTION_STOP));
        call.resolve();
    }

    /** Saves the page's settings for the recorder and the tile (they apply from the next start). */
    @PluginMethod
    public void configure(PluginCall call) {
        OutputRecordQueue.saveSettings(ctx(), call.getData());
        call.resolve(new JSObject().put("settings", settingsJson()));
    }

    private JSObject settingsJson() {
        OutputRecordQueue.Settings s = OutputRecordQueue.settings(ctx());
        JSObject o = new JSObject();
        o.put("kbps", s.kbps);
        o.put("channels", s.channels);
        o.put("chunkMin", s.chunkMin);
        o.put("capMb", s.capMb);
        o.put("whenFull", s.whenFull);
        o.put("skipSilent", s.skipSilent);
        o.put("project", s.project);
        return o;
    }

    /* ------------------------------------------------------------------ the local queue */

    @PluginMethod
    public void queue(PluginCall call) {
        io.execute(() -> {
            JSArray out = new JSArray();
            for (JSONObject m : OutputRecordQueue.list(ctx())) {
                JSObject c = new JSObject();
                String id = m.optString("id");
                c.put("id", id);
                c.put("startedAt", m.optString("startedAt"));
                c.put("durationMs", m.optLong("durationMs"));
                c.put("bytes", OutputRecordQueue.audio(ctx(), id).length());
                c.put("uploadedParts", m.optInt("uploadedParts"));
                c.put("parts", m.optInt("parts", 0));
                out.put(c);
            }
            call.resolve(new JSObject().put("chunks", out));
        });
    }

    @PluginMethod
    public void retry(PluginCall call) { OutputRecordUploader.kick(ctx()); call.resolve(); }

    /** Throws away a chunk that never reached axHub (the person's call: it's gone for good). */
    @PluginMethod
    public void discard(PluginCall call) {
        String id = call.getString("id", "");
        if (!OutputRecordQueue.isId(id)) { call.reject("No such chunk."); return; }
        OutputRecordQueue.removeLocal(ctx(), id);
        call.resolve();
    }

    /* ------------------------------------------------------------------ a recording from axHub, on the phone */

    /**
     * Downloads a recording from axHub (its parts, checked against the index's SHA-256) into Music/AmberX Recorder
     * and returns its content uri; a recording fetched before is reused while its file is still there.
     */
    @PluginMethod
    public void fetch(PluginCall call) {
        String id = call.getString("id", "");
        if (!OutputRecordQueue.isId(id)) { call.reject("No such recording."); return; }
        io.execute(() -> {
            SharedPreferences p = ctx().getSharedPreferences(OutputRecordQueue.PREFS, Context.MODE_PRIVATE);
            String known = p.getString("dl." + id, null);
            if (known != null) {
                try (ParcelFileDescriptor f = cr().openFileDescriptor(Uri.parse(known), "r")) {
                    if (f != null) { call.resolve(new JSObject().put("uri", known)); return; }
                } catch (Exception ignored) { /* deleted since: fetch again */ }
            }
            Uri out = null;
            try {
                String project = OutputRecordQueue.settings(ctx()).project;
                String cookie = CookieManager.getInstance().getCookie(HubRules.HUB);
                HubRules.Reply r = HubRules.get(OutputRecordUploader.hubUrl(project, OutputRecordUploader.indexPath(id)), cookie);
                if (r.status != 200) throw new IllegalStateException(r.status == 404 ? "it isn’t on axHub" : "axHub answered " + r.status);
                JSONObject idx = new JSONObject(r.body);
                if (idx.optBoolean("deleted")) throw new IllegalStateException("it was deleted");
                int parts = idx.optInt("parts");
                String name = clean(idx.optString("name", id)) + ".m4a";
                ContentValues cv = new ContentValues();
                cv.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
                cv.put(MediaStore.MediaColumns.MIME_TYPE, "audio/mp4");
                cv.put(MediaStore.MediaColumns.RELATIVE_PATH, MUSIC_DIR);
                cv.put(MediaStore.MediaColumns.IS_PENDING, 1);
                out = cr().insert(MediaStore.Audio.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY), cv);
                if (out == null) throw new IllegalStateException("Android wouldn’t make the file");
                MessageDigest md = MessageDigest.getInstance("SHA-256");
                try (OutputStream os = cr().openOutputStream(out)) {
                    if (os == null) throw new IllegalStateException("can’t write the file");
                    for (int n = 0; n < parts; n++) {
                        HubRules.Reply pr = HubRules.get(OutputRecordUploader.hubUrl(project, OutputRecordUploader.partPath(id, n)), cookie);
                        if (pr.status != 200) throw new IllegalStateException("part " + n + ": axHub answered " + pr.status);
                        byte[] b = Base64.decode(new JSONObject(pr.body).optString("b64"), Base64.NO_WRAP);
                        md.update(b);
                        os.write(b);
                    }
                }
                StringBuilder sha = new StringBuilder();
                for (byte x : md.digest()) sha.append(String.format(Locale.US, "%02x", x));
                if (!sha.toString().equals(idx.optString("sha256"))) throw new IllegalStateException("the download didn’t match axHub’s checksum");
                ContentValues done = new ContentValues();
                done.put(MediaStore.MediaColumns.IS_PENDING, 0);
                cr().update(out, done, null, null);
                p.edit().putString("dl." + id, out.toString()).apply();
                call.resolve(new JSObject().put("uri", out.toString()).put("name", name));
            } catch (Exception e) {
                if (out != null) { try { cr().delete(out, null, null); } catch (RuntimeException ignored) { /* gone */ } }
                call.reject("Couldn’t get the recording: " + e.getMessage());
            }
        });
    }

    private static String clean(String s) {
        String c = s.replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", " ").replaceAll("\\s+", " ").trim();
        return c.isEmpty() ? "Phone audio" : c.length() > 100 ? c.substring(0, 100) : c;
    }

    @PluginMethod
    public void play(PluginCall call) { open(call, Intent.ACTION_VIEW); }

    @PluginMethod
    public void share(PluginCall call) { open(call, Intent.ACTION_SEND); }

    private void open(PluginCall call, String action) {
        String s = call.getString("uri");
        if (s == null || !s.startsWith("content://")) { call.reject("No file."); return; }
        Uri uri = Uri.parse(s);
        Intent i = new Intent(action);
        if (Intent.ACTION_SEND.equals(action)) { i.setType("audio/mp4"); i.putExtra(Intent.EXTRA_STREAM, uri); }
        else i.setDataAndType(uri, "audio/mp4");
        i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        Intent chooser = Intent.createChooser(i, Intent.ACTION_SEND.equals(action) ? "Share recording" : "Play with");
        chooser.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        try { getActivity().startActivity(chooser); call.resolve(); }
        catch (RuntimeException e) { call.reject("No app on this phone can do that."); }
    }

    /** Hands a fetched recording to Audio Extract (trim / WAV), the same way Share → AmberX hands it a video. */
    @PluginMethod
    public void toExtract(PluginCall call) {
        String s = call.getString("uri");
        if (s == null || !s.startsWith("content://")) { call.reject("No file."); return; }
        PluginHandle h = getBridge().getPlugin("AudioExtract");
        if (h == null || !(h.getInstance() instanceof AudioExtractPlugin)) { call.reject("Audio Extract isn’t in this AmberX."); return; }
        List<Uri> uris = new ArrayList<>();
        uris.add(Uri.parse(s));
        ((AudioExtractPlugin) h.getInstance()).offer(uris);
        call.resolve();
    }
}
