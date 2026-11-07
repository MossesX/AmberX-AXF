package ai.amberx.droid;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashSet;
import java.util.List;
import org.json.JSONObject;

/**
 * The pure rules behind AmberX's background listeners (listener@1), the Android twin of
 * {@code framework/libs/listeners/core.ts}: both give the same answers on {@code src/axf/libs/listeners/cases.json}
 * ({@code ListenerRulesTest}). No Android imports, so plain JUnit drives it.
 *
 * Nov 6 2026 (Fable, build gizmo-rebuild-fable). Brett: "it's crashing with other apps, and sometimes it'll just do
 * that sound over and over."
 *
 * - **Policy** ({@link Policy}): allowed, pause for calls, pause for other apps, start sound, restarts before it gives
 *   up (-1 = keep trying), backoff, cap, cooldown. Set from the page ({@link ListenerRegistry}); defaults when unset.
 * - **Restarts back off and give up** ({@link #afterEnd}): a quick end (another app has the mic, the recognizer is
 *   busy, no audio) waits 1 s, 2 s, 4 s … up to the cap and after {@code retries} quick ends in a row stops in state
 *   error; a run that lasted resets the count. A fatal end (no permission, no recognizer) never restarts.
 * - **Silent restarts** ({@link #startSound}): the start tone only for a start the person asked for.
 * - **Yield** ({@link #yieldReason}, {@link #mayResume}): let go for a call, for silence from Android, for another
 *   app's recording or audio focus, by policy; Mic off wins over everything.
 * - **One mic owner** ({@link #micWinner}): the one the person is talking to wins (talk mode, then Speak…).
 */
final class ListenerRules {
    private ListenerRules() {}

    static final int DEFAULT_RETRIES = 6;
    static final long DEFAULT_BACKOFF_MS = 1_000;
    static final long DEFAULT_MAX_BACKOFF_MS = 30_000;
    static final long DEFAULT_COOLDOWN_MS = 60_000;
    /** A session shorter than this (ms) ended at once: something refused it. */
    static final long QUICK_END_MS = 1_500;
    /** The pause before an ordinary restart (a turn that ran its course). */
    static final long RESTART_MS = 250;
    /** How long the microphone must stay free before a yielded listener comes back. */
    static final long RESUME_AFTER_MS = 3_000;

    /** Listener ids (the registry in core.ts). */
    static final String HANDSFREE = "handsfree", ONESHOT = "oneshot", SPEAK = "speak", TALK = "talk", RECORDER_MIC = "recorder-mic", MONITOR = "monitor", VETO_ALARM = "veto-alarm";
    /** Who gets the microphone when two ask, first wins. */
    static final List<String> MIC_PRIORITY = Arrays.asList(TALK, SPEAK, "voice-command", "dictation", "notes", "agent-voice", ONESHOT, HANDSFREE, "browser-handsfree", RECORDER_MIC);

    /* ---------------------------------------------------------------- policy */

    static final class Policy {
        boolean on = true, pauseOnCall = true, pauseForOtherApps = true, sound = false;
        int retries = DEFAULT_RETRIES;
        long backoffMs = DEFAULT_BACKOFF_MS, maxBackoffMs = DEFAULT_MAX_BACKOFF_MS, cooldownMs = DEFAULT_COOLDOWN_MS;

        JSONObject json() {
            JSONObject o = new JSONObject();
            try {
                o.put("on", on).put("pauseOnCall", pauseOnCall).put("pauseForOtherApps", pauseForOtherApps).put("sound", sound)
                    .put("retries", retries).put("backoffMs", backoffMs).put("maxBackoffMs", maxBackoffMs).put("cooldownMs", cooldownMs);
            } catch (Exception ignored) {}
            return o;
        }
    }

    /** Defaults for a listener (the veto alarm's sound is on). */
    static Policy defaults(String id) {
        Policy p = new Policy();
        if (VETO_ALARM.equals(id)) p.sound = true;
        return p;
    }

    private static boolean bool(JSONObject o, String k, boolean d) {
        if (o == null || !o.has(k) || o.isNull(k)) return d;
        Object v = o.opt(k);
        if (v instanceof Boolean) return (Boolean) v;
        if (v instanceof String) { if ("true".equals(v)) return true; if ("false".equals(v)) return false; }
        return d;
    }

    private static long num(JSONObject o, String k, long d, long min, long max) {
        if (o == null || !o.has(k) || o.isNull(k)) return d;
        Object v = o.opt(k);
        double n;
        if (v instanceof Number) n = ((Number) v).doubleValue();
        else if (v instanceof String && !((String) v).trim().isEmpty()) { try { n = Double.parseDouble(((String) v).trim()); } catch (NumberFormatException e) { return d; } }
        else return d;
        if (Double.isNaN(n) || Double.isInfinite(n)) return d;
        return Math.max(min, Math.min(max, Math.round(n)));
    }

