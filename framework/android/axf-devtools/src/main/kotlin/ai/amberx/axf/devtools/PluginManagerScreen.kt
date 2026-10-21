package ai.amberx.axf.devtools

import ai.amberx.axf.devtools.PluginManagerModule.Companion.FILTERS
import ai.amberx.axf.devtools.PluginManagerModule.Companion.KEY_FILTER
import ai.amberx.axf.devtools.PluginManagerModule.Companion.KEY_LAYOUT
import ai.amberx.axf.devtools.PluginManagerModule.Companion.KEY_SELECTED
import ai.amberx.axf.devtools.PluginManagerModule.Companion.KEY_SORT
import ai.amberx.axf.devtools.PluginManagerModule.Companion.KEY_VIEW
import ai.amberx.axf.devtools.PluginManagerModule.Companion.LAYOUTS
import ai.amberx.axf.devtools.PluginManagerModule.Companion.SORTS
import ai.amberx.axf.devtools.PluginManagerModule.Companion.VIEWS
import ai.amberx.axf.kernel.contract.PluginInfo
import ai.amberx.axf.kernel.contract.PluginState
import ai.amberx.axf.kernel.contract.RouteSpec
import ai.amberx.axf.kernel.contract.SettingsGroup
import ai.amberx.axf.kernel.module.ExtensionPoints
import ai.amberx.axf.kernel.module.RouteContribution
import ai.amberx.axf.kernel.module.SettingsContribution
import ai.amberx.axf.kernel.plugins.Conflict
import ai.amberx.axf.kernel.plugins.ConflictSeverity
import ai.amberx.axf.kernel.plugins.Dependency
import ai.amberx.axf.kernel.plugins.DependencyKind
import ai.amberx.axf.kernel.plugins.DependencyStatus
import ai.amberx.axf.kernel.plugins.PluginHealth
import ai.amberx.axf.kernel.plugins.PluginInventory
import ai.amberx.axf.kernel.plugins.PluginInventoryEngine
import ai.amberx.axf.kernel.plugins.PluginInventoryItem
import ai.amberx.axf.kernel.runtime.ToastKind
import ai.amberx.axf.ui.LocalAxfKernel
import ai.amberx.axf.ui.LocalAxfRuntime
import ai.amberx.axf.ui.components.AxfBadge
import ai.amberx.axf.ui.components.AxfButton
import ai.amberx.axf.ui.components.AxfCard
import ai.amberx.axf.ui.components.AxfChip
import ai.amberx.axf.ui.components.AxfEmptyState
import ai.amberx.axf.ui.components.AxfListItem
import ai.amberx.axf.ui.components.AxfPageHead
import ai.amberx.axf.ui.components.AxfSectionHeader
import ai.amberx.axf.ui.components.AxfSegmented
import ai.amberx.axf.ui.components.AxfText
import ai.amberx.axf.ui.components.AxfTextField
import ai.amberx.axf.ui.components.ButtonTone
import ai.amberx.axf.ui.theme.Axf
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.LifecycleResumeEffect
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch

/*
 * The Plugin Manager screen (Android). Four views in four layouts, built differently (not just recoloured), reading
 * only theme tokens (Axf.colors / Axf.space / Axf.type), like the web plugin's Studio / Mission control / Terminal /
 * Catalog. Register it as the `plugin-manager` view (and the `plugin-manager.window` dialog) in the app's AppShell.
 * Compose previews for the CI screenshot job are named `PluginManager_<layout>_<view>` (see Previews below).
 */

/** Saved choices, re-read whenever the screen opens or resumes (UI-editor rule: last save wins, fresh on focus). */
public class PluginManagerPrefs internal constructor(private val svc: PluginManagerService?) {
    public var layout: String by mutableStateOf("studio")
    public var view: String by mutableStateOf("grid")
    public var filter: String by mutableStateOf("all")
    public var sort: String by mutableStateOf("name")
    public var selected: String by mutableStateOf("")
    public fun reload() {
        svc?.refresh()
        layout = svc?.choice(KEY_LAYOUT, LAYOUTS, "studio") ?: "studio"
        view = svc?.choice(KEY_VIEW, VIEWS, "grid") ?: "grid"
        filter = svc?.choice(KEY_FILTER, FILTERS, "all") ?: "all"
        sort = svc?.choice(KEY_SORT, SORTS, "name") ?: "name"
        selected = svc?.selected() ?: ""
    }
    public fun set(key: String, value: String) {
        svc?.save(key, value) // per-key save: other keys untouched
        when (key) { KEY_LAYOUT -> layout = value; KEY_VIEW -> view = value; KEY_FILTER -> filter = value; KEY_SORT -> sort = value; KEY_SELECTED -> selected = value }
    }
}

@Composable
public fun PluginManagerScreen(modifier: Modifier = Modifier, embedded: Boolean = false) {
    val kernel = LocalAxfKernel.current
    val svc = remember(kernel) { kernel?.services?.get<PluginManagerService>() }
    val prefs = remember(svc) { PluginManagerPrefs(svc).also { it.reload() } }
    var tick by remember { mutableIntStateOf(0) }
    LifecycleResumeEffect(svc) { prefs.reload(); tick++; onPauseOrDispose { } }
    val loaderPlugins by (svc?.loader()?.plugins ?: remember { MutableStateFlow(emptyList<PluginInfo>()) }).collectAsState(emptyList())
    val inv = remember(svc, tick, loaderPlugins, kernel?.started) { svc?.inventory(loaderPlugins) ?: PluginInventory(emptyList(), emptyList(), ai.amberx.axf.kernel.plugins.InventoryCounts(0, 0, 0, 0, 0, 0)) }
    if (svc == null) { AxfEmptyState("Plugin Manager unavailable", message = "Add PluginManagerModule to the app's modules."); return }
    var query by remember { mutableStateOf("") }
    val rows = remember(inv, prefs.filter, prefs.sort, query) { rowsOf(inv, prefs.filter, prefs.sort, query) }
    val host = PmHost(inv, rows, prefs, query, { query = it }, { tick++ }, embedded)
    Box(modifier.fillMaxWidth()) {
        when (prefs.layout) {
            "mission" -> MissionLayout(host)
            "terminal" -> TerminalLayout(host)
            "catalog" -> CatalogLayout(host)
            else -> StudioLayout(host)
        }
    }
}

