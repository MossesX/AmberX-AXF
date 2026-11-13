package ai.amberx.consoleapp;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class UpdateRulesTest {
    @Test public void findsTheEntryBundle() {
        assertEquals("/assets/index-AbC123.js", UpdateRules.entry("<head><script type=\"module\" crossorigin src=\"/assets/index-AbC123.js\"></script></head>"));
        assertEquals("/assets/index-Z.js", UpdateRules.entry("<script src='/assets/index-Z.js' type='module'></script>"));
        assertEquals("", UpdateRules.entry("<script src=\"/legacy.js\"></script>"));
        assertEquals("", UpdateRules.entry(null));
    }

    @Test public void comparesPathsNotUrls() {
        assertEquals("/assets/x.js", UpdateRules.path("https://console.amberxai.com/assets/x.js?v=2#a"));
        assertEquals("/assets/x.js", UpdateRules.path("assets/x.js"));
        assertEquals("", UpdateRules.path(null));
    }

    @Test public void checksAreSpaced() {
        assertTrue(UpdateRules.due(1000, 0, false));
        assertFalse(UpdateRules.due(UpdateRules.MIN_GAP_MS, 1, false));
        assertTrue(UpdateRules.due(UpdateRules.MIN_GAP_MS + 1, 1, false));
        assertTrue(UpdateRules.due(2, 1, true));
    }

    @Test public void reloadsOnlyWhenNobodyIsLooking() {
        assertEquals(UpdateRules.NONE, UpdateRules.action("/a.js", "/a.js", false));
        assertEquals(UpdateRules.NONE, UpdateRules.action("", "/a.js", false));
        assertEquals(UpdateRules.NONE, UpdateRules.action("/a.js", "", false));
        assertEquals(UpdateRules.RELOAD, UpdateRules.action("/a.js", "/b.js", false));
        assertEquals(UpdateRules.NOTIFY, UpdateRules.action("/a.js", "/b.js", true));
    }

    @Test public void verbs() {
        assertTrue(UpdateRules.verb("check"));
        assertTrue(UpdateRules.verb("reload"));
        assertTrue(UpdateRules.verb("state"));
        assertFalse(UpdateRules.verb("install"));
    }
}
