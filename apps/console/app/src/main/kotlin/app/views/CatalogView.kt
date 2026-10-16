package ai.amberx.axf.console.views

import ai.amberx.axf.console.CatalogItem
import ai.amberx.axf.ui.LocalAxfActions
import ai.amberx.axf.ui.LocalAxfRuntime
import ai.amberx.axf.ui.components.AxfBadge
import ai.amberx.axf.ui.components.AxfButton
import ai.amberx.axf.ui.components.AxfCheckbox
import ai.amberx.axf.ui.components.AxfChip
import ai.amberx.axf.ui.components.AxfEmptyState
import ai.amberx.axf.ui.components.AxfIconButton
import ai.amberx.axf.ui.components.AxfPageHead
import ai.amberx.axf.ui.components.AxfSectionHeader
import ai.amberx.axf.ui.components.AxfText
import ai.amberx.axf.ui.components.AxfTextField
import ai.amberx.axf.ui.components.ButtonTone
import ai.amberx.axf.ui.theme.Axf
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

/**
 * Feature catalog: the whole checklist inside the app. Checking a feature that has suggestions opens the
 * suggestion dialog (other features to build into the same library). Checked state persists on the device.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun CatalogView() {
    val repo = rememberRepo() ?: return AxfEmptyState("Console data missing")
    val runtime = LocalAxfRuntime.current
    val actions = LocalAxfActions.current
    val catalog by repo.catalog.collectAsState()
    val checked by repo.checked.collectAsState()
    var tab by remember { mutableStateOf(catalog.tabs.firstOrNull()?.id ?: "kernel") }
    var q by remember { mutableStateOf("") }
    var tagFilter by remember { mutableStateOf<String?>(null) }
    val current = catalog.tabs.firstOrNull { it.id == tab }
    LazyColumn(Modifier.fillMaxWidth(), contentPadding = PaddingValues(Axf.space.two), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        item { AxfPageHead("Feature catalog", eyebrow = "${checked.size} checked of ${catalog.items.size}", description = "Checked = should be built. A ▸ count means the feature has suggested companions to bundle into its library.", actions = {
            AxfButton("Export plan", { actions.dispatch("console.exportPlan") }, tone = ButtonTone.PRIMARY, icon = "copy")
        }) }
        item { AxfTextField(q, { q = it }, Modifier.fillMaxWidth(), placeholder = "Filter features…", leadingIcon = "search") }
        item { FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) { for (t in catalog.tabs) AxfChip(t.label, selected = t.id == tab, onClick = { tab = t.id }) } }
        item { FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) { AxfChip("all tags", selected = tagFilter == null, onClick = { tagFilter = null }); for (t in listOf("lock", "core", "lib", "ph")) AxfChip(tagLabel(t), selected = tagFilter == t, onClick = { tagFilter = if (tagFilter == t) null else t }) } }
        for (g in current?.groups ?: emptyList()) {
            val items = g.items.filter { (tagFilter == null || it.tag == tagFilter) && (q.isBlank() || it.title.contains(q, true) || it.note.contains(q, true) || it.id.contains(q, true)) }
            if (items.isEmpty()) continue
            item(key = "g-${g.id}") { Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) { AxfSectionHeader("${g.label} · ${items.count { it.id in checked }}/${items.size}", Modifier.weight(1f), accent = true); AxfIconButton("check", "Check all", { items.forEach { repo.setChecked(it.id, true) } }); AxfIconButton("x", "Uncheck all", { items.forEach { repo.setChecked(it.id, false) } }) } }
            for (it0 in items) item(key = it0.id) { CatalogRow(it0, it0.id in checked, repo.status(it0.id), it0.suggests.count { it.id in checked }) { on -> repo.setChecked(it0.id, on); if (!on) it0.suggests.forEach { repo.setChecked(it.id, false) }; if (on && it0.suggests.isNotEmpty()) runtime.openDialog("suggest", mapOf("item" to it0.id)) } }
        }
    }
}

@Composable
private fun CatalogRow(item: CatalogItem, checked: Boolean, status: ai.amberx.axf.console.Status, picked: Int, onCheck: (Boolean) -> Unit) {
    val runtime = LocalAxfRuntime.current
    Row(Modifier.fillMaxWidth().padding(vertical = 2.dp), verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        AxfCheckbox(checked, onCheck)
        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                AxfText(item.title, Modifier.weight(1f, fill = false), muted = checked && status == ai.amberx.axf.console.Status.BUILT)
                if (item.suggests.isNotEmpty()) AxfChip("▸ $picked/${item.suggests.size}", selected = picked > 0, onClick = { if (!checked) onCheck(true) else runtime.openDialog("suggest", mapOf("item" to item.id)) })
            }
            if (item.note.isNotBlank()) AxfText(item.note, muted = true)
        }
        Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(2.dp)) { AxfBadge(tagLabel(item.tag), tone = if (item.tag == "lock") "danger" else if (item.tag == "ph") "warning" else "accent"); StatusBadge(status) }
    }
}

/** The dialog opened when a feature with companions is checked: tick the ones to build into the same library. */
@Composable
fun SuggestionsDialog(itemId: String) {
    val repo = rememberRepo() ?: return AxfEmptyState("Console data missing")
    val runtime = LocalAxfRuntime.current
    val catalog by repo.catalog.collectAsState()
    val checked by repo.checked.collectAsState()
    val item = catalog.items.firstOrNull { it.id == itemId } ?: run { AxfText("Unknown feature $itemId"); return }
    var picks by remember(itemId) { mutableStateOf(item.suggests.filter { it.id in checked }.map { it.id }.toSet()) }
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        AxfText(item.title)
        AxfText("Suggested features to build into the same library. Tick the ones to include.", muted = true)
        for (s in item.suggests) AxfCheckbox(s.id in picks, { on -> picks = if (on) picks + s.id else picks - s.id }, label = s.title)
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End)) {
            AxfButton("Just this one", { item.suggests.forEach { repo.setChecked(it.id, false) }; runtime.closeDialog() })
            AxfButton("Add selected", { item.suggests.forEach { repo.setChecked(it.id, it.id in picks) }; runtime.closeDialog() }, tone = ButtonTone.PRIMARY, icon = "check")
        }
    }
}
