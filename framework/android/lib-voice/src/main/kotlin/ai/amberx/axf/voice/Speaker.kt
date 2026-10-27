package ai.amberx.axf.voice

import ai.amberx.axf.kernel.speech.SpeakOptions
import ai.amberx.axf.kernel.speech.SpeakOutcome
import ai.amberx.axf.kernel.speech.SpeechProvider
import ai.amberx.axf.speech.AndroidTtsProvider
import android.content.Context
import kotlinx.coroutines.withTimeoutOrNull

/**
 * Spoken prompts. [say] returns only after the phrase has finished, so a listen that follows never
 * hears the phone's own voice. Starts lazily; [shutdown] frees the engine.
 *
 * Since lib-voice 0.3.1 this runs on lib-speech's [AndroidTtsProvider] (speech@1): same API as before; [provider]
 * gives the speech@1 provider for code that wants the reading queue (lib-speech's SpeechPlayer).
 */
public class Speaker(private val context: Context) {
    private val tts: AndroidTtsProvider = AndroidTtsProvider(context)

    /** The speech@1 provider prompts are spoken with. */
    public val provider: SpeechProvider get() = tts

    /** Speaks [text] and waits until it is done (at most [maxMs]). Returns false when TTS isn't available. */
    public suspend fun say(text: String, language: String? = null, maxMs: Long = 12_000): Boolean {
        val opts = SpeakOptions(language = language?.takeIf { it.isNotBlank() && it != "system" })
        // a timeout cancels the utterance (the provider stops the engine), as before
        val result = withTimeoutOrNull(maxMs) { tts.speak(text, opts) } ?: return false
        val outcome = result.getOrNull() ?: return false
        return outcome != SpeakOutcome.FAILED
    }

    public fun stop() { tts.stopNow() }

    public fun shutdown() { tts.shutdown() }
}
