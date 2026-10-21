package ai.amberx.axf.console.views

import ai.amberx.axf.console.DemoApp
import ai.amberx.axf.console.Status
import ai.amberx.axf.devtools.BuildEngineClient
import ai.amberx.axf.kernel.runtime.ToastKind
import ai.amberx.axf.ui.LocalAxfActions
import ai.amberx.axf.ui.LocalAxfKernel
import ai.amberx.axf.ui.LocalAxfRuntime
import ai.amberx.axf.ui.components.AxfBadge
import ai.amberx.axf.ui.components.AxfButton
import ai.amberx.axf.ui.components.AxfCard
import ai.amberx.axf.ui.components.AxfChip
import ai.amberx.axf.ui.components.AxfEmptyState
import ai.amberx.axf.ui.components.AxfListItem
import ai.amberx.axf.ui.components.AxfPageHead
import ai.amberx.axf.ui.components.AxfText
import ai.amberx.axf.ui.components.AxfTextField
import ai.amberx.axf.ui.components.ButtonTone
import ai.amberx.axf.ui.studio.CodeBlock
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
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch

/*
 * Libraries come from the data, not a hard-coded list: catalog items that name a library (modules tab), every
 * library.json (catalog/libraries.json) and every lib-* module the tracker knows (kernel.catalog LibraryCards, the same
 * list the web console shows). lib-voice, lib-lock, lib-mcp, lib-browser… appear by themselves.
 */

