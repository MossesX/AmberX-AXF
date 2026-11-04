package ai.amberx.droid;

import java.io.ByteArrayOutputStream;
import java.io.DataOutputStream;
import java.io.IOException;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * The pure rules of live audio (live-audio@1, no Android imports, unit-tested): where the phone talks to, the frames@1
 * batch format, the shared session clock, the send queue with backpressure, the console's link answer and what the
 * phone does with it. The runtime is {@link LiveStreamer}; the console side is the Live sessions plugin
 * (`apps/console-web/plugins/live-sessions/server/live_audio.py`, the same frames@1 layout).
 */
final class LiveRules {
    private LiveRules() {}

    /** AmberX's own site: its server forwards /api/console/plugins/live-sessions/ to the console (hub admins only). */
    static final String SITE = "https://amberx.amberxai.com";
    static final String PREFIX = "/api/console/plugins/live-sessions/";
    static final int MIC = 0, TTS = 1;
    static final int RATE = 48_000;
    static final int FRAME_MS = 20;
    static final int KBPS = 24;
    /** most audio the phone holds while the console can't be reached; older frames are dropped first */
    static final long QUEUE_MS = 10_000;
    static final int BATCH_MAX_BYTES = 64 * 1024;
    static final int LINK_WAIT_S = 25;
    /** a recorder started only for a live listener stops this long after the last one leaves */
    static final long LIVE_ONLY_GRACE_MS = 30_000;
    /** the sample clock is re-anchored to the wall clock when they drift this far apart */
    static final long REANCHOR_MS = 250;
    private static final String SESSION_ID = "[A-Za-z0-9._:-]{1,120}";

    static String linkUrl() { return SITE + PREFIX + "audio/link"; }

    static String framesUrl(String session, String stream) {
        if (session == null || !session.matches(SESSION_ID)) throw new IllegalArgumentException("bad session id");
        if (stream == null || !stream.matches("[A-Za-z0-9-]{1,40}")) throw new IllegalArgumentException("bad stream id");
        return SITE + PREFIX + "sessions/" + enc(session) + "/audio/frames?stream=" + stream;
    }

    private static String enc(String s) {
        try { return URLEncoder.encode(s, "UTF-8").replace("+", "%20"); } catch (java.io.UnsupportedEncodingException e) { throw new IllegalStateException(e); }
    }

    /** Only the live-sessions routes on AmberX's own site, https, no other host (the native side never goes elsewhere). */
    static boolean allowed(String url) {
        return url != null && url.startsWith(SITE + PREFIX) && !url.contains("..") && !url.contains("@") && !url.contains("\\");
    }

    /* ---------------------------------------------------------------- frames */

    static final class Frame {
        final int track; final long seq; final long atMs; final byte[] data;
        Frame(int track, long seq, long atMs, byte[] data) { this.track = track; this.seq = seq; this.atMs = atMs; this.data = data; }
    }

    /** frames@1: "AXLA" u8 1, then per frame u8 track · u32 seq · i64 atMs · u16 length · bytes (big-endian). */
    static byte[] encode(List<Frame> frames) {
        try {
            ByteArrayOutputStream b = new ByteArrayOutputStream();
            DataOutputStream o = new DataOutputStream(b);
            o.write(new byte[] { 'A', 'X', 'L', 'A', 1 });
            for (Frame f : frames) {
                o.writeByte(f.track);
                o.writeInt((int) (f.seq & 0xffffffffL));
                o.writeLong(f.atMs);
                o.writeShort(f.data.length);
                o.write(f.data);
            }
            return b.toByteArray();
        } catch (IOException e) {
            throw new IllegalStateException(e); // a byte array never fails
        }
    }

    /* ---------------------------------------------------------------- the shared clock */

    /** NTP-style: how far the console's clock is ahead of the phone's (sent / received on the phone, now on the console). */
    static long clockOffset(long sentAtMs, long receivedAtMs, long serverNowMs) {
        return serverNowMs - (sentAtMs + receivedAtMs) / 2;
    }

    /** Keeps the smoother offset unless the new one is from a quicker round trip (less error) or the old one is stale. */
    static long betterOffset(long oldOffset, long oldRttMs, long newOffset, long newRttMs) {
        return oldRttMs < 0 || newRttMs <= oldRttMs + 20 ? newOffset : oldOffset;
    }

    /** A frame's time on the console clock: where its track's samples were anchored + samples so far. */
    static long frameAt(long anchorWallMs, long offsetMs, long samples) {
        return anchorWallMs + offsetMs + samples * 1000L / RATE;
    }

    /** The sample clock drifted from the wall clock (a capture stall, a dropped read): anchor again. */
    static boolean reanchor(long expectedWallMs, long nowWallMs) {
        return Math.abs(nowWallMs - expectedWallMs) > REANCHOR_MS;
    }

    /* ---------------------------------------------------------------- the send queue (backpressure) */

    /**
     * Frames waiting to go. Holds at most {@link #QUEUE_MS} of audio per track (both tracks share it, so twice that in
     * frames); when full the oldest go first and are counted, so a slow network loses the past, never the present.
     */
    static final class Queue {
        private final ArrayDeque<Frame> q = new ArrayDeque<>();
        private final int max;
        private long dropped;

