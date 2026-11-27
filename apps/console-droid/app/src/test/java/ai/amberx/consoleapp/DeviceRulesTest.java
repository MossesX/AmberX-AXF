package ai.amberx.consoleapp;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class DeviceRulesTest {
    @Test public void knowsOnlyBrowserOpen() {
        assertTrue(DeviceRules.known("browser.open"));
        assertFalse(DeviceRules.known("recorder.start")); // still AmberX's until the capture service moves
        assertFalse(DeviceRules.known(""));
    }

    @Test public void overlayVerbsRideTheUrl() {
        assertEquals(DeviceRules.EXPAND, DeviceRules.verb("https://console.amberxai.com/?axf-overlay=expand"));
        assertEquals(DeviceRules.COLLAPSE, DeviceRules.verb("https://console.amberxai.com/?a=1&axf-overlay=COLLAPSE"));
        assertEquals(DeviceRules.PAGE, DeviceRules.verb("https://console.amberxai.com/?axf-overlay=fly"));
        assertEquals(DeviceRules.PAGE, DeviceRules.verb("https://console.amberxai.com/"));
        assertEquals(DeviceRules.PAGE, DeviceRules.verb("not a url ::"));
    }

    @Test public void browserOnlyWhenAsked() {
        assertEquals("browser", DeviceRules.where("browser"));
        assertEquals("app", DeviceRules.where("overlay"));
        assertEquals("app", DeviceRules.where(""));
        assertEquals("app", DeviceRules.where(null));
    }

    @Test public void backsOff() {
        assertEquals(5_000, DeviceRules.backoff(1));
        assertEquals(60_000, DeviceRules.backoff(9));
        assertEquals(DeviceRules.SIGNED_OUT_MS, DeviceRules.afterStatus(401, 1));
        assertEquals(15_000, DeviceRules.afterStatus(500, 2));
    }

    @Test public void announcesOpenUrl() {
        assertEquals(1, DeviceRules.CAPABILITIES.length);
        assertEquals("open-url@1", DeviceRules.CAPABILITIES[0]);
    }
}
