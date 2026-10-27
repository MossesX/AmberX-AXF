package ai.amberx.axf.axnotes.views

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import ai.amberx.axf.axnotes.capture.CaptureController
import ai.amberx.axf.axnotes.capture.CaptureState
import ai.amberx.axf.ui.LocalAxfRuntime
import ai.amberx.axf.ui.components.AxfButton
import ai.amberx.axf.ui.components.AxfCard
import ai.amberx.axf.ui.components.AxfChip
import ai.amberx.axf.ui.components.AxfEmptyState
import ai.amberx.axf.ui.components.AxfPageHead
import ai.amberx.axf.ui.components.AxfText
import ai.amberx.axf.ui.components.AxfTextField
import ai.amberx.axf.ui.components.ButtonTone
import ai.amberx.axf.ui.rememberService
import ai.amberx.axf.ui.theme.Axf

/**
 * Capture (route `capture`): the microphone, the note being dictated (continuous until “end note”), what AX Notes
 * answered, every phrase it knows (from the trigger data), and a typed box that goes through the same flow — the way
 * to use it before a speech engine is wired.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun CaptureView() {
    val c = rememberService<CaptureController>() ?: run { AxfEmptyState("Capture unavailable", icon = "mic"); return }
    val selection = rememberService<Selection>()
    val runtime = LocalAxfRuntime.current
    val state by c.state.collectAsState()
    val available by c.capture.available.collectAsState()
    val listening by c.capture.listening.collectAsState()
    val partial by c.capture.partial.collectAsState()
    val said by c.speaker.said.collectAsState()
    val log by c.log.collectAsState()
    var typed by remember { mutableStateOf("") }

    Column(Modifier.verticalScroll(rememberScrollState()).padding(Axf.space.two), verticalArrangement = Arrangement.spacedBy(Axf.space.two)) {
        AxfPageHead("Speak", eyebrow = "AX Notes", description = "Say “take a note”, talk, then “end note”. Or “note …” for a one-liner.")

        AxfCard(Modifier.fillMaxWidth(), title = "Microphone", icon = "mic") {
            if (!available) AxfText("No speech engine is connected yet. Type below what you would say; it runs exactly the same way.", muted = true)
            else if (listening) { AxfText("Listening…", color = Axf.colors.accent); if (partial.isNotBlank()) AxfText(partial) }
            FlowRow(horizontalArrangement = Arrangement.spacedBy(Axf.space.one)) {
                if (listening) AxfButton("Stop listening", { c.stopListening() }, icon = "pause")
                else AxfButton("Listen", { c.listen() }, tone = ButtonTone.PRIMARY, icon = "mic", enabled = available)
            }
            AxfTextField(typed, { typed = it }, Modifier.fillMaxWidth(), label = "Say it by typing", placeholder = "take a note", leadingIcon = "keyboard")
            AxfButton("Send", { c.heard(typed); typed = "" }, icon = "send", enabled = typed.isNotBlank())
        }

        AxfCard(Modifier.fillMaxWidth(), title = "Note", icon = "edit") {
            when (val s = state) {
                CaptureState.Idle -> AxfText("No note in progress.", muted = true)
                is CaptureState.Dictating -> {
                    AxfText("Dictating — say “end note” to save.", color = Axf.colors.accent)
                    AxfText(s.text.ifBlank { "…" })
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(Axf.space.one)) {
                        AxfButton("Done", { c.finishDictation() }, tone = ButtonTone.PRIMARY, icon = "check")
                        AxfButton("Discard", { c.cancelDictation() }, tone = ButtonTone.GHOST, icon = "x")
                    }
                }
                is CaptureState.Saved -> {
                    AxfText("Saved: ${s.note.title}", color = Axf.colors.success)
                    AxfButton("Edit or re-categorize", { selection?.editNote(s.note.id); runtime.navigate(Selection.ROUTE_EDITOR) }, icon = "edit")
                }
            }
            if (state !is CaptureState.Dictating) AxfButton("Take a note", { c.startDictation() }, icon = "mic")
        }

        said?.let { AxfCard(Modifier.fillMaxWidth(), title = "AX Notes said", icon = "info") { AxfText(it) } }

        AxfCard(Modifier.fillMaxWidth(), title = "What you can say", icon = "help") {
            for (group in c.triggers.groupBy { it.group }) {
                AxfText(if (group.key == "lists") "Lists and to-dos" else "Notes", style = Axf.type.labelLarge)
                FlowRow(horizontalArrangement = Arrangement.spacedBy(Axf.space.one), verticalArrangement = Arrangement.spacedBy(Axf.space.half)) {
                    group.value.forEach { t -> AxfChip("“${t.phrases.first().replace(Regex("\\{(\\w+)\\??}"), "…")}”", icon = "mic") }
                }
            }
        }

        if (log.isNotEmpty()) AxfCard(Modifier.fillMaxWidth(), title = "Heard", icon = "history") {
            log.takeLast(12).reversed().forEach { AxfText(it, muted = it.startsWith("‹"), style = Axf.type.bodySmall) }
        }
    }
}
