package ai.amberx.droid;

import android.Manifest;
import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.media.projection.MediaProjectionManager;
import android.os.Build;
import android.os.Bundle;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;

/**
 * The one consent flow for Audio Output Recorder, used by the AmberX switch and the quick-settings tile alike
 * (MediaProjection consent needs an activity, and a tile has none). No window of its own (translucent): it asks
 * Android, in order, for
 *   1. the audio permission (RECORD_AUDIO) once — Android files playback capture under it; the mic is never opened,
 *   2. notifications (Android 13+) once — the recording notification and its Stop button,
 *   3. capture consent — every start, Android's own "Start recording or casting?" prompt,
 * then starts {@link OutputRecordService} and closes. Anything refused ends the flow with an `error` event and a reason.
 */
public class OutputRecordStartActivity extends Activity {
    private static final int REQ_PERMS = 1;
    private static final int REQ_CONSENT = 2;

    static Intent intent(Context c) {
        return new Intent(c, OutputRecordStartActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_NO_ANIMATION);
    }

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        if (state != null) return; // re-created mid-flow: the pending result still arrives
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) { refuse("Recording what the phone plays needs Android 10 or newer."); return; }
        if (OutputRecordService.running) { finish(); return; }
        boolean audio = granted(Manifest.permission.RECORD_AUDIO);
        boolean notes = Build.VERSION.SDK_INT < 33 || granted("android.permission.POST_NOTIFICATIONS");
        if (audio && notes) consent();
        else if (!audio && Build.VERSION.SDK_INT >= 33) requestPermissions(new String[] { Manifest.permission.RECORD_AUDIO, "android.permission.POST_NOTIFICATIONS" }, REQ_PERMS);
        else if (!audio) requestPermissions(new String[] { Manifest.permission.RECORD_AUDIO }, REQ_PERMS);
        else requestPermissions(new String[] { "android.permission.POST_NOTIFICATIONS" }, REQ_PERMS);
    }

    private boolean granted(String p) { return ContextCompat.checkSelfPermission(this, p) == PackageManager.PERMISSION_GRANTED; }

    @Override
    public void onRequestPermissionsResult(int code, String[] perms, int[] results) {
        super.onRequestPermissionsResult(code, perms, results);
        // Without the audio permission Android hands over no playback at all: stop here (never fall back to anything else).
        if (!granted(Manifest.permission.RECORD_AUDIO)) { refuse("Android’s audio permission is needed to capture what apps play (the microphone is never used)."); return; }
        consent(); // notifications refused: it still records, the notification just can't show
    }

    private void consent() {
        MediaProjectionManager mpm = (MediaProjectionManager) getSystemService(Context.MEDIA_PROJECTION_SERVICE);
        try { startActivityForResult(mpm.createScreenCaptureIntent(), REQ_CONSENT); }
        catch (RuntimeException e) { refuse("Android’s capture prompt couldn’t open: " + e.getMessage()); }
    }

    @Override
    protected void onActivityResult(int code, int result, Intent data) {
        super.onActivityResult(code, result, data);
        if (code != REQ_CONSENT) return;
        if (result != RESULT_OK || data == null) { refuse("Capture wasn’t allowed, so nothing is being recorded.", "cancelled"); return; }
        Intent s = new Intent(this, OutputRecordService.class).setAction(OutputRecordService.ACTION_START)
            .putExtra(OutputRecordService.EXTRA_CODE, result)
            .putExtra(OutputRecordService.EXTRA_DATA, data);
        try { ContextCompat.startForegroundService(this, s); }
        catch (RuntimeException e) { refuse("The recorder couldn’t start: " + e.getMessage()); return; }
        finish();
    }

    private void refuse(String message) { refuse(message, "error"); }

    private void refuse(String message, String state) {
        OutputRecordQueue.clearSession(this); // a session from axHub that never started doesn't name a later recording
        AxppLink.consentRefused(this, message);
        JSObject e = new JSObject();
        e.put("message", message);
        OutputRecordService.emit(state, e);
        OutputRecordTile.refresh(this);
        finish();
    }

    @Override
    public void finish() {
        super.finish();
        overridePendingTransition(0, 0);
    }
}
