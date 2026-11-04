package ai.amberx.droid;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.media.AudioManager;
import android.media.AudioRecordingConfiguration;
import android.os.Build;
import java.util.List;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import org.json.JSONObject;

/**
 * The one place that decides whether AmberX may open the microphone (Nov 1 2026, Brett: "a button, a quick switch. It
 * disables all the listening, turns the green dot off my phone"). Every mic user asks {@link #mayOpen} before it opens
 * the microphone: hands-free (the silent wake listener, the classic recognizer loop, the one utterance after a trigger),
 * the Speak button's recognizer ({@link AmberxNativePlugin}), and the recorder's opt-in mic track
 * ({@link OutputRecordService}). Nothing else in AmberX opens it.
 *
 * - **Mic off** (kept in prefs, so it survives restarts and reboots): {@link #set} stops every mic user at once (the
 *   watch service stops listening, drops its microphone foreground type or stops altogether, the detection overlay goes,
 *   a running Speak recognizer is cancelled, the recorder's mic track is let go), so Android's green dot goes off. It is
 *   switched from AmberX (Home, the banner, the toolbar, Settings), the quick-settings tile ({@link MicTile}) and the
 *   watch service's notification.
 * - **Yield** ({@link MicRules#yieldReason}): AmberX's own recordings register their session ids here, so the watch
 *   service can tell another app's recording (the Claude app's voice mode, a call) from its own and let go.
 */
final class MicGuard {
    private MicGuard() {}

    private static final String PREFS = "amberx.mic";
    /** Session ids of the AudioRecords AmberX has open right now. */
    private static final Set<Integer> OURS = ConcurrentHashMap.newKeySet();

    private static SharedPreferences prefs(Context c) { return c.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE); }

    /** True while the Mic off switch is on. */
    static boolean off(Context c) { return c != null && prefs(c).getBoolean("off", false); }

    /** The guard every mic user calls before it opens the microphone. */
    static boolean mayOpen(Context c) { return !off(c); }

    /** Switches Mic off on or off and applies it to every mic user at once. */
    static void set(Context c, boolean off) {
        Context app = c.getApplicationContext();
        boolean was = off(app);
        prefs(app).edit().putBoolean("off", off).putLong("changedAt", System.currentTimeMillis()).apply();
        if (off) {
            AmberxNativePlugin.cancelListen();
            if (OutputRecordService.running && OutputRecordService.micOn) {
                try { app.startService(new Intent(app, OutputRecordService.class).setAction(OutputRecordService.ACTION_STOP_MIC)); }
                catch (RuntimeException ignored) { /* the recorder isn't running after all */ }
            }
        }
        WatchService w = WatchService.running;
        if (w != null) w.reapply();
        else if (!off) {
            try { WatchService.refresh(app); } catch (RuntimeException ignored) { /* background start refused: the next app open starts it */ }
        }
        MicTile.refresh(app);
        if (was != off) AmberxNativePlugin.micChanged(state(app));
    }

    /** An AudioRecord AmberX opened (its session id), so it isn't taken for another app's recording. */
    static void claim(int session) { if (session > 0) OURS.add(session); }

    static void release(int session) { OURS.remove(session); }

    private static List<AudioRecordingConfiguration> recordings(Context c) {
        try {
            AudioManager am = (AudioManager) c.getSystemService(Context.AUDIO_SERVICE);
            return am == null ? null : am.getActiveRecordingConfigurations();
        } catch (RuntimeException e) { return null; }
    }

    /** Active recordings on the phone that AmberX didn't open (Google's recognizer counts: it runs in another app). */
    static int foreign(Context c) {
        List<AudioRecordingConfiguration> list = recordings(c);
        if (list == null) return 0;
        int n = 0;
        for (AudioRecordingConfiguration r : list) if (!OURS.contains(r.getClientAudioSessionId()) && MicRules.micSource(r.getClientAudioSource())) n++;
        return n;
    }

    /** True when Android hands one of AmberX's own recordings silence (someone with priority has the mic). */
    static boolean silenced(Context c) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return false;
        List<AudioRecordingConfiguration> list = recordings(c);
        if (list == null) return false;
        for (AudioRecordingConfiguration r : list) if (OURS.contains(r.getClientAudioSessionId()) && r.isClientSilenced()) return true;
        return false;
    }

    static int mode(Context c) {
        try {
            AudioManager am = (AudioManager) c.getSystemService(Context.AUDIO_SERVICE);
            return am == null ? MicRules.MODE_NORMAL : am.getMode();
        } catch (RuntimeException e) { return MicRules.MODE_NORMAL; }
    }

    /** Why AmberX's background listening must let go now (null = it may listen). */
    static String yieldReason(Context c, boolean ownRecognizer) {
        return MicRules.yieldReason(off(c), mode(c), foreign(c), ownRecognizer, silenced(c));
    }

    /** What the web side shows: `off`, `yielded` (why background listening has let go, or null), `label`. */
    static JSONObject state(Context c) {
        JSONObject o = new JSONObject();
        boolean off = off(c);
        String y = off ? "mic-off" : WatchService.yielded;
        try {
            o.put("off", off).put("yielded", y == null ? JSONObject.NULL : y).put("label", MicRules.label(y))
                .put("listening", !off && WatchService.status.optBoolean("listening", false))
                .put("recorderMic", OutputRecordService.running && OutputRecordService.micOn);
        } catch (Exception ignored) {}
        return o;
    }
}
