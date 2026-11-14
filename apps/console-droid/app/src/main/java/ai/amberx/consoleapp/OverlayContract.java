package ai.amberx.consoleapp;

import java.util.Arrays;
import java.util.List;
import java.util.Locale;

/**
 * The floating overlay's contract ({@code overlay@1}): the one set of names the native toolbar, the approval bar, the
 * console page, the console API, MCP, the CLI and voice all use for it. Pure Java (no Android imports) so it runs
 * under plain JUnit ({@code OverlayContractTest}) and CI fails when a name drifts.
 *
 * Console app part 2 of 4 (build {@code console-app-part-2-native-floating-2}) on part 1's shell contract
 * ({@code apps/console-droid}, package {@code ai.amberx.consoleapp}, {@code window.axfNativeHost} wrapped by the
 * console as {@code window.axfNative}, {@code native.*} console actions). Brett, Nov 13 2026: "keep it floating on
 * top" and "split the console wrapper so it runs on four slots at the same time".
 *
 * The console-side twin of every list here is {@code apps/console-web/src/native/nativeRules.mjs}
 * ({@code OVERLAY_VERBS}, {@code OVERLAY_SETTINGS}, {@code OVERLAY_SETTING_PREFIX}, {@code APPROVALS_TARGET},
 * {@code PHONE_APP_ADDRESS}); {@code OVERLAY.md} next to this module spells the contract out.
 */
final class OverlayContract {
    private OverlayContract() {}

    static final String VERSION = "overlay@1";

    // ---- states ----------------------------------------------------------------------------------------------------

    /** The small toolbar at the side of the screen. */
    static final String TOOLBAR = "toolbar";
    /** The toolbar with the approval bar opened out of it. */
    static final String APPROVALS = "approvals";
    /** The full-screen console in the overlay window, the toolbar docked top-left. */
    static final String EXPANDED = "expanded";
    static final List<String> STATES = Arrays.asList(TOOLBAR, APPROVALS, EXPANDED);

    // ---- verbs (native.overlay:<verb>, axfNativeHost.overlay(verb), the OVERLAY intent, ?axf-overlay=) -------------

    static final String EXPAND = "expand";
    static final String COLLAPSE = "collapse";
    static final String TOGGLE = "toggle";
    /** Opens the console on the approvals list (the approval bar's link, the badge). */
    static final String APPROVALS_VERB = "approvals";
    /** Hides the approval bar until a new approval arrives; the expanded console stays. */
    static final String DISMISS = "dismiss";
    static final List<String> VERBS = Arrays.asList(EXPAND, COLLAPSE, TOGGLE, APPROVALS_VERB, DISMISS);
    /** The verbs a console URL may carry as {@code ?axf-overlay=<verb>} (axHub's {@code amberx.open_url}, as in AmberX). */
    static final List<String> URL_VERBS = Arrays.asList(EXPAND, COLLAPSE);
    /** Verbs that never start the app when the overlay isn't running: nothing to fold. */
    static final List<String> PASSIVE_VERBS = Arrays.asList(COLLAPSE, DISMISS);

    static boolean isVerb(String verb) { return verb != null && VERBS.contains(verb.toLowerCase(Locale.ROOT)); }

    /** The error text the bridge answers for a verb that isn't one. */
    static String verbsHelp() { return "overlay verbs: " + String.join(", ", VERBS); }

    // ---- the bridge (window.axfNativeHost → window.axfNative.call) -------------------------------------------------

    /** {@code overlay(verb)}: runs a verb. */
    static final String M_VERB = "overlay";
    /** {@code overlayState()}: {@code {ok, overlay: <state json>, canDraw}}. */
    static final String M_STATE = "overlayState";
    /** {@code overlayConfigure(json)}: the console's {@code approvals-banner.overlay.*} settings. */
    static final String M_CONFIGURE = "overlayConfigure";
    /** {@code overlayApprovals(count, held, firstTitle)}: what waits. */
    static final String M_APPROVALS = "overlayApprovals";
    static final List<String> METHODS = Arrays.asList(M_VERB, M_STATE, M_CONFIGURE, M_APPROVALS);

    // ---- events (window 'axf-native', detail.type) ------------------------------------------------------------------

    /** The overlay's state changed; {@code data} is {@link #stateJson}. */
    static final String EV_STATE = "overlay";
    /** The toolbar was dragged; {@code data} is {@code {edge, top}}: the page saves them into the settings. */
    static final String EV_MOVED = "overlay.moved";
    /** Open the approvals list in the running page; {@code data} is {@code {target: "approvals.view"}}. */
    static final String EV_APPROVALS_OPEN = "approvals.open";
    /** A permission prompt was answered; {@code data} is {@code {mic, notifications, overlay}}. */
    static final String EV_PERMISSIONS = "permissions";
    static final List<String> EVENTS = Arrays.asList(EV_STATE, EV_MOVED, EV_APPROVALS_OPEN, EV_PERMISSIONS);

