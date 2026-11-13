package ai.amberx.consoleapp;

import java.util.Locale;
import java.util.Map;

/**
 * The floating toolbar's pure rules (ported from AmberX's {@code ApprovalOverlayRules} / {@code OverlayPageRules}).
 * No Android imports, so it runs under plain JUnit ({@code OverlayRulesTest}).
 *
 * Brett, Nov 13 2026: "keep it floating on top". The toolbar floats over every app; it expands into the full-screen
 * console with the toolbar docked top-left, and when an approval waits it pops the approval bar with a link to the
 * console's approvals page. Its settings are the console's own {@code approvals-banner.overlay.*} (Settings → Plugins →
 * Approvals banner), which the page hands to the shell through {@code axfNative.overlay.configure}.
 */
final class OverlayRules {
    private OverlayRules() {}

    /** The overlay's states: the small toolbar, the toolbar with the approval bar, the full-screen console. */
    static final String TOOLBAR = "toolbar", APPROVALS = "approvals", EXPANDED = "expanded";
    /** The console action that shows the approvals list (the bar's "Open approvals" link; also axf-console://open/approvals.view). */
    static final String APPROVALS_PAGE = "approvals.view";

    /** The settings the shell reads (keys of {@code approvals-banner.overlay.*}, without the prefix). */
    static final class Config {
        boolean on = true;
        /** "end" (right) or "start" (left). */
        String edge = "end";
        /** Distance from the top, percent of the screen height, 0–90. */
        int top = 30;
        /** "small", "medium", "large". */
        String size = "small";
        /** What pops the approval bar: "every", "held" or "never". */
        String expand = "every";
        /** Toolbar opacity while nothing waits, percent, 40–100. */
        int idleOpacity = 85;
    }

    static final String PREFIX = "approvals-banner.overlay.";

    /** A config from the page's settings (full keys or short keys; strings, numbers or booleans), clamped. */
    static Config config(Map<String, Object> raw) {
        Config c = new Config();
        if (raw == null) return c;
        Object v;
        if ((v = get(raw, "on")) != null) c.on = bool(v, c.on);
        if ((v = get(raw, "edge")) != null) c.edge = "start".equals(String.valueOf(v)) ? "start" : "end";
        if ((v = get(raw, "top")) != null) c.top = clamp(num(v, c.top), 0, 90);
        if ((v = get(raw, "size")) != null) { String s = String.valueOf(v).toLowerCase(Locale.ROOT); c.size = s.equals("medium") || s.equals("large") ? s : "small"; }
        if ((v = get(raw, "expand")) != null) { String s = String.valueOf(v); c.expand = s.equals("held") || s.equals("never") ? s : "every"; }
        if ((v = get(raw, "idleOpacity")) != null) c.idleOpacity = clamp(num(v, c.idleOpacity), 40, 100);
        return c;
    }

    private static Object get(Map<String, Object> raw, String k) {
        return raw.containsKey(PREFIX + k) ? raw.get(PREFIX + k) : raw.get(k);
    }

    static int clamp(int v, int lo, int hi) { return Math.max(lo, Math.min(hi, v)); }

    static int num(Object v, int dflt) {
        if (v instanceof Number) return (int) Math.round(((Number) v).doubleValue());
        try { return (int) Math.round(Double.parseDouble(String.valueOf(v).trim())); } catch (Exception e) { return dflt; }
    }

    static boolean bool(Object v, boolean dflt) {
        if (v instanceof Boolean) return (Boolean) v;
        String s = String.valueOf(v).trim().toLowerCase(Locale.ROOT);
        if (s.equals("true") || s.equals("on") || s.equals("1") || s.equals("yes")) return true;
        if (s.equals("false") || s.equals("off") || s.equals("0") || s.equals("no")) return false;
        return dflt;
    }

    /** Text scale of the toolbar for its size setting. */
    static float scale(String size) {
        return "large".equals(size) ? 1.3f : "medium".equals(size) ? 1.15f : 1f;
    }

    /**
     * Whether the approval bar opens for {@code waiting} approvals of which {@code held} are held commands (they run by
     * themselves when the countdown ends), under the {@code expand} setting.
     */
    static boolean popsBar(String expand, int waiting, int held) {
        if (waiting <= 0) return false;
        if ("never".equals(expand)) return false;
        if ("held".equals(expand)) return held > 0;
        return true;
    }

    /** The state after an approvals update, given the state now. The expanded console is never folded by one. */
    static String afterApprovals(String now, Config c, int waiting, int held) {
        return afterApprovals(now, c, waiting, held, 0);
    }

    /**
     * As above, with the bar dismissed while {@code dismissedAt} approvals waited: it stays closed until more wait than
     * that (a new approval pops it again; one that is decided does not).
     */
    static String afterApprovals(String now, Config c, int waiting, int held, int dismissedAt) {
        if (EXPANDED.equals(now)) return EXPANDED;
        return popsBar(c.expand, waiting, held) && waiting > dismissedAt ? APPROVALS : TOOLBAR;
    }

    /** The dismissed count after an approvals update: it follows the count down, so the next new approval pops the bar. */
    static int dismissedAfter(int dismissedAt, int waiting) {
        return Math.max(0, Math.min(dismissedAt, waiting));
    }

    /** The approval bar's line: "Run deploy.sh — 1 more" / "3 approvals wait". */
    static String barText(int waiting, String firstTitle) {
        if (waiting <= 0) return "";
        String t = firstTitle == null ? "" : firstTitle.trim();
        if (t.isEmpty()) return waiting == 1 ? "1 approval waits" : waiting + " approvals wait";
        if (t.length() > 60) t = t.substring(0, 59) + "…";
        return waiting == 1 ? t : t + " — " + (waiting - 1) + " more";
    }

    /** The toolbar's badge: the count, "9+" over nine, empty when nothing waits. */
    static String badge(int waiting) {
        return waiting <= 0 ? "" : waiting > 9 ? "9+" : String.valueOf(waiting);
    }

    /** Opacity percent of the toolbar: full when something waits, the idle setting otherwise. */
    static int opacity(Config c, int waiting) {
        return waiting > 0 ? 100 : c.idleOpacity;
    }

    /** After a drag: which edge the toolbar settles on (the nearer one) given its centre x and the screen width. */
    static String edgeAfterDrag(int centerX, int screenWidth) {
        return centerX < screenWidth / 2 ? "start" : "end";
    }

    /** After a drag: the top setting (percent) for the toolbar's y on a screen of that height. */
    static int topAfterDrag(int y, int screenHeight) {
        if (screenHeight <= 0) return 30;
        return clamp(Math.round(100f * y / screenHeight), 0, 90);
    }

    /** The toolbar's y in pixels for the top setting, never above the safe top (status bar / cutout). */
    static int topPx(int topPercent, int screenHeight, int safeTop) {
        return Math.max(safeTop, Math.round(screenHeight * clamp(topPercent, 0, 90) / 100f));
    }

    /** A remote verb ({@code expand}, {@code collapse}, {@code toggle}, {@code approvals}, {@code dismiss}) → the next state. */
    static String verb(String now, String verb) {
        switch (verb == null ? "" : verb) {
            case "expand": return EXPANDED;
            case "collapse": return TOOLBAR;
            case "toggle": return EXPANDED.equals(now) ? TOOLBAR : EXPANDED;
            case "approvals": return EXPANDED;
            case "dismiss": return EXPANDED.equals(now) ? EXPANDED : TOOLBAR;
            default: return now;
        }
    }
}