internal class PmHost(val inv: PluginInventory, val rows: List<PluginInventoryItem>, val prefs: PluginManagerPrefs, val query: String, val setQuery: (String) -> Unit, val reload: () -> Unit, val embedded: Boolean) {
    val selected: PluginInventoryItem? get() = inv.item(prefs.selected)
    fun select(folder: String) = prefs.set(KEY_SELECTED, folder)
}

internal fun matches(r: PluginInventoryItem, f: String): Boolean = when (f) {
    "enabled" -> r.enabled
    "off" -> !r.enabled
    "editors" -> r.record.uiEditor.isNotEmpty()
    "problems" -> r.health == PluginHealth.ERROR || r.health == PluginHealth.BLOCKED || r.health == PluginHealth.PARTIAL || r.conflicts.isNotEmpty()
    else -> true
}

internal fun rowsOf(inv: PluginInventory, filter: String, sort: String, q: String): List<PluginInventoryItem> {
    val needle = q.trim().lowercase()
    val rows = inv.items.filter { r -> matches(r, filter) && (needle.isEmpty() || listOf(r.name, r.record.id, r.folder, *r.record.provides.toTypedArray()).any { it.lowercase().contains(needle) }) }
    return when (sort) {
        "health" -> rows.sortedWith(compareBy({ it.health.rank }, { it.name }))
        "deps" -> rows.sortedWith(compareByDescending<PluginInventoryItem> { it.dependents.size }.thenBy { it.name })
        else -> rows.sortedBy { it.name }
    }
}

internal val PluginHealth.label: String get() = when (this) { PluginHealth.OK -> "Healthy"; PluginHealth.PARTIAL -> "Partly set up"; PluginHealth.OFF -> "Off"; PluginHealth.BLOCKED -> "Blocked"; PluginHealth.ERROR -> "Error" }
internal val PluginHealth.tone: String get() = when (this) { PluginHealth.OK -> "success"; PluginHealth.PARTIAL -> "warning"; PluginHealth.OFF -> "muted"; else -> "danger" }
internal fun DependencyStatus.tone(): String = when (this) {
    DependencyStatus.OK, DependencyStatus.SET -> "success"
    DependencyStatus.MISSING, DependencyStatus.UNSUPPORTED, DependencyStatus.ERROR -> "danger"
    DependencyStatus.DISABLED, DependencyStatus.UNSET, DependencyStatus.OPTIONAL_MISSING, DependencyStatus.NOT_LOADED -> "warning"
    DependencyStatus.GRANTED -> "accent"
    DependencyStatus.DECLARED -> "muted"
}
@Composable internal fun toneColor(tone: String): Color = when (tone) { "success" -> Axf.colors.success; "warning" -> Axf.colors.warning; "danger" -> Axf.colors.danger; "accent" -> Axf.colors.accent; else -> Axf.colors.muted }
internal fun monogram(name: String): String = name.split(' ', '-').filter { it.isNotBlank() }.take(2).joinToString("") { it.first().uppercase() }

/* ---------------- shared pieces ---------------- */

@Composable internal fun Monogram(item: PluginInventoryItem, size: Int = 36) {
    Box(Modifier.size(size.dp).background(toneColor(item.health.tone).copy(alpha = 0.18f), Axf.shapes.smShape).border(1.dp, toneColor(item.health.tone).copy(alpha = 0.5f), Axf.shapes.smShape), contentAlignment = Alignment.Center) {
        AxfText(monogram(item.name), style = if (size >= 48) Axf.type.titleMedium else Axf.type.labelMedium, color = toneColor(item.health.tone))
    }
}

@Composable internal fun HealthChip(item: PluginInventoryItem) { AxfBadge(item.health.label, tone = item.health.tone) }

@Composable internal fun Pickers(h: PmHost, iconsOnly: Boolean = false) {
    Column(verticalArrangement = Arrangement.spacedBy(Axf.space.one)) {
        AxfSegmented(VIEWS, h.prefs.view, { h.prefs.set(KEY_VIEW, it) }, pills = true)
        AxfSegmented(LAYOUTS, h.prefs.layout, { h.prefs.set(KEY_LAYOUT, it) }, pills = true)
    }
}

@Composable internal fun ViewBody(h: PmHost) {
    when (h.prefs.view) {
        "table" -> TableView(h)
        "detail" -> MasterDetailView(h)
        "graph" -> GraphView(h)
        else -> CardsView(h)
    }
}

