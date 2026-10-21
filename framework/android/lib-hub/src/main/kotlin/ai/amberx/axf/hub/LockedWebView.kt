package ai.amberx.axf.hub

import android.annotation.SuppressLint
import android.app.DownloadManager
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.os.Environment
import android.webkit.CookieManager
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
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

/**
 * A web view locked to one origin (`https://host[:port]`, see [HubRules.normalize]); for the hub's own pages (sign-in,
 * approvals, one approval, the app catalog) or any other single-origin site an app trusts.
 *
 * - JavaScript is off unless the caller passes [javaScript] = true (the hub's pages are plain server-rendered forms);
 * - no file or content access, no DOM storage, no geolocation, no extra windows, no mixed content, no cache;
 * - third-party cookies off; safe browsing on;
 * - every navigation is checked against the origin: other http(s) links open in the phone's browser, anything else is
 *   dropped; a redirect (or any page start) that lands elsewhere is stopped before it renders, and nothing loads at all
 *   when [url] isn't on the origin;
 * - downloads are handed to [onDownload] only (nothing is downloaded by default; [hubApkDownloads] is the hub's app catalog).
 *
 * Approving on the hub's page here is approving on the hub's own page, so its Origin and CSRF checks apply.
 * The app should still run `WebView.setWebContentsDebuggingEnabled(false)` and keep `app_webview/` out of backups.
 */
@SuppressLint("SetJavaScriptEnabled")
@Composable
public fun LockedWebView(
    origin: String,
    url: String,
    modifier: Modifier = Modifier,
    reload: Long = 0L,
    javaScript: Boolean = false,
    onDownload: ((context: Context, url: String) -> Unit)? = null,
    onPage: (String) -> Unit = {},
) {
    val base = remember(origin) { HubRules.normalize(origin) }
    var view by remember { mutableStateOf<WebView?>(null) }
    var canGoBack by remember { mutableStateOf(false) }
    AndroidView(
        modifier = modifier.fillMaxSize(),
        factory = { ctx ->
            CookieManager.getInstance().setAcceptCookie(true)
            WebView(ctx).apply {
                settings.apply {
                    javaScriptEnabled = javaScript
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
                setDownloadListener { dl, _, _, _, _ -> if (onDownload != null && HubRules.isHub(base, dl)) onDownload(ctx, dl) }
                webViewClient = object : WebViewClient() {
                    override fun shouldOverrideUrlLoading(v: WebView, request: WebResourceRequest): Boolean {
                        val target = request.url.toString()
                        if (HubRules.isHub(base, target)) return false
                        val scheme = request.url.scheme?.lowercase()
                        if (scheme == "https" || scheme == "http") runCatching { ctx.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(target)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
                        return true
                    }
                    override fun onPageStarted(v: WebView, u: String?, favicon: Bitmap?) {
                        // A redirect to anywhere but the origin never renders here.
                        if (u != null && !HubRules.isHub(base, u)) v.stopLoading()
                    }
                    override fun onPageFinished(v: WebView, u: String?) {
                        CookieManager.getInstance().flush()
                        canGoBack = v.canGoBack()
                        if (u != null && HubRules.isHub(base, u)) onPage(u)
                    }
                }
                view = this
            }
        },
        onRelease = { it.stopLoading(); it.destroy(); view = null },
    )
    // A new page, or the same page asked for again (reload counter), loads it — only when it is on the origin.
    LaunchedEffect(view, url, reload) { view?.takeIf { HubRules.isHub(base, url) }?.loadUrl(url) }
    BackHandler(enabled = canGoBack) { view?.goBack() }
}

/**
 * The hub's app downloads for [LockedWebView.onDownload]: only `/apps/download/<project>/<file>.apk` on the hub (no query),
 * handed to Android's download manager with the hub session cookie (sent only to the hub's own address) and saved in the
 * app's own Downloads folder; tapping the finished notification installs it.
 */
public fun hubApkDownloads(base: String, session: HubSession = WebViewHubSession): (Context, String) -> Unit = { ctx, url -> HubDownloads.enqueue(ctx, base, url, session) }

public object HubDownloads {
    /** Starts the download; false when [url] isn't a hub app download or the download manager refused it. */
    public fun enqueue(ctx: Context, base: String, url: String, session: HubSession = WebViewHubSession): Boolean {
        val hub = HubRules.normalize(base) ?: return false
        val name = HubRules.apkDownloadName(hub, url) ?: return false
        return runCatching {
            val req = DownloadManager.Request(Uri.parse(url))
                .setTitle(name).setDescription("From your hub")
                .setMimeType("application/vnd.android.package-archive")
                .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                .setDestinationInExternalFilesDir(ctx, Environment.DIRECTORY_DOWNLOADS, name)
            session.cookie(hub)?.let { req.addRequestHeader("Cookie", it) }
            val dm = ctx.getSystemService(DownloadManager::class.java) ?: return@runCatching false
            dm.enqueue(req)
            Toast.makeText(ctx, "Downloading $name. Tap the notification when it's done to install.", Toast.LENGTH_LONG).show()
            true
        }.getOrElse {
            Toast.makeText(ctx, "Couldn't start the download.", Toast.LENGTH_SHORT).show()
            false
        }
    }
}
