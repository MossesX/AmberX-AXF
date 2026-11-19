package ai.amberx.droid;

import android.annotation.SuppressLint;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.media.AudioAttributes;
import android.media.AudioFormat;
import android.media.AudioPlaybackCaptureConfiguration;
import android.media.AudioRecord;
import android.media.MediaCodec;
import android.media.MediaCodecInfo;
import android.media.MediaFormat;
import android.media.MediaMuxer;
import android.media.projection.MediaProjection;
import android.media.projection.MediaProjectionManager;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import com.getcapacitor.JSObject;
import java.io.File;
import java.nio.ByteBuffer;
import java.security.SecureRandom;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;
import org.json.JSONObject;

/**
 * Audio Output Recorder: everything the phone plays, recorded while the switch (or the quick-settings tile) is on, cut
 * into timestamped chunks (30 minutes by default) and handed to {@link OutputRecordUploader} for axHub.
 *
 * Source: AudioPlaybackCapture through MediaProjection (Android 10+), the same capture path as Audio Extract's screen
 * recorder ({@link ScreenRecordService}, PR #187) without the screen. The playback AudioRecord is built only with
 * {@code setAudioPlaybackCaptureConfig}, never with an audio source. Android files playback capture under the
 * RECORD_AUDIO permission, which is why that permission is asked for.
 *
 * Opt-in microphone (Nov 1 2026): only when "Record my mic too" is on or the approved axHub start said `mic: true`
 * ({@link OutputRecordQueue#micWanted}), a second AudioRecord on the mic (VOICE_RECOGNITION: not a privacy-sensitive
 * source, so it never silences the Claude app's own mic; echo canceller and noise suppressor added when the phone has
 * them) is read alongside, and the chunk is written as stereo on one timeline: **left = mic, right = playback**
 * ({@link TwoTrack}). When Android won't hand the mic over or silences it (another app holds it), the left side is
 * silence, the span goes in the chunk's `micBusy` metadata and a notification says so: it never fails the recording.
 * The mic stops at once from the notification (Stop mic) and is released whenever the recording stops. It is a plain
 * capture: no recognizer and no new listener (events still go to the one {@link #listener}).
 * What can't be captured: calls (voice-communication audio is never offered to capture) and apps that opt out
 * (DRM video, some music apps): those parts are silent.
 *
 * Foreground service (type mediaProjection) with a notification while it records (elapsed, chunks waiting, Stop).
 * Android asks for consent every start ({@link OutputRecordStartActivity}). If Android ends the capture (the status-bar
 * chip, a lock on some phones), the open chunk is closed and kept.
 *
 * Encoding: the 48 kHz stereo capture → AAC-LC (mono downmix by default, 32 kbps) → one MediaMuxer per chunk. The
 * encoder runs straight through; at a chunk boundary the muxer is closed and a new one opened (every AAC frame is a
 * sync frame, so any frame can start a file). A chunk that was silent all through is dropped when "skip silent" is on.
 *
 * Sessions from axHub (decision #108, {@link AxppLink}): a start through `amberx.recorder_start` sets a session first
 * ({@link OutputRecordQueue#setSession}); while it is set the notification says "Recording: <session>", each kept part
 * is named {@code "<session> - <YYYY-MM-DD HH-mm> - partN"} ({@link RecorderControl#partName}) and goes to axHub with the
 * session's group, and stopping (switch, tile, notification Stop, `recorder_stop`) ends the session. Still never the
 * microphone: a session changes names only.
 */
public class OutputRecordService extends Service {
    interface Listener { void on(JSObject e); }

    static final String ACTION_START = "ai.amberx.droid.outrec.START";
    static final String ACTION_STOP = "ai.amberx.droid.outrec.STOP";
    static final String ACTION_STOP_MIC = "ai.amberx.droid.outrec.STOP_MIC";
    static final String EXTRA_CODE = "code";
    static final String EXTRA_DATA = "data";
    static final String EXTRA_REASON = "reason";
    private static final String CHANNEL = "amberx-output-recorder";
    private static final int NOTIFICATION = 7311;
    private static final int NOTE_MIC_BUSY = 7312;
    /** frames per block the two-track pump hands the encoder (~43 ms) */
    private static final int BLOCK = 2048;
    private static final int RATE = 48_000;
    /** |sample| at or under this the whole chunk = silent (16-bit full scale is 32767). */
    private static final int SILENCE = 64;

