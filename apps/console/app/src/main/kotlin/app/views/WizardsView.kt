package ai.amberx.axf.console.views

import ai.amberx.axf.devtools.BuildEngineClient
import ai.amberx.axf.kernel.asset.str
import ai.amberx.axf.kernel.asset.strList
import ai.amberx.axf.kernel.runtime.ToastKind
import ai.amberx.axf.ui.LocalAxfActions
import ai.amberx.axf.ui.LocalAxfKernel
import ai.amberx.axf.ui.LocalAxfRuntime
import ai.amberx.axf.ui.components.AxfBadge
import ai.amberx.axf.ui.components.AxfButton
import ai.amberx.axf.ui.components.AxfChip
import ai.amberx.axf.ui.components.AxfEmptyState
import ai.amberx.axf.ui.components.AxfSectionHeader
import ai.amberx.axf.ui.components.AxfSwitch
import ai.amberx.axf.ui.components.AxfText
import ai.amberx.axf.ui.components.AxfTextField
import ai.amberx.axf.ui.components.ButtonTone
import ai.amberx.axf.ui.studio.CodeBlock
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
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
import androidx.compose.ui.unit.dp
import ai.amberx.axf.console.InstallableLibrary
import ai.amberx.axf.console.LibraryParam
import ai.amberx.axf.console.PortRecord
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject

/** Build-engine responses carry a `log` array; mirror it (and our own lines) onto the output terminal and open it. */
private fun ai.amberx.axf.kernel.runtime.AxfRuntime.terminalFrom(channel: String, r: JsonObject?, extra: String = "") {
    (r?.get("log") as? JsonArray)?.forEach { l -> (l as? JsonPrimitive)?.content?.let { line -> terminal.log(channel, line.trim(), if (line.contains("note:")) ai.amberx.axf.kernel.runtime.TerminalLevel.NOTE else if (line.startsWith("✗")) ai.amberx.axf.kernel.runtime.TerminalLevel.ERROR else ai.amberx.axf.kernel.runtime.TerminalLevel.INFO) } }
    if (extra.isNotBlank()) terminal.lines(channel, extra)
}

/* ------------------------------------------------------------------ */
/* Open project                                                         */
/* ------------------------------------------------------------------ */

/** Dialog `project`: which AXF app the console's installs and imports apply to (a path under the build engine's apps root). */
@OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)
@Composable
fun OpenProjectDialog() {
    val repo = rememberRepo() ?: return AxfEmptyState("Console data missing")
    val runtime = LocalAxfRuntime.current
    val current by repo.project.collectAsState()
    var dir by remember { mutableStateOf(current.ifBlank { "apps/" }) }
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        AxfText("Installs from the library manager and UI-library imports are applied to this project. Paths are relative to the build engine's repo root (Settings → Developer → Build engine URL).", muted = true)
        AxfTextField(dir, { dir = it }, Modifier.fillMaxWidth(), label = "Project directory", placeholder = "apps/my-app", monospace = true)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) { for (p in listOf("apps/console", "apps/demo-settings", "apps/demo-browser")) AxfChip(p, selected = dir == p, onClick = { dir = p }) }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End)) {
            AxfButton("Open", { repo.openProject(dir); runtime.toast("Project: ${dir.ifBlank { "(none)" }}", ToastKind.SUCCESS); runtime.closeDialog() }, tone = ButtonTone.PRIMARY, icon = "folder")
        }
    }
}

/* ------------------------------------------------------------------ */
/* Install wizard                                                       */
/* ------------------------------------------------------------------ */

