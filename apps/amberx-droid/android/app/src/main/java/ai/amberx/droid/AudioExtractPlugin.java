package ai.amberx.droid;

import android.Manifest;
import android.app.Activity;
import android.app.RecoverableSecurityException;
import android.content.ContentResolver;
import android.content.ContentUris;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.UriPermission;
import android.database.Cursor;
import android.media.projection.MediaProjectionManager;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.os.ParcelFileDescriptor;
import android.provider.DocumentsContract;
import android.provider.MediaStore;
import android.provider.OpenableColumns;
import android.provider.Settings;
import androidx.activity.result.ActivityResult;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.IntentSenderRequest;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.CancellationException;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
import org.json.JSONArray;

/**
 * The native half of the Audio Extract plugin (`apps/console-web/plugins/audio-extract`, web seam `web/bridge.ts`).
 * Every method there has its twin here.
 *
 * Files: videos come from Android's file picker, Share → AmberX, or screen-recording folders the person granted once
 * through the folder picker; no storage permission is asked for. Audio goes to Music/<folder> through MediaStore, as
 * AmberX's own files (so renaming and deleting them needs no prompt). The screen recorder is {@link ScreenRecordService}.
 * No microphone: nothing here or in the recorder ever opens one.
 */
@CapacitorPlugin(
    name = "AudioExtract",
    permissions = {
        // Android files capture of other apps' playback (AudioPlaybackCapture) under this permission; the mic is never opened.
        @Permission(alias = "playback", strings = { Manifest.permission.RECORD_AUDIO }),
        @Permission(alias = "notifications", strings = { "android.permission.POST_NOTIFICATIONS" }),
    }
)
public class AudioExtractPlugin extends Plugin {
    static final String RECORDINGS_DIR = Environment.DIRECTORY_MOVIES + "/AmberX Recordings";
    private static final String PREFS = "amberx.audio-extract";
    private static final String KEY_FOLDERS = "folders";
    private static final long WATCH_EVERY_MS = 8_000;

    /** extracts run one at a time; everything else (probe, lists, renames) on its own thread so it never waits behind one */
    private final ExecutorService work = Executors.newSingleThreadExecutor();
    private final ExecutorService misc = Executors.newSingleThreadExecutor();
    private final Map<String, AtomicBoolean> cancels = new ConcurrentHashMap<>();
    private final List<JSObject> shared = new ArrayList<>();
    private final Handler main = new Handler(Looper.getMainLooper());
    private ActivityResultLauncher<IntentSenderRequest> deleteLauncher;
    private PluginCall pendingDelete;

    // folder watch: uri → size seen last time (a new video is reported once its size holds still)
    private boolean watching;
    private final Map<String, Long> seen = new HashMap<>();
    private final Map<String, Long> growing = new HashMap<>();
    private final Runnable poll = this::pollFolders;

    @Override
    public void load() {
        deleteLauncher = getActivity().registerForActivityResult(new ActivityResultContracts.StartIntentSenderForResult(), r -> {
            PluginCall c = pendingDelete;
            pendingDelete = null;
            if (c != null) c.resolve(deleted(r.getResultCode() == Activity.RESULT_OK));
        });
        ScreenRecordService.listener = e -> notifyListeners("recorder", e, true);
        takeIntent(getActivity().getIntent());
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        takeIntent(intent);
    }

    @Override
    protected void handleOnDestroy() {
        main.removeCallbacks(poll);
        ScreenRecordService.listener = null;
        for (AtomicBoolean c : cancels.values()) c.set(true);
        work.shutdown();
        misc.shutdown();
    }

    /* ------------------------------------------------------------------ helpers */

    private Context ctx() { return getContext(); }
    private ContentResolver cr() { return getContext().getContentResolver(); }

    private static JSObject deleted(boolean ok) { JSObject o = new JSObject(); o.put("deleted", ok); return o; }

    static String cleanName(String v, String fallback) {
        String s = v == null ? "" : v.replaceAll("[\\\\/:*?\"<>|\\x00-\\x1f]", " ").replaceAll("\\s+", " ").trim();
        while (s.startsWith(".")) s = s.substring(1);
        if (s.length() > 140) s = s.substring(0, 140).trim();
        return s.isEmpty() ? fallback : s;
    }

