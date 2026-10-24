package ai.amberx.axf.voicevault.views

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
import androidx.compose.ui.Modifier
import androidx.lifecycle.compose.LifecycleResumeEffect
import ai.amberx.axf.hub.HubSignInView
import ai.amberx.axf.ui.LocalAxfRuntime
import ai.amberx.axf.ui.components.AxfButton
import ai.amberx.axf.ui.components.AxfCard
import ai.amberx.axf.ui.components.AxfChip
import ai.amberx.axf.ui.components.AxfEmptyState
import ai.amberx.axf.ui.components.AxfPageHead
import ai.amberx.axf.ui.components.AxfText
import ai.amberx.axf.ui.components.ButtonTone
import ai.amberx.axf.ui.rememberService
import ai.amberx.axf.ui.theme.Axf
import ai.amberx.axf.voicevault.notes.HubNotesState
import ai.amberx.axf.voicevault.notes.NoteStep
import ai.amberx.axf.voicevault.notes.NotesRules
import ai.amberx.axf.voicevault.notes.VoiceNotes

/**
 * Voice notes (route `voice-notes`): where the setup lives (axHub, signed in or not), the triggers and lists it read
 * from the console, the note in progress or the last one saved, and Take a note. The setup itself is edited in the
 * Dev Console (Settings → Plugins → Voice notes); this screen only shows it. Doesn't need the vault unlocked.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun VoiceNotesView() {
    val notes = rememberService<VoiceNotes>() ?: run { AxfEmptyState("Voice notes unavailable", icon = "mic"); return }
    val runtime = LocalAxfRuntime.current
    notes.hub // makes sure the client exists before following it
    val hub by notes.hubs.collectAsState()
    val state by (hub ?: notes.hub).state.collectAsState()
    val step by notes.step.collectAsState()
    LifecycleResumeEffect(Unit) { notes.refresh(); onPauseOrDispose { } }

    Column(Modifier.verticalScroll(rememberScrollState()).padding(Axf.space.two), verticalArrangement = Arrangement.spacedBy(Axf.space.two)) {
        AxfPageHead("Voice notes", eyebrow = "Voice Vault", description = "Say your start trigger, then the note, then the stop trigger. It asks which list to put it in and saves it to axHub. Set it up in the Dev Console under Settings → Plugins → Voice notes.")

        AxfCard(Modifier.fillMaxWidth(), title = "axHub", icon = "cloud") {
            when (val s = state) {
                is HubNotesState.Ready -> {
                    AxfText("Connected to ${notes.hubAddress}. ${s.lists.size} lists.")
                    if (!s.settings.enabled) AxfText("Voice notes are switched off in the console.", color = Axf.colors.warning)
                }
                is HubNotesState.SignedOut -> { AxfText(s.why, color = Axf.colors.warning); AxfButton("Sign in to axHub", { runtime.navigate(VoiceNotes.SIGN_IN_ROUTE) }, tone = ButtonTone.PRIMARY, icon = "user") }
                is HubNotesState.Unreachable -> AxfText(s.why, color = Axf.colors.warning)
                HubNotesState.Loading -> AxfText("Reading the setup from axHub…", muted = true)
                HubNotesState.Idle -> AxfText("Not read yet.", muted = true)
            }
            AxfText("Only the note's text, where it goes and your answers are sent to axHub. Nothing from the vault ever is, and no recording is kept.", muted = true, style = Axf.type.bodySmall)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(Axf.space.one)) {
                AxfButton("Read again", { notes.refresh() }, icon = "refresh")
                if (state is HubNotesState.Ready) AxfButton("Sign in again", { runtime.navigate(VoiceNotes.SIGN_IN_ROUTE) }, tone = ButtonTone.GHOST, icon = "user")
            }
        }

        val ready = state as? HubNotesState.Ready
        if (ready != null) {
            val s = ready.settings
            AxfCard(Modifier.fillMaxWidth(), title = "What you can say", icon = "mic") {
                Phrases("Start a note", s.startTriggers)
                Phrases("End the note", s.stopTriggers)
                Phrases("Hear the lists", s.listTriggers)
                Phrases("Back out", s.cancelTriggers)
                AxfText(if (notes.listenOn) "Heard in the background too while the app isn't on screen (screen off included)." else "Background listening for notes is off in Settings → Voice notes.", muted = true, style = Axf.type.bodySmall)
            }
            AxfCard(Modifier.fillMaxWidth(), title = "Lists", icon = "list") {
                if (ready.lists.isEmpty()) AxfText("No lists yet. Add them in the console.", muted = true)
                NotesRules.readLists(s, ready.lists).forEach { AxfText(it) }
            }
        }

        AxfCard(Modifier.fillMaxWidth(), title = "Note", icon = "edit") {
            when (val n = step) {
                NoteStep.Idle -> AxfText("No note taken yet.", muted = true)
                is NoteStep.Recording -> { AxfText("Listening… say your stop trigger to end it.", color = Axf.colors.accent); if (n.text.isNotBlank()) AxfText(n.text) }
                is NoteStep.Asking -> AxfText(n.prompt, color = Axf.colors.accent)
                NoteStep.Saving -> AxfText("Saving to axHub…", muted = true)
                is NoteStep.Saved -> { AxfText("Saved to ${n.where}.", color = Axf.colors.success); AxfText(n.text, muted = true) }
                is NoteStep.Stopped -> AxfText(n.why, color = Axf.colors.warning)
            }
            AxfButton("Take a note", { notes.takeNow() }, tone = ButtonTone.PRIMARY, icon = "mic", enabled = ready != null && !notes.busy)
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun Phrases(label: String, phrases: List<String>) {
    AxfText(label, style = Axf.type.labelLarge)
    FlowRow(horizontalArrangement = Arrangement.spacedBy(Axf.space.one), verticalArrangement = Arrangement.spacedBy(Axf.space.half)) {
        if (phrases.isEmpty()) AxfText("none set", muted = true)
        phrases.forEach { AxfChip("“$it”", icon = "mic") }
    }
}

/** Route `voice-notes-hub`: the hub's own sign-in page, locked to the hub (lib-hub); the session cookie stays in the WebView store (never backed up). */
@Composable
fun VoiceNotesSignInView() {
    val notes = rememberService<VoiceNotes>() ?: run { AxfEmptyState("Voice notes unavailable", icon = "mic"); return }
    val runtime = LocalAxfRuntime.current
    HubSignInView(notes.hubAddress, Modifier.fillMaxSize()) { notes.refresh(); runtime.navigate(VoiceNotes.ROUTE) }
}
