package ai.amberx.droid;

/**
 * The pure rules behind {@link MicGuard} (Nov 1 2026, Brett: "a quick switch … turns the green dot off my phone"; and
 * AmberX held the microphone so a Claude voice call couldn't use it). No Android types here, so JUnit drives every rule
 * ({@code MicRulesTest}).
 *
 * - **Mic off** wins over everything: nothing opens the microphone while it is on.
 * - **Yield:** AmberX's background listening lets go of the microphone while a phone or VoIP call is on (audio mode),
 *   while Android has silenced one of AmberX's own recordings (someone with priority took the mic), or while another
 *   app records. Listening comes back only after the microphone has been free for {@link #RESUME_AFTER_MS}.
 */
final class MicRules {
    private MicRules() {}

    /** AudioManager modes (the values, so this file needs no Android import). */
    static final int MODE_NORMAL = 0, MODE_RINGTONE = 1, MODE_IN_CALL = 2, MODE_IN_COMMUNICATION = 3,
        MODE_CALL_SCREENING = 4, MODE_CALL_REDIRECT = 5, MODE_COMMUNICATION_REDIRECT = 6;

    /** How long the microphone must stay free before background listening starts again. */
    static final long RESUME_AFTER_MS = 3_000;
    /** A Google recognizer AmberX just stopped can still show as a recording this long; it isn't another app. */
    static final long RECOGNIZER_GRACE_MS = 1_500;
    /** How often the watch service looks again while it has yielded (the callbacks usually answer first). */
    static final long CHECK_EVERY_MS = 2_000;

    /**
     * A recording that holds the real microphone: not playback capture or a screen recorder's audio (REMOTE_SUBMIX, 8)
     * and not the system's always-on hotword detector (HOTWORD, 1999), which would otherwise keep AmberX paused forever.
     */
    static boolean micSource(int source) {
        return source >= 0 && source <= 10 && source != 8;
    }

    /** True while the phone is ringing, in a call, or in a VoIP / voice-chat session (the Claude app's voice mode). */
    static boolean callMode(int mode) {
        return mode == MODE_RINGTONE || mode == MODE_IN_CALL || mode == MODE_IN_COMMUNICATION
            || mode == MODE_CALL_SCREENING || mode == MODE_CALL_REDIRECT || mode == MODE_COMMUNICATION_REDIRECT;
    }

    /**
     * Recordings on the phone that aren't AmberX's own. `foreign` = active recordings whose session isn't one AmberX
     * opened; Google's recognizer runs in another app, so while AmberX's own recognizer is running one foreign recording
     * is ours (`ownRecognizer`).
     */
    static int others(int foreign, boolean ownRecognizer) {
        return Math.max(0, foreign - (ownRecognizer ? 1 : 0));
    }

    /** Why AmberX must let go of the microphone now, or null when it may listen. */
    static String yieldReason(boolean micOff, int mode, int foreign, boolean ownRecognizer, boolean silenced) {
        if (micOff) return "mic-off";
        if (callMode(mode)) return "call";
        if (silenced) return "silenced";
        if (others(foreign, ownRecognizer) > 0) return "other-app";
        return null;
    }

    /** The words people see for a reason. */
    static String label(String reason) {
        if (reason == null) return "Listening";
        switch (reason) {
            case "mic-off": return "Mic off";
            case "call": return "Paused: a call is using the microphone";
            case "silenced":
            case "other-app": return "Paused: another app is using the microphone";
            default: return "Paused";
        }
    }

    /** Resume once the microphone has been free since `freeSince` (ms, or -1 = not free yet) for long enough. */
    static boolean mayResume(long freeSince, long now) {
        return freeSince >= 0 && now - freeSince >= RESUME_AFTER_MS;
    }
}
