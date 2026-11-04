package ai.amberx.droid;

import android.content.Context;
import android.content.SharedPreferences;

/**
 * The Quiet switch (Nov 1 2026, Brett: AmberX kept talking and dinging on a loop). When on, AmberX makes no sound at
 * all: `speak` says nothing, the veto alarm doesn't ring (and stops if it is ringing), and its notifications post
 * silently. The web side sets it (Settings → Sound and microphone → Quiet, `src/sound.tsx`); it is kept here so the
 * watch service obeys it with the app closed too.
 */
final class Quiet {
    private Quiet() {}

    private static SharedPreferences prefs(Context c) { return c.getApplicationContext().getSharedPreferences("amberx.sound", Context.MODE_PRIVATE); }

    static boolean on(Context c) { return c != null && prefs(c).getBoolean("quiet", false); }

    static void set(Context c, boolean quiet) {
        prefs(c).edit().putBoolean("quiet", quiet).apply();
        if (quiet) VetoAlarm.stop(c, null, null);
    }
}
