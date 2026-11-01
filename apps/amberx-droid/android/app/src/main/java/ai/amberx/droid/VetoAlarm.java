package ai.amberx.droid;

import android.content.Context;
import android.content.SharedPreferences;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.media.MediaPlayer;
import android.media.ToneGenerator;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.provider.Settings;
import android.util.Base64;
import java.io.File;
import java.io.FileOutputStream;
import java.util.HashSet;
import java.util.Set;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * The veto alarm on the phone (Brett, Oct 30 2026). Its settings belong to the veto banner plugin (console
 * `plugins/approvals-banner/web/alarm.ts`, `nativeAlarmConfig`), which AmberX loads; they arrive through
 * `AmberxNative.vetoAlarm` ({enabled, tone, customSound, volume, louder, louderSeconds, ringSeconds, repeat,
 * repeatGapSeconds, vibration[], startSeconds (-1 = when the countdown starts), throughSilent}).
 *
 * For each held call the watch service reads ([VetoAlerts#update]) the alarm is scheduled at its start point and rings
 * once per call: rings of `ringSeconds`, `repeat` times with `repeatGapSeconds` of quiet between, from a fifth of the
 * volume up to the volume over `louderSeconds` when `louder` is on, with the vibration pattern. With `throughSilent` it
 * plays on the alarm stream (USAGE_ALARM / STREAM_ALARM), which Android doesn't mute in silent or vibrate mode. Deny,
 * Approve or Shelve (from the notification or the app), or the call leaving the hold, stops it.
 *
 * Tones: alarm / ringtone / notification are the phone's own sounds; beacon / siren / chime / pulse are ToneGenerator
 * tones; custom is his own file (kept in the app's files, never in preferences).
 */
final class VetoAlarm {
    private VetoAlarm() {}

    static final String PREFS = "amberx_veto_alarm";
    private static final String SOUND_FILE = "veto-alarm-sound";
    private static final long STEP_MS = 250;

    private static final Handler main = new Handler(Looper.getMainLooper());
    private static String ringingId = null;
    private static MediaPlayer player = null;
    private static ToneGenerator tones = null;
    private static long startedAt = 0;
    private static JSONObject playing = null;
    private static boolean inRing = false;

    static SharedPreferences prefs(Context c) { return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE); }

    static JSONObject config(Context c) {
        try { return new JSONObject(prefs(c).getString("config", "{}")); } catch (Exception e) { return new JSONObject(); }
    }

    /** Saves the banner plugin's alarm settings; his own sound goes to a file. */
    static void configure(Context c, JSONObject cfg) {
        JSONObject keep = cfg == null ? new JSONObject() : cfg;
        try {
            String data = keep.optString("customSound", "");
            keep.remove("customSound");
            if ("custom".equals(keep.optString("tone")) && !data.isEmpty()) {
                if (!saveSound(c, data)) keep.put("tone", "alarm");
            }
        } catch (Exception ignored) {}
        prefs(c).edit().putString("config", keep.toString()).apply();
    }

    private static boolean saveSound(Context c, String dataUrl) {
        int comma = dataUrl.indexOf(',');
        if (!dataUrl.startsWith("data:audio/") || comma < 0 || !dataUrl.substring(0, comma).endsWith(";base64") || dataUrl.length() > 1_500_000) return false;
        try (FileOutputStream out = new FileOutputStream(new File(c.getFilesDir(), SOUND_FILE))) {
            out.write(Base64.decode(dataUrl.substring(comma + 1), Base64.DEFAULT));
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    private static Set<String> rang(Context c) { return new HashSet<>(prefs(c).getStringSet("rang", new HashSet<>())); }

    /** Schedules this call's alarm at its start point (once per call). Called with every feed read while it counts down. */
    static void schedule(Context c, Handler work, HubRules.Veto v) {
        JSONObject cfg = config(c);
        if (!cfg.optBoolean("enabled", true) || v.shelved || v.approvedNow) return;
        if (rang(c).contains(v.id)) return;
        int start = cfg.optInt("startSeconds", 30);
        long now = System.currentTimeMillis();
        long at = start < 0 ? now : v.runsAtLocal() - start * 1000L;
        Context app = c.getApplicationContext();
        work.removeCallbacksAndMessages(token(v.id));
        work.postAtTime(() -> main.post(() -> start(app, v.id, config(app))), token(v.id), SystemClock.uptimeMillis() + Math.max(0, at - now));
    }

    /** Handler tokens compare by identity: one interned string per call. */
    static String token(String id) { return ("veto-alarm:" + id).intern(); }

    /** Forgets calls no longer held (keeps the "rang" list short). */
    static void forget(Context c, Set<String> heldIds) {
        Set<String> r = rang(c);
        if (r.retainAll(heldIds)) prefs(c).edit().putStringSet("rang", r).apply();
    }

    /** Rings now for [id] with [cfg]. One alarm at a time: a new one replaces the one ringing. */
    static void start(Context c, String id, JSONObject cfg) {
        stopNow(c);
        if (!"test".equals(id)) {
            Set<String> r = rang(c);
            if (r.contains(id)) return;
            r.add(id);
            prefs(c).edit().putStringSet("rang", r).apply();
        }
        if (Quiet.on(c)) return; // Quiet: counted as rung, never heard
        ringingId = id;
        playing = cfg;
        startedAt = SystemClock.elapsedRealtime();
        inRing = false;
        step(c.getApplicationContext());
    }

    /** Stops the alarm for [id] (null = whatever rings) and its pending start. */
    static void stop(Context c, Handler work, String id) {
        if (work != null && id != null) work.removeCallbacksAndMessages(token(id));
        if (id != null && !"test".equals(id)) {
            Set<String> r = rang(c);
            if (r.add(id)) prefs(c).edit().putStringSet("rang", r).apply();
        }
        main.post(() -> { if (id == null || id.equals(ringingId)) stopNow(c); });
    }

    private static void stopNow(Context c) {
        main.removeCallbacksAndMessages(VetoAlarm.class);
        ringingId = null;
        playing = null;
        inRing = false;
        if (player != null) { try { player.stop(); } catch (Exception ignored) {} player.release(); player = null; }
        if (tones != null) { tones.stopTone(); tones.release(); tones = null; }
        Vibrator vib = c.getSystemService(Vibrator.class);
        if (vib != null) vib.cancel();
    }

    /** One step of the alarm: ring or gap, the volume now, the end. Every [STEP_MS] on the main thread. */
    private static void step(Context c) {
        JSONObject cfg = playing;
        if (cfg == null) return;
        int ring = Math.max(1, cfg.optInt("ringSeconds", 30));
        int repeat = Math.max(1, Math.min(10, cfg.optInt("repeat", 2)));
        int gap = Math.max(0, cfg.optInt("repeatGapSeconds", 15));
        double elapsed = (SystemClock.elapsedRealtime() - startedAt) / 1000.0;
        double length = ring * repeat + gap * (repeat - 1);
        if (elapsed >= length) { stopNow(c); return; }
        int cycle = ring + gap;
        double inCycle = elapsed % cycle;
        boolean on = inCycle < ring;
        float vol = (float) volumeAt(cfg, inCycle);
        if (on && !inRing) begin(c, cfg, vol);
        else if (!on && inRing) pause(c);
        else if (on && player != null) player.setVolume(vol, vol);
        inRing = on;
        main.postAtTime(() -> step(c), VetoAlarm.class, SystemClock.uptimeMillis() + STEP_MS);
    }

    /** Same as alarm.ts `volumeAt`: a fifth of the volume rising to it over louderSeconds, per ring. */
    static double volumeAt(JSONObject cfg, double inRing) {
        double full = Math.max(0, Math.min(100, cfg.optInt("volume", 80))) / 100.0;
        if (!cfg.optBoolean("louder", true)) return full;
        double t = Math.min(1, inRing / Math.max(1, cfg.optInt("louderSeconds", 20)));
        return full * (0.2 + 0.8 * t);
    }

    private static void begin(Context c, JSONObject cfg, float vol) {
        boolean alarmStream = cfg.optBoolean("throughSilent", true);
        String tone = cfg.optString("tone", "alarm");
        int toneId = toneId(tone);
        if (toneId >= 0) {
            try {
                if (tones == null) tones = new ToneGenerator(alarmStream ? AudioManager.STREAM_ALARM : AudioManager.STREAM_NOTIFICATION, Math.round(vol * 100));
                tones.startTone(toneId);
            } catch (Exception ignored) {}
        } else {
            Uri uri = "custom".equals(tone) ? Uri.fromFile(new File(c.getFilesDir(), SOUND_FILE))
                : "ringtone".equals(tone) ? Settings.System.DEFAULT_RINGTONE_URI
                : "notification".equals(tone) ? Settings.System.DEFAULT_NOTIFICATION_URI
                : Settings.System.DEFAULT_ALARM_ALERT_URI;
            try {
                if (player == null) {
                    player = new MediaPlayer();
                    player.setAudioAttributes(new AudioAttributes.Builder()
                        .setUsage(alarmStream ? AudioAttributes.USAGE_ALARM : AudioAttributes.USAGE_NOTIFICATION)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build());
                    player.setDataSource(c, uri);
                    player.setLooping(true);
                    player.prepare();
                }
                player.setVolume(vol, vol);
                player.start();
            } catch (Exception e) {
                if (player != null) { player.release(); player = null; }
            }
        }
        vibrate(c, cfg, alarmStream);
    }

    private static void pause(Context c) {
        if (player != null) { try { player.pause(); } catch (Exception ignored) {} }
        if (tones != null) tones.stopTone();
        Vibrator vib = c.getSystemService(Vibrator.class);
        if (vib != null) vib.cancel();
    }

    private static void vibrate(Context c, JSONObject cfg, boolean alarmStream) {
        JSONArray a = cfg.optJSONArray("vibration");
        if (a == null || a.length() < 2) return;
        long[] p = new long[Math.min(a.length(), 40)];
        for (int i = 0; i < p.length; i++) p[i] = Math.max(0, Math.min(5000, a.optLong(i, 0)));
        Vibrator vib = c.getSystemService(Vibrator.class);
        if (vib == null || !vib.hasVibrator()) return;
        AudioAttributes attrs = new AudioAttributes.Builder().setUsage(alarmStream ? AudioAttributes.USAGE_ALARM : AudioAttributes.USAGE_NOTIFICATION).build();
        if (Build.VERSION.SDK_INT >= 26) vib.vibrate(VibrationEffect.createWaveform(p, 0), attrs);
        else vib.vibrate(p, 0, attrs);
    }

    /** ToneGenerator tones for the built-in synthetic sounds; -1 = a sound file / the phone's sound. */
    private static int toneId(String tone) {
        switch (tone) {
            case "beacon": return ToneGenerator.TONE_CDMA_HIGH_PBX_SS;
            case "siren": return ToneGenerator.TONE_CDMA_EMERGENCY_RINGBACK;
            case "chime": return ToneGenerator.TONE_CDMA_MED_PBX_L;
            case "pulse": return ToneGenerator.TONE_SUP_RADIO_ACK;
            default: return -1;
        }
    }

    /** Settings → Test the alarm: rings once now with the given settings (his own sound included). */
    static void test(Context c, JSONObject cfg) {
        JSONObject copy;
        try { copy = new JSONObject(cfg.toString()); } catch (Exception e) { copy = new JSONObject(); }
        String data = copy.optString("customSound", "");
        copy.remove("customSound");
        if ("custom".equals(copy.optString("tone")) && !data.isEmpty() && !saveSound(c, data)) {
            try { copy.put("tone", "alarm"); } catch (Exception ignored) {}
        }
        final JSONObject run = copy;
        main.post(() -> start(c.getApplicationContext(), "test", run));
    }
}
