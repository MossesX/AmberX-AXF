package ai.amberx.axf.patches.views

import android.annotation.SuppressLint
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import ai.amberx.axf.hub.HubRules
import ai.amberx.axf.hub.WebAppHolder
import ai.amberx.axf.patches.AppModule
import ai.amberx.axf.patches.watch.PatchesAlerts
import ai.amberx.axf.ui.LocalAxfRuntime

/**
 * The banner strip: the banner plugins Patches runs (codebase changes, builds, GitHub activity, approvals, systems
 * check, keys, push) above every tab, so they are on screen whichever app is in front (Brett, Oct 21 2026; since
 * Oct 22 2026 the plugins run in Patches itself, not in the console). This web view loads Patches web's banner-only
 * page (`<Patches web>/?axf-strip=banners`, setting "Patches web address").
 *
 * - Loads once the Console tab has reached the console (its sign-in through the hub's wall leaves the hub session in
 *   the shared cookie store, so Patches web's wall lets the strip through). Patches web's origin renders here; the
 *   hub's only for the wall's sign-in hop (nothing shows meanwhile: the strip stays 0 tall until the page reports).
 * - Height follows the banners (the page reports it through `AxfPatchesStrip.height`), 0 when none show, capped at
 *   45% of the screen (the strip scrolls inside past that).
 * - A banner tap that names something only the console has (a console view, dialog or action): the page hands it to
 *   `AxfPatchesStrip.relay` as an embed@1 `relay` message, sent to the Console tab (which runs it like its own tap),
 *   and `open("console")` brings that tab up. An approval tapped in the strip opens in the AXHub phone app when it is
 *   installed (`approval(id)`), else the axHub tab. The bridge answers only while Patches web's own page is loaded.
 */
@SuppressLint("SetJavaScriptEnabled")
@Composable
fun BannerStrip(holder: WebAppHolder, module: AppModule) {
    val shown by module.bannersShown.collectAsState()
    val consoleUrl by holder.entry("console").url.collectAsState()
    val console = HubRules.origin(module.url("console")) ?: return
    val strip = module.stripUrl() ?: return
    val origin = HubRules.origin(strip) ?: return
    val hub = HubRules.origin(module.hub)
    if (!shown) return
    val rt = LocalAxfRuntime.current
    val context = LocalContext.current
    val maxDp = LocalConfiguration.current.screenHeightDp * 45 / 100
    val heightPx = remember { mutableIntStateOf(0) }
    val main = remember { Handler(Looper.getMainLooper()) }

    val view = remember(origin) {
        WebView(context).apply {
            settings.apply {
                javaScriptEnabled = true
                domStorageEnabled = true
                allowFileAccess = false
                allowContentAccess = false
                mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
                setSupportMultipleWindows(false)
                javaScriptCanOpenWindowsAutomatically = false
                safeBrowsingEnabled = true
                setGeolocationEnabled(false)
                mediaPlaybackRequiresUserGesture = true
                userAgentString = userAgentString + " " + holder.userAgentSuffix
            }
            CookieManager.getInstance().setAcceptThirdPartyCookies(this, false)
            isVerticalScrollBarEnabled = true
            webChromeClient = WebChromeClient()
            webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(v: WebView, request: WebResourceRequest): Boolean {
                    val target = request.url.toString()
                    val to = HubRules.origin(target)
                    if (to == origin || (to != null && to == hub)) return false
                    // Links out (GitHub runs, the hub's approval pages) open in the phone's browser, never in the strip.
                    val scheme = request.url.scheme?.lowercase()
                    if (scheme == "https") runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(target)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
                    return true
                }
                override fun onPageStarted(v: WebView, u: String?, favicon: Bitmap?) {
                    // The wall's hop through the hub: show nothing until Patches web's page is back and reports its height.
                    val at = HubRules.origin(u)
                    if (at != origin) { heightPx.intValue = 0; if (at != hub) v.stopLoading() }
                }
            }
            addJavascriptInterface(object {
                private fun ours(): Boolean = HubRules.origin(url) == origin
                @JavascriptInterface fun height(px: Int) { main.post { if (ours()) heightPx.intValue = px.coerceIn(0, 4000) } }
                @JavascriptInterface fun open(tab: String) { main.post { if (ours() && AppModule.TABS.any { it.id == tab }) rt.navigate(tab) } }
                /** An embed@1 `relay` message for the Console tab (the console checks it again before running it). */
                @JavascriptInterface fun relay(json: String) {
                    main.post {
                        if (!ours() || json.length > 4000) return@post
                        val ok = runCatching { org.json.JSONObject(json).let { it.optString("\$axf") == "embed@1" && it.optString("type") == "relay" } }.getOrDefault(false)
                        if (ok) holder.send("console", json)
                    }
                }
                /** An approval tapped in the strip: the AXHub phone app on it, else the axHub tab. */
                @JavascriptInterface fun approval(id: String) {
                    main.post {
                        if (!ours() || !Regex("^[A-Za-z0-9_-]{1,80}$").matches(id)) return@post
                        if (!PatchesAlerts.showApproval(context, id)) rt.navigate("axhub")
                    }
                }
            }, "AxfPatchesStrip")
        }
    }
    DisposableEffect(view) { onDispose { (view.parent as? ViewGroup)?.removeView(view); view.destroy() } }

    // (Re)load when the Console tab lands on the console itself, i.e. its session is good.
    LaunchedEffect(view, consoleUrl) {
        if (HubRules.origin(consoleUrl) != console) return@LaunchedEffect
        if (HubRules.origin(view.url) != origin) view.loadUrl(strip)
    }

    val h = heightPx.intValue
    AndroidView(
        modifier = Modifier.fillMaxWidth().height(if (h <= 0) 0.dp else minOf(h, maxDp).dp),
        factory = { (view.parent as? ViewGroup)?.removeView(view); view },
        onRelease = { (it.parent as? ViewGroup)?.removeView(it) },
    )
}
