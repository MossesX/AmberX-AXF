package ai.amberx.axf.hub

import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.view.ViewGroup
import android.os.Handler
import android.os.Looper
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceError
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.collectAsState
import androidx.compose.ui.Alignment
import androidx.compose.ui.unit.dp
import ai.amberx.axf.ui.components.AxfButton
import ai.amberx.axf.ui.components.AxfText
import ai.amberx.axf.ui.components.ButtonTone
import ai.amberx.axf.ui.theme.Axf
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView
import ai.amberx.axf.kernel.asset.AssetTypeRegistry
import ai.amberx.axf.kernel.engine.EmbedEngine
import ai.amberx.axf.kernel.engine.EmbedMessage
import ai.amberx.axf.kernel.engine.EmbedTakes
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * One of a host app's web tabs (embed@1, Patches): a web **application** the host shows inside its own frame — unlike
 * [LockedWebView] (one origin, no JavaScript, for the hub's plain pages), a React/TypeScript app needs JavaScript, DOM
 * storage (its settings + console token), a cache and the hub's origin for the sign-in wall's round trip.
 *
 * - `origins`: the only places the view will render — the app's own origin first, plus the hub's (sign-in redirects);
 *   anything else that is http(s) opens in the phone's browser, everything else is dropped, and a redirect that lands off
 *   the list is stopped before it renders;
 * - the user agent carries the embed marker ([EmbedEngine.userAgentSuffix]), so the app hides the chrome the host shows
 *   (its banner) on every page, through sign-in redirects and client-side routing alike;
 * - no file / content access, no geolocation, no extra windows, no mixed content; third-party cookies off; safe browsing on;
 * - one cookie store per app, so the hub session from the host's own sign-in is the session of every tab;
 * - downloads go to [onDownload] only (the hub's app catalog: [hubApkDownloads]).
 *
 * The WebView lives in a [WebAppHolder] (one per tab id, for the activity's life): switching tabs reparents it instead of
 * recreating it, so each tab keeps its page, scroll and state while another is in front.
 */
@SuppressLint("SetJavaScriptEnabled")
@Composable
public fun WebAppView(
    holder: WebAppHolder,
    tab: String,
    url: String,
    origins: List<String>,
    modifier: Modifier = Modifier,
    reload: Long = 0L,
    onDownload: ((context: Context, url: String) -> Unit)? = null,
    onPage: (String) -> Unit = {},
    /**
     * Messages the page sends its host (embed@1: "open my settings", "show this notification"), through the JS bridge
     * `AxfEmbedHost.post(json)`. Checked ([EmbedTakes.parseMessage]) and believed only while the page shown is on
     * [origins]; delivered on the main thread. Null = no bridge at all.
     */
    onMessage: ((EmbedMessage) -> Unit)? = null,
) {
    val allowed = remember(origins) { origins.mapNotNull { HubRules.normalize(it) } }
    var canGoBack by remember { mutableStateOf(false) }
    val entry = remember(holder, tab) { holder.entry(tab) }
    // The view as state, so the load below re-runs once it exists (the effect can run before the factory has made it).
    var shown by remember { mutableStateOf<WebView?>(null) }
    val loading by entry.loading.collectAsState()
    val error by entry.error.collectAsState()
    val pageUrl by entry.url.collectAsState()
    fun load(v: WebView) {
        if (allowed.none { HubRules.isHub(it, url) }) { entry.error.value = "This tab's address ($url) isn't one it may open."; return }
        entry.reloaded = reload
        entry.lastUrl = url
        entry.error.value = null
        v.loadUrl(url)
    }
    Box(modifier.fillMaxSize()) {
        AndroidView(
            modifier = Modifier.fillMaxSize(),
            factory = { ctx ->
                val view = holder.view(ctx, tab) { v ->
                    v.settings.apply {
                        javaScriptEnabled = true
                        domStorageEnabled = true
                        allowFileAccess = false
                        allowContentAccess = false
                        mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
                        setSupportMultipleWindows(false)
                        javaScriptCanOpenWindowsAutomatically = false
                        safeBrowsingEnabled = true
                        setGeolocationEnabled(false)
                        cacheMode = WebSettings.LOAD_DEFAULT
                        mediaPlaybackRequiresUserGesture = true
                        userAgentString = userAgentString + " " + holder.userAgentSuffix
                    }
                    CookieManager.getInstance().setAcceptCookie(true)
                    CookieManager.getInstance().setAcceptThirdPartyCookies(v, false)
                    v.setDownloadListener { dl, _, _, _, _ -> if (onDownload != null && allowed.any { HubRules.isHub(it, dl) }) onDownload(ctx, dl) }
                    if (onMessage != null) v.addJavascriptInterface(EmbedHostBridge(v, allowed, onMessage), "AxfEmbedHost")
                    v.webChromeClient = WebChromeClient()
                    v.webViewClient = object : WebViewClient() {
                        override fun shouldOverrideUrlLoading(v: WebView, request: WebResourceRequest): Boolean {
                            val target = request.url.toString()
                            if (allowed.any { HubRules.isHub(it, target) }) return false
                            val scheme = request.url.scheme?.lowercase()
                            if (scheme == "https" || scheme == "http") runCatching { ctx.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(target)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
                            return true
                        }
                        override fun onPageStarted(v: WebView, u: String?, favicon: Bitmap?) {
                            if (u != null && allowed.none { HubRules.isHub(it, u) }) {
                                v.stopLoading()
                                entry.loading.value = false
                                entry.error.value = "Stopped: the page went to ${HubRules.origin(u) ?: u}, which this tab may not show."
                                return
                            }
                            entry.loading.value = true
                            entry.error.value = null
                        }
                        override fun onPageFinished(v: WebView, u: String?) {
                            CookieManager.getInstance().flush()
                            canGoBack = v.canGoBack()
                            entry.loading.value = false
                            entry.url.value = u ?: ""
                            if (u != null && allowed.any { HubRules.isHub(it, u) }) onPage(u)
                        }
                        override fun onReceivedError(v: WebView, request: WebResourceRequest, err: WebResourceError) {
                            if (!request.isForMainFrame) return
                            entry.loading.value = false
                            entry.error.value = "Couldn't load ${HubRules.origin(request.url.toString()) ?: "the page"}: ${err.description} (${err.errorCode})."
                        }
                        override fun onReceivedHttpError(v: WebView, request: WebResourceRequest, response: WebResourceResponse) {
                            if (!request.isForMainFrame || response.statusCode < 500) return
                            entry.error.value = "${HubRules.origin(request.url.toString()) ?: "The page"} answered ${response.statusCode}."
                        }
                    }
                }
                // Reparent: the view may still sit in the tab that was in front a moment ago.
                (view.parent as? ViewGroup)?.removeView(view)
                canGoBack = view.canGoBack()
                // First show: load right here, so nothing depends on when the effect below runs.
                if (entry.lastUrl == null) load(view)
                shown = view
                view
            },
            // Detach only: the holder owns the view; it is destroyed with the holder, not when a tab leaves the screen.
            onRelease = { (it.parent as? ViewGroup)?.removeView(it); shown = null },
        )
        // A later `reload` tick (the host's "Reload tab") or a new address loads the page again; so does a view that never got one.
        LaunchedEffect(shown, url, reload) {
            val v = shown ?: return@LaunchedEffect
            if (reload != entry.reloaded || entry.lastUrl != url) load(v)
        }
        // Never a silent blank: loading before the first page, or the reason it failed with a way to try again.
        val e = error
        if (e != null) {
            Column(Modifier.fillMaxSize().background(Axf.colors.bg).padding(24.dp), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
                AxfText(e)
                Spacer(Modifier.height(12.dp))
                AxfButton("Try again", { shown?.let { load(it) } }, tone = ButtonTone.PRIMARY, icon = "refresh")
            }
        } else if (loading && pageUrl.isEmpty()) {
            Box(Modifier.fillMaxSize().background(Axf.colors.bg), contentAlignment = Alignment.Center) { AxfText("Loading…", muted = true) }
        }
    }
    BackHandler(enabled = canGoBack) { entry.view?.goBack() }
}

/**
 * The JS bridge a page calls to reach its host (`AxfEmbedHost.post(json)`, embed@1). Runs on WebView's binder thread:
 * hops to the main thread, checks the page in front is still one of the tab's origins (a page that navigated away
 * can't speak for the app), parses and caps the message, then hands it over. Nothing else is exposed to the page.
 */
internal class EmbedHostBridge(private val view: WebView, private val allowed: List<String>, private val deliver: (EmbedMessage) -> Unit) {
    private val main = Handler(Looper.getMainLooper())
    @JavascriptInterface
    fun post(json: String?) {
        if (json == null || json.length > 4000) return
        main.post {
            val here = view.url ?: return@post
            if (allowed.none { HubRules.isHub(it, here) }) return@post
            EmbedTakes.parseMessage(json)?.let(deliver)
        }
    }
}

/** Live state of one tab's web view, for the host's banner / settings (loading dot, current page). */
public class WebAppEntry internal constructor(public val tab: String) {
    internal var view: WebView? = null
    internal var reloaded: Long = Long.MIN_VALUE
    internal var lastUrl: String? = null
    /** Why the page isn't showing (load error, blocked redirect), or null. */
    public val error: MutableStateFlow<String?> = MutableStateFlow(null)
    public val loading: MutableStateFlow<Boolean> = MutableStateFlow(false)
    public val url: MutableStateFlow<String> = MutableStateFlow("")
}

/**
 * Keeps one [WebView] per tab for the life of the host activity (embed@1 host side). Create it in the activity
 * (`remember { WebAppHolder(host) }` is not enough: the composition goes with configuration changes; hold it in the
 * activity or a ViewModel) and call [destroy] when the activity is finished.
 *
 * [host] is the host app's embed id (`patches`): every view's user agent ends in [EmbedEngine.userAgentSuffix] for it,
 * which is how the embedded apps know to hide their banner. [hide] names the chrome the host shows (default: the banner).
 */
public class WebAppHolder(
    public val host: String,
    hide: List<String> = EmbedEngine.DEFAULT_HIDDEN,
    types: AssetTypeRegistry = AssetTypeRegistry.builtin(),
    /** app functions the host takes over from the apps (embed@1 `takes`: `settings`, `notifications`) */
    takes: List<String> = emptyList(),
) {
    /** `AXF-Embed/<host>[/<types>]` (+ ` AXF-Embed-Take/<fn>+<fn>`), appended to each view's user agent. */
    public val userAgentSuffix: String = EmbedTakes.userAgentSuffix(types, host, hide, takes)
    private val entries = LinkedHashMap<String, WebAppEntry>()
    private val _tabs = MutableStateFlow<List<String>>(emptyList())
    /** Tabs that have a live web view (in the order they were first shown). */
    public val tabs: StateFlow<List<String>> get() = _tabs.asStateFlow()

    public fun entry(tab: String): WebAppEntry = entries.getOrPut(tab) { WebAppEntry(tab).also { _tabs.value = entries.keys.toList() } }

    /** The tab's web view, made on first use with [configure]. */
    internal fun view(context: Context, tab: String, configure: (WebView) -> Unit): WebView {
        val e = entry(tab)
        e.view?.let { return it }
        val v = WebView(context)
        configure(v)
        e.view = v
        return v
    }

    /** Loads the tab's page again (the host's Reload); nothing when the tab has no view yet. */
    public fun reload(tab: String) { entries[tab]?.let { it.error.value = null; it.view?.reload() } }

    /**
     * Sends the page in a tab a message from its host (embed@1, e.g. [EmbedTakes.openTab] to a settings page): the page's
     * `AxfEmbedGuest.receive(json)`; nothing when the tab has no view or the page doesn't listen.
     */
    public fun send(tab: String, json: String) {
        val v = entries[tab]?.view ?: return
        v.evaluateJavascript("window.AxfEmbedGuest&&window.AxfEmbedGuest.receive(" + org.json.JSONObject.quote(json) + ")", null)
    }

    /** The page a tab shows now, or null. */
    public fun currentUrl(tab: String): String? = entries[tab]?.view?.url

    /** Drops one tab's view (the host removed the tab). */
    public fun drop(tab: String) {
        entries.remove(tab)?.let { e -> e.view?.let { (it.parent as? ViewGroup)?.removeView(it); it.stopLoading(); it.destroy() }; e.view = null }
        _tabs.value = entries.keys.toList()
    }

    /** Destroys every view (the activity is finishing). */
    public fun destroy() { entries.keys.toList().forEach { drop(it) } }
}

/** Remembers that the activity is going away: destroys the holder's views when the composition that owns it is disposed for good. */
@Composable
public fun DisposeWebAppsOnFinish(holder: WebAppHolder, finishing: () -> Boolean) {
    DisposableEffect(holder) { onDispose { if (finishing()) holder.destroy() } }
}