/** One typed input for a library parameter; the same widget the import wizard reuses. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun ParamField(p: LibraryParam, value: String, onChange: (String) -> Unit) {
    val err = p.validate(value)
    when (p.type) {
        "bool" -> AxfSwitch(value.ifBlank { p.defaultText }.lowercase() in setOf("true", "yes", "on", "1"), { onChange(it.toString()) }, label = p.label, description = p.help)
        "choice" -> Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            AxfText(p.label); p.help?.let { AxfText(it, muted = true) }
            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) { for (c in p.choices) AxfChip(c, selected = value.ifBlank { p.defaultText } == c, onClick = { onChange(c) }) }
        }
        else -> AxfTextField(value, onChange, Modifier.fillMaxWidth(), label = p.label + if (p.required) " *" else "", placeholder = p.defaultText.ifBlank { p.help }, monospace = p.type == "list", singleLine = p.type != "list", minLines = if (p.type == "list") 2 else 1, error = err)
    }
    if (p.help != null && p.type !in setOf("bool", "choice")) AxfText(p.help, muted = true)
}

/**
 * Dialog `install`: the interactive install wizard. Walks every parameter the library's `library.json` declares
 * (one step each, validated), shows the resulting manifest block + install script, then runs `POST /install` on
 * the build engine against the open project — or records the script for Claude Code when no engine is configured.
 */
@Composable
fun InstallWizardDialog(libraryId: String) {
    val repo = rememberRepo() ?: return AxfEmptyState("Console data missing")
    val kernel = LocalAxfKernel.current
    val runtime = LocalAxfRuntime.current
    val actions = LocalAxfActions.current
    val libs by repo.installable.collectAsState()
    val project by repo.project.collectAsState()
    val lib = libs.firstOrNull { it.id == libraryId || it.slug == libraryId } ?: run { AxfEmptyState("Not installable", message = "No library.json for \"$libraryId\" — run `node framework/cli/tracker.mjs` to refresh catalog/libraries.json."); return }
    val answers = remember(lib.id) { mutableStateMapOf<String, String>().also { m -> lib.params.forEach { p -> m[p.key] = p.defaultText } } }
    var step by remember(lib.id) { mutableStateOf(0) }
    var log by remember { mutableStateOf("") }
    val scope = rememberCoroutineScope()
    val engine = remember(kernel) { kernel?.services?.get(BuildEngineClient::class) }
    val params = lib.params
    val summary = step >= params.size
    fun paramsJson(): JsonObject = buildJsonObject { for (p in params) p.toJson(answers[p.key] ?: "")?.let { put(p.key, it) } }
    val script = remember(answers.toMap(), project) { "node framework/cli/axf.mjs install ${lib.slug} ${project.ifBlank { "<appDir>" }} --yes \\\n" + params.joinToString(" \\\n") { p -> "    --param ${p.key}=\"${(answers[p.key] ?: "").ifBlank { p.defaultText }}\"" } }
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
            AxfText(lib.name, Modifier.weight(1f)); AxfBadge(if (summary) "review" else "step ${step + 1}/${params.size}", tone = "accent")
        }
        AxfText(lib.description, muted = true)
        AxfText("project: ${project.ifBlank { "none open — set one from the inspector or Home" }} · manifest key ${lib.manifestKey} · module ${lib.module}", mono = true, muted = true)
        if (!summary) {
            val p = params[step]
            ParamField(p, answers[p.key] ?: "", { answers[p.key] = it })
        } else {
            AxfSectionHeader("What the installer writes", accent = true)
            CodeBlock("axf.manifest.json → ${lib.manifestKey} = ${paramsJson()}\nandroid.modules += ${lib.id}\napp/build.gradle.kts += ${lib.gradle}\nApp.kt modules() += ${lib.moduleCtor}\ngenerated: app/src/main/kotlin/<pkg>/axf/${lib.module.removePrefix("lib-").replaceFirstChar(Char::uppercase)}Setup.kt (parameters as typed Kotlin)")
            CodeBlock(script)
            if (log.isNotBlank()) CodeBlock(log)
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End)) {
            if (step > 0) AxfButton("Back", { step-- }, icon = "arrow-left")
            if (!summary) AxfButton("Next", { step++ }, tone = ButtonTone.PRIMARY, icon = "arrow-right", enabled = params[step].validate(answers[params[step].key] ?: "") == null)
            else {
                AxfButton("Copy script", { actions.copy(script); runtime.toast("Install script copied.", ToastKind.SUCCESS) }, icon = "copy")
                AxfButton(if (engine?.available == true) "Install" else "Record", {
                    scope.launch {
                        val id = "install-${lib.slug}-${System.currentTimeMillis().toString(36)}"
                        if (engine != null && engine.available && project.isNotBlank()) {
                            runtime.terminal.log("install", "▶ ${lib.name} → $project"); actions.dispatch("terminal.open:install")
                            engine.install(project, lib.id, paramsJson()).onOk { r -> log += "✓ ${r.strList("changed").joinToString("\n  ", prefix = "changed:\n  ")}\n"; runtime.terminalFrom("install", r); runtime.terminal.ok("install", "${lib.name} installed into $project (${r.strList("changed").size} files)"); repo.addPort(PortRecord(id, "install", lib.name, lib.module, project, "installed", java.time.Instant.now().toString(), log)); runtime.toast("${lib.name} installed into $project", ToastKind.SUCCESS) }
                                .onErr { log += "✗ ${it.message}\n"; runtime.terminal.error("install", it.message); runtime.toast(it.message, ToastKind.DANGER, "Install failed") }
                        } else {
                            log += if (project.isBlank()) "No project open — open one, or run the copied script against your app.\n" else "Build engine not configured (Settings → Developer → Build engine URL). Recorded; run the copied script with Claude Code.\n"
                            runtime.terminal.warn("install", "${lib.name}: ${log.trim().lines().last()}"); runtime.terminal.lines("install", script)
                            repo.addPort(PortRecord(id, "install", lib.name, lib.module, project, "recorded", java.time.Instant.now().toString(), script))
                        }
                    }
                }, tone = ButtonTone.PRIMARY, icon = "download")
            }
        }
    }
}

