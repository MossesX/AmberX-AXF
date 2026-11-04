package ai.amberx.droid;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.util.List;
import org.junit.Test;

/** The native hub rules agree with lib-hub (framework/libs/hub/hub.ts) and the AXHub app's AutoApprove. */
public class HubRulesTest {
    private static final String HUB = "https://axhub.amberxai.com";
    private static final String ID = "0123abcd-0123-0123-0123-0123456789ab";

    @Test public void hubAddresses() {
        assertEquals(HUB, HubRules.normalize("https://AXHUB.amberxai.com/x?y"));
        assertNull(HubRules.normalize("http://axhub.amberxai.com"));
        assertNull(HubRules.normalize("https://user@axhub.amberxai.com"));
        assertTrue(HubRules.isHub(HUB, HUB + "/auth/login"));
        assertFalse(HubRules.isHub(HUB, "https://axhub.amberxai.com.evil.example/"));
    }

    @Test public void writesOnlyToTheDataServer() {
        assertTrue(HubRules.isDataPath(HUB, HUB + "/data/shared/settings/appearance.json"));
        assertFalse(HubRules.isDataPath(HUB, HUB + "/auth/admin/approvals"));
        assertFalse(HubRules.isDataPath(HUB, HUB + "/data/../auth/x"));
        assertFalse(HubRules.isDataPath(HUB, "https://evil.example/data/x"));
    }

    @Test public void approvalPagesAreRebuilt() {
        assertEquals(HUB + "/auth/admin/approvals/" + ID, HubRules.approvalUrl(HUB, ID));
        assertNull(HubRules.approvalUrl(HUB, "../../etc"));
    }

    @Test public void feed() {
        String body = "{\"count\":3,\"pending\":[{\"id\":\"" + ID + "\",\"tool\":\"vps.run\",\"summary\":\"ls\",\"url\":\"" + HUB + "/x\"},"
            + "{\"id\":\"" + ID + "\",\"tool\":\"dup\",\"url\":\"" + HUB + "/x\"},{\"id\":\"bad\",\"url\":\"" + HUB + "\"},"
            + "{\"id\":\"1123abcd-0123-0123-0123-0123456789ab\",\"url\":\"https://evil.example/\"}]}";
        HubRules.Feed f = HubRules.interpret(HUB, 200, body);
        assertEquals("ok", f.status);
        assertEquals(1, f.pending.size());
        assertEquals(3, f.count);
        assertEquals("vps.run", f.pending.get(0).tool);
        assertEquals("signed-out", HubRules.interpret(HUB, 401, "").status);
        assertEquals("not-admin", HubRules.interpret(HUB, 403, "").status);
        assertEquals("unreachable", HubRules.interpret(HUB, 200, "nope").status);
        assertEquals("signed-out", HubRules.interpret(HUB, 200, "{\"signedIn\":false}").status);
    }

    @Test public void autoApproval() {
        List<String> p = HubRules.patterns("vps.logs, github.*;\n*x");
        assertEquals(3, p.size());
        assertTrue(HubRules.matches(p, "github.pr"));
        assertFalse(HubRules.matches(p, "github"));
        assertTrue(HubRules.autoApproves(false, true, "", "vps.logs"));
        assertFalse(HubRules.autoApproves(false, true, "", "vps.run"));
        assertTrue(HubRules.autoApproves(true, false, "vps.run", "vps.run"));
        assertFalse(HubRules.autoApproves(false, false, "*", "github.pr"));
        assertTrue(HubRules.approvedReply(200, "{\"ok\":true,\"result\":\"approved\",\"message\":\"Approved.\"}"));
        assertFalse(HubRules.approvedReply(200, "{\"ok\":true,\"result\":\"rejected\"}"));
        assertFalse(HubRules.approvedReply(409, "{\"error\":{\"code\":\"decided\"}}"));
        assertFalse(HubRules.approvedReply(303, "/auth/admin/approvals/x?ok=approved"));
        assertEquals("abcdefgh1234", HubRules.csrfFromSession("{\"signedIn\":true,\"csrf\":\"abcdefgh1234\"}"));
        assertNull(HubRules.csrfFromSession("{\"signedIn\":false}"));
        assertNull(HubRules.csrfFromSession("{\"signedIn\":true,\"csrf\":\"<script>\"}"));
        assertEquals("https://axhub.amberxai.com/auth/api/approvals/0123abcd-0123-4567-89ab-0123456789ab",
            HubRules.approvalApiUrl("https://axhub.amberxai.com", "0123abcd-0123-4567-89ab-0123456789ab"));
        assertNull(HubRules.approvalApiUrl("https://axhub.amberxai.com", "../x"));
    }

