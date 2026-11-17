package ai.amberx.consoleapp;

import java.net.URI;
import java.util.Locale;

/**
 * axHub's {@code amberx} device service on the console app, pure part (no Android imports: {@code DeviceRulesTest}).
 *
 * The console app takes over AmberX's AXPP link (axHub decision #108, console wake Nov 3 2026): it says {@code hello}
 * to the hub with the phone's hub session and answers {@code browser.open} (capability {@code open-url@1}, axHub's
 * {@code amberx.open_url}), so the console's wake (console-commands {@code wake.py}), MCP, the CLI and voice open
 * console pages in this app's overlay. The answer keeps AmberX's shape ({@code opened}, {@code where}, {@code verb},
 * {@code collapsed}, {@code notified}) so the console reads it unchanged.
 *
 * The recorder ({@code recorder@1}: {@code amberx.recorder_start|stop|status}) is not announced here yet: its capture
 * service still lives in AmberX, which keeps answering those calls until it moves.
 */
final class DeviceRules {
    private DeviceRules() {}

    static final String PROTOCOL = "axpp@1";
    static final String APP = "console-droid";
    static final String OPEN = "browser.open";
    static final String OPEN_URL = "open-url@1";
    /** The capabilities this app announces. */
    static final String[] CAPABILITIES = { OPEN_URL };
    /** A console URL carrying {@code axf-overlay=expand|collapse} is an overlay verb, not a page (as in AmberX). */
    static final String VERB_PARAM = "axf-overlay";
    static final String EXPAND = "expand", COLLAPSE = "collapse", PAGE = "open";
    static final int POLL_SECONDS = 25;
    private static final long[] BACKOFF = { 5_000, 15_000, 30_000, 60_000 };
    /** Signed out of the hub, or the hub refused the session: try again this much later. */
    static final long SIGNED_OUT_MS = 60_000;

    static boolean known(String tool) { return OPEN.equals(tool); }

    /** {@link #EXPAND} / {@link #COLLAPSE} when the URL carries {@code axf-overlay=<verb>}, else {@link #PAGE}. */
    static String verb(String url) {
        try {
            String q = new URI(url).getRawQuery();
            if (q == null) return PAGE;
            for (String part : q.split("&")) {
                int eq = part.indexOf('=');
                String k = eq < 0 ? part : part.substring(0, eq);
                String v = eq < 0 ? "" : part.substring(eq + 1).toLowerCase(Locale.ROOT);
                if (VERB_PARAM.equals(k) && (EXPAND.equals(v) || COLLAPSE.equals(v))) return v;
            }
        } catch (Exception ignored) { /* not a URL: a plain open, which the allow-list then refuses */ }
        return PAGE;
    }

    /** Where an open goes: "browser" only when the call asks for it, else the app (its overlay when that is up). */
    static String where(String asked) {
        return "browser".equals(asked) ? "browser" : "app";
    }

    /** The wait before the next try after {@code failures} failures in a row (1-based). */
    static long backoff(int failures) {
        return BACKOFF[Math.max(0, Math.min(failures, BACKOFF.length) - 1)];
    }

    /** The wait after a hub answer that isn't 200/204: signed out for 401/403, else backoff. */
    static long afterStatus(int status, int failures) {
        return status == 401 || status == 403 ? SIGNED_OUT_MS : backoff(failures);
    }
}