        Queue() { this((int) (2 * QUEUE_MS / FRAME_MS)); }
        Queue(int maxFrames) { this.max = maxFrames; }

        synchronized void add(Frame f) {
            q.addLast(f);
            while (q.size() > max) { q.removeFirst(); dropped++; }
            notifyAll();
        }

        /** Up to maxBytes of frames, oldest first (waits up to waitMs for the first one). */
        synchronized List<Frame> take(int maxBytes, long waitMs) throws InterruptedException {
            if (q.isEmpty() && waitMs > 0) wait(waitMs);
            List<Frame> out = new ArrayList<>();
            int bytes = 5;
            while (!q.isEmpty() && bytes + 15 + q.peekFirst().data.length <= maxBytes) {
                Frame f = q.removeFirst();
                bytes += 15 + f.data.length;
                out.add(f);
            }
            return out;
        }

        /** A batch that didn't go: back at the front (unless newer audio already filled the queue). */
        synchronized void putBack(List<Frame> batch) {
            for (int i = batch.size() - 1; i >= 0; i--) q.addFirst(batch.get(i));
            while (q.size() > max) { q.removeFirst(); dropped++; }
        }

        synchronized int size() { return q.size(); }
        synchronized long dropped() { return dropped; }
        synchronized long queuedMs() { return (long) q.size() * FRAME_MS / 2; }
        synchronized void clear() { q.clear(); }
    }

    /** Retry pause after the n-th failed send in a row (reconnect quickly, then ease off). */
    static long sendBackoff(int failures) {
        long[] steps = { 500, 1_000, 2_000, 5_000 };
        return failures <= 0 ? 0 : steps[Math.min(failures, steps.length) - 1];
    }

    /* ---------------------------------------------------------------- the console's link answer */

    static final class Answer {
        final String session, title, why, notice, known;
        final boolean stream, watched;
        final List<String> watchers;
        final int voiceWatchers;
        final long serverNow;
        final int batchMs, kbps;

        Answer(JSONObject o) {
            JSONObject s = o.optJSONObject("session");
            session = s == null ? "" : s.optString("id", "");
            title = s == null ? "" : s.optString("title", "");
            stream = o.optBoolean("stream", false) && !session.isEmpty();
            why = o.optString("why", "");
            JSONObject n = o.optJSONObject("notice");
            watched = n != null && n.optBoolean("watched", false);
            notice = n == null ? "" : n.optString("text", "");
            watchers = new ArrayList<>();
            JSONArray w = o.optJSONArray("watchers");
            for (int i = 0; w != null && i < w.length() && i < 10; i++) watchers.add(w.optString(i));
            voiceWatchers = Math.max(0, o.optInt("voiceWatchers", 0));
            serverNow = o.optLong("serverNow", 0);
            batchMs = Math.max(60, Math.min(1000, o.optInt("batchMs", 200)));
            kbps = Math.max(12, Math.min(64, o.optInt("kbps", KBPS)));
            known = o.optString("known", "");
        }

        static Answer none() { return new Answer(new JSONObject()); }
    }

    /** What the phone does now. */
    enum Action { STREAM, IDLE, ASK_CONSENT, STOP_RECORDER }

    /**
     * @param recording   the recorder runs (Android's capture consent was given)
     * @param liveOnly    it was started only because someone listened live
     * @param offSinceMs  when the console last stopped wanting the stream (0 = it wants it now)
     */
    static Action action(Answer a, boolean recording, boolean liveOnly, long offSinceMs, long nowMs) {
        if (a.stream) return recording ? Action.STREAM : (a.voiceWatchers > 0 ? Action.ASK_CONSENT : Action.IDLE);
        if (recording && liveOnly && offSinceMs > 0 && nowMs - offSinceMs >= LIVE_ONLY_GRACE_MS) return Action.STOP_RECORDER;
        return Action.IDLE;
    }

    /** The phone's "You're being watched" line (empty = no notification). */
    static String watchedLine(Answer a) {
        if (!a.watched) return "";
        String who = a.watchers.isEmpty() ? "Someone" : String.join(", ", a.watchers);
        return who + (a.voiceWatchers > 0 ? " is listening live" : " is watching this session") + (a.title.isEmpty() ? "" : ": " + a.title);
    }

    /** The link request the phone sends (the console's `POST audio/link`). */
    static JSONObject linkBody(String device, String name, boolean recording, boolean mic, String recSession, boolean streaming,
                               long sent, long dropped, long queuedMs, String known, int wait, long sentAtMs) throws org.json.JSONException {
        return new JSONObject().put("device", device).put("name", name).put("recording", recording).put("mic", mic)
            .put("recSession", recSession == null ? "" : recSession).put("streaming", streaming)
            .put("stats", new JSONObject().put("sent", sent).put("dropped", dropped).put("queuedMs", queuedMs).put("sentAt", sentAtMs))
            .put("known", known == null ? "" : known).put("wait", wait);
    }
}
