package ai.amberx.consoleapp;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.WebChromeClient;
import android.webkit.WebView;
import android.widget.FrameLayout;

/**
 * The console app's one screen: the live web console ({@link WebHost}'s WebView) full screen. Not a native rewrite:
 * every screen, setting and action is the web console; this class only shows it, hands deep links
 * ({@code axf-console://open/<address>}, {@code https://console.amberxai.com/…}) to the page, answers Android's
 * permission prompts and starts the floating toolbar ({@link OverlayService}).
 */
public class ConsoleActivity extends Activity {
    static final int FILE_PICK = 41;
    static final int PERMS = 42;

    FrameLayout root;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        WebHost.activity = this;
        root = new FrameLayout(this);
        setContentView(root);
        edgeToEdge();
        Insets.install(this, root);
        Wake.apply(this, getIntent().getBooleanExtra(Wake.EXTRA, false));
        String link = linkOf(getIntent());
        boolean fresh = WebHost.current() == null;
        WebHost.get(this, ShellRules.deepLink(link)); // a fresh page starts at the link
        if (!fresh && link != null && state == null) WebHost.open(this, link); // a running page goes there
        OverlayService.startIfWanted(this);
    }

    /** Draw under the bars (Insets keeps everything clear of them); Android 15 does this by itself for target 35. */
    @SuppressWarnings("deprecation")
    private void edgeToEdge() {
        if (android.os.Build.VERSION.SDK_INT >= 30) getWindow().setDecorFitsSystemWindows(false);
        else getWindow().getDecorView().setSystemUiVisibility(android.view.View.SYSTEM_UI_FLAG_LAYOUT_STABLE
            | android.view.View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | android.view.View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
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
    protected void onResume() {
        super.onResume();
        WebHost.activity = this;
        // The overlay may have the page in its expanded window: the app on screen takes it back.
        OverlayService.collapseIfExpanded(this);
        WebHost.attach(root, this);
        Perms.resumed(this);
        NativeBridge.emit("app", "{\"visible\":true}");
    }

    @Override
    protected void onPause() {
        NativeBridge.emit("app", "{\"visible\":false}");
        super.onPause();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        Wake.apply(this, intent.getBooleanExtra(Wake.EXTRA, false));
        String link = linkOf(intent);
        if (link != null) WebHost.open(this, link);
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        WebView w = WebHost.current();
        if (w != null && "back".equals(ShellRules.back(w.canGoBack()))) w.goBack();
        else moveTaskToBack(true); // the page (and its live stream) keeps running; the floating toolbar stays on top
    }

    @Override
    protected void onDestroy() {
        WebHost.detach(root);
        if (WebHost.activity == this) WebHost.activity = null;
        super.onDestroy();
    }

    @Override
    protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request != FILE_PICK || WebHost.filePick == null) return;
        WebHost.filePick.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result, data));
        WebHost.filePick = null;
    }

    @Override
    public void onRequestPermissionsResult(int request, String[] names, int[] results) {
        super.onRequestPermissionsResult(request, names, results);
        if (request == PERMS) Perms.answered(this);
    }
}
