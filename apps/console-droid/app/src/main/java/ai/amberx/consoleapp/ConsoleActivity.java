package ai.amberx.consoleapp;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

/**
 * The console app's one screen: the live web console in a full-screen WebView. Not a native rewrite: every screen,
 * setting and action is the web console; this class only hosts it, keeps links to other sites out of the app, and
 * hands deep links ({@code axf-console://open/<address>}, {@code https://console.amberxai.com/…}) to the page.
 */
public class ConsoleActivity extends Activity {
    static final int FILE_PICK = 41;

    WebView web;
    private ValueCallback<Uri[]> filePick;
    /** The activity on screen, for the overlay and the bridge (null when it is gone). */
    static ConsoleActivity current;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        current = this;
        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setUserAgentString(s.getUserAgentString() + " AXFConsoleApp/" + BuildConfigInfo.version(this));
        web.setWebViewClient(new Client());
        web.setWebChromeClient(new Chrome());
        setContentView(web);
        if (state != null) web.restoreState(state);
        else web.loadUrl(ShellRules.deepLink(linkOf(getIntent())));
    }

    /** The link an intent carries (a VIEW intent's data, or the overlay's {@code url} extra), else null. */
    static String linkOf(Intent i) {
        if (i == null) return null;
        String extra = i.getStringExtra("url");
        if (extra != null) return extra;
        Uri d = i.getData();
        return d == null ? null : d.toString();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        String link = linkOf(intent);
        if (link != null) web.loadUrl(ShellRules.deepLink(link));
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        if ("back".equals(ShellRules.back(web.canGoBack()))) web.goBack();
        else moveTaskToBack(true); // keep the page (and its session) alive; the overlay stays on top
    }

    @Override
    protected void onDestroy() {
        if (current == this) current = null;
        web.destroy();
        super.onDestroy();
    }

    @Override
    protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request != FILE_PICK || filePick == null) return;
        filePick.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result, data));
        filePick = null;
    }

    /** Opens a link that leaves Brett's sites in the phone's browser. */
    void openOutside(Uri uri) {
        try { startActivity(new Intent(Intent.ACTION_VIEW, uri).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); }
        catch (ActivityNotFoundException ignored) { /* no browser: stay put */ }
    }

    private final class Client extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
            String url = req.getUrl().toString();
            if (url.startsWith(ShellRules.SCHEME + "://")) { view.loadUrl(ShellRules.deepLink(url)); return true; }
            if (ShellRules.staysInside(url)) return false;
            openOutside(req.getUrl());
            return true;
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest req, WebResourceError err) {
            // The console is unreachable (offline, deploy in progress): a local page that retries, never a blank screen.
            if (req.isForMainFrame()) view.loadUrl("file:///android_asset/offline.html");
        }
    }

    private final class Chrome extends WebChromeClient {
        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> cb, FileChooserParams params) {
            if (filePick != null) filePick.onReceiveValue(null);
            filePick = cb;
            try { startActivityForResult(params.createIntent(), FILE_PICK); }
            catch (ActivityNotFoundException e) { filePick = null; return false; }
            return true;
        }
    }
}
