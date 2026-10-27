package ai.amberx.axf.voice

import android.media.MediaRecorder
import android.media.audiofx.AcousticEchoCanceler
import android.media.audiofx.NoiseSuppressor

/**
 * Platform echo cancellation and noise suppression for one AudioRecord session, each used only when
 * the phone has it. Echo cancellation pairs with the VOICE_COMMUNICATION mic source ([sourceFor]),
 * which on most phones (Samsung included) subtracts the phone's own playback from the mic.
 */
public class MicEffects private constructor(private val aec: AcousticEchoCanceler?, private val ns: NoiseSuppressor?) {
    public val echoCancelActive: Boolean get() = aec?.enabled == true
    public val noiseSuppressionActive: Boolean get() = ns?.enabled == true

    public fun release() {
        runCatching { aec?.release() }
        runCatching { ns?.release() }
    }

    public companion object {
        public val echoCancelAvailable: Boolean get() = runCatching { AcousticEchoCanceler.isAvailable() }.getOrDefault(false)
        public val noiseSuppressionAvailable: Boolean get() = runCatching { NoiseSuppressor.isAvailable() }.getOrDefault(false)

        /** The mic source to open: VOICE_COMMUNICATION when echo cancellation is wanted, else VOICE_RECOGNITION. */
        public fun sourceFor(echoCancellation: Boolean): Int =
            if (echoCancellation) MediaRecorder.AudioSource.VOICE_COMMUNICATION else MediaRecorder.AudioSource.VOICE_RECOGNITION

        public fun attach(audioSessionId: Int, echoCancellation: Boolean, noiseSuppression: Boolean): MicEffects {
            val aec = if (echoCancellation && echoCancelAvailable) runCatching { AcousticEchoCanceler.create(audioSessionId)?.also { it.setEnabled(true) } }.getOrNull() else null
            val ns = if (noiseSuppression && noiseSuppressionAvailable) runCatching { NoiseSuppressor.create(audioSessionId)?.also { it.setEnabled(true) } }.getOrNull() else null
            return MicEffects(aec, ns)
        }
    }
}
