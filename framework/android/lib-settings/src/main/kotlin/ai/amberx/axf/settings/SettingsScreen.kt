package ai.amberx.axf.settings

import ai.amberx.axf.kernel.contract.SettingsGroup
import ai.amberx.axf.kernel.contract.SettingsTab
import ai.amberx.axf.kernel.plugins.PluginInventoryHost
import ai.amberx.axf.ui.LocalAxfKernel
import ai.amberx.axf.ui.components.AxfBadge
import ai.amberx.axf.ui.components.AxfCard
import ai.amberx.axf.ui.components.AxfChip
import ai.amberx.axf.ui.components.AxfEmptyState
import ai.amberx.axf.ui.components.AxfListItem
import ai.amberx.axf.ui.components.AxfPageHead
import ai.amberx.axf.ui.components.AxfText
import ai.amberx.axf.ui.components.AxfTextField
import ai.amberx.axf.ui.settings.SettingsGroupView
import ai.amberx.axf.ui.theme.Axf
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch

/**
 * The generated settings interface (web: framework/libs/settings). Standard tabs Appearance, General, Plugins, About
 * (same ids as the web port); a group picks its tab with `SettingsGroup.tab` (default: `appearance`/`about` by group id,
 * else `general`). A tab whose id is a `SettingsTab.parent` of others shows a sub-tab row: every plugin's settings are a
 * sub-tab of Plugins (Brett's rule), never a top-level tab. The Plugins tab also lists every installed module with its
 * health, straight from the plugin inventory engine (plugin-inventory@1), so every app ships a plugin list even without
 * the Plugin Manager module. Register it as the `settings` view.
 */
public object SettingsTabs {
    public val APPEARANCE: SettingsTab = SettingsTab("appearance", "Appearance", "palette", 10)
    public val GENERAL: SettingsTab = SettingsTab("general", "General", "settings", 20)
    public val PLUGINS: SettingsTab = SettingsTab("plugins", "Plugins", "package", 40, "Libraries and plugins installed in this app.")
    public val ABOUT: SettingsTab = SettingsTab("about", "About", "info", 90)
    public val STANDARD: List<SettingsTab> = listOf(APPEARANCE, GENERAL, PLUGINS, ABOUT)

    /** The tab a group belongs to (web: `group.tab ?? 'general'`, with the framework's appearance/about groups placed by id). */
    public fun tabOf(g: SettingsGroup): String = g.tab ?: when (g.id) { "appearance" -> APPEARANCE.id; "about" -> ABOUT.id; else -> GENERAL.id }

    /** Standard tabs + every tab a group names; unknown ids become tabs under Plugins (a plugin's own tab is always a sub-tab there). */
    public fun tabs(groups: List<SettingsGroup>, extra: List<SettingsTab>): List<SettingsTab> {
        val known = (STANDARD + extra).associateBy { it.id }.toMutableMap()
        for (g in groups) { val id = tabOf(g); if (id !in known) known[id] = SettingsTab(id, g.label, g.icon, 100, parent = PLUGINS.id) }
        return known.values.sortedBy { it.order }
    }
}

