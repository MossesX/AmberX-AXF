package ai.amberx.consoleapp;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.net.Uri;
import android.os.Bundle;
import org.json.JSONObject;

/**
 * Phone Connect's way into the floating overlay ({@link PhoneConnectRules}, {@code console-overlay@1}). Not a data
 * provider: only {@link #call} answers, synchronously, so Phone Connect knows at once whether the page opened here or
 * it has to open it itself.
 *
 * - {@code call("open", url, {where})}: the page loads in the one console WebView and the toolbar expands over
 *   whatever is on screen ({@link DeviceLink#open}, the same path as axHub's {@code amberx.open_url}); a url with
 *   {@code ?axf-overlay=expand|collapse} runs that verb instead. Answers {@code {ok: true, json: <the open answer>}}.
 * - {@code call("state", null, null)}: {@code {ok: true, json: {overlay, canDraw, on}}}.
 * - Refusals: {@code {ok: false, code, message}} with {@code denied} (not Phone Connect), {@code validation} (no such
 *   method, a url outside Brett's sites), {@code no_overlay} (off or not allowed) or {@code browser} (asked for the
 *   browser).
 *
 * Only Phone Connect's package and this app may call; Android vouches for the calling package.
 */
public class PhoneConnectProvider extends ContentProvider {
    @Override public boolean onCreate() { return true; }

    @Override
    public Bundle call(String method, String arg, Bundle extras) {
        String refused = PhoneConnectRules.refuse(getCallingPackage(), method);
        if (refused != null) return error(refused, PhoneConnectRules.message(refused));
        android.content.Context c = getContext().getApplicationContext();
        if (OverlayService.running == null) OverlayService.loadConfig(c); // a process woken by this call
        boolean canDraw = Perms.has(c, Perms.OVERLAY);
        try {
            if (PhoneConnectRules.STATE.equals(method)) {
                return ok(new JSONObject().put("overlay", new JSONObject(OverlayService.stateJson()))
                    .put("canDraw", canDraw).put("on", OverlayService.config.on).put("contract", PhoneConnectRules.VERSION));
            }
            String where = extras == null ? "" : extras.getString(PhoneConnectRules.EXTRA_WHERE, "");
            String handOff = PhoneConnectRules.handOff(where, OverlayService.config.on, canDraw);
            if (handOff != null) return error(handOff, PhoneConnectRules.message(handOff));
            String url;
            try { url = ShellRules.allowed(arg); }
            catch (IllegalArgumentException e) { return error(PhoneConnectRules.VALIDATION, e.getMessage()); }
            JSONObject out = DeviceLink.open(c, new JSONObject().put("url", url).put("where", "overlay"));
            return ok(out.put("via", "phone-connect"));
        } catch (Exception e) {
            return error(PhoneConnectRules.UNAVAILABLE, String.valueOf(e.getMessage()));
        }
    }

    private static Bundle ok(JSONObject json) {
        Bundle b = new Bundle();
        b.putBoolean(PhoneConnectRules.K_OK, true);
        b.putString(PhoneConnectRules.K_JSON, json.toString());
        return b;
    }

    private static Bundle error(String code, String message) {
        Bundle b = new Bundle();
        b.putBoolean(PhoneConnectRules.K_OK, false);
        b.putString(PhoneConnectRules.K_CODE, code);
        b.putString(PhoneConnectRules.K_MESSAGE, message);
        return b;
    }

    // Not a data provider: no rows, no writes.
    @Override public Cursor query(Uri u, String[] p, String s, String[] a, String o) { return null; }
    @Override public String getType(Uri u) { return null; }
    @Override public Uri insert(Uri u, ContentValues v) { return null; }
    @Override public int delete(Uri u, String s, String[] a) { return 0; }
    @Override public int update(Uri u, ContentValues v, String s, String[] a) { return 0; }
}
