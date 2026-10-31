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
 * recorder ({@link ScreenRecordService}, PR #187) without the screen. **Never the microphone:** the AudioRecord is built
 * only with {@code setAudioPlaybackCaptureConfig}, never with an audio source, so Android can't hand it the mic. Android
 * files playback capture under the RECORD_AUDIO permission, which is why that permission is asked for.
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
 */
public class OutputRecordService extends Service {
    interface Listener { void on(JSObject e); }

    static final String ACTION_START = "ai.amberx.droid.outrec.START";
    static final String ACTION_STOP = "ai.amberx.droid.outrec.STOP";
    static final String EXTRA_CODE = "code";
    static final String EXTRA_DATA = "data";
    static final String EXTRA_REASON = "reason";
    private static final String CHANNEL = "amberx-output-recorder";
    private static final int NOTIFICATION = 7311;
    private static final int RATE = 48_000;
    /** |sample| at or under this the whole chunk = silent (16-bit full scale is 32767). */
    private static final int SILENCE = 64;

    static volatile Listener listener;
    static volatile boolean running;
    static volatile long startedAtMs;
    /** the chunk being written (so a cleanup never removes it) */
    private static volatile File current;
    private static final SecureRandom RNG = new SecureRandom();

    private final Handler main = new Handler(Looper.getMainLooper());
    private MediaProjection projection;
    private AudioRecord capture;
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
            ch.setDescription("Shown while AmberX records the sound the phone plays (never the microphone)");
            nm.createNotificationChannel(ch);
        }
        Intent open = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent stop = PendingIntent.getService(this, 1, new Intent(this, OutputRecordService.class).setAction(ACTION_STOP), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Notification.Builder b = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O ? new Notification.Builder(this, CHANNEL) : new Notification.Builder(this);
        return b.setSmallIcon(android.R.drawable.ic_btn_speak_now)
            .setContentTitle("Recording what the phone plays")
            .setContentText(text)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setContentIntent(PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT))
            .addAction(new Notification.Action.Builder(null, "Stop", stop).build())
            .build();
    }

    private void tick() {
        main.removeCallbacks(tick);
        if (!running || stopping) return;
        int waiting = OutputRecordQueue.list(this).size();
        String text = clock(System.currentTimeMillis() - startedAtMs) + (waiting > 0 ? " · " + waiting + " waiting for axHub" : " · no microphone");
        ((NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE)).notify(NOTIFICATION, notification(text));
        main.postDelayed(tick, 15_000);
    }

    /* ------------------------------------------------------------------ start */

    private void start(Intent intent) {
        if (running) return;
        running = true;
        stopping = false;
        endReason = null;
        Notification n = notification("Starting…");
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) startForeground(NOTIFICATION, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION);
            else throw new IllegalStateException("Recording what the phone plays needs Android 10 or newer.");
            Intent data = intent.getParcelableExtra(EXTRA_DATA);
            MediaProjectionManager mpm = (MediaProjectionManager) getSystemService(Context.MEDIA_PROJECTION_SERVICE);
            projection = data == null ? null : mpm.getMediaProjection(intent.getIntExtra(EXTRA_CODE, 0), data);
            if (projection == null) throw new IllegalStateException("Android didn’t hand over capture.");
            projection.registerCallback(new MediaProjection.Callback() {
                @Override public void onStop() { stop("Android ended the capture."); }
            }, main);
            OutputRecordQueue.Settings s = OutputRecordQueue.settings(this);
            channels = s.channels;
            kbps = s.kbps;
            skipSilent = s.skipSilent;
            chunkUs = s.chunkMin * 60L * 1_000_000L;
            OutputRecordQueue.clearBroken(this);
            openCapture();
            encoder.start();
            capture.startRecording();
            startedAtMs = System.currentTimeMillis();
            pump = new Thread(this::pump, "amberx-outrec");
            pump.start();
            JSObject e = new JSObject();
            e.put("startedAt", iso(startedAtMs));
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
        long durMs = Math.max(0, lastUs) / 1000;
        boolean silent = peak <= SILENCE;
        if (!ok || (skipSilent && silent)) {
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
        try { if (capture != null) { capture.stop(); capture.release(); } } catch (RuntimeException ignored) { /* gone */ }
        try { if (encoder != null) { encoder.stop(); encoder.release(); } } catch (RuntimeException ignored) { /* gone */ }
        capture = null;
        encoder = null;
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
        try { if (projection != null) projection.stop(); } catch (RuntimeException ignored) { /* already stopped */ }
        projection = null;
        pump = null;
        main.removeCallbacks(tick);
        JSObject e = new JSObject();
        if (endReason != null) e.put("reason", endReason);
        emit("stopped", e);
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
        running = false;
        startedAtMs = 0;
        try { if (projection != null) projection.stop(); } catch (RuntimeException ignored) { /* never started */ }
        projection = null;
        stopForeground(STOP_FOREGROUND_REMOVE);
        OutputRecordTile.refresh(this);
        stopSelf();
    }
}
