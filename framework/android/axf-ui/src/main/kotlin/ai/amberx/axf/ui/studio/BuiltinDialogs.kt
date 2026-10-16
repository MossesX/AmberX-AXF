package ai.amberx.axf.ui.studio

import ai.amberx.axf.kernel.AxfVersion
import ai.amberx.axf.ui.DialogContribution
import ai.amberx.axf.ui.LocalAxfActions
import ai.amberx.axf.ui.LocalAxfCompiled
import ai.amberx.axf.ui.LocalAxfRuntime
import ai.amberx.axf.ui.components.AxfButton
import ai.amberx.axf.ui.components.AxfKbd
import ai.amberx.axf.ui.components.AxfText
import ai.amberx.axf.ui.components.AxfTextField
import ai.amberx.axf.ui.components.ButtonTone
import ai.amberx.axf.ui.theme.Axf
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

/** Dialogs every AXF app has, mirroring the web port's builtinDialogs.tsx: asset-json, import-asset, shortcuts, about. */
public fun builtinDialogs(): Map<String, DialogContribution> = listOf(
    DialogContribution("asset-json", "Asset JSON", "code") { st -> AssetJsonDialog(st.props["type"] ?: "", st.props["id"] ?: "") },
    DialogContribution("import-asset", "Import asset", "upload") { ImportAssetDialog() },
    DialogContribution("shortcuts", "Shortcuts", "keyboard") { ShortcutsDialog() },
    DialogContribution("about", "About", "info") { AboutDialog() },
).associateBy { it.id }

@Composable
public fun CodeBlock(text: String, modifier: Modifier = Modifier) {
    val c = Axf.colors
    Box(modifier.fillMaxWidth().heightIn(max = 360.dp).background(c.codeBg, Axf.shapes.smShape).padding(10.dp).verticalScroll(rememberScrollState()).horizontalScroll(rememberScrollState())) {
        AxfText(text, mono = true, color = c.codeText)
    }
}

@Composable
private fun AssetJsonDialog(type: String, id: String) {
    val runtime = LocalAxfRuntime.current
    val actions = LocalAxfActions.current
    val json = remember(type, id) { runtime.exportAsset(type, id) }
    Column(verticalArrangement = Arrangement.spacedBy(Axf.space.one)) {
        CodeBlock(json.ifEmpty { "Asset not found." })
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Axf.space.one, Alignment.End)) {
            AxfButton("Copy JSON", { actions.dispatch("asset.copy:$type:$id") }, icon = "copy")
            AxfButton("Activate", { runtime.swap(type, id) }, tone = ButtonTone.PRIMARY, icon = "zap", requires = "assets.swap")
        }
    }
}

@Composable
private fun ImportAssetDialog() {
    val runtime = LocalAxfRuntime.current
    var text by remember { mutableStateOf("") }
    var errors by remember { mutableStateOf<List<String>>(emptyList()) }
    Column(verticalArrangement = Arrangement.spacedBy(Axf.space.one)) {
        AxfText("Paste one asset (or a JSON array of assets). Valid ones register and the first one activates.", muted = true)
        AxfTextField(text, { text = it }, Modifier.fillMaxWidth(), placeholder = "{ \"\$axf\": \"asset@1\", … }", singleLine = false, minLines = 8, monospace = true)
        if (errors.isNotEmpty()) errors.forEach { AxfText("• $it", color = Axf.colors.danger) }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Axf.space.one, Alignment.End)) {
            AxfButton("Cancel", { runtime.closeDialog() })
            AxfButton("Import", {
                val trimmed = text.trim()
                val items = if (trimmed.startsWith("[")) runCatching { kotlinx.serialization.json.Json.parseToJsonElement(trimmed) as kotlinx.serialization.json.JsonArray }.getOrNull()?.map { it.toString() } ?: listOf(trimmed) else listOf(trimmed)
                val errs = mutableListOf<String>(); var ok = 0
                for ((i, item) in items.withIndex()) { val r = runtime.importAsset(item, activate = i == 0); if (r.ok) ok++ else errs += r.errors }
                errors = errs
                if (ok > 0) { runtime.toast("Imported $ok asset(s).", ai.amberx.axf.kernel.runtime.ToastKind.SUCCESS, "Import"); if (errs.isEmpty()) runtime.closeDialog() }
            }, tone = ButtonTone.PRIMARY, icon = "upload", requires = "assets.import")
        }
    }
}

@Composable
private fun ShortcutsDialog() {
    val compiled = LocalAxfCompiled.current
    val runtime = LocalAxfRuntime.current
    val rows = remember(compiled.rev) {
        val out = mutableListOf<Triple<String, String, String>>()
        for (m in compiled.appMenu.menus) for (i in m.items) if (i.shortcut != null && i.action != null) out += Triple(i.shortcut, runtime.actions.get(ai.amberx.axf.kernel.engine.ActionBus.parse(i.action).id)?.label ?: i.label ?: i.action, i.action)
        for ((_, items) in compiled.contextMenu.targets) for (i in items) if (i.shortcut != null && i.action != null && out.none { it.first == i.shortcut }) out += Triple(i.shortcut, i.label ?: i.action, i.action)
        out
    }
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        if (rows.isEmpty()) AxfText("No shortcuts are declared by the active menus.", muted = true)
        for ((combo, label, action) in rows) Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            AxfKbd(combo); AxfText(label, Modifier.weight(1f)); AxfText(action, mono = true, muted = true)
        }
    }
}

@Composable
private fun AboutDialog() {
    val runtime = LocalAxfRuntime.current
    val m = runtime.manifest
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        for ((k, v) in listOf("App" to "${m.appName} (${m.appId}) v${m.appVersion}", "Framework" to "AmberX AXF ${AxfVersion.FRAMEWORK} · API level ${AxfVersion.API_LEVEL} · ${AxfVersion.PORT} port", "Template" to m.template, "Targets" to m.targets.joinToString(", "), "Assets" to "${runtime.registry.count()} registered"))
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) { AxfText(k, Modifier.weight(0.35f), muted = true); AxfText(v, Modifier.weight(0.65f)) }
    }
}
