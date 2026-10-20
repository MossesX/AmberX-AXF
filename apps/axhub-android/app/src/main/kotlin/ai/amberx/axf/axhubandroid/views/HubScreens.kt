package ai.amberx.axf.axhubandroid.views

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import ai.amberx.axf.axhubandroid.hub.HubAddress
import ai.amberx.axf.axhubandroid.hub.HubClient
import ai.amberx.axf.axhubandroid.hub.HubState
import ai.amberx.axf.axhubandroid.hub.WatchPrefs
import ai.amberx.axf.axhubandroid.watch.Alerts
import ai.amberx.axf.settings.SettingsScreen
import ai.amberx.axf.ui.LocalAxfRuntime
import ai.amberx.axf.ui.components.AxfButton
import ai.amberx.axf.ui.components.AxfCard
import ai.amberx.axf.ui.components.AxfPageHead
import ai.amberx.axf.ui.components.AxfText
import ai.amberx.axf.ui.components.ButtonTone
import ai.amberx.axf.ui.components.PlaceholderScreen
import ai.amberx.axf.ui.theme.Axf
import kotlinx.coroutines.launch

/** Route `hub`: the hub's own page (sign-in, approvals, one approval) inside the app. */
@Composable
fun HubPageView() {
    val ctx = LocalContext.current
    val runtime = LocalAxfRuntime.current
    val prefs = remember { WatchPrefs(ctx) }
    val page by HubState.page.collectAsState()
    val scope = rememberCoroutineScope()
    val base = prefs.base
    val url = page.first?.takeIf { HubAddress.isHub(base, it) } ?: HubAddress.approvals(base)
    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().padding(horizontal = Axf.space.two, vertical = Axf.space.one), horizontalArrangement = Arrangement.spacedBy(Axf.space.one)) {
            AxfButton("Approvals", { HubState.open(null); runtime.navigate("home") }, tone = ButtonTone.GHOST, icon = "arrow-left")
            AxfButton("All on hub", { HubState.open(HubAddress.approvals(base)) }, tone = ButtonTone.GHOST, icon = "list")
        }
        HubWebView(base, url, Modifier.weight(1f), reload = page.second) { finished ->
            // After any hub page (e.g. an approval decided), refresh the list and drop that approval's alert.
            Regex("/auth/admin/approvals/([0-9a-f-]{36})").find(finished)?.groupValues?.get(1)?.let { Alerts.clearApproval(ctx, it) }
            scope.launch { HubState.update(HubClient.feed(base)) }
        }
    }
}

/**
 * Route `apps`: the hub's app catalog (every app built with the framework, with download links). Downloads
 * go to this app's Downloads folder; Android then offers to install the APK.
 */
@Composable
fun AppsView() {
    val ctx = LocalContext.current
    val base = remember { WatchPrefs(ctx).base }
    var reload by remember { mutableLongStateOf(0L) }
    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().padding(horizontal = Axf.space.two, vertical = Axf.space.one), horizontalArrangement = Arrangement.spacedBy(Axf.space.one)) {
            AxfButton("Refresh", { reload = System.nanoTime() }, tone = ButtonTone.GHOST, icon = "refresh")
        }
        HubWebView(base, HubAddress.apps(base), Modifier.weight(1f), reload = reload, allowDownloads = true)
    }
}

/** A planned hub area: says what it will do and which hub step it waits on. */
data class HubArea(val route: String, val title: String, val icon: String, val plan: String, val waitsOn: String)

/** Future features, declared now so routes, nav and settings never need reshuffling when they land. */
val hubAreas: List<HubArea> = listOf(
    HubArea("services", "Services", "layers", "Every connected service with its status, tools and policy; turn services on or off and test them.", "the hub's admin API (step 4)"),
    HubArea("jobs", "Jobs", "clock", "Running and recent jobs with progress, results and cancel.", "the hub's admin API (step 4)"),
    HubArea("audit", "Audit log", "history", "Who called what, when, and what happened, with filters.", "the log viewer (step 7)"),
    HubArea("vault", "Vault", "lock", "Names of stored credentials and when they were set; add or replace a secret from the phone (values are never shown).", "the hub's admin API (step 4)"),
    HubArea("users", "Users", "users", "Hub accounts, roles and per-user permissions.", "the hub's admin API (step 4)"),
    HubArea("projects", "Projects", "folder", "The projects tree: each project's Claude files and shared data.", "the hub's admin API (step 4)"),
    HubArea("devices", "Devices", "smartphone", "This phone and your other devices as hub agents over AXPP.", "the device agent (step 6)"),
)

@Composable
fun HubAreaView(area: HubArea) {
    val ctx = LocalContext.current
    val runtime = LocalAxfRuntime.current
    val base = remember { WatchPrefs(ctx).base }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(Axf.space.two), verticalArrangement = Arrangement.spacedBy(Axf.space.two)) {
        PlaceholderScreen(area.title, message = "${area.plan}\n\nComing with ${area.waitsOn}.", icon = area.icon)
        AxfCard(Modifier.fillMaxWidth(), title = "Meanwhile", icon = "external") {
            AxfText("The hub's own pages already cover approvals, your account and users (admins).", muted = true)
            AxfButton("Open the hub", { HubState.open("$base/auth/account"); runtime.navigate("hub") }, icon = "external")
        }
    }
}

/** Generated settings (AXHub, Unlock, Appearance, General, About). */
@Composable
fun SettingsView() {
    Column(Modifier.fillMaxSize()) {
        AxfPageHead("Settings", modifier = Modifier.padding(horizontal = Axf.space.two))
        SettingsScreen()
    }
}
