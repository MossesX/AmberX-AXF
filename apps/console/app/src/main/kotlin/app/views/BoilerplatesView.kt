package ai.amberx.axf.console.views

import ai.amberx.axf.console.Boilerplate
import ai.amberx.axf.console.BoilerplateScreen
import ai.amberx.axf.kernel.runtime.ToastKind
import ai.amberx.axf.ui.LocalAxfActions
import ai.amberx.axf.ui.LocalAxfRuntime
import ai.amberx.axf.ui.components.AxfBadge
import ai.amberx.axf.ui.components.AxfButton
import ai.amberx.axf.ui.components.AxfCard
import ai.amberx.axf.ui.components.AxfCheckbox
import ai.amberx.axf.ui.components.AxfChip
import ai.amberx.axf.ui.components.AxfEmptyState
import ai.amberx.axf.ui.components.AxfListItem
import ai.amberx.axf.ui.components.AxfPageHead
import ai.amberx.axf.ui.components.AxfSectionHeader
import ai.amberx.axf.ui.components.AxfSegmented
import ai.amberx.axf.ui.components.AxfText
import ai.amberx.axf.ui.components.AxfTextField
import ai.amberx.axf.ui.components.ButtonTone
import ai.amberx.axf.ui.components.PlaceholderScreen
import ai.amberx.axf.ui.studio.CodeBlock
import ai.amberx.axf.ui.theme.Axf
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
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
 * Boilerplate manager: categorized boilerplates built on the framework, a feature checklist that assembles
 * a new one, a live preview pane that renders each screen kind through the real shell components, and an
 * Import entry that stages third-party boilerplates for porting.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun BoilerplatesView() {
    val repo = rememberRepo() ?: return AxfEmptyState("Console data missing")
    val runtime = LocalAxfRuntime.current
    val actions = LocalAxfActions.current
    val all by repo.boilerplates.collectAsState()
    val categories by repo.categories.collectAsState()
    val catalog by repo.catalog.collectAsState()
    var mode by remember { mutableStateOf("browse") }
    var category by remember { mutableStateOf<String?>(null) }
    var selected by remember { mutableStateOf<Boilerplate?>(null) }
    var screenIdx by remember { mutableStateOf(0) }
    // builder state
    var newName by remember { mutableStateOf("") }
    var newCategory by remember { mutableStateOf("custom") }
    var newFeatures by remember { mutableStateOf<Set<String>>(emptySet()) }
    var newScreens by remember { mutableStateOf(listOf(BoilerplateScreen("home", "Home", "landing"), BoilerplateScreen("settings", "Settings", "settings"))) }
    var importText by remember { mutableStateOf("") }

    LazyColumn(Modifier.fillMaxWidth(), contentPadding = PaddingValues(Axf.space.two), verticalArrangement = Arrangement.spacedBy(Axf.space.one)) {
        item { AxfPageHead("Boilerplates", eyebrow = "${all.size} boilerplates · ${categories.size} categories", description = "Starting points for apps on the framework. Preview renders each screen kind with the active theme, layout and UI kit.") }
        item { AxfSegmented(listOf("browse" to "Browse", "build" to "Build new", "import" to "Import"), mode, { mode = it }) }
        when (mode) {
            "browse" -> {
                item { FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) { AxfChip("All", selected = category == null, onClick = { category = null }); for (c in categories) AxfChip(c.label, selected = category == c.id, onClick = { category = if (category == c.id) null else c.id }) } }
                val shown = all.filter { category == null || it.category == category }
                for (b in shown) item(key = b.id) {
                    AxfCard(title = b.name, icon = "file", actions = { AxfBadge(b.category); if (b.source != "amberx") AxfBadge(b.source, tone = "warning") }) {
                        AxfText(b.description, muted = true)
                        AxfText("${b.screens.size} screens · ${b.features.size} features · ${b.modules.joinToString().ifEmpty { "no extra modules" }}", muted = true)
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            AxfButton(if (selected?.id == b.id) "Hide preview" else "Preview", { selected = if (selected?.id == b.id) null else b; screenIdx = 0 }, tone = ButtonTone.PRIMARY, icon = "eye")
                            AxfButton("Copy init command", { actions.copy("node framework/cli/axf.mjs init apps/${b.id} --template android-compose --boilerplate ${b.id} --name \"${b.name}\""); runtime.toast("Command copied.", ToastKind.SUCCESS) }, icon = "terminal")
                        }
                        if (selected?.id == b.id) PreviewPane(b, screenIdx) { screenIdx = it }
                    }
                }
            }
            "build" -> {
                item { AxfCard(title = "New boilerplate", icon = "plus") { Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    AxfTextField(newName, { newName = it }, Modifier.fillMaxWidth(), label = "Name", placeholder = "Field service app")
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) { for (c in categories) AxfChip(c.label, selected = newCategory == c.id, onClick = { newCategory = c.id }) }
                    AxfSectionHeader("Screens")
                    for ((i, s) in newScreens.withIndex()) Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        AxfTextField(s.label, { v -> newScreens = newScreens.mapIndexed { j, x -> if (j == i) x.copy(label = v, id = v.lowercase().replace(Regex("[^a-z0-9]+"), "-").trim('-').ifEmpty { "screen$i" }) else x } }, Modifier.weight(1f))
                        AxfChip(s.kind, onClick = { newScreens = newScreens.mapIndexed { j, x -> if (j == i) x.copy(kind = SCREEN_KINDS[(SCREEN_KINDS.indexOf(x.kind) + 1) % SCREEN_KINDS.size]) else x } })
                        ai.amberx.axf.ui.components.AxfIconButton("x", "Remove", { newScreens = newScreens.filterIndexed { j, _ -> j != i } })
                    }
                    AxfButton("Add screen", { newScreens = newScreens + BoilerplateScreen("screen${newScreens.size}", "Screen ${newScreens.size + 1}", "list-detail") }, icon = "plus")
                } } }
                item { AxfSectionHeader("Required features (${newFeatures.size})", accent = true) }
                for (tab in catalog.tabs.filter { it.id == "demos" || it.id == "kernel" }) for (g in tab.groups) {
                    item(key = "bg-${tab.id}-${g.id}") { AxfSectionHeader(g.label) }
                    for (f in g.items) item(key = "bf-${f.id}") { AxfCheckbox(f.id in newFeatures, { on -> newFeatures = if (on) newFeatures + f.id else newFeatures - f.id }, label = f.title) }
                }
                item { Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End)) {
                    AxfButton("Preview", { selected = assemble(newName, newCategory, newFeatures, newScreens); mode = "browse"; category = null }, icon = "eye")
                    AxfButton("Save boilerplate", { val b = assemble(newName, newCategory, newFeatures, newScreens); if (b.name.isBlank()) runtime.toast("Give it a name first.", ToastKind.WARNING) else { repo.saveBoilerplate(b); runtime.toast("Saved. Copy its boilerplate.json from Browse to add it to the repo.", ToastKind.SUCCESS, b.name); mode = "browse"; category = "custom" } }, tone = ButtonTone.PRIMARY, icon = "save")
                } }
            }
            else -> {
                item { AxfCard(title = "Import a boilerplate", icon = "upload") { Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    AxfText("Paste a boilerplate.json, or a description/URL of a third-party boilerplate (React Native, Flutter, Next.js…). JSON imports register immediately; anything else is staged for porting through the AI assistant (wave 2).", muted = true)
                    AxfTextField(importText, { importText = it }, Modifier.fillMaxWidth(), singleLine = false, minLines = 6, monospace = true, placeholder = "{ \"\$axf\": \"boilerplate@1\", … }  or  https://github.com/…")
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End)) { AxfButton("Import", {
                        val o = ai.amberx.axf.kernel.asset.parseJsonObjectOf(importText.trim())
                        if (o != null && ai.amberx.axf.kernel.asset.strOrNull(o, "id") != null) { repo.saveBoilerplate(Boilerplate.fromJson(o).copy(source = "import", category = "custom")); runtime.toast("Imported.", ToastKind.SUCCESS); importText = ""; mode = "browse"; category = "custom" }
                        else if (importText.isNotBlank()) { repo.saveBoilerplate(Boilerplate("import-${System.currentTimeMillis().toString(36)}", importText.lines().first().take(40), "custom", "Staged for porting: " + importText.take(200), emptyList(), listOf(BoilerplateScreen("home", "Home", "landing")), emptyList(), emptyMap(), "staged", "import")); runtime.toast("Staged for porting (needs the AI assistant library).", ToastKind.INFO); importText = ""; mode = "browse"; category = "custom" }
                        else runtime.toast("Nothing to import.", ToastKind.WARNING)
                    }, tone = ButtonTone.PRIMARY, icon = "upload") }
                } } }
            }
        }
    }
}

