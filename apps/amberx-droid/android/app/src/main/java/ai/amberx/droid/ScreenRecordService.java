package ai.amberx.droid;

import android.annotation.SuppressLint;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.graphics.drawable.GradientDrawable;
import android.hardware.display.DisplayManager;
import android.hardware.display.VirtualDisplay;
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
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.ParcelFileDescriptor;
import android.provider.MediaStore;
import android.provider.Settings;
import android.util.DisplayMetrics;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.widget.TextView;
import com.getcapacitor.JSObject;
import java.nio.ByteBuffer;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/**
 * Audio Extract's screen recorder: MediaProjection → a virtual display → H.264 (MediaCodec, surface input), and the
 * sound other apps play → AudioPlaybackCapture → AAC (MediaCodec), both into one MP4 (MediaMuxer) in
 * Movies/AmberX Recordings. No microphone: the AudioRecord's only source is playback capture. An app that opts out of
 * capture is simply silent; if Android refuses capture altogether the video has no sound track and the web side says so.
 *
 * Foreground service (type mediaProjection) with a notification (Pause / Resume, Stop), a countdown before it starts
 * and an optional floating chip (elapsed, Stop) when "Display over other apps" is allowed. Reports every change to
 * {@link #listener} (AudioExtractPlugin → `recorder` events): countdown, recording, paused, stopped (with the video),
 * cancelled, error. Android asks for screen capture every time (AudioExtractPlugin.consent).
 */
public class ScreenRecordService extends Service {
    interface Listener { void on(JSObject e); }

    static final String ACTION_START = "ai.amberx.droid.rec.START";
    static final String ACTION_PAUSE = "ai.amberx.droid.rec.PAUSE";
    static final String ACTION_RESUME = "ai.amberx.droid.rec.RESUME";
    static final String ACTION_STOP = "ai.amberx.droid.rec.STOP";
    static final String EXTRA_CODE = "code";
    static final String EXTRA_DATA = "data";
    private static final String CHANNEL = "amberx-recorder";
    private static final int NOTIFICATION = 7301;
    private static final int RATE = 48_000;

    static volatile Listener listener;
    static volatile boolean running;

    private final Handler main = new Handler(Looper.getMainLooper());
    private final Object muxLock = new Object();

    private MediaProjection projection;
    private VirtualDisplay display;
    private MediaCodec video, audio;
    private AudioRecord capture;
    private MediaMuxer muxer;
    private ParcelFileDescriptor pfd;
    private Uri out;
    private String fileName;
    private int videoTrack = -1, audioTrack = -1;
    private boolean muxing, wantAudio, playbackAudio;
    private volatile boolean stopping, paused;
    private volatile long startNs, pauseStartNs, pausedNs;
    private long lastVideoUs = -1, lastAudioUs = -1, audioFrames;
    private Thread videoThread, audioThread;
    private int countdown;
    private boolean chipOn;
    private TextView chip;
    private Bundle opts;
    private final Runnable tick = this::tick;

