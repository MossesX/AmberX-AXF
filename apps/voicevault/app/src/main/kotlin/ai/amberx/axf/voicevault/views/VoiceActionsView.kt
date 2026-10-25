package ai.amberx.axf.voicevault.views

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
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
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import ai.amberx.axf.settings.SettingsEngine
import ai.amberx.axf.ui.LocalAxfRuntime
import ai.amberx.axf.ui.components.AxfButton
import ai.amberx.axf.ui.components.AxfCard
import ai.amberx.axf.ui.components.AxfChip
import ai.amberx.axf.ui.components.AxfEmptyState
import ai.amberx.axf.ui.components.AxfIconButton
import ai.amberx.axf.ui.components.AxfListItem
import ai.amberx.axf.ui.components.AxfPageHead
import ai.amberx.axf.ui.components.AxfSelectField
import ai.amberx.axf.ui.components.AxfSwitch
import ai.amberx.axf.ui.components.AxfText
import ai.amberx.axf.ui.components.AxfTextField
import ai.amberx.axf.ui.components.ButtonTone
import ai.amberx.axf.ui.components.SelectOption
import ai.amberx.axf.ui.rememberService
import ai.amberx.axf.ui.theme.Axf
import ai.amberx.axf.voice.AxfVoice
import ai.amberx.axf.voice.Heard
import ai.amberx.axf.voicevault.notes.VoiceNotes
import ai.amberx.axf.voicevault.vault.Cmd
import ai.amberx.axf.voicevault.voice.ActionKind
import ai.amberx.axf.voicevault.voice.CustomAction
import ai.amberx.axf.voicevault.voice.VoiceActionRules
import ai.amberx.axf.voicevault.voice.VoiceControl
import java.text.DateFormat
import java.util.Date
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonPrimitive

/**
 * Voice actions (vault must be unlocked): the microphone switch, every trigger on or off, your own voice actions
 * (record or type the words, pick what they do, in the app only or in the background too) and what it heard.
 */
@Composable
fun VoiceActionsView() {
    val control = rememberService<VoiceControl>() ?: run { AxfEmptyState("Voice control unavailable", icon = "mic"); return }
    val voice = rememberService<AxfVoice>()
    var editing by remember { mutableStateOf<CustomAction?>(null) }
    Column(Modifier.imePadding().verticalScroll(rememberScrollState()).padding(Axf.space.two), verticalArrangement = Arrangement.spacedBy(Axf.space.two)) {
        AxfPageHead("Voice actions", eyebrow = "Voice Vault", description = "Switch the microphone and each trigger on or off, and make your own voice actions. Everything here stays on this phone.")
        MicCard(control)
        TriggersCard(control, voice)
        val e = editing
        if (e != null) ActionEditor(control, voice, e) { editing = null }
        else ActionsCard(control) { editing = it }
        HeardCard(control)
    }
}

