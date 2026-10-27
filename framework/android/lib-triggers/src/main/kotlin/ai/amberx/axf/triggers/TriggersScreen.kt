package ai.amberx.axf.triggers

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
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
import ai.amberx.axf.kernel.result.AxfResult
import ai.amberx.axf.kernel.triggers.Thresholds
import ai.amberx.axf.kernel.triggers.Trigger
import ai.amberx.axf.kernel.triggers.TriggerKindStatus
import ai.amberx.axf.kernel.triggers.TriggerKinds
import ai.amberx.axf.ui.components.AxfBadge
import ai.amberx.axf.ui.components.AxfButton
import ai.amberx.axf.ui.components.AxfChip
import ai.amberx.axf.ui.components.AxfChoiceGrid
import ai.amberx.axf.ui.components.AxfDivider
import ai.amberx.axf.ui.components.AxfEmptyState
import ai.amberx.axf.ui.components.AxfIconButton
import ai.amberx.axf.ui.components.AxfListItem
import ai.amberx.axf.ui.components.AxfPageHead
import ai.amberx.axf.ui.components.AxfSectionHeader
import ai.amberx.axf.ui.components.AxfSlider
import ai.amberx.axf.ui.components.AxfSwitch
import ai.amberx.axf.ui.components.AxfText
import ai.amberx.axf.ui.components.AxfTextField
import ai.amberx.axf.ui.components.ButtonTone
import ai.amberx.axf.ui.components.Choice
import ai.amberx.axf.ui.rememberService
import ai.amberx.axf.ui.theme.Axf
import ai.amberx.axf.voice.AxfVoice
import ai.amberx.axf.voice.Heard
import ai.amberx.axf.voice.PhraseMatcher
import kotlinx.coroutines.launch

/*
 * Trigger screens (route `triggers`). Dense, single column, tokens only (Axf.space / Axf.colors / Axf.type and the
 * kit components; no literal colours or sizes). One composable switches between the list, the editor and the
 * add-trigger flow (kind → phrases → action → details).
 */

private sealed interface TriggersView {
    data object Overview : TriggersView
    data object Add : TriggersView
    data class Edit(val id: String) : TriggersView
}

/** The whole trigger UI on the `axf.triggers.store` service. */
@Composable
public fun TriggersScreen(modifier: Modifier = Modifier, title: String = "Triggers") {
    val triggers = rememberService<AxfTriggers>()
    if (triggers == null) { AxfEmptyState("Triggers unavailable", modifier, message = "TriggersModule is not installed.", icon = "zap"); return }
    var view by remember { mutableStateOf<TriggersView>(TriggersView.Overview) }
    when (val v = view) {
        TriggersView.Overview -> TriggerList(triggers, modifier, title, onAdd = { view = TriggersView.Add }, onOpen = { view = TriggersView.Edit(it) })
        TriggersView.Add -> AddTriggerFlow(triggers, modifier, onDone = { view = TriggersView.Overview })
        is TriggersView.Edit -> TriggerEditor(triggers, v.id, modifier, onBack = { view = TriggersView.Overview })
    }
}

/** Icon for a trigger kind (open set: unknown kinds get the generic one). */
public fun triggerKindIcon(kind: String): String = when (kind) {
    TriggerKinds.VOICE -> "mic"
    TriggerKinds.FACE -> "user"
    TriggerKinds.GESTURE -> "sparkles"
    else -> "zap"
}

/** "“note <text>” · “add note” → New note · 80 % · Anywhere" */
public fun triggerSummary(t: Trigger, actionLabel: String?, contexts: List<TriggerContext>): String {
    val phrases = t.phrases.take(2).joinToString(", ") { "“$it”" } + if (t.phrases.size > 2) " +${t.phrases.size - 2}" else ""
    val where = if (t.worksIn.isEmpty() || Thresholds.ANY_CONTEXT in t.worksIn) "Anywhere" else t.worksIn.joinToString(", ") { id -> contexts.firstOrNull { it.id == id }?.label ?: id }
    return "$phrases → ${actionLabel ?: t.action} · ${formatThreshold(t.threshold)} · $where"
}

