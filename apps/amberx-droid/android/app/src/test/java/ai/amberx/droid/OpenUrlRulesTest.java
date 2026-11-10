package ai.amberx.droid;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import org.json.JSONObject;
import org.junit.Test;

/** Console wake (Nov 3 2026): AmberX opens only Brett's own https sites when the hub asks. */
public class OpenUrlRulesTest {
    @Test
    public void alertLinksStayOnOwnSites() {
        String console = "https://console.amberxai.com";
        assertEquals(console + "/?axf-review-group=g-1", OpenUrlRules.linkOr(console + "/?axf-review-group=g-1", console));
        assertEquals(console, OpenUrlRules.linkOr("", console));
        assertEquals(console, OpenUrlRules.linkOr("https://evil.example/x", console));
        assertEquals(console, OpenUrlRules.linkOr("view:ui-review", console));
    }

    @Test
    public void ownSitesOpen() {
        assertEquals("https://console.amberxai.com/?axf-cmd=cq-1a2b-abc123", OpenUrlRules.allowed("https://console.amberxai.com/?axf-cmd=cq-1a2b-abc123"));
        assertEquals("https://amberxai.com/", OpenUrlRules.allowed(" https://amberxai.com/ "));
        assertEquals("https://AXHUB.amberxai.com:443/x", OpenUrlRules.allowed("https://AXHUB.amberxai.com:443/x"));
    }

    @Test
    public void everythingElseIsRefused() {
        String[] bad = {
            "", "http://console.amberxai.com/", "javascript:alert(1)", "intent://console.amberxai.com#Intent;end",
            "https://amberxai.com.evil.example/", "https://evilamberxai.com/", "https://example.com/?u=amberxai.com",
            "https://user:pw@console.amberxai.com/", "https://console.amberxai.com:8443/", "file:///sdcard/x.html",
            "https://console.amberxai.com./", "not a url",
        };
        for (String u : bad) {
            try { OpenUrlRules.allowed(u); fail("should refuse " + u); } catch (IllegalArgumentException expected) { /* refused */ }
        }
        try { OpenUrlRules.allowed(null); fail("null refused"); } catch (IllegalArgumentException expected) { /* refused */ }
        StringBuilder huge = new StringBuilder("https://console.amberxai.com/?q=");
        while (huge.length() <= OpenUrlRules.MAX_URL) huge.append('x');
        try { OpenUrlRules.allowed(huge.toString()); fail("too long refused"); } catch (IllegalArgumentException expected) { /* refused */ }
    }

    @Test
    public void domains() {
        assertTrue(OpenUrlRules.ownDomain("amberxai.com"));
        assertTrue(OpenUrlRules.ownDomain("console.amberxai.com"));
        assertFalse(OpenUrlRules.ownDomain("xamberxai.com"));
        assertFalse(OpenUrlRules.ownDomain(""));
    }

    @Test
    public void browserAndCommand() throws Exception {
        assertEquals("chrome", OpenUrlRules.browserOf(new JSONObject()));
        assertEquals("chrome", OpenUrlRules.browserOf(null));
        assertEquals("default", OpenUrlRules.browserOf(new JSONObject().put("browser", "default")));
        assertEquals("chrome", OpenUrlRules.browserOf(new JSONObject().put("browser", "firefox")));
        assertTrue(OpenUrlRules.known("browser.open"));
        assertFalse(OpenUrlRules.known("recorder.start"));
    }

    /** Brett, Nov 10 2026: "It says a command is waiting for you. I clicked it. I'm in the AmberX app." */
    @Test
    public void hubCardsForOpenUrlCarryTheirPage() throws Exception {
        String page = "https://console.amberxai.com/?axf-cmd=cq-1a2b-abc123";
        assertEquals(page, OpenUrlRules.pageOf("amberx.open_url", new JSONObject().put("args", new JSONObject().put("url", page))));
        assertEquals(page, OpenUrlRules.pageOf("amberx.open_url", new JSONObject().put("arguments", new JSONObject().put("url", page))));
        assertEquals(page, OpenUrlRules.pageOf("amberx.open_url",
            new JSONObject().put("summary", "amberx.open_url with arguments {\"url\":\"https:\\/\\/console.amberxai.com\\/?axf-cmd=cq-1a2b-abc123\",\"browser\":\"chrome\"}")));
        // any other tool, no url, or a page AmberX may not open: the card keeps opening the app
        assertEquals(null, OpenUrlRules.pageOf("vps.run", new JSONObject().put("args", new JSONObject().put("url", page))));
        assertEquals(null, OpenUrlRules.pageOf("amberx.open_url", new JSONObject()));
        assertEquals(null, OpenUrlRules.pageOf("amberx.open_url", new JSONObject().put("args", new JSONObject().put("url", "https://evil.example/"))));
        assertEquals(null, OpenUrlRules.pageOf("amberx.open_url", null));
    }

    @Test
    public void aTappedPageIsNotOpenedTwice() {
        String page = "https://console.amberxai.com/?axf-cmd=cq-tap-1";
        long t = 5_000_000L;
        assertFalse(OpenUrlRules.wasTapped(page, t));
        OpenUrlRules.markTapped(page, t);
        assertTrue(OpenUrlRules.wasTapped(page, t + 60_000L));
        assertFalse(OpenUrlRules.wasTapped("https://console.amberxai.com/?axf-cmd=cq-tap-2", t + 1));
        assertFalse(OpenUrlRules.wasTapped(page, t + OpenUrlRules.TAPPED_MS + 1));
        assertFalse(OpenUrlRules.wasTapped(null, t));
    }
}