    @Test public void consoleAlerts() {
        String body = "{\"alerts\":[{\"key\":\"ci:main\",\"severity\":\"error\",\"title\":\"CI failed\",\"body\":\"android\",\"lastAt\":5},"
            + "{\"key\":\"ci:main\",\"severity\":\"error\",\"lastAt\":6},"
            + "{\"key\":\"deploy\",\"severity\":\"info\",\"lastAt\":1},"
            + "{\"key\":\"sys:disk\",\"severity\":\"warning\",\"resolved\":true},"
            + "{\"key\":\"\",\"severity\":\"error\"}]}";
        HubRules.Alerts a = HubRules.consoleAlerts(200, body);
        assertEquals(1, a.open.size());
        assertEquals("ci:main@5", a.open.get(0).stamp);
        assertEquals("CI failed", a.open.get(0).title);
        assertTrue(a.closed.contains("sys:disk"));
        assertNull(HubRules.consoleAlerts(302, ""));
        assertNull(HubRules.consoleAlerts(200, "<html>sign in</html>"));
    }

    @Test public void heldVetoCalls() {
        String held = "{\"id\":\"" + ID + "\",\"tool\":\"vps.run\",\"status\":\"held\",\"url\":\"" + HUB + "/auth/admin/approvals/" + ID + "\","
            + "\"summary\":\"vps.run with arguments {\\\"command\\\":\\\"uptime\\\"}\",\"jobId\":\"job_1\",\"reason\":{\"title\":\"Check uptime\"},"
            + "\"veto\":{\"runsAt\":\"2026-10-29T02:03:00.000Z\",\"secondsLeft\":180,\"countdownSeconds\":180},"
            + "\"denyUrl\":\"" + HUB + "/auth/api/approvals/" + ID + "/deny\"}";
        String body = "{\"count\":1,\"pending\":[" + held + "],\"held\":[" + held + "],\"heldCount\":1}";
        assertEquals(0, HubRules.interpret(HUB, 200, body).pending.size()); // never an approval, never auto-approved
        List<HubRules.Veto> v = HubRules.vetoes(HUB, body, 1000L);
        assertEquals(1, v.size());
        assertEquals("uptime", v.get(0).command);
        assertEquals("Check uptime", v.get(0).title);
        assertEquals(181_000L, v.get(0).runsAtLocal());
        assertEquals(HUB + "/auth/api/approvals/" + ID + "/deny", HubRules.vetoDenyUrl(HUB, ID));
        assertNull(HubRules.vetoDenyUrl(HUB, "../x"));
        assertEquals("held", HubRules.vetoPhase(31));
        assertEquals("warning", HubRules.vetoPhase(30));
        assertEquals("running", HubRules.vetoPhase(0));
        assertEquals(0, HubRules.vetoes(HUB, body.replace(HUB + "/auth/api", "https://evil.example/auth/api"), 0L).size());
        // decision 104: a hub before it sends no actions = Deny only
        assertEquals(java.util.Collections.singletonList("deny"), v.get(0).actions);
        assertFalse(v.get(0).shelved);
    }

    @Test
    public void vetoApproveNowAndShelve() {
        String held = "{\"id\":\"" + ID + "\",\"status\":\"held\",\"tool\":\"vps.run\",\"title\":\"Restart\","
            + "\"veto\":{\"state\":\"shelved\",\"runsAt\":\"2026-10-29T02:03:00.000Z\",\"secondsLeft\":80,\"actions\":[\"approve-now\",\"deny\"]},"
            + "\"approveNowUrl\":\"" + HUB + "/auth/api/approvals/" + ID + "/approve-now\"}";
        List<HubRules.Veto> v = HubRules.vetoes(HUB, "{\"held\":[" + held + "]}", 0L);
        assertEquals(1, v.size());
        assertTrue(v.get(0).shelved);
        assertEquals(java.util.Arrays.asList("deny", "approve-now"), v.get(0).actions);
        assertTrue(v.get(0).can("approve-now"));
        assertFalse(v.get(0).can("shelve"));
        assertEquals(HUB + "/auth/api/approvals/" + ID + "/approve-now", HubRules.vetoActionUrl(HUB, ID, "approve-now"));
        assertEquals(HUB + "/auth/api/approvals/" + ID + "/shelve", HubRules.vetoActionUrl(HUB, ID, "shelve"));
        assertNull(HubRules.vetoActionUrl(HUB, ID, "approve"));
        assertEquals(0, HubRules.vetoes(HUB, "{\"held\":[" + held.replace(HUB + "/auth/api", "https://evil.example/auth/api") + "]}", 0L).size());
    }
}
