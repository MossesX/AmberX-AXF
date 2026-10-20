package ai.amberx.axf.voice

import android.content.Context
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import java.util.Locale
import java.util.concurrent.ConcurrentHashMap
import kotlin.coroutines.resume

/**
 * Spoken prompts. [say] returns only after the phrase has finished, so a listen that follows never
 * hears the phone's own voice. Starts lazily; [shutdown] frees the engine.
 */
public class Speaker(private val context: Context) {
    private var tts: TextToSpeech? = null
    private var ready: CompletableDeferred<Boolean>? = null
    private val waiting = ConcurrentHashMap<String, () -> Unit>()

    private suspend fun engine(): TextToSpeech? = withContext(Dispatchers.Main) {
        val d = ready ?: CompletableDeferred<Boolean>().also { d ->
            ready = d
            tts = TextToSpeech(context) { status -> d.complete(status == TextToSpeech.SUCCESS) }.apply {
                setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                    override fun onStart(utteranceId: String?) {}
                    override fun onDone(utteranceId: String?) { utteranceId?.let { waiting.remove(it)?.invoke() } }
                    @Deprecated("Deprecated in Java") override fun onError(utteranceId: String?) { utteranceId?.let { waiting.remove(it)?.invoke() } }
                    override fun onError(utteranceId: String?, errorCode: Int) { utteranceId?.let { waiting.remove(it)?.invoke() } }
                    override fun onStop(utteranceId: String?, interrupted: Boolean) { utteranceId?.let { waiting.remove(it)?.invoke() } }
                })
            }
        }
        if (withTimeoutOrNull(4_000) { d.await() } == true) tts else null
    }

    /** Speaks [text] and waits until it is done (at most [maxMs]). Returns false when TTS isn't available. */
    public suspend fun say(text: String, language: String? = null, maxMs: Long = 12_000): Boolean {
        val e = engine() ?: return false
        language?.takeIf { it.isNotBlank() && it != "system" }?.let { tag -> withContext(Dispatchers.Main) { e.language = Locale.forLanguageTag(tag) } }
        val id = "axf-${System.nanoTime()}"
        return withTimeoutOrNull(maxMs) {
            suspendCancellableCoroutine { cont ->
                waiting[id] = { if (cont.isActive) cont.resume(true) }
                cont.invokeOnCancellation { waiting.remove(id); runCatching { e.stop() } }
                if (e.speak(text, TextToSpeech.QUEUE_FLUSH, null, id) != TextToSpeech.SUCCESS) { waiting.remove(id); cont.resume(false) }
            }
        } ?: false
    }

    public fun stop() { runCatching { tts?.stop() } }

    public fun shutdown() {
        runCatching { tts?.stop(); tts?.shutdown() }
        tts = null; ready = null; waiting.clear()
    }
}
