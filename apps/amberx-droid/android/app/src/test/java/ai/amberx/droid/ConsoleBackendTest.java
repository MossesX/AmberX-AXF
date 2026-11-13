package ai.amberx.droid;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/** The Console app: the console routes the phone reads, and when approvals reach it through the console. */
public class ConsoleBackendTest {
    @Test
    public void consoleRoutes() {
        assertEquals("https://console.amberxai.com/api/alerts?view=phone&device=amberx-0123456789abcdef", ConsoleBackend.alertsUrl("amberx-0123456789abcdef"));
        assertEquals("https://console.amberxai.com/api/alerts?view=phone", ConsoleBackend.alertsUrl(""));
        assertEquals("https://console.amberxai.com/api/alerts?view=phone", ConsoleBackend.alertsUrl(null));
        assertEquals("https://console.amberxai.com/api/alerts?view=phone&device=a+b%26c", ConsoleBackend.alertsUrl("a b&c"));
        assertEquals("https://console.amberxai.com/api/plugins/approvals-banner/watch", ConsoleBackend.approvalsWatchUrl());
    }

    @Test
    public void approvalsGoThroughTheConsoleOnlyWhenItsWatchWorks() {
        assertTrue(ConsoleBackend.consoleCarriesApprovals(200, "{\"on\":true,\"state\":\"ok\",\"waiting\":2}"));
        assertFalse(ConsoleBackend.consoleCarriesApprovals(200, "{\"on\":true,\"state\":\"error\"}"));
        assertFalse(ConsoleBackend.consoleCarriesApprovals(200, "{\"on\":true,\"state\":\"idle\"}"));
        assertFalse(ConsoleBackend.consoleCarriesApprovals(200, "{\"on\":false,\"state\":\"off\"}"));
        assertFalse(ConsoleBackend.consoleCarriesApprovals(401, "{\"on\":true,\"state\":\"ok\"}"));
        assertFalse(ConsoleBackend.consoleCarriesApprovals(200, "<html>"));
        assertFalse(ConsoleBackend.consoleCarriesApprovals(200, null));
    }

    @Test
    public void vetoAlertKeys() {
        assertTrue(ConsoleBackend.isVetoAlert("approvals:veto:abc"));
        assertFalse(ConsoleBackend.isVetoAlert("approvals:abc"));
        assertFalse(ConsoleBackend.isVetoAlert(null));
    }
}
