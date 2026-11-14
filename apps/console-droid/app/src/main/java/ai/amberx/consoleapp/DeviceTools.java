package ai.amberx.consoleapp;

import android.app.Activity;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import java.util.LinkedHashSet;
import java.util.Set;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * AmberX's device-service tools, moved to the console app (part 3, s3): {@code browser.open} ({@code amberx.open_url}),
 * {@code console.wake} ({@code amberx.console_wake}) and {@code notify.show|cancel|status} ({@code amberx.notify}).
 * Each registers on the {@link DeviceBridge}, so the page ({@code window.axfNative}) and axHub ({@link HubLink}) run the
 * same code. The recorder ({@code amberx.recorder_*}) stays in AmberX until its capture service moves: the console app
 * doesn't advertise {@code recorder@1}, so the hub keeps sending recorder calls to AmberX.
 *
 * Wiring: {@code DeviceTools.register(bridge, this)} right after {@code DeviceBridge.attach}.
 */
final class DeviceTools {
    private DeviceTools() {}

    /** Notification ids this app has shown and not cancelled (for {@code notify.status}). */
    private static final Set<String> shown = new LinkedHashSet<>();

    static void register(DeviceBridge b, Activity a) {
        Context c = a.getApplicationContext();
        b.register(BridgeContract.OPEN, args -> open(c, args));
        b.register(BridgeContract.WAKE, args -> wake(c, args));
        b.register(BridgeContract.NOTIFY_SHOW, args -> notifyShow(c, args));
        b.register(BridgeContract.NOTIFY_CANCEL, args -> notifyCancel(c, args));
        b.register(BridgeContract.NOTIFY_STATUS, args -> notifyStatus(c));
    }

    /** {@code browser.open}: one of Brett's own pages, in the console app (default) or in the phone's browser. */
    static JSONObject open(Context c, JSONObject args) throws Exception {
        String url = ShellRules.allowed(args.optString("url", ""));
        if (url == null) throw new IllegalArgumentException("Only https pages on Brett's own sites open here.");
        String where = DeviceRules.where(args.optString("where", ""));
        boolean opened = DeviceRules.BROWSER.equals(where) ? startBrowser(c, url) : startApp(c, url, false);
        boolean notified = false;
        // Android drops most activity starts from the background: the notification is the one-tap way in
        if (!opened) notified = Notifier.show(c, DeviceRules.OPEN_NOTE, "Open in the console", url, url, Notifier.ALERTS);
        return new JSONObject().put("url", url).put("opened", opened).put("where", where).put("notified", notified);
    }

    /** {@code console.wake}: the console to the front, at a console-control address when given, else home. */
    static JSONObject wake(Context c, JSONObject args) throws Exception {
        String url = DeviceRules.wakeUrl(args.optString("target", ""), args.optString("url", ""));
        boolean opened = startApp(c, url, args.optBoolean("screenOn", true));
        boolean notified = false;
        if (!opened) notified = Notifier.show(c, DeviceRules.WAKE_NOTE, "The console needs you", "", url, Notifier.APPROVALS);
        DeviceBridge b = DeviceBridge.current;
        if (b != null) b.emit(BridgeContract.EV_WAKE, new JSONObject().put("url", url).put("opened", opened));
        return new JSONObject().put("url", url).put("opened", opened).put("where", DeviceRules.APP).put("notified", notified);
    }

    static JSONObject notifyShow(Context c, JSONObject args) throws Exception {
        String title = args.optString("title", "").trim();
        if (title.isEmpty()) throw new IllegalArgumentException("title is required.");
        String id = DeviceRules.noteId(args.optString("id", ""), title);
        String url = args.optString("url", "");
        boolean ok = Notifier.show(c, id, title, args.optString("text", ""), url.isEmpty() ? null : url,
            "approvals".equals(args.optString("channel")) ? Notifier.APPROVALS : Notifier.ALERTS);
        if (!ok) throw new SecurityException("Notifications are off for the console app.");
        synchronized (shown) { shown.add(id); }
        return new JSONObject().put("id", id).put("shown", true);
    }

    static JSONObject notifyCancel(Context c, JSONObject args) throws Exception {
        String id = args.optString("id", "").trim();
        if (id.isEmpty()) throw new IllegalArgumentException("id is required.");
        Notifier.cancel(c, id);
        boolean was;
        synchronized (shown) { was = shown.remove(id); }
        return new JSONObject().put("id", id).put("cancelled", true).put("wasShown", was);
    }

    static JSONObject notifyStatus(Context c) throws Exception {
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        boolean enabled = nm == null || nm.areNotificationsEnabled();
        JSONArray ids;
        synchronized (shown) { ids = new JSONArray(shown); }
        return new JSONObject().put("enabled", enabled && DeviceBridge.granted(c, BridgeContract.POST_NOTIFICATIONS)).put("shown", ids);
    }

    /* ---------------------------------------------------------------- starts */

    /** The console app on {@code url}; false when Android refused the start (background start limits). */
    static boolean startApp(Context c, String url, boolean screenOn) {
        try {
            c.startActivity(new Intent(c, ConsoleActivity.class).setAction(Intent.ACTION_VIEW).setData(Uri.parse(url))
                .putExtra(Wake.EXTRA, screenOn)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT));
            return DeviceBridge.current != null || Build.VERSION.SDK_INT < 29 || DeviceBridge.granted(c, BridgeContract.DRAW_OVER);
        } catch (Exception e) {
            return false;
        }
    }

    static boolean startBrowser(Context c, String url) {
        try {
            c.startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)).addCategory(Intent.CATEGORY_BROWSABLE)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            return DeviceBridge.current != null || Build.VERSION.SDK_INT < 29 || DeviceBridge.granted(c, BridgeContract.DRAW_OVER);
        } catch (Exception e) {
            return false;
        }
    }
}
