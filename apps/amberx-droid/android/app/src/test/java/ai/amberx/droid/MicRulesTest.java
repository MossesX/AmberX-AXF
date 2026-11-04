package ai.amberx.droid;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/** Mic off and letting go of the microphone for other apps (Nov 1 2026). */
public class MicRulesTest {
    @Test
    public void micOffWinsOverEverything() {
        assertEquals("mic-off", MicRules.yieldReason(true, MicRules.MODE_NORMAL, 0, false, false));
        assertEquals("mic-off", MicRules.yieldReason(true, MicRules.MODE_IN_CALL, 3, true, true));
    }

    @Test
    public void callsAndVoipTakeTheMic() {
        assertTrue(MicRules.callMode(MicRules.MODE_IN_CALL));
        assertTrue(MicRules.callMode(MicRules.MODE_IN_COMMUNICATION));
        assertTrue(MicRules.callMode(MicRules.MODE_RINGTONE));
        assertTrue(MicRules.callMode(MicRules.MODE_CALL_SCREENING));
        assertFalse(MicRules.callMode(MicRules.MODE_NORMAL));
        assertEquals("call", MicRules.yieldReason(false, MicRules.MODE_IN_COMMUNICATION, 0, false, false));
    }

    @Test
    public void anotherAppRecordingIsSeenButOurOwnRecognizerIsNot() {
        assertNull(MicRules.yieldReason(false, MicRules.MODE_NORMAL, 0, false, false));
        // Google's recognizer is another app's recording: while AmberX runs it, one foreign recording is ours
        assertNull(MicRules.yieldReason(false, MicRules.MODE_NORMAL, 1, true, false));
        assertEquals("other-app", MicRules.yieldReason(false, MicRules.MODE_NORMAL, 2, true, false));
        assertEquals("other-app", MicRules.yieldReason(false, MicRules.MODE_NORMAL, 1, false, false));
        assertEquals(0, MicRules.others(0, true));
    }

    @Test
    public void onlyRealMicRecordingsCount() {
        assertTrue(MicRules.micSource(1));   // MIC
        assertTrue(MicRules.micSource(6));   // VOICE_RECOGNITION
        assertTrue(MicRules.micSource(7));   // VOICE_COMMUNICATION (a voice call)
        assertFalse(MicRules.micSource(8));  // REMOTE_SUBMIX: playback capture, no microphone
        assertFalse(MicRules.micSource(1999)); // HOTWORD: the system's wake-word detector
    }

    @Test
    public void silencedByAndroidMeansLetGo() {
        assertEquals("silenced", MicRules.yieldReason(false, MicRules.MODE_NORMAL, 0, false, true));
    }

    @Test
    public void resumesOnlyAfterTheMicStaysFree() {
        assertFalse(MicRules.mayResume(-1, 10_000));
        assertFalse(MicRules.mayResume(10_000, 10_000 + MicRules.RESUME_AFTER_MS - 1));
        assertTrue(MicRules.mayResume(10_000, 10_000 + MicRules.RESUME_AFTER_MS));
    }

    @Test
    public void labelsArePlain() {
        assertEquals("Listening", MicRules.label(null));
        assertEquals("Mic off", MicRules.label("mic-off"));
        assertTrue(MicRules.label("call").startsWith("Paused"));
        assertTrue(MicRules.label("other-app").contains("another app"));
    }
}
