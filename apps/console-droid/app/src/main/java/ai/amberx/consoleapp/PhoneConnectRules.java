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
 * {@code amberx.open_url} ({@link DeviceLink#open}). When this app can't (not installed, overlay off, "Display over
 * other apps" not granted, a page outside Brett's sites), Phone Connect opens the page itself as before.
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
    /** The overlay is off in the settings or "Display over other apps" isn't granted: Phone Connect opens it itself. */
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

    /** Why an open isn't this app's to do, or null when it opens here: {@code where=browser}, or no overlay to open it in. */
    static String handOff(String where, boolean overlayOn, boolean canDraw) {
        if ("browser".equals(DeviceRules.where(where))) return BROWSER;
        if (!overlayOn || !canDraw) return NO_OVERLAY;
        return null;
    }

    /** The text that goes with a code. */
    static String message(String code) {
        if (DENIED.equals(code)) return "Only Phone Connect may open pages in the console app's overlay.";
        if (VALIDATION.equals(code)) return "The console app's overlay answers " + String.join(", ", METHODS) + " with an https page on Brett's sites.";
        if (NO_OVERLAY.equals(code)) return "The console app's floating toolbar is off or not allowed to draw over other apps.";
        if (BROWSER.equals(code)) return "The command asked for the browser.";
        return "";
    }
}