val SCREEN_KINDS = listOf("landing", "list-detail", "dashboard", "wizard", "settings", "feed", "editor", "player", "map", "chat", "profile", "custom")

private fun assemble(name: String, category: String, features: Set<String>, screens: List<BoilerplateScreen>): Boilerplate =
    Boilerplate(name.lowercase().replace(Regex("[^a-z0-9]+"), "-").trim('-').ifEmpty { "custom-${System.currentTimeMillis().toString(36)}" }, name, category, "Assembled in the Dev Console from ${features.size} features.", features.toList(), screens, inferModules(features), emptyMap(), "planned", "console")

private fun inferModules(features: Set<String>): List<String> = LIBRARIES.filter { lib -> lib.features.any { it in features } }.map { it.module }

/** Renders the chosen screen kind with real framework components, inside a phone-shaped frame, with the boilerplate's nav as bottom tabs. */
@Composable
private fun PreviewPane(b: Boilerplate, idx: Int, onIdx: (Int) -> Unit) {
    val c = Axf.colors
    val screen = b.screens.getOrNull(idx) ?: return
    Column(Modifier.fillMaxWidth().padding(top = 8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) { for ((i, s) in b.screens.withIndex()) AxfChip(s.label, selected = i == idx, onClick = { onIdx(i) }) }
        Column(Modifier.fillMaxWidth().border(1.dp, c.border, Axf.shapes.lgShape).background(c.bg, Axf.shapes.lgShape).padding(8.dp)) {
            Row(Modifier.fillMaxWidth().padding(bottom = 6.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) { AxfText(b.name, style = Axf.type.titleSmall); AxfBadge(screen.kind) }
            Box(Modifier.fillMaxWidth().height(320.dp)) { ScreenKindPreview(screen) }
            Row(Modifier.fillMaxWidth().padding(top = 6.dp).background(c.navBg, Axf.shapes.smShape).padding(4.dp), horizontalArrangement = Arrangement.SpaceEvenly) { for ((i, s) in b.screens.withIndex()) AxfChip(s.label, selected = i == idx, onClick = { onIdx(i) }) }
        }
        AxfText("Preview uses the active theme/layout/UI kit; swap any asset and it follows.", muted = true)
    }
}

@Composable
private fun ScreenKindPreview(s: BoilerplateScreen) {
    val c = Axf.colors
    when (s.kind) {
        "landing" -> Column(Modifier.fillMaxWidth().padding(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp), horizontalAlignment = Alignment.CenterHorizontally) { Box(Modifier.size(56.dp).background(c.accentSoft, Axf.shapes.full)); AxfText(s.label, style = Axf.type.headlineSmall); AxfText("Landing / loading screen with brand mark and primary action", muted = true); AxfButton("Get started", {}, tone = ButtonTone.PRIMARY) }
        "list-detail" -> Column { for (i in 1..5) AxfListItem("Item $i", subtitle = "Detail opens on tap", icon = "file", onClick = {}) }
        "dashboard" -> Column(verticalArrangement = Arrangement.spacedBy(6.dp)) { Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) { for (k in listOf("Users 1,204", "Uptime 99.9%", "Errors 3")) AxfCard(Modifier.weight(1f)) { AxfText(k) } }; AxfCard(title = "Trend") { Box(Modifier.fillMaxWidth().height(80.dp).background(c.accentSoft, Axf.shapes.smShape)) } }
        "wizard" -> Column(verticalArrangement = Arrangement.spacedBy(8.dp)) { AxfText("Step 1 of 3", muted = true); AxfText("Choose a project", style = Axf.type.titleMedium); AxfListItem("Project A", icon = "folder", onClick = {}, selected = true); AxfListItem("Project B", icon = "folder", onClick = {}); Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End)) { AxfButton("Back", {}); AxfButton("Next", {}, tone = ButtonTone.PRIMARY) } }
        "settings" -> Column { ai.amberx.axf.ui.components.AxfSwitch(true, {}, label = "Notifications"); ai.amberx.axf.ui.components.AxfSwitch(false, {}, label = "Dark mode follows system"); AxfListItem("Account", icon = "user", onClick = {}); AxfListItem("About", icon = "info", onClick = {}) }
        "feed" -> Column(verticalArrangement = Arrangement.spacedBy(6.dp)) { for (i in 1..3) AxfCard { Box(Modifier.fillMaxWidth().height(60.dp).background(c.surface3, Axf.shapes.smShape)); AxfText("Post $i", style = Axf.type.titleSmall); AxfText("Feed card with media and actions", muted = true) } }
        "editor" -> Column { AxfTextField("# Title\n\nSome **markdown** text…", {}, Modifier.fillMaxWidth(), singleLine = false, minLines = 8, monospace = true); Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) { AxfChip("Bold"); AxfChip("Italic"); AxfChip("Code"); AxfChip("Link") } }
        "player" -> Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) { Box(Modifier.fillMaxWidth().height(150.dp).background(c.surface3, Axf.shapes.mdShape)); ai.amberx.axf.ui.components.AxfSlider("", 35f, {}); Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) { AxfButton(null, {}, icon = "chevron-right"); AxfButton(null, {}, icon = "play", tone = ButtonTone.PRIMARY); AxfButton(null, {}, icon = "pause") } }
        "map" -> Box(Modifier.fillMaxWidth().height(280.dp).background(c.surface2, Axf.shapes.mdShape), contentAlignment = Alignment.Center) { Column(horizontalAlignment = Alignment.CenterHorizontally) { ai.amberx.axf.ui.icons.AxfIcon("map", size = 40.dp, tint = c.accent, contentDescription = null); AxfText("Map with trail + position", muted = true) } }
        "chat" -> Column(verticalArrangement = Arrangement.spacedBy(6.dp)) { for ((i, m) in listOf("Hey, is the deploy done?", "Yes — live on xaf.amberxai.com", "Nice, thanks!").withIndex()) Box(Modifier.fillMaxWidth(), contentAlignment = if (i % 2 == 0) Alignment.CenterStart else Alignment.CenterEnd) { Box(Modifier.background(if (i % 2 == 0) c.surface2 else c.accent, Axf.shapes.mdShape).padding(8.dp)) { AxfText(m, color = if (i % 2 == 0) c.text else c.accentText) } }; AxfTextField("", {}, Modifier.fillMaxWidth(), placeholder = "Message…") }
        "profile" -> Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(6.dp)) { Box(Modifier.size(64.dp).background(c.accentSoft, Axf.shapes.full)); AxfText("Display name", style = Axf.type.titleMedium); AxfText("bio · contact · privacy", muted = true); AxfButton("Edit profile", {}) }
        else -> PlaceholderScreen(s.label, message = "Custom screen — built by hand.")
    }
}
