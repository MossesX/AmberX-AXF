package ai.amberx.droid;

import java.util.ArrayList;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * The pure half of the recorder's opt-in microphone track (Nov 1 2026): two sources on one timeline, written as one
 * stereo stream, **left = the mic (Brett), right = what the phone plays (Claude)**, so the Chat viewer's two-voice export
 * and later transcription can tell the speakers apart. No Android imports, so it runs under plain JUnit
 * ({@code TwoTrackTest}); {@link OutputRecordService} feeds it from two AudioRecords.
 *
 * Each source fills its own {@link Ring} from its own reader thread (16-bit mono, 48 kHz). The pump takes one block of
 * frames from the source that keeps the clock (the mic while it delivers, else playback) and the same number from the
 * other, padding with silence when that one is short and dropping its backlog past {@link #MAX_LAG_FRAMES} so the two
 * can never drift apart by more than half a second.
 *
 * Mic busy: when Android won't hand over the mic or silences it (another app such as the Claude app's voice mode holds
 * it), the left side is written as silence and the time is kept as a busy span ({@link Busy}), which goes in the
 * chunk's metadata (`micBusy`), instead of the recording failing.
 */
final class TwoTrack {
    private TwoTrack() {}

    static final int RATE = 48_000;
    /** The two sides can't drift apart by more than this (0.5 s). */
    static final int MAX_LAG_FRAMES = RATE / 2;
    /** Each ring holds 2 s. */
    static final int RING_FRAMES = RATE * 2;
    static final String LEFT = "mic";
    static final String RIGHT = "playback";

    /** 16-bit mono frames from one reader thread to the pump. Oldest frames are dropped when it overflows. */
    static final class Ring {
        private final short[] buf;
        private int head, size;
        private long dropped;
        Ring(int frames) { buf = new short[Math.max(1, frames)]; }

        synchronized void write(short[] src, int off, int n) {
            for (int i = 0; i < n; i++) {
                if (size == buf.length) { head = (head + 1) % buf.length; size--; dropped++; }
                buf[(head + size) % buf.length] = src[off + i];
                size++;
            }
            notifyAll();
        }

        /** Takes up to n frames into dst (from off); returns how many. */
        synchronized int read(short[] dst, int off, int n) {
            int k = Math.min(n, size);
            for (int i = 0; i < k; i++) dst[off + i] = buf[(head + i) % buf.length];
            head = (head + k) % buf.length;
            size -= k;
            return k;
        }

        /** Drops all but the newest `keep` frames; returns how many were dropped. */
        synchronized int trimTo(int keep) {
            int drop = Math.max(0, size - Math.max(0, keep));
            head = (head + drop) % buf.length;
            size -= drop;
            dropped += drop;
            return drop;
        }

        /** Waits (up to ms) until at least n frames are in. */
        synchronized boolean await(int n, long ms) throws InterruptedException {
            long until = System.currentTimeMillis() + ms;
            while (size < n) {
                long left = until - System.currentTimeMillis();
                if (left <= 0) return false;
                wait(left);
            }
            return true;
        }

        synchronized int size() { return size; }
        synchronized long dropped() { return dropped; }
        synchronized void clear() { head = 0; size = 0; }
    }

    /** 16-bit little-endian PCM (mono or stereo) → mono shorts (stereo: the average of the two sides). */
    static int toMono(byte[] in, int len, int channels, short[] out) {
        int step = 2 * Math.max(1, channels);
        int frames = len / step;
        for (int i = 0; i < frames; i++) {
            int at = i * step;
            int l = (short) ((in[at] & 0xff) | (in[at + 1] << 8));
            if (channels == 2) {
                int r = (short) ((in[at + 2] & 0xff) | (in[at + 3] << 8));
                out[i] = (short) ((l + r) / 2);
            } else out[i] = (short) l;
        }
        return frames;
    }

    /** Left = mic, right = playback, as interleaved 16-bit little-endian stereo; returns the bytes written. */
    static int interleave(short[] mic, short[] playback, int frames, byte[] out) {
        for (int i = 0; i < frames; i++) {
            int o = i * 4;
            short l = mic[i], r = playback[i];
            out[o] = (byte) l;
            out[o + 1] = (byte) (l >> 8);
            out[o + 2] = (byte) r;
            out[o + 3] = (byte) (r >> 8);
        }
        return frames * 4;
    }

