package ai.amberx.droid;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.nio.ByteBuffer;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONObject;
import org.junit.Test;

/** Live audio (live-audio@1, Nov 4 2026): frames@1, the shared clock, backpressure, the link answer and what it does. */
public class LiveRulesTest {
    private static LiveRules.Frame f(int track, long seq, long at, int len) { return new LiveRules.Frame(track, seq, at, new byte[len]); }

    @Test
    public void framesAreTheConsolesLayout() {
        List<LiveRules.Frame> l = new ArrayList<>();
        l.add(new LiveRules.Frame(LiveRules.MIC, 1, 1000, new byte[] { (byte) 0xF8, 1, 2, 3 }));
        l.add(new LiveRules.Frame(LiveRules.TTS, 0xFFFFFFFFL, 1_800_000_000_000L, new byte[] { 9 }));
        byte[] b = LiveRules.encode(l);
        // matches live_audio.py encode([(0, 1, 1000, b"\xf8\x01\x02\x03"), (1, 4294967295, 1800000000000, b"\x09")])
        assertArrayEquals(new byte[] { 'A', 'X', 'L', 'A', 1 }, java.util.Arrays.copyOf(b, 5));
        ByteBuffer r = ByteBuffer.wrap(b, 5, b.length - 5);
        assertEquals(0, r.get());
        assertEquals(1, r.getInt());
        assertEquals(1000, r.getLong());
        assertEquals(4, r.getShort());
        r.position(r.position() + 4);
        assertEquals(1, r.get());
        assertEquals(-1, r.getInt()); // u32 max
        assertEquals(1_800_000_000_000L, r.getLong());
        assertEquals(1, r.getShort());
        assertEquals(9, r.get());
        assertFalse(r.hasRemaining());
    }

    @Test
    public void onlyAmberxLiveSessionRoutes() {
        assertEquals("https://amberx.amberxai.com/api/console/plugins/live-sessions/sessions/chat%3Aamber-voice/audio/frames?stream=s-abc",
            LiveRules.framesUrl("chat:amber-voice", "s-abc"));
        assertTrue(LiveRules.allowed(LiveRules.linkUrl()));
        assertFalse(LiveRules.allowed("https://evil.example/api/console/plugins/live-sessions/audio/link"));
        assertFalse(LiveRules.allowed("https://amberx.amberxai.com/api/console/plugins/other/x"));
        assertFalse(LiveRules.allowed("https://amberx.amberxai.com/api/console/plugins/live-sessions/../../x"));
        try { LiveRules.framesUrl("bad/id", "s"); assertTrue(false); } catch (IllegalArgumentException expected) { /* refused */ }
        try { LiveRules.framesUrl("ok", "s&x=1"); assertTrue(false); } catch (IllegalArgumentException expected) { /* refused */ }
    }

    @Test
    public void sharedClock() {
        // sent at 1000, back at 1100 on the phone; the console said 5050 → the console is 3,999 ms ahead
        assertEquals(3_999, LiveRules.clockOffset(1000, 1100, 5049));
        assertEquals(10, LiveRules.betterOffset(99, 300, 10, 120));   // quicker round trip wins
        assertEquals(99, LiveRules.betterOffset(99, 100, 10, 900));   // a slow one doesn't
        assertEquals(10, LiveRules.betterOffset(0, -1, 10, 900));     // the first one always does
        assertEquals(1_000 + 500 + 20, LiveRules.frameAt(1_000, 500, 960)); // 960 samples = 20 ms
        assertFalse(LiveRules.reanchor(10_000, 10_200));
        assertTrue(LiveRules.reanchor(10_000, 10_400));
    }

