package ai.amberx.droid;

import android.app.Activity;
import android.app.KeyguardManager;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;

/**
 * open-url-route@1 `full-screen-intent`: the trampoline a full-screen notification starts. It shows over the lock
 * screen, asks Android to unlock, fires the browser's ACTION_VIEW on the page (Chrome, or the default browser) and
 * finishes at once; Brett never sees it. A full-screen intent is an allowed start when Android grants
 * USE_FULL_SCREEN_INTENT, so this path still opens the page while AmberX sits in the background.
 *
 * {@link #landedAt} says when it last ran, so {@link AxppLink} can tell a start that happened from one Android
 * turned into a plain heads-up banner (unlocked phone in use) and fall through to the next route.
 */
public class OpenPageActivity extends Activity {
    static final String EXTRA_URL = "ai.amberx.droid.OPEN_PAGE_URL";
    static final String EXTRA_BROWSER = "ai.amberx.droid.OPEN_PAGE_BROWSER";
    static final String EXTRA_NOTE = "ai.amberx.droid.OPEN_PAGE_NOTE";

    /** When the trampoline last started a browser (ms since epoch); 0 = never. */
    static volatile long landedAt = 0L;
    /** The URL it last opened. */
    static volatile String landedUrl = "";

    static Intent intent(Context c, String url, String browser, int note) {
        return new Intent(c, OpenPageActivity.class)
            .putExtra(EXTRA_URL, url).putExtra(EXTRA_BROWSER, browser).putExtra(EXTRA_NOTE, note)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_NO_ANIMATION | Intent.FLAG_ACTIVITY_EXCLUDE_FROM_RECENTS);
    }

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
            KeyguardManager km = (KeyguardManager) getSystemService(Context.KEYGUARD_SERVICE);
            if (km != null) km.requestDismissKeyguard(this, null);
        }
        Intent in = getIntent();
        String url;
        try {
            url = OpenUrlRules.allowed(in == null ? "" : in.getStringExtra(EXTRA_URL));
        } catch (IllegalArgumentException e) {
            finish();
            return;
        }
        String browser = in.getStringExtra(EXTRA_BROWSER);
        try {
            startActivity(AxppLink.browserIntent(this, url, browser == null ? "chrome" : browser));
            landedUrl = url;
            landedAt = System.currentTimeMillis();
            int note = in.getIntExtra(EXTRA_NOTE, 0);
            if (note != 0) ((NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE)).cancel(note);
        } catch (RuntimeException ignored) {
            // no browser resolved the page: landedAt stays put, so the caller falls through to the notification
        }
        finish();
        overridePendingTransition(0, 0);
    }
}
