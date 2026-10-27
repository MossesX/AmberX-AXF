package ai.amberx.axf.demotriggers.views

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
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import ai.amberx.axf.demotriggers.AppModule
import ai.amberx.axf.triggers.AxfTriggers
import ai.amberx.axf.triggers.TriggerLogEntry
import ai.amberx.axf.triggers.TriggerRun
import ai.amberx.axf.triggers.TriggersModule
import ai.amberx.axf.ui.LocalAxfRuntime
import ai.amberx.axf.ui.components.AxfButton
import ai.amberx.axf.ui.components.AxfCard
import ai.amberx.axf.ui.components.AxfEmptyState
import ai.amberx.axf.ui.components.AxfText
import ai.amberx.axf.ui.components.AxfTextField
import ai.amberx.axf.ui.components.ButtonTone
import ai.amberx.axf.ui.rememberService
import ai.amberx.axf.ui.theme.Axf
import ai.amberx.axf.voice.AxfVoice
import ai.amberx.axf.voice.VoiceResult
import kotlinx.coroutines.Job
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch

/**
 * Voice + triggers + speech in one walkthrough: lib-voice hears a phrase → lib-triggers' VoiceTriggerBridge matches it
 * against the trigger store → AxfTriggers.run puts the action on the bus → the action answers through lib-speech.
 * "Type it instead" feeds the same bridge by hand (VoiceTriggerBridge.process), so it works without a microphone.
 */
@Composable
fun HomeView() {
    val triggers = rememberService<AxfTriggers>()
    val voice = rememberService<AxfVoice>()
    if (triggers == null || voice == null) { AxfEmptyState("Triggers or voice isn't installed", icon = "zap"); return }
    val runtime = LocalAxfRuntime.current
    val scope = rememberCoroutineScope()
    val engine = remember(voice) { voice.engine() }
    // The bridge logs from the engine's thread: a StateFlow keeps that safe for Compose.
    val log = remember { MutableStateFlow(listOf<String>()) }
    val lines by log.collectAsState()
    val said by AppModule.said.collectAsState()
    val bridge = remember(triggers) { triggers.voiceBridge(context = { AppModule.CONTEXT }, log = { e -> log.value = (listOf(describe(e)) + log.value).take(20) }) }
    var job by remember { mutableStateOf<Job?>(null) }
    var status by remember { mutableStateOf("Not listening.") }
    var typed by remember { mutableStateOf("hello there") }
    var lastRun by remember { mutableStateOf("") }

    // Step 2 → 3: every fired command runs (action bus or setting write); the actions speak.
    LaunchedEffect(bridge) {
        bridge?.commands?.collect { cmd ->
            lastRun = when (val r = triggers.run(cmd)) {
                is TriggerRun.Action -> "Ran ${cmd.action} (\"${cmd.heard ?: cmd.phrase ?: ""}\")"
                is TriggerRun.Setting -> "Changed setting ${r.write.key}"
                is TriggerRun.NoHost -> "No handler for ${r.action}"
            }
        }
    }
    DisposableEffect(Unit) { onDispose { job?.cancel() } }

    fun start() {
        val b = bridge ?: return
        job = scope.launch {
            if (!voice.ensureMic("The walkthrough listens for your trigger phrases.")) { status = "Microphone permission is off."; job = null; return@launch }
            b.start(this)
            try {
                status = if (engine.start(voice.engineOptions(partials = false))) "Listening. Say \"hello there\"." else "The engine didn't start (is the model installed?)."
                awaitCancellation()
            } finally {
                b.stop(); engine.stop()
            }
        }
    }

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(Axf.space.two), verticalArrangement = Arrangement.spacedBy(Axf.space.two)) {
        AxfCard(Modifier.fillMaxWidth(), title = "What this shows", icon = "info") {
            AxfText("1. lib-voice hears a phrase.  2. lib-triggers matches it to a trigger (confidence, threshold, context, cooldown).  3. The trigger's action runs and the app answers out loud with lib-speech.")
            AxfText("Try: \"hello there\", \"what time is it\", \"count up\", or \"toggle reading\" (flips Settings → Speech → Read aloud).", muted = true)
        }

        AxfCard(Modifier.fillMaxWidth(), title = "1 · Say it", icon = "mic") {
            Row(horizontalArrangement = Arrangement.spacedBy(Axf.space.one)) {
                if (job == null) AxfButton("Start listening", { start() }, tone = ButtonTone.PRIMARY, icon = "mic", enabled = bridge != null)
                else AxfButton("Stop", { job?.cancel(); job = null; status = "Not listening." }, tone = ButtonTone.DANGER, icon = "x")
            }
            AxfText(status, muted = true)
            AxfTextField(typed, { typed = it }, Modifier.fillMaxWidth(), label = "…or type it instead")
            AxfButton("Send as if heard", { bridge?.process(VoiceResult(typed.trim(), 0.95f, final = true)) }, icon = "send", enabled = bridge != null && typed.isNotBlank())
        }

        AxfCard(Modifier.fillMaxWidth(), title = "2 · Trigger decisions", icon = "zap") {
            if (lines.isEmpty()) AxfText("Nothing heard yet.", muted = true)
            lines.forEach { AxfText(it, style = Axf.type.code) }
        }

        AxfCard(Modifier.fillMaxWidth(), title = "3 · The app speaks", icon = "play") {
            AxfText(lastRun.ifEmpty { "No trigger has fired yet." }, muted = true)
            if (said.isNotEmpty()) AxfText("“$said”", style = Axf.type.titleMedium)
        }

        Row(horizontalArrangement = Arrangement.spacedBy(Axf.space.one)) {
            AxfButton("Edit triggers", { runtime.navigate(TriggersModule.ROUTE) }, icon = "edit")
            AxfButton("Settings", { runtime.navigate("settings") }, tone = ButtonTone.GHOST, icon = "settings")
        }
    }
}

/** One log line: what was heard, why it was dropped, or each trigger's decision and what fired. */
private fun describe(e: TriggerLogEntry): String {
    val heard = e.heard.firstOrNull() ?: ""
    val head = "\"$heard\" ${e.inputConfidence.toInt()} %"
    e.dropped?.let { return "$head → dropped (${it.id})" }
    val decisions = e.decisions.joinToString("; ") { "${it.triggerId} ${it.outcome.id} ${it.confidence.toInt()} %" }
    return "$head → ${e.fired?.let { "fired ${it.action}" } ?: "no trigger fired"}${if (decisions.isNotEmpty()) " [$decisions]" else ""}"
}
