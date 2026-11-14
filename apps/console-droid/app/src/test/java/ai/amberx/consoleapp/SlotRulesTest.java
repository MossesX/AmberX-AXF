package ai.amberx.consoleapp;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import java.util.List;
import org.json.JSONObject;
import org.junit.Test;

/** Four console slots in one app (part 3, s6). */
public class SlotRulesTest {
    private static JSONObject args(Object... kv) throws Exception {
        JSONObject o = new JSONObject();
        for (int i = 0; i < kv.length; i += 2) o.put((String) kv[i], kv[i + 1]);
        return o;
    }

    @Test public void startsWithTheMainConsole() {
        SlotRules.State s = SlotRules.State.initial();
        assertEquals(1, s.count());
        assertEquals(1, s.focused);
        assertEquals(ShellRules.HOME, s.urls[0]);
        assertEquals("single", SlotRules.layout(s.count()));
    }

    @Test public void opensUpToFourAndTheNewOneTakesFocus() throws Exception {
        SlotRules.State s = SlotRules.State.initial();
        s = SlotRules.open(s, args("target", "settings"));
        assertEquals(2, s.count());
        assertEquals(2, s.focused);
        assertTrue(s.urls[1].contains("settings"));
        assertEquals("split", SlotRules.layout(s.count()));
        s = SlotRules.open(s, args("target", "panel:phone-bridge"));
        s = SlotRules.open(s, args("target", "plugin:notes/open", "focus", false));
        assertEquals(4, s.count());
        assertEquals(3, s.focused);
        assertEquals("grid", SlotRules.layout(s.count()));
        try { SlotRules.open(s, args("target", "settings")); fail("a fifth slot"); }
        catch (IllegalArgumentException expected) { /* all four are open */ }
        // replacing a slot is fine
        s = SlotRules.open(s, args("target", "settings", "slot", 4));
        assertEquals(4, s.count());
    }

    @Test public void badInputIsRefused() throws Exception {
        SlotRules.State s = SlotRules.State.initial();
        for (Object bad : new Object[] { 0, 5, "x" }) {
            try { SlotRules.open(s, args("slot", bad)); fail("slot " + bad); }
            catch (IllegalArgumentException expected) { /* 1-4 only */ }
        }
        try { SlotRules.open(s, args("target", "javascript:alert(1)")); fail("bad target"); }
        catch (IllegalArgumentException expected) { /* not a console address */ }
        try { SlotRules.open(s, args("url", "https://example.com/")); fail("outside page"); }
        catch (IllegalArgumentException expected) { /* only Brett's sites */ }
        // no target and no url: the console's home
        assertEquals(ShellRules.HOME, SlotRules.open(s, new JSONObject()).urls[1]);
    }

    @Test public void slotOneStaysAndClosingMovesFocus() throws Exception {
        SlotRules.State s = SlotRules.open(SlotRules.State.initial(), args("target", "settings"));
        try { SlotRules.close(s, args("slot", 1)); fail("slot 1 closed"); }
        catch (IllegalArgumentException expected) { /* the main console stays */ }
        s = SlotRules.close(s, args("slot", 2));
        assertEquals(1, s.count());
        assertEquals(1, s.focused);
        assertEquals(s, SlotRules.close(s, args("slot", 3)));
    }

    @Test public void focusAndTheMic() throws Exception {
        SlotRules.State s = SlotRules.open(SlotRules.State.initial(), args("target", "settings"));
        s = SlotRules.focus(s, args("slot", "1"));
        assertTrue(SlotRules.micAllowed(s, 1));
        assertFalse(SlotRules.micAllowed(s, 2));
        try { SlotRules.focus(s, args("slot", 3)); fail("closed slot focused"); }
        catch (IllegalArgumentException expected) { /* not open */ }
    }

    @Test public void framesFollowTheCountAndOrientation() throws Exception {
        SlotRules.State one = SlotRules.State.initial();
        assertArrayEquals(new int[] { 1, 0, 0, 1000, 2000 }, SlotRules.frames(one, 1000, 2000).get(0));
        SlotRules.State two = SlotRules.open(one, args("target", "settings"));
        List<int[]> portrait = SlotRules.frames(two, 1000, 2000);
        assertArrayEquals(new int[] { 2, 0, 1000, 1000, 2000 }, portrait.get(1));
        List<int[]> landscape = SlotRules.frames(two, 2000, 1000);
        assertArrayEquals(new int[] { 2, 1000, 0, 2000, 1000 }, landscape.get(1));
        SlotRules.State three = SlotRules.open(two, args("target", "settings"));
        List<int[]> grid = SlotRules.frames(three, 1000, 2000);
        assertEquals(3, grid.size());
        assertArrayEquals(new int[] { 3, 0, 1000, 500, 2000 }, grid.get(2));
    }

    @Test public void statusAndSavedStateRoundTrip() throws Exception {
        SlotRules.State s = SlotRules.open(SlotRules.State.initial(), args("target", "settings"));
        JSONObject st = SlotRules.status(s);
        assertEquals(4, st.getInt("max"));
        assertEquals(2, st.getInt("count"));
        assertEquals("split", st.getString("layout"));
        assertEquals(4, st.getJSONArray("slots").length());
        assertFalse(st.getJSONArray("slots").getJSONObject(2).getBoolean("open"));
        SlotRules.State back = SlotRules.decode(SlotRules.encode(s));
        assertArrayEquals(s.urls, back.urls);
        assertEquals(s.focused, back.focused);
        assertEquals(1, SlotRules.decode("not json").count());
        assertEquals(1, SlotRules.decode("{\"urls\":[\"https://example.com/\",\"https://example.com/\"],\"focused\":2}").count());
    }
}
