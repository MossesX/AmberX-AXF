package ai.amberx.axf.axhubandroid.hub

import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertTrue

class HubAddressTest {
    @Test fun onlyPlainHttpsHosts() {
        assertEquals("https://axhub.amberxai.com", HubAddress.normalize(" https://AXHUB.amberxai.com/ "))
        assertNull(HubAddress.normalize("http://axhub.amberxai.com"))
        assertNull(HubAddress.normalize("https://axhub.amberxai.com/evil"))
        assertNull(HubAddress.normalize("https://user@axhub.amberxai.com"))
        assertNull(HubAddress.normalize("https://axhub.amberxai.com?x=1"))
        assertNull(HubAddress.normalize("not a url"))
    }

    @Test fun approvalLinksOnlyForRealIds() {
        val base = HubAddress.DEFAULT
        assertEquals("$base/auth/admin/approvals/dfe44a5d-15ab-47bf-8128-9843d37cd6ec", HubAddress.approval(base, "dfe44a5d-15ab-47bf-8128-9843d37cd6ec"))
        assertNull(HubAddress.approval(base, "../../auth/logout"))
        assertTrue(HubAddress.isHub(base, "$base/auth/login"))
        assertFalse(HubAddress.isHub(base, "https://axhub.amberxai.com.evil.example/auth"))
        assertFalse(HubAddress.isHub(base, "http://axhub.amberxai.com/auth"))
    }

    @Test fun parsesTheFeed() {
        val ok = HubClient.parse("""{"signedIn":true,"admin":true,"count":1,"pending":[{"id":"dfe44a5d-15ab-47bf-8128-9843d37cd6ec","tool":"vps.run","summary":"vps.run with arguments …","createdAt":"a","expiresAt":"b"}]}""")
        assertIs<Feed.Ok>(ok); assertEquals("vps.run", ok.pending.single().tool)
        assertEquals(Feed.SignedOut, HubClient.parse("""{"signedIn":false}"""))
        assertEquals(Feed.NotAdmin, HubClient.parse("""{"signedIn":true,"admin":false}"""))
        assertIs<Feed.Error>(HubClient.parse("<html>"))
    }
}
