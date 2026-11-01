package ai.amberx.droid;

import android.content.Intent;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

/**
 * AmberX's one screen: the web app (dist/, bundled) in Capacitor's WebView, plus the AmberxNative plugin. It tells the
 * watch service when it is on screen (the web side listens itself then) and hands notification taps and wake-phrase hits
 * to the web side.
 */
public class MainActivity extends BridgeActivity {
    static final String EXTRA_OPEN = "ai.amberx.droid.OPEN";
    static final String EXTRA_WAKE = "ai.amberx.droid.WAKE";
    /** A held command's notification was tapped: the web side opens its terminal tab. */
    static final String EXTRA_VETO = "ai.amberx.droid.VETO";
    static final String EXTRA_WAKE_TEXT = "ai.amberx.droid.WAKE_TEXT";
    static final String EXTRA_WAKE_ID = "ai.amberx.droid.WAKE_ID";
    static final String EXTRA_WAKE_AT = "ai.amberx.droid.WAKE_AT";

    @Override
    public void onCreate(Bundle state) {
        registerPlugin(AmberxNativePlugin.class);
        registerPlugin(AudioExtractPlugin.class); // Audio Extract (apps/console-web/plugins/audio-extract)
        registerPlugin(OutputRecorderPlugin.class); // Audio Output Recorder (apps/console-web/plugins/output-recorder)
        super.onCreate(state);
        // No FLAG_SECURE on normal screens (Oct 31 2026): Android's recorder, screenshots and Audio Extract work. The
        // opt-in "Hide sensitive screens from recordings" hides only password / key / vault screens (SecureScreen).
        SecureScreen.apply(this, SecureScreen.sensitive);
        // The launch intent is handed over once (Nov 1 2026): a re-created activity (rotation, theme, process restore)
        // and an open from Recents reuse the old intent, and used to replay its wake sentence ("Note saved" on every open).
        boolean fromHistory = (getIntent().getFlags() & Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) != 0;
        if (state == null && !fromHistory) getWindow().getDecorView().post(() -> deliverOnce(getIntent()));
        else setIntent(spent(getIntent()));
    }

    /** Hands the intent's events to the page, then strips them so nothing can hand them over again. */
    private void deliverOnce(Intent intent) {
        AmberxNativePlugin.deliver(intent);
        setIntent(spent(intent));
    }

    /** The intent without its one-time events. */
    static Intent spent(Intent intent) {
        if (intent == null) return null;
        Intent i = new Intent(intent);
        for (String k : new String[] { EXTRA_OPEN, EXTRA_VETO, EXTRA_WAKE, EXTRA_WAKE_TEXT, EXTRA_WAKE_ID, EXTRA_WAKE_AT }) i.removeExtra(k);
        return i;
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        deliverOnce(intent);
    }

    @Override
    public void onResume() {
        super.onResume();
        WatchService.inApp = true;
        SecureScreen.apply(this, SecureScreen.sensitive);
    }

    @Override
    public void onPause() {
        WatchService.inApp = false;
        super.onPause();
    }
}
