package ai.amberx.consoleapp;

/**
 * The "Display over other apps" flow's pure rules (part 2, s3). No Android imports, so it runs under plain JUnit
 * ({@code OverlayPermissionTest}).
 *
 * One tap: the console (Settings → Plugins → Approvals banner, {@code native.permission:overlay} from REST, MCP, the
 * CLI or voice) or the app's first start with the toolbar on asks; the shell explains in one line why before
 * Android's settings page opens (Android shows a bare list of apps there); coming back it checks the permission,
 * starts the toolbar when granted, and says so either way. The explanation shows on its own once; after "Not now" it
 * only comes back when something asks again.
 */
final class OverlayPermission {
    private OverlayPermission() {}

    /** What to do when asked: nothing (granted), explain first, or straight to Android's page (explained already). */
    static final String NONE = "none", EXPLAIN = "explain", SETTINGS = "settings";
    /** After coming back from Android's page. */
    static final String GRANTED = "granted", STILL_OFF = "still-off", UNCHANGED = "unchanged";

    static final String TITLE = "Let the console float over other apps";
    static final String BODY = "The console's toolbar sits on top of whatever app is open, so approvals reach you and the "
        + "console is one tap away. Android asks for \"Display over other apps\": on the next screen, find AXF Console "
        + "and switch it on.";
    static final String ALLOW = "Open settings";
    static final String NOT_NOW = "Not now";
    static final String ON = "Floating toolbar is on";
    static final String OFF = "\"Display over other apps\" is still off: the toolbar stays hidden";

    /**
     * An explicit ask (the console, a verb, the API): explain when the explanation hasn't been seen in this ask yet,
     * else straight to Android's page; nothing when it is already granted.
     */
    static String onAsk(boolean granted, boolean explainedThisAsk) {
        if (granted) return NONE;
        return explainedThisAsk ? SETTINGS : EXPLAIN;
    }

    /** The app's start: offer once when the toolbar is on, the permission is missing and the offer was never shown. */
    static String onStart(boolean toolbarOn, boolean granted, boolean offeredBefore) {
        if (!toolbarOn || granted || offeredBefore) return NONE;
        return EXPLAIN;
    }

    /** Back from Android's page (only when the flow sent Brett there). */
    static String afterReturn(boolean sentToSettings, boolean grantedBefore, boolean grantedNow) {
        if (!sentToSettings) return UNCHANGED;
        if (grantedNow) return grantedBefore ? UNCHANGED : GRANTED;
        return STILL_OFF;
    }

    /** The line the shell shows for an outcome, or null for none. */
    static String message(String outcome) {
        if (GRANTED.equals(outcome)) return ON;
        if (STILL_OFF.equals(outcome)) return OFF;
        return null;
    }

    /** The {@code permissions} event's data with the flow's outcome: {"mic":…,"notifications":…,"overlay":…,"overlayFlow":"granted"}. */
    static String withOutcome(String stateJson, String outcome) {
        if (stateJson == null || !stateJson.endsWith("}") || outcome == null || UNCHANGED.equals(outcome)) return stateJson;
        String body = stateJson.substring(0, stateJson.length() - 1);
        return body + (body.equals("{") ? "" : ",") + "\"overlayFlow\":\"" + outcome + "\"}";
    }
}
