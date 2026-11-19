package ai.amberx.droid;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

import org.junit.Test;

/** An audio-focus loss lets go of the microphone only for a call or another app recording (Nov 7 2026, gizmo-voice-fix). */
public class FocusRulesTest {
    private static ListenerRules.Policy pol(boolean onCall, boolean otherApps) {
        ListenerRules.Policy p = ListenerRules.defaults(ListenerRules.TALK);
        p.pauseOnCall = onCall;
        p.pauseForOtherApps = otherApps;
        return p;
    }

    @Test
    public void ourOwnRecognizerTakingFocusIsNotAReasonToStop() {
        // Google's recognizer is the one foreign recording while our turn is open: MicRules.others takes it off.
        int others = MicRules.others(1, true);
        assertNull(FocusRules.yieldOnLoss(false, others, pol(true, true)));
        assertNull(FocusRules.yieldOnLoss(false, MicRules.others(0, false), pol(true, true)));
    }

    @Test
    public void anAppThatOnlyPlaysSoundIsNotAReasonToStop() {
        assertNull(FocusRules.yieldOnLoss(false, 0, pol(true, true)));
    }

    @Test
    public void aCallStopsItWhenThePolicySaysSo() {
        assertEquals("call", FocusRules.yieldOnLoss(true, 0, pol(true, true)));
        assertNull(FocusRules.yieldOnLoss(true, 0, pol(false, true)));
    }

    @Test
    public void anotherAppRecordingStopsItWhenThePolicySaysSo() {
        assertEquals("other-app", FocusRules.yieldOnLoss(false, MicRules.others(2, true), pol(true, true)));
        assertEquals("other-app", FocusRules.yieldOnLoss(false, 1, pol(true, true)));
        assertNull(FocusRules.yieldOnLoss(false, 1, pol(true, false)));
    }
}