    /** The loudest |sample| in the first n. */
    static int peak(short[] s, int n, int start) {
        int p = start;
        for (int i = 0; i < n; i++) { int a = Math.abs((int) s[i]); if (a > p) p = a; }
        return p;
    }

    /**
     * One block for the encoder: `frames` from the clock side, the same from the other (silence where short, its
     * backlog past {@link #MAX_LAG_FRAMES} dropped first). micClock says which ring keeps time. Returns the stereo bytes.
     */
    static int mixBlock(Ring mic, Ring playback, boolean micClock, int frames, short[] micBuf, short[] playBuf, byte[] out) {
        Ring clock = micClock ? mic : playback;
        Ring other = micClock ? playback : mic;
        short[] cb = micClock ? micBuf : playBuf;
        short[] ob = micClock ? playBuf : micBuf;
        int got = clock.read(cb, 0, frames);
        for (int i = got; i < frames; i++) cb[i] = 0;
        other.trimTo(MAX_LAG_FRAMES + frames);
        int o = other.read(ob, 0, frames);
        for (int i = o; i < frames; i++) ob[i] = 0;
        return interleave(micBuf, playBuf, frames, out);
    }

    /* ---------------------------------------------------------------- mic busy spans (chunk metadata) */

    /** Why the left side is silent for a while. */
    static final String BUSY_UNAVAILABLE = "unavailable"; // Android wouldn't open the mic (another app holds it)
    static final String BUSY_SILENCED = "silenced";       // Android opened it but silences it (reported by the OS)
    static final String BUSY_ERROR = "error";             // the mic stopped delivering
    static final String BUSY_OFF = "stopped";             // turned off from the notification

    /** The busy spans of one chunk, in ms from the chunk's start. A span still open at the end is closed there. */
    static final class Busy {
        static final int MAX_SPANS = 100;
        private final List<long[]> spans = new ArrayList<>();
        private final List<String> reasons = new ArrayList<>();
        private long openAt = -1;
        private String openReason;

        /** The mic is busy from `atMs` for `reason` (no-op if already busy for the same reason). */
        void start(long atMs, String reason) {
            if (openAt >= 0 && reason.equals(openReason)) return;
            if (openAt >= 0) end(atMs);
            openAt = Math.max(0, atMs);
            openReason = reason;
        }

        void end(long atMs) {
            if (openAt < 0) return;
            spans.add(new long[] { openAt, Math.max(openAt, atMs) });
            reasons.add(openReason);
            openAt = -1;
            openReason = null;
        }

        boolean open() { return openAt >= 0; }
        String openReason() { return openReason; }

        /** Closes at `endMs` and returns the spans: [{fromMs, toMs, reason}]; the open reason carries into the next chunk. */
        JSONArray close(long endMs) throws JSONException {
            String carry = openReason;
            end(endMs);
            while (spans.size() > MAX_SPANS) { // a mic flapping all chunk long: the last ones merged (the index stays small)
                long[] last = spans.remove(spans.size() - 1);
                String why = reasons.remove(reasons.size() - 1);
                long[] prev = spans.get(spans.size() - 1);
                prev[1] = Math.max(prev[1], last[1]);
                reasons.set(reasons.size() - 1, why);
            }
            JSONArray a = new JSONArray();
            for (int i = 0; i < spans.size(); i++) a.put(new JSONObject().put("fromMs", spans.get(i)[0]).put("toMs", spans.get(i)[1]).put("reason", reasons.get(i)));
            spans.clear();
            reasons.clear();
            if (carry != null) start(0, carry);
            return a;
        }

        /** Total busy ms in spans (for the chunk's `micBusyMs`). */
        static long total(JSONArray a) {
            long t = 0;
            for (int i = 0; i < a.length(); i++) { JSONObject o = a.optJSONObject(i); if (o != null) t += o.optLong("toMs") - o.optLong("fromMs"); }
            return t;
        }
    }

    /** What the chunk's metadata says about its tracks. */
    static JSONObject tracks() throws JSONException {
        return new JSONObject().put("left", LEFT).put("right", RIGHT);
    }

    /** The notification line: "playback + mic", "playback only (mic busy)", "playback (mic off)". */
    static String micLine(boolean micOn, boolean busy) {
        if (!micOn) return "mic off";
        return busy ? "mic busy: playback only" : "playback + mic";
    }
}
