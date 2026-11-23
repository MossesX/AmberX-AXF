package ai.amberx.consoleapp;

import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

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

    /** The overlay's states: the small toolbar, the toolbar with the approval bar, the full-screen console ({@link OverlayContract}). */
    static final String TOOLBAR = OverlayContract.TOOLBAR, APPROVALS = OverlayContract.APPROVALS, EXPANDED = OverlayContract.EXPANDED;
    /** The console action that shows the approvals list (the bar's "Open approvals" link; also axf-console://open/approvals.view). */
    static final String APPROVALS_PAGE = OverlayContract.APPROVALS_TARGET;

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
        /** What the toolbar says while something waits: "next" (the next held command's countdown) or "count". */
        String show = "next";
    }

    static final String PREFIX = OverlayContract.SETTING_PREFIX;

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
        if ((v = get(raw, "show")) != null) c.show = "count".equals(String.valueOf(v)) ? "count" : "next";
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

    // ---- a tap on the toolbar (Brett, Nov 23 2026: "it should bring me to the approvals, not to the console") --------

    /**
     * The verb a tap on the toolbar's button runs: fold when the overlay is expanded; otherwise open the approvals page
     * while something waits, and the console when nothing does.
     */
    static String tapVerb(String now, int waiting) {
        if (EXPANDED.equals(now)) return OverlayContract.COLLAPSE;
        return waiting > 0 ? OverlayContract.APPROVALS_VERB : OverlayContract.EXPAND;
    }

    /** True when {@code url} is axHub's approvals page (the list, or one approval under it). */
    static boolean onApprovalsPage(String url) {
        String u = url == null ? "" : url, a = OverlayContract.APPROVALS_URL;
        return u.equals(a) || u.startsWith(a + "/") || u.startsWith(a + "?") || u.startsWith(a + "#");
    }

    /** The page the approvals verb loads: axHub's approvals page, or null when it already shows (it keeps its place). */
    static String approvalsPage(String currentUrl) {
        return onApprovalsPage(currentUrl) ? null : OverlayContract.APPROVALS_URL;
    }

    /**
     * The page a tap loads when nothing waits: the console when an earlier tap left the approvals page showing, else
     * null (whatever page shows stays).
     */
    static String consolePage(String currentUrl) {
        return onApprovalsPage(currentUrl) ? ShellRules.HOME : null;
    }

    // ---- items: what waits, one by one (ported from AmberX's ApprovalOverlayRules, overlay-toolbar-v2) ------------

    /** One thing waiting: a held command (runs at {@link #runsAt} unless stopped) or an approval (waits until decided). */
    static final class Item {
        final String id, kind, title;
        /** Epoch ms when a held command runs; 0 for an approval or a shelved command. */
        final long runsAt;
        final boolean shelved;

        Item(String id, String kind, String title, long runsAt, boolean shelved) {
            this.id = id == null ? "" : id;
            this.kind = OverlayContract.HELD_KIND.equals(kind) ? OverlayContract.HELD_KIND : OverlayContract.APPROVAL_KIND;
            this.title = title == null ? "" : title.trim();
            this.runsAt = shelved || !OverlayContract.HELD_KIND.equals(kind) ? 0 : Math.max(0, runsAt);
            this.shelved = shelved;
        }

        boolean held() { return OverlayContract.HELD_KIND.equals(kind); }
        /** The hub's own id (the item id without its {@code held:} / {@code approval:} prefix): what the console opens. */
        String ref() { return id.substring(id.indexOf(':') + 1); }
        boolean timed() { return held() && !shelved && runsAt > 0; }
    }

    /** An item from the page's JSON object (keys {@code id, kind, title, runsAt, shelved}); null without an id. */
    static Item item(Map<String, Object> m) {
        if (m == null) return null;
        Object id = m.get("id");
        if (id == null || String.valueOf(id).trim().isEmpty()) return null;
        Object runs = m.get("runsAt");
        long at = runs instanceof Number ? ((Number) runs).longValue() : 0;
        if (!(runs instanceof Number) && runs != null) { try { at = Long.parseLong(String.valueOf(runs).trim()); } catch (Exception ignored) {} }
        Object t = m.get("title");
        return new Item(String.valueOf(id), String.valueOf(m.get("kind")), t == null ? "" : String.valueOf(t), at, bool(m.get("shelved") == null ? false : m.get("shelved"), false));
    }

    /** Everything waiting, soonest first: running held commands by time left, then shelved ones, then approvals in feed order. */
    static List<Item> order(Collection<Item> in) {
        List<Item> timed = new ArrayList<>(), rest = new ArrayList<>(), approvals = new ArrayList<>();
        if (in != null) for (Item i : in) {
            if (i == null) continue;
            (i.timed() ? timed : i.held() ? rest : approvals).add(i);
        }
        timed.sort((a, b) -> Long.compare(a.runsAt, b.runsAt));
        timed.addAll(rest);
        timed.addAll(approvals);
        return timed;
    }

    static int heldCount(List<Item> items) {
        int n = 0;
        for (Item i : items) if (i.held()) n++;
        return n;
    }

    static int secondsLeft(long runsAt, long now) { return (int) Math.max(0, Math.ceil((runsAt - now) / 1000.0)); }

    static String clock(int seconds) { return (seconds / 60) + ":" + String.format(Locale.ROOT, "%02d", seconds % 60); }

    /** The toolbar's label while something waits ("Runs in 1:05 · +2" / "3 waiting"); empty when nothing waits. */
    static String toolbarLabel(Config c, List<Item> items, long now) {
        if (items == null || items.isEmpty()) return "";
        Item first = items.get(0);
        if ("next".equals(c.show) && first.timed()) return "Runs in " + clock(secondsLeft(first.runsAt, now)) + (items.size() > 1 ? " · +" + (items.size() - 1) : "");
        return items.size() + " waiting";
    }

    /** The approval bar's countdown line for one item. */
    static String countdown(Item i, long now) {
        if (!i.held()) return "Waiting for your approval";
        if (i.shelved || i.runsAt <= 0) return "Shelved: waits for you";
        int left = secondsLeft(i.runsAt, now);
        return left <= 0 ? "Running now" : "Runs in " + clock(left) + " unless you stop it";
    }

    /** True while a held command counts down: the toolbar and bar re-render once a second. */
    static boolean ticking(List<Item> items) {
        for (Item i : items) if (i.timed()) return true;
        return false;
    }

    /** True when an item counts toward popping the approval bar under the {@code expand} setting. */
    static boolean opensFor(Config c, Item i) {
        if ("never".equals(c.expand)) return false;
        return !"held".equals(c.expand) || i.held();
    }

    /**
     * The bar pops for something that wasn't there before ({@code seen}: ids already shown or dismissed) and that the
     * setting lets through; items Brett already folded away keep the toolbar small.
     */
    static boolean popsFor(Config c, List<Item> items, Set<String> seen) {
        for (Item i : items) if (!seen.contains(i.id) && opensFor(c, i)) return true;
        return false;
    }

    /** The state after an items update: like {@link #afterApprovals} but per item, so only an unseen one pops the bar. */
    static String afterItems(String now, Config c, List<Item> items, Set<String> seen) {
        if (EXPANDED.equals(now)) return EXPANDED;
        if (items.isEmpty()) return TOOLBAR;
        if (APPROVALS.equals(now)) return APPROVALS; // already open: stays open while anything waits
        return popsFor(c, items, seen) ? APPROVALS : TOOLBAR;
    }

    // ---- the card: a new item pops the console's own approval card over whatever is on screen ---------------------

    /** How long after its countdown a held command still shows ("Running now") when the hub can't be read. */
    static final long RAN_GRACE_MS = 5_000;
    /** How long the overlay stays open after the last item of a card it popped by itself is decided or has run. */
    static final long FOLD_AFTER_MS = 3_000;

    /**
     * The item whose card pops: the first one that wasn't shown before and that the {@code expand} setting lets
     * through, or null. The card is the console's own (Approve / Deny, the countdown), so the tap on it is Brett's.
     */
    static Item cardFor(Config c, List<Item> items, Set<String> seen) {
        for (Item i : items) if (!seen.contains(i.id) && opensFor(c, i)) return i;
        return null;
    }

    /**
     * The state after a reading of the hub's list. A new item pops the card: the overlay expands onto the console
     * (over whatever app is in front) at once, not when the toolbar is tapped. With the console already on screen
     * ({@code pageOnScreen}: the app is in front) the page shows its own card and the toolbar opens its bar.
     */
    static String afterFeed(String now, Config c, List<Item> items, Set<String> seen, boolean pageOnScreen) {
        if (EXPANDED.equals(now)) return EXPANDED;
        if (items.isEmpty()) return TOOLBAR;
        if (cardFor(c, items, seen) != null) return pageOnScreen ? APPROVALS : EXPANDED;
        return APPROVALS.equals(now) ? APPROVALS : TOOLBAR;
    }

    /** True when an overlay that expanded by itself for a card folds back: nothing waits any more. */
    static boolean foldsWhenClear(String now, boolean expandedForCard, List<Item> items) {
        return EXPANDED.equals(now) && expandedForCard && items.isEmpty();
    }

    /** The items still waiting at {@code now}: a held command whose countdown ended {@link #RAN_GRACE_MS} ago has run. */
    static List<Item> unexpired(List<Item> items, long now) {
        List<Item> out = new ArrayList<>();
        if (items != null) for (Item i : items) if (!i.timed() || now <= i.runsAt + RAN_GRACE_MS) out.add(i);
        return out;
    }

    /** Drops ids from {@code seen} that no longer wait, so a later call with the same id pops the bar again. */
    static void forget(Set<String> seen, List<Item> items) {
        Set<String> live = new java.util.HashSet<>();
        for (Item i : items) live.add(i.id);
        seen.retainAll(live);
    }

    /** The approval bar's line for the items: the first one's title and countdown, then how many more. */
    static String barText(List<Item> items, long now) {
        if (items == null || items.isEmpty()) return "";
        Item first = items.get(0);
        String head = barText(items.size(), first.title);
        return first.held() ? head + " · " + countdown(first, now) : head;
    }
}