    static volatile Listener listener;
    static volatile boolean running;
    static volatile long startedAtMs;
    /** the chunk being written (so a cleanup never removes it) */
    private static volatile File current;
    /** the session part being written, e.g. "Build - 2026-11-01 10-00 - part2" (null outside a session) */
    static volatile String currentName;
    /** the mic track is part of this recording (asked for, and not stopped from the notification) */
    static volatile boolean micOn;
    /** why the mic side is silent right now (TwoTrack.BUSY_*), null while it records */
    static volatile String micBusy;
    private static final SecureRandom RNG = new SecureRandom();

    private final Handler main = new Handler(Looper.getMainLooper());
    private MediaProjection projection;
    private AudioRecord capture;
    /** the opt-in mic (null when off, refused or stopped) */
    private AudioRecord mic;
    /** The mic AudioRecord's session id, registered with MicGuard while open. */
    private int micSession;
    private Thread micReader, playReader;
    private final TwoTrack.Ring micRing = new TwoTrack.Ring(TwoTrack.RING_FRAMES);
    private final TwoTrack.Ring playRing = new TwoTrack.Ring(TwoTrack.RING_FRAMES);
    /** the mic reader is delivering frames (it keeps the clock while it does) */
    private volatile boolean micLive;
    private volatile boolean micStop;
    private final TwoTrack.Busy busy = new TwoTrack.Busy();
    private MediaCodec encoder;
    private MediaFormat outFormat;
    private MediaMuxer muxer;
    private int track = -1;
    private String chunkId;
    private long chunkStartWall, chunkStartUs = -1, lastUs = -1, samples;
    private int peak;
    private long chunkUs;
    private int channels;
    private boolean skipSilent;
    private int kbps;
    private volatile boolean stopping;
    private volatile String endReason;
    private Thread pump;
    private final Runnable tick = this::tick;

    static boolean isCurrent(File f) { File c = current; return c != null && c.equals(f); }

