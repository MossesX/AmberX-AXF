package ai.amberx.consoleapp;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.util.HashMap;
import java.util.Map;
import org.junit.Test;

public class OverlayRulesTest {
    @Test public void configReadsFullAndShortKeysAndClamps() {
        Map<String, Object> m = new HashMap<>();
        m.put("approvals-banner.overlay.on", "off");
        m.put("edge", "start");
        m.put("approvals-banner.overlay.top", 140);
        m.put("size", "LARGE");
        m.put("expand", "held");
        m.put("idleOpacity", "10");
        OverlayRules.Config c = OverlayRules.config(m);
        assertFalse(c.on);
        assertEquals("start", c.edge);
        assertEquals(90, c.top);
        assertEquals("large", c.size);
        assertEquals("held", c.expand);
        assertEquals(40, c.idleOpacity);
    }

    @Test public void configDefaults() {
        OverlayRules.Config c = OverlayRules.config(null);
        assertTrue(c.on);
        assertEquals("end", c.edge);
        assertEquals(30, c.top);
        assertEquals("every", c.expand);
        Map<String, Object> m = new HashMap<>();
        m.put("edge", "weird"); m.put("expand", "weird"); m.put("size", "huge"); m.put("top", "x");
        c = OverlayRules.config(m);
        assertEquals("end", c.edge);
        assertEquals("every", c.expand);
        assertEquals("small", c.size);
        assertEquals(30, c.top);
    }

    @Test public void barPopsPerSetting() {
        assertTrue(OverlayRules.popsBar("every", 1, 0));
        assertFalse(OverlayRules.popsBar("every", 0, 0));
        assertFalse(OverlayRules.popsBar("held", 2, 0));
        assertTrue(OverlayRules.popsBar("held", 2, 1));
        assertFalse(OverlayRules.popsBar("never", 5, 5));
    }

    @Test public void approvalsNeverFoldTheExpandedConsole() {
        OverlayRules.Config c = new OverlayRules.Config();
        assertEquals(OverlayRules.EXPANDED, OverlayRules.afterApprovals(OverlayRules.EXPANDED, c, 0, 0));
        assertEquals(OverlayRules.APPROVALS, OverlayRules.afterApprovals(OverlayRules.TOOLBAR, c, 1, 0));
        assertEquals(OverlayRules.TOOLBAR, OverlayRules.afterApprovals(OverlayRules.APPROVALS, c, 0, 0));
    }

    @Test public void texts() {
        assertEquals("", OverlayRules.barText(0, "x"));
        assertEquals("1 approval waits", OverlayRules.barText(1, ""));
        assertEquals("3 approvals wait", OverlayRules.barText(3, null));
        assertEquals("Run deploy", OverlayRules.barText(1, "Run deploy"));
        assertEquals("Run deploy — 2 more", OverlayRules.barText(3, " Run deploy "));
        assertEquals(60, OverlayRules.barText(1, "x".repeat(100)).length());
        assertEquals("", OverlayRules.badge(0));
        assertEquals("4", OverlayRules.badge(4));
        assertEquals("9+", OverlayRules.badge(12));
    }

    @Test public void dragAndPosition() {
        assertEquals("start", OverlayRules.edgeAfterDrag(100, 1080));
        assertEquals("end", OverlayRules.edgeAfterDrag(900, 1080));
        assertEquals(50, OverlayRules.topAfterDrag(1000, 2000));
        assertEquals(90, OverlayRules.topAfterDrag(1990, 2000));
        assertEquals(30, OverlayRules.topAfterDrag(5, 0));
        // never above the status bar / camera cutout
        assertEquals(120, OverlayRules.topPx(0, 2000, 120));
        assertEquals(600, OverlayRules.topPx(30, 2000, 120));
    }

    @Test public void verbs() {
        assertEquals(OverlayRules.EXPANDED, OverlayRules.verb(OverlayRules.TOOLBAR, "expand"));
        assertEquals(OverlayRules.TOOLBAR, OverlayRules.verb(OverlayRules.EXPANDED, "collapse"));
        assertEquals(OverlayRules.TOOLBAR, OverlayRules.verb(OverlayRules.EXPANDED, "toggle"));
        assertEquals(OverlayRules.EXPANDED, OverlayRules.verb(OverlayRules.APPROVALS, "approvals"));
        assertEquals(OverlayRules.APPROVALS, OverlayRules.verb(OverlayRules.APPROVALS, "nonsense"));
        assertEquals(100, OverlayRules.opacity(new OverlayRules.Config(), 2));
        assertEquals(85, OverlayRules.opacity(new OverlayRules.Config(), 0));
    }
}