    static String cleanFolder(String v) {
        StringBuilder out = new StringBuilder();
        int parts = 0;
        for (String p : (v == null ? "" : v).split("/")) {
            String c = p.replaceAll("[\\\\:*?\"<>|\\x00-\\x1f]", "").trim();
            if (c.isEmpty() || c.equals(".") || c.equals("..")) continue;
            if (parts++ == 2) break;
            if (out.length() > 0) out.append('/');
            out.append(c);
        }
        String s = out.toString();
        return s.isEmpty() ? "AmberX Audio" : s.length() > 60 ? s.substring(0, 60).trim() : s;
    }

    /** Name, size (and whatever else the provider knows) of a content uri. */
    private JSObject videoInfo(Uri uri) {
        JSObject v = new JSObject();
        v.put("uri", uri.toString());
        v.put("name", "Video");
        try (Cursor c = cr().query(uri, null, null, null, null)) {
            if (c != null && c.moveToFirst()) {
                int n = c.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                int s = c.getColumnIndex(OpenableColumns.SIZE);
                if (n >= 0 && !c.isNull(n)) v.put("name", c.getString(n));
                if (s >= 0 && !c.isNull(s)) v.put("size", c.getLong(s));
                int d = c.getColumnIndex(MediaStore.MediaColumns.DURATION);
                if (d >= 0 && !c.isNull(d)) v.put("durationMs", c.getLong(d));
                int rp = c.getColumnIndex(MediaStore.MediaColumns.RELATIVE_PATH);
                if (rp >= 0 && !c.isNull(rp)) v.put("relativePath", c.getString(rp));
                int lm = c.getColumnIndex(DocumentsContract.Document.COLUMN_LAST_MODIFIED);
                if (lm >= 0 && !c.isNull(lm)) v.put("dateMs", c.getLong(lm));
            }
        } catch (RuntimeException ignored) { /* a provider that won't say: the name stays "Video" */ }
        String mime = cr().getType(uri);
        if (mime != null) v.put("mime", mime);
        return v;
    }

    private static String msg(Throwable e) {
        String m = e.getMessage();
        return m == null || m.isEmpty() ? e.getClass().getSimpleName() : m;
    }

    /* ------------------------------------------------------------------ Share → AmberX */

    private void takeIntent(Intent i) {
        if (i == null) return;
        String a = i.getAction();
        String type = i.getType();
        if (type == null || !type.startsWith("video/") || (!Intent.ACTION_SEND.equals(a) && !Intent.ACTION_SEND_MULTIPLE.equals(a))) return;
        ArrayList<Uri> uris = new ArrayList<>();
        if (Intent.ACTION_SEND.equals(a)) {
            Uri u = i.getParcelableExtra(Intent.EXTRA_STREAM);
            if (u != null) uris.add(u);
        } else {
            ArrayList<Uri> list = i.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
            if (list != null) uris.addAll(list);
        }
        i.setAction(Intent.ACTION_MAIN); // handled: a re-created activity doesn't take it twice
        offer(uris);
    }

    /** Files handed over like Share → AmberX (also Audio Output Recorder's "Send to Audio Extract"). */
    void offer(List<Uri> uris) {
        if (uris.isEmpty()) return;
        misc.execute(() -> {
            JSArray videos = new JSArray();
            List<JSObject> got = new ArrayList<>();
            for (Uri u : uris) { JSObject v = videoInfo(u); videos.put(v); got.add(v); }
            if (hasListeners("shared")) {
                JSObject e = new JSObject();
                e.put("videos", videos);
                notifyListeners("shared", e);
            } else synchronized (shared) { shared.addAll(got); }
        });
    }

    @PluginMethod
    public void takeShared(PluginCall call) {
        JSArray videos = new JSArray();
        synchronized (shared) { for (JSObject v : shared) videos.put(v); shared.clear(); }
        JSObject o = new JSObject();
        o.put("videos", videos);
        call.resolve(o);
    }

    /* ------------------------------------------------------------------ picking */