/** Open the plugin's first route, or say why not. Compiled modules have no enable switch; loader plugins do. */
@Composable internal fun QuickActions(item: PluginInventoryItem, h: PmHost, compact: Boolean = false) {
    val runtime = LocalAxfRuntime.current
    val kernel = LocalAxfKernel.current
    val scope = rememberCoroutineScope()
    val svc = kernel?.services?.get<PluginManagerService>()
    val loader = svc?.loader()
    val isPlugin = loader?.info(item.record.id) != null
    val routes = remember(kernel, item.folder) { kernel?.extensions?.contributions(ExtensionPoints.ROUTES)?.filter { it.module == item.folder }?.map { (it.value as RouteContribution).route } ?: emptyList() }
    val groups = remember(kernel, item.folder) { kernel?.extensions?.contributions(ExtensionPoints.SETTINGS)?.filter { it.module == item.folder }?.map { (it.value as SettingsContribution).group } ?: emptyList() }
    Row(horizontalArrangement = Arrangement.spacedBy(Axf.space.one)) {
        if (isPlugin) AxfButton(if (compact) null else if (item.enabled) "Disable" else "Enable", {
            scope.launch {
                val r = if (item.enabled) loader!!.disable(item.record.id) else loader!!.enable(item.record.id, loader.info(item.record.id)?.granted ?: emptySet())
                if (r.isOk) { runtime.toast("${if (item.enabled) "Disabled" else "Enabled"} ${item.name}.", ToastKind.SUCCESS, "Plugins"); h.reload() } else runtime.toast(r.failureOrNull()?.message ?: "Could not change the plugin.", ToastKind.DANGER, "Plugins")
            }
        }, tone = if (item.enabled) ButtonTone.NEUTRAL else ButtonTone.PRIMARY, icon = if (item.enabled) "pause" else "play")
        if (routes.isNotEmpty()) AxfButton(if (compact) null else "Open", { if (item.enabled) runtime.navigate(routes.first().id) else runtime.toast("${item.name} is off. Enable it to open its UI.", ToastKind.WARNING, "Plugin Manager") }, tone = ButtonTone.GHOST, icon = "external", enabled = item.enabled)
        if (groups.isNotEmpty()) AxfButton(if (compact) null else "Settings", { runtime.navigate("settings") }, tone = ButtonTone.GHOST, icon = "settings", enabled = item.enabled)
    }
}

/* ---------------- views ---------------- */

@OptIn(ExperimentalLayoutApi::class)
@Composable internal fun CardsView(h: PmHost, items: List<PluginInventoryItem> = h.rows) {
    if (items.isEmpty()) { AxfEmptyState("No plugins match"); return }
    Column(verticalArrangement = Arrangement.spacedBy(Axf.space.one)) {
        for (r in items) {
            val selected = r.folder == h.prefs.selected
            AxfCard(Modifier.fillMaxWidth().border(1.dp, if (selected) Axf.colors.accent else Color.Transparent, Axf.shapes.mdShape).clickable { h.select(r.folder) }, ctxTarget = "plugin-manager.row", ctxPayload = r.folder) {
                Row(horizontalArrangement = Arrangement.spacedBy(Axf.space.oneHalf), verticalAlignment = Alignment.CenterVertically) {
                    Monogram(r)
                    Column(Modifier.weight(1f)) {
                        Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) { AxfText(r.name, style = Axf.type.titleSmall); AxfText(r.record.version, muted = true, style = Axf.type.labelSmall) }
                        AxfText(r.record.id, muted = true, mono = true, maxLines = 1)
                    }
                    QuickActions(r, h, compact = true)
                }
                FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    HealthChip(r)
                    val needs = r.dependencies.count { it.kind == DependencyKind.SERVICE || it.kind == DependencyKind.PLUGIN }
                    if (needs > 0) AxfChip("needs $needs", icon = "branch")
                    if (r.dependents.isNotEmpty()) AxfChip("used by ${r.dependents.size}", icon = "layers")
                    if (r.record.uiEditor.isNotEmpty()) AxfChip("editor: ${r.record.uiEditor.joinToString()}", tone = "accent")
                    if (r.conflicts.isNotEmpty()) AxfChip("${r.conflicts.size} clash${if (r.conflicts.size > 1) "es" else ""}", tone = "warning", icon = "alert")
                }
            }
        }
    }
}

@Composable internal fun TableView(h: PmHost) {
    if (h.rows.isEmpty()) { AxfEmptyState("No plugins match"); return }
    var sortCol by remember { mutableStateOf("name") }
    var dir by remember { mutableIntStateOf(1) }
    val sorted = remember(h.rows, sortCol, dir) {
        val c: Comparator<PluginInventoryItem> = when (sortCol) {
            "health" -> compareBy { it.health.rank }; "state" -> compareBy { if (it.enabled) 1 else 0 }
            "needs" -> compareBy { it.dependencies.count { d -> d.kind == DependencyKind.SERVICE || d.kind == DependencyKind.PLUGIN } }
            "usedBy" -> compareBy { it.dependents.size }; else -> compareBy { it.name.lowercase() }
        }
        if (dir == 1) h.rows.sortedWith(c) else h.rows.sortedWith(c.reversed())
    }
    val cols = listOf("name" to "Plugin", "health" to "Health", "state" to "State", "needs" to "Needs", "usedBy" to "Used by")
    Column(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState())) {
        Row(Modifier.padding(vertical = 4.dp), horizontalArrangement = Arrangement.spacedBy(Axf.space.one)) {
            for ((id, label) in cols) AxfChip(label + if (sortCol == id) (if (dir == 1) " ↑" else " ↓") else "", selected = sortCol == id, onClick = { if (sortCol == id) dir = -dir else { sortCol = id; dir = 1 } })
        }
        for (r in sorted) {
            val selected = r.folder == h.prefs.selected
            Row(Modifier.fillMaxWidth().background(if (selected) Axf.colors.accentSoft else Color.Transparent, Axf.shapes.xsShape).clickable { h.select(r.folder) }.padding(horizontal = Axf.space.one, vertical = 6.dp), horizontalArrangement = Arrangement.spacedBy(Axf.space.one), verticalAlignment = Alignment.CenterVertically) {
                Monogram(r, 24)
                Column(Modifier.width(180.dp)) { AxfText(r.name, style = Axf.type.labelLarge, maxLines = 1); AxfText(r.folder, muted = true, mono = true, style = Axf.type.labelSmall, maxLines = 1) }
                Box(Modifier.width(96.dp)) { HealthChip(r) }
                Box(Modifier.width(56.dp)) { AxfText(if (h.prefs.layout == "terminal") (if (r.enabled) "[ ON ]" else "[OFF ]") else if (r.enabled) "on" else "off", mono = h.prefs.layout == "terminal") }
                AxfText(r.dependencies.count { it.kind == DependencyKind.SERVICE || it.kind == DependencyKind.PLUGIN }.toString(), Modifier.width(48.dp))
                AxfText(r.dependents.size.toString(), Modifier.width(56.dp))
            }
        }
    }
}