/** 80.0 → "80 %", 72.5 → "72.5 %". */
public fun formatThreshold(t: Double): String = (if (t == Math.floor(t)) t.toLong().toString() else t.toString()) + " %"

/** Dense single-column list: permanent first, then custom; a switch per row, tap a row to edit it. */
@Composable
public fun TriggerList(triggers: AxfTriggers, modifier: Modifier = Modifier, title: String = "Triggers", onAdd: () -> Unit, onOpen: (String) -> Unit) {
    val list by triggers.store.list.collectAsState()
    val contexts by triggers.contexts.collectAsState()
    val catalog = remember(list) { triggers.catalog() }
    var error by remember { mutableStateOf<String?>(null) }
    Column(modifier.fillMaxSize().padding(horizontal = Axf.space.two)) {
        AxfPageHead(title, eyebrow = "Triggers", description = "Phrases and gestures that run an action.", actions = {
            AxfButton("Add", onAdd, tone = ButtonTone.PRIMARY, icon = "plus")
        })
        error?.let { AxfText(it, color = Axf.colors.danger) }
        LazyColumn(Modifier.fillMaxWidth().weight(1f)) {
            val (perm, custom) = list.partition { it.permanent }
            item { AxfSectionHeader("Permanent", accent = true) }
            if (perm.isEmpty()) item { AxfText("No module has registered triggers.", muted = true) }
            items(perm, key = { "p:" + it.id }) { s -> TriggerRow(s, catalog, contexts, onOpen) { on -> error = (triggers.store.setEnabled(s.id, on) as? AxfResult.Err)?.failure?.message } }
            item { AxfSectionHeader("Custom", accent = true) }
            if (custom.isEmpty()) item { AxfText("No custom triggers yet. Tap Add.", muted = true) }
            items(custom, key = { "c:" + it.id }) { s -> TriggerRow(s, catalog, contexts, onOpen) { on -> error = (triggers.store.setEnabled(s.id, on) as? AxfResult.Err)?.failure?.message } }
        }
    }
}

@Composable
private fun TriggerRow(s: StoredTrigger, catalog: TriggerActionCatalog, contexts: List<TriggerContext>, onOpen: (String) -> Unit, onToggle: (Boolean) -> Unit) {
    val t = s.trigger
    val action = catalog.find(t.action, t.args)?.label
    AxfListItem(t.label, subtitle = triggerSummary(t, action, contexts), icon = triggerKindIcon(t.kind), onClick = { onOpen(t.id) }, trailing = {
        if (s.overridden) AxfBadge("edited", tone = "info")
        if (s.canDisable) AxfSwitch(t.enabled, onToggle) else AxfBadge("locked", tone = "accent")
    })
    AxfDivider()
}

/** Threshold editor: a 1–99 % slider plus an exact field (0.01–99.99). */
@Composable
public fun ThresholdEditor(value: Double, onChange: (Double) -> Unit, modifier: Modifier = Modifier) {
    var text by remember(value) { mutableStateOf(formatThreshold(value).removeSuffix(" %")) }
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Axf.space.half)) {
        AxfSlider("Fires at", value.toFloat().coerceIn(1f, 99f), { onChange(Thresholds.clamp(it.toDouble())) }, min = 1f, max = 99f, step = 1f, unit = "%")
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Axf.space.one)) {
            AxfTextField(text, { text = it }, Modifier.weight(1f), label = "Exact (${Thresholds.MIN}–${Thresholds.MAX} %)")
            AxfIconButton("check", "Apply exact threshold", { text.trim().toDoubleOrNull()?.let { onChange(Thresholds.clamp(it)) } })
        }
        AxfText("A match fires when the input's confidence is at least this.", muted = true, style = Axf.type.bodySmall)
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun WorksInChips(selected: List<String>, contexts: List<TriggerContext>, onChange: (List<String>) -> Unit) {
    val anywhere = selected.isEmpty() || Thresholds.ANY_CONTEXT in selected
    FlowRow(horizontalArrangement = Arrangement.spacedBy(Axf.space.half), verticalArrangement = Arrangement.spacedBy(Axf.space.half)) {
        contexts.forEach { c ->
            val isAny = c.id == Thresholds.ANY_CONTEXT
            val on = if (isAny) anywhere else !anywhere && c.id in selected
            AxfChip(c.label, selected = on, onClick = {
                onChange(when {
                    isAny -> emptyList()
                    on -> selected.filter { it != c.id }
                    else -> selected.filter { it != Thresholds.ANY_CONTEXT } + c.id
                })
            })
        }
    }
}

