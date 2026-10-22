package ai.amberx.axf.patches.views

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.BasicText
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import ai.amberx.axf.hub.WebAppHolder
import ai.amberx.axf.hub.WebAppView
import ai.amberx.axf.kernel.engine.EmbedTakes
import ai.amberx.axf.patches.AppModule
import ai.amberx.axf.settings.SettingsScreen
import ai.amberx.axf.ui.icons.AxfIcon
import ai.amberx.axf.ui.components.AxfText
import ai.amberx.axf.ui.theme.Axf
import kotlinx.coroutines.delay

/**
 * Patches' combined Settings (Brett, Oct 21 2026): one settings with a tab per app — Patches, Console, Pilot, axHub.
 * Patches' own tab is the framework's settings screen; each app's tab is that app's own settings page (embed@1 page
 * mode: `axf-embed-page=settings`, the page alone) in a web view kept in the activity's [WebAppHolder] under
 * `settings:<app>`, so a tab opened once stays as it was. The apps themselves show no settings hooks inside Patches
 * (it takes their settings over); when one asks for its settings it lands here, on its own tab (and the tab it named).
 */
@Composable
fun CombinedSettings(holder: WebAppHolder, module: AppModule) {
    val want by module.settingsApp.collectAsState()
    val theme = Axf.theme
    val c = theme.colors
    // Web views made only for the app tabs opened so far.
    val opened = remember { mutableStateListOf<String>() }
    LaunchedEffect(want.app) { if (want.app != "patches" && want.app !in opened) opened += want.app }
    // An app asked for one of its own tabs: tell its settings page (again shortly after, in case it was still loading).
    LaunchedEffect(want.at) {
        val tab = want.tab ?: return@LaunchedEffect
        val json = EmbedTakes.openTab(tab) ?: return@LaunchedEffect
        for (wait in listOf(0L, 800L, 1700L)) { delay(wait); holder.send("settings:${want.app}", json) }
    }
    Column(Modifier.fillMaxSize()) {
        Row(
            Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 8.dp, vertical = 6.dp),
            horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically,
        ) {
            for ((id, label, icon) in AppModule.SETTINGS_APPS) {
                val active = id == want.app
                Row(
                    Modifier.background(if (active) c.accent else c.surface, theme.shapes.full)
                        .border(theme.spacing.borderWidth, if (active) c.accent else c.border, theme.shapes.full)
                        .clickable(role = Role.Tab) { module.settingsApp.value = module.settingsApp.value.copy(app = id, tab = null) }
                        .padding(horizontal = 12.dp, vertical = 6.dp),
                    verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    AxfIcon(icon, size = 15.dp, tint = if (active) c.bg else c.muted, contentDescription = null)
                    BasicText(label, style = theme.typography.bodyMedium.copy(color = if (active) c.bg else c.text))
                }
            }
        }
        Box(Modifier.weight(1f).fillMaxWidth()) {
            if (want.app == "patches") SettingsScreen(title = "Patches settings")
            for (app in opened) {
                if (app != want.app) continue // only the one in front is attached; the holder keeps the others' pages alive
                val url = module.settingsUrl(app)
                if (url == null) AxfText("No address for this app. Set one on the Patches tab.", muted = true)
                else WebAppView(holder = holder, tab = "settings:$app", url = url, origins = module.origins(app))
            }
        }
    }
}