@Composable internal fun MasterDetailView(h: PmHost) {
    if (h.rows.isEmpty()) { AxfEmptyState("No plugins match"); return }
    val row = h.rows.firstOrNull { it.folder == h.prefs.selected } ?: h.rows.first()
    Column(verticalArrangement = Arrangement.spacedBy(Axf.space.one)) {
        Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            for (r in h.rows) AxfChip(r.name, selected = r.folder == row.folder, onClick = { h.select(r.folder) }, tone = if (r.health == PluginHealth.OK) null else r.health.tone)
        }
        DetailPane(row, h)
    }
}

@Composable internal fun GraphView(h: PmHost) {
    if (h.rows.isEmpty()) { AxfEmptyState("No plugins match"); return }
    val g = remember(h.rows, h.inv) { PluginInventoryEngine.graph(h.rows, h.inv.items.flatMap { i -> i.record.services.map { ai.amberx.axf.kernel.plugins.LiveService(it, i.folder, i.enabled) } }) }
    val c = Axf.colors
    val focus = h.prefs.selected.takeIf { it.isNotEmpty() }?.let { "p:$it" }
    val linked = focus?.let { f -> setOf(f) + g.edges.filter { it.from == f || it.to == f }.flatMap { listOf(it.from, it.to) } } ?: emptySet()
    val rowH = 23.dp; val colW = 170.dp; val nodeW = 150.dp; val nodeH = 30.dp
    Column(verticalArrangement = Arrangement.spacedBy(Axf.space.one)) {
        Row(horizontalArrangement = Arrangement.spacedBy(Axf.space.one)) { AxfChip("provides", tone = "success"); AxfChip("requires", tone = "accent"); AxfChip("optional"); AxfChip("missing / provider off", tone = "danger") }
        Box(Modifier.horizontalScroll(rememberScrollState()).width(colW * 3 + nodeW).height(rowH * (g.rows + 2))) {
            Canvas(Modifier.fillMaxWidth().height(rowH * (g.rows + 2))) {
                val pos = g.nodes.associate { it.id to Offset(colW.toPx() * it.column, rowH.toPx() * it.row + nodeH.toPx() / 2) }
                for (e in g.edges) {
                    val a = pos[e.from] ?: continue; val b = pos[e.to] ?: continue
                    val x1 = if (a.x < b.x) a.x + nodeW.toPx() else a.x; val x2 = if (a.x < b.x) b.x else b.x + nodeW.toPx()
                    val mx = (x1 + x2) / 2
                    val dim = focus != null && !(e.from in linked && e.to in linked)
                    val color = (if (e.broken) c.danger else when (e.kind) { PluginInventoryEngine.EdgeKind.PROVIDES -> c.success; PluginInventoryEngine.EdgeKind.REQUIRES -> c.accent; PluginInventoryEngine.EdgeKind.OPTIONAL -> c.muted }).copy(alpha = if (dim) 0.15f else 0.9f)
                    drawPath(Path().apply { moveTo(x1, a.y); cubicTo(mx, a.y, mx, b.y, x2, b.y) }, color, style = Stroke(width = 2f))
                }
            }
            for (n in g.nodes) {
                val dim = focus != null && n.id !in linked
                val item = n.folder?.let { h.inv.item(it) }
                val border = if (n.missing) c.danger else item?.let { toneColor(it.health.tone) } ?: c.border
                Box(Modifier.padding(start = colW * n.column, top = rowH * n.row).size(nodeW, nodeH)
                    .background(if (n.kind == PluginInventoryEngine.NodeKind.SERVICE) c.surface2 else c.surface, if (n.kind == PluginInventoryEngine.NodeKind.SERVICE) Axf.shapes.full else Axf.shapes.smShape)
                    .border(1.dp, border.copy(alpha = if (dim) 0.3f else 1f), if (n.kind == PluginInventoryEngine.NodeKind.SERVICE) Axf.shapes.full else Axf.shapes.smShape)
                    .clickable(enabled = n.folder != null) { n.folder?.let { h.select(it) } }.padding(horizontal = 8.dp), contentAlignment = Alignment.CenterStart) {
                    AxfText(n.label, style = Axf.type.labelMedium, color = if (dim) c.muted else c.text, maxLines = 1)
                }
            }
        }
        h.selected?.let { s ->
            AxfCard(title = s.name) {
                for (d in s.dependencies.filter { it.kind == DependencyKind.SERVICE || it.kind == DependencyKind.PLUGIN }) AxfListItem(d.name, subtitle = (if (d.required) "requires" else "optional") + " · " + d.status.label, icon = "branch")
                for (d in s.dependents) AxfListItem("used by ${d.name}", subtitle = d.service, icon = "layers")
                if (s.dependencies.none { it.kind == DependencyKind.SERVICE || it.kind == DependencyKind.PLUGIN } && s.dependents.isEmpty()) AxfText("Standalone: no capability links.", muted = true)
            }
        }
    }
}

/* ---------------- detail ---------------- */