/** One trigger: enabled, threshold, works-in; reset (permanent, when edited) or delete (custom). */
@Composable
public fun TriggerEditor(triggers: AxfTriggers, id: String, modifier: Modifier = Modifier, onBack: () -> Unit) {
    val list by triggers.store.list.collectAsState()
    val contexts by triggers.contexts.collectAsState()
    val s = list.firstOrNull { it.id == id }
    if (s == null) { AxfEmptyState("Trigger not found", modifier, icon = "zap", action = { AxfButton("Back", onBack, icon = "arrow-left") }); return }
    val t = s.trigger
    val catalog = remember(list) { triggers.catalog() }
    var error by remember { mutableStateOf<String?>(null) }
    fun report(r: AxfResult<Trigger>) { error = (r as? AxfResult.Err)?.failure?.message }
    Column(modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(Axf.space.two), verticalArrangement = Arrangement.spacedBy(Axf.space.one)) {
        AxfPageHead(t.label, eyebrow = if (s.permanent) "Permanent trigger · ${t.module}" else "Custom trigger", actions = {
            AxfIconButton("arrow-left", "Back", onBack)
        })
        AxfListItem("“${t.phrases.joinToString("”, “")}”", subtitle = "→ ${catalog.find(t.action, t.args)?.label ?: t.action}", icon = triggerKindIcon(t.kind))
        if (s.canDisable) AxfSwitch(t.enabled, { report(triggers.store.setEnabled(id, it)) }, label = "Enabled")
        else AxfText("This trigger is always on (its module locked it).", muted = true)
        AxfSectionHeader("Detection")
        ThresholdEditor(t.threshold, { report(triggers.store.setThreshold(id, it)) })
        AxfSectionHeader("Works in")
        WorksInChips(t.worksIn, contexts) { report(triggers.store.setWorksIn(id, it)) }
        error?.let { AxfText(it, color = Axf.colors.danger) }
        Row(horizontalArrangement = Arrangement.spacedBy(Axf.space.one)) {
            if (s.permanent && s.overridden) AxfButton("Reset to module values", { triggers.store.reset(id) }, tone = ButtonTone.GHOST, icon = "refresh")
            if (s.canDelete) AxfButton("Delete", { if (triggers.store.removeCustom(id)) onBack() }, tone = ButtonTone.DANGER, icon = "trash")
        }
    }
}

