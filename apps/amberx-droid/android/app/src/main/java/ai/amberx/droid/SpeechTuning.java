package ai.amberx.droid;

import android.content.Context;
import android.content.Intent;
import android.media.AudioManager;
import android.speech.RecognizerIntent;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.json.JSONObject;

/**
 * How AmberX listens (Oct 28 2026, Brett: "misses what I say, filters swears, text doesn't show up in real time, it's
 * constantly making a tone"). One place for the recognizer request, the beep silencer, loose wake-phrase matching and
 * the swear un-masker, shared by the hands-free loop (WatchService) and the Speak / dictation call (AmberxNativePlugin).
 *
 * The pure parts (`compact`, `wakeHit`, `unmask`) mirror `src/plugins/voice/web/speech.ts` and are unit tested on both
 * sides with the same cases (SpeechTuningTest, test.mjs).
 *
 * Voice config keys (from the web side's voice settings): `beep` = "silence" (default) | "silence-all" | "on",
 * `online` (default true: Google's online model hears far better; offline is the fallback), `swears` (default true:
 * show words as said).
 */
final class SpeechTuning {
    private SpeechTuning() {}

    /* ---------------------------------------------------------------- the recognizer request */

    /**
     * @param longTurn hands-free: keep each listening turn long, so the recognizer restarts (and would beep) rarely
     */
    static Intent request(String lang, JSONObject voice, boolean longTurn) {
        boolean online = voice == null || voice.optBoolean("online", true);
        boolean swears = voice == null || voice.optBoolean("swears", true);
        Intent i = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE, lang)
            .putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
            .putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 5)
            .putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, !online)
            // Don't cut people off mid-sentence: wait for a real pause before calling it done.
            .putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, longTurn ? 2500L : 2000L)
            .putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS, longTurn ? 2000L : 1500L);
        if (longTurn) i.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_MINIMUM_LENGTH_MILLIS, 15_000L);
        // Android 13+: ask the recognizer not to star out swear words (older ones are un-masked by `unmask`).
        if (swears) i.putExtra("android.speech.extra.MASK_OFFENSIVE_WORDS", false);
        return i;
    }

    /* ---------------------------------------------------------------- the beep */

    private static final int[] QUIET = { AudioManager.STREAM_NOTIFICATION, AudioManager.STREAM_SYSTEM };
    private static final int[] QUIET_ALL = { AudioManager.STREAM_NOTIFICATION, AudioManager.STREAM_SYSTEM, AudioManager.STREAM_MUSIC };
    private static int[] muted = new int[0];

    /**
     * Silences the recognizer's start/stop tone while AmberX listens. "silence" mutes the notification and system
     * streams (where most phones play it); "silence-all" also media, for phones that play it there (AmberX unmutes
     * media while it speaks). Called on the main thread. Never throws (Do Not Disturb can refuse).
     */
    static synchronized void quiet(Context c, JSONObject voice) {
        quietMode(c, voice == null ? "silence" : voice.optString("beep", "silence"));
    }

    /**
     * The silent wake mode's mute around one Google utterance (Oct 29 2026): always silences (a "Leave it on" tone
     * setting still mutes here; "Play tone on trigger" is what lets the tone through), also media for "silence-all".
     */
    static void quietTrigger(Context c, JSONObject voice) {
        quietMode(c, voice != null && "silence-all".equals(voice.optString("beep", "")) ? "silence-all" : "silence");
    }

    static synchronized void quietMode(Context c, String mode) {
        int[] want = "on".equals(mode) ? new int[0] : "silence-all".equals(mode) ? QUIET_ALL : QUIET;
        if (sameStreams(want, muted)) return;
        loud(c);
        AudioManager am = (AudioManager) c.getSystemService(Context.AUDIO_SERVICE);
        if (am == null) return;
        List<Integer> done = new ArrayList<>();
        for (int s : want) {
            try { am.adjustStreamVolume(s, AudioManager.ADJUST_MUTE, 0); done.add(s); } catch (Exception ignored) {}
        }
        muted = new int[done.size()];
        for (int k = 0; k < done.size(); k++) muted[k] = done.get(k);
    }

    /** Puts back every stream `quiet` muted. */
    static synchronized void loud(Context c) {
        if (muted.length == 0) return;
        AudioManager am = (AudioManager) c.getSystemService(Context.AUDIO_SERVICE);
        for (int s : muted) {
            try { if (am != null) am.adjustStreamVolume(s, AudioManager.ADJUST_UNMUTE, 0); } catch (Exception ignored) {}
        }
        muted = new int[0];
    }

    /** True while media is muted by `quiet` (spoken replies need it back). */
    static synchronized boolean mediaMuted() {
        for (int s : muted) if (s == AudioManager.STREAM_MUSIC) return true;
        return false;
    }

    static synchronized void unmuteMedia(Context c) {
        if (!mediaMuted()) return;
        AudioManager am = (AudioManager) c.getSystemService(Context.AUDIO_SERVICE);
        try { if (am != null) am.adjustStreamVolume(AudioManager.STREAM_MUSIC, AudioManager.ADJUST_UNMUTE, 0); } catch (Exception ignored) {}
        int[] rest = new int[muted.length - 1];
        int k = 0;
        for (int s : muted) if (s != AudioManager.STREAM_MUSIC) rest[k++] = s;
        muted = rest;
    }

    private static boolean sameStreams(int[] a, int[] b) {
        if (a.length != b.length) return false;
        for (int x : a) { boolean hit = false; for (int y : b) if (x == y) hit = true; if (!hit) return false; }
        return true;
    }

    /* ---------------------------------------------------------------- pure: wake phrases */

    /** Lower case, letters and digits only, no spaces ("Hey, Amber X!" → "heyamberx"). */
    static String compact(String s) {
        return s == null ? "" : s.toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9]+", "");
    }

    /**
     * The wake phrase found in what was heard, or null. Loose on purpose: spaces and punctuation don't count, and the
     * ways recognizers spell "amberx" (amber x, amber ex, amberex, ambrex, ember x, amber acts) all match.
     */
    static String wakeHit(String heard, List<String> phrases) {
        String h = loosen(compact(heard));
        if (h.isEmpty()) return null;
        String best = null;
        for (String p : phrases) {
            String c = loosen(compact(p));
            if (!c.isEmpty() && h.contains(c) && (best == null || c.length() > loosen(compact(best)).length())) best = p;
        }
        return best;
    }

    private static final String[][] AMBERX = {
        { "amberacts", "amberx" }, { "amberex", "amberx" }, { "ambrex", "amberx" }, { "emberx", "amberx" },
        { "emberex", "amberx" }, { "amberax", "amberx" }, { "amberix", "amberx" },
        { "okayamberx", "okamberx" },
    };

    static String loosen(String compacted) {
        String s = compacted;
        for (String[] r : AMBERX) s = s.replace(r[0], r[1]);
        return s;
    }

    /* ---------------------------------------------------------------- pure: swear words */

    private static final Map<String, String> MASKED = new LinkedHashMap<>();
    static {
        MASKED.put("f******", "fucking");
        MASKED.put("f*****", "fucked");
        MASKED.put("f****r", "fucker");
        MASKED.put("f***", "fuck");
        MASKED.put("m***********", "motherfucker");
        MASKED.put("s***", "shit");
        MASKED.put("b****", "bitch");
        MASKED.put("a******", "asshole");
        MASKED.put("a**", "ass");
        MASKED.put("d***", "damn");
        MASKED.put("c***", "cunt");
        MASKED.put("p****", "pussy");
        MASKED.put("b*******", "bullshit");
        MASKED.put("h***", "hell");
    }
    private static final Pattern STARRED = Pattern.compile("\\b([A-Za-z])(\\*+)([A-Za-z]*)");

    /** Puts back swear words a recognizer starred out ("f*** this" → "fuck this"). Unknown starred words are left. */
    static String unmask(String text) {
        if (text == null || text.indexOf('*') < 0) return text;
        Matcher m = STARRED.matcher(text);
        StringBuffer out = new StringBuffer();
        while (m.find()) {
            String key = (m.group(1) + m.group(2) + m.group(3)).toLowerCase(Locale.ROOT);
            String word = MASKED.get(key);
            if (word == null) { m.appendReplacement(out, Matcher.quoteReplacement(m.group())); continue; }
            if (Character.isUpperCase(m.group(1).charAt(0))) word = Character.toUpperCase(word.charAt(0)) + word.substring(1);
            m.appendReplacement(out, Matcher.quoteReplacement(word));
        }
        m.appendTail(out);
        return out.toString();
    }

    /** `unmask` when the voice config wants swear words shown (the default). */
    static String clean(String text, JSONObject voice) {
        return voice == null || voice.optBoolean("swears", true) ? unmask(text) : text;
    }

}
