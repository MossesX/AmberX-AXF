package ai.amberx.consoleapp;

import android.app.Activity;
import android.app.NotificationManager;
import android.content.Context;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * {@code window.axfNative}, the Android side (console app part 3). The WebView exposes this object as
 * {@link BridgeContract#HOST}; {@link #onPageFinished} builds the page-side {@code window.axfNative} over it on every
 * page from Brett's sites; {@link #call} takes one call, runs the tool on the main thread and answers through the
 * {@link BridgeContract#EVENT} window event. The same dispatcher answers the hub ({@link #run}), so a tool is written once.
 *
 * Wiring (one line each in {@code ConsoleActivity}): {@code bridge = DeviceBridge.attach(this, web)} after the WebView
 * exists, and {@code bridge.onPageFinished(view, url)} from the client's {@code onPageFinished}.
 *
 * The bridge itself answers {@code bridge.ping|info|capabilities} and {@code permissions.status}; mic, recorder,
 * open_url, wake and notifications {@link #register} themselves in the later steps of this build. A contract tool with
 * no code yet answers {@link BridgeContract#E_NOT_IMPLEMENTED}, never silence.
 */
final class DeviceBridge {
    /** One native tool: runs on the main thread, returns the data the caller gets, throws to answer an error. */
    interface Tool { JSONObject run(JSONObject args) throws Exception; }

    private final Activity activity;
    private final WebView web;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final Map<String, Tool> tools = new LinkedHashMap<>();
    /** The bridge on screen, for the hub link and the overlay (null when the activity is gone): the focused slot's. */
    static volatile DeviceBridge current;
    /** Every slot's bridge (up to four, {@link SlotHost}); phone-wide events reach all of them. */
    private static final List<DeviceBridge> live = new java.util.concurrent.CopyOnWriteArrayList<>();

    private DeviceBridge(Activity activity, WebView web) {
        this.activity = activity;
        this.web = web;
    }

    /** Exposes the bridge to the WebView and registers the bridge's own tools. */
    static DeviceBridge attach(Activity activity, WebView web) {
        DeviceBridge b = new DeviceBridge(activity, web);
        web.addJavascriptInterface(b, BridgeContract.HOST);
        b.register(BridgeContract.PING, args -> new JSONObject().put("pong", true).put("at", System.currentTimeMillis()));
        b.register(BridgeContract.INFO, args -> b.info());
        b.register(BridgeContract.CAPABILITIES, args -> b.capabilities());
        b.register(BridgeContract.PERM_STATUS, args -> permissions(activity));
        live.add(b);
        current = b;
        return b;
    }

    void detach() {
        live.remove(this);
        if (current == this) current = live.isEmpty() ? null : live.get(0);
    }

    /** The focused slot's bridge takes the hub's calls and the overlay ({@link SlotHost#focus}). */
    void makeCurrent() { current = this; }

    WebView web() { return web; }

    /** A later step plugs a tool in; the name must be in the contract. */
    void register(String tool, Tool t) {
        if (!BridgeContract.TOOLS.contains(tool)) throw new IllegalArgumentException("not a bridge tool: " + tool);
        tools.put(tool, t);
    }

    boolean has(String tool) { return tools.containsKey(tool); }

    /** Builds {@code window.axfNative} on a page from Brett's sites; any other page gets nothing. */
    void onPageFinished(WebView view, String url) {
        if (BridgeContract.allowedFrom(url)) view.evaluateJavascript(BridgeContract.script(), null);
    }

    /* ------------------------------------------------------------------ from the page */

    /** The page's one entry point ({@code axfBridgeHost.call(json)}); runs on the WebView's bridge thread. */
    @JavascriptInterface
    public void call(String json) {
        main.post(() -> {
            String id = BridgeContract.idOf(json);
            String url = web.getUrl();
            if (!BridgeContract.allowedFrom(url)) {
                // not one of Brett's sites: nothing is answered, nothing runs (the page-side object isn't even built there)
                return;
            }
            BridgeContract.Call c;
            try { c = BridgeContract.parse(json); }
            catch (IllegalArgumentException e) { send(BridgeContract.error(id, null, BridgeContract.E_BAD_ARGS, e.getMessage())); return; }
            send(answer(c.id, c.tool, c.args, false));
        });
    }

    /* ------------------------------------------------------------------ from the hub (and any other native caller) */

    /**
     * Runs a tool for the axHub device link or another native caller, on the main thread, and hands the answer back.
     * Hub calls are held to {@link BridgeContract#HUB_TOOLS}; a page-only tool answers {@code denied}.
     */
    void run(String name, JSONObject args, Reply reply) {
        String tool = BridgeContract.tool(name);
        main.post(() -> {
            if (tool == null) { reply.answer(BridgeContract.error(null, name, BridgeContract.E_UNKNOWN, "The console app doesn't know \"" + name + "\".")); return; }
            reply.answer(answer(null, tool, BridgeContract.argsFor(name, args), true));
        });
    }

    interface Reply { void answer(JSONObject message); }

    /** Runs one tool now (main thread) and builds its answer; never throws. */
    JSONObject answer(String id, String tool, JSONObject args, boolean fromHub) {
        if (fromHub && !BridgeContract.hubTool(tool)) return BridgeContract.error(id, tool, BridgeContract.E_DENIED, "\"" + tool + "\" can only be used from the console on the phone.");
        List<String> missing = new ArrayList<>();
        for (String p : BridgeContract.permissionsFor(tool, args)) if (!granted(activity, p)) missing.add(p);
        if (!missing.isEmpty()) return BridgeContract.permissionError(id, tool, missing);
        Tool t = tools.get(tool);
        if (t == null) return BridgeContract.error(id, tool, BridgeContract.E_NOT_IMPLEMENTED, "\"" + tool + "\" isn't in this build of the console app yet.");
        try { return BridgeContract.result(id, tool, t.run(args)); }
        catch (Exception e) { return BridgeContract.error(id, tool, BridgeContract.codeFor(e), String.valueOf(e.getMessage())); }
    }

    /* ------------------------------------------------------------------ to the page */

    /** Hands an answer or an event to the page, only while it is one of Brett's sites. */
    void send(JSONObject message) {
        main.post(() -> {
            if (!BridgeContract.allowedFrom(web.getUrl())) return;
            web.evaluateJavascript(BridgeContract.deliver(message), null);
        });
    }

    /** A native event ({@link BridgeContract#EVENTS}) for {@code axfNative.on(name, fn)}, in every open slot. */
    void emit(String event, JSONObject data) {
        JSONObject message = BridgeContract.event(event, data);
        if (!live.contains(this)) { send(message); return; }
        for (DeviceBridge b : live) b.send(message);
    }

    /* ------------------------------------------------------------------ the bridge's own tools */

    JSONObject info() throws Exception {
        return new JSONObject()
            .put("app", BridgeContract.APP)
            .put("version", BuildConfigInfo.version(activity))
            .put("bridge", BridgeContract.VERSION)
            .put("sdk", Build.VERSION.SDK_INT)
            .put("device", (Build.MANUFACTURER + " " + Build.MODEL).trim())
            .put("tools", new JSONArray(new ArrayList<>(tools.keySet())));
    }

    JSONObject capabilities() throws Exception {
        JSONArray caps = new JSONArray();
        for (String c : BridgeContract.CAPABILITIES_ALL) {
            boolean any = false;
            for (String t : tools.keySet()) if (c.equals(BridgeContract.capabilityOf(t))) any = true;
            if (any) caps.put(c);
        }
        JSONArray pending = new JSONArray();
        for (String t : BridgeContract.TOOLS) if (!tools.containsKey(t)) pending.put(t);
        return new JSONObject().put("bridge", BridgeContract.VERSION).put("capabilities", caps)
            .put("tools", new JSONArray(new ArrayList<>(tools.keySet()))).put("notYet", pending)
            .put("events", new JSONArray(BridgeContract.EVENTS));
    }

    /** {@code permissions.status}: every permission the shell may hold, by its short key, true when granted. */
    static JSONObject permissions(Context c) throws Exception {
        JSONObject o = new JSONObject();
        for (String key : BridgeContract.permissionKeys()) o.put(key, granted(c, BridgeContract.permission(key)));
        return o;
    }

    /** Whether the shell holds a permission now (overlay and notifications have their own checks). */
    static boolean granted(Context c, String permission) {
        if (BridgeContract.DRAW_OVER.equals(permission)) return Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(c);
        if (BridgeContract.POST_NOTIFICATIONS.equals(permission)) {
            NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
            boolean enabled = Build.VERSION.SDK_INT < Build.VERSION_CODES.N || nm == null || nm.areNotificationsEnabled();
            if (Build.VERSION.SDK_INT >= 33) enabled = enabled && c.checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED;
            return enabled;
        }
        return c.checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED;
    }
}
