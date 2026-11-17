package ai.amberx.consoleapp;

import android.content.Context;
import android.content.pm.PackageInfo;

/** The shell's own version, for the user agent and {@code axfNative.info()} (the web side knows which shell it runs in). */
final class BuildConfigInfo {
    private BuildConfigInfo() {}

    static String version(Context c) {
        try {
            PackageInfo p = c.getPackageManager().getPackageInfo(c.getPackageName(), 0);
            return p.versionName + "+" + p.getLongVersionCode();
        } catch (Exception e) { return "0"; }
    }
}