/** Add-trigger flow: kind → phrase(s) → action (dense picker) → details (label, threshold, works in) → save. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
public fun AddTriggerFlow(triggers: AxfTriggers, modifier: Modifier = Modifier, onDone: () -> Unit) {
    var draft by remember { mutableStateOf(TriggerDraft()) }
    var step by remember { mutableStateOf(AddTriggerStep.KIND) }
    var error by remember { mutableStateOf<String?>(null) }
    val contexts by triggers.contexts.collectAsState()
    val catalog = remember { triggers.catalog() }
    fun go(to: AddTriggerStep) { error = null; step = to }

    Column(modifier.fillMaxSize().padding(horizontal = Axf.space.two), verticalArrangement = Arrangement.spacedBy(Axf.space.one)) {
        AxfPageHead("New trigger", eyebrow = "Step ${step.ordinal + 1} of ${AddTriggerStep.entries.size} · ${step.label}", actions = {
            AxfIconButton("x", "Cancel", onDone)
        })
        Row(horizontalArrangement = Arrangement.spacedBy(Axf.space.half)) {
            AddTriggerStep.entries.forEach { s ->
                val reachable = s.ordinal <= step.ordinal || AddTriggerStep.entries.take(s.ordinal).all { draft.ready(it) }
                AxfChip(s.label, selected = s == step, onClick = if (reachable) ({ go(s) }) else null)
            }
        }
        Column(Modifier.fillMaxWidth().weight(1f)) {
            when (step) {
                AddTriggerStep.KIND -> KindStep(draft) { draft = draft.copy(kind = it, phrases = emptyList()) }
                AddTriggerStep.PHRASES -> PhrasesStep(draft) { draft = it }
                AddTriggerStep.ACTION -> TriggerActionPicker(catalog, draft.action?.key, { draft = draft.copy(action = it); go(AddTriggerStep.DETAILS) }, Modifier.fillMaxSize())
                AddTriggerStep.DETAILS -> Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(Axf.space.one)) {
                    AxfTextField(draft.label, { draft = draft.copy(label = it) }, Modifier.fillMaxWidth(), label = "Label", placeholder = draft.effectiveLabel())
                    AxfListItem(draft.phrases.joinToString(", ") { "“$it”" }, subtitle = "→ ${draft.action?.label ?: "no action"}", icon = triggerKindIcon(draft.kind), onClick = { go(AddTriggerStep.ACTION) })
                    AxfSectionHeader("Detection")
                    ThresholdEditor(draft.threshold, { draft = draft.copy(threshold = it) })
                    AxfSectionHeader("Works in")
                    WorksInChips(draft.worksIn, contexts) { draft = draft.copy(worksIn = it) }
                }
            }
        }
        error?.let { AxfText(it, color = Axf.colors.danger) }
        Row(Modifier.fillMaxWidth().padding(vertical = Axf.space.one), horizontalArrangement = Arrangement.spacedBy(Axf.space.one)) {
            if (step != AddTriggerStep.KIND) AxfButton("Back", { go(AddTriggerStep.entries[step.ordinal - 1]) }, tone = ButtonTone.GHOST, icon = "arrow-left")
            if (step != AddTriggerStep.DETAILS) {
                if (step != AddTriggerStep.ACTION) AxfButton("Next", { go(AddTriggerStep.entries[step.ordinal + 1]) }, tone = ButtonTone.PRIMARY, icon = "arrow-right", enabled = draft.ready(step))
            } else {
                AxfButton("Save trigger", {
                    val check = draft.build(triggers.store.newCustomId(draft.effectiveLabel()))
                    val t = check.trigger
                    val r = t?.let { triggers.store.saveCustom(it) }
                    val problem = when {
                        t == null -> check.errors.joinToString("; ")
                        r is AxfResult.Err -> r.failure.message
                        else -> null
                    }
                    error = problem
                    if (problem == null) onDone()
                }, tone = ButtonTone.PRIMARY, icon = "save", enabled = draft.ready(AddTriggerStep.DETAILS))
            }
        }
    }
}

@Composable
private fun KindStep(draft: TriggerDraft, onPick: (String) -> Unit) {
    val choices = TriggerKinds.all().map { k ->
        Choice(k.id, k.label, k.note, triggerKindIcon(k.id), tag = if (k.status == TriggerKindStatus.PLACEHOLDER) "detector not built" else null)
    }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(Axf.space.one)) {
        AxfText("What kind of input fires it?", muted = true)
        AxfChoiceGrid(choices, setOf(draft.kind), onPick)
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun PhrasesStep(draft: TriggerDraft, onChange: (TriggerDraft) -> Unit) {
    var typed by remember { mutableStateOf("") }
    var heard by remember { mutableStateOf<List<String>>(emptyList()) }
    var note by remember { mutableStateOf<String?>(null) }
    var recording by remember { mutableStateOf(false) }
    val voice = rememberService<AxfVoice>()
    val scope = rememberCoroutineScope()
    val err = if (typed.isBlank()) null else draft.phraseError(typed).takeIf { it.isNotEmpty() }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(Axf.space.one)) {
        AxfText(if (draft.spoken) "Phrases it answers to. Slots capture words: note <text>, set volume to <value:number>, jump to <at:time>." else "Signature ids the detector reports (e.g. nod, open-palm).", muted = true)
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Axf.space.one)) {
            AxfTextField(typed, { typed = it }, Modifier.weight(1f), placeholder = if (draft.spoken) "Type a phrase" else "Signature id", error = err)
            AxfIconButton("plus", "Add phrase", { if (draft.phraseError(typed).isEmpty()) { onChange(draft.addPhrase(typed)); typed = "" } }, enabled = typed.isNotBlank() && err == null)
        }
        if (draft.kind == TriggerKinds.VOICE && voice != null) {
            AxfButton(if (recording) "Listening…" else "Record a phrase", {
                recording = true; note = null; heard = emptyList()
                scope.launch {
                    when (val h = voice.ask(null)) {
                        is Heard.Text -> heard = h.alternatives.map(PhraseMatcher::normalize).filter { it.isNotEmpty() }.distinct().take(4)
                        Heard.Silence -> note = "Didn't catch that."
                        is Heard.Failed -> note = h.message
                    }
                    recording = false
                }
            }, icon = "mic", enabled = !recording)
            if (heard.isNotEmpty()) FlowRow(horizontalArrangement = Arrangement.spacedBy(Axf.space.half), verticalArrangement = Arrangement.spacedBy(Axf.space.half)) {
                heard.forEach { h -> AxfChip(h, icon = "plus", onClick = { onChange(draft.addPhrase(h)); heard = heard - h }) }
            }
            note?.let { AxfText(it, color = Axf.colors.warning) }
        }
        draft.phrases.forEach { p ->
            AxfListItem("“$p”", icon = triggerKindIcon(draft.kind), trailing = { AxfIconButton("trash", "Remove \"$p\"", { onChange(draft.removePhrase(p)) }) })
        }
    }
}

/**
 * Dense action picker. The search bar is pinned at the top (outside the scrolling list) and filters live across ALL
 * tabs; while filtering, every row shows the tab it comes from. Without a query, the tab chips pick what is listed.
 */
