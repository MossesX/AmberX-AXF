package ai.amberx.consoleapp;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import org.junit.Test;

/**
 * The shell's own reading of axHub's approvals list, and the two things it is there for (Brett, Nov 23 2026): a held
 * command pops its card while another app is in front, and the badge clears as soon as nothing waits.
 */
public class ApprovalFeedRulesTest {
    static final String HUB = "https://axhub.amberxai.com";
    static final long NOW = 1_800_000_000_000L;
    static final String A = "dfe44a5d-15ab-47bf-8128-9843d37cd6ec", B = "0b6f3c2e-9a41-4d7e-8f10-2c3d4e5f6a7b", C = "7c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f";

    static String approval(String id, String extra) {
        return "{\"id\":\"" + id + "\",\"tool\":\"vps.run\",\"summary\":\"vps.run with arguments {}\",\"url\":\"" + HUB + "/auth/admin/approvals/" + id + "\"" + extra + "}";
    }

    static String held(String id, int secondsLeft, String veto) {
        return approval(id, ",\"status\":\"held\",\"title\":\"Restart the console\",\"jobId\":\"job-1\",\"veto\":{\"secondsLeft\":" + secondsLeft + ",\"countdownSeconds\":90" + veto + "}");
    }

    static String feed(String... pending) {
        return "{\"signedIn\":true,\"admin\":true,\"count\":" + pending.length + ",\"pending\":[" + String.join(",", pending) + "]}";
    }

    static ApprovalFeedRules.Result read(String body) { return ApprovalFeedRules.parse(HUB, 200, body, NOW); }

    /** The overlay's own bookkeeping, as {@code OverlayService.items} does it, without Android. */
    static final class Toolbar {
        final OverlayRules.Config config = new OverlayRules.Config();
        final Set<String> seen = new HashSet<>();
        List<OverlayRules.Item> items = new ArrayList<>();
        String state = OverlayRules.TOOLBAR;
        boolean expandedForCard;
        /** The hub id of the last card the overlay popped by itself. */
        String card;

        void reading(ApprovalFeedRules.Result r, boolean appInFront, long now) {
            items = OverlayRules.order(ApprovalFeedRules.after(items, r, now));
            OverlayRules.forget(seen, items);
            if (OverlayRules.EXPANDED.equals(state)) seen(); // the console is on screen
            OverlayRules.Item pops = OverlayRules.cardFor(config, items, seen);
            String next = OverlayRules.afterFeed(state, config, items, seen, appInFront);
            if (OverlayRules.foldsWhenClear(state, expandedForCard, items)) next = OverlayRules.TOOLBAR; // after FOLD_AFTER_MS
            if (OverlayRules.EXPANDED.equals(next) && !OverlayRules.EXPANDED.equals(state)) { expandedForCard = true; card = pops.ref(); }
            if (!OverlayRules.EXPANDED.equals(next)) expandedForCard = false;
            if (!OverlayRules.TOOLBAR.equals(next)) seen();
            state = next;
        }

        void seen() { for (OverlayRules.Item i : items) seen.add(i.id); }
        void collapse() { state = OverlayRules.TOOLBAR; expandedForCard = false; }
        String badge() { return OverlayRules.badge(items.size()); }
    }

    @Test public void statusOfAReply() {
        assertEquals("signed-out", ApprovalFeedRules.parse(HUB, 401, "", NOW).status);
        assertEquals("not-admin", ApprovalFeedRules.parse(HUB, 403, "", NOW).status);
        assertEquals("unreachable", ApprovalFeedRules.parse(HUB, 302, "", NOW).status); // a redirect is never followed
        assertEquals("unreachable", ApprovalFeedRules.parse(HUB, 500, "", NOW).status);
        assertEquals("unreachable", read("<html>").status);
        assertEquals("unreachable", read("[]").status);
        assertEquals("unreachable", read(null).status);
        assertEquals("signed-out", read("{\"signedIn\":false}").status);
        assertEquals("not-admin", read("{\"signedIn\":true,\"admin\":false}").status);
        ApprovalFeedRules.Result ok = read(feed());
        assertTrue(ok.ok());
        assertTrue(ok.items.isEmpty());
    }

    @Test public void heldCommandsAndApprovalsBecomeTheToolbarsItems() {
        List<OverlayRules.Item> items = read(feed(approval(A, ",\"title\":\"Delete the cache\""), held(B, 90, ""), approval(C, ""))).items;
        assertEquals(3, items.size());
        OverlayRules.Item h = items.get(0);
        assertEquals("held:" + B, h.id);
        assertEquals(B, h.ref());
        assertTrue(h.timed());
        assertEquals(NOW + 90_000, h.runsAt); // the countdown runs on the phone's clock from the seconds left
        assertEquals("Restart the console", h.title);
        assertEquals("approval:" + A, items.get(1).id);
        assertEquals("Delete the cache", items.get(1).title);
        assertEquals("Run vps.run", items.get(2).title);
        assertFalse(items.get(2).timed());
    }

