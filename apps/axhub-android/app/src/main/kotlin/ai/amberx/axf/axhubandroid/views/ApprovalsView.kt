package ai.amberx.axf.axhubandroid.views

import android.Manifest
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.compose.LifecycleResumeEffect
import ai.amberx.axf.axhubandroid.watch.Alerts
import ai.amberx.axf.axhubandroid.watch.ApprovalWatch
import ai.amberx.axf.axhubandroid.watch.hubPrefs
import ai.amberx.axf.hub.HubClient
import ai.amberx.axf.hub.HubFeedStatus
import ai.amberx.axf.hub.HubRules
import ai.amberx.axf.hub.HubState
import ai.amberx.axf.hub.WatchPrefs
import ai.amberx.axf.kernel.platform.PermissionGateway
import ai.amberx.axf.ui.LocalAxfKernel
import ai.amberx.axf.ui.LocalAxfRuntime
import ai.amberx.axf.ui.components.AxfBadge
import ai.amberx.axf.ui.components.AxfButton
import ai.amberx.axf.ui.components.AxfCard
import ai.amberx.axf.ui.components.AxfEmptyState
import ai.amberx.axf.ui.components.AxfListItem
import ai.amberx.axf.ui.components.AxfPageHead
import ai.amberx.axf.ui.components.AxfText
import ai.amberx.axf.ui.components.ButtonTone
import ai.amberx.axf.ui.theme.Axf
import kotlinx.coroutines.launch

/** Home: is this phone signed in, is watching on, and what's waiting. Tap one to open its page. */
@Composable
fun ApprovalsView() {
    val ctx = LocalContext.current
    val runtime = LocalAxfRuntime.current
    val prefs = remember { hubPrefs(ctx) }
    val feed by HubState.feed.collectAsState()
    val running by HubState.watcherRunning.collectAsState()
    val scope = rememberCoroutineScope()
    var refreshTick by remember { mutableIntStateOf(0) }

    fun openPage(url: String?) { HubState.open(url); runtime.navigate("hub") }
    LifecycleResumeEffect(refreshTick) {
        scope.launch { HubState.update(HubClient.Default.feed(prefs.base)) }
        onPauseOrDispose { }
    }

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(Axf.space.two), verticalArrangement = Arrangement.spacedBy(Axf.space.two)) {
        AxfPageHead("Approvals", eyebrow = "AXHub", description = "Calls on your hub that wait for you. Tap one to review it on the hub's own page.") {
            AxfButton("Refresh", { refreshTick++ }, tone = ButtonTone.GHOST, icon = "refresh")
        }
        val f = feed
        if (f == null) AxfText("Checking the hub…", muted = true)
        else when (f.status) {
            HubFeedStatus.SIGNED_OUT -> AxfCard(Modifier.fillMaxWidth(), title = "Sign in to your hub", icon = "user") {
                AxfText("Sign in once with your hub account. The session stays in this app only.", muted = true)
                AxfButton("Sign in", { openPage(HubRules.loginUrl(prefs.base)) }, tone = ButtonTone.PRIMARY, icon = "unlock")
            }
            HubFeedStatus.NOT_ADMIN -> AxfCard(Modifier.fillMaxWidth(), title = "Not a hub admin", icon = "shield") {
                AxfText("Only admins can approve. If the hub asked you to pick a new password, open it and finish that first.", muted = true)
                AxfButton("Open the hub", { openPage(HubRules.accountUrl(prefs.base)) }, icon = "external")
            }
            HubFeedStatus.UNREACHABLE -> AxfCard(Modifier.fillMaxWidth(), title = "Can't reach the hub", icon = "wifi") {
                AxfText(f.error.ifEmpty { HubRules.MSG_UNREACHABLE }, muted = true)
                AxfButton("Try again", { refreshTick++ }, icon = "refresh")
            }
            HubFeedStatus.OK -> {
                if (f.pending.isEmpty()) AxfEmptyState("Nothing is waiting", message = "You'll get an alert the moment the hub asks.", icon = "check-circle")
                f.pending.forEach { a ->
                    AxfListItem(a.tool, subtitle = a.summary.lineSequence().firstOrNull()?.take(140), icon = "shield", onClick = { openPage(a.url) }, trailing = { AxfBadge("review") })
                }
                AxfButton("All approvals on the hub", { openPage(HubRules.approvalsUrl(prefs.base)) }, tone = ButtonTone.GHOST, icon = "list")
            }
        }
        WatchCard(prefs, running)
    }
}

@Composable
private fun WatchCard(prefs: WatchPrefs, running: Boolean) {
    val ctx = LocalContext.current
    val kernel = LocalAxfKernel.current
    val scope = rememberCoroutineScope()
    var tick by remember { mutableIntStateOf(0) }
    val canPost = remember(tick) { Alerts.canPost(ctx) }
    val canFull = remember(tick) { Alerts.canFullScreen(ctx) }
    LifecycleResumeEffect(Unit) { tick++; onPauseOrDispose { } }
    val feed by HubState.feed.collectAsState()
    LaunchedEffect(Unit) { if (prefs.watching && !running) ApprovalWatch.start(ctx) }
    // First successful sign-in turns watching on, unless the user already chose.
    LaunchedEffect(feed) { if (feed?.status == HubFeedStatus.OK && !prefs.watchingChosen) { prefs.watching = true; ApprovalWatch.start(ctx); tick++ } }

    AxfCard(Modifier.fillMaxWidth(), title = if (running) "Watching for approvals" else "Not watching", icon = "bell") {
        AxfText(if (running) "AXHub checks the hub every ${prefs.intervalSec} s and alerts you the moment something needs approval." else "Turn watching on to get an alert for every new approval.", muted = true)
        if (!canPost) {
            AxfText("Notifications are off, so alerts can't show.", color = Axf.colors.warning)
            AxfButton("Allow notifications", {
                if (Build.VERSION.SDK_INT >= 33) scope.launch { kernel?.services?.get<PermissionGateway>()?.request(listOf(Manifest.permission.POST_NOTIFICATIONS), "AXHub alerts you when an approval is waiting."); tick++ }
            }, tone = ButtonTone.PRIMARY, icon = "bell")
        }
        if (canPost && prefs.fullScreen && !canFull) {
            AxfText("Full-screen alerts are off for AXHub, so you'll get a normal notification instead.", muted = true)
            AxfButton("Allow full-screen alerts", {
                runCatching { ctx.startActivity(Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, Uri.parse("package:${ctx.packageName}")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
            }, icon = "external")
        }
        Row(horizontalArrangement = Arrangement.spacedBy(Axf.space.one)) {
            if (running) {
                AxfButton("Check now", { ApprovalWatch.start(ctx, checkNow = true) }, icon = "refresh")
                AxfButton("Stop watching", { prefs.watching = false; ApprovalWatch.stop(ctx); tick++ }, tone = ButtonTone.GHOST, icon = "pause")
            } else AxfButton("Start watching", { prefs.watching = true; ApprovalWatch.start(ctx); tick++ }, tone = ButtonTone.PRIMARY, icon = "play")
        }
    }
}
