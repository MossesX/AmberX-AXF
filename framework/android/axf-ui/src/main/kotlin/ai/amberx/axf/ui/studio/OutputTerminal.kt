package ai.amberx.axf.ui.studio

import ai.amberx.axf.kernel.runtime.TerminalLevel
import ai.amberx.axf.kernel.runtime.TerminalLine
import ai.amberx.axf.ui.LocalAxfActions
import ai.amberx.axf.ui.LocalAxfRuntime
import ai.amberx.axf.ui.components.AxfBadge
import ai.amberx.axf.ui.components.AxfChip
import ai.amberx.axf.ui.components.AxfIconButton
import ai.amberx.axf.ui.components.AxfText
import ai.amberx.axf.ui.theme.Axf
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

/**
 * The output terminal pane: every install / import / hot-swap / fallback line, newest at the bottom, auto-scrolling
 * while the user is at the end (scrolling up pauses it; the "follow" chip resumes). Channel chips filter. Rendered
 * as the `terminal` tab kind (floating window / dock) and the `terminal` dialog; apps embed it anywhere.
 */
@Composable
public fun OutputTerminalPane(modifier: Modifier = Modifier, channel: String? = null) {
    val runtime = LocalAxfRuntime.current
    val actions = LocalAxfActions.current
    val all by runtime.terminal.lines.collectAsState()
    var filter by remember { mutableStateOf(channel) }
    val lines = remember(all, filter) { if (filter == null) all else all.filter { it.channel == filter } }
    val state = rememberLazyListState()
    var follow by remember { mutableStateOf(true) }
    val atEnd by remember { derivedStateOf { val info = state.layoutInfo; info.totalItemsCount == 0 || info.visibleItemsInfo.lastOrNull()?.index == info.totalItemsCount - 1 } }
    LaunchedEffect(atEnd, state.isScrollInProgress) { if (state.isScrollInProgress) follow = atEnd }
    LaunchedEffect(lines.size, follow) { if (follow && lines.isNotEmpty()) state.animateScrollToItem(lines.size - 1) }
    val c = Axf.colors
    Column(modifier.fillMaxSize().background(c.codeBg)) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 4.dp), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
            AxfChip("all", selected = filter == null, onClick = { filter = null })
            for (ch in runtime.terminal.channels()) AxfChip(ch, selected = filter == ch, onClick = { filter = ch })
            androidx.compose.foundation.layout.Spacer(Modifier.weight(1f))
            AxfBadge("${lines.size}", tone = "accent")
            AxfIconButton(if (follow) "arrow-down" else "pause", if (follow) "Following output" else "Resume auto-scroll", { follow = true }, active = follow)
            AxfIconButton("copy", "Copy output", { actions.copy(runtime.terminal.export()); runtime.toast("Terminal output copied.") })
            AxfIconButton("trash", "Clear", { runtime.terminal.clear() })
        }
        LazyColumn(Modifier.fillMaxSize().padding(horizontal = 8.dp), state = state, verticalArrangement = Arrangement.spacedBy(1.dp)) {
            itemsIndexed(lines, key = { i, l -> "${l.at}-$i" }) { _, l -> TerminalRow(l) }
            if (lines.isEmpty()) item { AxfText("— no output yet —", Modifier.padding(8.dp), color = c.muted, mono = true) }
        }
    }
}

@Composable
private fun TerminalRow(l: TerminalLine) {
    val c = Axf.colors
    val color = when (l.level) { TerminalLevel.OK -> c.success; TerminalLevel.WARN -> c.warning; TerminalLevel.ERROR -> c.danger; TerminalLevel.NOTE -> c.info; TerminalLevel.INFO -> c.codeText }
    val mark = when (l.level) { TerminalLevel.OK -> "✓"; TerminalLevel.WARN -> "!"; TerminalLevel.ERROR -> "✗"; TerminalLevel.NOTE -> "·"; TerminalLevel.INFO -> " " }
    val time = java.text.SimpleDateFormat("HH:mm:ss", java.util.Locale.US).format(java.util.Date(l.at))
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        AxfText(time, color = c.muted, mono = true, style = Axf.type.labelSmall)
        AxfText("[${l.channel}]", color = c.muted, mono = true, style = Axf.type.labelSmall)
        AxfText("$mark ${l.text}", Modifier.weight(1f), color = color, mono = true, style = Axf.type.bodySmall)
    }
}
