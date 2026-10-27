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
import androidx.compose.runtime.getValue
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
import ai.amberx.axf.ui.components.AxfSwitch
import ai.amberx.axf.ui.components.AxfText
import ai.amberx.axf.ui.components.ButtonTone
import ai.amberx.axf.ui.rememberService
import ai.amberx.axf.ui.theme.Axf
import ai.amberx.axf.voice.ArmingDecision
import ai.amberx.axf.voice.AxfVoice
import ai.amberx.axf.voice.VoiceArming
import ai.amberx.axf.voice.VoiceModule
import ai.amberx.axf.voice.armedBy
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.onSubscription
import kotlinx.coroutines.launch
import java.time.LocalTime
import java.time.format.DateTimeFormatter

/**
 * Hands-free commands: engine results → sensitivity floor → VoiceArming (arming phrase + timeout, or always armed)
 * → VoiceCommands.match. "hey notes hello" arms and runs "hello" at once.
 */
@Composable
fun HandsFreeView() {
    val voice = rememberService<AxfVoice>() ?: run { AxfEmptyState("Voice isn't installed", icon = "mic"); return }
    val runtime = LocalAxfRuntime.current
    val scope = rememberCoroutineScope()
    val engine = remember(voice) { voice.engine() }
    val arming = remember(voice) { VoiceArming(voice.armingConfig()) }
    var alwaysArmed by remember { mutableStateOf(arming.config.alwaysArmed) }
    var job by remember { mutableStateOf<Job?>(null) }
    var status by remember { mutableStateOf("Not listening.") }
    var heard by remember { mutableStateOf(listOf<String>()) }
    DisposableEffect(Unit) { onDispose { job?.cancel() } }

    fun start() {
        job = scope.launch {
            if (!voice.ensureMic("The demo listens for your commands while this screen is open.")) { status = "Microphone permission is off."; job = null; return@launch }
            status = "Starting…"
            try {
                engine.results
                    .onSubscription { if (!engine.start(voice.engineOptions(partials = false))) status = "The engine didn't start (is the model installed?)." else status = if (arming.config.alwaysArmed) "Listening, always armed." else "Listening. Say \"${arming.config.phrases.first()}\" first." }
                    .armedBy(arming, voice.sensitivity)
                    .collect { d ->
                        when (d) {
                            is ArmingDecision.Armed -> status = "Armed: say a command."
                            is ArmingDecision.Pass -> {
                                val m = voice.commands.match(listOf(d.text))
                                val answer = when (m?.commandId) {
                                    AppModule.CMD_HELLO -> "Hello to you too."
                                    AppModule.CMD_TIME -> "It's ${LocalTime.now().format(DateTimeFormatter.ofPattern("HH:mm"))}."
                                    AppModule.CMD_CLEAR -> { heard = emptyList(); "Cleared." }
                                    else -> null
                                }
                                heard = listOf(if (m != null) "\"${d.text}\" → ${m.phrase} (${(m.score * 100).toInt()} %): $answer" else "\"${d.text}\" → no command") + heard.take(19)
                            }
                            ArmingDecision.Ignored -> {}
                        }
                    }
            } finally {
                engine.stop()
            }
        }
    }

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(Axf.space.two), verticalArrangement = Arrangement.spacedBy(Axf.space.two)) {
        AxfCard(Modifier.fillMaxWidth(), title = "What this shows", icon = "info") {
            AxfText("Commands only count after the arming phrase (${arming.config.phrases.joinToString(" / ") { "\"$it\"" }}); it stays armed ${arming.config.timeoutMs / 1000} s and every command restarts the timer. Try \"${arming.config.phrases.first()} what time is it\".")
            AxfText("Commands: hello · what time is it · clear the list. Change their phrases under Voice triggers.", muted = true)
        }

        AxfCard(Modifier.fillMaxWidth(), title = "Listen", icon = "mic") {
            AxfSwitch(alwaysArmed, { alwaysArmed = it; arming.config = arming.config.copy(alwaysArmed = it) }, Modifier.fillMaxWidth(), label = "Always armed", description = "No arming phrase needed (this screen only; the setting lives in Settings → Voice listening).")
            Row(horizontalArrangement = Arrangement.spacedBy(Axf.space.one)) {
                if (job == null) AxfButton("Start listening", { start() }, tone = ButtonTone.PRIMARY, icon = "mic")
                else AxfButton("Stop", { job?.cancel(); job = null; status = "Not listening." }, tone = ButtonTone.DANGER, icon = "x")
            }
            AxfText(status, color = Axf.colors.accent)
        }

        AxfCard(Modifier.fillMaxWidth(), title = "Heard", icon = "list") {
            if (heard.isEmpty()) AxfText("Nothing yet.", muted = true)
            heard.forEach { AxfText(it) }
        }

        Row(horizontalArrangement = Arrangement.spacedBy(Axf.space.one)) {
            AxfButton("Voice triggers", { runtime.navigate(VoiceModule.ROUTE) }, icon = "edit")
            AxfButton("Dictation", { runtime.navigate("home") }, tone = ButtonTone.GHOST, icon = "arrow-left")
        }
    }
}
