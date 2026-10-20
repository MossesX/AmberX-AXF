package ai.amberx.axf.axhubandroid.views

import android.annotation.SuppressLint
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.webkit.CookieManager
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView
import ai.amberx.axf.axhubandroid.hub.HubAddress

/**
 * The hub's own pages inside the app (sign-in, approvals, one approval). Locked to the hub's address:
 * any other link opens in the phone's browser instead. No JavaScript, no file or content access, no
 * mixed content; the hub's pages are plain server-rendered forms. Approving here is approving on the
 * hub's own page, so the hub's Origin and CSRF checks apply as usual.
 */
@SuppressLint("SetJavaScriptEnabled")
@Composable
fun HubWebView(base: String, url: String, modifier: Modifier = Modifier, onPage: (String) -> Unit = {}) {
    var view by remember { mutableStateOf<WebView?>(null) }
    var canGoBack by remember { mutableStateOf(false) }
    AndroidView(
        modifier = modifier.fillMaxSize(),
        factory = { ctx ->
            CookieManager.getInstance().setAcceptCookie(true)
            WebView(ctx).apply {
                settings.apply {
                    javaScriptEnabled = false
                    domStorageEnabled = false
                    allowFileAccess = false
                    allowContentAccess = false
                    mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
                    setSupportMultipleWindows(false)
                    javaScriptCanOpenWindowsAutomatically = false
                    safeBrowsingEnabled = true
                    setGeolocationEnabled(false)
                    cacheMode = WebSettings.LOAD_NO_CACHE
                }
                CookieManager.getInstance().setAcceptThirdPartyCookies(this, false)
                setDownloadListener { _, _, _, _, _ -> }
                webViewClient = object : WebViewClient() {
                    override fun shouldOverrideUrlLoading(v: WebView, request: WebResourceRequest): Boolean {
                        val target = request.url.toString()
                        if (HubAddress.isHub(base, target)) return false
                        val scheme = request.url.scheme?.lowercase()
                        if (scheme == "https" || scheme == "http") runCatching { ctx.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(target)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
                        return true
                    }
                    override fun onPageStarted(v: WebView, u: String?, favicon: Bitmap?) {
                        // A redirect to anywhere but the hub never renders here.
                        if (u != null && !HubAddress.isHub(base, u)) v.stopLoading()
                    }
                    override fun onPageFinished(v: WebView, u: String?) {
                        CookieManager.getInstance().flush()
                        canGoBack = v.canGoBack()
                        u?.let(onPage)
                    }
                }
                view = this
            }
        },
    )
    LaunchedEffect(view, url) { view?.takeIf { HubAddress.isHub(base, url) }?.loadUrl(url) }
    BackHandler(enabled = canGoBack) { view?.goBack() }
    DisposableEffect(Unit) { onDispose { view?.apply { stopLoading(); destroy() }; view = null } }
}

/** Signs this phone out of the hub (drops the hub session cookie from the app). */
fun signOutOfHub(done: () -> Unit = {}) {
    CookieManager.getInstance().removeAllCookies { CookieManager.getInstance().flush(); done() }
}
