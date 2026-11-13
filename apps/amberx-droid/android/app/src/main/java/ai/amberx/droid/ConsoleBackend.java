package ai.amberx.droid;

import java.net.URLEncoder;

/**
 * The console routes the phone app reads (build change-to-move-amberx-web-app-into-the-console-amberx-andr-pr-528-brett-do;
 * contract docs/contracts/amberx-console-api.md). The app is the Dev Console: it shows https://console.amberxai.com and
 * every notification it raises (text, approvals, alerts) comes from the console's alerts feed. Brett, Nov 13 2026: "Only
 * build the Console Android app with all notifications (text, approvals, alerts) going through the console."
 *
 * Everything here is pure, so the JVM unit tests (ConsoleBackendTest) run it.
 */
final class ConsoleBackend {
    private ConsoleBackend() {}

    static final String CONSOLE_URL = HubRules.CONSOLE;
    /** The approvals plugin's watch on the console (approvals-banner, GET watch): on when the console raises approvals. */
    static final String APPROVALS_WATCH_PATH = "/api/plugins/approvals-banner/watch";

    static String enc(String s) {
        try { return URLEncoder.encode(s == null ? "" : s, "UTF-8"); } catch (java.io.UnsupportedEncodingException e) { return ""; }
    }

    /** The alerts feed for this phone: the phone's view, recorded in the device's notification history (contract C1, C3). */
    static String alertsUrl(String device) {
        String d = device == null ? "" : device.trim();
        return CONSOLE_URL + HubRules.ALERTS_PATH + "?view=phone" + (d.isEmpty() ? "" : "&device=" + enc(d));
    }

    static String approvalsWatchUrl() { return CONSOLE_URL + APPROVALS_WATCH_PATH; }

    /**
     * True when the console's approvals watch is on and its last read of axHub worked (state ok): the console then raises every
     * waiting approval as an alert (`approvals:<id>`) and the phone shows that one instead of its own. Anything else (the
     * console unreachable, signed out, its watch off or failing) keeps the phone's own approvals read, so no approval is
     * ever missed.
     */
    static boolean consoleCarriesApprovals(int status, String body) {
        if (status != 200 || body == null) return false;
        try {
            org.json.JSONObject w = new org.json.JSONObject(body);
            return w.optBoolean("on", false) && "ok".equals(w.optString("state", ""));
        } catch (Exception e) {
            return false;
        }
    }

    /** A held veto call's console alert (approvals-banner watch key `approvals:veto:<id>`). */
    static boolean isVetoAlert(String key) { return key != null && key.startsWith("approvals:veto:"); }
}
