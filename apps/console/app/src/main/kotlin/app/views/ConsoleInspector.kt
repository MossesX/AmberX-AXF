package ai.amberx.axf.console.views

import ai.amberx.axf.console.Status
import ai.amberx.axf.kernel.asset.AssetTypes
import ai.amberx.axf.ui.LocalAxfActions
import ai.amberx.axf.ui.LocalAxfCompiled
import ai.amberx.axf.ui.LocalAxfKernel
import ai.amberx.axf.ui.LocalAxfState
import ai.amberx.axf.ui.components.AxfBadge
import ai.amberx.axf.ui.components.AxfButton
import ai.amberx.axf.ui.components.AxfInspector
import ai.amberx.axf.ui.components.AxfListItem
import ai.amberx.axf.ui.components.AxfSectionHeader
import ai.amberx.axf.ui.components.AxfText
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

/** The right-hand inspector (desktop/tablet) or bottom sheet (phone): active assets with quick swaps, coverage, role. */
@Composable
fun ConsoleInspector() {
    val state = LocalAxfState.current
    val compiled = LocalAxfCompiled.current
    val actions = LocalAxfActions.current
    val kernel = LocalAxfKernel.current
    val repo = rememberRepo()
    AxfInspector(title = "Inspector", icon = "layers") {
        AxfSectionHeader("Active assets", accent = true)
        for (t in listOf(AssetTypes.COLOR_THEME, AssetTypes.STYLE_THEME, AssetTypes.LAYOUT, AssetTypes.NAV_MENU, AssetTypes.BUTTON, AssetTypes.CONTAINER, AssetTypes.UI_KIT)) {
            val id = state.active[t] ?: continue
            AxfListItem(id, subtitle = t, icon = kernel?.types?.get(t)?.icon ?: "box", onClick = { actions.dispatch("swap:$t:next") }, trailing = { AxfBadge("next") })
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp)) { AxfButton("Random", { actions.dispatch("assets.random") }, icon = "shuffle"); AxfButton("Reset", { actions.dispatch("assets.reset") }, icon = "refresh") }
        AxfSectionHeader("Role", accent = true)
        AxfText("${state.role} · ${compiled.policy.gating.name.lowercase()} gating", muted = true)
        if (repo != null) {
            val tracker by repo.tracker.collectAsState()
            AxfSectionHeader("Coverage", accent = true)
            for (tab in listOf("foundations", "kernel", "console", "modules", "demos")) { val c = repo.coverage(tab); val total = c.values.sum().coerceAtLeast(1); Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) { AxfText(tab); AxfText("${(c[Status.BUILT] ?: 0) * 100 / total}% built", muted = true) } }
            AxfText("tracker ${tracker.generatedAt.take(10)}", muted = true)
        }
    }
}