    @Test
    public void backpressureDropsTheOldestAndRetriesResume() throws InterruptedException {
        LiveRules.Queue q = new LiveRules.Queue(4);
        for (int i = 0; i < 6; i++) q.add(f(0, i, i * 20, 100));
        assertEquals(4, q.size());
        assertEquals(2, q.dropped());
        List<LiveRules.Frame> b = q.take(5 + 2 * 115, 0); // room for two frames
        assertEquals(2, b.size());
        assertEquals(2, b.get(0).seq); // oldest kept first
        q.putBack(b);                   // the send failed: same frames go next
        assertEquals(2, q.take(64 * 1024, 0).get(0).seq);
        assertTrue(q.take(64 * 1024, 0).isEmpty());
        assertEquals(0, LiveRules.sendBackoff(0));
        assertEquals(500, LiveRules.sendBackoff(1));
        assertEquals(5_000, LiveRules.sendBackoff(9));
    }

    private static LiveRules.Answer answer(String json) throws Exception { return new LiveRules.Answer(new JSONObject(json)); }

    @Test
    public void linkAnswerDecides() throws Exception {
        LiveRules.Answer listen = answer("{\"session\":{\"id\":\"chat:v\",\"title\":\"Amber voice\"},\"stream\":true,\"watchers\":[\"Brett\"],\"voiceWatchers\":1,"
            + "\"notice\":{\"watched\":true,\"text\":\"You're being watched by Brett (with voice)\"},\"serverNow\":5,\"batchMs\":200,\"kbps\":24,\"known\":\"x\"}");
        assertTrue(listen.stream);
        assertEquals("chat:v", listen.session);
        assertEquals(LiveRules.Action.STREAM, LiveRules.action(listen, true, false, 0, 100));
        assertEquals(LiveRules.Action.ASK_CONSENT, LiveRules.action(listen, false, false, 0, 100));
        assertEquals("Brett is listening live: Amber voice", LiveRules.watchedLine(listen));

        LiveRules.Answer gone = answer("{\"session\":{\"id\":\"chat:v\"},\"stream\":false,\"watchers\":[],\"notice\":{\"watched\":false}}");
        assertEquals("", LiveRules.watchedLine(gone));
        assertEquals(LiveRules.Action.IDLE, LiveRules.action(gone, true, true, 1_000, 1_000 + LiveRules.LIVE_ONLY_GRACE_MS - 1));
        assertEquals(LiveRules.Action.STOP_RECORDER, LiveRules.action(gone, true, true, 1_000, 1_000 + LiveRules.LIVE_ONLY_GRACE_MS));
        assertEquals(LiveRules.Action.IDLE, LiveRules.action(gone, true, false, 1_000, 999_999)); // Brett's own recording never stops
        // recording on (no listener): it streams into the recording, but never asks for consent on its own
        LiveRules.Answer rec = answer("{\"session\":{\"id\":\"chat:v\"},\"stream\":true,\"voiceWatchers\":0}");
        assertEquals(LiveRules.Action.IDLE, LiveRules.action(rec, false, false, 0, 1));
        LiveRules.Answer watchOnly = answer("{\"session\":{\"id\":\"chat:v\"},\"stream\":false,\"watchers\":[\"Brett\"],\"notice\":{\"watched\":true}}");
        assertEquals("Brett is watching this session", LiveRules.watchedLine(watchOnly));
        // nonsense in, safe out
        LiveRules.Answer none = LiveRules.Answer.none();
        assertFalse(none.stream);
        assertEquals(200, none.batchMs);
        assertFalse(answer("{\"stream\":true}").stream); // no session, no stream
        assertEquals(1000, answer("{\"batchMs\":99999}").batchMs);
    }

    @Test
    public void linkBodyIsWhatTheConsoleReads() throws Exception {
        JSONObject b = LiveRules.linkBody("amberx-0123456789abcdef", "Galaxy S26", true, true, "Amber voice", false, 10, 2, 300, "sig", 25, 7);
        assertEquals("amberx-0123456789abcdef", b.getString("device"));
        assertEquals("Amber voice", b.getString("recSession"));
        assertEquals(25, b.getInt("wait"));
        assertEquals(2, b.getJSONObject("stats").getLong("dropped"));
    }
}
