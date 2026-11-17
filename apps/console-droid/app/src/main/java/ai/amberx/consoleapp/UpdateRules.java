package ai.amberx.consoleapp;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Keeping the web content current, pure part (no Android imports: {@code UpdateRulesTest}).
 *
 * The shell loads the live console, so a fresh page is always the newest deploy. But the one WebView lives as long as
 * the process (the overlay keeps it alive for days), so a page loaded on Monday would still run Monday's bundle. The
 * shell compares the entry bundle the page runs with the one the live console serves now and, when they differ,
 * reloads the page as soon as nobody is looking at it; while the console is on screen the page is told instead and
 * shows its "Reload for the new version" bar. Only a change to the native shell itself ever needs a new APK.
 */
final class UpdateRules {
    private UpdateRules() {}

    /** At most one check per this many ms, unless asked for (native.update:check). */
    static final long MIN_GAP_MS = 10 * 60_000L;
    /** A background check this often while the process runs. */
    static final long PERIOD_MS = 30 * 60_000L;
    /** A pending update reloads after the console has been off screen this long (a quick app switch keeps the page). */
    static final long OFF_SCREEN_MS = 60_000L;
    /** Read at most this much of the console's index.html. */
    static final int MAX_HTML = 256 * 1024;

    static final String NONE = "none";
    static final String RELOAD = "reload";
    static final String NOTIFY = "notify";
    static final String[] VERBS = { "check", "reload", "state" };

    private static final Pattern ENTRY = Pattern.compile("<script\\b[^>]*\\btype=[\"']module[\"'][^>]*\\bsrc=[\"']([^\"']+)[\"']|<script\\b[^>]*\\bsrc=[\"']([^\"']+)[\"'][^>]*\\btype=[\"']module[\"']", Pattern.CASE_INSENSITIVE);

    /** The entry module's path in an index.html ({@code /assets/index-AbC123.js}), or "" when there is none. */
    static String entry(String html) {
        if (html == null) return "";
        Matcher m = ENTRY.matcher(html);
        if (!m.find()) return "";
        return path(m.group(1) != null ? m.group(1) : m.group(2));
    }

    /** A script URL as the page reports it ({@code https://console…/assets/x.js?v=1}) reduced to its path. */
    static String path(String src) {
        if (src == null) return "";
        String s = src.trim();
        int scheme = s.indexOf("://");
        if (scheme >= 0) { int slash = s.indexOf('/', scheme + 3); s = slash < 0 ? "/" : s.substring(slash); }
        int q = s.indexOf('?'); if (q >= 0) s = s.substring(0, q);
        int h = s.indexOf('#'); if (h >= 0) s = s.substring(0, h);
        if (!s.isEmpty() && !s.startsWith("/")) s = "/" + s;
        return s;
    }

    /** True when a check is due: forced, never run, or the gap since the last one has passed. */
    static boolean due(long now, long lastCheck, boolean force) {
        return force || lastCheck <= 0 || now - lastCheck >= MIN_GAP_MS;
    }

    /**
     * What to do after a check. Unknown on either side (offline, a page that isn't the console, a dev server): nothing.
     * Same bundle: nothing. New bundle: reload when the console isn't on screen, else notify the page.
     */
    static String action(String loaded, String live, boolean onScreen) {
        if (loaded == null || live == null || loaded.isEmpty() || live.isEmpty() || loaded.equals(live)) return NONE;
        return onScreen ? NOTIFY : RELOAD;
    }

    static boolean verb(String v) {
        for (String k : VERBS) if (k.equals(v)) return true;
        return false;
    }
}
