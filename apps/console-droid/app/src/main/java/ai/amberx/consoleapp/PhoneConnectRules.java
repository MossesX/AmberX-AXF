package ai.amberx.consoleapp;

import java.util.Arrays;
import java.util.List;

/**
 * The hand-off from Phone Connect ({@code apps/phone-connect}, phone-connect@1) to the console app's floating overlay,
 * pure part (no Android imports: {@code PhoneConnectRulesTest}).
 *
 * Phone Connect answers the console's {@code open_url} command ({@code browser.open} on the wire). When the command
 * asks for the overlay ({@code where: overlay}, the default) and the console app is installed, Phone Connect asks this
 * app first through one synchronous {@code ContentResolver.call} on {@link #AUTHORITY}; the page then loads in the one
 * console WebView and the floating toolbar expands over whatever is on screen, exactly as for axHub's
 * {@code amberx.open_url} ({@link DeviceLink#open}). With the toolbar switched off but "Display over other apps"
 * granted, the app itself comes to the front on the page: the permission is Android's exemption from the
 * background-start block, so no notification tap is needed. When this app can't (not installed, the permission not
 * granted, a page outside Brett's sites, Android held the start back), Phone Connect opens the page itself.
 *
 * The Kotlin twin of these names is {@code apps/phone-connect/.../watch/ConsoleOverlay.kt};
 * {@code PhoneConnectRulesTest} fails when they drift.
 */
final class PhoneConnectRules {
    private PhoneConnectRules() {}

    static final String VERSION = "console-overlay@1";
    /** The provider authority Phone Connect calls ({@code content://ai.amberx.consoleapp.overlay}). */
    static final String AUTHORITY = OverlayContract.PACKAGE + ".overlay";
    /** {@code call(OPEN, url, {where})}: open a page (or run its {@code ?axf-overlay=} verb) in the overlay. */
    static final String OPEN = "open";
    /** {@code call(STATE, null, null)}: whether an open would land in the overlay, and the overlay's state. */
    static final String STATE = "state";
    static final List<String> METHODS = Arrays.asList(OPEN, STATE);
    /** The extra that carries the command's {@code where} ({@code overlay} or {@code browser}). */
    static final String EXTRA_WHERE = "where";

    /** The apps allowed to call: Phone Connect, and this app itself. Android checks the package belongs to the caller. */
    static final String PHONE_CONNECT = "ai.amberx.axf.phoneconnect";
    static final List<String> CALLERS = Arrays.asList(PHONE_CONNECT, OverlayContract.PACKAGE);

    // ---- the answer Bundle's keys -----------------------------------------------------------------------------------

    static final String K_OK = "ok", K_CODE = "code", K_MESSAGE = "message", K_JSON = "json";

    // ---- error codes (phone-connect@1's wire codes, so Phone Connect can pass them on unchanged) --------------------

    /** Not Phone Connect or this app. */
    static final String DENIED = "denied";
    /** A method that isn't one, or a url this app won't load. */
    static final String VALIDATION = "validation";
    /** "Display over other apps" isn't granted, so this app may not come to the front by itself: Phone Connect opens it. */
    static final String NO_OVERLAY = "no_overlay";
    /** The command asked for the browser: Phone Connect opens it itself. */
    static final String BROWSER = "browser";
    /** Opening failed inside this app; Phone Connect opens it itself. */
    static final String UNAVAILABLE = "unavailable";

    /** Why a call is refused before anything runs, or null when it may go on. */
    static String refuse(String callingPackage, String method) {
        if (callingPackage == null || !CALLERS.contains(callingPackage)) return DENIED;
        if (method == null || !METHODS.contains(method)) return VALIDATION;
        return null;
    }

    /** How a page opened here, in Phone Connect's result ({@code how}): in the expanded overlay, or the app in front. */
    static final String HOW_OVERLAY = "console-overlay", HOW_APP = "console-app";
    /** How long the provider waits for the app to be on screen after it started it from the background. */
    static final long FRONT_WAIT_MS = 2_000;

    /**
     * Why an open isn't this app's to do, or null when it opens here: {@code where=browser}, or "Display over other
     * apps" not granted (Android would hold a start from the background back). The toolbar switched off is no reason:
     * with the permission the app itself comes to the front ({@link #how}).
     */
    static String handOff(String where, boolean overlayOn, boolean canDraw) {
        if ("browser".equals(DeviceRules.where(where))) return BROWSER;
        if (!canDraw) return NO_OVERLAY;
        return null;
    }

    /** {@link #HOW_OVERLAY} when the page is in the expanded overlay, {@link #HOW_APP} when the app came to the front. */
    static String how(boolean inOverlay) { return inOverlay ? HOW_OVERLAY : HOW_APP; }

    /**
     * Whether the page is really on screen: the overlay took it, or the app became visible within the wait. A start
     * from the background that Android holds back raises nothing, so only this proves it opened.
     */
    static boolean front(boolean inOverlay, boolean appVisible) { return inOverlay || appVisible; }

    /** The text that goes with a code. */
    static String message(String code) {
        if (DENIED.equals(code)) return "Only Phone Connect may open pages in the console app's overlay.";
        if (VALIDATION.equals(code)) return "The console app's overlay answers " + String.join(", ", METHODS) + " with an https page on Brett's sites.";
        if (NO_OVERLAY.equals(code)) return "The console app isn't allowed to display over other apps, so it can't come to the front by itself.";
        if (UNAVAILABLE.equals(code)) return "Android held the console app back: it did not come to the front.";
        if (BROWSER.equals(code)) return "The command asked for the browser.";
        return "";
    }
}
