package ai.amberx.axf.ui.windows

import ai.amberx.axf.kernel.asset.AssetTypes
import ai.amberx.axf.kernel.contract.Corner
import ai.amberx.axf.kernel.contract.MinimizeMode
import ai.amberx.axf.kernel.contract.SplitMode
import ai.amberx.axf.ui.LocalAxfRuntime
import ai.amberx.axf.ui.components.AxfButton
import ai.amberx.axf.ui.components.AxfChip
import ai.amberx.axf.ui.components.AxfSlider
import ai.amberx.axf.ui.components.AxfSwitch
import ai.amberx.axf.ui.components.AxfText
import ai.amberx.axf.ui.components.ButtonTone
import ai.amberx.axf.ui.theme.Axf
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

/** "Custom grid…" from the Split submenu: choose rows × cols; the group's tabs are distributed evenly across the cells. */
@Composable
public fun SplitGridDialog(groupId: String) {
    val runtime = LocalAxfRuntime.current
    val wm = LocalWindowManager.current ?: run { AxfText("Windows engine not installed."); return }
    var rows by remember { mutableFloatStateOf(2f) }
    var cols by remember { mutableFloatStateOf(2f) }
    val tabs = wm.current.groups[groupId]?.tabs?.size ?: 0
    val parts = wm.distribute((1..tabs).toList(), (rows.toInt() * cols.toInt()).coerceAtLeast(1))
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        AxfText("Define the grid. $tabs tab(s) spread evenly: ${parts.joinToString(" · ") { "${it.size}" }}", muted = true)
        AxfSlider("Rows", rows, { rows = it }, min = 1f, max = 4f)
        AxfSlider("Columns", cols, { cols = it }, min = 1f, max = 4f)
        Column(Modifier.fillMaxWidth().border(1.dp, Axf.colors.border, Axf.shapes.smShape), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            for (r in 0 until rows.toInt()) Row(Modifier.fillMaxWidth().height(28.dp), horizontalArrangement = Arrangement.spacedBy(2.dp)) { for (c in 0 until cols.toInt()) Box(Modifier.weight(1f).height(28.dp).background(Axf.colors.accentSoft), contentAlignment = Alignment.Center) { AxfText("${parts.getOrNull(r * cols.toInt() + c)?.size ?: 0}", muted = true) } }
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End)) {
            AxfButton("Cancel", { runtime.closeDialog() })
            AxfButton("Split", { wm.split(groupId, SplitMode.GRID, rows.toInt(), cols.toInt()); runtime.closeDialog() }, tone = ButtonTone.PRIMARY, icon = "grid")
        }
    }
}

/** Window settings: minimize corner + mode (stacked / lined-up title bars), toolbar asset override, always on top, opacity. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
public fun WindowSettingsDialog(windowId: String) {
    val runtime = LocalAxfRuntime.current
    val wm = LocalWindowManager.current ?: run { AxfText("Windows engine not installed."); return }
    val st by wm.state.collectAsState()
    val w = st.windows.firstOrNull { it.id == windowId } ?: run { AxfText("Window closed."); return }
    var s by remember(windowId) { mutableStateOf(w.settings) }
    val toolbars = remember { runtime.registry.list(AssetTypes.TOOLBAR) }
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        AxfText("${w.title} · ${w.type.name.lowercase()} window", muted = true)
        AxfText("Minimize to corner")
        FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) { for (c in Corner.entries) AxfChip(c.name.lowercase().replace('_', ' '), selected = s.corner == c, onClick = { s = s.copy(corner = c) }) }
        AxfText("Minimized title bars")
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) { AxfChip("stacked", selected = s.mode == MinimizeMode.STACKED, onClick = { s = s.copy(mode = MinimizeMode.STACKED) }); AxfChip("lined up", selected = s.mode == MinimizeMode.LINED, onClick = { s = s.copy(mode = MinimizeMode.LINED) }) }
        AxfText("Toolbar (toolbars ${if (w.toolbarsAllowed) "allowed; forced on while floating" else "not allowed by this window's schema"})")
        FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            AxfChip("default (built-in)", selected = s.toolbarAsset == null, onClick = { s = s.copy(toolbarAsset = null) })
            for (t in toolbars) AxfChip(t.name, selected = s.toolbarAsset == t.id, onClick = { s = s.copy(toolbarAsset = t.id) })
        }
        AxfSwitch(s.alwaysOnTop, { s = s.copy(alwaysOnTop = it) }, label = "Always on top")
        AxfSlider("Opacity", s.opacity * 100, { s = s.copy(opacity = it / 100f) }, min = 30f, max = 100f, unit = "%")
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End)) {
            AxfButton("Cancel", { runtime.closeDialog() })
            AxfButton("Apply", { wm.setSettings(windowId, s); runtime.closeDialog() }, tone = ButtonTone.PRIMARY, icon = "check")
        }
    }
}
