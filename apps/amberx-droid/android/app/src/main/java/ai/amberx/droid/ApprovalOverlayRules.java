package ai.amberx.droid;

import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import org.json.JSONObject;

/**
 * The approval overlay's rules, kept free of Android views so they are unit-tested (ApprovalOverlayRulesTest): its
 * settings (approval-overlay settings, set from the app, the console API, MCP, the CLI and voice), what it lists, what
 * the small toolbar says, and when it opens into the full card.
 *
 * Brett, Nov 13 2026: "A little overlay, like a little toolbar, but it expands when I need an approval."
 */
final class ApprovalOverlayRules {
    private ApprovalOverlayRules() {}

    static final String[] EDGES = { "end", "start" };
    static final String[] SIZES = { "small", "medium", "large" };
    /** every: any approval or held call opens it; held: only held calls (they run on their own); never: stays small. */
    static final String[] EXPANDS = { "every", "held", "never" };
    /** count: "2 waiting"; next: the next held call's countdown (else the count). */
    static final String[] SHOWS = { "next", "count" };

    /** The overlay's settings, clamped; unknown values fall back to the defaults. */
    static final class Settings {
        final boolean on;
        final String edge, size, expand, show;
        /** Distance from the top of the screen, in percent of its height (0–90). */
        final int top;
        /** Toolbar opacity while nothing waits, percent (40–100). The card is always fully opaque. */
        final int idleOpacity;
        /** When nothing waits: keep the toolbar on screen (true) or hide it until an approval arrives (false). */
        final boolean idleVisible;
        /** Shrink back on its own this many seconds after the last approval went (0 = at once). */
        final int shrinkAfterSec;
        /** Where pages Amber opens go ({@link OverlayPageRules#PAGES}): the toolbar's own browser window, or Chrome. */
        final String pages;

        Settings(boolean on, String edge, int top, String size, String expand, String show, int idleOpacity, boolean idleVisible, int shrinkAfterSec, String pages) {
            this.on = on; this.edge = edge; this.top = top; this.size = size; this.expand = expand; this.show = show;
            this.idleOpacity = idleOpacity; this.idleVisible = idleVisible; this.shrinkAfterSec = shrinkAfterSec; this.pages = pages;
        }

        JSONObject toJson() {
            JSONObject o = new JSONObject();
            try {
                o.put("on", on).put("edge", edge).put("top", top).put("size", size).put("expand", expand).put("show", show)
                    .put("idleOpacity", idleOpacity).put("idleVisible", idleVisible).put("shrinkAfterSec", shrinkAfterSec)
                    .put("pages", pages);
            } catch (Exception ignored) {}
            return o;
        }
    }

    static Settings settings(JSONObject c) {
        if (c == null) c = new JSONObject();
        return new Settings(
            c.optBoolean("on", true),
            pick(c.optString("edge", ""), EDGES),
            clamp(c.optInt("top", 30), 0, 90),
            pick(c.optString("size", ""), SIZES),
            pick(c.optString("expand", ""), EXPANDS),
            pick(c.optString("show", ""), SHOWS),
            clamp(c.optInt("idleOpacity", 85), 40, 100),
            c.optBoolean("idleVisible", true),
            clamp(c.optInt("shrinkAfterSec", 0), 0, 60),
            pick(c.optString("pages", ""), OverlayPageRules.PAGES));
    }

    /** Merges a partial change (any subset of the keys) onto the current settings, clamped. */
    static Settings merge(JSONObject current, JSONObject change) {
        JSONObject out = settings(current).toJson();
        if (change != null) {
            for (java.util.Iterator<String> it = change.keys(); it.hasNext(); ) {
                String k = it.next();
                if (out.has(k)) { try { out.put(k, change.get(k)); } catch (Exception ignored) {} }
            }
        }
        return settings(out);
    }

    /** Scale of the toolbar and card text and spacing for a size. */
    static float scale(String size) { return "small".equals(size) ? 0.85f : "large".equals(size) ? 1.25f : 1f; }

    /* ---------------------------------------------------------------- what waits */

    /** One thing waiting for Brett: a held call (runs at [runsAt] unless stopped) or an approval (waits until decided). */
    static final class Item {
        final String id, kind, what, why, tool;
        /** Local ms when a held call runs; 0 for an approval or a shelved call. */
        final long runsAt;
        final boolean shelved;
        /** Buttons in order, as the hub allows: held calls deny / approve-now / shelve; approvals approve / decline. */
        final List<String> actions;

        Item(String id, String kind, String what, String why, String tool, long runsAt, boolean shelved, List<String> actions) {
            this.id = id; this.kind = kind; this.what = what; this.why = why; this.tool = tool; this.runsAt = runsAt; this.shelved = shelved; this.actions = actions;
        }

