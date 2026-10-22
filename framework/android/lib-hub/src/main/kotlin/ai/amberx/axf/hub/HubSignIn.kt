package ai.amberx.axf.hub

import android.annotation.SuppressLint
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.webkit.CookieManager
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView

/**
 * The hub's own sign-in page inside a developer app, locked to the hub's address (any other link opens in the
 * phone's browser; a redirect elsewhere never renders). No JavaScript, no file/content access. The session cookie
 * the hub sets lands in the WebView cookie store, which [cookieCredentials] reads for the data API. Calls `done`
 * once the page leaves /auth/login and /auth/first (signed in, password picked).
 */
@SuppressLint("SetJavaScriptEnabled")
@Composable
public fun HubSignInView(hub: String, modifier: Modifier = Modifier, done: () -> Unit) {
    val base = HubOrigin.normalize(hub) ?: return
    var view by remember { mutableStateOf<WebView?>(null) }
    AndroidView(
        modifier = modifier.fillMaxSize(),
        factory = { ctx ->
            CookieManager.getInstance().setAcceptCookie(true)
            WebView(ctx).apply {
                settings.apply {
                    javaScriptEnabled = false; domStorageEnabled = false; allowFileAccess = false; allowContentAccess = false
                    mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW; setSupportMultipleWindows(false); safeBrowsingEnabled = true
                    setGeolocationEnabled(false); cacheMode = WebSettings.LOAD_NO_CACHE
                }
                CookieManager.getInstance().setAcceptThirdPartyCookies(this, false)
                webViewClient = object : WebViewClient() {
                    override fun shouldOverrideUrlLoading(v: WebView, request: WebResourceRequest): Boolean {
                        val target = request.url.toString()
                        if (isHub(base, target)) return false
                        val scheme = request.url.scheme?.lowercase()
                        if (scheme == "https" || scheme == "http") runCatching { ctx.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(target)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
                        return true
                    }
                    override fun onPageStarted(v: WebView, u: String?, favicon: Bitmap?) { if (u != null && !isHub(base, u)) v.stopLoading() }
                    override fun onPageFinished(v: WebView, u: String?) {
                        CookieManager.getInstance().flush()
                        if (u != null && !u.contains("/auth/login") && !u.contains("/auth/first")) done()
                    }
                }
                view = this
            }
        },
        onRelease = { it.stopLoading(); it.destroy(); view = null },
    )
    LaunchedEffect(view) { view?.loadUrl("$base/auth/login?rd=${java.net.URLEncoder.encode("/auth/account", "UTF-8")}") }
}

/** Credentials from the WebView cookie store for the hub's address (what [HubSignInView] fills). */
public fun cookieCredentials(hub: () -> String): HubCredentials = HubCredentials {
    val base = HubOrigin.normalize(hub()) ?: return@HubCredentials null
    runCatching { CookieManager.getInstance().getCookie(base) }.getOrNull()?.takeIf { it.isNotBlank() }?.let { HubCredential.SessionCookie(it) }
}

internal fun isHub(base: String, url: String?): Boolean {
    val u = runCatching { java.net.URL(url) }.getOrNull() ?: return false
    val b = java.net.URL(base)
    val up = if (u.port == -1) u.defaultPort else u.port
    val bp = if (b.port == -1) b.defaultPort else b.port
    return u.protocol == b.protocol && u.host.equals(b.host, true) && up == bp
}
