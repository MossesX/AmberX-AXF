package ai.amberx.axf.demospeech.views

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import ai.amberx.axf.speech.AxfSpeech
import ai.amberx.axf.ui.LocalAxfRuntime
import ai.amberx.axf.ui.components.AxfButton
import ai.amberx.axf.ui.components.AxfCard
import ai.amberx.axf.ui.components.AxfEmptyState
import ai.amberx.axf.ui.components.AxfText
import ai.amberx.axf.ui.components.AxfTextField
import ai.amberx.axf.ui.components.ButtonTone
import ai.amberx.axf.ui.rememberService
import ai.amberx.axf.ui.theme.Axf
import kotlinx.coroutines.launch

/**
 * lib-speech demo: `read` (queued, only while Settings → Speech → Read aloud is on) vs `say` (now, always), the
 * SpeechPlayer's queue controls and live state, and the installed voices.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun HomeView() {
    val speech = rememberService<AxfSpeech>() ?: run { AxfEmptyState("Speech isn't installed", icon = "play"); return }
    val runtime = LocalAxfRuntime.current
    val scope = rememberCoroutineScope()
    val state by speech.player.state.collectAsState()
    var text by remember { mutableStateOf("AmberX speaks. This line was read by lib-speech.") }
    var note by remember { mutableStateOf("") }
    var voices by remember { mutableStateOf<String?>(null) }

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(Axf.space.two), verticalArrangement = Arrangement.spacedBy(Axf.space.two)) {
        AxfCard(Modifier.fillMaxWidth(), title = "What this shows", icon = "info") {
            AxfText("lib-speech is the speaking side of speech@1: Android text-to-speech behind a reading queue with spoken controls (pause, skip, faster…). Read queues text and respects the Read aloud setting; Say interrupts and always speaks.")
        }

        AxfCard(Modifier.fillMaxWidth(), title = "Speak", icon = "play") {
            AxfTextField(text, { text = it }, Modifier.fillMaxWidth(), label = "Text", singleLine = false, minLines = 2)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(Axf.space.one), verticalArrangement = Arrangement.spacedBy(Axf.space.one)) {
                AxfButton("Read", { note = if (speech.read(text) == null) "Read aloud is off (Settings → Speech), so nothing was queued." else "Queued." }, tone = ButtonTone.PRIMARY, icon = "play")
                AxfButton("Say now", { speech.say(text); note = "Said now (interrupts the queue)." }, icon = "zap")
                AxfButton("Queue three", {
                    val ids = SAMPLE.mapNotNull { speech.read(it) }
                    note = if (ids.isEmpty()) "Read aloud is off (Settings → Speech)." else "Queued ${ids.size} sentences: try Skip, Back, Faster."
                }, tone = ButtonTone.GHOST, icon = "list")
            }
            if (note.isNotEmpty()) AxfText(note, muted = true)
        }

        AxfCard(Modifier.fillMaxWidth(), title = "Player", icon = "sliders") {
            val position = if (state.items.isEmpty()) "Queue empty" else "Item ${(state.index + 1).coerceAtMost(state.items.size)} of ${state.items.size}"
            AxfText("$position · ${if (state.paused) "paused" else if (state.speaking) "speaking" else "idle"} · rate ${"%.2f".format(state.rate)}×", muted = true)
            state.current?.let { AxfText("“${it.text}”") }
            FlowRow(horizontalArrangement = Arrangement.spacedBy(Axf.space.one), verticalArrangement = Arrangement.spacedBy(Axf.space.one)) {
                if (state.paused) AxfButton("Resume", { speech.player.resume() }, tone = ButtonTone.PRIMARY, icon = "play")
                else AxfButton("Pause", { speech.player.pause() }, icon = "pause")
                AxfButton("Back", { speech.player.back() }, tone = ButtonTone.GHOST, icon = "arrow-left")
                AxfButton("Skip", { speech.player.skip() }, tone = ButtonTone.GHOST, icon = "arrow-right")
                AxfButton("Slower", { speech.player.slower() }, tone = ButtonTone.GHOST, icon = "minus")
                AxfButton("Faster", { speech.player.faster() }, tone = ButtonTone.GHOST, icon = "plus")
                AxfButton("Again", { speech.player.again() }, tone = ButtonTone.GHOST, icon = "redo")
                AxfButton("Stop", { speech.player.stop() }, tone = ButtonTone.DANGER, icon = "x")
            }
            AxfText("The same controls are spoken commands (speech.pause, speech.skip …) when an app runs a trigger host: see the triggers demo.", muted = true)
        }

        AxfCard(Modifier.fillMaxWidth(), title = "Voices", icon = "users") {
            AxfButton("List installed voices", {
                scope.launch {
                    val r = speech.voices()
                    voices = r.getOrNull()?.let { list -> if (list.isEmpty()) "No voices reported." else "${list.size} voice(s): " + list.take(8).joinToString(", ") { "${it.label} (${it.language}${it.kind?.let { k -> ", $k" } ?: ""})" } }
                        ?: "Couldn't list voices: ${r.failureOrNull()?.message}"
                }
            }, icon = "search")
            voices?.let { AxfText(it, muted = true) }
        }

        AxfButton("Speech settings", { runtime.navigate("settings") }, tone = ButtonTone.GHOST, icon = "settings")
    }
}

private val SAMPLE = listOf(
    "First sentence: the queue reads one item at a time.",
    "Second sentence: skip and back move through the queue.",
    "Third sentence: faster and slower change the rate for this session.",
)
