package ai.amberx.droid;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.media.MediaCodec;
import android.media.MediaCodecList;
import android.media.MediaFormat;
import android.os.Build;
import android.os.PowerManager;
import android.webkit.CookieManager;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.List;
import org.json.JSONObject;

/**
 * Live audio (live-audio@1, Nov 4 2026): while someone listens in the console's Live sessions → Watch live, or while the
 * recorder records and the console's recording is on, both tracks the recorder already captures go out live as Opus
 * frames of 20 ms, stamped on the console's clock: mic = the human (left in the recorder's chunks), tts = what the
 * phone plays (Claude's voice). The 30-minute chunks to axHub carry on unchanged; this is a second, live copy.
 *
 * Link: one thread long-polls the console's `audio/link` (through AmberX's own site, which forwards Live sessions calls
 * to the console for hub admins; the phone's hub session cookie and AmberX as Origin, nothing else is ever contacted,
 * {@link LiveRules#allowed}). The answer says which session to stream for, whether to stream now and who watches.
 *  - stream + the recorder runs → encode and send (a ~200 ms batch at a time, one in flight).
 *  - stream + the recorder is off + a voice listener → Android needs its own capture consent (every start), so a
 *    "Listening live" notification opens the recorder's consent screen (with the mic); that recording is marked
 *    live-only and stops by itself 30 s after the last listener leaves.
 *  - watched → an ongoing "You're being watched" notification (heads-up the first time), gone when nobody watches.
 *
 * Backpressure: at most 10 s of frames wait on the phone (oldest dropped first, counted); a failed send is retried
 * 0.5 → 1 → 2 → 5 s and resumes where it stopped (the console skips frames it already has: seq per track per stream).
 * Screen off: everything runs in the recorder's foreground service threads; a partial wake lock is held only while
 * frames are going out (10 min at a time, renewed by every link answer).
 */
final class LiveStreamer {
    private LiveStreamer() {}

    private static final String CHANNEL_WATCHED = "amberx-live-watched";
    private static final String CHANNEL_ASK = "amberx-live-ask";
    static final int NOTE_WATCHED = 7321;
    static final int NOTE_ASK = 7322;
    private static final String PREFS_LIVE_ONLY = "live.onlyFor";
    private static final SecureRandom RNG = new SecureRandom();

    private static Context app;
    private static Thread linkThread, sendThread;
    private static volatile LiveRules.Answer last = LiveRules.Answer.none();
    private static volatile boolean streaming;
    private static volatile String session = "", stream = "";
    private static volatile long offsetMs, rttMs = -1;
    private static volatile long offSince;
    private static volatile boolean asked;
    private static volatile long sent;
    private static volatile String lastWatched = "";
    private static final LiveRules.Queue queue = new LiveRules.Queue();
    private static final Track[] tracks = { new Track(LiveRules.MIC), new Track(LiveRules.TTS) };
    private static PowerManager.WakeLock wake;

    /** Starts the link once per process (safe to call often; AxppLink.ensure calls it). */
    static synchronized void ensure(Context c) {
        app = c.getApplicationContext();
        if (linkThread != null && linkThread.isAlive()) return;
        linkThread = new Thread(LiveStreamer::linkLoop, "amberx-live-link");
        linkThread.setDaemon(true);
        linkThread.start();
    }

    /** Whether captured audio is wanted right now (the capture threads skip the copy when not). */
    static boolean wanted() { return streaming; }

    /** The recorder started or stopped: wake the link so the console hears it at once. */
    static void recorderChanged(Context c, boolean running) {
        ensure(c);
        if (!running) {
            stopStreaming();
            c.getSharedPreferences(OutputRecordQueue.PREFS, Context.MODE_PRIVATE).edit().remove(PREFS_LIVE_ONLY).apply();
        } else {
            ((NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE)).cancel(NOTE_ASK);
            LiveRules.Answer a = last;
            if (a.stream) startStreaming(a.session); // consent given for a listener: no need to wait for the next answer
        }
        Thread t = linkThread;
        if (t != null) t.interrupt(); // ends the current long poll's wait
    }

