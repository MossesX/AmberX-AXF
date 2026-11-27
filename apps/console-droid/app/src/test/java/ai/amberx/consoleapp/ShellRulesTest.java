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

    // console-open-no-reload (Nov 23 2026): a wake or a show for a console that is already loaded never reloads it
    @Test public void aLoadedConsoleOpensItsOwnLinksWithoutAReload() {
        String on = "https://console.amberxai.com/";
        assertTrue(ShellRules.inPage(on, "https://console.amberxai.com/?axf-cmd=cq-19ab-0c1d2e&axf-open=view:axhub-apps"));
        assertTrue(ShellRules.inPage(on, "https://console.amberxai.com/?axf-open=view%3Aplan-studio-2"));
        assertTrue(ShellRules.inPage("https://console.amberxai.com/?x=1#top", "https://console.amberxai.com/?axf-cmd=cq-1"));
        assertTrue(ShellRules.inPage(on, ShellRules.deepLink("axf-console://open/approvals.view")));
        assertTrue(ShellRules.inPage(on, ShellRules.HOME));
    }

    @Test public void everythingElseIsLoaded() {
        String on = "https://console.amberxai.com/";
        String wake = "https://console.amberxai.com/?axf-cmd=cq-1&axf-open=view:axhub-apps";
        // no console showing: the offline page, the hub's approvals page, nothing yet
        assertFalse(ShellRules.inPage("file:///android_asset/offline.html", wake));
        assertFalse(ShellRules.inPage("https://axhub.amberxai.com/auth/admin/approvals", wake));
        assertFalse(ShellRules.inPage("", wake));
        assertFalse(ShellRules.inPage(null, wake));
        // not a console link, or one that asks for a load
        assertFalse(ShellRules.inPage(on, "https://axhub.amberxai.com/auth/admin/approvals"));
        assertFalse(ShellRules.inPage(on, "https://console.amberxai.com/docs/guide"));
        assertFalse(ShellRules.inPage(on, "https://console.amberxai.com/?axf-cmd=search&q=plan"));
        assertFalse(ShellRules.inPage(on, "https://console.amberxai.com/?axf-refresh=abc"));
        assertFalse(ShellRules.inPage(on, "https://example.com/"));
        assertFalse(ShellRules.inPage(on, null));
    }

    @Test public void theHandOffScriptCarriesTheLinkSafely() {
        String s = ShellRules.handOffScript("https://console.amberxai.com/?axf-open=view:a\"b</script>\n");
        assertTrue(s.contains("window.axfNative.open(\"https://console.amberxai.com/?axf-open=view:a\\\"b\\u003c/script>\\u000a\")"));
        assertFalse(s.contains("</script>"));
        assertEquals("\"\"", ShellRules.jsString(null));
        assertEquals("\"a\\\\b\"", ShellRules.jsString("a\\b"));
    }

    @Test public void backLeavesOnlyWithoutHistory() {
        assertEquals("back", ShellRules.back(true));
        assertEquals("leave", ShellRules.back(false));
    }

    @Test public void onlyTheConsoleItselfRunsConsoleActions() {
        assertTrue(ShellRules.onConsole("https://console.amberxai.com/"));
        assertTrue(ShellRules.onConsole("https://console.amberxai.com"));
        assertTrue(ShellRules.onConsole("https://console.amberxai.com/?axf-open=approvals.view"));
        assertTrue(ShellRules.onConsole("https://console.amberxai.com/builds#x"));
        // the hub's own pages stay inside the app but don't run the console's actions
        assertFalse(ShellRules.onConsole("https://axhub.amberxai.com/auth/admin/approvals"));
        assertFalse(ShellRules.onConsole("https://console.amberxai.com.evil.example/"));
        assertFalse(ShellRules.onConsole("file:///android_asset/offline.html"));
        assertFalse(ShellRules.onConsole(""));
        assertFalse(ShellRules.onConsole(null));
    }
}
