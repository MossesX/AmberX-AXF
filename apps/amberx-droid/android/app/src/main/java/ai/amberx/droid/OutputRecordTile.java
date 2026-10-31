package ai.amberx.droid;

import android.app.PendingIntent;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.service.quicksettings.Tile;
import android.service.quicksettings.TileService;

/**
 * The quick-settings tile "Record audio out": on while {@link OutputRecordService} records. Tapping it off stops the
 * recorder; tapping it on opens {@link OutputRecordStartActivity} (Android's capture prompt, every time), the same
 * flow as the switch in AmberX.
 */
public class OutputRecordTile extends TileService {

    /** Ask Android to redraw the tile (after a start, a stop or a refusal). */
    static void refresh(Context c) {
        try { TileService.requestListeningState(c, new ComponentName(c, OutputRecordTile.class)); }
        catch (RuntimeException ignored) { /* tile not added: nothing to redraw */ }
    }

    @Override
    public void onStartListening() {
        super.onStartListening();
        draw();
    }

    private void draw() {
        Tile t = getQsTile();
        if (t == null) return;
        boolean on = OutputRecordService.running;
        t.setState(on ? Tile.STATE_ACTIVE : Tile.STATE_INACTIVE);
        t.setLabel("Record audio out");
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) t.setSubtitle(on ? "Recording" : "Off");
        t.updateTile();
    }

    @Override
    public void onClick() {
        super.onClick();
        if (OutputRecordService.running) {
            startService(new Intent(this, OutputRecordService.class).setAction(OutputRecordService.ACTION_STOP));
            draw();
            return;
        }
        if (isLocked()) unlockAndRun(this::openStart); // Android's capture prompt needs an unlocked phone
        else openStart();
    }

    private void openStart() {
        Intent i = OutputRecordStartActivity.intent(this);
        if (Build.VERSION.SDK_INT >= 34) {
            startActivityAndCollapse(PendingIntent.getActivity(this, 0, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT));
        } else {
            startActivityAndCollapse(i);
        }
    }
}
