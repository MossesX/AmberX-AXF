package ai.amberx.droid;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

/** ListenerRules gives the same answers as framework/libs/listeners/core.ts on the shared cases.json (baked at src/axf/libs/listeners). */
public class ListenerRulesTest {
    private static JSONObject cases() throws Exception {
        Path rel = Paths.get("src", "axf", "libs", "listeners", "cases.json");
        Path dir = Paths.get("").toAbsolutePath();
        for (int i = 0; i < 6 && dir != null; i++, dir = dir.getParent()) {
            Path p = dir.resolve(rel);
            if (Files.exists(p)) return new JSONObject(new String(Files.readAllBytes(p), StandardCharsets.UTF_8));
        }
        throw new IllegalStateException("listeners cases.json not found");
    }

    private static ListenerRules.Policy policy(JSONObject c) { return ListenerRules.policy(c.optJSONObject("policy"), ""); }

    private static long want(JSONObject c) { return c.isNull("want") ? -1 : c.getLong("want"); }

    @Test
    public void defaultsMatchTheLibrary() throws Exception {
        JSONObject d = cases().getJSONObject("defaults");
        ListenerRules.Policy p = ListenerRules.defaults("");
        assertEquals(d.getInt("retries"), p.retries);
        assertEquals(d.getLong("backoffMs"), p.backoffMs);
        assertEquals(d.getLong("maxBackoffMs"), p.maxBackoffMs);
        assertEquals(d.getLong("cooldownMs"), p.cooldownMs);
        assertEquals(d.getBoolean("sound"), p.sound);
        assertEquals(d.getLong("quickEndMs"), ListenerRules.QUICK_END_MS);
        assertEquals(d.getLong("restartMs"), ListenerRules.RESTART_MS);
        assertTrue(ListenerRules.defaults(ListenerRules.VETO_ALARM).sound);
    }

    @Test
    public void restartDelayCases() throws Exception {
        JSONArray a = cases().getJSONArray("restartDelay");
        for (int i = 0; i < a.length(); i++) {
            JSONObject c = a.getJSONObject(i);
            assertEquals("case " + i, want(c), ListenerRules.restartDelay(c.getInt("attempt"), policy(c)));
        }
    }

    @Test
    public void afterEndCases() throws Exception {
        JSONArray a = cases().getJSONArray("afterEnd");
        for (int i = 0; i < a.length(); i++) {
            JSONObject c = a.getJSONObject(i);
            JSONObject w = c.getJSONObject("want");
            ListenerRules.EndPlan e = ListenerRules.afterEnd(c.getInt("attempts"), c.getLong("ranMs"), policy(c), c.optBoolean("fatal", false));
            assertEquals("case " + i + " attempts", w.getInt("attempts"), e.attempts);
            assertEquals("case " + i + " delay", w.isNull("delay") ? -1 : w.getLong("delay"), e.delay);
            assertEquals("case " + i + " gaveUp", w.getBoolean("gaveUp"), e.gaveUp);
            assertEquals("case " + i + " cooldown", w.getLong("cooldownMs"), e.cooldownMs);
        }
    }

    @Test
    public void startSoundCases() throws Exception {
        JSONArray a = cases().getJSONArray("startSound");
        for (int i = 0; i < a.length(); i++) {
            JSONObject c = a.getJSONObject(i);
            assertEquals("case " + i, c.getBoolean("want"), ListenerRules.startSound(policy(c), c.getString("reason")));
        }
    }

    @Test
    public void yieldReasonCases() throws Exception {
        JSONArray a = cases().getJSONArray("yieldReason");
        for (int i = 0; i < a.length(); i++) {
            JSONObject c = a.getJSONObject(i);
            JSONObject s = c.getJSONObject("scene");
            String got = ListenerRules.yieldReason(s.optBoolean("micOff"), s.optBoolean("call"), s.optBoolean("silenced"), s.optBoolean("otherApp"), s.optBoolean("focusLost"), policy(c));
            assertEquals("case " + i, c.isNull("want") ? null : c.getString("want"), got);
        }
    }

    @Test
    public void mayResumeCases() throws Exception {
        JSONArray a = cases().getJSONArray("mayResume");
        for (int i = 0; i < a.length(); i++) {
            JSONObject c = a.getJSONObject(i);
            assertEquals("case " + i, c.getBoolean("want"), ListenerRules.mayResume(c.getString("reason"), c.getLong("freeSince"), c.getLong("now")));
        }
    }

    @Test
    public void micWinnerCases() throws Exception {
        JSONArray a = cases().getJSONArray("micWinner");
        for (int i = 0; i < a.length(); i++) {
            JSONObject c = a.getJSONObject(i);
            List<String> asking = new ArrayList<>();
            JSONArray ids = c.getJSONArray("asking");
            for (int k = 0; k < ids.length(); k++) asking.add(ids.getString(k));
            assertEquals("case " + i, c.isNull("want") ? null : c.getString("want"), ListenerRules.micWinner(asking));
        }
        assertTrue(ListenerRules.outranks(ListenerRules.TALK, ListenerRules.HANDSFREE));
        assertTrue(ListenerRules.outranks(ListenerRules.SPEAK, null));
        assertFalse(ListenerRules.outranks(ListenerRules.HANDSFREE, ListenerRules.TALK));
        assertFalse(ListenerRules.outranks(ListenerRules.HANDSFREE, ListenerRules.HANDSFREE));
    }

    @Test
    public void yieldLabelCases() throws Exception {
        JSONArray a = cases().getJSONArray("yieldLabel");
        for (int i = 0; i < a.length(); i++) {
            JSONObject c = a.getJSONObject(i);
            assertEquals("case " + i, c.getString("want"), ListenerRules.yieldLabel(c.isNull("reason") ? null : c.getString("reason")));
        }
        // the same words MicRules has used since Nov 1 2026
        assertEquals(MicRules.label("call"), ListenerRules.yieldLabel("call"));
        assertEquals(MicRules.label(null), ListenerRules.yieldLabel(null));
    }

    @Test
    public void policyCoercesAndClamps() throws Exception {
        ListenerRules.Policy p = ListenerRules.policy(new JSONObject("{\"retries\":\"10\",\"backoffMs\":50,\"maxBackoffMs\":1,\"on\":\"false\",\"cooldownMs\":-5}"), "");
        assertEquals(10, p.retries);
        assertEquals(100, p.backoffMs);
        assertEquals(100, p.maxBackoffMs);
        assertFalse(p.on);
        assertEquals(0, p.cooldownMs);
        assertEquals(-1, ListenerRules.policy(new JSONObject("{\"retries\":-7}"), "").retries);
        assertEquals(6, ListenerRules.policy(new JSONObject("{\"retries\":\"x\"}"), "").retries);
        assertNull(ListenerRules.yieldReason(false, false, false, false, false, ListenerRules.defaults("")));
        JSONObject j = p.json();
        assertEquals(10, j.getInt("retries"));
        assertFalse(j.getBoolean("on"));
    }
}
