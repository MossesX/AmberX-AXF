package ai.amberx.droid;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import org.json.JSONArray;

/**
 * The silent wake listener's rules, pure (no Android imports): the Vosk grammar for the wake phrases, when a result may
 * trigger (sensitivity + input level gate) and the level scale. Mirrors `src/plugins/voice/web/wake.ts`; both are held
 * to `wake-cases.json` (WakeRulesTest, test.mjs).
 */
final class WakeRules {
    private WakeRules() {}

    static final int MAX_GRAMMAR = 64;

    static String sensitivity(Object v) {
        return "low".equals(v) || "high".equals(v) ? (String) v : "normal";
    }

    static String mode(Object v) { return "classic".equals(v) ? "classic" : "wake"; }

    private static String[] variants(String w) {
        switch (w) {
            case "amberx": return new String[] { "amberx", "amber x", "amber ex", "amber acts" };
            case "okay": return new String[] { "okay", "ok" };
            case "ok": return new String[] { "ok", "okay" };
            default: return new String[] { w };
        }
    }

    /** Every phrase spelled the ways a small model hears it, then "[unk]". */
    static List<String> grammar(List<String> phrases) {
        List<String> out = new ArrayList<>();
        for (String p : phrases) {
            List<String> acc = new ArrayList<>();
            acc.add("");
            boolean any = false;
            for (String w : p.toLowerCase(Locale.ROOT).split("[^a-z0-9]+")) {
                if (w.isEmpty()) continue;
                any = true;
                List<String> next = new ArrayList<>();
                for (String a : acc) for (String v : variants(w)) next.add(a.isEmpty() ? v : a + " " + v);
                acc = next;
            }
            if (!any) continue;
            for (String a : acc) if (!out.contains(a) && out.size() < MAX_GRAMMAR) out.add(a);
        }
        out.add("[unk]");
        return out;
    }

    /** The grammar as the JSON array Vosk's Recognizer takes. */
    static String grammarJson(List<String> phrases) {
        JSONArray a = new JSONArray();
        for (String g : grammar(phrases)) a.put(g);
        return a.toString();
    }

    static String clean(String text) {
        return text == null ? "" : text.replace("[unk]", " ").replaceAll("\\s+", " ").trim();
    }

    /** The quietest peak input level (0..1) that may trigger. */
    static double minLevel(String sensitivity) {
        String s = sensitivity(sensitivity);
        return "low".equals(s) ? 0.3 : "high".equals(s) ? 0 : 0.12;
    }

    /** The wake phrase this result should trigger, or null. */
    static String trigger(String heard, boolean partial, String sensitivity, double peakLevel, List<String> phrases) {
        String s = sensitivity(sensitivity);
        if (partial && "low".equals(s)) return null;
        if (!(peakLevel >= minLevel(s))) return null;
        String h = clean(heard);
        return h.isEmpty() ? null : SpeechTuning.wakeHit(h, phrases);
    }

    static double levelOfDbfs(double dbfs) {
        if (Double.isNaN(dbfs) || Double.isInfinite(dbfs)) return 0;
        return Math.max(0, Math.min(1, (dbfs + 70) / 60));
    }

    static double recognizerDb(double level) { return -2 + 12 * Math.max(0, Math.min(1, level)); }

    /** dBFS of 16-bit samples; -Infinity for silence. */
    static double dbfs(short[] samples, int n) {
        double sum = 0;
        for (int i = 0; i < n; i++) { double v = samples[i] / 32768.0; sum += v * v; }
        double rms = n > 0 ? Math.sqrt(sum / n) : 0;
        return rms > 0 ? 20 * Math.log10(rms) : Double.NEGATIVE_INFINITY;
    }
}