    /* ---------------------------------------------------------------- capture → Opus (called from the recorder's threads) */

    /** 16-bit mono PCM at 48 kHz from one track (mic: the mic reader; tts: the playback reader / single-track pump). */
    static void pcm(int track, short[] buf, int n) {
        if (!streaming || n <= 0) return;
        tracks[track].feed(buf, n);
    }

    /** One track's Opus encoder and its clock (samples since its anchor on the wall clock). */
    private static final class Track {
        final int id;
        MediaCodec enc;
        long anchorWall, samples, seq;
        final MediaCodec.BufferInfo info = new MediaCodec.BufferInfo();
        byte[] bytes = new byte[4096];
        boolean failed;

        Track(int id) { this.id = id; }

        synchronized void feed(short[] buf, int n) {
            if (failed) return;
            try {
                long now = System.currentTimeMillis();
                if (enc == null) open(now - n * 1000L / LiveRules.RATE);
                else if (LiveRules.reanchor(anchorWall + samples * 1000L / LiveRules.RATE, now - n * 1000L / LiveRules.RATE)) {
                    anchorWall = now - n * 1000L / LiveRules.RATE; // a stall: the next frames carry the true time
                    samples = 0;
                }
                int off = 0;
                while (off < n) {
                    int ii = enc.dequeueInputBuffer(5_000);
                    if (ii < 0) break; // encoder full: this block is lost (20 ms gaps, never a backlog)
                    ByteBuffer ib = enc.getInputBuffer(ii);
                    int take = Math.min(n - off, ib == null ? 0 : ib.remaining() / 2);
                    if (take <= 0) { enc.queueInputBuffer(ii, 0, 0, 0, 0); break; }
                    if (bytes.length < take * 2) bytes = new byte[take * 2];
                    for (int i = 0; i < take; i++) { short s = buf[off + i]; bytes[i * 2] = (byte) s; bytes[i * 2 + 1] = (byte) (s >> 8); }
                    ib.put(bytes, 0, take * 2);
                    long pts = samples * 1_000_000L / LiveRules.RATE;
                    enc.queueInputBuffer(ii, 0, take * 2, pts, 0);
                    samples += take;
                    off += take;
                }
                drain();
            } catch (Exception e) {
                failed = true; // no Opus encoder or it broke: this track stays silent until the stream restarts
                close();
            }
        }

        private void open(long anchor) throws IOException {
            MediaFormat f = MediaFormat.createAudioFormat(MediaFormat.MIMETYPE_AUDIO_OPUS, LiveRules.RATE, 1);
            f.setInteger(MediaFormat.KEY_BIT_RATE, last.kbps * 1000);
            f.setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, 16 * 1024);
            String name = new MediaCodecList(MediaCodecList.REGULAR_CODECS).findEncoderForFormat(f);
            if (name == null) throw new IOException("this phone has no Opus encoder");
            enc = MediaCodec.createByCodecName(name);
            enc.configure(f, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE);
            enc.start();
            anchorWall = anchor;
            samples = 0;
        }

        /** Every finished Opus packet → the send queue, stamped on the console's clock. */
        private void drain() {
            while (true) {
                int oi = enc.dequeueOutputBuffer(info, 0);
                if (oi < 0) return;
                ByteBuffer b = enc.getOutputBuffer(oi);
                if (b != null && info.size > 0 && (info.flags & MediaCodec.BUFFER_FLAG_CODEC_CONFIG) == 0 && info.size <= 1500) {
                    byte[] pkt = new byte[info.size];
                    b.position(info.offset);
                    b.get(pkt, 0, info.size);
                    long at = LiveRules.frameAt(anchorWall, offsetMs, info.presentationTimeUs * LiveRules.RATE / 1_000_000L);
                    queue.add(new LiveRules.Frame(id, seq++, at, pkt));
                }
                enc.releaseOutputBuffer(oi, false);
            }
        }

