package ai.amberx.consoleapp;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * The console app's tabs (Brett, Nov 25 2026: "small tab strip with + to add, tap to switch, x to close"). Each tab is
 * its own console WebView ({@link WebHost}), so it keeps its own screen and scroll; this class is the list itself and
 * every decision about it. Pure (no Android imports), so each rule is tested ({@code TabRulesTest}).
 *
 * <ul>
 * <li>+ opens a new tab on the console's start screen and shows it; at most {@link #MAX_TABS} (each is a live page).</li>
 * <li>Tapping a tab shows it. The others keep running.</li>
 * <li>x closes a tab. Closing the one on screen shows its neighbour (the one after it, else the one before); closing
 *     the last one leaves one fresh start-screen tab, so the app always has a console.</li>
 * </ul>
 *
 * The same four verbs reach the list from everywhere: the strip, the bridge ({@code axfNativeHost.tabs(verb, arg)}, the
 * console's {@code native.tabs:<verb>} action over REST, MCP, the CLI and voice) and the deep links
 * {@code axf-console://tab/new} and {@code axf-console://tab/<id>}.
 */
final class TabRules {
    private TabRules() {}

    /** The bridge feature a console page looks for before it offers the tab actions. */
    static final String FEATURE = "tabs";
    /** Live pages at once: each tab is a whole console (its own renderer state and live stream). */
    static final int MAX_TABS = 8;
    static final String STATE = "state", NEW = "new", SWITCH = "switch", CLOSE = "close";
    static final String[] VERBS = { STATE, NEW, SWITCH, CLOSE };
    /** {@code axf-console://tab/…} */
    static final String LINK_HOST = "tab";
    /** A tab's label never grows past this many characters (the strip scrolls sideways when full). */
    static final int LABEL_MAX = 18;

    /** The list: ids in strip order, the id on screen, and the number the next new tab gets. Never changed in place. */
    static final class State {
        final List<String> ids;
        final String active;
        final int next;

        State(List<String> ids, String active, int next) {
            this.ids = Collections.unmodifiableList(new ArrayList<>(ids));
            this.active = active;
            this.next = next;
        }

        int index(String id) { return id == null ? -1 : ids.indexOf(id); }
        boolean has(String id) { return index(id) >= 0; }
        int size() { return ids.size(); }
    }

    /** One tab, on screen. */
    static State first() {
        List<String> ids = new ArrayList<>();
        ids.add("t1");
        return new State(ids, "t1", 2);
    }

    static boolean full(State s) { return s.size() >= MAX_TABS; }

    /** + : a new tab at the end, shown at once. A full strip stays as it is (the caller says why). */
    static State open(State s) {
        if (full(s)) return s;
        String id = "t" + s.next;
        List<String> ids = new ArrayList<>(s.ids);
        ids.add(id);
        return new State(ids, id, s.next + 1);
    }

    /** Tap: that tab is on screen. An id that isn't in the list changes nothing. */
    static State select(State s, String id) {
        return s.has(id) && !id.equals(s.active) ? new State(s.ids, id, s.next) : s;
    }

    /**
     * x : the tab is gone. The one on screen hands over to its neighbour (after it, else before it); the last one is
     * replaced by a fresh tab (a new id: its page starts again on the start screen).
     */
    static State close(State s, String id) {
        int at = s.index(id);
        if (at < 0) return s;
        List<String> ids = new ArrayList<>(s.ids);
        ids.remove(at);
        if (ids.isEmpty()) {
            String fresh = "t" + s.next;
            ids.add(fresh);
            return new State(ids, fresh, s.next + 1);
        }
        String active = id.equals(s.active) ? ids.get(Math.min(at, ids.size() - 1)) : s.active;
        return new State(ids, active, s.next);
    }

    static boolean verb(String v) {
        if (v == null) return false;
        for (String k : VERBS) if (k.equals(v)) return true;
        return false;
    }

    static String verbsHelp() { return "tabs verbs: state, new [url], switch <id>, close <id>"; }

    /**
     * What a deep link asks of the tabs: {@code axf-console://tab/new} → "new", {@code axf-console://tab/t3} → "t3",
     * anything else → null (an ordinary link, opened in the tab on screen).
     */
    static String linkTarget(String link) {
        if (link == null) return null;
        String s = link.trim();
        String head = ShellRules.SCHEME + "://" + LINK_HOST + "/";
        if (!s.startsWith(head)) return null;
        String arg = s.substring(head.length());
        int cut = arg.indexOf('?');
        if (cut >= 0) arg = arg.substring(0, cut);
        while (arg.endsWith("/")) arg = arg.substring(0, arg.length() - 1);
        return arg.matches("[a-z0-9]{1,12}") ? arg : null;
    }

    /** The link that shows a tab. */
    static String link(String id) { return ShellRules.SCHEME + "://" + LINK_HOST + "/" + id; }

    /**
     * What the strip writes on a tab: the screen's name (the console titles a page "Screen · Brand"; the start screen is
     * the brand alone), else "Tab 2" (its place in the strip), never longer than {@link #LABEL_MAX}.
     */
    static String label(String title, int position) {
        String t = title == null ? "" : title.trim();
        int dot = t.indexOf(" \u00b7 ");
        if (dot > 0) t = t.substring(0, dot).trim();
        if (t.isEmpty() || t.startsWith("http://") || t.startsWith("https://") || t.startsWith("file:")) t = "Tab " + position;
        return t.length() > LABEL_MAX ? t.substring(0, LABEL_MAX - 1).trim() + "…" : t;
    }

    /**
     * The strip's own padding {left, top, right, bottom} px. It sits under the page, so once the page pads itself
     * (the window is no longer padded by the shell) the strip keeps itself clear of the navigation bar, the keyboard
     * and a side cutout; while the shell pads the window there is nothing left to clear.
     */
    static int[] stripPadding(int[] insets, boolean pageHandles) {
        int[] i = SafeArea.safe(insets);
        return pageHandles ? new int[] { i[SafeArea.LEFT], 0, i[SafeArea.RIGHT], i[SafeArea.BOTTOM] } : new int[4];
    }

    /** The page's insets {top, right, bottom, left} with the strip under it: the bottom is the strip's, the page gets 0 there. */
    static int[] pageInsets(int[] page) {
        int[] i = SafeArea.safe(page);
        return new int[] { i[SafeArea.TOP], i[SafeArea.RIGHT], 0, i[SafeArea.LEFT] };
    }

    /**
     * The state as the bridge answers it:
     * {@code {"active":"t2","max":8,"count":2,"tabs":[{"id":"t1","title":"…","url":"…","active":false,"link":"axf-console://tab/t1"},…]}}.
     * {@code titles} and {@code urls} run beside {@code s.ids} (a missing one reads as empty).
     */
    static String json(State s, List<String> titles, List<String> urls) {
        StringBuilder b = new StringBuilder("{\"active\":").append(quote(s.active)).append(",\"max\":").append(MAX_TABS)
            .append(",\"count\":").append(s.size()).append(",\"tabs\":[");
        for (int k = 0; k < s.size(); k++) {
            String id = s.ids.get(k);
            String title = titles != null && k < titles.size() ? titles.get(k) : "";
            String url = urls != null && k < urls.size() ? urls.get(k) : "";
            b.append(k == 0 ? "" : ",").append("{\"id\":").append(quote(id)).append(",\"title\":").append(quote(label(title, k + 1)))
                .append(",\"url\":").append(quote(url)).append(",\"active\":").append(id.equals(s.active))
                .append(",\"link\":").append(quote(link(id))).append('}');
        }
        return b.append("]}").toString();
    }

    /** A JSON string (org.json is Android's at run time and a stub in unit tests, so the pure rules carry their own). */
    static String quote(String v) {
        if (v == null) return "\"\"";
        StringBuilder b = new StringBuilder("\"");
        for (int k = 0; k < v.length(); k++) {
            char c = v.charAt(k);
            if (c == '"' || c == '\\') b.append('\\').append(c);
            else if (c == '\n') b.append("\\n");
            else if (c == '\r') b.append("\\r");
            else if (c == '\t') b.append("\\t");
            else if (c < 0x20 || c == '<' || c == ' ' || c == ' ') b.append(String.format("\\u%04x", (int) c));
            else b.append(c);
        }
        return b.append('"').toString();
    }
}
