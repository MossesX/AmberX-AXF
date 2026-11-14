package ai.amberx.consoleapp;

import java.util.Arrays;
import java.util.List;
import org.json.JSONObject;

/**
 * Mic and permission rules (console app part 3, s4). No Android imports: JUnit {@code MicRulesTest}.
 *
 * <ul>
 *   <li>The <b>mic switch</b> ({@code mic.set}, stored in the app's preferences, on by default) says whether the console
 *       may use the mic at all: talk mode and dictation ({@code getUserMedia} in the WebView) and the recorder's "with
 *       mic". Off means the WebView's audio requests are denied without a prompt, whatever Android allows.</li>
 *   <li>Android's {@code RECORD_AUDIO} is the second gate: {@code mic.status} says {@code available} only when both
 *       are open, and {@code reason} says which one is closed.</li>
 *   <li>{@code permissions.request} answers at once: {@code granted: true} when it already was, else
 *       {@code asked: true} and the prompt's answer comes later as the {@code permission} event.</li>
 * </ul>
 */
final class MicRules {
    private MicRules() {}

    static final String PREF_MIC = "mic.on";
    static final boolean DEFAULT_ON = true;

    static final String REASON_OK = "ok";
    static final String REASON_SWITCH = "switched_off";
    static final String REASON_PERMISSION = "no_permission";

    /** The permission keys a page may ask for (BridgeContract's short keys). */
    static final List<String> REQUESTABLE = Arrays.asList("mic", "notifications", "overlay");

    static String reason(boolean switchOn, boolean granted) {
        if (!switchOn) return REASON_SWITCH;
        if (!granted) return REASON_PERMISSION;
        return REASON_OK;
    }

    static JSONObject status(boolean switchOn, boolean granted) {
        try {
            return new JSONObject().put("on", switchOn).put("granted", granted).put("available", switchOn && granted)
                .put("reason", reason(switchOn, granted));
        } catch (Exception e) { throw new IllegalStateException(e); }
    }

    /** {@code mic.set}'s {@code on}: required and a real boolean (mic.on / mic.off fill it in from the name). */
    static boolean onOf(JSONObject args) {
        Object v = args == null ? null : args.opt("on");
        if (!(v instanceof Boolean)) throw new IllegalArgumentException("on (true or false) is required.");
        return (Boolean) v;
    }

    /** {@code permissions.request}'s {@code permission}: one of {@link #REQUESTABLE}. */
    static String permissionOf(JSONObject args) {
        String p = args == null ? "" : args.optString("permission", "").trim().toLowerCase(java.util.Locale.ROOT);
        if ("microphone".equals(p) || "record_audio".equals(p)) p = "mic";
        if ("notify".equals(p) || "notification".equals(p)) p = "notifications";
        if (!REQUESTABLE.contains(p)) throw new IllegalArgumentException("permission must be one of " + REQUESTABLE + ".");
        return p;
    }

    /** Whether the WebView may capture audio for a page: the page is Brett's, the switch is on (Android asks after). */
    static boolean webCaptureAllowed(boolean ownSite, boolean switchOn) { return ownSite && switchOn; }

    static JSONObject requested(String permission, boolean granted, boolean asked) {
        try { return new JSONObject().put("permission", permission).put("granted", granted).put("asked", asked); }
        catch (Exception e) { throw new IllegalStateException(e); }
    }
}
