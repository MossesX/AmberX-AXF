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
import ai.amberx.axf.ui.LocalAxfRuntime

/**
 * The banner strip: the Dev Console's plugin banners (codebase changes, builds, GitHub activity, approvals, systems
 * check, keys, What's new) above every tab, so they are on screen whichever app is in front (Brett, Oct 21 2026).
 * The console page itself no longer shows them; this web view loads its banner-only page (`?axf-strip=banners`).
 *
 * - Loads once the Console tab has reached the console (its sign-in through the hub's wall leaves the session in the
 *   shared cookie store), so the strip never shows a sign-in page. Only the console's origin renders here.
 * - Height follows the banners (the page reports it through `AxfPatchesStrip.height`), 0 when none show, capped at
 *   45% of the screen (the strip scrolls inside past that).
 * - A banner button that opens a console view or dialog: the page sends the action to the Console tab (same-origin
 *   relay, src/bannerStrip.tsx in the console) and calls `AxfPatchesStrip.open("console")`, which brings that tab up.
 *   The bridge answers only while the console's own page is loaded.
 */
@SuppressLint("SetJavaScriptEnabled")
@Composable
fun BannerStrip(holder: WebAppHolder, module: AppModule) {
    val shown by module.bannersShown.collectAsState()
    val consoleUrl by holder.entry("console").url.collectAsState()
    val base = module.url("console") ?: return
    val origin = HubRules.origin(base) ?: return
    if (!shown) return
    val rt = LocalAxfRuntime.current
    val context = LocalContext.current
    val maxDp = LocalConfiguration.current.screenHeightDp * 45 / 100
    val heightPx = remember { mutableIntStateOf(0) }
    val main = remember { Handler(Looper.getMainLooper()) }
    val strip = remember(origin) { "$base?axf-strip=banners" }

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
                    if (HubRules.origin(target) == origin) return false
                    // Links out (GitHub runs, the hub's approval pages) open in the phone's browser, never in the strip.
                    val scheme = request.url.scheme?.lowercase()
                    if (scheme == "https") runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(target)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
                    return true
                }
                override fun onPageStarted(v: WebView, u: String?, favicon: Bitmap?) {
                    // A redirect to the hub's sign-in (session gone): show nothing; the Console tab signs in and the strip loads again.
                    if (HubRules.origin(u) != origin) { v.stopLoading(); heightPx.intValue = 0 }
                }
            }
            addJavascriptInterface(object {
                private fun ours(): Boolean = HubRules.origin(url) == origin
                @JavascriptInterface fun height(px: Int) { main.post { if (ours()) heightPx.intValue = px.coerceIn(0, 4000) } }
                @JavascriptInterface fun open(tab: String) { main.post { if (ours() && AppModule.TABS.any { it.id == tab }) rt.navigate(tab) } }
            }, "AxfPatchesStrip")
        }
    }
    DisposableEffect(view) { onDispose { (view.parent as? ViewGroup)?.removeView(view); view.destroy() } }

    // (Re)load when the Console tab lands on the console itself, i.e. its session is good.
    LaunchedEffect(view, consoleUrl) {
        if (HubRules.origin(consoleUrl) != origin) return@LaunchedEffect
        if (HubRules.origin(view.url) != origin) view.loadUrl(strip)
    }

    val h = heightPx.intValue
    AndroidView(
        modifier = Modifier.fillMaxWidth().height(if (h <= 0) 0.dp else minOf(h, maxDp).dp),
        factory = { (view.parent as? ViewGroup)?.removeView(view); view },
        onRelease = { (it.parent as? ViewGroup)?.removeView(it) },
    )
}