/** Library picker: pick a library → see its coverage → generate its module + demo app through the build engine (or export the spec). */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun LibrariesView() {
    var tab by remember { mutableStateOf("framework") }
    Column(Modifier.fillMaxWidth()) {
        androidx.compose.foundation.layout.Box(Modifier.fillMaxWidth().padding(horizontal = Axf.space.two, vertical = Axf.space.one)) {
            ai.amberx.axf.ui.components.AxfSegmented(listOf("framework" to "Framework libraries", "ui" to "UI libraries"), tab, { tab = it })
        }
        if (tab == "ui") UiLibrariesTab() else FrameworkLibrariesTab()
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun FrameworkLibrariesTab() {
    val repo = rememberRepo() ?: return AxfEmptyState("Console data missing")
    val runtime = LocalAxfRuntime.current
    val checked by repo.checked.collectAsState()
    val installable by repo.installable.collectAsState()
    val catalog by repo.catalog.collectAsState()
    val tracker by repo.tracker.collectAsState()
    val libraries = remember(catalog, installable, tracker) { repo.libraryCards() }
    val project by repo.project.collectAsState()
    val ports by repo.ports.collectAsState()
    val actions = ai.amberx.axf.ui.LocalAxfActions.current
    LazyColumn(Modifier.fillMaxWidth(), contentPadding = PaddingValues(Axf.space.two), verticalArrangement = Arrangement.spacedBy(Axf.space.one)) {
        item { AxfPageHead("Libraries", eyebrow = "${libraries.size} libraries · ${installable.size} installable · project: ${project.ifBlank { "none" }}", description = "Each library bundles catalog features. Pick one to scaffold its module and a small demo app, or Install one into the open project: the wizard asks for the library's parameters (from its library.json) and writes manifest, gradle, App.kt and typed setup code.", actions = {
            AxfButton(if (project.isBlank()) "Open project" else project, { runtime.openDialog("project") }, icon = "folder")
            AxfButton("Terminal", { actions.dispatch("terminal.open:install") }, icon = "terminal")
        }) }
        for (lib in libraries) item(key = lib.id) {
            val built = lib.features.count { repo.status(it) == Status.BUILT }; val ph = lib.features.count { repo.status(it) == Status.PLACEHOLDER }; val sel = lib.features.count { it in checked }
            AxfCard(title = lib.label, icon = "box", actions = { AxfBadge("$built/${lib.features.size} built", tone = if (built == lib.features.size) "success" else if (built > 0 || ph > 0) "warning" else "accent") }) {
                AxfText(lib.description, muted = true)
                AxfText("${lib.packageName} · ${lib.module} · $sel checked", mono = true, muted = true)
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    AxfButton("Build library", { runtime.openDialog("libpicker", mapOf("library" to lib.id)) }, tone = ButtonTone.PRIMARY, icon = "zap")
                    if (lib.installable) AxfButton("Install", { runtime.openDialog("install", mapOf("library" to lib.id)) }, icon = "download", requires = "dev.build")
                    AxfButton("Features", { runtime.navigate("catalog") }, icon = "layers")
                }
            }
        }
        if (ports.isNotEmpty()) item(key = "ports") {
            AxfCard(title = "Installs & imports", icon = "download", actions = { AxfBadge("${ports.size}") }) {
                for (p in ports.sortedByDescending { it.createdAt }) ai.amberx.axf.ui.components.AxfListItem(p.name, subtitle = "${p.kind} · ${p.source}${if (p.project.isNotBlank()) " → ${p.project}" else ""} · ${p.createdAt.take(16).replace('T', ' ')}", icon = if (p.kind == "ui-import") "grid" else "box", trailing = { AxfBadge(p.status, tone = when (p.status) { "installed", "ported" -> "success"; "recorded" -> "warning"; else -> "accent" }) })
            }
        }
    }
}

val DEMO_TEMPLATES = listOf("list-detail", "dashboard", "wizard", "settings", "feed", "editor", "player", "map", "chat", "profile")

/** The dialog behind "Build library": choose which features to include, the demo template, then run the build engine or export the spec. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun LibraryPickerDialog(libraryId: String) {
    val repo = rememberRepo() ?: return AxfEmptyState("Console data missing")
    val kernel = LocalAxfKernel.current
    val runtime = LocalAxfRuntime.current
    val actions = LocalAxfActions.current
    val catalog by repo.catalog.collectAsState()
    val lib = remember(catalog, libraryId) { repo.libraryCard(libraryId) } ?: run { AxfText("Unknown library $libraryId"); return }
    val checked by repo.checked.collectAsState()
    var include by remember(libraryId) { mutableStateOf(lib.features.filter { it in checked || repo.status(it) != Status.BUILT }.toSet()) }
    var template by remember { mutableStateOf(DEMO_TEMPLATES.first()) }
    var name by remember { mutableStateOf("AXF Demo — ${lib.label}") }
    var log by remember { mutableStateOf("") }
    val scope = rememberCoroutineScope()
    val engine = remember(kernel) { kernel?.services?.get<BuildEngineClient>() }
    val spec = remember(include, template, name) {
        buildString {
            appendLine("# Build library ${lib.packageName} (${lib.module})"); appendLine(); appendLine("Demo app: apps/demo-${lib.id} — \"$name\" — template screen: $template"); appendLine()
            appendLine("## Features to implement"); for (f in include) { val it0 = catalog.items.firstOrNull { it.id == f }; appendLine("- $f — ${it0?.title ?: f} [${repo.status(f).label()}]"); it0?.suggests?.filter { it.id in checked }?.forEach { appendLine("    - ${it.id} — ${it.title}") } }
            appendLine(); appendLine("## Commands"); appendLine("node framework/cli/axf.mjs new-module ${lib.id} --label \"${lib.label}\" --capabilities ${include.joinToString(",")}"); appendLine("node framework/cli/axf.mjs new-demo ${lib.id} --name \"$name\"")
        }
    }
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        AxfText("${lib.label} · ${lib.packageName}")
        AxfText("Features to include", muted = true)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) { for (f in lib.features) AxfChip((catalog.items.firstOrNull { it.id == f }?.title ?: f).take(28), tone = repo.status(f).tone(), selected = f in include, onClick = { include = if (f in include) include - f else include + f }) }
        AxfText("Demo app template", muted = true)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) { for (t in DEMO_TEMPLATES) AxfChip(t, selected = t == template, onClick = { template = t }) }
        AxfTextField(name, { name = it }, Modifier.fillMaxWidth(), label = "Demo app name")
        if (log.isNotBlank()) CodeBlock(log)
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End)) {
            AxfButton("Copy spec", { actions.copy(spec); runtime.toast("Spec copied — paste into Claude Code.", ToastKind.SUCCESS) }, icon = "copy")
            AxfButton(if (engine?.available == true) "Run on build engine" else "Record demo", {
                scope.launch {
                    if (engine != null && engine.available) {
                        engine.newModule(lib.id, lib.label, include.toList()).onOk { log += "module: $it\n" }.onErr { log += "module: ${it.message}\n" }
                        engine.newDemo(lib.id).onOk { log += "demo: $it\n" }.onErr { log += "demo: ${it.message}\n" }
                    } else log += "Build engine not configured (Settings → Developer → Build engine URL). Recorded the demo locally; use the copied spec with Claude Code.\n"
                    repo.addDemo(DemoApp("demo-${lib.id}", lib.id, name, template, if (engine?.available == true) "scaffolded" else "planned", java.time.Instant.now().toString()))
                    runtime.toast("Demo app recorded.", ToastKind.SUCCESS, lib.label)
                }
            }, tone = ButtonTone.PRIMARY, icon = "play")
        }
    }
}
