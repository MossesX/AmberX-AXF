package ai.amberx.consoleapp;

import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.webkit.WebView;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.Reader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import org.json.JSONObject;

/**
 * Keeps the web content current without a new APK ({@link UpdateRules} has the rules).
 *
 * Checks run when the app comes to the front, when the floating toolbar expands, every {@link UpdateRules#PERIOD_MS}
 * and on {@code native.update:check}. A check reads the live console's index.html (no cache) and compares its entry
 * bundle with the one the page runs. A newer one reloads the page once it has been off screen for
 * {@link UpdateRules#OFF_SCREEN_MS}; while the console is on screen the page gets a {@code shell.update} event and
 * shows its own "Reload for the new version" bar.
 */
final class ContentUpdate {
    private ContentUpdate() {}

    private static final Handler ui = new Handler(Looper.getMainLooper());
    /** The entry bundle the page runs ("" until known, or on a page that isn't the console). */
    static volatile String loaded = "";
    /** The entry bundle the live console served at the last check. */
    static volatile String live = "";
    static volatile long lastCheck = 0;
    static volatile String lastResult = "never";
    static volatile boolean pending = false;
    /** The app's activity is in front (set by {@link ConsoleActivity}). */
    static volatile boolean appVisible = false;
    private static boolean started = false;

    private static final Runnable periodic = new Runnable() {
        @Override public void run() { check(false); ui.postDelayed(this, UpdateRules.PERIOD_MS); }
    };
    private static final Runnable reloadWhenHidden = () -> { if (pending && !onScreen()) reload(); };

    /** Starts the periodic check (once per process). */
    static void start() {
        if (started) return;
        started = true;
        ui.postDelayed(periodic, UpdateRules.PERIOD_MS);
    }

    static boolean onScreen() {
        return appVisible || OverlayRules.EXPANDED.equals(OverlayService.state);
    }

    /** A page finished loading: record the entry bundle it runs. */
    static void pageLoaded(WebView web, String url) {
        loaded = "";
        pending = false;
        if (!ShellRules.bridgeAllowed(url)) return;
        web.evaluateJavascript("(function(){var s=document.querySelector('script[type=module][src]');return s?s.src:''})()", v -> {
            String src = v == null ? "" : v.replace("\"", "");
            loaded = UpdateRules.path(src);
        });
    }

    /** The console came on screen or went off it. */
    static void visibility() {
        ui.removeCallbacks(reloadWhenHidden);
        if (onScreen()) check(false);
        else if (pending) ui.postDelayed(reloadWhenHidden, UpdateRules.OFF_SCREEN_MS);
    }

    /** Fetches the live index.html off the UI thread and acts on it. */
    static void check(boolean force) {
        long now = SystemClock.elapsedRealtime();
        if (!UpdateRules.due(now, lastCheck, force)) return;
        lastCheck = now;
        new Thread(() -> {
            String entry = "";
            try { entry = UpdateRules.entry(fetch(ShellRules.HOME)); lastResult = entry.isEmpty() ? "no entry bundle on the live console" : "ok"; }
            catch (Exception e) { lastResult = "offline: " + e.getClass().getSimpleName(); }
            String got = entry;
            ui.post(() -> decide(got));
        }, "axf-content-update").start();
    }

    private static void decide(String entry) {
        if (!entry.isEmpty()) live = entry;
        String a = UpdateRules.action(loaded, live, onScreen());
        if (UpdateRules.NONE.equals(a)) return;
        pending = true;
        if (UpdateRules.RELOAD.equals(a)) { ui.removeCallbacks(reloadWhenHidden); ui.postDelayed(reloadWhenHidden, UpdateRules.OFF_SCREEN_MS); }
        else NativeBridge.emit("shell.update", stateJson());
    }

    /** Reloads the console (the bridge's native.update:reload, or a pending update off screen). */
    static void reload() {
        WebView w = WebHost.current();
        if (w == null) return;
        pending = false;
        ui.removeCallbacks(reloadWhenHidden);
        String url = NativeBridge.currentUrl;
        if (ShellRules.bridgeAllowed(url)) w.reload(); else w.loadUrl(ShellRules.HOME);
    }

    static String stateJson() {
        return "{\"loaded\":" + JSONObject.quote(loaded) + ",\"live\":" + JSONObject.quote(live) + ",\"pending\":" + pending
            + ",\"onScreen\":" + onScreen() + ",\"lastResult\":" + JSONObject.quote(lastResult)
            + ",\"checkedAgoS\":" + (lastCheck <= 0 ? -1 : (SystemClock.elapsedRealtime() - lastCheck) / 1000) + "}";
    }

    private static String fetch(String url) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setConnectTimeout(10_000);
        c.setReadTimeout(10_000);
        c.setUseCaches(false);
        c.setRequestProperty("Cache-Control", "no-cache");
        try (InputStream in = c.getInputStream(); Reader r = new InputStreamReader(in, StandardCharsets.UTF_8)) {
            StringBuilder b = new StringBuilder();
            char[] buf = new char[8192];
            int n;
            while ((n = r.read(buf)) > 0 && b.length() < UpdateRules.MAX_HTML) b.append(buf, 0, n);
            return b.toString();
        } finally { c.disconnect(); }
    }
}