@OptIn(ExperimentalLayoutApi::class)
@Composable internal fun DetailPane(item: PluginInventoryItem, h: PmHost) {
    var tab by remember(item.folder) { mutableStateOf("overview") }
    val conflicts = h.inv.conflicts.filter { item.folder in it.folders }
    Column(verticalArrangement = Arrangement.spacedBy(Axf.space.oneHalf)) {
        Row(horizontalArrangement = Arrangement.spacedBy(Axf.space.oneHalf), verticalAlignment = Alignment.CenterVertically) {
            Monogram(item, 48)
            Column(Modifier.weight(1f)) {
                AxfText("${item.name} ${item.record.version}", style = Axf.type.titleMedium)
                AxfText(item.record.id, muted = true, mono = true, maxLines = 1)
                FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    HealthChip(item)
                    AxfBadge(if (item.enabled) "enabled" else "disabled", tone = if (item.enabled) "success" else "muted")
                    if (item.record.uiEditor.isNotEmpty()) AxfBadge("UI editor: ${item.record.uiEditor.joinToString()}")
                    if (conflicts.isNotEmpty()) AxfBadge("${conflicts.size} clash${if (conflicts.size > 1) "es" else ""}", tone = "warning")
                }
            }
        }
        QuickActions(item, h)
        AxfSegmented(listOf("overview" to "Overview", "deps" to "Dependencies", "ui" to "UI & settings", "clashes" to "Clashes"), tab, { tab = it }, pills = true)
        when (tab) {
            "deps" -> DependenciesTab(item, h)
            "ui" -> UiTab(item)
            "clashes" -> ConflictList(conflicts)
            else -> OverviewTab(item, conflicts)
        }
    }
}

@Composable internal fun Fact(k: String, v: String) { Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) { AxfText(k, Modifier.weight(0.35f), muted = true); AxfText(v, Modifier.weight(0.65f)) } }

@Composable internal fun OverviewTab(item: PluginInventoryItem, conflicts: List<Conflict>) {
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        item.record.error?.let { AxfText(it, color = Axf.colors.danger, mono = true) }
        Fact("Kind", "plugin@1 API ${item.record.apiLevel ?: "?"}")
        Fact("Provides", item.record.provides.ifEmpty { listOf("—") }.joinToString())
        Fact("Services live", item.record.services.ifEmpty { listOf("—") }.joinToString())
        Fact("Scopes", item.record.scopes.ifEmpty { listOf("—") }.joinToString())
        Fact("Needed by", item.dependents.map { it.name }.ifEmpty { listOf("nothing") }.joinToString())
        if (conflicts.isNotEmpty()) ConflictList(conflicts)
    }
}

@Composable internal fun DependenciesTab(item: PluginInventoryItem, h: PmHost) {
    val blocking = item.blocking
    Column(verticalArrangement = Arrangement.spacedBy(Axf.space.one)) {
        AxfText((if (blocking.isNotEmpty()) "${blocking.size} required dependenc${if (blocking.size > 1) "ies are" else "y is"} not met." else "Every required dependency is met.") + " " + (if (item.dependents.isNotEmpty()) "${item.dependents.size} plugin${if (item.dependents.size > 1) "s" else ""} use${if (item.dependents.size > 1) "" else "s"} it." else "No other plugin uses it."), muted = true)
        AxfSectionHeader("Needs", accent = true)
        for ((kind, deps) in item.dependencies.groupBy { it.kind }) {
            AxfText(kind.id.replaceFirstChar { it.uppercase() }, muted = true, style = Axf.type.labelSmall)
            for (d in deps) DependencyRow(d, h)
        }
        AxfSectionHeader("Needed by", accent = true)
        if (item.dependents.isEmpty()) AxfText("Nothing depends on it, so it can be switched off or removed without affecting other plugins.", muted = true)
        for (d in item.dependents) AxfListItem(d.name, subtitle = (if (d.required) "requires" else "optional") + " · " + d.service + " · " + (if (d.required) "Switching ${item.name} off stops ${d.name} from working." else "Without ${item.name}, ${d.name} hides the features that use ${d.service}."), icon = "layers", onClick = { h.select(d.folder) })
    }
}

@Composable internal fun DependencyRow(d: Dependency, h: PmHost) {
    val tone = toneColor(d.status.tone())
    Column(Modifier.fillMaxWidth().border(1.dp, tone.copy(alpha = 0.4f), Axf.shapes.smShape).padding(Axf.space.one), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
            AxfText(d.name, Modifier.weight(1f), mono = true, maxLines = 1)
            AxfBadge(if (d.required) "required" else "optional", tone = "muted")
            AxfBadge(d.status.label, tone = d.status.tone())
        }
        AxfText(d.detail, muted = true, style = Axf.type.bodySmall)
        if (!d.providers.isNullOrEmpty()) Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            AxfText("Provided by", muted = true, style = Axf.type.labelSmall)
            for (p in d.providers) AxfChip(p.name + (if (p.enabled) "" else " (off)") + (if (!p.live) " · not registered yet" else ""), onClick = { h.select(p.folder) })
        }
    }
}

