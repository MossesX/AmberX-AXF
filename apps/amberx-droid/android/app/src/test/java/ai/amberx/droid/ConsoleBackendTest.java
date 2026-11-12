package ai.amberx.droid;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/** The console app (s12 / s13): which site and which console routes the phone uses, and the backend switch. */
public class ConsoleBackendTest {
    @Test
    public void consoleIsTheDefault() {
        assertEquals("console", ConsoleBackend.normalize(null));
        assertEquals("console", ConsoleBackend.normalize(""));
        assertEquals("console", ConsoleBackend.normalize("something else"));
        assertEquals("amberx-web", ConsoleBackend.normalize(" AmberX-Web "));
        assertTrue(ConsoleBackend.console("console"));
        assertFalse(ConsoleBackend.console("amberx-web"));
    }

    @Test
    public void siteFollowsTheSwitch() {
        assertEquals("https://console.amberxai.com", ConsoleBackend.siteUrl("console"));
        assertEquals("https://amberx.amberxai.com", ConsoleBackend.siteUrl("amberx-web"));
        assertArrayEquals(new String[] { "console.amberxai.com", "amberx.amberxai.com", "axhub.amberxai.com" }, ConsoleBackend.allowNavigation("console"));
        assertEquals("amberx.amberxai.com", ConsoleBackend.allowNavigation("amberx-web")[0]);
    }

    @Test
    public void consoleRoutes() {
        assertEquals("https://console.amberxai.com/api/alerts?view=phone&device=amberx-0123456789abcdef", ConsoleBackend.alertsUrl("amberx-0123456789abcdef"));
        assertEquals("https://console.amberxai.com/api/alerts?view=phone", ConsoleBackend.alertsUrl(""));
        assertEquals("https://console.amberxai.com/api/alerts?view=phone&device=a+b%26c", ConsoleBackend.alertsUrl("a b&c"));
        assertEquals("https://console.amberxai.com/api/plugins/console-commands/open-url/pending?device=pixel", ConsoleBackend.openUrlPendingUrl("pixel"));
        assertEquals("https://console.amberxai.com/api/plugins/console-commands/open-url/ou-1/answer", ConsoleBackend.openUrlAnswerUrl("ou-1"));
        assertEquals("https://console.amberxai.com/api/plugins/output-recorder/recordings/20261112-101500/parts/3", ConsoleBackend.recordingPartUrl("20261112-101500", 3));
        assertEquals("https://console.amberxai.com/api/plugins/output-recorder/recordings/20261112-101500", ConsoleBackend.recordingIndexUrl("20261112-101500"));
        assertEquals("https://console.amberxai.com/api/plugins/amberx-settings/settings/backend", ConsoleBackend.backendSettingUrl());
    }

    @Test
    public void backendFromTheConsole() {
        assertEquals("amberx-web", ConsoleBackend.backendOf(200, "{\"ok\":true,\"setting\":{\"key\":\"backend\",\"value\":\"amberx-web\"}}"));
        assertEquals("console", ConsoleBackend.backendOf(200, "{\"setting\":{\"value\":\"weird\"}}"));
        assertEquals(null, ConsoleBackend.backendOf(401, "{}"));
        assertEquals(null, ConsoleBackend.backendOf(200, "<html>"));
        assertEquals(null, ConsoleBackend.backendOf(200, "{\"setting\":{}}"));
    }

    @Test
    public void onlyTheConsoleApiTakesConsoleCalls() {
        assertTrue(HubRules.isConsoleApi("https://console.amberxai.com/api/plugins/output-recorder/recordings/x"));
        assertFalse(HubRules.isConsoleApi("https://console.amberxai.com/"));
        assertFalse(HubRules.isConsoleApi("https://console.amberxai.com.evil.example/api/x"));
        assertFalse(HubRules.isConsoleApi("https://console.amberxai.com/api/../x"));
        assertFalse(HubRules.isConsoleApi("http://console.amberxai.com/api/x"));
        assertFalse(HubRules.isConsoleApi(null));
    }
}
