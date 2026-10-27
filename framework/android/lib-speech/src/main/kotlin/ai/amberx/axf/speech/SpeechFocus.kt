package ai.amberx.axf.speech

/** Audio focus changes the player reacts to (Android's AUDIOFOCUS_* values, as an enum). */
public enum class FocusChange { GAIN, LOSS, LOSS_TRANSIENT, LOSS_TRANSIENT_CAN_DUCK }

/** What the player does on a focus change. */
public enum class FocusAction { PAUSE, RESUME, NONE }

public data class FocusDecision(val action: FocusAction, val pausedByFocus: Boolean)

/**
 * Audio focus rules (pure). Speech is content you'd miss, so the player pauses on every loss — also on
 * "can duck" — and resumes by itself only after a transient loss. A permanent loss (another app started
 * playing) pauses for good: the user resumes.
 */
public object FocusPolicy {
    public fun decide(change: FocusChange, pausedByFocus: Boolean, paused: Boolean): FocusDecision = when (change) {
        FocusChange.LOSS -> FocusDecision(if (paused) FocusAction.NONE else FocusAction.PAUSE, false)
        FocusChange.LOSS_TRANSIENT, FocusChange.LOSS_TRANSIENT_CAN_DUCK ->
            if (paused) FocusDecision(FocusAction.NONE, pausedByFocus) else FocusDecision(FocusAction.PAUSE, true)
        FocusChange.GAIN -> if (pausedByFocus) FocusDecision(FocusAction.RESUME, false) else FocusDecision(FocusAction.NONE, false)
    }
}

/**
 * Audio focus as the player sees it. [acquire] asks for transient focus (others duck when [duck] says so, else
 * pause) and reports changes to [onChange]; [release] gives it back. Android: [AndroidAudioFocus].
 */
public interface SpeechFocus {
    /** true when focus was granted (the player speaks either way). */
    public fun acquire(onChange: (FocusChange) -> Unit): Boolean
    public fun release()

    public companion object {
        /** No focus handling (tests, hosts that manage audio themselves). */
        public val NONE: SpeechFocus = object : SpeechFocus {
            override fun acquire(onChange: (FocusChange) -> Unit): Boolean = true
            override fun release() {}
        }
    }
}
