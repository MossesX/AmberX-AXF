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
        assertTrue(HubRules.approvedReply(303, "/auth/admin/approvals/x?ok=approved"));
        assertFalse(HubRules.approvedReply(303, "/x?ok=approved&err=1"));
        assertEquals("tok", HubRules.csrfFromPage("<input name=\"csrf\" value=\"tok\">"));
    }
}
