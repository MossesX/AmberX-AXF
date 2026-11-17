package ai.amberx.consoleapp;

import android.Manifest;
import android.app.AlertDialog;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.widget.Toast;
import java.util.ArrayList;
import java.util.List;

/**
 * Android's permissions, the native part the web console can't do itself: the microphone (talk mode, dictation),
 * notifications, and "Display over other apps" (the floating toolbar). The console asks through
 * {@code axfNative.permissions()} / {@code axfNative.requestPermission(name)}; every answer is reported back as a
 * {@code permissions} event.
 */
final class Perms {
    private Perms() {}

    static final String MIC = "mic", NOTIFY = "notifications", OVERLAY = "overlay";
    static final String[] ALL = { MIC, NOTIFY, OVERLAY };

    private static final List<Runnable> waiting = new ArrayList<>();
    /** The overlay flow sent Brett to Android's page; {@link #resumed} checks the answer ({@link OverlayPermission}). */
    private static boolean sentToSettings, grantedBefore;

    static boolean has(Context c, String name) {
        switch (name) {
            case MIC: return c.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED;
            case NOTIFY: return Build.VERSION.SDK_INT < 33 || c.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED;
            case OVERLAY: return Settings.canDrawOverlays(c);
            default: return false;
        }
    }

    /** {"mic":true,"notifications":false,"overlay":true} */
    static String stateJson(Context c) {
        StringBuilder b = new StringBuilder("{");
        for (int i = 0; i < ALL.length; i++) b.append(i == 0 ? "" : ",").append('"').append(ALL[i]).append("\":").append(has(c, ALL[i]));
        return b.append('}').toString();
    }

    /** Asks Android for {@code name}; {@code then} runs when the answer is in (also when it was already given). */
    static void request(String name, Runnable then) {
        ConsoleActivity a = WebHost.activity;
        if (a == null) {
            // No screen to ask from (the overlay is up, the app isn't): open the app, it asks on resume.
            Context c = WebHost.current() == null ? null : WebHost.current().getContext();
            if (c != null) c.startActivity(new Intent(c, ConsoleActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            if (then != null) waiting.add(then);
            return;
        }
        if (has(a, name)) { if (then != null) then.run(); return; }
        if (then != null) waiting.add(then);
        switch (name) {
            case MIC: a.requestPermissions(new String[] { Manifest.permission.RECORD_AUDIO }, ConsoleActivity.PERMS); break;
            case NOTIFY:
                if (Build.VERSION.SDK_INT >= 33) a.requestPermissions(new String[] { Manifest.permission.POST_NOTIFICATIONS }, ConsoleActivity.PERMS);
                else answered(a);
                break;
            case OVERLAY: explainOverlay(a); break;
            default: answered(a);
        }
    }

    /**
     * "Display over other apps": one line on why before Android's page (a bare list of apps), then the page itself.
     * "Not now" answers the ask as it stands; the start offer ({@link #offerOnStart}) is shown only once.
     */
    static void explainOverlay(ConsoleActivity a) {
        a.getSharedPreferences("perms", Context.MODE_PRIVATE).edit().putBoolean("overlayOffered", true).apply();
        if (OverlayPermission.onAsk(has(a, OVERLAY), false).equals(OverlayPermission.NONE)) { answered(a); return; }
        new AlertDialog.Builder(a)
            .setTitle(OverlayPermission.TITLE)
            .setMessage(OverlayPermission.BODY)
            .setPositiveButton(OverlayPermission.ALLOW, (d, w) -> openOverlaySettings(a))
            .setNegativeButton(OverlayPermission.NOT_NOW, (d, w) -> answered(a))
            .setOnCancelListener(d -> answered(a))
            .show();
    }

    private static void openOverlaySettings(ConsoleActivity a) {
        grantedBefore = has(a, OVERLAY);
        sentToSettings = true;
        a.startActivity(new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:" + a.getPackageName())));
    }

    /** The app's first start with the toolbar on and the permission missing: offer it once. */
    static void offerOnStart(ConsoleActivity a) {
        boolean offered = a.getSharedPreferences("perms", Context.MODE_PRIVATE).getBoolean("overlayOffered", false);
        if (OverlayPermission.onStart(OverlayService.config.on, has(a, OVERLAY), offered).equals(OverlayPermission.EXPLAIN)) explainOverlay(a);
    }

    /** A prompt was answered: run who waited, tell the page. */
    static void answered(Context c) { answered(c, OverlayPermission.UNCHANGED); }

    private static void answered(Context c, String overlayOutcome) {
        List<Runnable> run = new ArrayList<>(waiting);
        waiting.clear();
        for (Runnable r : run) r.run();
        NativeBridge.emit("permissions", OverlayPermission.withOutcome(stateJson(c), overlayOutcome));
    }

    /** Back from Android's settings screen ("Display over other apps"): check it, say so, start the toolbar when granted. */
    static void resumed(ConsoleActivity a) {
        String outcome = OverlayPermission.afterReturn(sentToSettings, grantedBefore, has(a, OVERLAY));
        boolean back = sentToSettings;
        sentToSettings = false;
        if (back || !waiting.isEmpty()) answered(a, outcome);
        String line = OverlayPermission.message(outcome);
        if (line != null) Toast.makeText(a, line, Toast.LENGTH_LONG).show();
        OverlayService.startIfWanted(a);
    }
}
