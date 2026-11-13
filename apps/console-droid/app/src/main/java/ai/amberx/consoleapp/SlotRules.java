package ai.amberx.consoleapp;

import java.util.ArrayList;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Four console slots in the one app (console app part 3, s6; Brett, Nov 13 2026: "split the console wrapper so it runs
 * on four slots at the same time"). No Android imports: JUnit {@code SlotRulesTest}; {@link SlotHost} is the Android side.
 *
 * <ul>
 *   <li>Up to {@link #MAX} consoles run at once, each in its own WebView with its own {@code window.axfNative}. Slot 1
 *       always exists; slots 2-4 open and close.</li>
 *   <li>The layout follows the open count: one fills the screen, two split it (side by side in landscape, stacked in
 *       portrait), three or four share a 2x2 grid in slot order.</li>
 *   <li>One slot has the <b>focus</b>: it gets the keyboard, the mic (one mic, one listener) and the hub's
 *       {@code console.wake}. Phone-wide events (mic, permission, recorder, link, slots) reach every slot.</li>
 *   <li>Each slot opens a console address (the same {@code ?axf-open=} target {@code console.wake} takes) or one of
 *       Brett's https pages (any other is refused); the set is saved and comes back when the app restarts.</li>
 * </ul>
 */
final class SlotRules {
    private SlotRules() {}

    static final int MAX = 4;
    static final String PREF_SLOTS = "slots.state";

    static final String LAYOUT_SINGLE = "single";
    static final String LAYOUT_SPLIT = "split";
    static final String LAYOUT_GRID = "grid";

    /** The slots' state: which are open, at which page, and which has the focus. Immutable; every change returns a new one. */
    static final class State {
        /** Index 0..3 → the page in that slot, or null when it is closed. Slot 1 (index 0) is never null. */
        final String[] urls;
        final int focused;

        State(String[] urls, int focused) {
            String[] u = new String[MAX];
            for (int i = 0; i < MAX; i++) u[i] = urls != null && i < urls.length ? urls[i] : null;
            if (u[0] == null) u[0] = ShellRules.HOME;
            this.urls = u;
            this.focused = focused >= 1 && focused <= MAX && u[focused - 1] != null ? focused : 1;
        }

        static State initial() { return new State(new String[] { ShellRules.HOME }, 1); }

        boolean isOpen(int slot) { return slot >= 1 && slot <= MAX && urls[slot - 1] != null; }

        List<Integer> open() {
            List<Integer> o = new ArrayList<>();
            for (int i = 1; i <= MAX; i++) if (isOpen(i)) o.add(i);
            return o;
        }

        int count() { return open().size(); }
    }

    static String layout(int count) {
        if (count <= 1) return LAYOUT_SINGLE;
        return count == 2 ? LAYOUT_SPLIT : LAYOUT_GRID;
    }

    /**
     * Where each open slot sits on a {@code w}x{@code h} screen: {@code slot → [left, top, right, bottom]}, in slot
     * order. In the grid, three slots leave the last cell empty.
     */
    static List<int[]> frames(State s, int w, int h) {
        List<Integer> open = s.open();
        List<int[]> out = new ArrayList<>();
        int n = open.size();
        boolean landscape = w > h;
        for (int k = 0; k < n; k++) {
            int slot = open.get(k);
            int[] r;
            if (n == 1) r = new int[] { 0, 0, w, h };
            else if (n == 2) r = landscape ? new int[] { k * w / 2, 0, (k + 1) * w / 2, h } : new int[] { 0, k * h / 2, w, (k + 1) * h / 2 };
            else {
                int col = k % 2, row = k / 2;
                r = new int[] { col * w / 2, row * h / 2, (col + 1) * w / 2, (row + 1) * h / 2 };
            }
            out.add(new int[] { slot, r[0], r[1], r[2], r[3] });
        }
        return out;
    }

    /** The page a slot opens: a console address, else one of Brett's https pages (any other throws), else the console's home. */
    static String urlFor(JSONObject args) {
        JSONObject a = args == null ? new JSONObject() : args;
        return DeviceRules.wakeUrl(a.optString("target", ""), a.optString("url", ""));
    }

    /** {@code slot} from the args: 1-4, or {@code fallback} when absent. */
    static int slotOf(JSONObject args, int fallback) {
        Object v = args == null ? null : args.opt("slot");
        if (v == null || JSONObject.NULL.equals(v) || "".equals(v)) return fallback;
        int n;
        try { n = v instanceof Number ? ((Number) v).intValue() : Integer.parseInt(String.valueOf(v).trim()); }
        catch (NumberFormatException e) { throw new IllegalArgumentException("slot must be 1 to " + MAX + "."); }
        if (n < 1 || n > MAX) throw new IllegalArgumentException("slot must be 1 to " + MAX + ".");
        return n;
    }

    /** The first closed slot, or 0 when all four are open. */
    static int firstFree(State s) {
        for (int i = 1; i <= MAX; i++) if (!s.isOpen(i)) return i;
        return 0;
    }

    /** {@code slots.open}: a page in the given slot (replacing what was there) or the first free one; it takes the focus. */
    static State open(State s, JSONObject args) {
        int slot = slotOf(args, firstFree(s));
        if (slot == 0) throw new IllegalArgumentException("All " + MAX + " slots are open: close one or give slot 1-" + MAX + " to replace it.");
        String[] u = s.urls.clone();
        u[slot - 1] = urlFor(args);
        boolean focus = args == null || args.optBoolean("focus", true);
        return new State(u, focus ? slot : s.focused);
    }

    /** {@code slots.close}: slots 2-4 close; slot 1 stays (the app always has a console). The focus moves to slot 1. */
    static State close(State s, JSONObject args) {
        int slot = slotOf(args, s.focused);
        if (slot == 1) throw new IllegalArgumentException("Slot 1 is the main console and stays open.");
        if (!s.isOpen(slot)) return s;
        String[] u = s.urls.clone();
        u[slot - 1] = null;
        return new State(u, s.focused == slot ? 1 : s.focused);
    }

    /** {@code slots.focus}: an open slot takes the keyboard, the mic and the hub's wake. */
    static State focus(State s, JSONObject args) {
        int slot = slotOf(args, 0);
        if (slot == 0) throw new IllegalArgumentException("slot (1-" + MAX + ") is required.");
        if (!s.isOpen(slot)) throw new IllegalArgumentException("Slot " + slot + " isn't open.");
        return new State(s.urls, slot);
    }

    /** One mic, one listener: only the focused slot may capture audio. */
    static boolean micAllowed(State s, int slot) { return s.focused == slot; }

    /** {@code slots.status} and the {@code slots} event. */
    static JSONObject status(State s) {
        try {
            JSONArray slots = new JSONArray();
            for (int i = 1; i <= MAX; i++) {
                slots.put(new JSONObject().put("slot", i).put("open", s.isOpen(i)).put("url", s.isOpen(i) ? s.urls[i - 1] : JSONObject.NULL)
                    .put("focused", s.focused == i));
            }
            return new JSONObject().put("max", MAX).put("count", s.count()).put("layout", layout(s.count())).put("focused", s.focused)
                .put("slots", slots);
        } catch (Exception e) { throw new IllegalStateException(e); }
    }

    /** Saved form (the app's preferences). */
    static String encode(State s) {
        try {
            JSONArray u = new JSONArray();
            for (String url : s.urls) u.put(url == null ? JSONObject.NULL : url);
            return new JSONObject().put("urls", u).put("focused", s.focused).toString();
        } catch (Exception e) { throw new IllegalStateException(e); }
    }

    /** Restores a saved state; anything unreadable, or a page that is no longer one of Brett's, falls back safely. */
    static State decode(String saved) {
        if (saved == null || saved.isEmpty()) return State.initial();
        try {
            JSONObject o = new JSONObject(saved);
            JSONArray a = o.optJSONArray("urls");
            String[] u = new String[MAX];
            for (int i = 0; a != null && i < MAX && i < a.length(); i++) {
                String url = a.isNull(i) ? null : ShellRules.linkOr(a.optString(i, ""), null);
                u[i] = url;
            }
            return new State(u, o.optInt("focused", 1));
        } catch (Exception e) { return State.initial(); }
    }
}
