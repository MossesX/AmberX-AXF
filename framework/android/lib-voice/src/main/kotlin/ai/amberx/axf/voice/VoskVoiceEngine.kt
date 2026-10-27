package ai.amberx.axf.voice

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.media.AudioFormat
import android.media.AudioRecord
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import org.json.JSONObject
import org.vosk.LibVosk
import org.vosk.LogLevel
import org.vosk.Model
import org.vosk.Recognizer
import org.vosk.android.StorageService
import java.io.File
import kotlin.concurrent.thread
import kotlin.coroutines.resume

/**
 * Where the Vosk model comes from. By default the app ships it in `src/main/assets/<assetDir>` (with
 * the `uuid` file Vosk's StorageService uses to know when the unpacked copy is stale; see the README
 * for the Gradle task that fetches it) and it is unpacked once into the app's files dir. Set [path] to
 * load an already unpacked model folder instead (e.g. one the app downloaded).
 */
public data class VoskModelSource(
    val assetDir: String = "model-en-us",
    val unpackDir: String = "model",
    val path: String? = null,
)

/**
 * The default [VoiceEngine]: Vosk, on-device and open source (no account or key), running continuously
 * on a 16 kHz mono AudioRecord in 100 ms frames. Final results carry the mean word confidence; partial
 * results are emitted as they change. Echo cancellation and noise suppression come from [MicEffects].
 *
 * Ported and generalised from Brett's ActiveX app (VoiceDetector + the mic loop of its detection
 * service); command matching moved out to [VoiceArming] / [VoiceCommands] and dictation to [dictate].
 * The engine listens only while started: an app that wants it while in the background runs it from
 * its own microphone foreground service.
 */
