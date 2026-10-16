package ai.amberx.axf.logging

import ai.amberx.axf.kernel.platform.LogLevel
import ai.amberx.axf.ui.LocalAxfActions
import ai.amberx.axf.ui.LocalAxfKernel
import ai.amberx.axf.ui.LocalAxfRuntime
import ai.amberx.axf.ui.components.AxfButton
import ai.amberx.axf.ui.components.AxfCard
import ai.amberx.axf.ui.components.AxfContainer
import ai.amberx.axf.ui.components.AxfChip
import ai.amberx.axf.ui.components.AxfEmptyState
import ai.amberx.axf.ui.components.AxfPageHead
import ai.amberx.axf.ui.components.AxfText
import ai.amberx.axf.ui.components.AxfTextField
import ai.amberx.axf.ui.theme.Axf
import androidx.compose.foundation.layout.Arrangement
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

/** Live log viewer with level/tag/text filters, copy/share via the clipboard, crash test and diagnostics. Register it as the `logs` view. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
public fun LogsScreen(modifier: Modifier = Modifier) {
    val kernel = LocalAxfKernel.current
    val runtime = LocalAxfRuntime.current
    val actions = LocalAxfActions.current
    val engine = remember(kernel) { kernel?.services?.get<LogEngine>() }
    if (engine == null) { AxfEmptyState("Logging unavailable", message = "LoggingModule is not installed."); return }
    val entries by engine.entries.collectAsState()
    var level by remember { mutableStateOf(LogLevel.VERBOSE) }
    var text by remember { mutableStateOf("") }
    var tag by remember { mutableStateOf<String?>(null) }
    val tags = remember(entries.size) { entries.map { it.tag }.distinct().sorted().take(30) }
    val shown = entries.filter { it.level >= level && (tag == null || it.tag == tag) && (text.isBlank() || it.message.contains(text, true) || it.tag.contains(text, true)) }
    LazyColumn(modifier.fillMaxWidth(), contentPadding = PaddingValues(Axf.space.two), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        item { AxfPageHead("Logs", eyebrow = "${entries.size} in buffer · ${shown.size} shown", actions = {
            AxfButton("Copy", { actions.copy(engine.export()); actions.toast("Log copied to clipboard.") }, icon = "copy")
            AxfButton("Clear", { engine.clear() }, icon = "trash")
            AxfButton("Crash test", { actions.dispatch("logs.crashTest") }, icon = "bug", requires = "dev.tools")
        }) }
        item { AxfTextField(text, { text = it }, Modifier.fillMaxWidth(), placeholder = "Filter…", leadingIcon = "search") }
        item { FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            for (l in LogLevel.entries) AxfChip(l.name, selected = l == level, onClick = { level = l }, tone = when (l) { LogLevel.ERROR, LogLevel.ASSERT -> "danger"; LogLevel.WARN -> "warning"; else -> null })
        } }
        if (tags.isNotEmpty()) item { FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) { AxfChip("all tags", selected = tag == null, onClick = { tag = null }); for (t in tags) AxfChip(t, selected = t == tag, onClick = { tag = if (tag == t) null else t }) } }
        item { DiagnosticsCard() }
        if (shown.isEmpty()) item { AxfEmptyState("No log lines", message = "Nothing matches the current filters.") }
        for (e in shown.asReversed()) item {
            val c = Axf.colors
            val color = when (e.level) { LogLevel.ERROR, LogLevel.ASSERT -> c.danger; LogLevel.WARN -> c.warning; LogLevel.INFO -> c.text; else -> c.muted }
            Column { AxfText(e.format().lineSequence().first(), mono = true, color = color); if (e.throwable != null) AxfText(e.throwable!!.stackTraceToString().take(400), mono = true, muted = true) }
        }
    }
}

/** Device / build / modules / storage snapshot (the diagnostics interface). */
@Composable
public fun DiagnosticsCard(modifier: Modifier = Modifier) {
    val kernel = LocalAxfKernel.current
    val host = kernel?.platform?.host
    val st = remember(kernel, kernel?.started) { kernel?.status() }
    AxfContainer(modifier, title = "Diagnostics", icon = "info", style = ai.amberx.axf.ui.LocalAxfStyles.current.container.copy(collapsible = true), initiallyOpen = false) {
        for ((k, v) in listOfNotNull(
            host?.let { "Device" to "${it.device} · Android ${it.osVersion}" }, host?.let { "App" to "${it.appId} ${it.appVersion}${if (it.debug) " (debug)" else ""}" }, host?.let { "Locale" to it.locale },
            st?.let { "Kernel" to "${it.frameworkVersion} api ${it.apiLevel} · ${if (it.started) "started in ${it.startupMillis} ms" else "starting"}" },
            st?.let { "Modules" to "${it.modules.size} · ${it.modules.count { m -> m.placeholder }} placeholders" }, st?.let { "Assets" to it.assetCounts.values.sum().toString() },
            "Memory" to "${(Runtime.getRuntime().totalMemory() - Runtime.getRuntime().freeMemory()) / 1_048_576} MB used of ${Runtime.getRuntime().maxMemory() / 1_048_576} MB",
        )) Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) { AxfText(k, Modifier.weight(0.35f), muted = true); AxfText(v, Modifier.weight(0.65f)) }
    }
}
