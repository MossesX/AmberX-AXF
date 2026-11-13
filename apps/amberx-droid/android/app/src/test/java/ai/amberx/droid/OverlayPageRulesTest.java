package ai.amberx.droid;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.json.JSONObject;
import org.junit.Test;

/** The overlay's page window: where a page goes, which links stay inside, the title bar and the back key. */
public class OverlayPageRulesTest {
    private static ApprovalOverlayRules.Settings with(String json) throws Exception {
        return ApprovalOverlayRules.settings(new JSONObject(json));
    }

    @Test public void pagesSettingDefaultsToOverlay() throws Exception {
        assertEquals("overlay", ApprovalOverlayRules.settings(null).pages);
        assertEquals("browser", with("{\"pages\":\"browser\"}").pages);
        assertEquals("overlay", with("{\"pages\":\"nonsense\"}").pages);
        assertEquals("browser", ApprovalOverlayRules.settings(null).toJson().put("pages", "browser").optString("pages"));
        assertEquals("overlay", ApprovalOverlayRules.settings(null).toJson().optString("pages"));
    }

    @Test public void openGoesToTheOverlayOnlyWhenItCan() throws Exception {
        ApprovalOverlayRules.Settings d = ApprovalOverlayRules.settings(null);
        JSONObject none = new JSONObject();
        assertTrue(OverlayPageRules.inOverlay(d, none, true));
        assertFalse("no draw-over permission / not watching: Chrome", OverlayPageRules.inOverlay(d, none, false));
        assertFalse("overlay off: Chrome", OverlayPageRules.inOverlay(with("{\"on\":false}"), none, true));
        assertFalse("Brett set pages to Chrome", OverlayPageRules.inOverlay(with("{\"pages\":\"browser\"}"), none, true));
        assertTrue("an explicit where=overlay wins over the setting", OverlayPageRules.inOverlay(with("{\"pages\":\"browser\"}"), new JSONObject().put("where", "overlay"), true));
        assertFalse("where=overlay still needs the overlay", OverlayPageRules.inOverlay(d, new JSONObject().put("where", "overlay"), false));
        assertFalse("where=browser always Chrome", OverlayPageRules.inOverlay(d, new JSONObject().put("where", "browser"), true));
        assertFalse(OverlayPageRules.inOverlay(null, none, true));
        assertTrue(OverlayPageRules.inOverlay(d, null, true));
    }

    @Test public void onlyBrettsSitesStayInside() {
        assertTrue(OverlayPageRules.staysInside("https://console.amberxai.com/?axf-view=ui-review"));
        assertTrue(OverlayPageRules.staysInside("https://axhub.amberxai.com/x"));
        assertFalse(OverlayPageRules.staysInside("https://github.com/"));
        assertFalse(OverlayPageRules.staysInside("http://console.amberxai.com/"));
        assertFalse(OverlayPageRules.staysInside("intent://x#Intent;end"));
        assertFalse(OverlayPageRules.staysInside(""));
    }

    @Test public void pageButtonReopensTheLastPageElseTheConsole() {
        assertEquals("https://console.amberxai.com/?axf-view=builds", OverlayPageRules.pageButtonUrl("https://console.amberxai.com/?axf-view=builds"));
        assertEquals(OverlayPageRules.HOME, OverlayPageRules.pageButtonUrl(""));
        assertEquals(OverlayPageRules.HOME, OverlayPageRules.pageButtonUrl(null));
        assertEquals(OverlayPageRules.HOME, OverlayPageRules.pageButtonUrl("https://evil.example/"));
    }

    @Test public void titleBarSaysThePageTitleElseTheHost() {
        assertEquals("UI Review", OverlayPageRules.title("https://console.amberxai.com/", " UI Review "));
        assertEquals("console.amberxai.com", OverlayPageRules.title("https://console.amberxai.com/x", ""));
        assertEquals("console.amberxai.com", OverlayPageRules.title("https://console.amberxai.com/x", "https://console.amberxai.com/x"));
        assertEquals("Page", OverlayPageRules.title("", null));
    }

    @Test public void backGoesBackThenClosesToTheToolbar() {
        assertEquals("back", OverlayPageRules.back(true));
        assertEquals("close", OverlayPageRules.back(false));
    }
}
