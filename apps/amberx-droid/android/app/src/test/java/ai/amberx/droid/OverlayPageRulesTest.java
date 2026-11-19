package ai.amberx.droid;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.json.JSONObject;
import org.junit.Test;

/** The overlay's full-screen browser: where opens go, the remote verbs, which links stay inside, the bridge, the back key. */
public class OverlayPageRulesTest {
    @Test public void everyOpenGoesThroughTheOverlayWhenTheToolbarIsUp() throws Exception {
        JSONObject none = new JSONObject();
        assertTrue(OverlayPageRules.inOverlay(none, true));
        assertTrue(OverlayPageRules.inOverlay(null, true));
        assertTrue("where=overlay is the default anyway", OverlayPageRules.inOverlay(new JSONObject().put("where", "overlay"), true));
        assertFalse("overlay off / no draw-over permission: Chrome", OverlayPageRules.inOverlay(none, false));
        assertFalse("a call can still ask for Chrome", OverlayPageRules.inOverlay(new JSONObject().put("where", "browser"), true));
    }

    @Test public void verbsRideTheConsoleUrl() {
        assertEquals("expand", OverlayPageRules.verb("https://console.amberxai.com/?axf-overlay=expand"));
        assertEquals("collapse", OverlayPageRules.verb("https://console.amberxai.com/?x=1&axf-overlay=COLLAPSE"));
        assertEquals("open", OverlayPageRules.verb("https://console.amberxai.com/?axf-view=builds"));
        assertEquals("open", OverlayPageRules.verb("https://console.amberxai.com/"));
        assertEquals("an unknown verb is a plain open", "open", OverlayPageRules.verb("https://console.amberxai.com/?axf-overlay=explode"));
        assertEquals("open", OverlayPageRules.verb("not a url at all"));
    }

    @Test public void onlyBrettsSitesStayInsideAndMayUseTheBridge() {
        assertTrue(OverlayPageRules.staysInside("https://console.amberxai.com/?axf-view=ui-review"));
        assertTrue(OverlayPageRules.staysInside("https://axhub.amberxai.com/x"));
        assertFalse(OverlayPageRules.staysInside("https://github.com/"));
        assertFalse(OverlayPageRules.staysInside("http://console.amberxai.com/"));
        assertFalse(OverlayPageRules.staysInside("intent://x#Intent;end"));
        assertFalse(OverlayPageRules.staysInside(""));
        assertTrue(OverlayPageRules.bridgeAllowed("https://console.amberxai.com/"));
        assertFalse(OverlayPageRules.bridgeAllowed("https://evil.example/"));
        assertFalse(OverlayPageRules.bridgeAllowed(""));
    }

    @Test public void expandReopensTheLastPageElseTheConsole() {
        assertEquals("https://console.amberxai.com/?axf-view=builds", OverlayPageRules.expandUrl("https://console.amberxai.com/?axf-view=builds"));
        assertEquals(OverlayPageRules.HOME, OverlayPageRules.expandUrl(""));
        assertEquals(OverlayPageRules.HOME, OverlayPageRules.expandUrl(null));
        assertEquals(OverlayPageRules.HOME, OverlayPageRules.expandUrl("https://evil.example/"));
    }

    @Test public void dockedToolbarSaysThePageTitleElseTheHost() {
        assertEquals("UI Review", OverlayPageRules.title("https://console.amberxai.com/", " UI Review "));
        assertEquals("console.amberxai.com", OverlayPageRules.title("https://console.amberxai.com/x", ""));
        assertEquals("console.amberxai.com", OverlayPageRules.title("https://console.amberxai.com/x", "https://console.amberxai.com/x"));
        assertEquals("Page", OverlayPageRules.title("", null));
    }

    @Test public void backGoesBackThenCollapsesToTheToolbar() {
        assertEquals("back", OverlayPageRules.back(true));
        assertEquals("collapse", OverlayPageRules.back(false));
    }
}
