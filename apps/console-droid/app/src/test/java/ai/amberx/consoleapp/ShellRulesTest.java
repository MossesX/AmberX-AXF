package ai.amberx.consoleapp;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import org.junit.Test;

public class ShellRulesTest {
    @Test public void ownSitesStayInside() {
        assertTrue(ShellRules.staysInside("https://console.amberxai.com/"));
        assertTrue(ShellRules.staysInside("https://amberxai.com/x"));
        assertTrue(ShellRules.staysInside("https://hub.amberxai.com:443/a?b=c"));
    }

    @Test public void otherSitesGoOutside() {
        assertFalse(ShellRules.staysInside("https://evil.com/"));
        assertFalse(ShellRules.staysInside("https://amberxai.com.evil.com/"));
        assertFalse(ShellRules.staysInside("https://evilamberxai.com/"));
        assertFalse(ShellRules.staysInside("http://console.amberxai.com/"));
        assertFalse(ShellRules.staysInside("https://user:pw@console.amberxai.com/"));
        assertFalse(ShellRules.staysInside("https://console.amberxai.com:8443/"));
        assertFalse(ShellRules.staysInside("javascript:alert(1)"));
        assertFalse(ShellRules.staysInside(""));
        assertFalse(ShellRules.staysInside(null));
    }

    @Test public void allowedSaysWhy() {
        try { ShellRules.allowed("https://example.com/"); fail(); }
        catch (IllegalArgumentException e) { assertTrue(e.getMessage().contains("example.com")); }
    }

    @Test public void bridgeOnlyOnOwnSites() {
        assertTrue(ShellRules.bridgeAllowed("https://console.amberxai.com/?a=1"));
        assertFalse(ShellRules.bridgeAllowed("file:///android_asset/offline.html"));
        assertFalse(ShellRules.bridgeAllowed("https://example.com/"));
    }

    @Test public void deepLinks() {
        assertEquals(ShellRules.HOME, ShellRules.deepLink(null));
        assertEquals(ShellRules.HOME, ShellRules.deepLink(""));
        assertEquals(ShellRules.HOME + "?axf-open=settings.plugins", ShellRules.deepLink("axf-console://open/settings.plugins"));
        assertEquals(ShellRules.HOME + "?axf-open=view%3Aapprovals", ShellRules.deepLink("axf-console://open/view:approvals/"));
        assertEquals(ShellRules.HOME + "?axf-cmd=search&q=plan%20studio", ShellRules.deepLink("axf-console://search/plan%20studio"));
        assertEquals(ShellRules.HOME + "?axf-cmd=search&q=a%2Bb", ShellRules.deepLink("AXF-CONSOLE://search/a+b"));
        assertEquals(ShellRules.HOME, ShellRules.deepLink("axf-console://nothing"));
        assertEquals("https://console.amberxai.com/builds", ShellRules.deepLink("https://console.amberxai.com/builds"));
        assertEquals(ShellRules.HOME, ShellRules.deepLink("https://example.com/"));
    }

    @Test public void backLeavesOnlyWithoutHistory() {
        assertEquals("back", ShellRules.back(true));
        assertEquals("leave", ShellRules.back(false));
    }
}
