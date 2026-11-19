package ai.amberx.droid;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Handler;
import android.os.Looper;
import java.util.Iterator;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Every native listener AmberX runs, with its policy and its state, for the Listeners control panel (the AmberX page's
 * `listeners` plugin and, through the hub, the Dev Console). Nov 6 2026 (Fable, build gizmo-rebuild-fable).
 *
 * - **Policies** come from the page (`listenerSet`, the synced `amberx.listeners.<id>.*` settings) and are kept in
 *   prefs so the services obey them with the app closed: {@link #policy}.
 * - **State** is read live from the services ({@link WatchService}, {@link TalkService}, the Speak recognizer, the
 *   recorder's mic track) in {@link #status}; the last error per listener is kept here ({@link #error}).
 * - Every change is pushed to the page as a `listeners` event ({@link #changed}), coalesced on the main thread.
 */
final class ListenerRegistry {
    private ListenerRegistry() {}

    private static final String PREFS = "amberx.listeners";
    private static final Map<String, String> ERRORS = new ConcurrentHashMap<>();
    private static final Map<String, Long> ERROR_AT = new ConcurrentHashMap<>();
    private static final Map<String, Integer> ATTEMPTS = new ConcurrentHashMap<>();
    private static final Handler main = new Handler(Looper.getMainLooper());
    private static boolean pending;

    private static SharedPreferences prefs(Context c) { return c.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE); }

    private static JSONObject all(Context c) {
        try { return new JSONObject(prefs(c).getString("policies", "{}")); } catch (Exception e) { return new JSONObject(); }
    }

    /** The policy of a listener (defaults when the page never set one). */
    static ListenerRules.Policy policy(Context c, String id) {
        return ListenerRules.policy(all(c).optJSONObject(id), id);
    }

    /** True unless the policy says this listener may not run. */
    static boolean allowed(Context c, String id) { return policy(c, id).on; }

    /** The page set a listener's policy (every field or a few): kept, applied, announced. */
    static ListenerRules.Policy set(Context c, String id, JSONObject patch) {
        JSONObject every = all(c);
        JSONObject cur = every.optJSONObject(id);
        if (cur == null) cur = new JSONObject();
        if (patch != null) {
            Iterator<String> keys = patch.keys();
            while (keys.hasNext()) { String k = keys.next(); try { cur.put(k, patch.get(k)); } catch (Exception ignored) {} }
        }
        ListenerRules.Policy p = ListenerRules.policy(cur, id);
        try { every.put(id, p.json()); } catch (Exception ignored) {}
        prefs(c).edit().putString("policies", every.toString()).apply();
        apply(c, id, p);
        changed();
        return p;
    }

    /** A policy took effect: the services follow it at once. */
    private static void apply(Context c, String id, ListenerRules.Policy p) {
        switch (id) {
            case ListenerRules.HANDSFREE: {
                WatchService w = WatchService.running;
                if (w != null) w.reapply();
                else if (p.on) { try { WatchService.refresh(c); } catch (RuntimeException ignored) { /* background start refused */ } }
                break;
            }
            case ListenerRules.TALK:
                if (!p.on && TalkService.running != null) TalkService.stop(c, "Talk mode was switched off in Listeners.");
                break;
            case ListenerRules.SPEAK:
                if (!p.on) AmberxNativePlugin.cancelListen();
                break;
            case ListenerRules.MONITOR:
                if (!p.on && WatchService.prefs(c).getBoolean("on", false)) WatchService.stop(c);
                break;
            default:
                break;
        }
    }

    /** A listener failed: kept as its last error (the panel shows it) and announced. */
    static void error(String id, String message) {
        if (message == null || message.isEmpty()) { ERRORS.remove(id); ERROR_AT.remove(id); }
        else { ERRORS.put(id, message.length() > 300 ? message.substring(0, 300) : message); ERROR_AT.put(id, System.currentTimeMillis()); }
        changed();
    }

    /** Quick restarts in a row right now (the panel shows "retrying 3/6"). */
    static void attempts(String id, int n) { if (n <= 0) ATTEMPTS.remove(id); else ATTEMPTS.put(id, n); }

    /** Something about a listener changed: the page gets one `listeners` event (coalesced). */
    static void changed() {
        main.post(() -> {
            if (pending) return;
            pending = true;
            main.postDelayed(() -> { pending = false; AmberxNativePlugin.listenersChanged(); }, 150);
        });
    }

    /* ---------------------------------------------------------------- status */

    private static JSONObject row(Context c, String id, String state, String detail, boolean holdsMic) {
        JSONObject o = new JSONObject();
        try {
            o.put("id", id).put("side", "native").put("state", state).put("detail", detail == null ? "" : detail).put("holdsMic", holdsMic)
                .put("policy", policy(c, id).json());
            String err = ERRORS.get(id);
            if (err != null) o.put("lastError", err).put("lastErrorAt", ERROR_AT.get(id));
            Integer n = ATTEMPTS.get(id);
            if (n != null) o.put("attempts", n);
        } catch (Exception ignored) {}
        return o;
    }

    /** Every native listener's state right now (listener-state@1 rows; the page adds its own and the device). */
    static JSONObject status(Context c) {
        JSONArray rows = new JSONArray();
        boolean micOff = MicGuard.off(c);
        String holder = MicGuard.holder();
        JSONObject ws = WatchService.status;
        boolean hfOn = WatchService.handsFree(c);
        boolean listening = ws.optBoolean("listening", false);
        String yielded = WatchService.yielded;
        String phase = ws.optString("phase", "");

        // hands-free (wake listener or the classic loop)
        String hfState, hfDetail = "";
        if (!allowed(c, ListenerRules.HANDSFREE) || !hfOn) hfState = "off";
        else if (micOff) { hfState = "yielded"; hfDetail = "mic-off"; }
        else if (yielded != null) { hfState = "yielded"; hfDetail = yielded; }
        else if ("error".equals(phase)) { hfState = "error"; hfDetail = ws.optString("phaseDetail", ""); }
        else if ("no-model".equals(phase)) { hfState = "error"; hfDetail = "wake model not ready: " + ws.optString("phaseDetail", ""); }
        else if ("downloading".equals(phase) || "loading".equals(phase)) { hfState = "starting"; hfDetail = "downloading".equals(phase) ? "getting the wake model " + ws.optString("phaseDetail", "") : "loading the wake model"; }
        else if ("paused".equals(phase)) { hfState = "paused"; hfDetail = holder != null && !ListenerRules.HANDSFREE.equals(holder) ? ListenerRules.MIC_PRIORITY.contains(holder) ? "another listener has the mic" : "" : ""; }
        else if (listening) { hfState = "on"; hfDetail = "armed".equals(phase) ? "Armed" : "wake".equals(phase) ? "Idle (wake word)" : "listening".equals(phase) ? "Hearing a command" : phase.isEmpty() ? "Listening (classic)" : ""; }
        else hfState = "starting";
        rows.put(row(c, ListenerRules.HANDSFREE, hfState, hfDetail, ListenerRules.HANDSFREE.equals(holder)));

        // the one Google utterance after a wake phrase
        boolean oneShot = "listening".equals(phase) && listening;
        rows.put(row(c, ListenerRules.ONESHOT, oneShot ? "on" : "off", oneShot ? "Hearing a command" : "", ListenerRules.ONESHOT.equals(holder)));

        // Speak
        boolean speaking = AmberxNativePlugin.speakListening();
        rows.put(row(c, ListenerRules.SPEAK, !allowed(c, ListenerRules.SPEAK) ? "off" : speaking ? "on" : "off", speaking ? "Listening for one utterance" : "", ListenerRules.SPEAK.equals(holder)));

        // Gizmo talk mode
        rows.put(TalkService.row(c, holder));

        // the recorder's mic track
        boolean recMic = OutputRecordService.running && OutputRecordService.micOn;
        rows.put(row(c, ListenerRules.RECORDER_MIC, !allowed(c, ListenerRules.RECORDER_MIC) ? "off" : recMic ? (OutputRecordService.micBusy != null ? "paused" : "on") : "off",
            recMic ? (OutputRecordService.micBusy != null ? "another app has the microphone" : "Recording your mic") : "", false));

        // axHub watch
        boolean watching = WatchService.prefs(c).getBoolean("on", false);
        String wState = !allowed(c, ListenerRules.MONITOR) || !watching ? "off" : ws.optBoolean("running", false) ? ("ok".equals(ws.optString("status")) ? "on" : "signed-out".equals(ws.optString("status")) || "not-admin".equals(ws.optString("status")) ? "paused" : "unreachable".equals(ws.optString("status")) ? "error" : "on") : "starting";
        String wDetail = watching ? ("ok".equals(ws.optString("status")) ? ws.optInt("waiting", 0) + " waiting" : ws.optString("status", "")) : "";
        rows.put(row(c, ListenerRules.MONITOR, wState, wDetail, false));

        // the veto alarm
        rows.put(row(c, ListenerRules.VETO_ALARM, !allowed(c, ListenerRules.VETO_ALARM) ? "off" : Quiet.on(c) ? "paused" : "on", Quiet.on(c) ? "Quiet is on" : "", false));

        JSONObject out = new JSONObject();
        try { out.put("micOff", micOff).put("micHolder", holder == null ? JSONObject.NULL : holder).put("at", System.currentTimeMillis()).put("listeners", rows); } catch (Exception ignored) {}
        return out;
    }
}
