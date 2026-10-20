package ai.amberx.axf.axhubandroid.views

import android.annotation.SuppressLint
import android.app.DownloadManager
import android.content.Context
import android.os.Environment
import android.widget.Toast
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
fun HubWebView(base: String, url: String, modifier: Modifier = Modifier, reload: Long = 0L, allowDownloads: Boolean = false, onPage: (String) -> Unit = {}) {
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
                // Only the hub's own app downloads (the Apps page), and only when this view allows them.
                setDownloadListener { dl, _, _, _, _ -> if (allowDownloads) downloadFromHub(ctx, base, dl) }
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
        onRelease = { it.stopLoading(); it.destroy(); view = null },
    )
    // A new page, or the same page asked for again (reload counter), loads it.
    LaunchedEffect(view, url, reload) { view?.takeIf { HubAddress.isHub(base, url) }?.loadUrl(url) }
    BackHandler(enabled = canGoBack) { view?.goBack() }
}

private val APK_PATH = Regex("^/apps/download/[a-z0-9][a-z0-9-]{0,63}/([A-Za-z0-9][A-Za-z0-9._-]{0,127}\\.apk)$")

/**
 * Hands a hub app download to Android's download manager with the hub session cookie (sent only to the
 * hub's own address). Saved in this app's Downloads folder; tapping the finished notification installs it.
 */
private fun downloadFromHub(ctx: Context, base: String, url: String) {
    val uri = Uri.parse(url)
    val name = APK_PATH.find(uri.path ?: "")?.groupValues?.get(1)
    if (!HubAddress.isHub(base, url) || name == null || uri.query != null) return
    runCatching {
        val req = DownloadManager.Request(uri)
            .setTitle(name).setDescription("From your hub")
            .setMimeType("application/vnd.android.package-archive")
            .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
            .setDestinationInExternalFilesDir(ctx, Environment.DIRECTORY_DOWNLOADS, name)
        CookieManager.getInstance().getCookie(url)?.let { req.addRequestHeader("Cookie", it) }
        ctx.getSystemService(DownloadManager::class.java)?.enqueue(req)
        Toast.makeText(ctx, "Downloading $name. Tap the notification when it's done to install.", Toast.LENGTH_LONG).show()
    }.onFailure { Toast.makeText(ctx, "Couldn't start the download.", Toast.LENGTH_SHORT).show() }
}

/** Signs this phone out of the hub (drops the hub session cookie from the app). */
fun signOutOfHub(done: () -> Unit = {}) {
    CookieManager.getInstance().removeAllCookies { CookieManager.getInstance().flush(); done() }
}