        synchronized void close() {
            MediaCodec e = enc;
            enc = null;
            if (e != null) {
                try { e.stop(); } catch (RuntimeException ignored) { /* not started */ }
                try { e.release(); } catch (RuntimeException ignored) { /* gone */ }
            }
        }

        synchronized void reset() { close(); failed = false; seq = 0; samples = 0; }
    }

    /* ---------------------------------------------------------------- start / stop streaming */

    private static synchronized void startStreaming(String sid) {
        if (streaming && sid.equals(session)) return;
        stopStreaming();
        session = sid;
        stream = newStream();
        for (Track t : tracks) t.reset();
        queue.clear();
        streaming = true;
        holdWake(true);
        sendThread = new Thread(LiveStreamer::sendLoop, "amberx-live-send");
        sendThread.setDaemon(true);
        sendThread.start();
    }

    private static synchronized void stopStreaming() {
        if (!streaming) return;
        streaming = false;
        Thread t = sendThread;
        sendThread = null;
        if (t != null) t.interrupt();
        for (Track tr : tracks) tr.close();
        holdWake(false);
    }

    private static String newStream() {
        String abc = "abcdefghijklmnopqrstuvwxyz0123456789";
        StringBuilder b = new StringBuilder("s-");
        for (int i = 0; i < 10; i++) b.append(abc.charAt(RNG.nextInt(abc.length())));
        return b.toString();
    }

    private static void holdWake(boolean on) {
        Context c = app;
        if (c == null) return;
        try {
            if (on) {
                if (wake == null) {
                    wake = ((PowerManager) c.getSystemService(Context.POWER_SERVICE)).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "amberx:live-audio");
                    wake.setReferenceCounted(false);
                }
                wake.acquire(10 * 60_000L);
            } else if (wake != null && wake.isHeld()) wake.release();
        } catch (RuntimeException ignored) { /* no wake lock: the foreground service still runs */ }
    }

    /* ---------------------------------------------------------------- sending */

    private static void sendLoop() {
        int failures = 0;
        String sid = session, sidStream = stream;
        while (streaming && sid.equals(session)) {
            List<LiveRules.Frame> batch;
            try {
                Thread.sleep(Math.max(0, last.batchMs - 40));
                batch = queue.take(LiveRules.BATCH_MAX_BYTES, 200);
            } catch (InterruptedException e) { return; }
            if (batch.isEmpty()) continue;
            try {
                Reply r = post(LiveRules.framesUrl(sid, sidStream), LiveRules.encode(batch), "application/octet-stream", 10_000);
                if (r.status == 200) { failures = 0; sent += batch.size(); }
                else if (r.status == 400 || r.status == 404) { failures = 0; } // the session ended or refused it: drop, the link moves on
                else { queue.putBack(batch); failures++; }
            } catch (Exception e) {
                queue.putBack(batch);
                failures++;
            }
            if (failures > 0) {
                try { Thread.sleep(LiveRules.sendBackoff(failures)); } catch (InterruptedException e) { return; }
            }
        }
    }

    /* ---------------------------------------------------------------- the link */

    private static void linkLoop() {
        int failures = 0;
        while (true) {
            long wait = 0;
            try {
                String cookie = CookieManager.getInstance().getCookie(LiveRules.SITE);
                if (cookie == null || cookie.isEmpty()) wait = 60_000;
                else {
                    JSONObject s = OutputRecordQueue.session(app);
                    long t0 = System.currentTimeMillis();
                    JSONObject body = LiveRules.linkBody(AxppLink.deviceId(app), (Build.MANUFACTURER + " " + Build.MODEL).trim(), OutputRecordService.running,
                        OutputRecordService.running && OutputRecordService.micOn, s == null ? "" : s.optString("name"), streaming, sent, queue.dropped(),
                        queue.queuedMs(), last.known, streaming || OutputRecordService.running ? 10 : LiveRules.LINK_WAIT_S, t0);
                    Reply r = post(LiveRules.linkUrl(), body.toString().getBytes(StandardCharsets.UTF_8), "application/json", (LiveRules.LINK_WAIT_S + 15) * 1000);
                    long t1 = System.currentTimeMillis();
                    if (r.status == 200) {
                        failures = 0;
                        LiveRules.Answer a = new LiveRules.Answer(new JSONObject(r.body));
                        long off = LiveRules.clockOffset(t0, t1, a.serverNow);
                        // a long poll's round trip includes its wait: only quick answers set the clock
                        if (a.serverNow > 0 && (t1 - t0 < 2_000 || rttMs < 0)) { offsetMs = LiveRules.betterOffset(offsetMs, rttMs, off, t1 - t0); rttMs = t1 - t0; }
                        apply(a);
                    } else wait = r.status == 401 || r.status == 403 ? 60_000 : backoff(++failures); // 503: the console or its token isn't there
                }
            } catch (Exception e) {
                wait = backoff(++failures);
            }
            if (wait > 0) {
                try { Thread.sleep(wait); } catch (InterruptedException e) { /* recorder changed: poll now */ }
            } else if (Thread.interrupted()) { /* cleared; poll again at once */ }
        }
    }

    private static long backoff(int failures) {
        long[] steps = { 2_000, 5_000, 15_000, 30_000, 60_000 };
        return steps[Math.min(failures, steps.length) - 1];
    }

    private static void apply(LiveRules.Answer a) {
        last = a;
        Context c = app;
        long now = System.currentTimeMillis();
        if (a.stream) offSince = 0; else if (offSince == 0) offSince = now;
        boolean liveOnly = c.getSharedPreferences(OutputRecordQueue.PREFS, Context.MODE_PRIVATE).getBoolean(PREFS_LIVE_ONLY, false);
        switch (LiveRules.action(a, OutputRecordService.running, liveOnly, offSince, now)) {
            case STREAM: asked = false; startStreaming(a.session); holdWake(true); break;
            case ASK_CONSENT: stopStreaming(); if (!asked) { asked = true; askConsent(c, a); } break;
            case STOP_RECORDER:
                stopStreaming();
                c.startService(new Intent(c, OutputRecordService.class).setAction(OutputRecordService.ACTION_STOP)
                    .putExtra(OutputRecordService.EXTRA_REASON, "Nobody is listening live any more."));
                break;
            default:
                stopStreaming();
                if (!a.stream) {
                    asked = false;
                    ((NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE)).cancel(NOTE_ASK);
                    // the ask is over unanswered: a recording Brett starts later himself is his, not live-only
                    if (!OutputRecordService.running) c.getSharedPreferences(OutputRecordQueue.PREFS, Context.MODE_PRIVATE).edit().remove(PREFS_LIVE_ONLY).apply();
                }
        }
        watched(c, LiveRules.watchedLine(a));
    }

    /* ---------------------------------------------------------------- what the phone shows */

    private static void channel(NotificationManager nm, String id, String name, String about, int importance) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && nm.getNotificationChannel(id) == null) {
            NotificationChannel ch = new NotificationChannel(id, name, importance);
            ch.setDescription(about);
            nm.createNotificationChannel(ch);
        }
    }

    /** "You're being watched": ongoing while anyone watches, heads-up when it starts, gone when the last one leaves. */
    private static void watched(Context c, String line) {
        if (line.equals(lastWatched)) return;
        lastWatched = line;
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        if (line.isEmpty()) { nm.cancel(NOTE_WATCHED); return; }
        channel(nm, CHANNEL_WATCHED, "You're being watched", "Shown while someone watches or listens to your Claude session live in the Dev Console", NotificationManager.IMPORTANCE_HIGH);
        Intent open = new Intent(c, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_NEW_TASK);
        Notification.Builder b = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O ? new Notification.Builder(c, CHANNEL_WATCHED) : new Notification.Builder(c);
        b.setSmallIcon(android.R.drawable.ic_menu_view)
            .setContentTitle("You're being watched")
            .setContentText(line)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setCategory(Notification.CATEGORY_STATUS)
            .setContentIntent(PendingIntent.getActivity(c, 21, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT));
        nm.notify(NOTE_WATCHED, b.build());
    }

    /**
     * Someone listens and the recorder is off: Android asks for capture consent on every start, so the phone asks Brett
     * (the consent screen at once where Android allows it, and a notification that opens it). The recording it starts
     * takes the mic (Mic off still wins) and is live-only: it stops 30 s after the last listener leaves.
     */
    private static void askConsent(Context c, LiveRules.Answer a) {
        String name = a.title.isEmpty() ? "Watch live" : "Watch live - " + a.title;
        OutputRecordQueue.setSession(c, new RecorderControl.Session(RecorderControl.clean(name), "Watch live", "Started for a live listener", true));
        c.getSharedPreferences(OutputRecordQueue.PREFS, Context.MODE_PRIVATE).edit().putBoolean(PREFS_LIVE_ONLY, true).apply();
        try { c.startActivity(OutputRecordStartActivity.intent(c)); } catch (RuntimeException ignored) { /* background start refused: the notification does it */ }
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        channel(nm, CHANNEL_ASK, "Listening live", "Someone wants to hear your Claude session live: tap to share the phone's audio and your mic", NotificationManager.IMPORTANCE_HIGH);
        PendingIntent pi = PendingIntent.getActivity(c, 22, OutputRecordStartActivity.intent(c), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        String who = a.watchers.isEmpty() ? "Brett" : String.join(", ", a.watchers);
        Notification.Builder b = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O ? new Notification.Builder(c, CHANNEL_ASK) : new Notification.Builder(c);
        b.setSmallIcon(android.R.drawable.ic_btn_speak_now)
            .setContentTitle(who + " wants to listen live")
            .setContentText("Tap to allow Android's capture prompt (what the phone plays + your mic). It stops when they leave.")
            .setContentIntent(pi)
            .setAutoCancel(true);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) b.setTimeoutAfter(5 * 60_000L);
        nm.notify(NOTE_ASK, b.build());
    }

    /* ---------------------------------------------------------------- HTTP (AmberX's own site only) */

    static final class Reply {
        final int status; final String body;
        Reply(int status, String body) { this.status = status; this.body = body; }
    }

    private static Reply post(String url, byte[] body, String type, int readTimeoutMs) throws IOException {
        if (!LiveRules.allowed(url)) throw new IOException("not a live-sessions route on AmberX's site");
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        try {
            c.setInstanceFollowRedirects(false);
            c.setConnectTimeout(10_000);
            c.setReadTimeout(readTimeoutMs);
            c.setUseCaches(false);
            c.setDoOutput(true);
            c.setRequestMethod("POST");
            c.setFixedLengthStreamingMode(body.length);
            c.setRequestProperty("Content-Type", type);
            c.setRequestProperty("Origin", LiveRules.SITE); // the wall takes writes only from AmberX's own site
            String cookie = CookieManager.getInstance().getCookie(LiveRules.SITE);
            if (cookie != null) c.setRequestProperty("Cookie", cookie);
            try (OutputStream o = c.getOutputStream()) { o.write(body); }
            int code = c.getResponseCode();
            InputStream in = code < 400 ? c.getInputStream() : c.getErrorStream();
            ByteArrayOutputStream b = new ByteArrayOutputStream();
            if (in != null) {
                try (InputStream i = in) {
                    byte[] buf = new byte[4096];
                    int n, total = 0;
                    while ((n = i.read(buf)) > 0 && total < 64 * 1024) { b.write(buf, 0, n); total += n; }
                }
            }
            return new Reply(code, b.toString("UTF-8"));
        } finally {
            c.disconnect();
        }
    }
}