@Composable internal fun UiTab(item: PluginInventoryItem) {
    val kernel = LocalAxfKernel.current
    val runtime = LocalAxfRuntime.current
    val routes: List<RouteSpec> = remember(kernel, item.folder) { kernel?.extensions?.contributions(ExtensionPoints.ROUTES)?.filter { it.module == item.folder }?.map { (it.value as RouteContribution).route } ?: emptyList() }
    val groups: List<SettingsGroup> = remember(kernel, item.folder) { kernel?.extensions?.contributions(ExtensionPoints.SETTINGS)?.filter { it.module == item.folder }?.map { (it.value as SettingsContribution).group } ?: emptyList() }
    Column(verticalArrangement = Arrangement.spacedBy(Axf.space.one)) {
        AxfSectionHeader("Its UI", accent = true)
        if (routes.isEmpty()) AxfText("No screen of its own.", muted = true)
        for (r in routes) AxfListItem(r.label, subtitle = "screen · ${r.id}", icon = r.icon ?: "layout", enabled = item.enabled, onClick = { runtime.navigate(r.id) }, trailing = { AxfBadge("open") })
        AxfSectionHeader("Its settings", accent = true)
        if (groups.isEmpty()) AxfText("No settings.", muted = true)
        for (g in groups) AxfListItem(g.label, subtitle = "Settings → ${g.tab ?: "Plugins"} · ${g.settings.size} setting${if (g.settings.size == 1) "" else "s"}", icon = g.icon, enabled = item.enabled, onClick = { runtime.navigate("settings") }, trailing = { AxfBadge("open") })
        if (!item.enabled && (routes.isNotEmpty() || groups.isNotEmpty())) AxfText("It's off: enable it to open its UI and settings.", muted = true)
    }
}

@Composable internal fun ConflictList(conflicts: List<Conflict>) {
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        AxfSectionHeader("Clashes", accent = true)
        if (conflicts.isEmpty()) AxfText("No clashes.", muted = true)
        for (c in conflicts) {
            val tone = when (c.severity) { ConflictSeverity.ERROR -> Axf.colors.danger; ConflictSeverity.WARN -> Axf.colors.warning; ConflictSeverity.INFO -> Axf.colors.accent }
            Column(Modifier.fillMaxWidth().border(1.dp, tone.copy(alpha = 0.5f), Axf.shapes.smShape).padding(Axf.space.one)) {
                AxfText("${c.kind} ${c.key} · ${c.folders.joinToString()}", style = Axf.type.labelLarge)
                AxfText(c.detail, muted = true, style = Axf.type.bodySmall)
            }
        }
        AxfText("Read-only for now: the conflict alarm with uninstall / ignore / AI patch is pending item plugin-conflicts.", muted = true, style = Axf.type.labelSmall)
    }
}

/* ---------------- 1. Studio: filter rail (chips on phones) + main + drawer below ---------------- */

@Composable internal fun StudioLayout(h: PmHost) {
    val sel = h.selected
    LazyColumn(Modifier.fillMaxWidth(), contentPadding = PaddingValues(Axf.space.two), verticalArrangement = Arrangement.spacedBy(Axf.space.oneHalf)) {
        item { AxfPageHead("Plugins", eyebrow = "Plugin Manager · Studio", description = "${h.inv.counts.total} installed · ${h.inv.counts.enabled} running") }
        item { Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) { for ((id, label) in FILTERS) AxfChip("$label ${h.inv.items.count { matches(it, id) }}", selected = h.prefs.filter == id, onClick = { h.prefs.set(KEY_FILTER, id) }) } }
        item { AxfTextField(h.query, h.setQuery, Modifier.fillMaxWidth(), placeholder = "Find a plugin, id or capability", leadingIcon = "search") }
        item { Pickers(h) }
        item { Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) { for ((id, label) in SORTS) AxfChip("Sort: $label", selected = h.prefs.sort == id, onClick = { h.prefs.set(KEY_SORT, id) }) } }
        item { ViewBody(h) }
        if (sel != null && h.prefs.view != "detail") item { AxfCard(title = sel.name, icon = "info", actions = { AxfButton(null, { h.prefs.set(KEY_SELECTED, "") }, icon = "x", tone = ButtonTone.GHOST) }) { DetailPane(sel, h) } }
    }
}

/* ---------------- 2. Mission control: status tiles + board + signals ---------------- */

internal data class Signal(val id: String, val tone: String, val title: String, val text: String, val folder: String?)

internal fun signalsOf(inv: PluginInventory): List<Signal> = buildList {
    for (r in inv.items) {
        r.record.error?.let { add(Signal("e:${r.folder}", "danger", "${r.name} failed to load", it, r.folder)) }
        for (d in r.blocking) add(Signal("d:${r.folder}:${d.name}", "danger", "${r.name} is blocked", "${d.name}: ${d.detail}", r.folder))
        val unset = r.dependencies.filter { it.kind == DependencyKind.ENV && it.status == DependencyStatus.UNSET }.map { it.name }
        if (unset.isNotEmpty()) add(Signal("v:${r.folder}", "warning", "${r.name}: ${unset.size} setting${if (unset.size > 1) "s" else ""} not set", unset.joinToString(), r.folder))
    }
    for (c in inv.conflicts) add(Signal("c:${c.id}", when (c.severity) { ConflictSeverity.ERROR -> "danger"; ConflictSeverity.WARN -> "warning"; ConflictSeverity.INFO -> "accent" }, "Clash: ${c.key}", "${c.folders.joinToString(" × ")} · ${c.detail}", c.folders.firstOrNull()))
}

