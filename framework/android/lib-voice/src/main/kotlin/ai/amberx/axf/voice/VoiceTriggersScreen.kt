package ai.amberx.axf.voice

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import ai.amberx.axf.ui.rememberService
import ai.amberx.axf.ui.components.AxfEmptyState
import ai.amberx.axf.ui.components.AxfPageHead
import ai.amberx.axf.ui.components.AxfText
import ai.amberx.axf.ui.components.ButtonTone
import ai.amberx.axf.ui.components.AxfBadge
import ai.amberx.axf.ui.components.AxfButton
import ai.amberx.axf.ui.components.AxfChip
import ai.amberx.axf.ui.components.AxfIconButton
import ai.amberx.axf.ui.components.AxfListItem
import ai.amberx.axf.ui.components.AxfSectionHeader
import ai.amberx.axf.ui.components.AxfTextField
import ai.amberx.axf.ui.components.AxfCard
import ai.amberx.axf.ui.theme.Axf
import kotlinx.coroutines.launch

/**
 * Settings → Voice triggers: every registered command with the phrases it answers to. Record a phrase
 * (pick from what the recognizer heard), type one, switch defaults off or back on, or reset.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
public fun VoiceTriggersScreen(modifier: Modifier = Modifier, title: String = "Voice triggers") {
    val voice = rememberService<AxfVoice>()
    if (voice == null) { AxfEmptyState("Voice unavailable", message = "VoiceModule is not installed.", icon = "mic"); return }
    val commands by voice.commands.commands.collectAsState()
    val version by voice.commands.version.collectAsState()
    val listening by voice.input.listening.collectAsState()
    val scope = rememberCoroutineScope()
    var recordingFor by remember { mutableStateOf<String?>(null) }
    val heardFor = remember { mutableStateMapOf<String, List<String>>() }
    val typed = remember { mutableStateMapOf<String, String>() }
    val notes = remember { mutableStateMapOf<String, String>() }

    fun record(id: String) {
        recordingFor = id; notes.remove(id); heardFor.remove(id)
        scope.launch {
            when (val h = voice.ask(null)) {
                is Heard.Text -> heardFor[id] = h.alternatives.map(PhraseMatcher::normalize).filter { it.isNotEmpty() }.distinct().take(4)
                Heard.Silence -> notes[id] = "Didn't catch that. Tap Record and speak clearly."
                is Heard.Failed -> notes[id] = h.message
            }
            recordingFor = null
        }
    }

    Column(modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(Axf.space.two), verticalArrangement = Arrangement.spacedBy(Axf.space.two)) {
        AxfPageHead(title, eyebrow = "Voice", description = "Each command answers to every phrase listed. Record your own, type one, or switch defaults off.")
        if (!voice.input.available) AxfText("Speech recognition isn't available on this phone. Install or enable a voice service (e.g. Speech Recognition & Synthesis) to use voice commands.", muted = true)
        if (commands.isEmpty()) AxfEmptyState("No voice commands", message = "Modules register commands with voice.commands.register(…).", icon = "mic")
        commands.groupBy { it.group }.forEach { (group, list) ->
            AxfSectionHeader(group, accent = true)
            list.forEach { c ->
                val p = remember(version, c) { voice.commands.phrases(c.id) } ?: return@forEach
                AxfCard(title = c.label, icon = "mic") {
                    c.description?.let { AxfText(it, muted = true) }
                    p.active.forEach { phrase ->
                        val isDefault = c.defaults.any { PhraseMatcher.normalize(it) == PhraseMatcher.normalize(phrase) }
                        AxfListItem("“$phrase”", subtitle = if (isDefault) "Default" else "Yours", icon = if (isDefault) "list" else "user", trailing = {
                            AxfIconButton("trash", "Remove \"$phrase\"", { voice.commands.removePhrase(c.id, phrase)?.let { notes[c.id] = it } })
                        })
                    }
                    if (p.offDefaults.isNotEmpty()) {
                        AxfText("Defaults switched off (tap to use again):", muted = true)
                        FlowRow(horizontalArrangement = Arrangement.spacedBy(Axf.space.one), verticalArrangement = Arrangement.spacedBy(Axf.space.one)) {
                            p.offDefaults.forEach { d -> AxfChip(d, icon = "plus", onClick = { voice.commands.addPhrase(c.id, d)?.let { notes[c.id] = it } }) }
                        }
                    }
                    heardFor[c.id]?.let { options ->
                        AxfText(if (options.isEmpty()) "Nothing usable heard." else "Heard — tap the right one to add it:", muted = true)
                        FlowRow(horizontalArrangement = Arrangement.spacedBy(Axf.space.one), verticalArrangement = Arrangement.spacedBy(Axf.space.one)) {
                            options.forEach { o -> AxfChip(o, icon = "check", selected = true, onClick = { voice.commands.addPhrase(c.id, o)?.let { notes[c.id] = it } ?: heardFor.remove(c.id) }) }
                        }
                    }
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Axf.space.one)) {
                        AxfTextField(typed[c.id] ?: "", { typed[c.id] = it }, Modifier.weight(1f), placeholder = "Type a phrase")
                        AxfIconButton("plus", "Add typed phrase", {
                            val err = voice.commands.addPhrase(c.id, typed[c.id] ?: "")
                            if (err == null) typed.remove(c.id) else notes[c.id] = err
                        })
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(Axf.space.one), verticalAlignment = Alignment.CenterVertically) {
                        val busy = recordingFor == c.id
                        AxfButton(if (busy) (if (listening) "Listening…" else "Starting…") else "Record", { if (recordingFor == null) record(c.id) }, tone = ButtonTone.PRIMARY, icon = "mic", enabled = recordingFor == null || busy)
                        AxfButton("Reset", { voice.commands.reset(c.id); notes.remove(c.id); heardFor.remove(c.id) }, tone = ButtonTone.GHOST, icon = "refresh")
                        if (p.custom.isNotEmpty()) AxfBadge("${p.custom.size} yours")
                    }
                    notes[c.id]?.let { AxfText(it, color = Axf.colors.warning) }
                }
            }
        }
        if (commands.isNotEmpty()) AxfButton("Reset all to defaults", { voice.commands.resetAll(); notes.clear(); heardFor.clear() }, tone = ButtonTone.DANGER, icon = "refresh")
    }
}
