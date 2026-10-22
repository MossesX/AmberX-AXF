package ai.amberx.axf.patches.views

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import ai.amberx.axf.hub.WebAppHolder
import ai.amberx.axf.hub.WebAppView
import ai.amberx.axf.hub.hubApkDownloads
import ai.amberx.axf.patches.AppModule
import ai.amberx.axf.ui.components.AxfText

/**
 * One tab's content: that app's web view out of the activity's [WebAppHolder] (kept alive while another tab is in
 * front), filling everything under the tab row. The app inside hides its own banner (embed@1: the holder's user agent
 * says `AXF-Embed/patches`), so Patches' banner is the one on screen.
 */
@Composable
fun TabView(holder: WebAppHolder, module: AppModule, tab: String) {
    val reloads by module.reloads.collectAsState()
    val url = module.url(tab)
    Box(Modifier.fillMaxSize()) {
        if (url == null) AxfText("No address for this tab. Set one in Settings → Patches.", muted = true)
        else WebAppView(
            holder = holder, tab = tab, url = url, origins = module.origins(tab),
            reload = reloads[tab] ?: 0L,
            // Only the hub's app catalog downloads (APKs) are taken; everything else a page offers is ignored.
            onDownload = hubApkDownloads(module.hub),
            // embed@1: the app asks Patches for its settings (its own hooks are gone in here) or hands over a notification.
            onMessage = { m -> module.onMessage(tab, m) },
        )
    }
}
