package ai.amberx.axf.speech

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager

/**
 * Android audio focus for the reader (minSdk 26: AudioFocusRequest). Asks for transient focus: with [duck] other
 * apps lower their volume while AmberX speaks (GAIN_TRANSIENT_MAY_DUCK), without it they pause (GAIN_TRANSIENT).
 * Focus changes go to the player, which applies [FocusPolicy].
 */
public class AndroidAudioFocus(
    context: Context,
    private val duck: () -> Boolean = { true },
    private val attributes: AudioAttributes = speechAttributes(),
) : SpeechFocus {
    private val audio: AudioManager? = context.applicationContext.getSystemService(Context.AUDIO_SERVICE) as? AudioManager
    private var request: AudioFocusRequest? = null

    @Synchronized
    override fun acquire(onChange: (FocusChange) -> Unit): Boolean {
        val am = audio ?: return true
        request?.let { runCatching { am.abandonAudioFocusRequest(it) } }
        val req = AudioFocusRequest.Builder(if (duck()) AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK else AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
            .setAudioAttributes(attributes)
            .setWillPauseWhenDucked(true)
            .setOnAudioFocusChangeListener { value -> focusChange(value)?.let(onChange) }
            .build()
        request = req
        return runCatching { am.requestAudioFocus(req) }.getOrDefault(AudioManager.AUDIOFOCUS_REQUEST_FAILED) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
    }

    @Synchronized
    override fun release() {
        val am = audio ?: return
        request?.let { runCatching { am.abandonAudioFocusRequest(it) } }
        request = null
    }

    public companion object {
        /** Speech attributes: assistant usage, speech content. */
        public fun speechAttributes(): AudioAttributes = AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_ASSISTANT)
            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
            .build()

        /** Android's AUDIOFOCUS_* value as a [FocusChange]; null for values the player ignores. */
        public fun focusChange(value: Int): FocusChange? = when (value) {
            AudioManager.AUDIOFOCUS_GAIN, AudioManager.AUDIOFOCUS_GAIN_TRANSIENT, AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK, AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_EXCLUSIVE -> FocusChange.GAIN
            AudioManager.AUDIOFOCUS_LOSS -> FocusChange.LOSS
            AudioManager.AUDIOFOCUS_LOSS_TRANSIENT -> FocusChange.LOSS_TRANSIENT
            AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK -> FocusChange.LOSS_TRANSIENT_CAN_DUCK
            else -> null
        }
    }
}
