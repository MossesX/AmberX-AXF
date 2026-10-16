package ai.amberx.axf.devtools

import ai.amberx.axf.kernel.AxfKernel
import ai.amberx.axf.kernel.module.ModuleState
import ai.amberx.axf.ui.LocalAxfKernel
import ai.amberx.axf.ui.LocalAxfRuntime
import ai.amberx.axf.ui.components.AxfBadge
import ai.amberx.axf.ui.components.AxfButton
import ai.amberx.axf.ui.components.AxfCard
import ai.amberx.axf.ui.components.AxfChip
import ai.amberx.axf.ui.components.AxfEmptyState
import ai.amberx.axf.ui.components.AxfListItem
import ai.amberx.axf.ui.components.AxfPageHead
import ai.amberx.axf.ui.components.AxfSegmented
import ai.amberx.axf.ui.components.AxfSwitch
import ai.amberx.axf.ui.components.AxfText
import ai.amberx.axf.ui.components.AxfTextField
import ai.amberx.axf.ui.studio.CodeBlock
import ai.amberx.axf.ui.theme.Axf
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.padding
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

/** The developer console: kernel status, modules, extension points, placeholders, flags, action log, event log, asset inspector. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
public fun DevtoolsScreen(modifier: Modifier = Modifier) {
    val kernel = LocalAxfKernel.current
    var tab by remember { mutableStateOf("status") }
    Column(modifier.fillMaxWidth()) {
        Box(Modifier.fillMaxWidth().padding(horizontal = Axf.space.two, vertical = Axf.space.one)) {
            AxfSegmented(listOf("status" to "Status", "modules" to "Modules", "flags" to "Flags", "actions" to "Actions", "events" to "Events", "assets" to "Assets"), tab, { tab = it })
        }
        if (kernel == null) { AxfEmptyState("No kernel", message = "Devtools need the kernel; wrap the tree in AxfRoot(kernel)."); return }
        when (tab) {
            "status" -> KernelStatusScreen(kernel)
            "modules" -> ModulesScreen(kernel)
            "flags" -> FlagsScreen(kernel)
            "actions" -> ActionLogScreen(kernel)
            "events" -> EventLogScreen(kernel)
            else -> AssetInspectorScreen(kernel)
        }
    }
}

@Composable
public fun KernelStatusScreen(kernel: AxfKernel, modifier: Modifier = Modifier) {
    val st = remember(kernel, kernel.started) { kernel.status() }
    LazyColumn(modifier.fillMaxWidth(), contentPadding = PaddingValues(Axf.space.two), verticalArrangement = Arrangement.spacedBy(Axf.space.oneHalf)) {
        item { AxfPageHead("Kernel", eyebrow = "AmberX AXF ${st.frameworkVersion} · API ${st.apiLevel} · ${st.port}", description = if (st.started) "Started in ${st.startupMillis} ms" else "Starting…") }
        item { AxfCard(title = "Summary") { Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            for ((k, v) in listOf("Modules" to "${st.modules.size} (${st.modules.count { it.placeholder }} placeholders, ${st.modules.count { it.state == ModuleState.FAILED }} failed)", "Assets" to st.assetCounts.entries.joinToString { "${it.key} ${it.value}" }, "Asset types" to st.assetTypes.size.toString(), "Actions" to "${st.actions.size} (${st.stubActions.size} stubs)", "Capabilities still placeholders" to st.placeholders.size.toString()))
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) { AxfText(k, Modifier.weight(0.4f), muted = true); AxfText(v, Modifier.weight(0.6f)) }
        } } }
        item { AxfCard(title = "Extension points (${st.extensionPoints.size})") { Column { for ((id, n, desc) in st.extensionPoints) AxfListItem(id, subtitle = desc, icon = if (n > 0) "check" else "box", trailing = { AxfBadge(if (n > 0) "$n filled" else "empty", tone = if (n > 0) "success" else "warning") }) } } }
        item { AxfCard(title = "Placeholders (${st.placeholders.size})") { Column { if (st.placeholders.isEmpty()) AxfText("Every declared capability has an implementation.", muted = true); for (p in st.placeholders) AxfListItem(p, icon = "alert", subtitle = "Declared, not built — callers receive NotImplemented") } } }
        if (st.loadErrors.isNotEmpty()) item { AxfCard(title = "Asset load errors", icon = "alert") { Column { for (e in st.loadErrors) AxfText(e, color = Axf.colors.danger) } } }
    }
}

@Composable
public fun ModulesScreen(kernel: AxfKernel, modifier: Modifier = Modifier) {
    val runtime = LocalAxfRuntime.current
    val info = remember(kernel, kernel.started) { kernel.modules.info() }
    LazyColumn(modifier.fillMaxWidth(), contentPadding = PaddingValues(Axf.space.two), verticalArrangement = Arrangement.spacedBy(Axf.space.one)) {
        item { AxfPageHead("Modules", eyebrow = "${info.size} registered", description = "Dependency order, state, provided/required capabilities. Placeholders carry contracts only.") }
        for (m in info) item(key = m.id) {
            AxfCard(title = m.label, icon = if (m.placeholder) "box" else "layers", actions = { AxfBadge(m.state.name.lowercase(), tone = when (m.state) { ModuleState.STARTED -> "success"; ModuleState.FAILED -> "danger"; else -> "accent" }); if (m.placeholder) AxfBadge("placeholder", tone = "warning") }) {
                AxfText(m.id, mono = true, muted = true)
                AxfText("v${m.version} · API ${m.apiLevel}", muted = true)
                if (m.dependsOn.isNotEmpty()) AxfText("depends on: ${m.dependsOn.joinToString()}", muted = true)
                if (m.provides.isNotEmpty()) AxfText("provides: ${m.provides.joinToString()}", muted = true)
                if (m.error != null) AxfText(m.error!!, color = Axf.colors.danger)
                if (m.state == ModuleState.STARTED && !m.id.startsWith("ai.amberx.axf.platform")) Row { AxfButton("Stop", { runtime.toast("Stopping modules live lands in wave 2.", ai.amberx.axf.kernel.runtime.ToastKind.INFO) }, icon = "pause", requires = "dev.tools") }
            }
        }
    }
}

@Composable
public fun FlagsScreen(kernel: AxfKernel, modifier: Modifier = Modifier) {
    var tick by remember { mutableStateOf(0) }
    val flags = remember(kernel, tick) { kernel.flags.declared().map { it to kernel.flags.isEnabled(it.id) } }
    LazyColumn(modifier.fillMaxWidth(), contentPadding = PaddingValues(Axf.space.two), verticalArrangement = Arrangement.spacedBy(Axf.space.one)) {
        item { AxfPageHead("Feature flags", eyebrow = "${flags.size} declared", description = "Layered: default → manifest → remote → role → user → kill switch. Toggling here writes the user layer.") }
        for ((f, on) in flags) item(key = f.id) { AxfSwitch(on, { kernel.flags.set(f.id, it); tick++ }, label = f.id, description = "${f.description} · ${f.module} · source ${kernel.flags.source(f.id).name.lowercase()}") }
    }
}

@Composable
public fun ActionLogScreen(kernel: AxfKernel, modifier: Modifier = Modifier) {
    val rec = kernel.services.get<ActionRecorder>()
    val actions by (rec?.actions ?: kotlinx.coroutines.flow.MutableStateFlow(emptyList())).collectAsState()
    LazyColumn(modifier.fillMaxWidth(), contentPadding = PaddingValues(Axf.space.two), verticalArrangement = Arrangement.spacedBy(2.dp)) {
        item { AxfPageHead("Action log", eyebrow = "${actions.size} recorded", actions = { AxfButton("Clear", { rec?.clear() }, icon = "trash") }) }
        if (actions.isEmpty()) item { AxfEmptyState("No actions yet", message = "Tap anything in the app; every menu, toolbar and shortcut goes through the action bus.") }
        for (a in actions.asReversed()) item { AxfListItem(a.spec, subtitle = java.text.SimpleDateFormat("HH:mm:ss.SSS", java.util.Locale.US).format(java.util.Date(a.atMillis)), icon = "zap") }
    }
}

@Composable
public fun EventLogScreen(kernel: AxfKernel, modifier: Modifier = Modifier) {
    val events = remember(kernel, kernel.runtime.current.rev) { kernel.events.history() }
    LazyColumn(modifier.fillMaxWidth(), contentPadding = PaddingValues(Axf.space.two), verticalArrangement = Arrangement.spacedBy(2.dp)) {
        item { AxfPageHead("Event log", eyebrow = "${events.size} events", description = "Kernel events (asset swaps, roles, navigation, module lifecycle, flags, toasts) in emission order.") }
        for (e in events.asReversed()) item { AxfListItem(e.topic, subtitle = e.toString().take(160), icon = "bell") }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
public fun AssetInspectorScreen(kernel: AxfKernel, modifier: Modifier = Modifier) {
    val runtime = LocalAxfRuntime.current
    var type by remember { mutableStateOf(ai.amberx.axf.kernel.asset.AssetTypes.COLOR_THEME) }
    var id by remember { mutableStateOf(runtime.current.active[type] ?: "") }
    var text by remember { mutableStateOf("") }
    var result by remember { mutableStateOf<List<String>>(emptyList()) }
    val json = remember(type, id) { runtime.exportAsset(type, id) }
    LazyColumn(modifier.fillMaxWidth(), contentPadding = PaddingValues(Axf.space.two), verticalArrangement = Arrangement.spacedBy(Axf.space.oneHalf)) {
        item { AxfPageHead("Asset inspector", description = "Read any registered asset's JSON, or validate JSON before importing it.") }
        item { FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) { for (t in kernel.types.ids()) AxfChip(t, selected = t == type, onClick = { type = t; id = runtime.current.active[t] ?: runtime.registry.list(t).firstOrNull()?.id ?: "" }) } }
        item { FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) { for (a in runtime.registry.list(type)) AxfChip(a.id, selected = a.id == id, onClick = { id = a.id }) } }
        item { CodeBlock(json.ifEmpty { "Pick an asset." }) }
        item { AxfCard(title = "Validate JSON") { Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            AxfTextField(text, { text = it }, Modifier.fillMaxWidth(), singleLine = false, minLines = 6, monospace = true, placeholder = "{ \"\$axf\": \"asset@1\", … }")
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) { AxfButton("Validate", { result = ai.amberx.axf.kernel.asset.parseJsonObjectOf(text)?.let { runtime.registry.validate(it).let { v -> if (v.ok) listOf("✓ valid") else v.errors } } ?: listOf("Not valid JSON") }, icon = "check") }
            for (r in result) AxfText(r, color = if (r.startsWith("✓")) Axf.colors.success else Axf.colors.danger)
        } } }
    }
}
