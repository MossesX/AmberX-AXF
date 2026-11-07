package ai.amberx.droid;

/**
 * What an audio-focus loss means for a listener that is talking with the person (Nov 7 2026, build gizmo-voice-fix;
 * Brett: "Gizmo inside AmberX won't turn on / isn't listening"). Pure, so plain JUnit drives it ({@code FocusRulesTest}).
 *
 * The Nov 6 rebuild let go of the microphone on every focus loss. But Google's speech recognizer asks for transient
 * audio focus itself when it starts listening, so every turn AmberX opened took focus from AmberX: talk mode paused
 * ("another app is using the microphone"), the recognizer closed, focus came back, it resumed 3 s later and paused
 * again, forever, and the one-shot after a wake phrase was cancelled before it heard a word. A loss is only a reason to
 * let go when something else really wants the microphone: a call, or another app recording. A loss while AmberX's own
 * recognizer or its own speech is running, with no call and no other recording, is AmberX itself: keep listening.
 * Another app that only plays sound (music, a video) doesn't need the microphone either: its loss is permanent and
 * focus would never come back, so pausing for it would leave talk mode paused for good.
 */
final class FocusRules {
    private FocusRules() {}

    /** How long after a loss we look again (a call or another app's recording starts a moment after it takes focus). */
    static final long RECHECK_MS = 800;

    /**
     * Why the listener must let go after a focus loss, or null = keep going.
     *
     * @param call       the audio mode is a call (ringing, in call, VoIP)
     * @param others     active recordings on the phone that aren't AmberX's (its own recognizer already taken off:
     *                   {@link MicRules#others})
     * @param p          the listener's policy (pause for calls / pause for other apps)
     */
    static String yieldOnLoss(boolean call, int others, ListenerRules.Policy p) {
        if (call) return p.pauseOnCall ? "call" : null;
        if (others > 0) return p.pauseForOtherApps ? "other-app" : null;
        return null; // AmberX's own recognizer or voice took the focus, or an app that only plays sound: keep listening
    }
}
