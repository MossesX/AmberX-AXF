package ai.amberx.axf.voice

import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlin.coroutines.resume

/** What one listen produced. */
public sealed interface Heard {
    /** Recognizer alternatives, most likely first (never empty). */
    public data class Text(val alternatives: List<String>) : Heard { public val best: String get() = alternatives.first() }
    /** Nothing understood, or silence. */
    public data object Silence : Heard
    /** Recognizer or permission problem; [code] is a [SpeechRecognizer] error code or -1. */
    public data class Failed(val code: Int, val message: String) : Heard
}

/** Options for one listen. */
public data class ListenOptions(
    val language: String? = null,
    /** Ask for on-device recognition. With [secret] on API 31+ the on-device recognizer is used when present. */
    val preferOffline: Boolean = true,
    /** Speech that should not leave the phone (passwords): on-device recognizer only, never partial results. */
    val secret: Boolean = false,
    /** Let [secret] speech fall back to the phone's normal (possibly online) recognizer when there is no on-device one. */
    val allowOnlineSecret: Boolean = false,
    val maxResults: Int = 5,
    /** Silence (ms) that ends the utterance; null = recognizer default. */
    val endSilenceMs: Long? = null,
)

/**
 * One-shot speech recognition as a suspend call. Always runs on the main thread (SpeechRecognizer's
 * rule), one listen at a time; cancelling the coroutine cancels the recognizer.
 */
public class SpeechInput(private val context: Context) {
    private val mutex = Mutex()
    private val _listening = MutableStateFlow(false)
    public val listening: StateFlow<Boolean> = _listening.asStateFlow()
    private val _level = MutableStateFlow(0f)
    /** Input level 0..1 while listening, for a mic animation. */
    public val level: StateFlow<Float> = _level.asStateFlow()

    public val available: Boolean get() = SpeechRecognizer.isRecognitionAvailable(context)

    /** True when this phone can recognise speech without the network (API 31+). */
    public val onDeviceAvailable: Boolean get() = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && SpeechRecognizer.isOnDeviceRecognitionAvailable(context)

    public suspend fun listen(options: ListenOptions = ListenOptions()): Heard = mutex.withLock {
        withContext(Dispatchers.Main) {
            if (!available) return@withContext Heard.Failed(-1, "Speech recognition isn't available on this phone.")
            if (options.secret && !onDeviceAvailable && !options.allowOnlineSecret) return@withContext Heard.Failed(NO_ON_DEVICE, "This phone has no on-device speech recognition, so secrets aren't spoken. Type it instead, or allow online recognition in Settings → Voice.")
            val recognizer = if (options.secret && onDeviceAvailable && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) SpeechRecognizer.createOnDeviceSpeechRecognizer(context)
                else SpeechRecognizer.createSpeechRecognizer(context)
            try {
                suspendCancellableCoroutine { cont ->
                    fun finish(h: Heard) { _listening.value = false; _level.value = 0f; if (cont.isActive) cont.resume(h) }
                    recognizer.setRecognitionListener(object : RecognitionListener {
                        override fun onReadyForSpeech(params: Bundle?) { _listening.value = true }
                        override fun onBeginningOfSpeech() {}
                        override fun onRmsChanged(rmsdB: Float) { _level.value = ((rmsdB + 2f) / 12f).coerceIn(0f, 1f) }
                        override fun onBufferReceived(buffer: ByteArray?) {}
                        override fun onEndOfSpeech() { _listening.value = false }
                        override fun onError(error: Int) {
                            if (error == SpeechRecognizer.ERROR_NO_MATCH || error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT) finish(Heard.Silence)
                            else finish(Heard.Failed(error, describe(error)))
                        }
                        override fun onResults(results: Bundle?) {
                            val list = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION).orEmpty().map { it.trim() }.filter { it.isNotEmpty() }
                            finish(if (list.isEmpty()) Heard.Silence else Heard.Text(list))
                        }
                        override fun onPartialResults(partialResults: Bundle?) {}
                        override fun onEvent(eventType: Int, params: Bundle?) {}
                    })
                    val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                        putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                        putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, options.maxResults)
                        putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, false)
                        putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, context.packageName)
                        if (options.preferOffline || options.secret) putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true)
                        options.language?.takeIf { it.isNotBlank() && it != "system" }?.let { putExtra(RecognizerIntent.EXTRA_LANGUAGE, it) }
                        options.endSilenceMs?.let { putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, it) }
                    }
                    cont.invokeOnCancellation { runCatching { recognizer.cancel() }; _listening.value = false; _level.value = 0f }
                    recognizer.startListening(intent)
                }
            } finally {
                runCatching { recognizer.destroy() }
            }
        }
    }

    public companion object {
        /** [Heard.Failed.code] when secret speech was refused because only an online recognizer exists. */
        public const val NO_ON_DEVICE: Int = -2
        public fun describe(code: Int): String = when (code) {
            SpeechRecognizer.ERROR_AUDIO -> "Microphone error."
            SpeechRecognizer.ERROR_CLIENT -> "Recognizer stopped."
            SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "Microphone permission is off."
            SpeechRecognizer.ERROR_NETWORK, SpeechRecognizer.ERROR_NETWORK_TIMEOUT -> "No network for speech recognition. Download an offline language in your phone's voice settings."
            SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> "Recognizer is busy; try again."
            SpeechRecognizer.ERROR_SERVER, SpeechRecognizer.ERROR_SERVER_DISCONNECTED -> "Speech service error."
            SpeechRecognizer.ERROR_LANGUAGE_NOT_SUPPORTED, SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE -> "That language isn't available for speech."
            SpeechRecognizer.ERROR_TOO_MANY_REQUESTS -> "Too many requests; wait a moment."
            else -> "Speech error ($code)."
        }
    }
}