    @Override public IBinder onBind(Intent i) { return null; }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String a = intent == null ? null : intent.getAction();
        if (ACTION_START.equals(a)) start(intent);
        else if (ACTION_PAUSE.equals(a)) setPaused(true);
        else if (ACTION_RESUME.equals(a)) setPaused(false);
        else if (ACTION_STOP.equals(a)) stop();
        return START_NOT_STICKY;
    }

    @Override
    public void onDestroy() {
        main.removeCallbacksAndMessages(null);
        hideChip();
        running = false;
        super.onDestroy();
    }

    /* ------------------------------------------------------------------ events + notification */

    private static void emit(String state, JSObject extra) {
        JSObject e = extra == null ? new JSObject() : extra;
        e.put("state", state);
        Listener l = listener;
        if (l != null) l.on(e);
    }

    private long elapsedMs() {
        if (startNs == 0) return 0;
        long now = paused ? pauseStartNs : System.nanoTime();
        return Math.max(0, (now - startNs - pausedNs) / 1_000_000L);
    }

    private static String clock(long ms) {
        long s = ms / 1000;
        return s >= 3600 ? String.format(Locale.US, "%d:%02d:%02d", s / 3600, (s % 3600) / 60, s % 60) : String.format(Locale.US, "%d:%02d", s / 60, s % 60);
    }

    private PendingIntent action(String a, int code) {
        return PendingIntent.getService(this, code, new Intent(this, ScreenRecordService.class).setAction(a), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    private Notification notification(String text) {
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && nm.getNotificationChannel(CHANNEL) == null) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, "Screen recorder", NotificationManager.IMPORTANCE_LOW);
            ch.setDescription("Shown while AmberX records the screen (Audio Extract)");
            nm.createNotificationChannel(ch);
        }
        Intent open = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        Notification.Builder b = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O ? new Notification.Builder(this, CHANNEL) : new Notification.Builder(this);
        b.setSmallIcon(android.R.drawable.presence_video_online)
            .setContentTitle("AmberX screen recorder")
            .setContentText(text)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setContentIntent(PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT));
        if (muxing || startNs != 0) {
            b.addAction(new Notification.Action.Builder(null, paused ? "Resume" : "Pause", action(paused ? ACTION_RESUME : ACTION_PAUSE, 1)).build());
        }
        b.addAction(new Notification.Action.Builder(null, startNs == 0 ? "Cancel" : "Stop", action(ACTION_STOP, 2)).build());
        return b.build();
    }

    private void notify(String text) {
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        nm.notify(NOTIFICATION, notification(text));
    }

    /* ------------------------------------------------------------------ start: foreground, projection, countdown */

    private void start(Intent intent) {
        if (running) return;
        running = true;
        opts = intent.getExtras() == null ? new Bundle() : new Bundle(intent.getExtras());
        Notification n = notification("Starting…");
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) startForeground(NOTIFICATION, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION);
            else startForeground(NOTIFICATION, n);
            Intent data = intent.getParcelableExtra(EXTRA_DATA);
            MediaProjectionManager mpm = (MediaProjectionManager) getSystemService(Context.MEDIA_PROJECTION_SERVICE);
            projection = data == null ? null : mpm.getMediaProjection(intent.getIntExtra(EXTRA_CODE, 0), data);
            if (projection == null) throw new IllegalStateException("Android didn’t hand over the screen.");
            projection.registerCallback(new MediaProjection.Callback() {
                @Override public void onStop() { main.post(ScreenRecordService.this::stop); } // stopped from the system (status bar chip, lock)
            }, main);
        } catch (RuntimeException e) {
            fail("The recorder couldn’t start: " + e.getMessage());
            return;
        }
        chipOn = opts.getBoolean("chip", true) && Settings.canDrawOverlays(this);
        countdown = Math.max(0, Math.min(10, opts.getInt("countdown", 3)));
        if (countdown == 0) begin();
        else countdownStep();
    }

    private void countdownStep() {
        if (stopping) return;
        if (countdown <= 0) { begin(); return; }
        JSObject e = new JSObject();
        e.put("remaining", countdown);
        emit("countdown", e);
        notify("Starting in " + countdown + "…");
        showChip("Starting in " + countdown);
        countdown -= 1;
        main.postDelayed(this::countdownStep, 1000);
    }

    /* ------------------------------------------------------------------ recording */

    private int[] size() {
        DisplayMetrics m = getResources().getDisplayMetrics();
        int w, h;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            android.graphics.Rect r = ((WindowManager) getSystemService(Context.WINDOW_SERVICE)).getCurrentWindowMetrics().getBounds();
            w = r.width(); h = r.height();
        } else {
            DisplayMetrics real = new DisplayMetrics();
            ((WindowManager) getSystemService(Context.WINDOW_SERVICE)).getDefaultDisplay().getRealMetrics(real);
            w = real.widthPixels; h = real.heightPixels;
        }
        String res = opts.getString("resolution", "native");
        int target = "1080".equals(res) ? 1080 : "720".equals(res) ? 720 : 0;
        int shortSide = Math.min(w, h);
        if (target > 0 && shortSide > target) {
            double k = (double) target / shortSide;
            w = (int) Math.round(w * k); h = (int) Math.round(h * k);
        }
        // encoders want sizes in steps of 16
        w = Math.max(16, w & ~15); h = Math.max(16, h & ~15);
        return new int[] { w, h, m.densityDpi };
    }

    private void begin() {
        if (stopping) return;
        try {
            int[] s = size();
            int fps = opts.getInt("fps", 30) == 60 ? 60 : 30;
            int vbr = (int) Math.max(1_000_000, Math.min(40_000_000, opts.getDouble("videoMbps", 8.0) * 1_000_000));
            MediaFormat vf = MediaFormat.createVideoFormat(MediaFormat.MIMETYPE_VIDEO_AVC, s[0], s[1]);
            vf.setInteger(MediaFormat.KEY_COLOR_FORMAT, MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface);
            vf.setInteger(MediaFormat.KEY_BIT_RATE, vbr);
            vf.setInteger(MediaFormat.KEY_FRAME_RATE, fps);
            vf.setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, 1);
            vf.setLong(MediaFormat.KEY_REPEAT_PREVIOUS_FRAME_AFTER, 1_000_000L / fps);
            video = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_VIDEO_AVC);
            video.configure(vf, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE);
            android.view.Surface input = video.createInputSurface();

            wantAudio = false;
            playbackAudio = false;
            if (opts.getBoolean("playback", false) && Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) openCapture();

            fileName = "AmberX_Screen_" + new SimpleDateFormat("yyyyMMdd_HHmmss", Locale.US).format(new Date()) + ".mp4";
            ContentValues cv = new ContentValues();
            cv.put(MediaStore.MediaColumns.DISPLAY_NAME, fileName);
            cv.put(MediaStore.MediaColumns.MIME_TYPE, "video/mp4");
            cv.put(MediaStore.MediaColumns.RELATIVE_PATH, AudioExtractPlugin.RECORDINGS_DIR);
            cv.put(MediaStore.MediaColumns.IS_PENDING, 1);
            out = getContentResolver().insert(MediaStore.Video.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY), cv);
            if (out == null) throw new IllegalStateException("Android wouldn’t make the video file.");
            pfd = getContentResolver().openFileDescriptor(out, "rw");
            if (pfd == null) throw new IllegalStateException("Can’t write the video file.");
            muxer = new MediaMuxer(pfd.getFileDescriptor(), MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4);

            video.start();
            display = projection.createVirtualDisplay("AmberX recorder", s[0], s[1], s[2], DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR, input, null, null);
            startNs = System.nanoTime();
            videoThread = new Thread(this::drainVideo, "amberx-rec-video");
            videoThread.start();
            if (wantAudio) {
                audio.start();
                capture.startRecording();
                audioThread = new Thread(this::pumpAudio, "amberx-rec-audio");
                audioThread.start();
            }
            JSObject e = new JSObject();
            e.put("elapsedMs", 0);
            e.put("playbackAudio", playbackAudio);
            emit("recording", e);
            main.post(tick);
        } catch (Exception e) {
            fail("Recording couldn’t start: " + e.getMessage());
        }
    }

    /** The sound other apps play (media, games, unknown). Never the microphone. */
    @SuppressLint("MissingPermission") // checked by AudioExtractPlugin before the service starts ("playback" granted)
    private void openCapture() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return;
        try {
            AudioPlaybackCaptureConfiguration cfg = new AudioPlaybackCaptureConfiguration.Builder(projection)
                .addMatchingUsage(AudioAttributes.USAGE_MEDIA)
                .addMatchingUsage(AudioAttributes.USAGE_GAME)
                .addMatchingUsage(AudioAttributes.USAGE_UNKNOWN)
                .build();
            AudioFormat af = new AudioFormat.Builder().setEncoding(AudioFormat.ENCODING_PCM_16BIT).setSampleRate(RATE).setChannelMask(AudioFormat.CHANNEL_IN_STEREO).build();
            int min = AudioRecord.getMinBufferSize(RATE, AudioFormat.CHANNEL_IN_STEREO, AudioFormat.ENCODING_PCM_16BIT);
            capture = new AudioRecord.Builder().setAudioFormat(af).setBufferSizeInBytes(Math.max(min * 4, 32 * 1024)).setAudioPlaybackCaptureConfig(cfg).build();
            if (capture.getState() != AudioRecord.STATE_INITIALIZED) throw new IllegalStateException("capture not initialised");
            int kbps = opts.getInt("audioKbps", 192);
            MediaFormat aformat = MediaFormat.createAudioFormat(MediaFormat.MIMETYPE_AUDIO_AAC, RATE, 2);
            aformat.setInteger(MediaFormat.KEY_AAC_PROFILE, MediaCodecInfo.CodecProfileLevel.AACObjectLC);
            aformat.setInteger(MediaFormat.KEY_BIT_RATE, (kbps == 128 || kbps == 256 ? kbps : 192) * 1000);
            aformat.setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, 16 * 1024);
            audio = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_AUDIO_AAC);
            audio.configure(aformat, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE);
            wantAudio = true;
            playbackAudio = true;
        } catch (Exception e) {
            if (capture != null) { capture.release(); capture = null; }
            if (audio != null) { audio.release(); audio = null; }
            wantAudio = false;
            playbackAudio = false;
        }
    }

    /** Adds a track; the muxer starts once every track it waits for is in. */
    private void addTrack(boolean isVideo, MediaFormat f) {
        synchronized (muxLock) {
            if (isVideo) videoTrack = muxer.addTrack(f); else audioTrack = muxer.addTrack(f);
            if (videoTrack >= 0 && (!wantAudio || audioTrack >= 0)) {
                muxer.start();
                muxing = true;
                Bundle b = new Bundle();
                b.putInt(MediaCodec.PARAMETER_KEY_REQUEST_SYNC_FRAME, 0);
                try { video.setParameters(b); } catch (RuntimeException ignored) { /* the next key frame comes within a second anyway */ }
            }
        }
    }

    private void write(boolean isVideo, ByteBuffer buf, MediaCodec.BufferInfo info) {
        synchronized (muxLock) {
            if (!muxing || info.size == 0 || (info.flags & MediaCodec.BUFFER_FLAG_CODEC_CONFIG) != 0) return;
            if (isVideo) {
                if (info.presentationTimeUs <= lastVideoUs) info.presentationTimeUs = lastVideoUs + 1;
                lastVideoUs = info.presentationTimeUs;
            } else {
                if (info.presentationTimeUs <= lastAudioUs) info.presentationTimeUs = lastAudioUs + 1;
                lastAudioUs = info.presentationTimeUs;
            }
            buf.position(info.offset);
            buf.limit(info.offset + info.size);
            muxer.writeSampleData(isVideo ? videoTrack : audioTrack, buf, info);
        }
    }

    private void drainVideo() {
        MediaCodec.BufferInfo info = new MediaCodec.BufferInfo();
        try {
            while (true) {
                int i = video.dequeueOutputBuffer(info, 10_000);
                if (i == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) addTrack(true, video.getOutputFormat());
                else if (i >= 0) {
                    ByteBuffer b = video.getOutputBuffer(i);
                    // surface frames carry System.nanoTime() stamps: shift them to the recording's own clock, pauses cut out
                    long rel = info.presentationTimeUs - startNs / 1000 - pausedNs / 1000;
                    if (b != null && !paused && rel >= 0) { info.presentationTimeUs = rel; write(true, b, info); }
                    video.releaseOutputBuffer(i, false);
                    if ((info.flags & MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0) break;
                } else if (stopping && i == MediaCodec.INFO_TRY_AGAIN_LATER && !muxing) break;
            }
        } catch (RuntimeException e) { /* stop() reports what was written */ }
    }

    private void pumpAudio() {
        byte[] pcm = new byte[4096];
        MediaCodec.BufferInfo info = new MediaCodec.BufferInfo();
        boolean eosSent = false;
        try {
            while (true) {
                if (!eosSent) {
                    int n = capture.read(pcm, 0, pcm.length);
                    boolean end = stopping;
                    if ((n > 0 && !paused) || end) {
                        int ii = audio.dequeueInputBuffer(10_000);
                        if (ii >= 0) {
                            ByteBuffer ib = audio.getInputBuffer(ii);
                            int len = 0;
                            if (ib != null && n > 0 && !paused) { ib.clear(); len = Math.min(n, ib.remaining()); ib.put(pcm, 0, len); }
                            long pts = audioFrames * 1_000_000L / RATE;
                            audioFrames += len / 4; // 16-bit stereo: four bytes a frame
                            audio.queueInputBuffer(ii, 0, len, pts, end ? MediaCodec.BUFFER_FLAG_END_OF_STREAM : 0);
                            if (end) eosSent = true;
                        }
                    }
                }
                int oi = audio.dequeueOutputBuffer(info, eosSent ? 10_000 : 0);
                if (oi == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) addTrack(false, audio.getOutputFormat());
                else if (oi >= 0) {
                    ByteBuffer b = audio.getOutputBuffer(oi);
                    if (b != null) write(false, b, info);
                    audio.releaseOutputBuffer(oi, false);
                    if ((info.flags & MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0) break;
                } else if (eosSent && oi == MediaCodec.INFO_TRY_AGAIN_LATER && !muxing) break;
            }
        } catch (RuntimeException e) { /* stop() reports what was written */ }
    }

    private void setPaused(boolean p) {
        if (startNs == 0 || stopping || paused == p) return;
        if (p) pauseStartNs = System.nanoTime();
        else pausedNs += System.nanoTime() - pauseStartNs;
        paused = p;
        Bundle b = new Bundle();
        b.putInt(MediaCodec.PARAMETER_KEY_SUSPEND, p ? 1 : 0);
        try { video.setParameters(b); } catch (RuntimeException ignored) { /* frames while paused are dropped in drainVideo anyway */ }
        if (!p) {
            Bundle k = new Bundle();
            k.putInt(MediaCodec.PARAMETER_KEY_REQUEST_SYNC_FRAME, 0);
            try { video.setParameters(k); } catch (RuntimeException ignored) { /* next key frame within a second */ }
        }
        JSObject e = new JSObject();
        e.put("elapsedMs", elapsedMs());
        emit(p ? "paused" : "recording", e);
        tick();
    }

    private void tick() {
        main.removeCallbacks(tick);
        if (startNs == 0 || stopping) return;
        String t = clock(elapsedMs());
        notify((paused ? "Paused · " : "Recording · ") + t + (playbackAudio ? "" : " · no app sound"));
        showChip((paused ? "❚❚ " : "● ") + t + "   Stop");
        if (!paused) {
            JSObject e = new JSObject();
            e.put("elapsedMs", elapsedMs());
            e.put("playbackAudio", playbackAudio);
            emit("recording", e);
        }
        main.postDelayed(tick, 1000);
    }

    /* ------------------------------------------------------------------ stop */

    private void stop() {
        if (stopping) return;
        stopping = true;
        main.removeCallbacksAndMessages(null);
        hideChip();
        if (startNs == 0) { // still counting down (or never started): nothing was recorded
            release();
            emit("cancelled", null);
            finish();
            return;
        }
        if (paused) { pausedNs += System.nanoTime() - pauseStartNs; paused = false; }
        final long elapsed = (System.nanoTime() - startNs - pausedNs) / 1_000_000L;
        notify("Saving…");
        new Thread(() -> {
            try { video.signalEndOfInputStream(); } catch (RuntimeException ignored) { /* already ended */ }
            join(videoThread);
            join(audioThread);
            boolean wrote;
            synchronized (muxLock) {
                wrote = muxing && lastVideoUs >= 0;
                try { if (muxing) muxer.stop(); } catch (RuntimeException e) { wrote = false; }
                muxing = false;
            }
            release();
            if (!wrote) {
                deleteOut();
                JSObject e = new JSObject();
                e.put("error", "Nothing was recorded.");
                emit("error", e);
            } else {
                ContentValues done = new ContentValues();
                done.put(MediaStore.MediaColumns.IS_PENDING, 0);
                getContentResolver().update(out, done, null, null);
                JSObject v = new JSObject();
                v.put("uri", out.toString());
                v.put("name", fileName);
                v.put("relativePath", AudioExtractPlugin.RECORDINGS_DIR + "/");
                v.put("mime", "video/mp4");
                v.put("durationMs", elapsed);
                try (android.database.Cursor c = getContentResolver().query(out, new String[] { MediaStore.MediaColumns.SIZE, MediaStore.MediaColumns.DISPLAY_NAME }, null, null, null)) {
                    if (c != null && c.moveToFirst()) { v.put("size", c.getLong(0)); v.put("name", c.getString(1)); }
                } catch (RuntimeException ignored) { /* size unknown */ }
                JSObject e = new JSObject();
                e.put("video", v);
                e.put("elapsedMs", elapsed);
                e.put("playbackAudio", playbackAudio);
                emit("stopped", e);
            }
            main.post(this::finish);
        }, "amberx-rec-stop").start();
    }

    private static void join(Thread t) {
        if (t == null) return;
        try { t.join(5_000); } catch (InterruptedException e) { Thread.currentThread().interrupt(); }
    }

    private void release() {
        if (capture != null) { try { capture.stop(); } catch (RuntimeException ignored) { /* not started */ } capture.release(); capture = null; }
        if (audio != null) { try { audio.stop(); } catch (RuntimeException ignored) { /* not started */ } audio.release(); audio = null; }
        if (display != null) { display.release(); display = null; }
        if (video != null) { try { video.stop(); } catch (RuntimeException ignored) { /* not started */ } video.release(); video = null; }
        if (muxer != null) { try { muxer.release(); } catch (RuntimeException ignored) { /* never started */ } muxer = null; }
        if (pfd != null) { try { pfd.close(); } catch (java.io.IOException ignored) { /* closing */ } pfd = null; }
        if (projection != null) { MediaProjection p = projection; projection = null; try { p.stop(); } catch (RuntimeException ignored) { /* stopped */ } }
    }

    private void deleteOut() {
        if (out != null) try { getContentResolver().delete(out, null, null); } catch (RuntimeException ignored) { /* gone */ }
    }

    private void fail(String why) {
        stopping = true;
        main.removeCallbacksAndMessages(null);
        hideChip();
        release();
        deleteOut();
        JSObject e = new JSObject();
        e.put("error", why == null ? "Recording failed." : why);
        emit("error", e);
        finish();
    }

    private void finish() {
        running = false;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) stopForeground(STOP_FOREGROUND_REMOVE);
        else stopForeground(true);
        stopSelf();
    }

    /* ------------------------------------------------------------------ floating chip */

    private void showChip(String text) {
        if (!chipOn) return;
        if (chip == null) {
            try {
                WindowManager wm = (WindowManager) getSystemService(Context.WINDOW_SERVICE);
                TextView v = new TextView(this);
                int pad = Math.round(10 * getResources().getDisplayMetrics().density);
                v.setPadding(pad, pad / 2, pad, pad / 2);
                v.setTextColor(Color.WHITE);
                v.setTextSize(14);
                GradientDrawable bg = new GradientDrawable();
                bg.setColor(0xCC000000);
                bg.setCornerRadius(pad * 2);
                v.setBackground(bg);
                v.setOnClickListener(x -> stop());
                v.setContentDescription("Stop recording");
                WindowManager.LayoutParams lp = new WindowManager.LayoutParams(
                    WindowManager.LayoutParams.WRAP_CONTENT, WindowManager.LayoutParams.WRAP_CONTENT,
                    Build.VERSION.SDK_INT >= Build.VERSION_CODES.O ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY : WindowManager.LayoutParams.TYPE_PHONE,
                    WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
                    PixelFormat.TRANSLUCENT);
                lp.gravity = Gravity.TOP | Gravity.END;
                lp.x = pad; lp.y = pad * 4;
                wm.addView(v, lp);
                chip = v;
            } catch (RuntimeException e) { chipOn = false; return; }
        }
        chip.setText(text);
        chip.setVisibility(View.VISIBLE);
    }

    private void hideChip() {
        if (chip == null) return;
        try { ((WindowManager) getSystemService(Context.WINDOW_SERVICE)).removeView(chip); } catch (RuntimeException ignored) { /* gone */ }
        chip = null;
    }
}