@Composable
public fun SettingsScreen(modifier: Modifier = Modifier, title: String = "Settings", extraTabs: List<SettingsTab> = emptyList()) {
    val kernel = LocalAxfKernel.current
    val engine = remember(kernel) { kernel?.services?.get<SettingsEngine>() }
    if (engine == null) { AxfEmptyState("Settings unavailable", message = "SettingsModule is not installed."); return }
    val groups by engine.groups.collectAsState()
    val values by engine.values.collectAsState()
    val scope = rememberCoroutineScope()
    var filter by remember { mutableStateOf("") }
    val tabs = remember(groups, extraTabs) { SettingsTabs.tabs(groups, extraTabs) }
    val top = tabs.filter { t -> t.parent == null || tabs.none { it.id == t.parent } }
    var tab by remember { mutableStateOf(SettingsTabs.APPEARANCE.id) }
    val subTabs = tabs.filter { it.parent == tab }
    var sub by remember { mutableStateOf("") }
    val shown = if (sub.isEmpty()) tab else sub
    val searching = filter.isNotBlank()
    val visible = if (searching) groups else groups.filter { SettingsTabs.tabOf(it) == shown }
    val description = tabs.firstOrNull { it.id == shown }?.description
    val focus by engine.focusRequest.collectAsState()
    val listState = androidx.compose.foundation.lazy.rememberLazyListState()
    var scrollTo by remember { mutableStateOf<String?>(null) }
    // A search pick (settings.open:<group>[:<key>]) opens the group's tab (a plugin's tab is a sub-tab of its parent),
    // filters to the setting when one is named, then scrolls to the group once the list has recomposed.
    androidx.compose.runtime.LaunchedEffect(focus, groups) {
        val f = focus ?: return@LaunchedEffect
        val (group, key) = f
        val g = groups.firstOrNull { it.id == group || (key != null && it.settings.any { s -> s.key == key }) }
        if (g != null) {
            val t = SettingsTabs.tabOf(g)
            val parent = tabs.firstOrNull { it.id == t }?.parent
            if (parent != null && tabs.any { it.id == parent }) { tab = parent; sub = t } else { tab = t; sub = "" }
            filter = if (key != null) g.settings.firstOrNull { it.key == key }?.label ?: "" else ""
            scrollTo = g.id
        }
        engine.clearFocus()
    }
    androidx.compose.runtime.LaunchedEffect(scrollTo, visible, searching, subTabs.size, description) {
        val target = scrollTo ?: return@LaunchedEffect
        val i = visible.indexOfFirst { it.id == target }
        if (i >= 0) {
            val head = 2 + if (searching) 0 else 1 + (if (subTabs.isNotEmpty()) 1 else 0) + (if (description != null) 1 else 0)
            listState.animateScrollToItem(head + i)
        }
        scrollTo = null
    }
    LazyColumn(modifier.fillMaxWidth(), state = listState, contentPadding = PaddingValues(Axf.space.two), verticalArrangement = Arrangement.spacedBy(Axf.space.oneHalf)) {
        item { AxfPageHead(title, eyebrow = "${groups.size} groups", description = "Generated from the settings schema every module contributes.") }
        item { AxfTextField(filter, { filter = it }, Modifier.fillMaxWidth(), placeholder = "Search settings…", leadingIcon = "search") }
        if (!searching) {
            item { Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) { for (t in top) AxfChip(t.label, icon = t.icon, selected = tab == t.id, onClick = { tab = t.id; sub = "" }) } }
            if (subTabs.isNotEmpty()) item {
                Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    AxfChip(if (tab == SettingsTabs.PLUGINS.id) "All plugins" else "Overview", selected = sub.isEmpty(), onClick = { sub = "" })
                    for (t in subTabs) AxfChip(t.label, icon = t.icon, selected = sub == t.id, onClick = { sub = t.id })
                }
            }
            description?.let { d -> item { AxfText(d, muted = true) } }
        }
        for (g in visible) item(key = g.id) { SettingsGroupView(g, values, { k, v -> scope.launch { engine.set(k, v) } }, filter = filter) }
        if (!searching && shown == SettingsTabs.PLUGINS.id) item(key = "axf.plugins.installed") { InstalledModulesPanel() }
        if (!searching && visible.isEmpty() && shown != SettingsTabs.PLUGINS.id) item { AxfText("Nothing here yet.", muted = true) }
    }
}

/** Every module in the kernel with its health (plugin-inventory@1); the Plugin Manager module opens the full view. */
@Composable
public fun InstalledModulesPanel(modifier: Modifier = Modifier) {
    val kernel = LocalAxfKernel.current ?: return
    val runtime = ai.amberx.axf.ui.LocalAxfRuntime.current
    val inv = remember(kernel, kernel.started) { PluginInventoryHost.inventory(kernel.modules.info(), extensions = kernel.extensions, hasCapability = { kernel.services.hasCapability(it) }) }
    val hasManager = kernel.services.hasCapability("axf.plugin-manager")
    AxfCard(modifier, title = "Installed modules", icon = "box", actions = { if (hasManager) AxfChip("Plugin Manager", icon = "package", onClick = { runtime.dispatch("plugin-manager.open") }) }) {
        Column {
            for (i in inv.items) AxfListItem(i.name, subtitle = "${i.record.id} · ${i.record.version}" + (if (i.dependents.isNotEmpty()) " · used by ${i.dependents.size}" else ""), icon = if (i.record.error != null) "alert" else "layers",
                onClick = if (hasManager) ({ runtime.dispatch("plugin-manager.open:${i.folder}") }) else null,
                trailing = { AxfBadge(i.health.id, tone = when (i.health.id) { "ok" -> "success"; "partial" -> "warning"; "off" -> "muted"; else -> "danger" }) })
            if (inv.conflicts.isNotEmpty()) AxfText("${inv.conflicts.size} clash${if (inv.conflicts.size > 1) "es" else ""}: ${inv.conflicts.joinToString { it.id }}", muted = true)
        }
    }
}
