package ai.amberx.axf.demovoice.views

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import ai.amberx.axf.demovoice.AppModule
import ai.amberx.axf.ui.LocalAxfRuntime
import ai.amberx.axf.ui.components.AxfButton
import ai.amberx.axf.ui.components.AxfCard
import ai.amberx.axf.ui.components.AxfEmptyState
import ai.amberx.axf.ui.components.AxfSlider
import ai.amberx.axf.ui.components.AxfText
import ai.amberx.axf.ui.components.ButtonTone
import ai.amberx.axf.ui.rememberService
import ai.amberx.axf.ui.theme.Axf
import ai.amberx.axf.voice.AxfVoice
import ai.amberx.axf.voice.DictationEndReason
import ai.amberx.axf.voice.DictationEvent
import ai.amberx.axf.voice.VoiceEngineState
import ai.amberx.axf.voice.VoiceSensitivity
import ai.amberx.axf.voice.dictate
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch

/**
 * Dictation (lib-voice 0.3): the user's engine (Vosk by default) listens across pauses until the stop phrase,
 * with the sensitivity slider deciding which final utterances are kept.
 */
@Composable
fun HomeView() {
    val voice = rememberService<AxfVoice>() ?: run { AxfEmptyState("Voice isn't installed", icon = "mic"); return }
    val runtime = LocalAxfRuntime.current
    val scope = rememberCoroutineScope()
    val engine = remember(voice) { voice.engine() }
    val engineState by engine.state.collectAsState()
    var sensitivity by remember { mutableFloatStateOf(voice.sensitivity) }
    var job by remember { mutableStateOf<Job?>(null) }
    var preview by remember { mutableStateOf("") }
    var transcript by remember { mutableStateOf("") }
    var segments by remember { mutableStateOf(listOf<String>()) }
    var dropped by remember { mutableIntStateOf(0) }
    var ended by remember { mutableStateOf<String?>(null) }
    DisposableEffect(Unit) { onDispose { job?.cancel() } }

    fun start() {
        preview = ""; transcript = ""; segments = emptyList(); dropped = 0; ended = null
        job = scope.launch {
            if (!voice.ensureMic("The demo listens while you dictate.")) { ended = "Microphone permission is off."; job = null; return@launch }
            engine.dictate(voice.engineOptions().copy(sensitivity = sensitivity), voice.endPhrases).collect { e ->
                when (e) {
                    is DictationEvent.Partial -> preview = e.preview
                    is DictationEvent.Segment -> { transcript = e.transcript; preview = e.transcript; segments = segments + "${e.text}  (${(e.confidence * 100).toInt()} %)" }
                    is DictationEvent.Dropped -> dropped++
                    is DictationEvent.Ended -> { transcript = e.transcript; ended = if (e.reason == DictationEndReason.END_PHRASE) "Stopped by \"${e.endPhrase}\"." else (e.message ?: "Stopped.") }
                }
            }
            job = null
        }
    }

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(Axf.space.two), verticalArrangement = Arrangement.spacedBy(Axf.space.two)) {
        AxfCard(Modifier.fillMaxWidth(), title = "What this shows", icon = "info") {
            AxfText("lib-voice's continuous engine runs on the phone (Vosk). Dictation keeps listening across pauses and stops when you say a stop phrase: ${voice.endPhrases.joinToString(" or ") { "\"$it\"" }}. Hands-free commands are on the next screen.")
        }

        AxfCard(Modifier.fillMaxWidth(), title = "Engine", icon = "settings") {
            AxfText("${engine.kind.label} · ${if (engine.available) "model installed" else "no model in the APK"}", muted = true)
            AxfText(when (val s = engineState) {
                VoiceEngineState.Idle -> "Idle"
                VoiceEngineState.Loading -> "Loading the model…"
                VoiceEngineState.Listening -> "Listening"
                is VoiceEngineState.Failed -> "Failed: ${s.message}"
            })
            AxfSlider("Sensitivity", sensitivity * 100f, { sensitivity = it / 100f }, Modifier.fillMaxWidth(), min = 5f, max = 95f, step = 5f, unit = "%", enabled = job == null)
            AxfText("Keeps final utterances scored at least ${(VoiceSensitivity.confidenceFloor(sensitivity) * 100).toInt()} % (higher sensitivity = lower floor).", muted = true)
        }

        AxfCard(Modifier.fillMaxWidth(), title = "Dictation", icon = "edit") {
            Row(horizontalArrangement = Arrangement.spacedBy(Axf.space.one)) {
                if (job == null) AxfButton("Start dictating", { start() }, tone = ButtonTone.PRIMARY, icon = "mic")
                else AxfButton("Stop", { job?.cancel(); job = null }, tone = ButtonTone.DANGER, icon = "x")
            }
            if (preview.isNotEmpty()) AxfText(preview, style = Axf.type.code)
            segments.forEach { AxfText("• $it", muted = true) }
            if (dropped > 0) AxfText("$dropped utterance(s) dropped below the sensitivity floor.", muted = true)
            ended?.let { AxfText(it, color = Axf.colors.accent) }
            if (transcript.isNotEmpty() && job == null) AxfText("Transcript: $transcript")
        }

        Row(horizontalArrangement = Arrangement.spacedBy(Axf.space.one)) {
            AxfButton("Hands-free commands", { runtime.navigate(AppModule.HANDS_FREE_ROUTE) }, icon = "arrow-right")
            AxfButton("Listening settings", { runtime.navigate("settings") }, tone = ButtonTone.GHOST, icon = "sliders")
        }
    }
}
