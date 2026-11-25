package ai.amberx.consoleapp;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertSame;
import static org.junit.Assert.assertTrue;

import java.util.Arrays;
import org.junit.Test;

public class TabRulesTest {
    @Test public void startsWithOneTabOnScreen() {
        TabRules.State s = TabRules.first();
        assertEquals(Arrays.asList("t1"), s.ids);
        assertEquals("t1", s.active);
    }

    @Test public void plusOpensANewTabAndShowsIt() {
        TabRules.State s = TabRules.open(TabRules.first());
        assertEquals(Arrays.asList("t1", "t2"), s.ids);
        assertEquals("t2", s.active);
    }

    @Test public void theStripIsCapped() {
        TabRules.State s = TabRules.first();
        for (int k = 1; k < TabRules.MAX_TABS; k++) s = TabRules.open(s);
        assertEquals(TabRules.MAX_TABS, s.size());
        assertTrue(TabRules.full(s));
        assertSame(s, TabRules.open(s));
    }

    @Test public void tapSwitches() {
        TabRules.State s = TabRules.open(TabRules.open(TabRules.first()));
        assertEquals("t1", TabRules.select(s, "t1").active);
        assertEquals(s.ids, TabRules.select(s, "t1").ids);
        assertSame(s, TabRules.select(s, "t9"));
        assertSame(s, TabRules.select(s, null));
        assertSame(s, TabRules.select(s, s.active));
    }

    @Test public void closingTheTabOnScreenShowsItsNeighbour() {
        TabRules.State s = TabRules.select(TabRules.open(TabRules.open(TabRules.first())), "t2"); // t1 [t2] t3
        TabRules.State after = TabRules.close(s, "t2");
        assertEquals(Arrays.asList("t1", "t3"), after.ids);
        assertEquals("t3", after.active); // the one after it
        assertEquals("t1", TabRules.close(after, "t3").active); // none after it: the one before
    }

    @Test public void closingAnotherTabKeepsTheOneOnScreen() {
        TabRules.State s = TabRules.open(TabRules.open(TabRules.first())); // t1 t2 [t3]
        TabRules.State after = TabRules.close(s, "t1");
        assertEquals(Arrays.asList("t2", "t3"), after.ids);
        assertEquals("t3", after.active);
        assertSame(s, TabRules.close(s, "nope"));
    }

    @Test public void closingTheLastTabLeavesAFreshOne() {
        TabRules.State after = TabRules.close(TabRules.first(), "t1");
        assertEquals(Arrays.asList("t2"), after.ids); // a new id: its page starts again
        assertEquals("t2", after.active);
        assertEquals(Arrays.asList("t3"), TabRules.close(after, "t2").ids);
    }

    @Test public void idsAreNeverReused() {
        TabRules.State s = TabRules.open(TabRules.first()); // t1 [t2]
        s = TabRules.open(TabRules.close(s, "t2"));
        assertEquals(Arrays.asList("t1", "t3"), s.ids);
    }

    @Test public void verbs() {
        for (String v : new String[] { "state", "new", "switch", "close" }) assertTrue(TabRules.verb(v));
        assertFalse(TabRules.verb("reload"));
        assertFalse(TabRules.verb(null));
    }

    @Test public void deepLinks() {
        assertEquals("new", TabRules.linkTarget("axf-console://tab/new"));
        assertEquals("t3", TabRules.linkTarget("axf-console://tab/t3"));
        assertEquals("t3", TabRules.linkTarget(" axf-console://tab/t3/?x=1 "));
        assertNull(TabRules.linkTarget("axf-console://open/settings.plugins"));
        assertNull(TabRules.linkTarget("https://console.amberxai.com/"));
        assertNull(TabRules.linkTarget("axf-console://tab/"));
        assertNull(TabRules.linkTarget("axf-console://tab/../x"));
        assertNull(TabRules.linkTarget(null));
        assertEquals("axf-console://tab/t2", TabRules.link("t2"));
    }

    @Test public void labels() {
        assertEquals("Build orchestrator", TabRules.label(" Build orchestrator ", 1));
        assertEquals("Plan Studio", TabRules.label("Plan Studio \u00b7 AXF Console", 2)); // the screen, not the brand
        assertEquals("AXF Console", TabRules.label("AXF Console", 1)); // the start screen
        assertEquals("Tab 2", TabRules.label("", 2));
        assertEquals("Tab 3", TabRules.label(null, 3));
        assertEquals("Tab 1", TabRules.label("https://console.amberxai.com/", 1));
        String clipped = TabRules.label("A very long page title indeed", 1);
        assertTrue(clipped.length() <= TabRules.LABEL_MAX);
        assertTrue(clipped.endsWith("…"));
    }

    @Test public void theStripClearsTheBarsOnlyWhenThePagePadsItself() {
        int[] insets = { 80, 10, 48, 20 }; // top, right, bottom, left
        assertArrayEquals(new int[] { 0, 0, 0, 0 }, TabRules.stripPadding(insets, false)); // the shell pads the window
        assertArrayEquals(new int[] { 20, 0, 10, 48 }, TabRules.stripPadding(insets, true)); // left, top, right, bottom
        assertArrayEquals(new int[] { 0, 0, 0, 0 }, TabRules.stripPadding(null, true));
    }

    @Test public void thePageGetsNoBottomInsetAboveTheStrip() {
        assertArrayEquals(new int[] { 80, 10, 0, 20 }, TabRules.pageInsets(new int[] { 80, 10, 48, 20 }));
    }

    @Test public void stateJson() {
        TabRules.State s = TabRules.open(TabRules.first());
        String j = TabRules.json(s, Arrays.asList("Home", "He said \"hi\""), Arrays.asList("https://console.amberxai.com/", ""));
        assertEquals("{\"active\":\"t2\",\"max\":8,\"count\":2,\"tabs\":["
            + "{\"id\":\"t1\",\"title\":\"Home\",\"url\":\"https://console.amberxai.com/\",\"active\":false,\"link\":\"axf-console://tab/t1\"},"
            + "{\"id\":\"t2\",\"title\":\"He said \\\"hi\\\"\",\"url\":\"\",\"active\":true,\"link\":\"axf-console://tab/t2\"}]}", j);
        assertTrue(TabRules.json(s, null, null).contains("\"title\":\"Tab 1\""));
    }
}
