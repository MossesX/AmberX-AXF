package ai.amberx.consoleapp;

import java.net.URI;
import java.util.Locale;
import java.util.regex.Pattern;

/**
 * The pure device rules of the console app (no Android imports: JUnit {@code DeviceRulesTest}, {@code HubLinkRulesTest}).
 *
 * Two users share this class:
 * <ul>
 *   <li>axHub's {@code amberx} device service ({@link DeviceLink}, part 1). The console app takes over AmberX's AXPP
 *       link (axHub decision #108, console wake Nov 3 2026): it says {@code hello} to the hub with the phone's hub
 *       session and answers {@code browser.open} (capability {@code open-url@1}, axHub's {@code amberx.open_url}), so
 *       the console's wake (console-commands {@code wake.py}), MCP, the CLI and voice open console pages in this app's
 *       overlay. The answer keeps AmberX's shape ({@code opened}, {@code where}, {@code verb}, {@code collapsed},
 *       {@code notified}) so the console reads it unchanged. The recorder ({@code recorder@1}) is not announced here
 *       yet: its capture service still lives in AmberX, which keeps answering those calls until it moves.</li>
 *   <li>The bridge's device tools ({@link DeviceTools}, part 3): where a page opens, which page a console wake opens,
 *       notification ids.</li>
 * </ul>
 */
final class DeviceRules {
    private DeviceRules() {}

    // ---- shared ----

    /** {@code where}: the console app itself (its overlay when that is up). */
    static final String APP = "app";
    /** {@code where}: the phone's browser. */
    static final String BROWSER = "browser";

    /** {@code where}: {@code browser} only when the call asks for it (any case), else the console app. */
    static String where(String raw) {
        return raw != null && BROWSER.equals(raw.trim().toLowerCase(Locale.ROOT)) ? BROWSER : APP;
    }

    // ---- axHub device service (DeviceLink) ----

    static final String PROTOCOL = "axpp@1";
    /** The app name this device announces to the hub in {@code hello}. */
    static final String APP_ID = "console-droid";
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

    /** The wait before the next try after {@code failures} failures in a row (1-based). */
    static long backoff(int failures) {
        return BACKOFF[Math.max(0, Math.min(failures, BACKOFF.length) - 1)];
    }

    /** The wait after a hub answer that isn't 200/204: signed out for 401/403, else backoff. */
    static long afterStatus(int status, int failures) {
        return status == 401 || status == 403 ? SIGNED_OUT_MS : backoff(failures);
    }

    // ---- bridge device tools (DeviceTools) ----

    static final String OPEN_NOTE = "axf-open-url";
    static final String WAKE_NOTE = "axf-console-wake";
    /** A console-control@1 address or action id: {@code settings}, {@code panel:phone-app}, {@code plugin:notes/open}. */
    private static final Pattern TARGET = Pattern.compile("^[A-Za-z0-9][A-Za-z0-9_.:/@-]{0,199}$");
    private static final Pattern NOTE_ID = Pattern.compile("^[A-Za-z0-9_.:-]{1,64}$");

    static boolean validTarget(String t) { return t != null && TARGET.matcher(t).matches(); }

    /**
     * The page a wake opens: the console at {@code ?axf-open=<target>} for a console-control address, else {@code url}
     * when it is one of Brett's pages, else the console's home.
     */
    static String wakeUrl(String target, String url) {
        String t = target == null ? "" : target.trim();
        if (!t.isEmpty()) {
            if (!validTarget(t)) throw new IllegalArgumentException("target isn't a console address: " + t);
            return ShellRules.HOME + "?" + ShellRules.OPEN_PARAM + "=" + ShellRules.encode(t);
        }
        return url == null || url.trim().isEmpty() ? ShellRules.HOME : ShellRules.linkOr(url.trim(), ShellRules.HOME);
    }

    /** A notification's id: the caller's when it is a sane one, else one derived from the title (same title replaces). */
    static String noteId(String raw, String title) {
        String id = raw == null ? "" : raw.trim();
        if (NOTE_ID.matcher(id).matches()) return id;
        return "note-" + Integer.toHexString((title == null ? "" : title).hashCode());
    }
}