    /** A policy with every field valid; missing or bad fields take the listener's defaults (same clamps as core.ts). */
    static Policy policy(JSONObject raw, String id) {
        Policy d = defaults(id);
        Policy p = new Policy();
        p.on = bool(raw, "on", d.on);
        p.pauseOnCall = bool(raw, "pauseOnCall", d.pauseOnCall);
        p.pauseForOtherApps = bool(raw, "pauseForOtherApps", d.pauseForOtherApps);
        p.sound = bool(raw, "sound", d.sound);
        p.retries = (int) num(raw, "retries", d.retries, -1, 100);
        p.backoffMs = num(raw, "backoffMs", d.backoffMs, 100, 600_000);
        p.maxBackoffMs = Math.max(num(raw, "maxBackoffMs", d.maxBackoffMs, 100, 3_600_000), p.backoffMs);
        p.cooldownMs = num(raw, "cooldownMs", d.cooldownMs, 0, 86_400_000);
        return p;
    }

    /* ---------------------------------------------------------------- restarts */

    /** The wait (ms) before restart number {@code attempt} (1 = the first after a quick end), or -1 = give up. */
    static long restartDelay(int attempt, Policy p) {
        if (attempt <= 0) return 0;
        if (p.retries >= 0 && attempt > p.retries) return -1;
        double wait = p.backoffMs * Math.pow(2, Math.min(attempt - 1, 30));
        return (long) Math.min(p.maxBackoffMs, wait);
    }

    static boolean isQuickEnd(long ranMs) { return ranMs < QUICK_END_MS; }

    /** What to do when a session ends. */
    static final class EndPlan {
        final int attempts;
        /** wait before the next start (ms), or -1 = stop in state error */
        final long delay;
        final boolean gaveUp;
        /** when it gave up: try again cold after this long (0 = never) */
        final long cooldownMs;
        EndPlan(int attempts, long delay, boolean gaveUp, long cooldownMs) { this.attempts = attempts; this.delay = delay; this.gaveUp = gaveUp; this.cooldownMs = cooldownMs; }
    }

    /**
     * A session that ran for a while is healthy (restart after {@link #RESTART_MS}, count reset); a quick end counts and
     * backs off; a fatal end never restarts. The caller keeps {@code attempts} between calls.
     */
    static EndPlan afterEnd(int attempts, long ranMs, Policy p, boolean fatal) {
        if (fatal) return new EndPlan(attempts + 1, -1, true, 0);
        if (!isQuickEnd(ranMs)) return new EndPlan(0, RESTART_MS, false, 0);
        int next = attempts + 1;
        long delay = restartDelay(next, p);
        return new EndPlan(next, delay, delay < 0, delay < 0 ? p.cooldownMs : 0);
    }

    /* ---------------------------------------------------------------- sound */

    /** Play the start tone? Only when the policy has it on AND the person started it ("user"); never for "restart",
     * "resume" or "auto". */
    static boolean startSound(Policy p, String reason) { return p.sound && "user".equals(reason); }

    /* ---------------------------------------------------------------- yield */

    /** Why a listener must let go of the microphone now, or null = it may listen. */
    static String yieldReason(boolean micOff, boolean call, boolean silenced, boolean otherApp, boolean focusLost, Policy p) {
        if (micOff) return "mic-off";
        if (call && p.pauseOnCall) return "call";
        if (silenced) return "other-app";
        if ((otherApp || focusLost) && p.pauseForOtherApps) return "other-app";
        return null;
    }

    static long resumeAfterMs(String reason) {
        if (reason == null || reason.isEmpty() || "mic-off".equals(reason)) return 0;
        return RESUME_AFTER_MS;
    }

    /** May a yielded listener come back? {@code freeSince} = when the mic became free (-1 = not free). */
    static boolean mayResume(String reason, long freeSince, long now) { return freeSince >= 0 && now - freeSince >= resumeAfterMs(reason); }

    /** The words people see for a yield reason (= MicRules.label). */
    static String yieldLabel(String reason) {
        if (reason == null || reason.isEmpty()) return "Listening";
        switch (reason) {
            case "mic-off": return "Mic off";
            case "call": return "Paused: a call is using the microphone";
            case "silenced":
            case "other-app": return "Paused: another app is using the microphone";
            default: return "Paused";
        }
    }

    /* ---------------------------------------------------------------- one mic owner */

    private static int rank(String id) { int i = MIC_PRIORITY.indexOf(id); return i < 0 ? MIC_PRIORITY.size() : i; }

    /** Of the listeners asking for the microphone, the one that gets it (null for none). */
    static String micWinner(List<String> asking) {
        List<String> ids = new ArrayList<>(new LinkedHashSet<>(asking));
        ids.removeIf(s -> s == null || s.isEmpty());
        if (ids.isEmpty()) return null;
        ids.sort((a, b) -> { int r = rank(a) - rank(b); return r != 0 ? r : a.compareTo(b); });
        return ids.get(0);
    }

    /** True when {@code asking} would take the microphone from {@code holder} (a higher priority, or nobody holds it). */
    static boolean outranks(String asking, String holder) { return holder == null || holder.isEmpty() || rank(asking) < rank(holder); }
}
