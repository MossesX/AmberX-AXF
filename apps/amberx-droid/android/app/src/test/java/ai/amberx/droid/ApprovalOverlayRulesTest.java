package ai.amberx.droid;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import org.json.JSONObject;
import org.junit.Test;

/** The approval overlay's settings, list, toolbar label and when the card opens. */
public class ApprovalOverlayRulesTest {
    private static final long NOW = 1_000_000L;
    private static final String A = "11111111-1111-1111-1111-111111111111", B = "22222222-2222-2222-2222-222222222222",
        C = "33333333-3333-3333-3333-333333333333";

    private static HubRules.Veto held(String id, int left, boolean shelved) {
        HubRules.Veto v = new HubRules.Veto(id, null, "vps.run", "Restart the console", "systemctl restart axf", "", left, NOW, shelved, false,
            Arrays.asList("deny", "approve-now", "shelve"));
        v.why = "The console stopped answering.";
        return v;
    }

    private static HubRules.Approval approval(String id) { return new HubRules.Approval(id, "files.write", "Write notes.md", ""); }

    @Test public void defaultsAndClamps() throws Exception {
        ApprovalOverlayRules.Settings d = ApprovalOverlayRules.settings(null);
        assertTrue(d.on);
        assertEquals("end", d.edge);
        assertEquals("small", d.size);
        assertEquals("every", d.expand);
        assertEquals("next", d.show);
        assertEquals(30, d.top);
        ApprovalOverlayRules.Settings s = ApprovalOverlayRules.settings(new JSONObject()
            .put("edge", "start").put("top", 400).put("size", "huge").put("expand", "held").put("idleOpacity", 5).put("shrinkAfterSec", -3));
        assertEquals("start", s.edge);
        assertEquals(90, s.top);
        assertEquals("small", s.size);
        assertEquals("held", s.expand);
        assertEquals(40, s.idleOpacity);
        assertEquals(0, s.shrinkAfterSec);
    }

    @Test public void mergeKeepsOtherSettingsAndIgnoresUnknownKeys() throws Exception {
        JSONObject cur = new JSONObject().put("size", "large").put("edge", "start");
        ApprovalOverlayRules.Settings s = ApprovalOverlayRules.merge(cur, new JSONObject().put("on", false).put("bogus", 1));
        assertFalse(s.on);
        assertEquals("large", s.size);
        assertEquals("start", s.edge);
        assertFalse(s.toJson().has("bogus"));
    }

    @Test public void itemsSoonestFirstThenShelvedThenApprovals() {
        List<ApprovalOverlayRules.Item> items = ApprovalOverlayRules.items(
            Arrays.asList(held(A, 80, false), held(B, 20, false), held(C, 50, true)), Collections.singletonList(approval("44444444-4444-4444-4444-444444444444")));
        assertEquals(B, items.get(0).id);
        assertEquals(A, items.get(1).id);
        assertEquals(C, items.get(2).id);
        assertEquals("approval", items.get(3).kind);
        // Approve first; a shelved call can't be shelved again.
        assertEquals(Arrays.asList("approve-now", "deny", "shelve"), items.get(0).actions);
        assertEquals(Arrays.asList("approve-now", "deny"), items.get(2).actions);
        assertEquals(Arrays.asList("approve", "decline"), items.get(3).actions);
        assertEquals("systemctl restart axf", items.get(0).what);
        assertEquals("The console stopped answering.", items.get(0).why);
    }

    @Test public void approvedNowCallsAreLeftOut() {
        HubRules.Veto done = new HubRules.Veto(A, null, "vps.run", "t", "ls", "", 50, NOW, false, true, Collections.singletonList("deny"));
        assertTrue(ApprovalOverlayRules.items(Collections.singletonList(done), null).isEmpty());
    }

    @Test public void toolbarLabel() {
        ApprovalOverlayRules.Settings next = ApprovalOverlayRules.settings(null);
        assertEquals("No approvals", ApprovalOverlayRules.toolbarLabel(next, Collections.emptyList(), NOW));
        List<ApprovalOverlayRules.Item> items = ApprovalOverlayRules.items(Arrays.asList(held(A, 75, false), held(B, 200, false)), null);
        assertEquals("Runs in 1:15 · +1", ApprovalOverlayRules.toolbarLabel(next, items, NOW));
        ApprovalOverlayRules.Settings count = ApprovalOverlayRules.settings(json("show", "count"));
        assertEquals("2 waiting", ApprovalOverlayRules.toolbarLabel(count, items, NOW));
        List<ApprovalOverlayRules.Item> only = ApprovalOverlayRules.items(null, Collections.singletonList(approval(A)));
        assertEquals("1 waiting", ApprovalOverlayRules.toolbarLabel(next, only, NOW));
    }

    @Test public void countdownLine() {
        ApprovalOverlayRules.Item it = ApprovalOverlayRules.items(Collections.singletonList(held(A, 9, false)), null).get(0);
        assertEquals("Runs in 0:09 unless you stop it", ApprovalOverlayRules.countdown(it, NOW));
        assertEquals("Running now", ApprovalOverlayRules.countdown(it, NOW + 10_000));
        ApprovalOverlayRules.Item ap = ApprovalOverlayRules.fromApproval(approval(B));
        assertEquals("Waiting for your approval", ApprovalOverlayRules.countdown(ap, NOW));
    }

    @Test public void expandsOnlyForNewArrivalsTheSettingAllows() {
        List<ApprovalOverlayRules.Item> items = ApprovalOverlayRules.items(Collections.singletonList(held(A, 60, false)), Collections.singletonList(approval(B)));
        ApprovalOverlayRules.Settings every = ApprovalOverlayRules.settings(null);
        assertTrue(ApprovalOverlayRules.shouldExpand(every, items, new HashSet<>()));
        assertFalse(ApprovalOverlayRules.shouldExpand(every, items, new HashSet<>(Arrays.asList(A, B))));
        ApprovalOverlayRules.Settings heldOnly = ApprovalOverlayRules.settings(json("expand", "held"));
        assertFalse(ApprovalOverlayRules.shouldExpand(heldOnly, items, new HashSet<>(Collections.singletonList(A))));
        assertTrue(ApprovalOverlayRules.shouldExpand(heldOnly, items, new HashSet<>(Collections.singletonList(B))));
        ApprovalOverlayRules.Settings never = ApprovalOverlayRules.settings(json("expand", "never"));
        assertFalse(ApprovalOverlayRules.shouldExpand(never, items, new HashSet<>()));
    }

    private static JSONObject json(String k, String v) {
        try { return new JSONObject().put(k, v); } catch (Exception e) { throw new IllegalStateException(e); }
    }
}