    @Test public void heldTimingShelvedAndApprovedNow() {
        // runsAt alone gives the seconds left
        String byTime = approval(A, ",\"status\":\"held\",\"veto\":{\"runsAt\":\"" + java.time.Instant.ofEpochMilli(NOW + 30_000) + "\"}");
        assertEquals(NOW + 30_000, read(feed(byTime)).items.get(0).runsAt);
        // shelved: it waits for him, no clock
        OverlayRules.Item s = read(feed(held(A, 40, ",\"state\":\"shelved\""))).items.get(0);
        assertTrue(s.shelved);
        assertEquals(0, s.runsAt);
        // approved now: it runs, nothing waits (and it does not come back as an approval)
        assertTrue(read(feed(held(A, 40, ",\"approvedNow\":true"))).items.isEmpty());
        // the hub's separate held[] list counts too, once
        String body = "{\"signedIn\":true,\"admin\":true,\"pending\":[" + held(A, 10, "") + "],\"held\":[" + held(A, 10, "") + "," + held(B, 20, "") + "]}";
        assertEquals(2, read(body).items.size());
        // "held" without veto timing is a call waiting for an approval
        assertEquals("approval:" + A, read(feed(approval(A, ",\"status\":\"held\",\"veto\":{}"))).items.get(0).id);
    }

    @Test public void onlyRealIdsAndLinksOnTheHub() {
        assertTrue(read(feed(approval("../../auth/logout", ""))).items.isEmpty());
        assertTrue(read(feed(approval(A.toUpperCase(java.util.Locale.ROOT), ""))).items.isEmpty());
        String elsewhere = "{\"id\":\"" + A + "\",\"tool\":\"vps.run\",\"url\":\"https://evil.example/auth/admin/approvals/" + A + "\"}";
        assertTrue(read(feed(elsewhere)).items.isEmpty());
        assertTrue(read(feed("{\"id\":\"" + A + "\",\"tool\":\"vps.run\"}")).items.isEmpty()); // no link at all
        assertEquals(1, read(feed(approval(A, ""), approval(A, ""))).items.size()); // a repeated id counts once
        assertTrue(ApprovalFeedRules.isHub(HUB, HUB + ":443/auth/admin/approvals"));
        assertFalse(ApprovalFeedRules.isHub(HUB, "https://axhub.amberxai.com.evil.example/auth"));
        assertFalse(ApprovalFeedRules.isHub(HUB, "https://user@axhub.amberxai.com/auth"));
        assertFalse(ApprovalFeedRules.isHub(HUB, "http://axhub.amberxai.com/auth"));
        assertFalse(ApprovalFeedRules.isHub(HUB, "https://axhub.amberxai.com:8443/auth"));
        assertFalse(ApprovalFeedRules.isHub(HUB, null));
        // a held entry with a link off the hub is dropped, not shown as something to decide
        assertTrue(read(feed(held(A, 30, "").replace("\"jobId\"", "\"denyUrl\":\"https://evil.example/deny\",\"jobId\""))).items.isEmpty());
    }

    @Test public void aHeldCommandPopsItsCardWhileAnotherAppIsInFront() {
        Toolbar t = new Toolbar();
        t.reading(read(feed()), false, NOW);
        assertEquals(OverlayRules.TOOLBAR, t.state);
        assertNull(t.card);
        // axHub holds two calls on a 90 s veto; the console app is in the background
        t.reading(read(feed(held(A, 90, ""), held(B, 88, ""))), false, NOW);
        assertEquals("the card pops by itself, without a tap on the toolbar", OverlayRules.EXPANDED, t.state);
        assertEquals("the one that runs first", B, t.card);
        assertEquals("2", t.badge());
        assertEquals("{\"target\":\"approvals.view\",\"id\":\"" + B + "\"}", OverlayContract.openJson(t.card));
        // he folds it without deciding: the same two don't pop again, the badge still counts them
        t.collapse();
        t.reading(read(feed(held(A, 80, ""), held(B, 78, ""))), false, NOW + 10_000);
        assertEquals(OverlayRules.TOOLBAR, t.state);
        assertEquals("2", t.badge());
        // a third call is new: it pops
        t.reading(read(feed(held(A, 70, ""), held(B, 68, ""), approval(C, ""))), false, NOW + 20_000);
        assertEquals(OverlayRules.EXPANDED, t.state);
        assertEquals(C, t.card);
    }

