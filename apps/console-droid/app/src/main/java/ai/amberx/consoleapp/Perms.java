package ai.amberx.consoleapp;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
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
            case OVERLAY:
                a.startActivity(new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:" + a.getPackageName())));
                break;
            default: answered(a);
        }
    }

    /** A prompt was answered: run who waited, tell the page. */
    static void answered(Context c) {
        List<Runnable> run = new ArrayList<>(waiting);
        waiting.clear();
        for (Runnable r : run) r.run();
        NativeBridge.emit("permissions", stateJson(c));
    }

    /** Back from Android's settings screen ("Display over other apps"): same as an answer; the overlay may start now. */
    static void resumed(ConsoleActivity a) {
        if (!waiting.isEmpty()) answered(a);
        OverlayService.startIfWanted(a);
    }
}
