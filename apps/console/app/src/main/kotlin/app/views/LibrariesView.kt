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

/** A library the console can build: a module id + the catalog features it should cover. Derived from the Modules tab + feature groups. */
data class LibraryDef(val id: String, val module: String, val label: String, val description: String, val features: List<String>, val packageName: String)

val LIBRARIES = listOf(
    LibraryDef("settings", "ai.amberx.axf.settings", "Settings", "Schema-driven settings + generated UI", listOf("s.settings", "s.prefs", "s.scopes", "s.secure", "s.searchable"), "lib-settings"),
    LibraryDef("logging", "ai.amberx.axf.logging", "Logging", "Levels, sinks, viewer, crash capture, diagnostics", listOf("l.log", "l.viewer", "l.crash", "l.net", "l.perf", "l.remote", "l.diag"), "lib-logging"),
    LibraryDef("admin", "ai.amberx.axf.admin", "Administration", "Roles, policies, flags, remote config, module toggles, audit", listOf("a.admin", "a.audit", "a.users", "a.content", "a.maint", "a.devicemgmt"), "lib-admin"),
    LibraryDef("accounts", "ai.amberx.axf.accounts", "Accounts", "Sign-in, OAuth, passkeys, biometrics, sessions, 2FA, GDPR", listOf("u.accounts", "u.auth", "u.bio", "u.sessions", "u.recovery", "u.roles", "u.guest", "u.gdpr"), "lib-accounts"),
    LibraryDef("profile", "ai.amberx.axf.profile", "Profile", "Avatar, details, privacy, sync, public profile", listOf("p.profile", "p.avatar", "p.sync", "p.public", "p.activity"), "lib-profile"),
    LibraryDef("billing", "ai.amberx.axf.billing", "Billing", "Plans, paywall, Play Billing, entitlements, IAP, promos", listOf("b.subs", "b.billing", "b.entitle", "b.iap", "b.promo", "b.license", "b.ads", "b.stripe"), "lib-billing"),
    LibraryDef("media", "ai.amberx.axf.media", "Media", "Video/audio playback, camera, streaming, PiP", listOf("dv.media", "dv.stream", "dv.camera", "dv.audio", "c.video", "c.vpsstream", "c.camera", "c.music"), "lib-media"),
    LibraryDef("location", "ai.amberx.axf.location", "Location", "GPS, geofences, maps, trails", listOf("dv.loc", "dv.maps", "c.gps"), "lib-location"),
    LibraryDef("editor", "ai.amberx.axf.editor", "Editors", "Rich text, markdown, code editor, diff", listOf("ui.editor", "c.texteditor", "c.json", "c.pdf"), "lib-editor"),
    LibraryDef("ai", "ai.amberx.axf.ai", "AI assistant", "Claude/OpenAI/Gemini providers, streaming, tools, MCP", listOf("w.ai", "w.mcp", "c.ai", "c.aiimage"), "lib-ai"),
    LibraryDef("vps", "ai.amberx.axf.vps", "VPS & deploy", "SSH/SFTP, deploy wizard, server monitoring, Coolify, Hostinger", listOf("w.vps", "w.coolify", "w.hostinger", "c.terminal", "c.deploy", "c.servermon", "c.logtail", "c.dns", "c.cron"), "lib-vps"),
    LibraryDef("github", "ai.amberx.axf.github", "GitHub", "Repos, commits, Actions, releases, tracker sync", listOf("w.github", "c.github", "cx.github"), "lib-github"),
    LibraryDef("work", "ai.amberx.axf.work", "Background work", "WorkManager scheduler, alarms, foreground services", listOf("dv.bg", "k.scheduler"), "lib-work"),
    LibraryDef("notifications", "ai.amberx.axf.notifications", "Notifications & push", "Channels, actions, scheduled, FCM/self-hosted push", listOf("dv.notif", "w.push", "c.notifications", "c.push"), "lib-notifications"),
    LibraryDef("sensors", "ai.amberx.axf.sensors", "Sensors & connectivity", "Sensors, BLE, NFC, Wi-Fi tools", listOf("dv.sensors", "dv.ble", "dv.nfc", "dv.wifi", "c.sensors", "c.ble", "c.nfc", "c.wifi"), "lib-sensors"),
    LibraryDef("files", "ai.amberx.axf.files", "Files & sync", "File manager, transfer, backup, offline sync", listOf("d.files", "d.sync", "d.backup", "c.files", "c.transfer", "c.backup", "c.offline"), "lib-files"),
    LibraryDef("charts", "ai.amberx.axf.charts", "Charts & tables", "Charts, data grids, dashboards", listOf("ui.charts", "ui.tables", "c.charts"), "lib-charts"),
    LibraryDef("browser", "ai.amberx.axf.browser", "Library browser", "Floating tab-group browser: two panes, multi-select, compare → undock / split / grid; attaches to any tab group in the manifest; installable with a wizard", listOf("lib.browser", "ui.windows", "ui.explorer"), "lib-browser"),
    LibraryDef("plugins", "ai.amberx.axf.plugins", "Plugins & add-ons", "Plugin loader, packs, OTA asset packs, designer bridge", listOf("k.plugins", "k.nocode", "w.ota"), "lib-plugins"),
)

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
    val project by repo.project.collectAsState()
    val ports by repo.ports.collectAsState()
    val actions = ai.amberx.axf.ui.LocalAxfActions.current
    LazyColumn(Modifier.fillMaxWidth(), contentPadding = PaddingValues(Axf.space.two), verticalArrangement = Arrangement.spacedBy(Axf.space.one)) {
        item { AxfPageHead("Libraries", eyebrow = "${LIBRARIES.size} libraries · ${installable.size} installable · project: ${project.ifBlank { "none" }}", description = "Each library bundles catalog features. Pick one to scaffold its module and a small demo app, or Install one into the open project: the wizard asks for the library's parameters (from its library.json) and writes manifest, gradle, App.kt and typed setup code.", actions = {
            AxfButton(if (project.isBlank()) "Open project" else project, { runtime.openDialog("project") }, icon = "folder")
            AxfButton("Terminal", { actions.dispatch("terminal.open:install") }, icon = "terminal")
        }) }
        for (lib in LIBRARIES) item(key = lib.id) {
            val built = lib.features.count { repo.status(it) == Status.BUILT }; val ph = lib.features.count { repo.status(it) == Status.PLACEHOLDER }; val sel = lib.features.count { it in checked }
            AxfCard(title = lib.label, icon = "box", actions = { AxfBadge("$built/${lib.features.size} built", tone = if (built == lib.features.size) "success" else if (built > 0 || ph > 0) "warning" else "accent") }) {
                AxfText(lib.description, muted = true)
                AxfText("${lib.packageName} · ${lib.module} · $sel checked", mono = true, muted = true)
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    AxfButton("Build library", { runtime.openDialog("libpicker", mapOf("library" to lib.id)) }, tone = ButtonTone.PRIMARY, icon = "zap")
                    if (installable.any { it.slug == lib.id || it.id == lib.module }) AxfButton("Install", { runtime.openDialog("install", mapOf("library" to lib.id)) }, icon = "download", requires = "dev.build")
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
    val lib = LIBRARIES.firstOrNull { it.id == libraryId } ?: run { AxfText("Unknown library $libraryId"); return }
    val catalog by repo.catalog.collectAsState()
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