    @Test public void theExpandSettingDecidesWhatPops() {
        Toolbar t = new Toolbar();
        t.config.expand = "held";
        t.reading(read(feed(approval(A, ""))), false, NOW);
        assertEquals(OverlayRules.TOOLBAR, t.state);
        assertEquals("1", t.badge());
        t.reading(read(feed(approval(A, ""), held(B, 60, ""))), false, NOW);
        assertEquals(OverlayRules.EXPANDED, t.state);
        Toolbar never = new Toolbar();
        never.config.expand = "never";
        never.reading(read(feed(held(B, 60, ""))), false, NOW);
        assertEquals(OverlayRules.TOOLBAR, never.state);
        assertEquals("1", never.badge());
    }

    @Test public void withTheAppInFrontThePageShowsTheCardAndTheBarOpens() {
        Toolbar t = new Toolbar();
        t.reading(read(feed(held(A, 90, ""))), true, NOW);
        assertEquals(OverlayRules.APPROVALS, t.state);
        assertNull(t.card);
        // he leaves the app with it still waiting: it was shown, so it does not take the screen over
        t.reading(read(feed(held(A, 80, ""))), false, NOW + 10_000);
        assertEquals(OverlayRules.APPROVALS, t.state);
    }

    @Test public void theBadgeClearsOnceTheyAreDecidedOrHaveRun() {
        Toolbar t = new Toolbar();
        t.reading(read(feed(held(A, 90, ""), held(B, 90, ""))), false, NOW);
        assertEquals("2", t.badge());
        // one is approved in the browser: the next reading has one
        t.reading(read(feed(held(B, 85, ""))), false, NOW + 5_000);
        assertEquals("1", t.badge());
        assertEquals(OverlayRules.EXPANDED, t.state);
        // the other runs by itself after its veto: the hub's list is empty, the badge is gone, the overlay folds back
        t.reading(read(feed()), false, NOW + 91_000);
        assertEquals("", t.badge());
        assertTrue(t.items.isEmpty());
        assertEquals(OverlayRules.TOOLBAR, t.state);
        assertEquals("", OverlayRules.toolbarLabel(t.config, t.items, NOW + 91_000));
    }

    @Test public void anOverlayHeOpenedHimselfIsNeverFolded() {
        Toolbar t = new Toolbar();
        t.reading(read(feed(held(A, 90, ""))), false, NOW);
        t.collapse();
        t.state = OverlayRules.EXPANDED; // his tap on the toolbar
        t.reading(read(feed()), false, NOW + 5_000);
        assertEquals(OverlayRules.EXPANDED, t.state);
        assertEquals("", t.badge());
    }

    @Test public void withoutTheHubARunOutCountdownStillClears() {
        Toolbar t = new Toolbar();
        t.reading(read(feed(held(A, 90, ""), approval(B, ""))), false, NOW);
        t.collapse();
        ApprovalFeedRules.Result down = ApprovalFeedRules.parse(HUB, 502, "", NOW);
        // unreachable mid-countdown: what was read stays
        t.reading(down, false, NOW + 60_000);
        assertEquals("2", t.badge());
        // the countdown is over and the grace has passed: the held command has run; the approval still waits
        t.reading(down, false, NOW + 90_000 + OverlayRules.RAN_GRACE_MS + 1);
        assertEquals("1", t.badge());
        assertEquals("approval:" + B, t.items.get(0).id);
        // signed out of the hub: the same rule, nothing is invented and nothing new pops
        t.reading(ApprovalFeedRules.parse(HUB, 401, "", NOW), false, NOW + 200_000);
        assertEquals("1", t.badge());
        assertEquals(OverlayRules.TOOLBAR, t.state);
    }

    @Test public void readsQuicklyWhileSomethingWaits() {
        assertEquals(ApprovalFeedRules.POLL_WAITING_MS, ApprovalFeedRules.pollMs(2, true));
        assertEquals(ApprovalFeedRules.POLL_WAITING_MS, ApprovalFeedRules.pollMs(1, false));
        assertEquals(ApprovalFeedRules.POLL_IDLE_MS, ApprovalFeedRules.pollMs(0, true));
        assertEquals(ApprovalFeedRules.POLL_SCREEN_OFF_MS, ApprovalFeedRules.pollMs(0, false));
        assertEquals("/auth/admin/approvals.json", ApprovalFeedRules.FEED_PATH);
    }
}
