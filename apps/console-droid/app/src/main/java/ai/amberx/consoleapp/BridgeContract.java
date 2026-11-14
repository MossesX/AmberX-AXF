package ai.amberx.consoleapp;

import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Pattern;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * The native bridge contract ({@code native-bridge@1}, console app part 3): one vocabulary for everything the shell does
 * natively, whichever way it is asked.
 *
 * <ul>
 *   <li><b>The page</b> ({@code window.axfNative}, only on Brett's own sites, {@link ShellRules#bridgeAllowed}) calls
 *       {@code axfNative.call(tool, args)} and gets a Promise; the native side answers through a {@code CustomEvent}
 *       named {@link #EVENT} on {@code window}, and sends unsolicited {@link #event events} the same way.</li>
 *   <li><b>axHub</b> (the {@code amberx} device service, AXPP) calls the same tools with the names AmberX answered to
 *       ({@code amberx.open_url}, {@code amberx.recorder_start|stop|status}); {@link #tool} maps every spelling onto one
 *       bridge tool, so the hub, its MCP tools, the console API, the CLI and voice all reach the same code.</li>
 * </ul>
 *
 * No Android imports: every rule here runs under plain JUnit ({@code BridgeContractTest}). {@code DeviceBridge} is the
 * Android side (the JavascriptInterface and the dispatcher); the tools themselves (mic, recorder, open_url, wake,
 * notifications) register with it in the later steps of this build.
 */
final class BridgeContract {
    private BridgeContract() {}

    /** The page-side object: {@code window.axfNative}. */
    static final String NAME = "axfNative";
    /** The Java object the WebView exposes ({@code addJavascriptInterface}); the page never calls it directly. */
    static final String HOST = "axfBridgeHost";
    static final String VERSION = "native-bridge@1";
    /** The window event every answer and every native event arrives on: {@code detail} is the JSON below. */
    static final String EVENT = "axf-native";
    /** Fired once the page-side object exists, so a console that loaded first can start using it. */
    static final String READY_EVENT = "axf-native-ready";
    /** What this shell says it is in the AXPP {@code hello} ({@code app}); AmberX said {@code amberx-droid}. */
    static final String APP = "console-droid";
    static final int MAX_CALL = 64 * 1024;
    private static final Pattern ID = Pattern.compile("^[A-Za-z0-9_.:-]{1,64}$");

    /* ------------------------------------------------------------------ tools */

    static final String PING = "bridge.ping";
    static final String INFO = "bridge.info";
    static final String CAPABILITIES = "bridge.capabilities";
    static final String PERM_STATUS = "permissions.status";
    static final String PERM_REQUEST = "permissions.request";
    static final String MIC_STATUS = "mic.status";
    static final String MIC_SET = "mic.set";
    static final String REC_START = "recorder.start";
    static final String REC_STOP = "recorder.stop";
    static final String REC_STATUS = "recorder.status";
    /** Open one of Brett's own pages in the app (AmberX's {@code browser.open}, hub tool {@code amberx.open_url}). */
    static final String OPEN = "browser.open";
    /** Bring the console to the front, at a console-control address when given (console wake, Nov 3 2026). */
    static final String WAKE = "console.wake";
    static final String NOTIFY_SHOW = "notify.show";
    static final String NOTIFY_CANCEL = "notify.cancel";
    static final String NOTIFY_STATUS = "notify.status";
    /** Up to four consoles side by side in the one app (Brett, Nov 13 2026: "runs on four slots at the same time"). */
    static final String SLOTS_STATUS = "slots.status";
    static final String SLOTS_OPEN = "slots.open";
    static final String SLOTS_CLOSE = "slots.close";
    static final String SLOTS_FOCUS = "slots.focus";

    static final List<String> TOOLS = Arrays.asList(
        PING, INFO, CAPABILITIES, PERM_STATUS, PERM_REQUEST, MIC_STATUS, MIC_SET,
        REC_START, REC_STOP, REC_STATUS, OPEN, WAKE, NOTIFY_SHOW, NOTIFY_CANCEL, NOTIFY_STATUS,
        SLOTS_STATUS, SLOTS_OPEN, SLOTS_CLOSE, SLOTS_FOCUS);

    /** Tools axHub may call through the device service; the rest need the page (they prompt or change a phone setting). */
    static final List<String> HUB_TOOLS = Arrays.asList(
        PING, INFO, CAPABILITIES, PERM_STATUS, MIC_STATUS, REC_START, REC_STOP, REC_STATUS, OPEN, WAKE,
        NOTIFY_SHOW, NOTIFY_CANCEL, NOTIFY_STATUS, SLOTS_STATUS, SLOTS_OPEN, SLOTS_CLOSE, SLOTS_FOCUS);

    /** Starting a recording is never auto-approved anywhere (axHub decision #108); every other tool may be. */
    static final List<String> NEVER_AUTO = Arrays.asList(REC_START);

    /** Other spellings of the same tool: axHub's MCP names, AmberX's AXPP names, the console's snake_case commands. */
    private static final Map<String, String> ALIASES = new LinkedHashMap<>();
    static {
        alias(OPEN, "amberx.open_url", "open_url", "open-url", "browser_open", "console.open_url");
        alias(REC_START, "amberx.recorder_start", "recorder_start", "recorder-start");
        alias(REC_STOP, "amberx.recorder_stop", "recorder_stop", "recorder-stop");
        alias(REC_STATUS, "amberx.recorder_status", "recorder_status", "recorder-status");
        alias(WAKE, "amberx.wake", "amberx.console_wake", "console_wake", "console-wake", "wake");
        alias(NOTIFY_SHOW, "amberx.notify", "notify", "notify_show", "notification.show");
        alias(NOTIFY_CANCEL, "notify_cancel", "notification.cancel");
        alias(NOTIFY_STATUS, "notify_status", "notification.status");
        alias(MIC_STATUS, "mic_status", "amberx.mic_status");
        alias(MIC_SET, "mic_set", "amberx.mic_set", "mic.on", "mic.off");
        alias(PERM_STATUS, "permissions_status", "permissions");
        alias(PERM_REQUEST, "permissions_request");
        alias(INFO, "info", "bridge_info", "version");
        alias(PING, "ping");
        alias(CAPABILITIES, "capabilities", "bridge_capabilities");
        alias(SLOTS_STATUS, "slots", "amberx.slots", "slot.status");
        alias(SLOTS_OPEN, "slot.open", "slot_open");
        alias(SLOTS_CLOSE, "slot.close", "slot_close");
        alias(SLOTS_FOCUS, "slot.focus", "slot_focus");
    }

    private static void alias(String tool, String... names) {
        for (String n : names) ALIASES.put(n, tool);
    }

    /** The bridge tool a name means (any alias, any case, surrounding spaces), or null when it means nothing here. */
    static String tool(String raw) {
        if (raw == null) return null;
        String s = raw.trim().toLowerCase(Locale.ROOT);
        if (s.isEmpty()) return null;
        if (TOOLS.contains(s)) return s;
        if (ALIASES.containsKey(s)) return ALIASES.get(s);
        // the hub's generic spelling: amberx.<group>_<verb>
        if (s.startsWith("amberx.")) return tool(s.substring("amberx.".length()));
        String dotted = s.replace('_', '.');
        return TOOLS.contains(dotted) ? dotted : null;
    }

    /** The hub's MCP name for a bridge tool (what Claude calls on axHub), the same as AmberX's so nothing there changes. */
    static String hubName(String tool) {
        switch (tool == null ? "" : tool) {
            case OPEN: return "amberx.open_url";
            case REC_START: return "amberx.recorder_start";
            case REC_STOP: return "amberx.recorder_stop";
            case REC_STATUS: return "amberx.recorder_status";
            case WAKE: return "amberx.console_wake";
            case NOTIFY_SHOW: return "amberx.notify";
            default: return HUB_TOOLS.contains(tool) ? "amberx." + tool.replace('.', '_') : null;
        }
    }

    static boolean hubTool(String tool) { return HUB_TOOLS.contains(tool); }

    /** {@code mic.on} / {@code mic.off} carry their argument in the name. */
    static JSONObject argsFor(String rawName, JSONObject args) {
        JSONObject a = args == null ? new JSONObject() : args;
        String s = rawName == null ? "" : rawName.trim().toLowerCase(Locale.ROOT);
        try {
            if ("mic.on".equals(s)) a.put("on", true);
            if ("mic.off".equals(s)) a.put("on", false);
        } catch (Exception ignored) { /* a JSONObject.put of a boolean never fails */ }
        return a;
    }

    /* ------------------------------------------------------------------ capabilities (AXPP hello) */

    /** AmberX's two, kept so axHub's device service keeps working unchanged, plus this shell's own. */
    static final String CAP_RECORDER = "recorder@1";
    static final String CAP_OPEN_URL = "open-url@1";
    static final String CAP_WAKE = "console-wake@1";
    static final String CAP_MIC = "mic@1";
    static final String CAP_NOTIFY = "notify@1";
    static final String CAP_SLOTS = "console-slots@1";
    static final List<String> CAPABILITIES_ALL = Arrays.asList(CAP_RECORDER, CAP_OPEN_URL, CAP_WAKE, CAP_MIC, CAP_NOTIFY, CAP_SLOTS);

    /** The capability a tool belongs to (its state travels with every AXPP answer), or null for the bridge's own. */
    static String capabilityOf(String tool) {
        switch (tool == null ? "" : tool) {
            case REC_START: case REC_STOP: case REC_STATUS: return CAP_RECORDER;
            case OPEN: return CAP_OPEN_URL;
            case WAKE: return CAP_WAKE;
            case MIC_STATUS: case MIC_SET: return CAP_MIC;
            case NOTIFY_SHOW: case NOTIFY_CANCEL: case NOTIFY_STATUS: return CAP_NOTIFY;
            case SLOTS_STATUS: case SLOTS_OPEN: case SLOTS_CLOSE: case SLOTS_FOCUS: return CAP_SLOTS;
            default: return null;
        }
    }

    /* ------------------------------------------------------------------ permissions */

    static final String RECORD_AUDIO = "android.permission.RECORD_AUDIO";
    static final String POST_NOTIFICATIONS = "android.permission.POST_NOTIFICATIONS";
    static final String DRAW_OVER = "android.permission.SYSTEM_ALERT_WINDOW";
    /** Every runtime permission the shell may hold, keyed by the short name the page and the hub see. */
    private static final Map<String, String> PERMISSIONS = new LinkedHashMap<>();
    static {
        PERMISSIONS.put("mic", RECORD_AUDIO);
        PERMISSIONS.put("notifications", POST_NOTIFICATIONS);
        PERMISSIONS.put("overlay", DRAW_OVER);
    }

    static List<String> permissionKeys() { return Arrays.asList(PERMISSIONS.keySet().toArray(new String[0])); }

    /** The Android permission for a short key or a full name, or null. */
    static String permission(String keyOrName) {
        if (keyOrName == null) return null;
        String s = keyOrName.trim();
        if (PERMISSIONS.containsValue(s)) return s;
        return PERMISSIONS.get(s.toLowerCase(Locale.ROOT));
    }

    /** The short key for an Android permission ({@code mic}, {@code notifications}, {@code overlay}), or null. */
    static String permissionKey(String permission) {
        for (Map.Entry<String, String> e : PERMISSIONS.entrySet()) if (e.getValue().equals(permission)) return e.getKey();
        return null;
    }

    /** The permissions a call needs before it can do anything; empty when none (the caller checks them first). */
    static List<String> permissionsFor(String tool, JSONObject args) {
        JSONObject a = args == null ? new JSONObject() : args;
        switch (tool == null ? "" : tool) {
            case REC_START:
                return a.optBoolean("mic", false) ? Arrays.asList(POST_NOTIFICATIONS, RECORD_AUDIO) : Arrays.asList(POST_NOTIFICATIONS);
            case MIC_SET:
                return a.optBoolean("on", false) ? Arrays.asList(RECORD_AUDIO) : Arrays.<String>asList();
            case NOTIFY_SHOW:
                return Arrays.asList(POST_NOTIFICATIONS);
            default:
                return Arrays.asList();
        }
    }

    /* ------------------------------------------------------------------ calls from the page */

    static final class Call {
        final String id, tool, name;
        final JSONObject args;
        Call(String id, String name, String tool, JSONObject args) { this.id = id; this.name = name; this.tool = tool; this.args = args; }
    }

    /** The id inside a call's JSON when there is one (so even a refused call can be answered), else null. */
    static String idOf(String json) {
        try {
            Object id = new JSONObject(json).opt("id");
            return id instanceof String && ID.matcher((String) id).matches() ? (String) id : null;
        } catch (Exception e) { return null; }
    }

    /** A call the page sent, checked; throws with a message the page gets back as {@link #E_BAD_ARGS}. */
    static Call parse(String json) {
        if (json == null || json.trim().isEmpty()) throw new IllegalArgumentException("call is empty.");
        if (json.length() > MAX_CALL) throw new IllegalArgumentException("call is too long.");
        JSONObject o;
        try { o = new JSONObject(json); } catch (Exception e) { throw new IllegalArgumentException("call isn't a JSON object."); }
        Object id = o.opt("id");
        if (!(id instanceof String) || !ID.matcher((String) id).matches()) throw new IllegalArgumentException("id is required (1-64 letters, digits, _ . : -).");
        String name = o.optString("tool", "");
        String tool = tool(name);
        if (tool == null) throw new IllegalArgumentException("The console app doesn't know \"" + name + "\".");
        Object args = o.opt("args");
        if (args != null && args != JSONObject.NULL && !(args instanceof JSONObject)) throw new IllegalArgumentException("args must be an object.");
        return new Call((String) id, name, tool, argsFor(name, args instanceof JSONObject ? (JSONObject) args : new JSONObject()));
    }

    /* ------------------------------------------------------------------ answers and events */

    static final String E_UNKNOWN = "unknown_tool";
    static final String E_BAD_ARGS = "bad_args";
    /** The page isn't one of Brett's sites, or the hub asked for a page-only tool. */
    static final String E_DENIED = "denied";
    /** A permission is missing; {@code error.permissions} lists the short keys to ask for. */
    static final String E_PERMISSION = "permission";
    static final String E_UNAVAILABLE = "unavailable";
    /** The tool is in the contract but its code hasn't landed yet (a later step of this build). */
    static final String E_NOT_IMPLEMENTED = "not_implemented";
    static final List<String> CODES = Arrays.asList(E_UNKNOWN, E_BAD_ARGS, E_DENIED, E_PERMISSION, E_UNAVAILABLE, E_NOT_IMPLEMENTED);

    static JSONObject result(String id, String tool, JSONObject data) {
        try {
            return new JSONObject().put("id", id == null ? JSONObject.NULL : id).put("tool", tool).put("ok", true)
                .put("data", data == null ? new JSONObject() : data);
        } catch (Exception e) { throw new IllegalStateException(e); }
    }

    static JSONObject error(String id, String tool, String code, String message) {
        if (!CODES.contains(code)) throw new IllegalArgumentException("unknown error code " + code);
        try {
            return new JSONObject().put("id", id == null ? JSONObject.NULL : id).put("tool", tool == null ? JSONObject.NULL : tool).put("ok", false)
                .put("error", new JSONObject().put("code", code).put("message", message == null ? "" : message));
        } catch (Exception e) { throw new IllegalStateException(e); }
    }

    /** A missing-permission error that also says what to ask for. */
    static JSONObject permissionError(String id, String tool, List<String> missing) {
        JSONArray keys = new JSONArray();
        List<String> names = new java.util.ArrayList<>();
        for (String p : missing) {
            String k = permissionKey(p) == null ? p : permissionKey(p);
            keys.put(k);
            names.add(k);
        }
        JSONObject e = error(id, tool, E_PERMISSION, "The console app needs permission first: " + String.join(", ", names) + ".");
        try { e.getJSONObject("error").put("permissions", keys); } catch (Exception ignored) { /* the key exists */ }
        return e;
    }

    /** The error code for what a tool threw: bad arguments, a missing permission, or anything else. */
    static String codeFor(Throwable t) {
        if (t instanceof IllegalArgumentException) return E_BAD_ARGS;
        if (t instanceof SecurityException) return E_PERMISSION;
        if (t instanceof UnsupportedOperationException) return E_NOT_IMPLEMENTED;
        return E_UNAVAILABLE;
    }

    /** Native events the page may listen for with {@code axfNative.on(name, fn)}. */
    static final String EV_RECORDER = "recorder";
    static final String EV_MIC = "mic";
    static final String EV_PERMISSION = "permission";
    static final String EV_WAKE = "wake";
    /** The axHub device link went up or down ({@code data.up}). */
    static final String EV_LINK = "link";
    /** The slots changed (opened, closed, focused, laid out again): {@code slots.status}'s answer. */
    static final String EV_SLOTS = "slots";
    static final List<String> EVENTS = Arrays.asList(EV_RECORDER, EV_MIC, EV_PERMISSION, EV_WAKE, EV_LINK, EV_SLOTS);

    static JSONObject event(String name, JSONObject data) {
        if (!EVENTS.contains(name)) throw new IllegalArgumentException("unknown event " + name);
        try { return new JSONObject().put("event", name).put("data", data == null ? new JSONObject() : data); }
        catch (Exception e) { throw new IllegalStateException(e); }
    }

    /* ------------------------------------------------------------------ the page side */

    /** True when the page now showing may use the bridge: only Brett's own sites ({@link ShellRules#bridgeAllowed}). */
    static boolean allowedFrom(String url) { return ShellRules.bridgeAllowed(url); }

    /** JSON as a JavaScript literal: JSON is JS apart from U+2028/U+2029, which end a JS line. */
    static String jsLiteral(JSONObject o) {
        return o.toString().replace("\u2028", "\\u2028").replace("\u2029", "\\u2029");
    }

    /** The statement that hands an answer or an event to the page. */
    static String deliver(JSONObject message) {
        return "window.dispatchEvent(new CustomEvent(" + JSONObject.quote(EVENT) + ",{detail:" + jsLiteral(message) + "}));";
    }

    /**
     * The script the shell runs on every page from Brett's sites: builds {@code window.axfNative} over the host object.
     * Idempotent, so running it again after a navigation changes nothing. A console that has no host (a desktop browser)
     * simply has no {@code window.axfNative}.
     */
    static String script() {
        return "(function(){"
            + "if(window." + NAME + "&&window." + NAME + ".version===" + JSONObject.quote(VERSION) + ")return;"
            + "var host=window." + HOST + ";if(!host)return;"
            + "var pending={},n=0,listeners={};"
            + "function call(tool,args){return new Promise(function(res,rej){"
            + "var id='c'+(++n)+'-'+Date.now().toString(36);pending[id]={res:res,rej:rej};"
            + "try{host.call(JSON.stringify({id:id,tool:tool,args:args||{}}));}catch(e){delete pending[id];rej(e);}});}"
            + "window.addEventListener(" + JSONObject.quote(EVENT) + ",function(ev){var m=ev.detail||{};"
            + "if(m.id&&pending[m.id]){var p=pending[m.id];delete pending[m.id];"
            + "if(m.ok)p.res(m.data);else{var e=new Error(m.error&&m.error.message||'failed');e.code=m.error&&m.error.code;e.permissions=m.error&&m.error.permissions;p.rej(e);}}"
            + "else if(m.event){(listeners[m.event]||[]).concat(listeners['*']||[]).forEach(function(f){try{f(m.data,m.event);}catch(e){}});}});"
            + "window." + NAME + "={version:" + JSONObject.quote(VERSION) + ",call:call,"
            + "on:function(ev,fn){(listeners[ev]=listeners[ev]||[]).push(fn);return function(){listeners[ev]=(listeners[ev]||[]).filter(function(g){return g!==fn;});};}};"
            + "window.dispatchEvent(new CustomEvent(" + JSONObject.quote(READY_EVENT) + ",{detail:{version:" + JSONObject.quote(VERSION) + "}}));"
            + "})();";
    }
}
