package ai.amberx.consoleapp;

import android.app.Activity;
import android.content.Context;

/**
 * Console wake: the console (or axHub, through the page) needs Brett's eyes, so the app comes to the front and, when
 * asked, turns the screen on over the lock screen. With "Display over other apps" granted Android lets the app start
 * from the background; without it the console posts a notification instead (the page's fallback).
 */
final class Wake {
    private Wake() {}

    static final String EXTRA = "wake";

    /** The console in front: the expanded overlay when it runs, else the app. */
    static void front(Context c, boolean screenOn) {
        if (OverlayService.running != null && !screenOn) { OverlayService.verb(c, "expand"); return; }
        NativeBridge.startApp(c, screenOn);
    }

    /** Called by the activity for an intent with {@link #EXTRA}: show over the lock screen and turn the screen on. */
    static void apply(Activity a, boolean on) {
        a.setShowWhenLocked(on);
        a.setTurnScreenOn(on);
    }
}
