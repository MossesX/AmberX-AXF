package ai.amberx.droid;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.view.Gravity;
import android.webkit.CookieManager;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

/**
 * A hub page (sign-in, an approval) in a web view locked to the hub's origin: no file or content access, any link off
 * the hub is refused, and the window is hidden from recordings (FLAG_SECURE) only when "Hide sensitive screens from
 * recordings" is on (it can hold the hub sign-in password; SecureScreen, Oct 31 2026). Since axHub decision #96 the hub's pages are the
 * AXHub web app on the hub's own address (an approval link lands on `/#/approvals/<id>`), so JavaScript and DOM storage
 * are on — still only for the hub's origin. Deciding an approval happens there, through the hub's JSON API under its
 * Origin and CSRF checks. The session cookie it gets lands in Android's cookie store, which the watcher and `hubGet` read.
 */
public class HubWebActivity extends Activity {
    static final String EXTRA_URL = "url";
    private WebView web;
    private LinearLayout failed;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        SecureScreen.apply(this, true); // a hub page can be the sign-in (password) screen
        String url = getIntent().getStringExtra(EXTRA_URL);
        String hub = HubRules.normalize(url);
        if (hub == null) { finish(); return; }

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        LinearLayout bar = new LinearLayout(this);
        bar.setGravity(Gravity.CENTER_VERTICAL);
        bar.setPadding(24, 8, 8, 8);
        TextView title = new TextView(this);
        title.setText(Uri.parse(hub).getHost());
        bar.addView(title, new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f));
        Button done = new Button(this);
        done.setText("Done");
        done.setOnClickListener(v -> finish());
        bar.addView(done);
        root.addView(bar);

        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true); // the hub's pages are a web app now; navigation stays locked to the hub below
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setDomStorageEnabled(true);
        s.setJavaScriptCanOpenWindowsAutomatically(false);
        s.setSupportMultipleWindows(false);
        CookieManager.getInstance().setAcceptCookie(true);
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                return !HubRules.isHub(hub, req.getUrl().toString()); // stay on the hub, refuse anything else
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest req, WebResourceError err) {
                if (req.isForMainFrame()) showFailed(root, url);
            }
        });
        root.addView(web, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f));
        setContentView(root);
        web.loadUrl(url);
    }

    /** Never the WebView's "Web page not available": a plain card, Try again, or the phone's browser (its own sign-in). */
    private void showFailed(LinearLayout root, String url) {
        if (failed != null) return;
        web.setVisibility(android.view.View.GONE);
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setGravity(Gravity.CENTER);
        box.setPadding(48, 48, 48, 48);
        TextView note = new TextView(this);
        note.setText("axHub's page didn't open here. Your approvals are still on AmberX's Approvals page.");
        note.setGravity(Gravity.CENTER);
        box.addView(note);
        Button again = new Button(this);
        again.setText("Try again");
        again.setOnClickListener(v -> { root.removeView(box); failed = null; web.setVisibility(android.view.View.VISIBLE); web.loadUrl(url); });
        box.addView(again);
        Button browser = new Button(this);
        browser.setText("Open in axHub");
        browser.setOnClickListener(v -> { try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url))); } catch (Exception ignored) { /* no browser */ } });
        box.addView(browser);
        failed = box;
        root.addView(box, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f));
    }

    @Override
    public void onBackPressed() {
        if (web != null && web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        CookieManager.getInstance().flush();
        if (web != null) web.destroy();
        super.onDestroy();
    }

    static Intent intent(Activity from, String url) {
        return new Intent(from, HubWebActivity.class).putExtra(EXTRA_URL, url);
    }
}