        boolean held() { return "held".equals(kind); }

        JSONObject toJson(long now) {
            JSONObject o = new JSONObject();
            try {
                o.put("id", id).put("kind", kind).put("what", what).put("why", why).put("tool", tool).put("shelved", shelved)
                    .put("secondsLeft", held() && !shelved ? secondsLeft(runsAt, now) : JSONObject.NULL)
                    .put("actions", new org.json.JSONArray(actions));
            } catch (Exception ignored) {}
            return o;
        }
    }

    static Item fromVeto(HubRules.Veto v) {
        String what = v.command.isEmpty() ? v.title : v.command;
        String why = !v.why.isEmpty() ? v.why : v.command.isEmpty() ? "" : v.title;
        List<String> acts = new ArrayList<>();
        for (String a : HubRules.VETO_ACTIONS) if (v.can(a) && !(v.shelved && "shelve".equals(a))) acts.add(a);
        // Button order on the card: Approve first, then Deny, then Shelve.
        acts.sort((a, b) -> order(a) - order(b));
        return new Item(v.id, "held", what, why, v.tool, v.shelved ? 0 : v.runsAtLocal(), v.shelved, acts);
    }

    static Item fromApproval(HubRules.Approval a) {
        List<String> acts = new ArrayList<>();
        acts.add("approve");
        acts.add("decline");
        return new Item(a.id, "approval", a.summary.isEmpty() ? a.tool : a.summary, "", a.tool, 0, false, acts);
    }

    private static int order(String action) {
        switch (action) {
            case "approve-now": case "approve": return 0;
            case "deny": case "decline": return 1;
            default: return 2;
        }
    }

    /**
     * Everything waiting, soonest first: running held calls by time left, then shelved ones, then approvals (in feed order).
     * Approved-now held calls are already running and are left out.
     */
    static List<Item> items(Collection<HubRules.Veto> held, Collection<HubRules.Approval> pending) {
        List<Item> timed = new ArrayList<>(), rest = new ArrayList<>();
        if (held != null) for (HubRules.Veto v : held) {
            if (v.approvedNow) continue;
            Item i = fromVeto(v);
            (i.shelved ? rest : timed).add(i);
        }
        timed.sort((a, b) -> Long.compare(a.runsAt, b.runsAt));
        if (pending != null) for (HubRules.Approval a : pending) rest.add(fromApproval(a));
        timed.addAll(rest);
        return timed;
    }

    static int secondsLeft(long runsAt, long now) { return (int) Math.max(0, Math.ceil((runsAt - now) / 1000.0)); }

    static String clock(int seconds) { return (seconds / 60) + ":" + String.format(Locale.ROOT, "%02d", seconds % 60); }

    /** The small toolbar's label. */
    static String toolbarLabel(Settings s, List<Item> items, long now) {
        if (items.isEmpty()) return "No approvals";
        if ("next".equals(s.show)) {
            Item first = items.get(0);
            if (first.held() && !first.shelved) return "Runs in " + clock(secondsLeft(first.runsAt, now)) + (items.size() > 1 ? " · +" + (items.size() - 1) : "");
        }
        return items.size() + " waiting";
    }

    /** The card's countdown line for one item. */
    static String countdown(Item i, long now) {
        if (!i.held()) return "Waiting for your approval";
        if (i.shelved) return "Shelved: waits for you";
        int left = secondsLeft(i.runsAt, now);
        return left <= 0 ? "Running now" : "Runs in " + clock(left) + " unless you stop it";
    }

    /** True when an item counts toward opening the card under this setting. */
    static boolean opensFor(Settings s, Item i) {
        if ("never".equals(s.expand)) return false;
        return !"held".equals(s.expand) || i.held();
    }

    /**
     * Opens the card when something arrived that was not there before ([seen]: ids already shown) and the setting allows
     * it; the toolbar stays small for items Brett already folded away.
     */
    static boolean shouldExpand(Settings s, List<Item> items, Set<String> seen) {
        for (Item i : items) if (!seen.contains(i.id) && opensFor(s, i)) return true;
        return false;
    }

    /** Label of a card button. */
    static String label(String action) {
        switch (action) {
            case "approve-now": case "approve": return "Approve";
            case "deny": case "decline": return "Deny";
            case "shelve": return "Shelve";
            default: return action;
        }
    }

    private static String pick(String v, String[] allowed) {
        for (String a : allowed) if (a.equals(v)) return a;
        return allowed[0];
    }

    private static int clamp(int v, int lo, int hi) { return Math.max(lo, Math.min(hi, v)); }
}