@OptIn(ExperimentalLayoutApi::class)
@Composable internal fun MissionLayout(h: PmHost) {
    val c = h.inv.counts
    val signals = remember(h.inv) { signalsOf(h.inv) }
    val sel = h.selected
    val tiles = listOf(Triple("Installed", c.total.toString(), "all"), Triple("Running", "${c.enabled}/${c.total}", "enabled"), Triple("Errors", c.errors.toString(), "problems"), Triple("Blocked", c.missingDeps.toString(), "problems"), Triple("Clashes", c.conflicts.toString(), "problems"), Triple("Editors", c.editors.toString(), "editors"))
    LazyColumn(Modifier.fillMaxWidth(), contentPadding = PaddingValues(Axf.space.two), verticalArrangement = Arrangement.spacedBy(Axf.space.oneHalf)) {
        item { AxfPageHead("Mission control", eyebrow = "Plugin ops", actions = { AxfButton("Rescan", h.reload, icon = "refresh", tone = ButtonTone.PRIMARY) }) }
        item { FlowRow(horizontalArrangement = Arrangement.spacedBy(Axf.space.one), verticalArrangement = Arrangement.spacedBy(Axf.space.one)) {
            for ((label, value, filter) in tiles) {
                val tone = when { label == "Errors" && c.errors > 0 -> Axf.colors.danger; label == "Blocked" && c.missingDeps > 0 -> Axf.colors.danger; label == "Clashes" && c.conflicts > 0 -> Axf.colors.warning; label == "Running" -> Axf.colors.success; else -> Axf.colors.border }
                Column(Modifier.width(104.dp).background(Axf.colors.surface2, Axf.shapes.smShape).border(1.dp, if (h.prefs.filter == filter) Axf.colors.accent else tone.copy(alpha = 0.6f), Axf.shapes.smShape).clickable { h.prefs.set(KEY_FILTER, filter) }.padding(Axf.space.one)) {
                    AxfText(value, style = Axf.type.titleLarge, mono = true); AxfText(label, muted = true, style = Axf.type.labelSmall)
                }
            }
        } }
        item { Pickers(h) }
        item { AxfTextField(h.query, h.setQuery, Modifier.fillMaxWidth(), placeholder = "Filter board", leadingIcon = "search") }
        item { AxfSectionHeader("Board · ${h.rows.size}", accent = true) }
        item { ViewBody(h) }
        if (sel != null && h.prefs.view != "detail") item { AxfCard(title = "Focus") { DetailPane(sel, h) } }
        item { AxfSectionHeader("Signals · ${signals.size}", accent = true) }
        if (signals.isEmpty()) item { AxfListItem("All systems nominal.", icon = "check") }
        for (s in signals) item(key = s.id) { AxfListItem(s.title, subtitle = s.text, icon = if (s.tone == "danger") "alert" else "info", onClick = { s.folder?.let { h.select(it) } }, trailing = { AxfBadge(s.tone, tone = s.tone) }) }
        item { AxfSectionHeader("Capability bus", accent = true) }
        item { FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            val live = h.inv.items.flatMap { i -> i.record.services.map { it to i.enabled } }
            if (live.isEmpty()) AxfText("No live services.", muted = true)
            for ((name, on) in live) AxfChip(name, tone = if (on) "success" else null)
        } }
    }
}

/* ---------------- 3. Terminal: monospace with a command line ---------------- */

internal data class Out(val kind: String, val text: String)

@Composable internal fun TerminalLayout(h: PmHost) {
    val runtime = LocalAxfRuntime.current
    val c = Axf.colors
    var hist by remember { mutableStateOf(listOf(Out("out", "AXF plugin manager · ${h.inv.counts.total} plugins, ${h.inv.counts.enabled} running. Type \"help\"."))) }
    var cmd by remember { mutableStateOf("") }
    fun print(lines: List<String>, kind: String = "out") { hist = (hist + lines.map { Out(kind, it) }).takeLast(300) }
    val kernel = LocalAxfKernel.current
    val routeOf = remember(kernel, h.inv) { h.inv.items.associate { i -> i.folder to kernel?.extensions?.contributions(ExtensionPoints.ROUTES)?.firstOrNull { it.module == i.folder }?.let { (it.value as RouteContribution).route.id } } }
    fun find(a: String?) = h.inv.items.firstOrNull { it.folder == a || it.name.equals(a ?: "", true) || it.record.id == a }
    fun run(raw: String) {
        val line = raw.trim(); if (line.isEmpty()) return
        hist = hist + Out("in", line)
        val parts = line.split(Regex("\\s+")); val cName = parts[0].lowercase(); val a = parts.getOrNull(1); val row = find(a)
        when (cName) {
            "help" -> print(listOf("ls                      list plugins          view grid|table|detail|graph", "select <plugin>         show details          layout studio|mission|terminal|catalog", "deps <plugin>           dependencies          filter all|enabled|off|problems|editors", "open <plugin>           open its UI           clashes              list conflicts", "refresh | clear"))
            "ls" -> print(h.rows.map { "${if (it.enabled) "[ ON ]" else "[OFF ]"} ${it.folder.padEnd(32)} ${it.record.version.padEnd(7)} ${it.health.label.padEnd(14)} ${it.name}" })
            "view" -> if (VIEWS.any { it.first == a }) { h.prefs.set(KEY_VIEW, a!!); print(listOf("view → $a")) } else print(listOf("unknown view \"${a ?: ""}\""), "err")
            "layout" -> if (LAYOUTS.any { it.first == a }) { h.prefs.set(KEY_LAYOUT, a!!); print(listOf("layout → $a")) } else print(listOf("unknown layout \"${a ?: ""}\""), "err")
            "filter" -> if (FILTERS.any { it.first == a }) { h.prefs.set(KEY_FILTER, a!!); print(listOf("filter → $a")) } else print(listOf("unknown filter \"${a ?: ""}\""), "err")
            "select", "cd", "info" -> if (row != null) { h.select(row.folder); print(listOf("${row.name} ${row.record.version} · ${row.health.label} · ${row.record.id}")) } else print(listOf("no plugin \"${a ?: ""}\""), "err")
            "deps" -> if (row == null) print(listOf("no plugin \"${a ?: ""}\""), "err") else print(listOf("${row.name} needs:") + row.dependencies.map { "  ${if (it.required) "req" else "opt"}  ${it.kind.id.padEnd(9)} ${it.name.padEnd(26)} ${it.status.id.padEnd(16)} ${it.providers?.joinToString(", ") { p -> p.name } ?: ""}" } + listOf("${row.name} is needed by:${if (row.dependents.isEmpty()) " nothing" else ""}") + row.dependents.map { "  ${if (it.required) "req" else "opt"}  ${it.name} via ${it.service}" })
            "open" -> if (row == null) print(listOf("no plugin \"${a ?: ""}\""), "err") else routeOf[row.folder]?.let { runtime.navigate(it); print(listOf("opened ${row.name}")) } ?: print(listOf("${row.name} has no screen"), "err")
            "clashes" -> print(if (h.inv.conflicts.isEmpty()) listOf("no clashes") else h.inv.conflicts.map { "${it.severity.id.padEnd(5)} ${it.kind}:${it.key}  ${it.folders.joinToString(" × ")}" })
            "refresh" -> { h.reload(); print(listOf("rescanned")) }
            "clear" -> hist = emptyList()
            else -> print(listOf("$cName: command not found (try \"help\")"), "err")
        }
    }
    Column(Modifier.fillMaxWidth().background(c.surface).padding(Axf.space.two), verticalArrangement = Arrangement.spacedBy(Axf.space.one)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            for (t in listOf(c.danger, c.warning, c.success)) Box(Modifier.size(10.dp).background(t, Axf.shapes.full))
            AxfText("pm — ${h.prefs.view} — ${h.rows.size}/${h.inv.counts.total}", mono = true, muted = true)
        }
        Pickers(h)
        ViewBody(h)
        h.selected?.takeIf { h.prefs.view != "detail" }?.let { DetailPane(it, h) }
        Column(Modifier.fillMaxWidth().background(c.surface2, Axf.shapes.smShape).padding(Axf.space.one)) {
            for (o in hist) AxfText(if (o.kind == "in") "$ ${o.text}" else o.text, mono = true, color = when (o.kind) { "err" -> c.danger; "in" -> c.accent; else -> c.text }, style = Axf.type.code)
        }
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            AxfText("axf@device:~/plugins$", mono = true, color = c.success)
            AxfTextField(cmd, { cmd = it }, Modifier.weight(1f), monospace = true, placeholder = "help", keyboardActions = androidx.compose.foundation.text.KeyboardActions(onDone = { run(cmd); cmd = "" }), keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(imeAction = androidx.compose.ui.text.input.ImeAction.Done))
            AxfButton(null, { run(cmd); cmd = "" }, icon = "chevron-right", tone = ButtonTone.GHOST)
        }
    }
}

