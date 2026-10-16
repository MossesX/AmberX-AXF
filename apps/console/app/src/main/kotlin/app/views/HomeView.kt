package ai.amberx.axf.console.views

import ai.amberx.axf.console.ConsoleModule
import ai.amberx.axf.console.Status
import ai.amberx.axf.ui.LocalAxfActions
import ai.amberx.axf.ui.LocalAxfKernel
import ai.amberx.axf.ui.LocalAxfRuntime
import ai.amberx.axf.ui.LocalAxfState
import ai.amberx.axf.ui.components.AxfBadge
import ai.amberx.axf.ui.components.AxfButton
import ai.amberx.axf.ui.components.AxfCard
import ai.amberx.axf.ui.components.AxfEmptyState
import ai.amberx.axf.ui.components.AxfListItem
import ai.amberx.axf.ui.components.AxfPageHead
import ai.amberx.axf.ui.components.AxfText
import ai.amberx.axf.ui.components.ButtonTone
import ai.amberx.axf.ui.theme.Axf
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

/** Landing dashboard: coverage per tab, kernel summary, quick links. */
@Composable
fun HomeView() {
    val repo = rememberRepo()
    val kernel = LocalAxfKernel.current
    val runtime = LocalAxfRuntime.current
    val actions = LocalAxfActions.current
    val state = LocalAxfState.current
    if (repo == null) { AxfEmptyState("Console data missing", message = "assets/axf/console was not bundled."); return }
    val tracker by repo.tracker.collectAsState()
    val overrides by repo.overrides.collectAsState()
    val st = kernel?.status()
    LazyColumn(Modifier.fillMaxWidth(), contentPadding = PaddingValues(Axf.space.two), verticalArrangement = Arrangement.spacedBy(Axf.space.oneHalf)) {
        item { AxfPageHead("AXF Dev Console", eyebrow = "AmberX AXF ${ConsoleModule.VERSION} · android port · tracker ${tracker.generatedAt.take(10)}", description = "The first app on the Android port. It tracks what the framework has, assembles libraries from the feature catalog, generates demo apps and manages boilerplates.", actions = {
            AxfButton("Tracker", { runtime.navigate("tracker") }, tone = ButtonTone.PRIMARY, icon = "list")
            AxfButton("Export plan", { actions.dispatch("console.exportPlan") }, icon = "copy")
        }) }
        item { AxfCard(title = "Coverage", icon = "chart") { Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            for (tab in listOf("foundations" to "Foundations", "kernel" to "Kernel", "console" to "Console", "modules" to "Modules", "demos" to "Demos")) {
                val c = repo.coverage(tab.first); val total = c.values.sum().coerceAtLeast(1)
                Column { Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) { AxfText(tab.second); AxfText("${c[Status.BUILT]} built · ${c[Status.PARTIAL]} partial · ${c[Status.PLACEHOLDER]} placeholder · ${c[Status.PLANNED]} planned", muted = true) }
                    Row(Modifier.fillMaxWidth().height(8.dp).background(Axf.colors.surface3, Axf.shapes.full)) {
                        for ((s, w) in listOf(Status.BUILT to Axf.colors.success, Status.PARTIAL to Axf.colors.info, Status.PLACEHOLDER to Axf.colors.warning)) { val n = c[s] ?: 0; if (n > 0) Box(Modifier.weight(n.toFloat() / total).height(8.dp).background(w)) }
                        val rest = c[Status.PLANNED] ?: 0; if (rest > 0) Box(Modifier.weight(rest.toFloat() / total).height(8.dp))
                    }
                }
            }
            if (overrides.isNotEmpty()) AxfText("${overrides.size} status edit(s) on this device — export status.json to commit them.", muted = true)
        } } }
        item { AxfCard(title = "Kernel", icon = "layers", actions = { AxfButton("Details", { runtime.navigate("devtools") }, icon = "bug", requires = "dev.tools") }) { Column {
            if (st != null) for ((k, v) in listOf("Modules" to "${st.modules.size} (${st.modules.count { it.placeholder }} placeholders)", "Extension points" to "${st.extensionPoints.count { it.second > 0 }}/${st.extensionPoints.size} filled", "Placeholders in use" to st.placeholders.size.toString(), "Assets" to st.assetCounts.values.sum().toString(), "Role" to state.role, "Startup" to "${st.startupMillis} ms"))
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) { AxfText(k, muted = true); AxfText(v) }
        } } }
        item { AxfCard(title = "Workbench", icon = "grid") { Column {
            for (r in ConsoleModule.ROUTES.drop(1)) AxfListItem(r.label, icon = r.icon, subtitle = r.group, onClick = { runtime.navigate(r.id) })
            for ((id, label, icon) in listOf(Triple("settings", "Settings interface", "settings"), Triple("logs", "Logging interface", "terminal"), Triple("account", "Account interface", "user"), Triple("profile", "Profile interface", "user"), Triple("subscription", "Subscription interface", "star"), Triple("admin", "Administration interface", "shield"))) AxfListItem(label, icon = icon, subtitle = "library interface", onClick = { runtime.navigate(id) }, trailing = { if (id in setOf("account", "profile", "subscription", "admin")) AxfBadge("placeholder", tone = "warning") })
        } } }
    }
}
