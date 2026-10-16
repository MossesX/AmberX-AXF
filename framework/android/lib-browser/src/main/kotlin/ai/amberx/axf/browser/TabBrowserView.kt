package ai.amberx.axf.browser

import ai.amberx.axf.ui.LocalAxfKernel
import ai.amberx.axf.ui.LocalAxfRuntime
import ai.amberx.axf.ui.components.AxfBadge
import ai.amberx.axf.ui.components.AxfButton
import ai.amberx.axf.ui.components.AxfCard
import ai.amberx.axf.ui.components.AxfCheckbox
import ai.amberx.axf.ui.components.AxfEmptyState
import ai.amberx.axf.ui.components.AxfPageHead
import ai.amberx.axf.ui.components.AxfSectionHeader
import ai.amberx.axf.ui.components.AxfText
import ai.amberx.axf.ui.components.ButtonTone
import ai.amberx.axf.ui.theme.Axf
import ai.amberx.axf.ui.windows.DockArea
import ai.amberx.axf.ui.windows.LocalWindowManager
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

/** The generic browser screen for one tab group: two panes of items, multi-select, Compare, docked area. Register it as the `browser-<group>` view. */
@Composable
public fun TabBrowserView(groupId: String, title: String = groupId, description: String? = null, modifier: Modifier = Modifier) {
    val kernel = LocalAxfKernel.current
    val runtime = LocalAxfRuntime.current
    val wm = LocalWindowManager.current
    val module = remember(kernel) { kernel?.services?.get(BrowserModule::class) }
    if (module == null) { AxfEmptyState("Library browser not installed", message = "Add lib-browser (axf install browser) and a BrowserItemProvider for \"$groupId\"."); return }
    val items = remember(module, groupId) { module.items(groupId) }
    var selected by remember(groupId) { mutableStateOf(module.selections[groupId] ?: emptySet()) }
    fun select(id: String, on: Boolean) { selected = if (on) selected + id else selected - id; module.selections[groupId] = selected }
    val pane: @Composable (Int, String) -> Unit = { idx, label ->
        val list = items.filter { it.pane == idx }
        AxfCard(title = label, icon = "grid", actions = { AxfBadge("${list.count { it.id in selected }}/${list.size}") }) {
            Column { for (it0 in list) Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                AxfCheckbox(it0.id in selected, { select(it0.id, it) })
                Column(Modifier.weight(1f)) { AxfText(it0.name); if (it0.subtitle.isNotBlank()) AxfText(it0.subtitle, muted = true) }
                if (it0.status.isNotBlank()) AxfBadge(it0.status, tone = when (it0.status) { "active" -> "success"; "ready", "adapter" -> "info"; "planned" -> "warning"; else -> "accent" })
                if (it0.swap != null) AxfButton("Swap", { it0.swap.invoke() }, icon = "zap", requires = "assets.swap")
            } }
        }
    }
    LazyColumn(modifier.fillMaxWidth(), contentPadding = PaddingValues(Axf.space.two), verticalArrangement = Arrangement.spacedBy(Axf.space.oneHalf)) {
        item { AxfPageHead(title, eyebrow = "${selected.size} selected · ${items.size} items · compare opens ${module.config.defaultWindowType.name.lowercase()} windows", description = description, actions = {
            AxfButton("Compare", { module.compare(wm, runtime, groupId) }, tone = ButtonTone.PRIMARY, icon = "layers", enabled = selected.isNotEmpty())
            AxfButton("Clear", { selected = emptySet(); module.selections[groupId] = emptySet() }, icon = "x")
        }) }
        for ((i, label) in module.config.panes.withIndex()) item(key = "pane-$i") { pane(i, label) }
        item { AxfSectionHeader("Docked comparisons", accent = true) }
        item { if (wm != null) Box(Modifier.fillMaxWidth().height(360.dp)) { DockArea(wm, empty = { AxfEmptyState("Nothing docked", message = "Redock a floating comparison window and its tab groups land here.") }) } }
    }
}