/* ---------------- 4. Catalog: hero + shelves + product page ---------------- */

@Composable internal fun CatalogLayout(h: PmHost) {
    val sel = h.selected
    if (sel != null && h.prefs.view != "detail") {
        LazyColumn(Modifier.fillMaxWidth(), contentPadding = PaddingValues(Axf.space.two), verticalArrangement = Arrangement.spacedBy(Axf.space.oneHalf)) {
            item { AxfButton("All plugins", { h.prefs.set(KEY_SELECTED, "") }, icon = "arrow-left", tone = ButtonTone.GHOST) }
            item { DetailPane(sel, h) }
        }
        return
    }
    val featured = remember(h.inv) { h.inv.items.sortedWith(compareByDescending<PluginInventoryItem> { it.dependents.size }.thenByDescending { it.enabled }).firstOrNull() }
    val shelves = listOf(
        Triple("providers", "Capability providers") { r: PluginInventoryItem -> r.record.provides.any { it.startsWith("service:") } },
        Triple("pages", "Tools with their own screen") { r: PluginInventoryItem -> r.record.provides.any { it.startsWith("view:") } && r.record.provides.none { it.startsWith("service:") } },
        Triple("helpers", "Background helpers") { r: PluginInventoryItem -> r.record.provides.none { it.startsWith("view:") || it.startsWith("service:") } },
    )
    LazyColumn(Modifier.fillMaxWidth(), contentPadding = PaddingValues(Axf.space.two), verticalArrangement = Arrangement.spacedBy(Axf.space.oneHalf)) {
        item { AxfPageHead("Plugin catalog", eyebrow = "Catalog") }
        item { AxfTextField(h.query, h.setQuery, Modifier.fillMaxWidth(), placeholder = "Search the catalog", leadingIcon = "search") }
        item { Pickers(h) }
        if (featured != null && h.query.isEmpty()) item {
            Row(Modifier.fillMaxWidth().background(Axf.colors.accentSoft, Axf.shapes.mdShape).padding(Axf.space.two), horizontalArrangement = Arrangement.spacedBy(Axf.space.two), verticalAlignment = Alignment.CenterVertically) {
                Monogram(featured, 56)
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    AxfText("Featured · used by ${featured.dependents.size}", muted = true, style = Axf.type.labelSmall)
                    AxfText(featured.name, style = Axf.type.titleLarge)
                    AxfText(featured.record.id, muted = true, mono = true, maxLines = 1)
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) { HealthChip(featured); AxfButton("Details", { h.select(featured.folder) }, icon = "info", tone = ButtonTone.PRIMARY) }
                }
            }
        }
        item { Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) { for ((id, label) in FILTERS) AxfChip(label, selected = h.prefs.filter == id, onClick = { h.prefs.set(KEY_FILTER, id) }) } }
        if (h.prefs.view == "grid") {
            for ((id, label, test) in shelves) {
                val rows = h.rows.filter(test)
                if (rows.isEmpty()) continue
                item(key = "shelf-$id") { AxfSectionHeader("$label · ${rows.size}", accent = true) }
                item(key = "cards-$id") { CardsView(h, rows) }
            }
        } else item { ViewBody(h) }
        if (h.inv.conflicts.isNotEmpty() && h.prefs.filter == "problems") item { ConflictList(h.inv.conflicts) }
    }
}
