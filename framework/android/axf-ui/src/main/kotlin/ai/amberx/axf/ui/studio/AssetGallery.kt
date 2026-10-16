package ai.amberx.axf.ui.studio

import ai.amberx.axf.kernel.asset.AssetEnvelope
import ai.amberx.axf.kernel.asset.AssetTypes
import ai.amberx.axf.ui.LocalAxfActions
import ai.amberx.axf.ui.LocalAxfCompiled
import ai.amberx.axf.ui.LocalAxfRuntime
import ai.amberx.axf.ui.LocalAxfState
import ai.amberx.axf.ui.components.AxfBadge
import ai.amberx.axf.ui.components.AxfButton
import ai.amberx.axf.ui.components.AxfCard
import ai.amberx.axf.ui.components.AxfChip
import ai.amberx.axf.ui.components.AxfIconButton
import ai.amberx.axf.ui.components.AxfPageHead
import ai.amberx.axf.ui.components.AxfSectionHeader
import ai.amberx.axf.ui.components.AxfText
import ai.amberx.axf.ui.components.AxfTextField
import ai.amberx.axf.ui.components.ButtonTone
import ai.amberx.axf.ui.components.axfContextMenu
import ai.amberx.axf.ui.icons.AxfIcon
import ai.amberx.axf.ui.theme.Axf
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp

/**
 * Asset gallery (web AssetStudio): every registered asset grouped by type, the active one marked, with
 * Activate / JSON / Copy and the `asset-card` context target (payload "<type>:<id>"). Filter by text or type.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
public fun AssetGallery(modifier: Modifier = Modifier, title: String = "Assets") {
    val runtime = LocalAxfRuntime.current
    val state = LocalAxfState.current
    val compiled = LocalAxfCompiled.current
    val actions = LocalAxfActions.current
    var query by remember { mutableStateOf("") }
    var type by remember { mutableStateOf<String?>(null) }
    val types = remember(compiled.rev) { runtime.registry.types.all() }
    val all = remember(compiled.rev, state.rev) { runtime.registry.all() }
    val shown = all.filter { (type == null || it.type == type) && (query.isBlank() || it.name.contains(query, true) || it.id.contains(query, true) || it.tags.any { t -> t.contains(query, true) }) }
    LazyColumn(modifier.fillMaxWidth(), contentPadding = androidx.compose.foundation.layout.PaddingValues(Axf.space.two), verticalArrangement = Arrangement.spacedBy(Axf.space.one)) {
        item {
            AxfPageHead(title, eyebrow = "${all.size} assets · ${types.size} types", description = "Every theme, layout, menu and control is a JSON asset. Tap to activate, long-press for more.", actions = {
                AxfButton("Import", { runtime.openDialog("import-asset") }, icon = "upload", requires = "assets.import")
                AxfButton("Random", { actions.dispatch("assets.random") }, icon = "shuffle")
                AxfButton("Reset", { actions.dispatch("assets.reset") }, icon = "refresh")
            })
        }
        item { AxfTextField(query, { query = it }, Modifier.fillMaxWidth(), placeholder = "Filter assets…", leadingIcon = "search") }
        item {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                AxfChip("All", selected = type == null, onClick = { type = null })
                for (t in types) AxfChip(t.label, icon = t.icon, selected = type == t.id, onClick = { type = if (type == t.id) null else t.id })
            }
        }
        for (t in types) {
            val list = shown.filter { it.type == t.id }
            if (list.isEmpty()) continue
            item(key = "h-${t.id}") { AxfSectionHeader("${t.label} · ${list.size}", Modifier.padding(top = Axf.space.one), accent = true) }
            items(list, key = { it.key }) { a -> AssetCard(a, active = state.active[a.type] == a.id) }
        }
        if (shown.isEmpty()) item { AxfText("Nothing matches.", muted = true) }
    }
}

@Composable
public fun AssetCard(a: AssetEnvelope, active: Boolean, modifier: Modifier = Modifier) {
    val runtime = LocalAxfRuntime.current
    val actions = LocalAxfActions.current
    val c = Axf.colors
    val payload = "${a.type}:${a.id}"
    Box(modifier.fillMaxWidth().axfContextMenu("asset-card", payload)) {
        AxfCard(title = a.name, icon = runtime.registry.types.get(a.type)?.icon, ctxTarget = "asset-card", ctxPayload = payload, actions = {
            if (active) AxfBadge("active") else AxfIconButton("zap", "Activate", { runtime.swap(a.type, a.id) }, requires = "assets.swap")
            AxfIconButton("code", "View JSON", { actions.dispatch("asset.json:$payload") })
            AxfIconButton("copy", "Copy JSON", { actions.dispatch("asset.copy:$payload") })
        }) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                AssetSwatch(a)
                Column(Modifier.weight(1f)) {
                    AxfText(a.description ?: "", muted = true, maxLines = 2)
                    Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) { AxfText(a.id, mono = true, muted = true); a.tags.take(3).forEach { AxfChip(it) } }
                }
            }
        }
    }
}

/** A tiny visual hint per asset type: palette swatches for color themes, a grid sketch for layouts, the radius for style themes. */
@Composable
private fun AssetSwatch(a: AssetEnvelope) {
    val c = Axf.colors
    when (a.type) {
        AssetTypes.COLOR_THEME -> {
            val t = ai.amberx.axf.kernel.asset.ColorTheme.fromJson(a.data)
            Row(horizontalArrangement = Arrangement.spacedBy(2.dp)) { for (k in listOf("bg", "surface", "accent", "text", "danger")) Box(Modifier.size(14.dp, 28.dp).background(ai.amberx.axf.kernel.engine.Rgba.parse(t[k])?.let { Color(it.r, it.g, it.b, (it.a * 255).toInt()) } ?: c.border, Axf.shapes.xsShape).border(1.dp, c.border, Axf.shapes.xsShape)) }
        }
        AssetTypes.STYLE_THEME -> Box(Modifier.size(36.dp).border(2.dp, c.accent, Axf.shapes.of(ai.amberx.axf.kernel.asset.StyleTheme.fromJson(a.data).radius.md.toDouble())))
        AssetTypes.LAYOUT -> { val l = ai.amberx.axf.kernel.asset.Layout.fromJson(a.data); Row(Modifier.size(44.dp, 30.dp).border(1.dp, c.border, Axf.shapes.xsShape).padding(2.dp), horizontalArrangement = Arrangement.spacedBy(2.dp)) {
            if (l.nav == ai.amberx.axf.kernel.asset.NavSide.LEFT) Box(Modifier.size(8.dp, 24.dp).background(c.accentSoft))
            Box(Modifier.weight(1f).height(24.dp).background(c.surface3))
            if (l.inspector == ai.amberx.axf.kernel.asset.InspectorSide.RIGHT) Box(Modifier.size(8.dp, 24.dp).background(c.accentSoft))
        } }
        else -> AxfIcon(runtime().registry.types.get(a.type)?.icon ?: "box", size = 22.dp, tint = c.accent, contentDescription = null)
    }
}

@Composable private fun runtime(): ai.amberx.axf.kernel.runtime.AxfRuntime = LocalAxfRuntime.current