    @Override public IBinder onBind(Intent i) { return null; }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String a = intent == null ? null : intent.getAction();
        if (ACTION_START.equals(a)) start(intent);
        else if (ACTION_STOP.equals(a)) stop(intent.getStringExtra(EXTRA_REASON));
        else if (ACTION_STOP_MIC.equals(a)) stopMic();
        else if (!running) stopSelf();
        return START_NOT_STICKY;
    }

    @Override
    public void onDestroy() {
        main.removeCallbacksAndMessages(null);
        if (running) { stopping = true; } // the pump closes the open chunk on its way out
        super.onDestroy();
    }

    /* ------------------------------------------------------------------ events + notification */

    static void emit(String state, JSObject extra) {
        JSObject e = extra == null ? new JSObject() : extra;
        e.put("state", state);
        Listener l = listener;
        if (l != null) l.on(e);
    }

    /** What the page and the tile show: running, since when, the chunk being written. */
    static JSObject status() {
        JSObject o = new JSObject();
        o.put("running", running);
        o.put("startedAt", running && startedAtMs > 0 ? iso(startedAtMs) : null);
        o.put("currentFile", running ? currentName : null);
        o.put("mic", running && micOn);
        o.put("micBusy", running && micOn && micBusy != null ? micBusy : null);
        return o;
    }

    static String iso(long ms) {
        SimpleDateFormat f = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
        f.setTimeZone(TimeZone.getTimeZone("UTC"));
        return f.format(new Date(ms));
    }

    private static String clock(long ms) {
        long s = ms / 1000;
        return String.format(Locale.US, "%d:%02d:%02d", s / 3600, (s % 3600) / 60, s % 60);
    }

    private Notification notification(String text) {
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && nm.getNotificationChannel(CHANNEL) == null) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, "Audio output recorder", NotificationManager.IMPORTANCE_LOW);
            ch.setDescription("Shown while AmberX records the sound the phone plays (and your mic, only when you turned that on)");
            nm.createNotificationChannel(ch);
        }
        Intent open = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent stop = PendingIntent.getService(this, 1, new Intent(this, OutputRecordService.class).setAction(ACTION_STOP), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Notification.Builder b = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O ? new Notification.Builder(this, CHANNEL) : new Notification.Builder(this);
        b.setSmallIcon(android.R.drawable.ic_btn_speak_now)
            .setContentTitle(sessionTitle())
            .setContentText(text)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setContentIntent(PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT))
            .addAction(new Notification.Action.Builder(null, "Stop", stop).build());
        if (micOn) {
            // the mic stops at once from here, the playback recording goes on
            PendingIntent stopMic = PendingIntent.getService(this, 2, new Intent(this, OutputRecordService.class).setAction(ACTION_STOP_MIC), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
            b.addAction(new Notification.Action.Builder(null, "Stop mic", stopMic).build());
        }
        return b.build();
    }

    /** When the session's recording started (every part name carries it); the chunk's own start if not known yet. */
    private static long sessionStart(JSONObject session, long fallback) {
        long t = session.optLong("startedAt", 0);
        return t > 0 ? t : fallback;
    }

    private String sessionTitle() {
        JSONObject s = OutputRecordQueue.session(this);
        if (micOn) return s == null ? "Recording: playback + mic" : "Recording: " + s.optString("name") + " (playback + mic)";
        return s == null ? "Recording what the phone plays" : "Recording: " + s.optString("name");
    }

    private void tick() {
        main.removeCallbacks(tick);
        if (!running || stopping) return;
        int waiting = OutputRecordQueue.list(this).size();
        String text = clock(System.currentTimeMillis() - startedAtMs) + (waiting > 0 ? " · " + waiting + " waiting for axHub" : "") + " · " + TwoTrack.micLine(micOn, micBusy != null);
        ((NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE)).notify(NOTIFICATION, notification(text));
        main.postDelayed(tick, 15_000);
    }

    /* ------------------------------------------------------------------ start */

    private void start(Intent intent) {
        if (running) return;
        running = true;
        stopping = false;
        endReason = null;
        micStop = false;
        micLive = false;
        micBusy = null;
        // the mic only when asked for (setting or the approved start's `mic`) and Android's audio permission is there
        boolean wantMic = OutputRecordQueue.micWanted(this) && MicGuard.mayOpen(this); // Mic off: playback only
        micOn = wantMic;
        boolean micAllowed = wantMic && checkSelfPermission(android.Manifest.permission.RECORD_AUDIO) == android.content.pm.PackageManager.PERMISSION_GRANTED;
        Notification n = notification("Starting…");
        try {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) throw new IllegalStateException("Recording what the phone plays needs Android 10 or newer.");
            boolean fgMic = false;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R && micAllowed) {
                // Android 11+ lets a service use the mic only as a "microphone" foreground service started from the app
                try { startForeground(NOTIFICATION, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION | ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE); fgMic = true; }
                catch (RuntimeException refused) { /* not allowed now (started from the background): playback only, marked */ }
            }
            if (!fgMic) startForeground(NOTIFICATION, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION);
            if (micAllowed && !fgMic && Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) micAllowed = false;
            Intent data = intent.getParcelableExtra(EXTRA_DATA);
            MediaProjectionManager mpm = (MediaProjectionManager) getSystemService(Context.MEDIA_PROJECTION_SERVICE);
            projection = data == null ? null : mpm.getMediaProjection(intent.getIntExtra(EXTRA_CODE, 0), data);
            if (projection == null) throw new IllegalStateException("Android didn’t hand over capture.");
            projection.registerCallback(new MediaProjection.Callback() {
                @Override public void onStop() { stop("Android ended the capture."); }
            }, main);
            OutputRecordQueue.Settings s = OutputRecordQueue.settings(this);
            channels = micOn ? 2 : s.channels; // with the mic: always two tracks, left = mic, right = playback
            kbps = s.kbps;
            skipSilent = s.skipSilent;
            chunkUs = s.chunkMin * 60L * 1_000_000L;
            OutputRecordQueue.clearBroken(this);
            openCapture();
            encoder.start();
            capture.startRecording();
            if (micOn) {
                if (!micAllowed) micBusy(TwoTrack.BUSY_UNAVAILABLE, "Android didn’t allow the mic for this recording");
                else openMic();
            }
            startedAtMs = System.currentTimeMillis();
            OutputRecordQueue.sessionStarted(this, startedAtMs);
            AxppLink.cancelPrompt(this);
            if (micOn) {
                playReader = new Thread(this::readPlayback, "amberx-outrec-play");
                playReader.start();
                pump = new Thread(this::pumpTwoTrack, "amberx-outrec");
            } else pump = new Thread(this::pump, "amberx-outrec");
            pump.start();
            JSObject e = new JSObject();
            e.put("startedAt", iso(startedAtMs));
            e.put("mic", micOn);
            if (micBusy != null) e.put("micBusy", micBusy);
            emit("recording", e);
            OutputRecordTile.refresh(this);
            main.post(tick);
            OutputRecordUploader.kick(this);
        } catch (Exception e) {
            fail("The recorder couldn’t start: " + e.getMessage());
        }
    }

    /** The sound apps play (media, games, unknown). Built only from a playback-capture config: never the microphone. */
    @SuppressLint("MissingPermission") // RECORD_AUDIO is checked by OutputRecordStartActivity before the service starts
    private void openCapture() throws Exception {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) throw new IllegalStateException("needs Android 10");
        AudioPlaybackCaptureConfiguration cfg = new AudioPlaybackCaptureConfiguration.Builder(projection)
            .addMatchingUsage(AudioAttributes.USAGE_MEDIA)
            .addMatchingUsage(AudioAttributes.USAGE_GAME)
            .addMatchingUsage(AudioAttributes.USAGE_UNKNOWN)
            .build();
        AudioFormat af = new AudioFormat.Builder().setEncoding(AudioFormat.ENCODING_PCM_16BIT).setSampleRate(RATE).setChannelMask(AudioFormat.CHANNEL_IN_STEREO).build();
        int min = AudioRecord.getMinBufferSize(RATE, AudioFormat.CHANNEL_IN_STEREO, AudioFormat.ENCODING_PCM_16BIT);
        capture = new AudioRecord.Builder().setAudioFormat(af).setBufferSizeInBytes(Math.max(min * 4, 64 * 1024)).setAudioPlaybackCaptureConfig(cfg).build();
        if (capture.getState() != AudioRecord.STATE_INITIALIZED) throw new IllegalStateException("Android refused playback capture (is the audio permission allowed?)");
        MediaFormat f = MediaFormat.createAudioFormat(MediaFormat.MIMETYPE_AUDIO_AAC, RATE, channels);
        f.setInteger(MediaFormat.KEY_AAC_PROFILE, MediaCodecInfo.CodecProfileLevel.AACObjectLC);
        f.setInteger(MediaFormat.KEY_BIT_RATE, kbps * 1000);
        f.setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, 16 * 1024);
        encoder = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_AUDIO_AAC);
        encoder.configure(f, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE);
    }

    /* ------------------------------------------------------------------ the opt-in mic (second track) */

    /**
     * Opens the mic next to the playback capture. Android may refuse it (another app holds the mic, e.g. the Claude
     * app's voice mode) or hand it over silenced: either way the recording goes on with the mic side silent and marked.
     */
    @SuppressLint("MissingPermission") // checked in start() before this is called
    private void openMic() {
        if (!MicGuard.mayOpen(this)) { micBusy(TwoTrack.BUSY_OFF, "Mic off is on"); return; }
        try {
            int min = AudioRecord.getMinBufferSize(RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
            AudioFormat af = new AudioFormat.Builder().setEncoding(AudioFormat.ENCODING_PCM_16BIT).setSampleRate(RATE).setChannelMask(AudioFormat.CHANNEL_IN_MONO).build();
            // VOICE_RECOGNITION: not privacy-sensitive, so it never takes the mic away from a call or the Claude app
            AudioRecord m = new AudioRecord.Builder().setAudioSource(android.media.MediaRecorder.AudioSource.VOICE_RECOGNITION)
                .setAudioFormat(af).setBufferSizeInBytes(Math.max(min * 4, 32 * 1024)).build();
            if (m.getState() != AudioRecord.STATE_INITIALIZED) { m.release(); micBusy(TwoTrack.BUSY_UNAVAILABLE, "Android didn’t hand over the mic"); return; }
            int sid = m.getAudioSessionId();
            try { if (android.media.audiofx.AcousticEchoCanceler.isAvailable()) { android.media.audiofx.AcousticEchoCanceler a = android.media.audiofx.AcousticEchoCanceler.create(sid); if (a != null) a.setEnabled(true); } } catch (RuntimeException ignored) { /* no AEC on this phone */ }
            try { if (android.media.audiofx.NoiseSuppressor.isAvailable()) { android.media.audiofx.NoiseSuppressor ns = android.media.audiofx.NoiseSuppressor.create(sid); if (ns != null) ns.setEnabled(true); } } catch (RuntimeException ignored) { /* none */ }
            micSession = sid;
            MicGuard.claim(sid);
            m.startRecording();
            if (m.getRecordingState() != AudioRecord.RECORDSTATE_RECORDING) { MicGuard.release(sid); m.release(); micBusy(TwoTrack.BUSY_UNAVAILABLE, "the mic is in use by another app"); return; }
            mic = m;
            micLive = true;
            micReader = new Thread(this::readMic, "amberx-outrec-mic");
            micReader.start();
        } catch (Exception e) {
            micBusy(TwoTrack.BUSY_UNAVAILABLE, "the mic couldn’t open: " + e.getMessage());
        }
    }

    /** Mic → its ring; checks every second whether Android silences it (another app took the mic). */
    private void readMic() {
        short[] buf = new short[BLOCK];
        long lastCheck = 0;
        AudioRecord m = mic;
        try {
            while (!stopping && !micStop && m != null) {
                int n = m.read(buf, 0, buf.length);
                if (n < 0) { if (!micStop && !stopping) micBusy(TwoTrack.BUSY_ERROR, "the mic stopped delivering (" + n + ")"); break; }
                if (n > 0) micRing.write(buf, 0, n);
                long t = System.currentTimeMillis();
                if (t - lastCheck >= 1000) {
                    lastCheck = t;
                    android.media.AudioRecordingConfiguration cfg = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q ? m.getActiveRecordingConfiguration() : null;
                    boolean silenced = cfg != null && cfg.isClientSilenced();
                    if (silenced && micBusy == null) micBusy(TwoTrack.BUSY_SILENCED, "another app is using the mic");
                    else if (!silenced && TwoTrack.BUSY_SILENCED.equals(micBusy)) micBack();
                }
            }
        } catch (RuntimeException e) {
            if (!micStop && !stopping) micBusy(TwoTrack.BUSY_ERROR, "the mic stopped: " + e.getMessage());
        }
        micLive = false;
        releaseMic();
    }

    /** Playback → its ring (two-track mode: the pump mixes it with the mic). */
    private void readPlayback() {
        byte[] pcm = new byte[BLOCK * 4];
        short[] mono = new short[BLOCK];
        AudioRecord cap = capture;
        try {
            while (!stopping && cap != null) {
                int n = cap.read(pcm, 0, pcm.length);
                if (n < 0) { if (!stopping && endReason == null) endReason = "Recording stopped: playback capture ended (" + n + ")."; stopping = true; break; }
                int f = TwoTrack.toMono(pcm, n, 2, mono);
                if (f > 0) playRing.write(mono, 0, f);
            }
        } catch (RuntimeException e) {
            if (!stopping && endReason == null) endReason = "Recording stopped: " + e.getMessage();
            stopping = true;
        }
    }

    /** The mic side is silent from now (reason = TwoTrack.BUSY_*): marked in the chunk, said in a notification. */
    private void micBusy(String reason, String why) {
        if (reason.equals(micBusy)) return;
        micBusy = reason;
        JSObject e = new JSObject();
        e.put("reason", reason);
        e.put("message", why);
        emit("micBusy", e);
        if (!TwoTrack.BUSY_OFF.equals(reason)) {
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            Notification.Builder b = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O ? new Notification.Builder(this, CHANNEL) : new Notification.Builder(this);
            nm.notify(NOTE_MIC_BUSY, b.setSmallIcon(android.R.drawable.ic_btn_speak_now)
                .setContentTitle("Mic busy: recording playback only")
                .setContentText("AmberX can’t record your mic right now (" + why + "). What the phone plays is still recorded; the gap is marked.")
                .setAutoCancel(true).build());
        }
        main.post(tick);
    }

    private void micBack() {
        if (micBusy == null) return;
        micBusy = null;
        emit("micBack", null);
        ((NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE)).cancel(NOTE_MIC_BUSY);
        main.post(tick);
    }

    /** Stop mic (the notification): the mic is let go at once; the playback recording goes on, the mic side silent. */
    private void stopMic() {
        if (!running || !micOn) return;
        micStop = true;
        micBusy(TwoTrack.BUSY_OFF, "turned off from the notification");
        micOn = false; // the notification and status say mic off from here
        releaseMic();
        ((NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE)).cancel(NOTE_MIC_BUSY);
        main.post(tick);
    }

    /** Lets go of the mic (idempotent; the reader thread ends on its own). */
    private synchronized void releaseMic() {
        AudioRecord m = mic;
        mic = null;
        micLive = false;
        MicGuard.release(micSession);
        micSession = 0;
        if (m == null) return;
        try { m.stop(); } catch (RuntimeException ignored) { /* not started */ }
        try { m.release(); } catch (RuntimeException ignored) { /* gone */ }
    }

    /* ------------------------------------------------------------------ pump: capture → AAC → chunk files */

    private void pump() {
        byte[] pcm = new byte[8192];
        byte[] mono = new byte[4096];
        long frames = 0;
        boolean eosSent = false;
        MediaCodec.BufferInfo info = new MediaCodec.BufferInfo();
        try {
            while (true) {
                if (!eosSent) {
                    int n = capture.read(pcm, 0, pcm.length);
                    boolean end = stopping;
                    if (n > 0 || end) {
                        byte[] src = pcm;
                        int len = Math.max(0, n);
                        if (channels == 1 && len > 0) { len = downmix(pcm, len, mono); src = mono; }
                        else if (len > 0) peak(pcm, len);
                        int ii = encoder.dequeueInputBuffer(10_000);
                        if (ii >= 0) {
                            ByteBuffer ib = encoder.getInputBuffer(ii);
                            int put = 0;
                            if (ib != null && len > 0) { ib.clear(); put = Math.min(len, ib.remaining()); ib.put(src, 0, put); }
                            long pts = frames * 1_000_000L / RATE;
                            frames += put / (2L * channels);
                            encoder.queueInputBuffer(ii, 0, put, pts, end ? MediaCodec.BUFFER_FLAG_END_OF_STREAM : 0);
                            if (end) eosSent = true;
                        }
                    }
                }
                int oi = encoder.dequeueOutputBuffer(info, eosSent ? 10_000 : 0);
                if (oi == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) outFormat = encoder.getOutputFormat();
                else if (oi >= 0) {
                    ByteBuffer b = encoder.getOutputBuffer(oi);
                    if (b != null && info.size > 0 && (info.flags & MediaCodec.BUFFER_FLAG_CODEC_CONFIG) == 0) write(b, info);
                    encoder.releaseOutputBuffer(oi, false);
                    if ((info.flags & MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0) break;
                } else if (eosSent && oi == MediaCodec.INFO_TRY_AGAIN_LATER) break;
            }
        } catch (Exception e) {
            if (endReason == null) endReason = "Recording stopped: " + e.getMessage();
        }
        closeChunk();
        release();
        main.post(this::finish);
    }

    /**
     * Two-track pump: blocks of {@link #BLOCK} frames, left = mic, right = playback, on the clock of the mic while it
     * delivers (it always does, silence included) and playback's otherwise; mic busy spans are kept per chunk.
     */
    private void pumpTwoTrack() {
        short[] micBuf = new short[BLOCK];
        short[] playBuf = new short[BLOCK];
        byte[] pcm = new byte[BLOCK * 4];
        long frames = 0;
        boolean eosSent = false;
        MediaCodec.BufferInfo info = new MediaCodec.BufferInfo();
        try {
            while (true) {
                if (!eosSent) {
                    boolean micClock = micLive;
                    boolean ready = (micClock ? micRing : playRing).await(BLOCK, 250);
                    boolean end = stopping;
                    if (ready || end) {
                        int len = 0;
                        if (ready) {
                            len = TwoTrack.mixBlock(micRing, playRing, micClock, BLOCK, micBuf, playBuf, pcm);
                            peak = TwoTrack.peak(playBuf, BLOCK, TwoTrack.peak(micBuf, BLOCK, peak));
                            long atMs = chunkStartUs < 0 ? 0 : Math.max(0, frames * 1_000_000L / RATE - chunkStartUs) / 1000;
                            String b = micBusy;
                            if (b != null) busy.start(atMs, b); else busy.end(atMs);
                        }
                        int ii = encoder.dequeueInputBuffer(10_000);
                        if (ii >= 0) {
                            ByteBuffer ib = encoder.getInputBuffer(ii);
                            int put = 0;
                            if (ib != null && len > 0) { ib.clear(); put = Math.min(len, ib.remaining()); ib.put(pcm, 0, put); }
                            long pts = frames * 1_000_000L / RATE;
                            frames += put / 4L;
                            encoder.queueInputBuffer(ii, 0, put, pts, end ? MediaCodec.BUFFER_FLAG_END_OF_STREAM : 0);
                            if (end) eosSent = true;
                        }
                    }
                }
                int oi = encoder.dequeueOutputBuffer(info, eosSent ? 10_000 : 0);
                if (oi == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) outFormat = encoder.getOutputFormat();
                else if (oi >= 0) {
                    ByteBuffer b = encoder.getOutputBuffer(oi);
                    if (b != null && info.size > 0 && (info.flags & MediaCodec.BUFFER_FLAG_CODEC_CONFIG) == 0) write(b, info);
                    encoder.releaseOutputBuffer(oi, false);
                    if ((info.flags & MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0) break;
                } else if (eosSent && oi == MediaCodec.INFO_TRY_AGAIN_LATER) break;
            }
        } catch (Exception e) {
            if (endReason == null) endReason = "Recording stopped: " + e.getMessage();
        }
        closeChunk();
        release();
        main.post(this::finish);
    }

    /** 16-bit stereo → mono (average of the two sides); records the loudest sample for the silence check. */
    private int downmix(byte[] in, int len, byte[] out) {
        int frames = len / 4;
        int p = peak;
        for (int i = 0; i < frames; i++) {
            int l = (short) ((in[i * 4] & 0xff) | (in[i * 4 + 1] << 8));
            int r = (short) ((in[i * 4 + 2] & 0xff) | (in[i * 4 + 3] << 8));
            int m = (l + r) / 2;
            out[i * 2] = (byte) m;
            out[i * 2 + 1] = (byte) (m >> 8);
            int a = Math.abs(m);
            if (a > p) p = a;
        }
        peak = p;
        return frames * 2;
    }

    private void peak(byte[] in, int len) {
        int p = peak;
        for (int i = 0; i + 1 < len; i += 2) { int a = Math.abs((short) ((in[i] & 0xff) | (in[i + 1] << 8))); if (a > p) p = a; }
        peak = p;
    }

    private void write(ByteBuffer b, MediaCodec.BufferInfo info) throws Exception {
        if (outFormat == null) return;
        if (muxer == null) openChunk(info.presentationTimeUs);
        else if (info.presentationTimeUs - chunkStartUs >= chunkUs) { closeChunk(); openChunk(info.presentationTimeUs); }
        long us = info.presentationTimeUs - chunkStartUs;
        if (us <= lastUs) us = lastUs + 1;
        lastUs = us;
        MediaCodec.BufferInfo o = new MediaCodec.BufferInfo();
        o.set(0, info.size, us, info.flags & ~MediaCodec.BUFFER_FLAG_END_OF_STREAM);
        b.position(info.offset);
        b.limit(info.offset + info.size);
        muxer.writeSampleData(track, b.slice(), o);
        samples++;
    }

    private static String newId(long wall) {
        String abc = "abcdefghijklmnopqrstuvwxyz0123456789";
        StringBuilder r = new StringBuilder();
        for (int i = 0; i < 4; i++) r.append(abc.charAt(RNG.nextInt(abc.length())));
        return new SimpleDateFormat("yyyyMMdd-HHmmss", Locale.US).format(new Date(wall)) + "-" + r;
    }

    private void openChunk(long startUs) throws Exception {
        chunkStartWall = System.currentTimeMillis();
        chunkStartUs = startUs;
        lastUs = -1;
        samples = 0;
        peak = 0;
        chunkId = newId(chunkStartWall);
        File f = OutputRecordQueue.part(this, chunkId);
        current = f;
        JSONObject session = OutputRecordQueue.session(this);
        currentName = session == null ? null : RecorderControl.partName(session.optString("name"), sessionStart(session, chunkStartWall), session.optInt("parts") + 1, TimeZone.getDefault());
        muxer = new MediaMuxer(f.getAbsolutePath(), MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4);
        track = muxer.addTrack(outFormat);
        muxer.start();
    }

    /** Closes the open chunk: renamed to `<id>.m4a` with its index, or dropped when empty / silent all through. */
    private void closeChunk() {
        if (muxer == null) return;
        String id = chunkId;
        File part = OutputRecordQueue.part(this, id);
        boolean ok = false;
        try { if (samples > 0) { muxer.stop(); ok = true; } } catch (RuntimeException ignored) { /* nothing playable was written */ }
        try { muxer.release(); } catch (RuntimeException ignored) { /* already gone */ }
        muxer = null;
        current = null;
        currentName = null;
        long durMs = Math.max(0, lastUs) / 1000;
        boolean silent = peak <= SILENCE;
        if (!ok || (skipSilent && silent)) {
            if (playReader != null) { try { busy.close(durMs); } catch (Exception ignored) { /* spans of a dropped chunk */ } }
            part.delete();
            if (ok) { JSObject e = new JSObject(); e.put("id", id); emit("silent", e); }
            return;
        }
        try {
            File m4a = OutputRecordQueue.audio(this, id);
            if (!part.renameTo(m4a)) throw new IllegalStateException("rename failed");
            JSONObject meta = new JSONObject();
            meta.put("id", id);
            meta.put("startedAt", iso(chunkStartWall));
            meta.put("endedAt", iso(chunkStartWall + durMs));
            meta.put("durationMs", durMs);
            meta.put("bytes", m4a.length());
            meta.put("kbps", kbps);
            meta.put("channels", channels);
            meta.put("device", Build.MANUFACTURER + " " + Build.MODEL);
            meta.put("uploadedParts", 0);
            if (playReader != null) { // two-track chunk: which side is whom, and when the mic side was silent
                org.json.JSONArray spans = busy.close(durMs);
                meta.put("mic", true);
                meta.put("tracks", TwoTrack.tracks());
                meta.put("micBusy", spans);
                meta.put("micBusyMs", TwoTrack.Busy.total(spans));
            }
            JSONObject session = OutputRecordQueue.session(this);
            if (session != null) {
                int n = OutputRecordQueue.nextPart(this);
                meta.put("name", RecorderControl.partName(session.optString("name"), sessionStart(session, chunkStartWall), n, TimeZone.getDefault()));
                meta.put("session", session.optString("name"));
                meta.put("group", session.optString("group"));
                meta.put("part", n);
                if (!session.optString("note").isEmpty()) meta.put("note", session.optString("note"));
            }
            OutputRecordQueue.writeMeta(this, id, meta);
            JSObject e = new JSObject();
            e.put("id", id);
            e.put("durationMs", durMs);
            emit("chunk", e);
            OutputRecordUploader.chunkClosed(this, id);
        } catch (Exception e) {
            part.delete();
        }
    }

    private void release() {
        micStop = true;
        releaseMic(); // the mic is never held past the recording
        try { if (playReader != null) playReader.join(500); } catch (InterruptedException ignored) { Thread.currentThread().interrupt(); }
        try { if (capture != null) { capture.stop(); capture.release(); } } catch (RuntimeException ignored) { /* gone */ }
        try { if (encoder != null) { encoder.stop(); encoder.release(); } } catch (RuntimeException ignored) { /* gone */ }
        capture = null;
        encoder = null;
        micRing.clear();
        playRing.clear();
    }

    /* ------------------------------------------------------------------ stop */

    /** Stop (switch, tile, notification, Android): the pump sends end-of-stream, closes the open chunk and finishes. */
    void stop(String reason) {
        if (!running) { stopSelf(); return; }
        if (reason != null && endReason == null) endReason = reason;
        if (stopping) return;
        stopping = true;
        if (pump == null) main.post(this::finish);
    }

    private void finish() {
        running = false;
        startedAtMs = 0;
        micOn = false;
        micBusy = null;
        playReader = null;
        micReader = null;
        ((NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE)).cancel(NOTE_MIC_BUSY);
        try { if (projection != null) projection.stop(); } catch (RuntimeException ignored) { /* already stopped */ }
        projection = null;
        pump = null;
        main.removeCallbacks(tick);
        JSObject e = new JSObject();
        if (endReason != null) e.put("reason", endReason);
        emit("stopped", e);
        OutputRecordQueue.clearSession(this);
        stopForeground(STOP_FOREGROUND_REMOVE);
        OutputRecordTile.refresh(this);
        OutputRecordUploader.kick(this);
        stopSelf();
    }

    private void fail(String message) {
        endReason = message;
        release();
        JSObject e = new JSObject();
        e.put("message", message);
        emit("error", e);
        OutputRecordQueue.clearSession(this);
        running = false;
        startedAtMs = 0;
        micOn = false;
        micBusy = null;
        ((NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE)).cancel(NOTE_MIC_BUSY);
        try { if (projection != null) projection.stop(); } catch (RuntimeException ignored) { /* never started */ }
        projection = null;
        stopForeground(STOP_FOREGROUND_REMOVE);
        OutputRecordTile.refresh(this);
        stopSelf();
    }
}
