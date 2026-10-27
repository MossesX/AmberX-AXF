package ai.amberx.axf.speech

import ai.amberx.axf.kernel.result.AxfFailure
import ai.amberx.axf.kernel.result.AxfResult
import ai.amberx.axf.kernel.speech.SpeakOptions
import ai.amberx.axf.kernel.speech.SpeakOutcome
import ai.amberx.axf.kernel.speech.SpeechProvider
import ai.amberx.axf.kernel.speech.SpeechVoice

/**
 * Typed placeholder for high-quality voices (neural / cloud TTS: `axf.speech.hq`). Not built: it never pretends to
 * work — [available] is false, [speak] fails with NotImplemented. A real provider implements [SpeechProvider] and
 * registers under [CAPABILITY]; [SpeechModule] takes it through its `provider` factory.
 */
public object HqSpeechProvider : SpeechProvider {
    public const val CAPABILITY: String = "axf.speech.hq"
    override val id: String = "hq"
    override val label: String = "High-quality voices (not built)"
    override suspend fun available(): Boolean = false
    override suspend fun speak(text: String, opts: SpeakOptions?): AxfResult<SpeakOutcome> = AxfResult.err(AxfFailure.NotImplemented(CAPABILITY))
    override suspend fun stop() {}
    override suspend fun voices(): AxfResult<List<SpeechVoice>> = AxfResult.err(AxfFailure.NotImplemented(CAPABILITY))
}