    @PluginMethod
    public void pickVideos(PluginCall call) {
        Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        i.addCategory(Intent.CATEGORY_OPENABLE);
        i.setType("video/*");
        i.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, Boolean.TRUE.equals(call.getBoolean("multiple", true)));
        i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        startActivityForResult(call, i, "picked");
    }

    @ActivityCallback
    private void picked(PluginCall call, ActivityResult r) {
        if (call == null) return;
        Intent data = r.getData();
        if (r.getResultCode() != Activity.RESULT_OK || data == null) { call.reject("No video was picked (cancelled).", "cancelled"); return; }
        List<Uri> uris = new ArrayList<>();
        if (data.getClipData() != null) for (int k = 0; k < data.getClipData().getItemCount(); k++) uris.add(data.getClipData().getItemAt(k).getUri());
        else if (data.getData() != null) uris.add(data.getData());
        misc.execute(() -> {
            JSArray videos = new JSArray();
            for (Uri u : uris) {
                try { cr().takePersistableUriPermission(u, Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION); }
                catch (SecurityException e) {
                    try { cr().takePersistableUriPermission(u, Intent.FLAG_GRANT_READ_URI_PERMISSION); } catch (SecurityException ignored) { /* this session's grant is enough */ }
                }
                videos.put(videoInfo(u));
            }
            JSObject o = new JSObject();
            o.put("videos", videos);
            call.resolve(o);
        });
    }

    @PluginMethod
    public void probe(PluginCall call) {
        String uri = call.getString("uri");
        if (uri == null) { call.reject("No video."); return; }
        misc.execute(() -> {
            try { call.resolve(AudioExtractor.probe(ctx(), Uri.parse(uri))); }
            catch (Exception e) { call.reject("Can’t read that video: " + msg(e)); }
        });
    }

    /* ------------------------------------------------------------------ extract */

    @PluginMethod
    public void extract(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) { call.reject("Audio Extract needs Android 10 or newer."); return; }
        String jobId = call.getString("jobId", "");
        String uri = call.getString("uri");
        String format = "wav".equals(call.getString("format")) ? "wav" : "m4a";
        int track = call.getInt("track", -1).intValue();
        long startUs = Math.max(0, call.getDouble("startMs", 0.0).longValue()) * 1000L;
        double endMs = call.getDouble("endMs", -1.0);
        long endUs = endMs > 0 ? (long) endMs * 1000L : -1;
        String folder = cleanFolder(call.getString("folder"));
        String name = cleanName(call.getString("name"), "Audio." + format);
        if (!name.toLowerCase().endsWith("." + format)) name = name + "." + format;
        if (uri == null || track < 0) { call.reject("No video or no audio track."); return; }
        AtomicBoolean cancel = new AtomicBoolean(false);
        cancels.put(jobId, cancel);
        final String fileName = name;
        work.execute(() -> {
            Uri out = null;
            try {
                ContentValues cv = new ContentValues();
                cv.put(MediaStore.MediaColumns.DISPLAY_NAME, fileName);
                cv.put(MediaStore.MediaColumns.MIME_TYPE, "wav".equals(format) ? "audio/x-wav" : "audio/mp4");
                cv.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_MUSIC + "/" + folder);
                cv.put(MediaStore.MediaColumns.IS_PENDING, 1);
                out = cr().insert(MediaStore.Audio.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY), cv);
                if (out == null) throw new IllegalStateException("Android wouldn’t make the audio file.");
                long[] lastAt = { 0 };
                double[] lastP = { -1 };
                AudioExtractor.Progress p = f -> {
                    long now = System.currentTimeMillis();
                    if (f - lastP[0] < 0.01 && now - lastAt[0] < 300) return;
                    lastAt[0] = now; lastP[0] = f;
                    JSObject e = new JSObject();
                    e.put("jobId", jobId);
                    e.put("progress", f);
                    notifyListeners("progress", e);
                };
                long ms;
                try (ParcelFileDescriptor pfd = cr().openFileDescriptor(out, "rw")) {
                    if (pfd == null) throw new IllegalStateException("Can’t write the audio file.");
                    ms = "wav".equals(format)
                        ? AudioExtractor.decodeWav(ctx(), Uri.parse(uri), track, startUs, endUs, pfd.getFileDescriptor(), p, cancel)
                        : AudioExtractor.copyAac(ctx(), Uri.parse(uri), track, startUs, endUs, pfd.getFileDescriptor(), p, cancel);
                }
                ContentValues done = new ContentValues();
                done.put(MediaStore.MediaColumns.IS_PENDING, 0);
                cr().update(out, done, null, null);
                JSObject f = audioRow(out);
                if (!f.has("durationMs")) f.put("durationMs", ms);
                call.resolve(f);
            } catch (CancellationException e) {
                if (out != null) try { cr().delete(out, null, null); } catch (RuntimeException ignored) { /* gone already */ }
                call.reject("Cancelled", "cancelled");
            } catch (Exception e) {
                if (out != null) try { cr().delete(out, null, null); } catch (RuntimeException ignored) { /* gone already */ }
                call.reject(msg(e));
            } finally {
                cancels.remove(jobId);
            }
        });
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        AtomicBoolean c = cancels.get(call.getString("jobId", ""));
        if (c != null) c.set(true);
        call.resolve();
    }

    private static final String[] AUDIO_COLS = {
        MediaStore.MediaColumns._ID, MediaStore.MediaColumns.DISPLAY_NAME, MediaStore.MediaColumns.SIZE,
        MediaStore.MediaColumns.DURATION, MediaStore.MediaColumns.DATE_ADDED, MediaStore.MediaColumns.MIME_TYPE,
    };

    private JSObject audioFrom(Cursor c, Uri uri) {
        JSObject f = new JSObject();
        f.put("uri", uri.toString());
        f.put("name", c.getString(1));
        f.put("size", c.isNull(2) ? 0 : c.getLong(2));
        if (!c.isNull(3) && c.getLong(3) > 0) f.put("durationMs", c.getLong(3));
        if (!c.isNull(4)) f.put("dateMs", c.getLong(4) * 1000L);
        if (!c.isNull(5)) f.put("mime", c.getString(5));
        return f;
    }

    private JSObject audioRow(Uri uri) {
        try (Cursor c = cr().query(uri, AUDIO_COLS, null, null, null)) {
            if (c != null && c.moveToFirst()) return audioFrom(c, uri);
        }
        JSObject f = new JSObject();
        f.put("uri", uri.toString());
        f.put("name", "Audio");
        f.put("size", 0);
        return f;
    }

    /* ------------------------------------------------------------------ the results list */

    @PluginMethod
    public void list(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) { call.reject("Audio Extract needs Android 10 or newer."); return; }
        String folder = cleanFolder(call.getString("folder"));
        misc.execute(() -> {
            JSArray files = new JSArray();
            Uri base = MediaStore.Audio.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY);
            try (Cursor c = cr().query(base, AUDIO_COLS, MediaStore.MediaColumns.RELATIVE_PATH + "=?",
                    new String[] { Environment.DIRECTORY_MUSIC + "/" + folder + "/" }, MediaStore.MediaColumns.DATE_ADDED + " DESC")) {
                while (c != null && c.moveToNext()) files.put(audioFrom(c, ContentUris.withAppendedId(base, c.getLong(0))));
            } catch (RuntimeException e) { call.reject(msg(e)); return; }
            JSObject o = new JSObject();
            o.put("files", files);
            call.resolve(o);
        });
    }

    @PluginMethod
    public void rename(PluginCall call) {
        String uri = call.getString("uri");
        String name = cleanName(call.getString("name"), "");
        if (uri == null || name.isEmpty()) { call.reject("No name."); return; }
        misc.execute(() -> {
            try {
                ContentValues cv = new ContentValues();
                cv.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
                cr().update(Uri.parse(uri), cv, null, null);
                JSObject o = new JSObject();
                o.put("name", audioRow(Uri.parse(uri)).getString("name"));
                call.resolve(o);
            } catch (RuntimeException e) { call.reject(msg(e)); }
        });
    }

    @PluginMethod
    public void remove(PluginCall call) {
        String uri = call.getString("uri");
        if (uri == null) { call.reject("No file."); return; }
        misc.execute(() -> {
            try { cr().delete(Uri.parse(uri), null, null); call.resolve(); }
            catch (RuntimeException e) { call.reject(msg(e)); }
        });
    }

    /** A granted folder's video is deleted through its grant, a gallery video through Android's own prompt. */
    @PluginMethod
    public void deleteVideo(PluginCall call) {
        String s = call.getString("uri");
        if (s == null) { call.reject("No video."); return; }
        Uri uri = Uri.parse(s);
        misc.execute(() -> {
            try {
                if (DocumentsContract.isDocumentUri(ctx(), uri)) { call.resolve(deleted(DocumentsContract.deleteDocument(cr(), uri))); return; }
                if (!MediaStore.AUTHORITY.equals(uri.getAuthority())) { call.resolve(deleted(false)); return; }
                try { call.resolve(deleted(cr().delete(uri, null, null) > 0)); return; }
                catch (SecurityException e) {
                    android.content.IntentSender sender = null;
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                        List<Uri> one = new ArrayList<>();
                        one.add(uri);
                        sender = MediaStore.createDeleteRequest(cr(), one).getIntentSender();
                    } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && e instanceof RecoverableSecurityException) {
                        sender = ((RecoverableSecurityException) e).getUserAction().getActionIntent().getIntentSender();
                    }
                    if (sender == null) { call.resolve(deleted(false)); return; }
                    final android.content.IntentSender ask = sender;
                    main.post(() -> { pendingDelete = call; deleteLauncher.launch(new IntentSenderRequest.Builder(ask).build()); });
                }
            } catch (Exception e) { call.resolve(deleted(false)); }
        });
    }

    @PluginMethod
    public void play(PluginCall call) { open(call, Intent.ACTION_VIEW); }

    @PluginMethod
    public void share(PluginCall call) { open(call, Intent.ACTION_SEND); }

    private void open(PluginCall call, String action) {
        String s = call.getString("uri");
        if (s == null) { call.reject("No file."); return; }
        Uri uri = Uri.parse(s);
        String mime = call.getString("mime", cr().getType(uri));
        if (mime == null) mime = "audio/*";
        Intent i = new Intent(action);
        if (Intent.ACTION_SEND.equals(action)) { i.setType(mime); i.putExtra(Intent.EXTRA_STREAM, uri); }
        else i.setDataAndType(uri, mime);
        i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        Intent chooser = Intent.createChooser(i, Intent.ACTION_SEND.equals(action) ? "Share audio" : "Play with");
        chooser.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        try { getActivity().startActivity(chooser); call.resolve(); }
        catch (RuntimeException e) { call.reject("No app on this phone can do that."); }
    }

    /* ------------------------------------------------------------------ screen-recording folders (folder picker grants) */

    private SharedPreferences prefs() { return ctx().getSharedPreferences(PREFS, Context.MODE_PRIVATE); }

    /** Granted folder trees still held (a grant the person revoked in settings drops out). */
    private List<Uri> folderUris() {
        Set<String> held = new HashSet<>();
        for (UriPermission p : cr().getPersistedUriPermissions()) if (p.isReadPermission()) held.add(p.getUri().toString());
        List<Uri> out = new ArrayList<>();
        try {
            JSONArray a = new JSONArray(prefs().getString(KEY_FOLDERS, "[]"));
            for (int k = 0; k < a.length(); k++) if (held.contains(a.getString(k))) out.add(Uri.parse(a.getString(k)));
        } catch (Exception ignored) { /* nothing granted */ }
        return out;
    }

    private void saveFolders(List<Uri> list) {
        JSONArray a = new JSONArray();
        for (Uri u : list) a.put(u.toString());
        prefs().edit().putString(KEY_FOLDERS, a.toString()).apply();
    }

    private String treeName(Uri tree) {
        String id = DocumentsContract.getTreeDocumentId(tree);
        int colon = id.indexOf(':');
        String path = colon >= 0 ? id.substring(colon + 1) : id;
        return path.isEmpty() ? "Phone storage" : path;
    }

    private JSObject folderJs(Uri u) { JSObject f = new JSObject(); f.put("uri", u.toString()); f.put("name", treeName(u)); return f; }

    @PluginMethod
    public void folders(PluginCall call) {
        JSArray a = new JSArray();
        for (Uri u : folderUris()) a.put(folderJs(u));
        JSObject o = new JSObject();
        o.put("folders", a);
        call.resolve(o);
    }

    @PluginMethod
    public void addFolder(PluginCall call) {
        Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
            i.putExtra(DocumentsContract.EXTRA_INITIAL_URI, DocumentsContract.buildDocumentUri("com.android.externalstorage.documents", "primary:DCIM/Screen recordings"));
        startActivityForResult(call, i, "folderPicked");
    }

    @ActivityCallback
    private void folderPicked(PluginCall call, ActivityResult r) {
        if (call == null) return;
        Uri tree = r.getData() == null ? null : r.getData().getData();
        if (r.getResultCode() != Activity.RESULT_OK || tree == null) { call.reject("No folder was chosen (cancelled).", "cancelled"); return; }
        try { cr().takePersistableUriPermission(tree, Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION); }
        catch (SecurityException e) {
            try { cr().takePersistableUriPermission(tree, Intent.FLAG_GRANT_READ_URI_PERMISSION); }
            catch (SecurityException e2) { call.reject("Android didn’t keep access to that folder."); return; }
        }
        List<Uri> list = folderUris();
        boolean has = false;
        for (Uri u : list) if (u.equals(tree)) has = true;
        if (!has) list.add(tree);
        saveFolders(list);
        JSObject o = new JSObject();
        o.put("folder", folderJs(tree));
        call.resolve(o);
    }

    @PluginMethod
    public void removeFolder(PluginCall call) {
        String s = call.getString("uri", "");
        List<Uri> list = folderUris();
        List<Uri> keep = new ArrayList<>();
        for (Uri u : list) {
            if (u.toString().equals(s)) {
                try { cr().releasePersistableUriPermission(u, Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION); }
                catch (SecurityException ignored) { /* already gone */ }
            } else keep.add(u);
        }
        saveFolders(keep);
        call.resolve();
    }

    /** Every video directly in the granted folders. */
    private List<JSObject> folderVideos() {
        List<JSObject> out = new ArrayList<>();
        String[] cols = {
            DocumentsContract.Document.COLUMN_DOCUMENT_ID, DocumentsContract.Document.COLUMN_DISPLAY_NAME, DocumentsContract.Document.COLUMN_MIME_TYPE,
            DocumentsContract.Document.COLUMN_SIZE, DocumentsContract.Document.COLUMN_LAST_MODIFIED,
        };
        for (Uri tree : folderUris()) {
            Uri kids = DocumentsContract.buildChildDocumentsUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree));
            try (Cursor c = cr().query(kids, cols, null, null, null)) {
                while (c != null && c.moveToNext()) {
                    String mime = c.getString(2);
                    if (mime == null || !mime.startsWith("video/")) continue;
                    JSObject v = new JSObject();
                    v.put("uri", DocumentsContract.buildDocumentUriUsingTree(tree, c.getString(0)).toString());
                    v.put("name", c.getString(1));
                    v.put("mime", mime);
                    v.put("size", c.isNull(3) ? 0 : c.getLong(3));
                    v.put("dateMs", c.isNull(4) ? 0 : c.getLong(4));
                    v.put("relativePath", treeName(tree) + "/");
                    out.add(v);
                }
            } catch (RuntimeException ignored) { /* a folder that went away */ }
        }
        return out;
    }

    @PluginMethod
    public void latestRecording(PluginCall call) {
        if (folderUris().isEmpty()) { call.reject("Choose your Screen recordings folder first.", "no-folder"); return; }
        misc.execute(() -> {
            JSObject best = null;
            for (JSObject v : folderVideos()) if (best == null || v.optLong("dateMs") > best.optLong("dateMs")) best = v;
            JSObject o = new JSObject();
            o.put("video", best == null ? org.json.JSONObject.NULL : best);
            call.resolve(o);
        });
    }

    @PluginMethod
    public void watch(PluginCall call) {
        boolean on = Boolean.TRUE.equals(call.getBoolean("on", false));
        main.removeCallbacks(poll);
        watching = on;
        if (!on) { call.resolve(); return; }
        misc.execute(() -> {
            synchronized (seen) {
                seen.clear();
                growing.clear();
                for (JSObject v : folderVideos()) seen.put(v.getString("uri"), v.optLong("size"));
            }
            main.postDelayed(poll, WATCH_EVERY_MS);
            call.resolve();
        });
    }

    private void pollFolders() {
        if (!watching) return;
        misc.execute(() -> {
            List<JSObject> fresh = new ArrayList<>();
            synchronized (seen) {
                for (JSObject v : folderVideos()) {
                    String u = v.getString("uri");
                    if (u == null || seen.containsKey(u)) continue;
                    long size = v.optLong("size");
                    Long before = growing.get(u);
                    if (size > 0 && before != null && before == size) { seen.put(u, size); growing.remove(u); fresh.add(v); }
                    else growing.put(u, size); // still being written: report it once its size holds still
                }
            }
            for (JSObject v : fresh) { JSObject e = new JSObject(); e.put("video", v); notifyListeners("newRecording", e); }
            if (watching) main.postDelayed(poll, WATCH_EVERY_MS);
        });
    }

    /* ------------------------------------------------------------------ screen recorder */

    @PluginMethod
    public void recordStart(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) { call.reject("Recording app sound needs Android 10 or newer."); return; }
        if (ScreenRecordService.running) { call.reject("Already recording."); return; }
        if (getPermissionState("playback") != PermissionState.GRANTED) requestPermissionForAlias("playback", call, "afterPlayback");
        else consent(call);
    }

    @PermissionCallback
    private void afterPlayback(PluginCall call) {
        // Refused: the recording still happens, without app sound, and says so (playbackAudio false). Never the mic.
        consent(call);
    }

    private void consent(PluginCall call) {
        MediaProjectionManager mpm = (MediaProjectionManager) ctx().getSystemService(Context.MEDIA_PROJECTION_SERVICE);
        startActivityForResult(call, mpm.createScreenCaptureIntent(), "consented");
    }

    @ActivityCallback
    private void consented(PluginCall call, ActivityResult r) {
        if (call == null) return;
        if (r.getResultCode() != Activity.RESULT_OK || r.getData() == null) { call.reject("Screen capture was cancelled.", "cancelled"); return; }
        Intent s = new Intent(ctx(), ScreenRecordService.class).setAction(ScreenRecordService.ACTION_START)
            .putExtra(ScreenRecordService.EXTRA_CODE, r.getResultCode())
            .putExtra(ScreenRecordService.EXTRA_DATA, r.getData())
            .putExtra("resolution", call.getString("resolution", "native"))
            .putExtra("fps", call.getInt("fps", 30).intValue())
            .putExtra("videoMbps", call.getDouble("videoMbps", 8.0).doubleValue())
            .putExtra("audioKbps", call.getInt("audioKbps", 192).intValue())
            .putExtra("countdown", call.getInt("countdown", 3).intValue())
            .putExtra("chip", Boolean.TRUE.equals(call.getBoolean("chip", true)))
            .putExtra("playback", getPermissionState("playback") == PermissionState.GRANTED);
        try { ContextCompat.startForegroundService(ctx(), s); call.resolve(); }
        catch (RuntimeException e) { call.reject("The recorder couldn’t start: " + msg(e)); }
    }

    private void send(PluginCall call, String action) {
        if (ScreenRecordService.running) ctx().startService(new Intent(ctx(), ScreenRecordService.class).setAction(action));
        call.resolve();
    }

    @PluginMethod
    public void recordPause(PluginCall call) { send(call, ScreenRecordService.ACTION_PAUSE); }

    @PluginMethod
    public void recordResume(PluginCall call) { send(call, ScreenRecordService.ACTION_RESUME); }

    @PluginMethod
    public void recordStop(PluginCall call) { send(call, ScreenRecordService.ACTION_STOP); }

    @PluginMethod
    public void notifications(PluginCall call) {
        if (Build.VERSION.SDK_INT < 33 || getPermissionState("notifications") == PermissionState.GRANTED) { call.resolve(granted(true)); return; }
        requestPermissionForAlias("notifications", call, "afterNotifications");
    }

    @PermissionCallback
    private void afterNotifications(PluginCall call) { call.resolve(granted(getPermissionState("notifications") == PermissionState.GRANTED)); }

    private static JSObject granted(boolean g) { JSObject o = new JSObject(); o.put("granted", g); return o; }

    @PluginMethod
    public void overlay(PluginCall call) {
        if (Settings.canDrawOverlays(ctx())) { JSObject o = new JSObject(); o.put("allowed", true); call.resolve(o); return; }
        Intent i = new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:" + ctx().getPackageName()));
        startActivityForResult(call, i, "overlayBack");
    }

    @ActivityCallback
    private void overlayBack(PluginCall call, ActivityResult r) {
        if (call == null) return;
        JSObject o = new JSObject();
        o.put("allowed", Settings.canDrawOverlays(ctx()));
        call.resolve(o);
    }
}
