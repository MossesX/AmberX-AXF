package ai.amberx.droid;

import android.app.Activity;
import android.content.Context;
import android.content.SharedPreferences;
import android.view.WindowManager;

/**
 * When AmberX's window is hidden from screenshots and screen recordings (FLAG_SECURE), Oct 31 2026.
 *
 * Before, every AmberX screen and every hub page set FLAG_SECURE, so Android's screen recorder and screenshots said
 * "can't record due to security policy" and AmberX's own recorder (Audio Extract) captured black. Now the window is
 * capturable by default. Only when the person switches on "Hide sensitive screens from recordings" (Settings → Account
 * & security, off by default) is it hidden, and then only while a password, key or vault screen is showing (the web
 * side reports that) or a hub sign-in page is open.
 */
final class SecureScreen {
    private static final String PREFS = "amberx.secure";
    private static final String HIDE = "hideSensitive";
    /** a password / key / vault field is on screen right now (not kept across launches) */
    static volatile boolean sensitive;

    private SecureScreen() {}

    static boolean hideSensitive(Context c) {
        return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(HIDE, false);
    }

    static void setHideSensitive(Context c, boolean on) {
        SharedPreferences.Editor e = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit();
        e.putBoolean(HIDE, on).apply();
    }

    /** Set or clear FLAG_SECURE on this activity's window: on only when the setting is on and the screen is sensitive. */
    static void apply(Activity a, boolean sensitiveScreen) {
        if (a == null) return;
        boolean secure = sensitiveScreen && hideSensitive(a);
        a.runOnUiThread(() -> {
            if (secure) a.getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
            else a.getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SECURE);
        });
    }
}
