package ai.amberx.droid;

import android.content.Intent;
import android.os.Bundle;
import android.view.WindowManager;
import com.getcapacitor.BridgeActivity;

/**
 * AmberX's one screen: the web app (dist/, bundled) in Capacitor's WebView, plus the AmberxNative plugin. It tells the
 * watch service when it is on screen (the web side listens itself then) and hands notification taps and wake-phrase hits
 * to the web side.
 */
public class MainActivity extends BridgeActivity {
    static final String EXTRA_OPEN = "ai.amberx.droid.OPEN";
    static final String EXTRA_WAKE = "ai.amberx.droid.WAKE";
    static final String EXTRA_WAKE_TEXT = "ai.amberx.droid.WAKE_TEXT";

    @Override
    public void onCreate(Bundle state) {
        registerPlugin(AmberxNativePlugin.class);
        super.onCreate(state);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE); // approvals and hub pages are never captured
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
    }

    @Override
    public void onPause() {
        WatchService.inApp = false;
        super.onPause();
    }
}
