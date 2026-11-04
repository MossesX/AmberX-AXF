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
}
