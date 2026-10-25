package ai.amberx.droid;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** After a reboot or an update, restarts the approvals watch if it was on (the microphone part waits for the app to open). */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        String a = intent.getAction();
        if (!Intent.ACTION_BOOT_COMPLETED.equals(a) && !Intent.ACTION_MY_PACKAGE_REPLACED.equals(a)) return;
        if (!WatchService.prefs(context).getBoolean("on", false)) return;
        try { WatchService.start(context, WatchService.config(context)); } catch (Exception ignored) { /* Android refused: next app open */ }
    }
}