@Composable
private fun MicCard(control: VoiceControl) {
    val off by control.micOff.collectAsState()
    val runtime = LocalAxfRuntime.current
    AxfCard(Modifier.fillMaxWidth(), title = "Microphone", icon = "mic") {
        AxfSwitch(!off, { control.setMicOff(!it) }, label = "Microphone on",
            description = if (off) "Off: Voice Vault doesn't listen at all, here or in the background. Type your unlock code meanwhile." else "On: listens on the Voice screen, and in the background for the triggers switched on below.")
        AxfText("Quiet hours (background only): ${control.quietSummary()}", muted = true, style = Axf.type.bodySmall)
        AxfButton("Quiet hours and more", { runtime.navigate("settings") }, tone = ButtonTone.GHOST, icon = "clock")
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun TriggersCard(control: VoiceControl, voice: AxfVoice?) {
    val off by control.off.collectAsState()
    val settings = rememberService<SettingsEngine>()
    val values by (settings?.values ?: remember { kotlinx.coroutines.flow.MutableStateFlow<Map<String, kotlinx.serialization.json.JsonElement>>(emptyMap()) }).collectAsState()
    val scope = rememberCoroutineScope()
    val runtime = LocalAxfRuntime.current
    val version by (voice?.commands?.version ?: remember { kotlinx.coroutines.flow.MutableStateFlow(0) }).collectAsState()
    AxfCard(Modifier.fillMaxWidth(), title = "Triggers", icon = "bell") {
        AxfText("A trigger that's off isn't listened for. Confirm and cancel always stay on, so a step can always be left by voice.", muted = true, style = Axf.type.bodySmall)
        val phrasesVersion = version // re-read the words whenever they change on the triggers screen
        for (id in listOf(Cmd.WAKE, Cmd.STORE, Cmd.RETRIEVE, Cmd.LOCK, Cmd.CONFIRM, Cmd.CANCEL)) {
            val p = voice?.commands?.phrases(id) ?: continue
            val always = id in VoiceActionRules.ALWAYS_ON
            AxfSwitch(always || VoiceActionRules.isOn(id, off), { control.setOn(id, it) }, label = p.command.label,
                description = p.active.take(3).joinToString(", ") { "“$it”" }.ifEmpty { "No words set" } + if (always) " · always on" else "", enabled = !always)
        }
        val notesOn = (values[VoiceNotes.KEY_LISTEN] as? JsonPrimitive)?.content?.toBooleanStrictOrNull() ?: settings?.bool(VoiceNotes.KEY_LISTEN, true) ?: true
        AxfSwitch(notesOn, { on -> scope.launch { settings?.set(VoiceNotes.KEY_LISTEN, JsonPrimitive(on)) } }, label = "Voice notes", description = "Your start triggers from the Dev Console's Voice notes setup", enabled = settings != null)
        AxfButton("Change the words", { runtime.navigate("voice-triggers") }, tone = ButtonTone.GHOST, icon = "edit")
    }
}

@Composable
private fun ActionsCard(control: VoiceControl, onEdit: (CustomAction) -> Unit) {
    val actions by control.actions.collectAsState()
    val off by control.off.collectAsState()
    AxfCard(Modifier.fillMaxWidth(), title = "Your voice actions", icon = "mic") {
        if (actions.isEmpty()) AxfText("None yet. Make one: say the words, pick what it does.", muted = true)
        for (a in actions) {
            val on = a.on && VoiceActionRules.isOn(a.commandId, off)
            AxfListItem(a.label, subtitle = a.phrases.joinToString(", ") { "“$it”" } + " · " + VoiceActionRules.describe(a, control::routeLabel, control::actionLabel) + if (a.background) " · in the background too" else "",
                icon = if (a.background) "bell" else "mic", onClick = { onEdit(a) }) {
                AxfSwitch(on, { control.setOn(a.commandId, it) })
                AxfIconButton("trash", "Delete ${a.label}", { control.remove(a.id) })
            }
        }
        if (actions.size < VoiceActionRules.MAX_ACTIONS) AxfButton("New voice action", { onEdit(control.newAction()) }, icon = "plus")
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ActionEditor(control: VoiceControl, voice: AxfVoice?, start: CustomAction, onDone: () -> Unit) {
    val scope = rememberCoroutineScope()
    var a by remember(start.id) { mutableStateOf(start) }
    var typed by remember(start.id) { mutableStateOf("") }
    var recording by remember { mutableStateOf(false) }
    var heardOptions by remember { mutableStateOf<List<String>>(emptyList()) }
    var error by remember { mutableStateOf<String?>(null) }
    fun addPhrase(p: String) {
        val n = VoiceActionRules.normalizePhrase(p)
        if (n.isEmpty() || n in a.phrases) return
        if (a.phrases.size >= VoiceActionRules.MAX_PHRASES) { error = "Up to ${VoiceActionRules.MAX_PHRASES} phrases."; return }
        a = a.copy(phrases = a.phrases + n, label = a.label.ifBlank { n.replaceFirstChar { it.uppercase() } }); error = null
    }
    AxfCard(Modifier.fillMaxWidth(), title = if (control.byCommand(start.commandId) == null) "New voice action" else "Edit ${start.label}", icon = "edit") {
        AxfTextField(a.label, { a = a.copy(label = it.take(VoiceActionRules.MAX_LABEL)) }, Modifier.fillMaxWidth(), label = "Name", placeholder = "Open my notes")
        AxfText("Words that start it", style = Axf.type.labelLarge)
        if (a.phrases.isEmpty()) AxfText("Record them or type them. Two words or more, so a stray word doesn't set it off.", muted = true, style = Axf.type.bodySmall)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(Axf.space.one), verticalArrangement = Arrangement.spacedBy(Axf.space.half)) {
            a.phrases.forEach { p -> AxfChip("“$p” ✕", icon = "mic", onClick = { a = a.copy(phrases = a.phrases - p) }) }
        }
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Axf.space.one)) {
            AxfTextField(typed, { typed = it }, Modifier.weight(1f), placeholder = "Type a phrase")
            AxfButton("Add", { addPhrase(typed); typed = "" }, enabled = typed.isNotBlank(), icon = "plus")
        }
        if (voice != null) {
            AxfButton(if (recording) "Listening…" else "Record a phrase", {
                if (recording || control.micOff.value) { if (control.micOff.value) error = "The microphone is off. Turn it on above, or type the phrase."; return@AxfButton }
                recording = true; heardOptions = emptyList(); error = null
                scope.launch {
                    when (val h = voice.ask(null)) {
                        is Heard.Text -> { val opts = h.alternatives.map(VoiceActionRules::normalizePhrase).filter { it.isNotEmpty() }.distinct().take(3); if (opts.size == 1) addPhrase(opts.first()) else heardOptions = opts }
                        is Heard.Failed -> error = h.message
                        else -> error = "Didn't hear anything. Try again, or type it."
                    }
                    recording = false
                }
            }, icon = "mic", enabled = !recording)
            if (heardOptions.isNotEmpty()) {
                AxfText("Which did you say?", style = Axf.type.labelMedium)
                FlowRow(horizontalArrangement = Arrangement.spacedBy(Axf.space.one), verticalArrangement = Arrangement.spacedBy(Axf.space.half)) {
                    heardOptions.forEach { o -> AxfChip("“$o”", onClick = { addPhrase(o); heardOptions = emptyList() }) }
                }
            }
        }
        AxfSelectField("What it does", a.kind.id, ActionKind.entries.map { SelectOption(it.id, it.label) }, { id ->
            val k = ActionKind.of(id) ?: return@AxfSelectField
            a = a.copy(kind = k, arg = when (k) { ActionKind.OPEN -> "vault"; else -> "" }, background = a.background && k != ActionKind.RUN)
        }, Modifier.fillMaxWidth(), hint = a.kind.hint)
        when (a.kind) {
            ActionKind.OPEN -> AxfSelectField("Screen", a.arg, VoiceControl.ROUTES.map { (id, label) -> SelectOption(id, label.replaceFirstChar { it.uppercase() }) }, { a = a.copy(arg = it) }, Modifier.fillMaxWidth())
            ActionKind.RUN -> {
                val opts = remember { control.runnableActions() }
                AxfSelectField("Action", a.arg, opts.map { (id, label) -> SelectOption(id, label) }, { a = a.copy(arg = it) }, Modifier.fillMaxWidth(), empty = "Pick an action")
            }
            else -> a.kind.arg?.let { label -> AxfTextField(a.arg, { a = a.copy(arg = it.take(VoiceActionRules.MAX_ARG)) }, Modifier.fillMaxWidth(), label = label) }
        }
        AxfSwitch(a.background, { a = a.copy(background = it) }, label = "In the background too",
            description = when {
                a.kind == ActionKind.RUN -> "App actions only run while the app is open."
                a.kind.needsVault -> "Heard with the app closed (screen off too), it opens Voice Vault and runs once you unlock."
                else -> "Heard with the app closed (screen off too). Off = only on the Voice screen while unlocked."
            }, enabled = a.kind != ActionKind.RUN)
        error?.let { AxfText(it, color = Axf.colors.danger) }
        Row(horizontalArrangement = Arrangement.spacedBy(Axf.space.one)) {
            AxfButton("Save", { error = control.save(a); if (error == null) onDone() }, icon = "check")
            AxfButton("Cancel", onDone, tone = ButtonTone.GHOST, icon = "x")
            if (control.byCommand(start.commandId) != null) AxfButton("Try it", { scope.launch { control.runInApp(a) } }, tone = ButtonTone.GHOST, icon = "play")
        }
    }
}

@Composable
private fun HeardCard(control: VoiceControl) {
    val log by control.log.collectAsState()
    AxfCard(Modifier.fillMaxWidth(), title = "What it heard", icon = "eye") {
        if (!control.logOn) AxfText("Off in Settings → Voice Vault → Keep a heard list.", muted = true)
        else if (log.isEmpty()) AxfText("Nothing yet. Each trigger that matches shows here (only the trigger, never anything else you said).", muted = true)
        val fmt = remember { DateFormat.getTimeInstance(DateFormat.SHORT) }
        log.take(20).forEach { e -> AxfListItem(e.what, subtitle = "“${e.phrase}” · ${if (e.where == "background") "in the background" else "in the app"} · ${fmt.format(Date(e.at))}", icon = if (e.where == "background") "bell" else "mic") }
        if (log.isNotEmpty()) AxfButton("Clear", { control.clearLog() }, tone = ButtonTone.GHOST, icon = "trash")
    }
}