/* ------------------------------------------------------------------ */
/* UI-library import wizard                                             */
/* ------------------------------------------------------------------ */

private val IMPORT_KINDS = listOf("BUTTON", "ICON_BUTTON", "TEXT_FIELD", "SWITCH", "CHECKBOX", "CHIP", "BADGE", "SLIDER", "CARD", "LIST_ITEM", "SECTION_HEADER", "DIVIDER")

/**
 * Dialog `uiimport`: port a third-party UI library to a new AmberX UI library. Steps: name the new kit → where the
 * sources come from (git / maven / npm / local) → which component kinds it covers → review. Run: the build engine
 * clones the library, refactors it to AXF tokens (Color literals, Material roles, typography, radii → Axf.* tokens),
 * saves `framework/android/kit-<id>` + the ui-kit asset, and applies it to the open project as its default kit.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun UiImportWizardDialog(sourceId: String) {
    val repo = rememberRepo() ?: return AxfEmptyState("Console data missing")
    val kernel = LocalAxfKernel.current
    val runtime = LocalAxfRuntime.current
    val actions = LocalAxfActions.current
    val project by repo.project.collectAsState()
    val src = THIRD_PARTY_UI.firstOrNull { it.id == sourceId }
    var name by remember(sourceId) { mutableStateOf(src?.let { "AmberX ${it.name.substringBefore(" (")}" } ?: "") }
    var kitId by remember(sourceId) { mutableStateOf(src?.id?.let { "ax-$it" } ?: "") }
    var sourceKind by remember(sourceId) { mutableStateOf(src?.let { if (it.stack.startsWith("@") || it.stack.contains("/")) "npm" else if (it.stack.contains(":") || it.stack.startsWith("androidx")) "maven" else "git" } ?: "git") }
    var location by remember(sourceId) { mutableStateOf(src?.stack ?: "") }
    var version by remember { mutableStateOf("") }
    var covers by remember { mutableStateOf(IMPORT_KINDS.take(8).toSet()) }
    var apply by remember { mutableStateOf(true) }
    var step by remember(sourceId) { mutableStateOf(0) }
    var log by remember { mutableStateOf("") }
    val scope = rememberCoroutineScope()
    val engine = remember(kernel) { kernel?.services?.get(BuildEngineClient::class) }
    val locKey = when (sourceKind) { "git" -> "url"; "local" -> "path"; else -> "coordinate" }
    val slug = kitId.lowercase().replace(Regex("[^a-z0-9]+"), "-").trim('-')
@OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)
    val script = "node framework/cli/axf.mjs import-ui --name \"$name\" --kit $slug --source $sourceKind --$locKey \"$location\"" + (if (version.isNotBlank()) " --version $version" else "") + " --covers ${covers.joinToString(",")}" + (if (apply && project.isNotBlank()) " --apply $project" else "")
    fun body(): JsonObject = buildJsonObject {
        put("name", JsonPrimitive(name)); put("kitId", JsonPrimitive(slug)); put("library", JsonPrimitive(src?.name ?: name)); put("version", JsonPrimitive(version))
        put("source", buildJsonObject { put("kind", JsonPrimitive(sourceKind)); put(locKey, JsonPrimitive(location)) })
        put("covers", JsonArray(covers.map { JsonPrimitive(it) })); if (apply && project.isNotBlank()) put("dir", JsonPrimitive(project))
    }
    val steps = listOf("Name", "Source", "Coverage", "Review")
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
            AxfText("Import ${src?.name ?: sourceId} → AmberX UI library", Modifier.weight(1f)); AxfBadge("${steps[step]} ${step + 1}/${steps.size}", tone = "accent")
        }
        when (step) {
            0 -> {
                AxfText("The new library becomes framework/android/kit-<id> with an AxfUiKit, a token bridge and a ui-kit asset; apps switch to it by swapping that asset.", muted = true)
                AxfTextField(name, { name = it }, Modifier.fillMaxWidth(), label = "New AmberX UI library name *", placeholder = "AmberX Cupertino")
                AxfTextField(kitId, { kitId = it }, Modifier.fillMaxWidth(), label = "Kit id (ui-kit asset id) *", placeholder = "ax-cupertino", monospace = true)
            }
            1 -> {
                AxfText("Where the library's code comes from. git / local sources are cloned and refactored to AXF tokens; maven / npm are wrapped as a dependency and the kit's overrides call their widgets.", muted = true)
                FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) { for (k in listOf("git", "maven", "npm", "local")) AxfChip(k, selected = sourceKind == k, onClick = { sourceKind = k }) }
                AxfTextField(location, { location = it }, Modifier.fillMaxWidth(), label = when (sourceKind) { "git" -> "Repository URL *"; "local" -> "Path on the build machine *"; else -> "Coordinate *" }, placeholder = when (sourceKind) { "git" -> "https://github.com/vendor/library"; "local" -> "/home/me/library"; "npm" -> "@scope/package"; else -> "group:artifact:version" }, monospace = true)
                AxfTextField(version, { version = it }, Modifier.fillMaxWidth(), label = "Version / git ref (optional)", monospace = true)
            }
            2 -> {
                AxfText("Component kinds the ported kit renders. Everything else keeps falling back to the default kit, so the app never breaks while the port is incomplete.", muted = true)
                FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) { for (k in IMPORT_KINDS) AxfChip(k, selected = k in covers, onClick = { covers = if (k in covers) covers - k else covers + k }) }
                AxfSwitch(apply, { apply = it }, label = "Apply to the open project", description = if (project.isBlank()) "No project open — the kit is saved to the framework only" else "Installs kit-$slug into $project and makes it the default ui-kit")
            }
            else -> {
                AxfSectionHeader("What the importer does", accent = true)
                CodeBlock("1. clone     ${if (sourceKind in setOf("git", "local")) "$location → framework/vendor/$slug" else "record $sourceKind dependency $location"}\n2. refactor  Color(0x…) / MaterialTheme.colorScheme.* / typography.* / RoundedCornerShape(N.dp) → Axf.* tokens (tokens.map.json, port-report.json)\n3. save      framework/android/kit-$slug (${name.ifBlank { "?" }}Kit, ${name.ifBlank { "?" }}KitModule, AxfPorted bridge, library.json) + android/assets/ui-kit/$slug.json\n4. apply     ${if (apply && project.isNotBlank()) "$project: install kit-$slug, defaults.ui-kit = $slug" else "(skipped)"}")
                CodeBlock(script)
                if (log.isNotBlank()) CodeBlock(log)
            }
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End)) {
            if (step > 0) AxfButton("Back", { step-- }, icon = "arrow-left")
            if (step < steps.size - 1) AxfButton("Next", { step++ }, tone = ButtonTone.PRIMARY, icon = "arrow-right", enabled = when (step) { 0 -> name.isNotBlank() && slug.isNotBlank(); 1 -> location.isNotBlank(); else -> true })
            else {
                AxfButton("Copy script", { actions.copy(script); runtime.toast("Import script copied.", ToastKind.SUCCESS) }, icon = "copy")
                AxfButton(if (engine?.available == true) "Import" else "Record", {
                    scope.launch {
                        val id = "ui-import-$slug"
                        if (engine != null && engine.available) {
                            runtime.terminal.log("import", "▶ ${src?.name ?: sourceId} → $name (kit-$slug)${if (apply && project.isNotBlank()) " → $project" else ""}"); actions.dispatch("terminal.open:import")
                            engine.importUi(body()).onOk { r ->
                                runtime.terminalFrom("import", r)
                                val save = ((r["report"] as? JsonObject)?.get("steps") as? JsonArray)?.mapNotNull { it as? JsonObject }?.firstOrNull { it.str("step") == "save" }
                                val missing = save?.strList("notCovered") ?: emptyList()
                                if (missing.isNotEmpty()) runtime.terminal.note("import", "${missing.size} component kind(s) have no counterpart in $name and fall back to the default AmberX kit: ${missing.joinToString(", ")}")
                                runtime.terminal.ok("import", "${r.str("module")} saved as hot-swappable ui-kit asset \"${r.str("kitId")}\"${if (apply && project.isNotBlank()) " and applied to $project" else ""}")
                                val rep = r["report"] as? JsonObject
                                val refactor = (rep?.get("steps") as? JsonArray)?.mapNotNull { it as? JsonObject }?.firstOrNull { it.str("step") == "refactor" }
                                log += "✓ ${r.str("module")} saved (ui-kit \"${r.str("kitId")}\")" + (refactor?.let { "\n  refactored ${it.str("filesChanged")} file(s): ${it["totals"]}" } ?: "") + "\n"
                                repo.addPort(PortRecord(id, "ui-import", name, "$sourceKind $location", if (apply) project else "", "ported", java.time.Instant.now().toString(), log))
                                runtime.toast("$name ported${if (apply && project.isNotBlank()) " and applied to $project" else ""}", ToastKind.SUCCESS)
                            }.onErr { log += "✗ ${it.message}\n"; runtime.terminal.error("import", it.message); runtime.toast(it.message, ToastKind.DANGER, "Import failed") }
                        } else {
                            log += "Build engine not configured (Settings → Developer → Build engine URL). Recorded; run the copied script with Claude Code.\n"
                            runtime.terminal.warn("import", "$name: build engine not configured — recorded"); runtime.terminal.lines("import", script)
                            repo.addPort(PortRecord(id, "ui-import", name, "$sourceKind $location", if (apply) project else "", "recorded", java.time.Instant.now().toString(), script))
                        }
                    }
                }, tone = ButtonTone.PRIMARY, icon = "download")
            }
        }
    }
}
