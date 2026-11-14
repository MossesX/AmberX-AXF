package ai.amberx.consoleapp;

import android.app.Activity;
import android.content.Context;
import android.content.SharedPreferences;
import org.json.JSONObject;

/**
 * Mic and permissions on the bridge (console app part 3, s4): {@code mic.status}, {@code mic.set} and
 * {@code permissions.request}, on part 1's {@code Perms} (Android's prompts and the overlay settings screen).
 * Rules in {@link MicRules}. Every change is also an event ({@code mic}, {@code permission}), so the console, the
 * floating toolbar and the hub's device state follow it without polling.
 *
 * Wiring: {@code MicTools.register(bridge, this)} after {@code DeviceBridge.attach}; in part 1's
 * {@code WebHost.onPermissionRequest}, deny audio when {@code !MicTools.webCaptureAllowed(context, origin)}.
 */
final class MicTools {
    private MicTools() {}

    static void register(DeviceBridge b, Activity a) {
        Context c = a.getApplicationContext();
        b.register(BridgeContract.MIC_STATUS, args -> status(c));
        b.register(BridgeContract.MIC_SET, args -> set(c, MicRules.onOf(args)));
        b.register(BridgeContract.PERM_REQUEST, args -> request(c, MicRules.permissionOf(args)));
    }

    private static SharedPreferences prefs(Context c) { return c.getSharedPreferences(HubLink.PREFS, Context.MODE_PRIVATE); }

    static boolean switchOn(Context c) { return prefs(c).getBoolean(MicRules.PREF_MIC, MicRules.DEFAULT_ON); }

    static boolean granted(Context c) { return DeviceBridge.granted(c, BridgeContract.RECORD_AUDIO); }

    static JSONObject status(Context c) { return MicRules.status(switchOn(c), granted(c)); }

    /** The console's mic switch. Turning it on when Android hasn't allowed the mic answers {@code permission} first. */
    static JSONObject set(Context c, boolean on) throws Exception {
        prefs(c).edit().putBoolean(MicRules.PREF_MIC, on).apply();
        JSONObject s = status(c);
        DeviceBridge b = DeviceBridge.current;
        if (b != null) b.emit(BridgeContract.EV_MIC, s);
        return s;
    }

    /** Asks Android now; the answer to the prompt arrives as the {@code permission} event. */
    static JSONObject request(Context c, String key) throws Exception {
        if (Perms.has(c, key)) return MicRules.requested(key, true, false);
        Perms.request(key, () -> {
            DeviceBridge b = DeviceBridge.current;
            if (b == null) return;
            try {
                JSONObject ev = MicRules.requested(key, Perms.has(c, key), true).put("all", DeviceBridge.permissions(c));
                b.emit(BridgeContract.EV_PERMISSION, ev);
                if ("mic".equals(key)) b.emit(BridgeContract.EV_MIC, status(c));
            } catch (Exception ignored) { /* the page is gone */ }
        });
        return MicRules.requested(key, false, true);
    }

    /** For {@code WebHost.onPermissionRequest}: may this page capture audio at all (Android's own prompt comes after). */
    static boolean webCaptureAllowed(Context c, String origin) {
        return MicRules.webCaptureAllowed(ShellRules.bridgeAllowed(origin), switchOn(c));
    }
}
