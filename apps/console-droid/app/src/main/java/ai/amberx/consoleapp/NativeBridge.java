package ai.amberx.consoleapp;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import java.util.HashMap;
import java.util.Iterator;
import java.util.Map;
import org.json.JSONObject;

/**
 * {@code window.axfNativeHost}: what the console page may ask of the phone. The console wraps it as
 * {@code window.axfNative} (apps/console-web/src/native/axfNative.ts) and routes every console action, setting and
 * MCP / REST / CLI / voice command for the phone through it, so the native features have the same four ways in as
 * everything else in the console. Native → page goes the other way as {@code axf-native} DOM events ({@link #emit}).
 *
 * Only Brett's own pages may call it ({@link ShellRules#bridgeAllowed}): a page from any other site gets "denied".
 * Every method answers a JSON string.
 */
final class NativeBridge {
    static final String NAME = "axfNativeHost";
    /** The page now showing, kept by {@link WebHost} (JavaScript calls arrive off the UI thread, where getUrl() can't run). */
    static volatile String currentUrl = "";

    private final Context app;
    private final Handler ui = new Handler(Looper.getMainLooper());

    private NativeBridge(Context app) { this.app = app; }

    static void install(WebView web) {
        web.addJavascriptInterface(new NativeBridge(web.getContext().getApplicationContext()), NAME);
    }

    /** Sends an event to the page: {@code window.addEventListener('axf-native', e => e.detail.type / e.detail.data)}. */
    static void emit(String type, String json) {
        if (!ShellRules.bridgeAllowed(currentUrl)) return;
        WebHost.js("window.dispatchEvent(new CustomEvent('axf-native',{detail:{type:" + JSONObject.quote(type) + ",data:" + (json == null ? "null" : json) + "}}))");
    }

    private boolean allowed() { return ShellRules.bridgeAllowed(currentUrl); }
    private static final String DENIED = "{\"ok\":false,\"error\":\"denied\"}";
    private static String ok(String extra) { return "{\"ok\":true" + (extra == null ? "" : "," + extra) + "}"; }
    private static String fail(String why) { return "{\"ok\":false,\"error\":" + JSONObject.quote(why) + "}"; }

    /** What shell this is and what it can do. */
    @JavascriptInterface public String info() {
        if (!allowed()) return DENIED;
        return ok("\"shell\":\"console-droid\",\"version\":" + JSONObject.quote(BuildConfigInfo.version(app))
            + ",\"features\":[\"overlay\",\"notifications\",\"mic\",\"permissions\",\"openUrl\",\"wake\",\"insets\",\"update\",\"device\"]"
            + ",\"device\":" + DeviceLink.stateJson());
    }

    // ---- permissions ----
    @JavascriptInterface public String permissions() {
        return allowed() ? ok("\"permissions\":" + Perms.stateJson(app)) : DENIED;
    }

    @JavascriptInterface public String requestPermission(String name) {
        if (!allowed()) return DENIED;
        boolean known = false;
        for (String n : Perms.ALL) known |= n.equals(name);
        if (!known) return fail("no permission \"" + name + "\" (mic, notifications, overlay)");
        ui.post(() -> Perms.request(name, null));
        return ok("\"asked\":" + JSONObject.quote(name));
    }

    // ---- notifications ----
    @JavascriptInterface public String notify(String json) {
        if (!allowed()) return DENIED;
        try {
            JSONObject o = new JSONObject(json);
            boolean shown = Notifier.show(app, o.optString("id", "console"), o.optString("title"), o.optString("text"), o.optString("link", null), o.optString("channel", "alerts"));
            return shown ? ok(null) : fail("notifications are off for the console app (requestPermission('notifications'))");
        } catch (Exception e) { return fail("bad notification: " + e.getMessage()); }
    }

    @JavascriptInterface public String cancelNotification(String id) {
        if (!allowed()) return DENIED;
        Notifier.cancel(app, id);
        return ok(null);
    }

    // ---- open_url ----
    /** {@code where}: "app" (default, inside the console app), "overlay" (the expanded overlay), "browser" (the phone's browser). */
    @JavascriptInterface public String openUrl(String url, String where) {
        if (!allowed()) return DENIED;
        String w = where == null || where.isEmpty() ? "app" : where;
        if ("browser".equals(w)) {
            try { ShellRules.allowed(url); } catch (IllegalArgumentException e) { return fail(e.getMessage()); }
            ui.post(() -> WebHost.openOutside(app, Uri.parse(url)));
            return ok(null);
        }
        String target = ShellRules.deepLink(url);
        if (url == null || !url.startsWith(ShellRules.SCHEME + "://") && !ShellRules.staysInside(url)) return fail("only Brett's own sites open inside the app (where: \"browser\" for the phone's browser)");
        ui.post(() -> {
            WebHost.open(app, url);
            if ("overlay".equals(w) && OverlayService.running != null) OverlayService.verb(app, "expand");
            else if (WebHost.activity == null || !WebHost.activity.hasWindowFocus()) Wake.front(app, false);
        });
        return ok("\"opened\":" + JSONObject.quote(target));
    }

