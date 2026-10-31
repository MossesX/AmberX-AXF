package ai.amberx.droid;

import android.content.Context;
import android.content.SharedPreferences;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Audio Output Recorder's chunks on the phone: the settings the recorder, the tile and the page share, and the finished
 * 30-minute chunks waiting for axHub (`files/output-recorder/<id>.m4a` + `<id>.json`, app-private, never in the
 * gallery). A chunk is written as `<id>.m4a.part` and renamed when its muxer is closed, so only whole files are ever
 * queued; a leftover `.part` (the app was killed mid-chunk) can't be played and is removed on the next start.
 * Web twin of the rules: apps/console-web/plugins/output-recorder/web/core.ts.
 */
final class OutputRecordQueue {
    private OutputRecordQueue() {}

    static final String PREFS = "amberx.output-recorder";
    static final String DIR = "output-recorder";

    /* ---------------------------------------------------------------- settings (same defaults as core.ts DEFAULTS) */

    static final class Settings {
        int kbps = 32;          // 24 · 32 · 48 · 64 · 96
        int channels = 1;       // 1 = mono (downmixed), 2 = stereo
        int chunkMin = 30;      // 5 … 60
        int capMb = 200;        // local queue cap, 50 … 2000
        String whenFull = "stop"; // stop | drop-oldest
        boolean skipSilent = true;
        String project = "amberx-recordings";
    }

    static Settings settings(Context c) {
        SharedPreferences p = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        Settings s = new Settings();
        s.kbps = pick(p.getInt("kbps", s.kbps), new int[] { 24, 32, 48, 64, 96 }, s.kbps);
        s.channels = p.getInt("channels", s.channels) == 2 ? 2 : 1;
        s.chunkMin = Math.max(5, Math.min(60, p.getInt("chunkMin", s.chunkMin)));
        s.capMb = Math.max(50, Math.min(2000, p.getInt("capMb", s.capMb)));
        s.whenFull = "drop-oldest".equals(p.getString("whenFull", s.whenFull)) ? "drop-oldest" : "stop";
        s.skipSilent = p.getBoolean("skipSilent", s.skipSilent);
        String proj = p.getString("project", s.project);
        s.project = proj != null && proj.matches("[a-z0-9][a-z0-9._-]{0,99}") && !proj.contains("..") ? proj : s.project;
        return s;
    }

    /** Saves what the page sends (unknown keys ignored; each value checked again on read). */
    static void saveSettings(Context c, JSONObject o) {
        SharedPreferences.Editor e = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit();
        if (o.has("kbps")) e.putInt("kbps", o.optInt("kbps"));
        if (o.has("channels")) e.putInt("channels", o.optInt("channels"));
        if (o.has("chunkMin")) e.putInt("chunkMin", o.optInt("chunkMin"));
        if (o.has("capMb")) e.putInt("capMb", o.optInt("capMb"));
        if (o.has("whenFull")) e.putString("whenFull", o.optString("whenFull"));
        if (o.has("skipSilent")) e.putBoolean("skipSilent", o.optBoolean("skipSilent"));
        if (o.has("project")) e.putString("project", o.optString("project"));
        e.apply();
    }

    private static int pick(int v, int[] allowed, int d) {
        for (int a : allowed) if (a == v) return v;
        return d;
    }

    /* ---------------------------------------------------------------- local chunks */

    static File dir(Context c) {
        File d = new File(c.getFilesDir(), DIR);
        if (!d.isDirectory()) d.mkdirs();
        return d;
    }

    static File audio(Context c, String id) { return new File(dir(c), id + ".m4a"); }
    static File meta(Context c, String id) { return new File(dir(c), id + ".json"); }
    static File part(Context c, String id) { return new File(dir(c), id + ".m4a.part"); }

    /** A chunk id is its start time (local) plus four random letters: `20261030-101500-k3x9`. Safe as a hub path name. */
    static boolean isId(String id) { return id != null && id.matches("\\d{8}-\\d{6}-[a-z0-9]{4}"); }

    /** Finished chunks, oldest first (ids sort by time). */
    static List<JSONObject> list(Context c) {
        File[] fs = dir(c).listFiles((d, n) -> n.endsWith(".json"));
        List<JSONObject> out = new ArrayList<>();
        if (fs == null) return out;
        Arrays.sort(fs, (a, b) -> a.getName().compareTo(b.getName()));
        for (File f : fs) {
            String id = f.getName().substring(0, f.getName().length() - 5);
            JSONObject m = readMeta(c, id);
            if (m != null && audio(c, id).isFile()) out.add(m);
        }
        return out;
    }

    static JSONObject readMeta(Context c, String id) {
        if (!isId(id)) return null;
        try { return new JSONObject(new String(Files.readAllBytes(meta(c, id).toPath()), StandardCharsets.UTF_8)); }
        catch (IOException | JSONException e) { return null; }
    }

    static synchronized void writeMeta(Context c, String id, JSONObject m) throws IOException {
        File tmp = new File(dir(c), id + ".json.tmp");
        try (FileOutputStream o = new FileOutputStream(tmp)) { o.write(m.toString().getBytes(StandardCharsets.UTF_8)); o.getFD().sync(); }
        if (!tmp.renameTo(meta(c, id))) throw new IOException("couldn't save " + id + ".json");
    }

    static void removeLocal(Context c, String id) {
        if (!isId(id)) return;
        audio(c, id).delete();
        meta(c, id).delete();
        part(c, id).delete();
    }

    /** Bytes the queue holds (finished chunks only). */
    static long bytes(Context c) {
        long n = 0;
        for (JSONObject m : list(c)) n += audio(c, m.optString("id")).length();
        return n;
    }

    /** A chunk cut off by a kill was never closed: its file has no index and can't be played. */
    static int clearBroken(Context c) {
        File[] fs = dir(c).listFiles((d, n) -> n.endsWith(".part") || n.endsWith(".tmp"));
        int n = 0;
        if (fs != null) for (File f : fs) if (!OutputRecordService.isCurrent(f) && f.delete()) n++;
        return n;
    }
}
