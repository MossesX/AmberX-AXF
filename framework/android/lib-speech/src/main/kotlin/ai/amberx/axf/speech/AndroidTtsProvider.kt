package ai.amberx.axf.speech

import ai.amberx.axf.kernel.result.AxfFailure
import ai.amberx.axf.kernel.result.AxfResult
import ai.amberx.axf.kernel.speech.SpeakOptions
import ai.amberx.axf.kernel.speech.SpeakOutcome
import ai.amberx.axf.kernel.speech.SpeechProvider
import ai.amberx.axf.kernel.speech.SpeechQueue
import ai.amberx.axf.kernel.speech.SpeechQueueEvent
import ai.amberx.axf.kernel.speech.SpeechVoice
import android.content.Context
import android.media.AudioAttributes
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import java.util.Locale
import kotlin.coroutines.resume

/**
 * speech@1 provider over Android's TextToSpeech (id `android-tts`). Starts the engine lazily (a failed or slow start
 * is forgotten so the next call tries again), applies voice / rate / pitch / language per utterance, and resolves
 * [speak] from the utterance callbacks (done, failed, stopped). [onEvent] sees every callback as a queue event.
 *
 * lib-voice's `Speaker` runs on this class, so Voice Vault's spoken prompts use the same engine.
 */
public class AndroidTtsProvider(
    context: Context,
    private val initTimeoutMs: Long = 4_000,
    /** an utterance that never reports back ends as failed after this long */
    private val maxUtteranceMs: Long = 10 * 60_000L,
    /** audio attributes for the speech stream (the same ones [AndroidAudioFocus] asks focus with) */
    private val attributes: AudioAttributes? = AndroidAudioFocus.speechAttributes(),
) : SpeechProvider {
    override val id: String = ID
    override val label: String = "Android text-to-speech"

    private val appContext: Context = context.applicationContext
    private val tracker = UtteranceTracker("axf-tts")
    private var tts: TextToSpeech? = null
    private var ready: CompletableDeferred<Boolean>? = null

    /** Every utterance callback, as `(utteranceId, event)`; called on the TTS binder thread. */
    @Volatile public var onEvent: ((String, SpeechQueueEvent) -> Unit)? = null

    private fun report(cb: UtteranceCallback) {
        val e = tracker.on(cb)
        onEvent?.invoke(cb.utteranceId, e)
    }

    private suspend fun engine(): TextToSpeech? = withContext(Dispatchers.Main) {
        val d = ready ?: CompletableDeferred<Boolean>().also { d ->
            ready = d
            tts = TextToSpeech(appContext) { status -> d.complete(status == TextToSpeech.SUCCESS) }.apply {
                attributes?.let { a -> runCatching { setAudioAttributes(a) } }
                setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                    override fun onStart(utteranceId: String?) { utteranceId?.let { report(UtteranceCallback.Start(it)) } }
                    override fun onDone(utteranceId: String?) { utteranceId?.let { report(UtteranceCallback.Done(it)) } }
                    @Deprecated("Deprecated in Java")
                    override fun onError(utteranceId: String?) { utteranceId?.let { report(UtteranceCallback.Error(it)) } }
                    override fun onError(utteranceId: String?, errorCode: Int) { utteranceId?.let { report(UtteranceCallback.Error(it, errorCode)) } }
                    override fun onStop(utteranceId: String?, interrupted: Boolean) { utteranceId?.let { report(UtteranceCallback.Stop(it, interrupted)) } }
                })
            }
        }
        if (withTimeoutOrNull(initTimeoutMs) { d.await() } == true) tts else {
            runCatching { tts?.shutdown() }
            tts = null
            ready = null
            null
        }
    }

    override suspend fun available(): Boolean = engine() != null

    override suspend fun speak(text: String, opts: SpeakOptions?): AxfResult<SpeakOutcome> {
        val e = engine() ?: return AxfResult.err(AxfFailure.Unavailable("Text-to-speech isn't available on this phone."))
        if (opts?.interrupt == true) stopNow()
        withContext(Dispatchers.Main) { apply(e, opts) }
        val uid = tracker.newId()
        val outcome = withTimeoutOrNull(maxUtteranceMs) {
            suspendCancellableCoroutine<SpeakOutcome> { cont ->
                tracker.await(uid) { o -> if (cont.isActive) cont.resume(o) }
                cont.invokeOnCancellation { tracker.cancel(uid); runCatching { e.stop() } }
                val queued = runCatching { e.speak(text, TextToSpeech.QUEUE_FLUSH, null, uid) }.getOrDefault(TextToSpeech.ERROR)
                if (queued != TextToSpeech.SUCCESS) tracker.finish(uid, SpeakOutcome.FAILED)
            }
        } ?: SpeakOutcome.FAILED
        return AxfResult.ok(outcome)
    }

    private fun apply(e: TextToSpeech, opts: SpeakOptions?) {
        val language = opts?.language?.takeIf { it.isNotBlank() && it != "system" }
        if (language != null) runCatching { e.language = Locale.forLanguageTag(language) }
        val voiceId = opts?.voice?.takeIf { it.isNotBlank() }
        if (voiceId != null) runCatching { e.voices?.firstOrNull { it.name == voiceId }?.let { v -> e.voice = v } }
        runCatching { e.setSpeechRate(SpeechQueue.clampRate(opts?.rate ?: SpeechQueue.RATE_DEFAULT).toFloat()) }
        runCatching { e.setPitch(SpeechSettings.clampPitch(opts?.pitch ?: SpeechSettings.PITCH_DEFAULT).toFloat()) }
    }

    override suspend fun stop() { stopNow() }

    /** Stops speaking now (any thread); waiting utterances end as stopped. */
    public fun stopNow() {
        runCatching { tts?.stop() }
        tracker.stopAll()
    }

    override suspend fun voices(): AxfResult<List<SpeechVoice>> {
        val e = engine() ?: return AxfResult.err(AxfFailure.Unavailable("Text-to-speech isn't available on this phone."))
        return withContext(Dispatchers.Main) {
            AxfResult.runCatching {
                (e.voices ?: emptySet()).filter { v -> !v.features.orEmpty().contains(TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED) }
                    .map { v -> SpeechVoice(v.name, voiceLabel(v.locale, v.name), v.locale.toLanguageTag(), if (v.isNetworkConnectionRequired) "network" else "local") }
                    .sortedWith(compareBy({ it.language }, { it.id }))
            }
        }
    }

    private fun voiceLabel(locale: Locale, name: String): String = "${locale.displayName} · $name"

    /** Frees the engine; the next call starts it again. */
    public fun shutdown() {
        tracker.stopAll()
        runCatching { tts?.stop(); tts?.shutdown() }
        tts = null
        ready = null
    }

    public companion object {
        public const val ID: String = "android-tts"
    }
}
