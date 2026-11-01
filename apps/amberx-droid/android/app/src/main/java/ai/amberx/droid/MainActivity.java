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

    @Override
    public void onCreate(Bundle state) {
        registerPlugin(AmberxNativePlugin.class);
        registerPlugin(AudioExtractPlugin.class); // Audio Extract (apps/console-web/plugins/audio-extract)
        registerPlugin(OutputRecorderPlugin.class); // Audio Output Recorder (apps/console-web/plugins/output-recorder)
        super.onCreate(state);
        // No FLAG_SECURE on normal screens (Oct 31 2026): Android's recorder, screenshots and Audio Extract work. The
        // opt-in "Hide sensitive screens from recordings" hides only password / key / vault screens (SecureScreen).
        SecureScreen.apply(this, SecureScreen.sensitive);
        getWindow().getDecorView().post(() -> AmberxNativePlugin.deliver(getIntent()));
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        AmberxNativePlugin.deliver(intent);
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