    // ---- settings (the console's own: Settings → Plugins → Approvals banner) ---------------------------------------

    static final String SETTING_PREFIX = "approvals-banner.overlay.";
    static final String S_ON = "on", S_EDGE = "edge", S_TOP = "top", S_SIZE = "size", S_EXPAND = "expand", S_IDLE_OPACITY = "idleOpacity";
    static final List<String> SETTINGS = Arrays.asList(S_ON, S_EDGE, S_TOP, S_SIZE, S_EXPAND, S_IDLE_OPACITY);
    static final List<String> EDGES = Arrays.asList("end", "start");
    static final List<String> SIZES = Arrays.asList("small", "medium", "large");
    /** What pops the approval bar: every approval, held commands only, never. */
    static final List<String> EXPANDS = Arrays.asList("every", "held", "never");
    static final int TOP_MIN = 0, TOP_MAX = 90, TOP_DEFAULT = 30;
    static final int IDLE_OPACITY_MIN = 40, IDLE_OPACITY_MAX = 100, IDLE_OPACITY_DEFAULT = 85;

    static String settingKey(String shortKey) { return SETTING_PREFIX + shortKey; }

    // ---- the four ways in, all the same ----------------------------------------------------------------------------

    /** The console action: {@code native.overlay:<verb>} (REST {@code POST /api/console/action}, MCP {@code console_action}, CLI {@code axf console action}, voice). */
    static final String ACTION_OVERLAY = "native.overlay";
    /** {@code native.permission:overlay} asks for "Display over other apps". */
    static final String ACTION_PERMISSION = "native.permission";
    /** {@code native.state}: the phone app's whole state, the overlay inside it. */
    static final String ACTION_STATE = "native.state";
    /** The console-control@1 address whose {@code state} verb answers the phone app's state (REST, MCP, CLI). */
    static final String CONTROL_ADDRESS = "panel:phone-app";
    /** The console action the approval bar's link opens; also the deep link {@code axf-console://open/approvals.view}. */
    static final String APPROVALS_TARGET = "approvals.view";
    /** The short permission name ({@code Perms.OVERLAY}) and the Android permission behind it. */
    static final String PERMISSION = "overlay";
    static final String ANDROID_PERMISSION = "android.permission.SYSTEM_ALERT_WINDOW";

    /** The intent the service answers (deep links, the CLI's adb path) and the extra that carries the verb. */
    static final String INTENT_ACTION = "ai.amberx.consoleapp.OVERLAY";
    static final String INTENT_EXTRA = "verb";
    static final String PACKAGE = "ai.amberx.consoleapp";
    static final String SERVICE = PACKAGE + "/.OverlayService";
    /** The console URL parameter axHub opens carry ({@code DeviceRules.VERB_PARAM}). */
    static final String URL_PARAM = "axf-overlay";

    /** {@code native.overlay:<verb>}, the action id every API runs. */
    static String action(String verb) { return ACTION_OVERLAY + ":" + verb; }

    /** The deep link that opens the approvals list in the app. */
    static String approvalsLink() { return ShellRules.SCHEME + "://open/" + APPROVALS_TARGET; }

    /** The adb command behind the CLI's USB path for a verb, or null for a verb that isn't one. */
    static String adb(String verb) {
        if (!isVerb(verb)) return null;
        return "adb shell am start-foreground-service -n " + SERVICE + " -a " + INTENT_ACTION + " --es " + INTENT_EXTRA + " " + verb.toLowerCase(Locale.ROOT);
    }

    // ---- the state every API reads -------------------------------------------------------------------------------

    static final List<String> STATE_KEYS = Arrays.asList("running", "state", "waiting", "held", "dismissedAt", S_ON, S_EDGE, S_TOP, S_SIZE, S_EXPAND, S_IDLE_OPACITY);

    /**
     * {"running":true,"state":"toolbar","waiting":2,"held":0,"dismissedAt":0,"on":true,"edge":"end","top":30,"size":"small","expand":"every","idleOpacity":85}
     * The {@link #EV_STATE} event's data, and {@code overlay} in {@link #M_STATE}'s answer.
     */
    static String stateJson(boolean running, String state, int waiting, int held, int dismissedAt, OverlayRules.Config c) {
        String s = STATES.contains(state) ? state : TOOLBAR;
        return "{\"running\":" + running + ",\"state\":\"" + s + "\",\"waiting\":" + Math.max(0, waiting) + ",\"held\":" + Math.max(0, held)
            + ",\"dismissedAt\":" + Math.max(0, dismissedAt) + ",\"on\":" + c.on + ",\"edge\":\"" + c.edge + "\",\"top\":" + c.top
            + ",\"size\":\"" + c.size + "\",\"expand\":\"" + c.expand + "\",\"idleOpacity\":" + c.idleOpacity + "}";
    }
}
