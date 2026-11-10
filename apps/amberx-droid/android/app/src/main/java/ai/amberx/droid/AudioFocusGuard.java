package ai.amberx.droid;

import android.content.Context;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;

/**
 * Proper Android audio focus for a listener that is talking with the person (Nov 6 2026, Brett: "it's crashing with
 * other apps"). A microphone session asks for transient focus (other apps' audio ducks while AmberX listens or
 * speaks); when a call or another app takes focus, {@link Events#lost} fires so the session lets go of the microphone
 * at once instead of fighting for it, and {@link Events#regained} fires when the focus comes back so it can resume.
 * Never throws: a phone that refuses focus still lets the session run (it just can't be warned).
 *
 * Used by {@link TalkService} for the whole talk session and by {@link WatchService} around a Google one-shot
 * utterance. The idle wake listener never holds focus (it would duck every other app's audio forever).
 */
final class AudioFocusGuard {
    interface Events {
        /** another app or a call took audio focus; `transient` = it should come back */
        void lost(boolean transientLoss);
        void regained();
    }

    private final AudioManager am;
    private final Events events;
    private final Handler main = new Handler(Looper.getMainLooper());
    private AudioFocusRequest request;
    private AudioManager.OnAudioFocusChangeListener listener;
    private volatile boolean held;
    private volatile boolean lost;

    AudioFocusGuard(Context c, Events events) {
        this.am = (AudioManager) c.getApplicationContext().getSystemService(Context.AUDIO_SERVICE);
        this.events = events;
    }

    /** True while AmberX holds the focus (false before `request`, after `abandon` and while another app has it). */
    boolean held() { return held && !lost; }

    /** True after a loss until the focus comes back. */
    boolean lost() { return lost; }

    /** Asks for transient focus (others duck). Returns true when granted now. */
    boolean request() {
        if (am == null) return false;
        if (listener == null) {
            listener = change -> main.post(() -> onChange(change));
        }
        try {
            int r;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                if (request == null) {
                    request = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
                        .setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ASSISTANT).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
                        .setOnAudioFocusChangeListener(listener, main)
                        .setWillPauseWhenDucked(false)
                        .build();
                }
                r = am.requestAudioFocus(request);
            } else {
                r = am.requestAudioFocus(listener, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK);
            }
            held = r == AudioManager.AUDIOFOCUS_REQUEST_GRANTED;
            lost = false;
            return held;
        } catch (RuntimeException e) {
            held = false;
            return false;
        }
    }

    /** Gives the focus back (other apps' audio comes back up). Safe to call twice. */
    void abandon() {
        if (am == null || !held && !lost) { held = false; lost = false; return; }
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) { if (request != null) am.abandonAudioFocusRequest(request); }
            else if (listener != null) am.abandonAudioFocus(listener);
        } catch (RuntimeException ignored) { /* already gone */ }
        held = false;
        lost = false;
    }

    private void onChange(int change) {
        switch (change) {
            case AudioManager.AUDIOFOCUS_LOSS:
                held = false; lost = true;
                events.lost(false);
                break;
            case AudioManager.AUDIOFOCUS_LOSS_TRANSIENT:
                lost = true;
                events.lost(true);
                break;
            case AudioManager.AUDIOFOCUS_GAIN:
                if (lost) { lost = false; held = true; events.regained(); }
                break;
            default:
                // AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK: another app's notification sound; the microphone stays ours
                break;
        }
    }
}