@Composable
public fun TriggerActionPicker(catalog: TriggerActionCatalog, selectedKey: String?, onPick: (TriggerActionChoice) -> Unit, modifier: Modifier = Modifier) {
    var query by remember { mutableStateOf("") }
    val tabs = remember(catalog) { catalog.tabs() }
    var tab by remember(catalog) { mutableStateOf(catalog.choices.firstOrNull { it.key == selectedKey }?.tab ?: tabs.firstOrNull()?.id) }
    val filtering = query.isNotBlank()
    val hits = remember(catalog, query) { catalog.search(query) }
    val rows: List<Pair<TriggerActionChoice, String?>> = if (filtering) hits.map { it.choice to it.tabLabel } else (tab?.let(catalog::inTab) ?: emptyList()).map { it to null }
    Column(modifier) {
        AxfTextField(query, { query = it }, Modifier.fillMaxWidth(), placeholder = "Search all actions", leadingIcon = "search")
        Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(vertical = Axf.space.half), horizontalArrangement = Arrangement.spacedBy(Axf.space.half)) {
            tabs.forEach { t -> AxfChip("${t.label} ${t.count}", selected = !filtering && t.id == tab, onClick = { query = ""; tab = t.id }) }
        }
        if (filtering) AxfText("${hits.size} match${if (hits.size == 1) "" else "es"} across all tabs", muted = true, style = Axf.type.bodySmall)
        if (rows.isEmpty()) AxfText(if (filtering) "No action matches \"$query\"." else "No actions in this tab.", muted = true)
        LazyColumn(Modifier.fillMaxWidth().weight(1f)) {
            items(rows, key = { it.first.key }) { (c, tabLabel) ->
                AxfListItem(c.label, subtitle = c.detail, icon = c.icon, selected = c.key == selectedKey, onClick = { onPick(c) }, trailing = {
                    if (tabLabel != null) AxfBadge(tabLabel, tone = "info")
                })
            }
        }
    }
}
