package ai.amberx.consoleapp;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.util.Arrays;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.junit.Test;

/** The overlay-toolbar-v2 port: per-item countdowns, the toolbar label, "seen" items (part 2, s2). */
public class OverlayItemsTest {
    static final long NOW = 1_000_000L;

    static OverlayRules.Item held(String id, long inMs) { return new OverlayRules.Item(id, "held", "Run " + id, NOW + inMs, false); }
    static OverlayRules.Item shelved(String id) { return new OverlayRules.Item(id, "held", "Shelved " + id, NOW + 5000, true); }
    static OverlayRules.Item approval(String id) { return new OverlayRules.Item(id, "approval", "Approve " + id, 0, false); }

    @Test public void orderIsSoonestFirstThenShelvedThenApprovals() {
        List<OverlayRules.Item> o = OverlayRules.order(Arrays.asList(approval("a"), held("late", 90_000), shelved("s"), held("soon", 5_000), null));
        assertEquals("soon", o.get(0).id);
        assertEquals("late", o.get(1).id);
        assertEquals("s", o.get(2).id);
        assertEquals("a", o.get(3).id);
        assertEquals(3, OverlayRules.heldCount(o));
        assertEquals(0, o.get(2).runsAt); // a shelved command has no clock
    }

    @Test public void itemFromThePagesJson() {
        Map<String, Object> m = new HashMap<>();
        assertNull(OverlayRules.item(m));
        m.put("id", "held:7"); m.put("kind", "held"); m.put("title", " Deploy "); m.put("runsAt", 12345L); m.put("shelved", false);
        OverlayRules.Item i = OverlayRules.item(m);
        assertEquals("Deploy", i.title);
        assertTrue(i.timed());
        m.put("runsAt", "999"); m.put("kind", "weird");
        i = OverlayRules.item(m);
        assertEquals("approval", i.kind); // unknown kinds wait for a decision, never count down
        assertEquals(0, i.runsAt);
    }

    @Test public void clocksAndLabels() {
        assertEquals("1:05", OverlayRules.clock(65));
        assertEquals("0:00", OverlayRules.clock(0));
        assertEquals(2, OverlayRules.secondsLeft(NOW + 1001, NOW));
        assertEquals(0, OverlayRules.secondsLeft(NOW - 5000, NOW));
        OverlayRules.Config c = new OverlayRules.Config();
        List<OverlayRules.Item> items = OverlayRules.order(Arrays.asList(held("x", 65_000), approval("a")));
        assertEquals("Runs in 1:05 · +1", OverlayRules.toolbarLabel(c, items, NOW));
        c.show = "count";
        assertEquals("2 waiting", OverlayRules.toolbarLabel(c, items, NOW));
        assertEquals("", OverlayRules.toolbarLabel(c, Arrays.asList(), NOW));
        c.show = "next";
        assertEquals("1 waiting", OverlayRules.toolbarLabel(c, Arrays.asList(approval("a")), NOW));
        assertEquals("Runs in 1:05 unless you stop it", OverlayRules.countdown(items.get(0), NOW));
        assertEquals("Running now", OverlayRules.countdown(items.get(0), NOW + 70_000));
        assertEquals("Waiting for your approval", OverlayRules.countdown(approval("a"), NOW));
        assertEquals("Shelved: waits for you", OverlayRules.countdown(shelved("s"), NOW));
        assertEquals("Run x — 1 more · Runs in 1:05 unless you stop it", OverlayRules.barText(items, NOW));
        assertTrue(OverlayRules.ticking(items));
        assertFalse(OverlayRules.ticking(Arrays.asList(approval("a"), shelved("s"))));
    }

    @Test public void onlyUnseenItemsPopTheBar() {
        OverlayRules.Config c = new OverlayRules.Config();
        Set<String> seen = new HashSet<>();
        List<OverlayRules.Item> one = Arrays.asList(approval("a"));
        assertEquals(OverlayRules.APPROVALS, OverlayRules.afterItems(OverlayRules.TOOLBAR, c, one, seen));
        seen.add("a"); // shown or dismissed
        assertEquals(OverlayRules.TOOLBAR, OverlayRules.afterItems(OverlayRules.TOOLBAR, c, one, seen));
        List<OverlayRules.Item> two = Arrays.asList(approval("a"), held("b", 9000));
        assertEquals(OverlayRules.APPROVALS, OverlayRules.afterItems(OverlayRules.TOOLBAR, c, two, seen));
        // an open bar stays open while anything waits, folds when nothing does; the expanded console never folds
        assertEquals(OverlayRules.APPROVALS, OverlayRules.afterItems(OverlayRules.APPROVALS, c, one, seen));
        assertEquals(OverlayRules.TOOLBAR, OverlayRules.afterItems(OverlayRules.APPROVALS, c, Arrays.asList(), seen));
        assertEquals(OverlayRules.EXPANDED, OverlayRules.afterItems(OverlayRules.EXPANDED, c, two, new HashSet<>()));
        // the expand setting
        c.expand = "held";
        assertEquals(OverlayRules.TOOLBAR, OverlayRules.afterItems(OverlayRules.TOOLBAR, c, Arrays.asList(approval("z")), new HashSet<>()));
        assertEquals(OverlayRules.APPROVALS, OverlayRules.afterItems(OverlayRules.TOOLBAR, c, Arrays.asList(held("z", 1000)), new HashSet<>()));
        c.expand = "never";
        assertEquals(OverlayRules.TOOLBAR, OverlayRules.afterItems(OverlayRules.TOOLBAR, c, Arrays.asList(held("z", 1000)), new HashSet<>()));
        // a decided id is forgotten, so the same id coming back pops the bar again
        OverlayRules.forget(seen, Arrays.asList(approval("b")));
        assertFalse(seen.contains("a"));
    }
}