    // ---- wake ----
    /** Brings the console to the front, turning the screen on (console wake: a command needs Brett's eyes). */
    @JavascriptInterface public String wake() {
        if (!allowed()) return DENIED;
        ui.post(() -> Wake.front(app, true));
        return ok(null);
    }

    // ---- web content updates ----
    /** check (fetch the live console now), reload (load the newest console now), state: answers the update state. */
    @JavascriptInterface public String update(String verb) {
        if (!allowed()) return DENIED;
        if (!UpdateRules.verb(verb)) return fail("update verbs: check, reload, state");
        if ("check".equals(verb)) ui.post(() -> ContentUpdate.check(true));
        if ("reload".equals(verb)) ui.post(ContentUpdate::reload);
        return ok("\"update\":" + ContentUpdate.stateJson());
    }

    // ---- overlay ----
    @JavascriptInterface public String overlay(String verb) {
        if (!allowed()) return DENIED;
        if (!OverlayContract.isVerb(verb)) return fail(OverlayContract.verbsHelp());
        String v = verb.toLowerCase(java.util.Locale.ROOT);
        ui.post(() -> OverlayService.verb(app, v));
        return ok(null);
    }

    @JavascriptInterface public String overlayState() {
        return allowed() ? ok("\"overlay\":" + OverlayService.stateJson() + ",\"canDraw\":" + Perms.has(app, Perms.OVERLAY)) : DENIED;
    }

    /** The console's approvals-banner.overlay.* settings ({"on":true,"edge":"end",…}). */
    @JavascriptInterface public String overlayConfigure(String json) {
        if (!allowed()) return DENIED;
        try {
            Map<String, Object> m = map(new JSONObject(json));
            ui.post(() -> OverlayService.configure(app, m));
            return ok(null);
        } catch (Exception e) { return fail("bad overlay settings: " + e.getMessage()); }
    }

    /** What waits: the count, how many are held commands, the first one's title. */
    @JavascriptInterface public String overlayApprovals(int count, int held, String firstTitle) {
        if (!allowed()) return DENIED;
        ui.post(() -> OverlayService.approvals(count, held, firstTitle));
        return ok(null);
    }

    // ---- theme ----
    /** The page's live --fx-* tokens, for the native toolbar's look ({"--fx-surface":"#1a1a1a",…}). */
    @JavascriptInterface public String theme(String json) {
        if (!allowed()) return DENIED;
        try {
            JSONObject o = new JSONObject(json);
            Map<String, String> m = new HashMap<>();
            for (Iterator<String> k = o.keys(); k.hasNext(); ) { String key = k.next(); m.put(key, o.optString(key)); }
            ui.post(() -> { ShellTheme.init(app); ShellTheme.apply(m); if (OverlayService.running != null) OverlayService.running.restyle(); });
            return ok(null);
        } catch (Exception e) { return fail("bad theme: " + e.getMessage()); }
    }

    @JavascriptInterface public String themeTokens() {
        if (!allowed()) return DENIED;
        StringBuilder b = new StringBuilder("[");
        for (int i = 0; i < ShellTheme.TOKENS.length; i++) b.append(i == 0 ? "" : ",").append(JSONObject.quote(ShellTheme.TOKENS[i]));
        return ok("\"tokens\":" + b.append(']'));
    }

    // ---- safe area ----
    @JavascriptInterface public String insets() {
        return allowed() ? ok("\"insets\":" + Insets.json()) : DENIED;
    }

    /** The page pads its own bars with the insets: the shell stops padding the WebView for it. */
    @JavascriptInterface public String insetsHandled(boolean handled) {
        if (!allowed()) return DENIED;
        ui.post(() -> Insets.pageHandles(handled));
        return ok(null);
    }

    static Map<String, Object> map(JSONObject o) {
        Map<String, Object> m = new HashMap<>();
        for (Iterator<String> k = o.keys(); k.hasNext(); ) { String key = k.next(); m.put(key, o.opt(key)); }
        return m;
    }

    /** Starts the app (for the bridge's helpers). */
    static void startApp(Context c, boolean wake) {
        c.startActivity(new Intent(c, ConsoleActivity.class).putExtra(Wake.EXTRA, wake).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP));
    }
}
