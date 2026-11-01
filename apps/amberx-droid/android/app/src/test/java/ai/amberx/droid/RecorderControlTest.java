package ai.amberx.droid;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import java.util.TimeZone;
import org.json.JSONObject;
import org.junit.Test;

/** Recordings started from axHub (axHub decision #108): part names, the session a start sets, never auto-approved. */
public class RecorderControlTest {
    private static final TimeZone NY = TimeZone.getTimeZone("America/New_York");
    // 2026-11-01 14:05 UTC = 09:05 in New York (EST from 06:00 UTC that day)
    private static final long T = 1793541900000L;

    @Test
    public void partNames() {
        assertEquals("axHub build - 2026-11-01 14-05 - part1", RecorderControl.partName("axHub build", T, 1, TimeZone.getTimeZone("UTC")));
        assertEquals("axHub build - 2026-11-01 09-05 - part3", RecorderControl.partName("axHub build", T, 3, NY));
        assertEquals("a b c - 2026-11-01 14-05 - part1", RecorderControl.partName("a/b:c", T, 0, TimeZone.getTimeZone("UTC")));
        assertEquals("Session - 2026-11-01 14-05 - part2", RecorderControl.partName("  ", T, 2, TimeZone.getTimeZone("UTC")));
        String longName = new String(new char[200]).replace('\0', 'x');
        assertTrue(RecorderControl.partName(longName, T, 1, NY).startsWith(longName.substring(0, 80) + " - "));
    }

    @Test
    public void sessionFromStart() throws Exception {
        RecorderControl.Session s = RecorderControl.sessionOf(new JSONObject().put("session_name", "Build\nnight").put("note", "rec"));
        assertEquals("Build night", s.name);
        assertEquals("Build night", s.group); // group defaults to the session name
        assertEquals("rec", s.note);
        assertEquals("Work", RecorderControl.sessionOf(new JSONObject().put("session_name", "x").put("group", "Work")).group);
        try { RecorderControl.sessionOf(new JSONObject()); fail(); } catch (IllegalArgumentException expected) { /* session_name required */ }
        try { RecorderControl.sessionOf(new JSONObject().put("session_name", " ")); fail(); } catch (IllegalArgumentException expected) { /* empty */ }
    }

    @Test
    public void commands() {
        assertTrue(RecorderControl.known("recorder.start"));
        assertTrue(RecorderControl.known("recorder.stop"));
        assertTrue(RecorderControl.known("recorder.status"));
        assertFalse(RecorderControl.known("recorder.mic"));
    }

    @Test
    public void startingARecordingIsNeverAutoApproved() {
        assertFalse(HubRules.autoApproves(true, true, "*", "amberx.recorder_start"));
        assertFalse(HubRules.autoApproves(true, false, "amberx.recorder_start", "amberx.recorder_start"));
        assertFalse(HubRules.autoApproves(true, false, "amberx.*", "amberx.recorder_start"));
        assertTrue(HubRules.autoApproves(false, true, "", "amberx.recorder_stop"));
    }
}
