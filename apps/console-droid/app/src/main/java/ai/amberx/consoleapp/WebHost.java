package ai.amberx.consoleapp;

import android.annotation.SuppressLint;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.MutableContextWrapper;
import android.net.Uri;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.JsPromptResult;
import android.webkit.JsResult;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * The console pages of the app. They belong to the process, not to a screen: the app's activity shows them, and the
 * overlay's full-screen window shows the same ones when the floating toolbar expands, so there is one login and the
 * same pages whatever is on screen. Built on a {@link MutableContextWrapper} so they can move between the activity and
 * the overlay window; their timers are never paused, so the console keeps listening while the phone shows another app
 * (the overlay service keeps the process alive).
 *
 * Tabs ({@link TabRules}): each tab is its own console WebView, so it keeps its own screen and scroll. One is on screen
 * ({@link #current}); everything that talks to "the page" (the bridge's events, the safe area, deep links, back, the
 * content update) talks to that one. What moves between windows is the host view: the page on screen with the tab
 * strip ({@link TabStrip}) under it.
 */
final class WebHost {
    private WebHost() {}

    /** The tab on screen. */
    private static WebView web;
    private static MutableContextWrapper ctx;

    /** One tab: its page, and what the page last said about itself. */
    static final class Tab {
        final String id;
        final WebView view;
        String url = "";
        String title = "";

        Tab(String id, WebView view) { this.id = id; this.view = view; }
    }

    /** A closed tab's page is destroyed this long after it left the screen (a bridge call from it has answered by then). */
    private static final long CLOSE_DELAY_MS = 300;
    private static final Map<String, Tab> pages = new HashMap<>();
    private static TabRules.State tabs;
    /** The page on screen above the tab strip: the one view the windows pass around. */
    private static LinearLayout host;
    private static FrameLayout pane;
    private static TabStrip strip;
    /** A file chooser waiting for the activity's result. */
    static ValueCallback<Uri[]> filePick;
    /** Set by the activity: who can start the file chooser and permission prompts. */
    static ConsoleActivity activity;

    /** The WebView on screen; the first tab is created (and the console loaded at {@code firstUrl}) on first use. */
    static WebView get(Context c, String firstUrl) {
        if (web != null) return web;
        ctx = new MutableContextWrapper(c.getApplicationContext());
        ShellTheme.init(c);
        tabs = TabRules.first();
        web = page(tabs.active, firstUrl == null ? ShellRules.HOME : firstUrl).view;
        ContentUpdate.start();
        DeviceLink.ensure(c); // axHub's amberx device service (amberx.open_url) answers from here
        return web;
    }

    /** A tab's own console WebView, loading {@code url}. Every tab is set up the same way. */
    @SuppressLint("SetJavaScriptEnabled")
    private static Tab page(String id, String url) {
        WebView w = new WebView(ctx);
        WebSettings s = w.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setUserAgentString(s.getUserAgentString() + " AXFConsoleApp/" + BuildConfigInfo.version(ctx));
        // the page keeps working while nothing shows it (it opens the approval card the moment the overlay pops)
        w.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, false);
        w.setWebViewClient(new Client());
        w.setWebChromeClient(new Chrome());
        NativeBridge.install(w);
        Tab t = new Tab(id, w);
        t.url = url;
        pages.put(id, t);
        w.loadUrl(url);
        return t;
    }

    static WebView current() { return web; }

    private static Tab tabOf(WebView view) {
        for (Tab t : pages.values()) if (t.view == view) return t;
        return null;
    }

    /** The host view: the page on screen, the tab strip under it. */
    private static LinearLayout host() {
        if (host != null) return host;
        host = new LinearLayout(ctx);
        host.setOrientation(LinearLayout.VERTICAL);
        pane = new FrameLayout(ctx);
        host.addView(pane, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
        strip = new TabStrip(ctx, new TabStrip.Taps() {
            @Override public void open() {
                if (openTab(null) == null) android.widget.Toast.makeText(ctx, ctx.getString(R.string.tabs_full, TabRules.MAX_TABS), android.widget.Toast.LENGTH_SHORT).show();
            }
            @Override public void select(String id) { selectTab(id); }
            @Override public void close(String id) { closeTab(id); }
        });
        host.addView(strip, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        return host;
    }

    /** Puts the tab on screen into the pane (the others stay out of the window and keep running) and redraws the strip. */
    private static void showActive() {
        if (pane == null || web == null) return;
        if (web.getParent() != pane) {
            if (web.getParent() instanceof ViewGroup) ((ViewGroup) web.getParent()).removeView(web);
            pane.removeAllViews();
            pane.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        }
        web.setVisibility(View.VISIBLE);
        redrawStrip();
    }

    private static List<String> column(boolean title) {
        List<String> out = new ArrayList<>();
        if (tabs == null) return out;
        for (String id : tabs.ids) {
            Tab t = pages.get(id);
            out.add(t == null ? "" : title ? t.title : t.url);
        }
        return out;
    }

    private static void redrawStrip() {
        if (strip != null && tabs != null) strip.show(tabs, column(true));
    }

    /** The active skin changed ({@code axfNative.theme}): the strip follows it. */
    static void restyle() {
        if (strip != null) strip.restyle();
        if (host != null) host.setBackgroundColor(ShellTheme.bg);
    }

    /** Is the tab strip under the page (so the bottom of the safe area is the strip's, not the page's)? */
    static boolean stripShown() { return strip != null && host != null && host.getParent() != null; }

    /** The safe area changed: the strip keeps clear of the bars it sits against. */
    static void stripInsets(int[] insets, boolean pageHandles) {
        if (strip != null) strip.pad(TabRules.stripPadding(insets, pageHandles));
    }

    // ---- the tabs (main thread only): the strip, the bridge and the deep links all end here ----

    /** {@link TabRules#json}: every tab with its id, title, url and link, and the one on screen. */
    static String tabsJson() {
        return tabs == null ? "{\"active\":\"\",\"max\":" + TabRules.MAX_TABS + ",\"count\":0,\"tabs\":[]}" : TabRules.json(tabs, column(true), column(false));
    }

    /** + : a new tab at {@code url} (the start screen when null), shown at once. → its id, or null when the strip is full. */
    static String openTab(String url) {
        if (web == null || tabs == null || TabRules.full(tabs)) return null;
        tabs = TabRules.open(tabs);
        Tab t = page(tabs.active, url == null ? ShellRules.HOME : url);
        activate(t);
        return t.id;
    }

    /** Tap: that tab is on screen. → false when there is no such tab. */
    static boolean selectTab(String id) {
        if (tabs == null || !tabs.has(id)) return false;
        tabs = TabRules.select(tabs, id);
        activate(pages.get(id));
        return true;
    }

    /** x : the tab is closed and its page is gone; the last one is replaced by a fresh start-screen tab. → false when there is no such tab. */
    static boolean closeTab(String id) {
        if (tabs == null || !tabs.has(id)) return false;
        Tab gone = pages.remove(id);
        tabs = TabRules.close(tabs, id);
        Tab next = pages.get(tabs.active);
        if (next == null) next = page(tabs.active, ShellRules.HOME);
        activate(next);
        if (gone != null) {
            WebView dead = gone.view;
            if (dead.getParent() instanceof ViewGroup) ((ViewGroup) dead.getParent()).removeView(dead);
            // a page may close its own tab through the bridge: it is destroyed once that call has answered
            next.view.postDelayed(dead::destroy, CLOSE_DELAY_MS);
        }
        return true;
    }

    private static void activate(Tab t) {
        if (t == null) return;
        boolean changed = web != t.view;
        web = t.view;
        NativeBridge.currentUrl = t.url == null ? "" : t.url;
        showActive();
        if (changed) Insets.push(); // the page now on screen gets the safe area as it is now
        NativeBridge.emit("tabs", tabsJson());
    }

    /** Moves the pages into {@code parent} (the activity's root or the overlay window), using its context for popups. */
    static void attach(ViewGroup parent, Context owner) {
        get(owner, null);
        LinearLayout h = host();
        if (h.getParent() == parent) return;
        if (h.getParent() instanceof ViewGroup) ((ViewGroup) h.getParent()).removeView(h);
        ctx.setBaseContext(owner);
        parent.addView(h, 0, new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        h.setBackgroundColor(ShellTheme.bg);
        showActive();
        Insets.attached(parent);
    }

    /** Takes the pages out of {@code parent} (they keep running, nothing shows them). */
    static void detach(ViewGroup parent) {
        if (host == null || host.getParent() != parent) return;
        parent.removeView(host);
        ctx.setBaseContext(ctx.getApplicationContext());
    }

    /**
     * Opens a deep link or console URL (see {@link ShellRules#deepLink}). A console that is already loaded opens it
     * itself, with no reload ({@link ShellRules#inPage}): the page keeps its state and goes straight to the screen.
     * Anything else, and a page that doesn't take the link within {@link ShellRules#HAND_OFF_MS}, is loaded.
     * A tab link ({@code axf-console://tab/new}, {@code axf-console://tab/<id>}) opens a tab or shows one instead.
     * Main thread only.
     */
    static void open(Context c, String link) {
        String tab = TabRules.linkTarget(link);
        if (tab != null) {
            get(c, null);
            if (TabRules.NEW.equals(tab)) openTab(null); else selectTab(tab);
            return;
        }
        String url = ShellRules.deepLink(link);
        if (web == null) { get(c, url); return; } // a fresh page starts at the link
        if (!ShellRules.inPage(NativeBridge.currentUrl, url)) { web.loadUrl(url); return; }
        WebView w = web;
        boolean[] settled = { false };
        Runnable load = () -> { if (!settled[0]) { settled[0] = true; w.loadUrl(url); } };
        w.postDelayed(load, ShellRules.HAND_OFF_MS); // a page that never answers (its renderer is gone) is loaded
        w.evaluateJavascript(ShellRules.handOffScript(url), took -> {
            if (settled[0]) return;
            if ("true".equals(took)) { settled[0] = true; w.removeCallbacks(load); } else { w.removeCallbacks(load); load.run(); }
        });
    }

    /** Runs JavaScript in the page on screen (events to window.axfNative listeners). */
    static void js(String script) {
        WebView w = web;
        if (w != null) w.post(() -> w.evaluateJavascript(script, null));
    }

    static void openOutside(Context c, Uri uri) {
        try { c.startActivity(new Intent(Intent.ACTION_VIEW, uri).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); }
        catch (ActivityNotFoundException ignored) { /* no browser: stay put */ }
    }

    private static final class Client extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
            String url = req.getUrl().toString();
            if (url.startsWith(ShellRules.SCHEME + "://")) { view.loadUrl(ShellRules.deepLink(url)); return true; }
            if (ShellRules.staysInside(url)) return false;
            openOutside(view.getContext(), req.getUrl());
            return true;
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest req, WebResourceError err) {
            // The console is unreachable (offline, deploy in progress): a local page that retries, never a blank screen.
            if (req.isForMainFrame()) view.loadUrl("file:///android_asset/offline.html");
        }

        /** Where a tab's page is now; the bridge follows the tab on screen. */
        private void at(WebView view, String url) {
            String u = url == null ? "" : url;
            Tab t = tabOf(view);
            if (t != null) t.url = u;
            if (view == web) NativeBridge.currentUrl = u;
        }

        @Override
        public void onPageStarted(WebView view, String url, android.graphics.Bitmap icon) {
            at(view, url);
        }

        @Override
        public void doUpdateVisitedHistory(WebView view, String url, boolean reload) {
            at(view, url); // client-side navigation (pushState) too
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            at(view, url);
            if (view != web) return; // a tab that is not on screen gets the safe area when it is shown
            Insets.push(); // the page gets the safe-area insets as soon as it can use them
            ContentUpdate.pageLoaded(view, url);
        }
    }

    private static final class Chrome extends WebChromeClient {
        /** The page's title is what the strip writes on its tab. */
        @Override
        public void onReceivedTitle(WebView view, String title) {
            Tab t = tabOf(view);
            if (t == null) return;
            t.title = title == null ? "" : title;
            redrawStrip();
        }

        // The page's own questions: the WebView draws them only in an activity; in the overlay the shell does (JsDialogs).
        @Override
        public boolean onJsAlert(WebView view, String url, String message, JsResult result) {
            return JsDialogs.ask(view, JsDialogs.ALERT, url, message, null, result);
        }

        @Override
        public boolean onJsConfirm(WebView view, String url, String message, JsResult result) {
            return JsDialogs.ask(view, JsDialogs.CONFIRM, url, message, null, result);
        }

        @Override
        public boolean onJsPrompt(WebView view, String url, String message, String defaultValue, JsPromptResult result) {
            return JsDialogs.ask(view, JsDialogs.PROMPT, url, message, defaultValue, result);
        }

        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> cb, FileChooserParams params) {
            if (activity == null) return false;
            if (filePick != null) filePick.onReceiveValue(null);
            filePick = cb;
            try { activity.startActivityForResult(params.createIntent(), ConsoleActivity.FILE_PICK); }
            catch (ActivityNotFoundException e) { filePick = null; return false; }
            return true;
        }

        /** The console's mic (talk mode, dictation): granted to Brett's own pages once Android's mic permission is given. */
        @Override
        public void onPermissionRequest(PermissionRequest req) {
            String origin = req.getOrigin() == null ? "" : req.getOrigin().toString();
            if (!ShellRules.bridgeAllowed(origin)) { req.deny(); return; }
            for (String r : req.getResources()) {
                if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(r) && !Perms.has(view(req), Perms.MIC)) {
                    Perms.request(Perms.MIC, () -> { if (Perms.has(view(req), Perms.MIC)) req.grant(req.getResources()); else req.deny(); });
                    return;
                }
            }
            req.grant(req.getResources());
        }

        private Context view(PermissionRequest req) { return web.getContext(); }
    }
}
