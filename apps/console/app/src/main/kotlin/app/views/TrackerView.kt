package ai.amberx.axf.console.views

import ai.amberx.axf.console.Status
import ai.amberx.axf.console.TrackerItem
import ai.amberx.axf.ui.LocalAxfActions
import ai.amberx.axf.ui.components.AxfButton
import ai.amberx.axf.ui.components.AxfCard
import ai.amberx.axf.ui.components.AxfChip
import ai.amberx.axf.ui.components.AxfEmptyState
import ai.amberx.axf.ui.components.AxfListItem
import ai.amberx.axf.ui.components.AxfPageHead
import ai.amberx.axf.ui.components.AxfSectionHeader
import ai.amberx.axf.ui.components.AxfText
import ai.amberx.axf.ui.components.AxfTextField
import ai.amberx.axf.ui.components.axfContextMenu
import ai.amberx.axf.ui.theme.Axf
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

/** What's built, what's not — every tracked item with its status, wave, module; tap to cycle status (saved locally). */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun TrackerView() {
    val repo = rememberRepo() ?: return AxfEmptyState("Console data missing")
    val actions = LocalAxfActions.current
    val tracker by repo.tracker.collectAsState()
    val overrides by repo.overrides.collectAsState()
    var tab by remember { mutableStateOf("kernel") }
    var status by remember { mutableStateOf<Status?>(null) }
    var wave by remember { mutableStateOf<Int?>(null) }
    var q by remember { mutableStateOf("") }
    var expanded by remember { mutableStateOf<String?>(null) }
    val rows = tracker.items.filter { it.tab == tab && it.parent == null && (status == null || repo.status(it.id) == status) && (wave == null || it.wave == wave) && (q.isBlank() || it.title.contains(q, true) || it.id.contains(q, true) || (it.module?.contains(q, true) == true)) }
    LazyColumn(Modifier.fillMaxWidth(), contentPadding = PaddingValues(Axf.space.two), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        item { AxfPageHead("Tracker", eyebrow = "${tracker.items.count { it.parent == null }} items · ${overrides.size} local edits", description = "Tap an item to see details; long-press or use the chips to change its status. Edits stay on this device until exported.", actions = {
            AxfButton("Export status.json", { actions.dispatch("console.exportStatus") }, icon = "copy")
            AxfButton("Sync to GitHub", { actions.dispatch("console.syncGithub") }, icon = "github", requires = "dev.deploy")
        }) }
        item { AxfTextField(q, { q = it }, Modifier.fillMaxWidth(), placeholder = "Filter…", leadingIcon = "search") }
        item { FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) { for ((id, label) in listOf("foundations" to "Foundations", "kernel" to "Kernel", "console" to "Console", "modules" to "Modules", "demos" to "Demos")) AxfChip(label, selected = tab == id, onClick = { tab = id }) } }
        item { FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            AxfChip("any status", selected = status == null, onClick = { status = null }); for (s in Status.entries) AxfChip(s.label(), tone = s.tone(), selected = status == s, onClick = { status = if (status == s) null else s })
            AxfChip("any wave", selected = wave == null, onClick = { wave = null }); for (w in 1..3) AxfChip("wave $w", selected = wave == w, onClick = { wave = if (wave == w) null else w })
        } }
        val groups = rows.groupBy { it.group }
        for ((g, items) in groups) {
            item(key = "g-$g") { AxfSectionHeader(g.replace('-', ' ') + " · ${items.size}", accent = true) }
            for (it0 in items) item(key = it0.id) { TrackerRow(it0, repo.status(it0.id), expanded == it0.id, { expanded = if (expanded == it0.id) null else it0.id }, { repo.setStatus(it0.id, it) }, tracker.items.filter { it.parent == it0.id }, repo::status) }
        }
        if (rows.isEmpty()) item { AxfEmptyState("Nothing matches") }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun TrackerRow(item: TrackerItem, status: Status, open: Boolean, onToggle: () -> Unit, onStatus: (Status) -> Unit, children: List<TrackerItem>, childStatus: (String) -> Status) {
    Column(Modifier.fillMaxWidth().axfContextMenu("tracker-item", item.id)) {
        AxfListItem(item.title, subtitle = listOfNotNull(item.id, item.module, "wave ${item.wave}").joinToString(" · "), icon = when (status) { Status.BUILT -> "check"; Status.PARTIAL -> "clock"; Status.PLACEHOLDER -> "box"; Status.PLANNED -> "flag" }, onClick = onToggle, trailing = { StatusBadge(status) })
        if (open) AxfCard(title = "Status", icon = "edit") {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) { for (s in Status.entries) AxfChip(s.label(), tone = s.tone(), selected = s == status, onClick = { onStatus(s) }) }
            if (item.notes.isNotBlank()) AxfText(item.notes, muted = true)
            AxfText("tag: ${tagLabel(item.tag)}", muted = true)
            if (children.isNotEmpty()) { AxfSectionHeader("Suggested features"); for (c in children) Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) { AxfText(c.title, Modifier.weight(1f)); StatusBadge(childStatus(c.id)) } }
        }
    }
}
