package ai.amberx.droid;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

/** The recorder's opt-in mic track (Nov 1 2026): two tracks on one timeline, mic busy spans, the notification line. */
public class TwoTrackTest {
    private static short[] fill(int n, int v) { short[] s = new short[n]; for (int i = 0; i < n; i++) s[i] = (short) v; return s; }
    private static short left(byte[] b, int frame) { return (short) ((b[frame * 4] & 0xff) | (b[frame * 4 + 1] << 8)); }
    private static short right(byte[] b, int frame) { return (short) ((b[frame * 4 + 2] & 0xff) | (b[frame * 4 + 3] << 8)); }

    @Test
    public void leftIsMicRightIsPlayback() {
        byte[] out = new byte[16];
        assertEquals(16, TwoTrack.interleave(new short[] { 100, -200, 300, 32767 }, new short[] { -1, 2, -32768, 0 }, 4, out));
        assertEquals(100, left(out, 0));
        assertEquals(-1, right(out, 0));
        assertEquals(-200, left(out, 1));
        assertEquals(-32768, right(out, 2));
        assertEquals(32767, left(out, 3));
        assertEquals("mic", TwoTrack.LEFT);
        assertEquals("playback", TwoTrack.RIGHT);
    }

    @Test
    public void stereoPlaybackIsAveragedToItsTrack() {
        byte[] pcm = { (byte) 100, 0, (byte) 200, 0, (byte) 0xff, (byte) 0xff, 1, 0 }; // (100,200), (-1,1)
        short[] mono = new short[2];
        assertEquals(2, TwoTrack.toMono(pcm, pcm.length, 2, mono));
        assertEquals(150, mono[0]);
        assertEquals(0, mono[1]);
    }

    @Test
    public void micBusyMeansSilentLeftAndPlaybackStillRecorded() {
        TwoTrack.Ring mic = new TwoTrack.Ring(TwoTrack.RING_FRAMES);
        TwoTrack.Ring play = new TwoTrack.Ring(TwoTrack.RING_FRAMES);
        play.write(fill(64, 500), 0, 64);
        byte[] out = new byte[64 * 4];
        // the mic never delivered (busy): playback keeps the clock, the mic side is silence
        assertEquals(64 * 4, TwoTrack.mixBlock(mic, play, false, 64, new short[64], new short[64], out));
        for (int i = 0; i < 64; i++) { assertEquals(0, left(out, i)); assertEquals(500, right(out, i)); }
    }

    @Test
    public void sharedTimelineMicKeepsTheClockAndShortPlaybackIsPadded() {
        TwoTrack.Ring mic = new TwoTrack.Ring(TwoTrack.RING_FRAMES);
        TwoTrack.Ring play = new TwoTrack.Ring(TwoTrack.RING_FRAMES);
        mic.write(fill(64, 7), 0, 64);
        play.write(fill(10, 9), 0, 10); // playback is short (nothing playing for a moment)
        byte[] out = new byte[64 * 4];
        TwoTrack.mixBlock(mic, play, true, 64, new short[64], new short[64], out);
        for (int i = 0; i < 64; i++) assertEquals(7, left(out, i));
        for (int i = 0; i < 10; i++) assertEquals(9, right(out, i));
        for (int i = 10; i < 64; i++) assertEquals(0, right(out, i));
        assertEquals(0, mic.size());
        assertEquals(0, play.size());
    }

    @Test
    public void theTwoSidesNeverDriftMoreThanHalfASecond() {
        TwoTrack.Ring mic = new TwoTrack.Ring(TwoTrack.RING_FRAMES);
        TwoTrack.Ring play = new TwoTrack.Ring(TwoTrack.RING_FRAMES);
        short[] backlog = fill(TwoTrack.RATE, 1); // a second of playback piled up
        play.write(backlog, 0, backlog.length);
        mic.write(fill(64, 2), 0, 64);
        TwoTrack.mixBlock(mic, play, true, 64, new short[64], new short[64], new byte[64 * 4]);
        assertEquals(TwoTrack.MAX_LAG_FRAMES, play.size());
        assertTrue(play.dropped() > 0);
    }

    @Test
    public void ringDropsOldestWhenFull() {
        TwoTrack.Ring r = new TwoTrack.Ring(4);
        r.write(new short[] { 1, 2, 3, 4, 5, 6 }, 0, 6);
        short[] got = new short[4];
        assertEquals(4, r.read(got, 0, 4));
        assertEquals(3, got[0]);
        assertEquals(6, got[3]);
        assertEquals(2, r.dropped());
    }

    @Test
    public void busySpansPerChunkAndCarriedAcrossTheBoundary() throws Exception {
        TwoTrack.Busy b = new TwoTrack.Busy();
        b.start(1_000, TwoTrack.BUSY_SILENCED);
        b.start(1_500, TwoTrack.BUSY_SILENCED); // same reason: one span
        b.end(4_000);
        b.start(10_000, TwoTrack.BUSY_UNAVAILABLE); // still busy when the chunk ends
        JSONArray a = b.close(12_000);
        assertEquals(2, a.length());
        JSONObject first = a.getJSONObject(0);
        assertEquals(1_000, first.getLong("fromMs"));
        assertEquals(4_000, first.getLong("toMs"));
        assertEquals("silenced", first.getString("reason"));
        assertEquals(2_000, a.getJSONObject(1).getLong("toMs") - a.getJSONObject(1).getLong("fromMs"));
        assertEquals(5_000, TwoTrack.Busy.total(a));
        // the next chunk starts busy for the same reason, at 0
        assertTrue(b.open());
        assertEquals("unavailable", b.openReason());
        b.end(3_000);
        JSONArray next = b.close(30_000);
        assertEquals(1, next.length());
        assertEquals(0, next.getJSONObject(0).getLong("fromMs"));
        assertFalse(b.open());
        assertEquals(0, b.close(1).length());
    }

    @Test
    public void aFlappingMicKeepsTheIndexSmall() throws Exception {
        TwoTrack.Busy b = new TwoTrack.Busy();
        for (int i = 0; i < 500; i++) { b.start(i * 10L, TwoTrack.BUSY_SILENCED); b.end(i * 10L + 5); }
        JSONArray a = b.close(10_000);
        assertEquals(TwoTrack.Busy.MAX_SPANS, a.length());
        assertEquals(4_995, a.getJSONObject(a.length() - 1).getLong("toMs"));
    }

    @Test
    public void notificationLineAndTracks() throws Exception {
        assertEquals("mic off", TwoTrack.micLine(false, false));
        assertEquals("playback + mic", TwoTrack.micLine(true, false));
        assertEquals("mic busy: playback only", TwoTrack.micLine(true, true));
        assertEquals("mic", TwoTrack.tracks().getString("left"));
        assertEquals("playback", TwoTrack.tracks().getString("right"));
    }
}