public class VoskVoiceEngine(
    context: Context,
    private val source: VoskModelSource = VoskModelSource(),
) : VoiceEngine {
    private val context: Context = context.applicationContext
    override val kind: VoiceEngineKind = VoiceEngineKind.VOSK
    override val available: Boolean
        get() = source.path?.let { File(it).isDirectory } ?: runCatching { context.assets.list(source.assetDir)?.isNotEmpty() == true }.getOrDefault(false)

    private val _state = MutableStateFlow<VoiceEngineState>(VoiceEngineState.Idle)
    override val state: StateFlow<VoiceEngineState> = _state.asStateFlow()
    private val _results = MutableSharedFlow<VoiceResult>(extraBufferCapacity = 64, onBufferOverflow = BufferOverflow.DROP_OLDEST)
    override val results: SharedFlow<VoiceResult> = _results.asSharedFlow()
    override val echoCancelActive: Boolean get() = current?.effects?.echoCancelActive == true

    private val modelLock = Mutex()
    @Volatile private var model: Model? = null
    @Volatile private var current: Session? = null
    @Volatile private var closed = false

    init { runCatching { LibVosk.setLogLevel(LogLevel.WARNINGS) } }

    @SuppressLint("MissingPermission") // checked just below
    override suspend fun start(options: VoiceEngineOptions): Boolean {
        val previous = current
        stop()
        if (previous != null) withContext(Dispatchers.IO) { runCatching { previous.worker?.join(JOIN_MS) } }
        if (closed) return fail("The voice engine was closed.")
        if (context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) return fail("Microphone permission is off.")
        _state.value = VoiceEngineState.Loading
        val m = loadModel() ?: return fail("The Vosk speech model isn't installed (assets/${source.assetDir}).")
        val recognizer = runCatching { Recognizer(m, SAMPLE_RATE.toFloat()).also { it.setWords(true) } }.getOrNull()
            ?: return fail("The Vosk recognizer didn't start.")
        val minBuf = AudioRecord.getMinBufferSize(SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
        val record = runCatching {
            AudioRecord(MicEffects.sourceFor(options.echoCancellation), SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, maxOf(minBuf, SAMPLE_RATE / 2))
        }.getOrNull()
        if (record == null || record.state != AudioRecord.STATE_INITIALIZED) {
            runCatching { record?.release() }
            runCatching { recognizer.close() }
            return fail("The microphone didn't open (is another app using it?).")
        }
        val effects = MicEffects.attach(record.audioSessionId, options.echoCancellation, options.noiseSuppression)
        val session = Session(recognizer, record, effects, options.partials)
        current = session
        runCatching { record.startRecording() }.onFailure {
            current = null
            session.cleanup()
            return fail("The microphone didn't start.")
        }
        _state.value = VoiceEngineState.Listening
        session.worker = thread(name = "axf-voice-vosk") { session.loop() }
        return true
    }

    override fun stop() {
        val s = current ?: return
        current = null
        s.running = false
        if (_state.value !is VoiceEngineState.Failed) _state.value = VoiceEngineState.Idle
    }

    override fun close() {
        closed = true
        val s = current
        stop()
        runCatching { s?.worker?.join(JOIN_MS) }
        runCatching { model?.close() }
        model = null
    }

    private fun fail(message: String): Boolean {
        _state.value = VoiceEngineState.Failed(message)
        return false
    }

    private suspend fun loadModel(): Model? = modelLock.withLock {
        model ?: run {
            val path = source.path
            val loaded = if (path != null) withContext(Dispatchers.IO) { runCatching { Model(path) }.getOrNull() }
                else suspendCancellableCoroutine<Model?> { cont ->
                    StorageService.unpack(context, source.assetDir, source.unpackDir,
                        { m -> if (cont.isActive) cont.resume(m) },
                        { _ -> if (cont.isActive) cont.resume(null) })
                }
            model = loaded
            loaded
        }
    }

    private inner class Session(val recognizer: Recognizer, val record: AudioRecord, val effects: MicEffects, val partials: Boolean) {
        @Volatile var running: Boolean = true
        @Volatile var worker: Thread? = null

        fun loop() {
            val buf = ShortArray(SAMPLE_RATE / 10) // 100 ms frames
            var lastPartial = ""
            try {
                while (running) {
                    val n = record.read(buf, 0, buf.size)
                    if (n < 0) { if (running && current === this) fail("The microphone stopped (error $n)."); break }
                    if (n == 0) continue
                    val isFinal = try { recognizer.acceptWaveForm(buf, n) } catch (e: Exception) { false }
                    if (!running) break
                    if (isFinal) {
                        lastPartial = ""
                        parseFinal(recognizer.result)?.let { _results.tryEmit(it) }
                    } else if (partials) {
                        val p = parsePartial(recognizer.partialResult)
                        if (p.isNotEmpty() && p != lastPartial) {
                            lastPartial = p
                            _results.tryEmit(VoiceResult(p, VoiceResult.UNSCORED, final = false, atMs = System.currentTimeMillis()))
                        }
                    }
                }
            } finally {
                cleanup()
            }
        }

        fun cleanup() {
            runCatching { record.stop() }
            runCatching { record.release() }
            effects.release()
            runCatching { recognizer.close() }
        }
    }

    public companion object {
        public const val SAMPLE_RATE: Int = 16_000
        private const val JOIN_MS: Long = 500L

        /** Vosk final JSON → result; confidence = mean word `conf` (1.0 when the model gives no words). Null for empty text. */
        internal fun parseFinal(json: String?): VoiceResult? {
            if (json.isNullOrBlank()) return null
            val obj = runCatching { JSONObject(json) }.getOrNull() ?: return null
            val text = obj.optString("text").trim()
            if (text.isEmpty()) return null
            val words = obj.optJSONArray("result")
            val conf = if (words != null && words.length() > 0) (0 until words.length()).map { words.getJSONObject(it).optDouble("conf", 1.0) }.average().toFloat() else 1f
            return VoiceResult(text, conf.coerceIn(0f, 1f), final = true, atMs = System.currentTimeMillis())
        }

        internal fun parsePartial(json: String?): String =
            if (json.isNullOrBlank()) "" else runCatching { JSONObject(json).optString("partial").trim() }.getOrDefault("")
    }
}
