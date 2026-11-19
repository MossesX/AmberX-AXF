package ai.amberx.droid;

import android.content.ComponentName;
import android.content.Context;
import android.os.Build;
import android.service.quicksettings.Tile;
import android.service.quicksettings.TileService;

/**
 * The quick-settings tile "AmberX mic" (Nov 1 2026): lit while AmberX may listen, dark while Mic off is on. One tap
 * flips {@link MicGuard}: off releases every microphone AmberX holds at once (the green dot goes off), on lets
 * hands-free listen again.
 */
public class MicTile extends TileService {

    /** Ask Android to redraw the tile (after Mic off changed anywhere). */
    static void refresh(Context c) {
        try { TileService.requestListeningState(c, new ComponentName(c, MicTile.class)); }
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
        boolean off = MicGuard.off(this);
        t.setState(off ? Tile.STATE_INACTIVE : Tile.STATE_ACTIVE);
        t.setLabel("AmberX mic");
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) t.setSubtitle(off ? "Mic off" : "Listening");
        t.setContentDescription(off ? "AmberX mic: Mic off. Tap to let AmberX listen again." : "AmberX mic: listening. Tap to turn the mic off.");
        t.updateTile();
    }

    @Override
    public void onClick() {
        super.onClick();
        MicGuard.set(this, !MicGuard.off(this));
        draw();
    }
}
