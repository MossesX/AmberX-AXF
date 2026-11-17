package ai.amberx.consoleapp;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/** The "Display over other apps" flow (part 2, s3). */
public class OverlayPermissionTest {
    @Test public void askExplainsFirstThenOpensSettings() {
        assertEquals(OverlayPermission.NONE, OverlayPermission.onAsk(true, false));
        assertEquals(OverlayPermission.EXPLAIN, OverlayPermission.onAsk(false, false));
        assertEquals(OverlayPermission.SETTINGS, OverlayPermission.onAsk(false, true));
    }

    @Test public void startOffersOnceWhenTheToolbarIsOn() {
        assertEquals(OverlayPermission.EXPLAIN, OverlayPermission.onStart(true, false, false));
        assertEquals(OverlayPermission.NONE, OverlayPermission.onStart(true, false, true));
        assertEquals(OverlayPermission.NONE, OverlayPermission.onStart(false, false, false));
        assertEquals(OverlayPermission.NONE, OverlayPermission.onStart(true, true, false));
    }

    @Test public void returnChecksAndSays() {
        assertEquals(OverlayPermission.GRANTED, OverlayPermission.afterReturn(true, false, true));
        assertEquals(OverlayPermission.STILL_OFF, OverlayPermission.afterReturn(true, false, false));
        assertEquals(OverlayPermission.UNCHANGED, OverlayPermission.afterReturn(true, true, true));
        assertEquals(OverlayPermission.UNCHANGED, OverlayPermission.afterReturn(false, false, true));
        assertEquals(OverlayPermission.ON, OverlayPermission.message(OverlayPermission.GRANTED));
        assertEquals(OverlayPermission.OFF, OverlayPermission.message(OverlayPermission.STILL_OFF));
        assertNull(OverlayPermission.message(OverlayPermission.UNCHANGED));
        assertTrue(OverlayPermission.BODY.contains("Display over other apps"));
    }

    @Test public void eventCarriesTheOutcome() {
        assertEquals("{\"overlay\":true,\"overlayFlow\":\"granted\"}", OverlayPermission.withOutcome("{\"overlay\":true}", OverlayPermission.GRANTED));
        assertEquals("{\"overlayFlow\":\"still-off\"}", OverlayPermission.withOutcome("{}", OverlayPermission.STILL_OFF));
        assertEquals("{\"overlay\":true}", OverlayPermission.withOutcome("{\"overlay\":true}", OverlayPermission.UNCHANGED));
    }
}
