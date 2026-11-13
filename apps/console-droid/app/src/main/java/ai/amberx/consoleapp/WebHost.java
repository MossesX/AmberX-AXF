package ai.amberx.consoleapp;

import android.annotation.SuppressLint;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.MutableContextWrapper;
import android.net.Uri;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

/**
 * The one console WebView of the app. It belongs to the process, not to a screen: the app's activity shows it, and the
 * overlay's full-screen window shows the same one when the floating toolbar expands, so there is one page, one login,
 * one live stream (approvals, console commands) whatever is on screen. Built on a {@link MutableContextWrapper} so it
 * can move between the activity and the overlay window; its timers are never paused, so the console keeps listening
 * while the phone shows another app (the overlay service keeps the process alive).
 */
final class WebHost {
    private WebHost() {}

    private static WebView web;
    private static MutableContextWrapper ctx;
    /** A file chooser waiting for the activity's result. */
    static ValueCallback<Uri[]> filePick;
    /** Set by the activity: who can start the file chooser and permission prompts. */
    static ConsoleActivity activity;

    /** The WebView, created (and the console loaded at {@code firstUrl}) on first use. */
    @SuppressLint("SetJavaScriptEnabled")
    static WebView get(Context c, String firstUrl) {
        if (web != null) return web;
        ctx = new MutableContextWrapper(c.getApplicationContext());
        web = new WebView(ctx);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setUserAgentString(s.getUserAgentString() + " AXFConsoleApp/" + BuildConfigInfo.version(c));
        web.setWebViewClient(new Client());
        web.setWebChromeClient(new Chrome());
        NativeBridge.install(web);
        web.loadUrl(firstUrl == null ? ShellRules.HOME : firstUrl);
        ContentUpdate.start();
        return web;
    }

    static WebView current() { return web; }

    /** Moves the WebView into {@code parent} (the activity's root or the overlay window), using its context for popups. */
    static void attach(ViewGroup parent, Context owner) {
        WebView w = get(owner, null);
        if (w.getParent() == parent) return;
        if (w.getParent() instanceof ViewGroup) ((ViewGroup) w.getParent()).removeView(w);
        ctx.setBaseContext(owner);
        parent.addView(w, 0, new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        w.setVisibility(View.VISIBLE);
        Insets.attached(parent);
    }

    /** Takes the WebView out of {@code parent} (it keeps running, nothing shows it). */
    static void detach(ViewGroup parent) {
        if (web == null || web.getParent() != parent) return;
        parent.removeView(web);
        ctx.setBaseContext(ctx.getApplicationContext());
    }

    /** Loads a deep link or console URL (see {@link ShellRules#deepLink}). */
    static void open(Context c, String link) {
        get(c, ShellRules.deepLink(link)).loadUrl(ShellRules.deepLink(link));
    }

    /** Runs JavaScript in the page (events to window.axfNative listeners). */
    static void js(String script) {
        if (web != null) web.post(() -> web.evaluateJavascript(script, null));
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

        @Override
        public void onPageStarted(WebView view, String url, android.graphics.Bitmap icon) {
            NativeBridge.currentUrl = url == null ? "" : url;
        }

        @Override
        public void doUpdateVisitedHistory(WebView view, String url, boolean reload) {
            NativeBridge.currentUrl = url == null ? "" : url; // client-side navigation (pushState) too
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            NativeBridge.currentUrl = url == null ? "" : url;
            Insets.push(); // the page gets the safe-area insets as soon as it can use them
            ContentUpdate.pageLoaded(view, url);
        }
    }

    private static final class Chrome extends WebChromeClient {
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
