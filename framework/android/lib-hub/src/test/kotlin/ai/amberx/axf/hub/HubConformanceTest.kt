package ai.amberx.axf.hub

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.File
import java.io.IOException
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Replays framework/spec/fixtures/hub-approvals.json (generated from framework/libs/hub/hub.ts) against [HubRules]: the web
 * port and this library must agree on address rules, URLs, feed parsing, status mapping and seen ids. Written without a
 * compiler (CI runs :lib-hub:testDebugUnitTest).
 */
class HubConformanceTest {
    private val f: JsonObject = Json.parseToJsonElement(File("../../spec/fixtures/hub-approvals.json").readText()).jsonObject

    private fun arr(k: String): List<JsonObject> = f.getValue(k).jsonArray.map { it.jsonObject }
    private fun s(o: JsonObject, k: String): String? = (o[k] as? JsonPrimitive)?.takeIf { it !is JsonNull }?.content
    private fun strings(e: JsonElement?): List<String> = (e as? JsonArray)?.map { it.jsonPrimitive.content } ?: emptyList()

    private fun feedJson(feed: HubFeed): Map<String, Any?> = mapOf(
        "status" to feed.status.id, "count" to feed.count, "approvalsUrl" to feed.approvalsUrl, "error" to feed.error,
        "pending" to feed.pending.map { mapOf("id" to it.id, "tool" to it.tool, "summary" to it.summary, "createdAt" to it.createdAt, "expiresAt" to it.expiresAt, "url" to it.url) },
    )
    private fun expectedFeed(o: JsonObject): Map<String, Any?> = mapOf(
        "status" to s(o, "status"), "count" to o.getValue("count").jsonPrimitive.int, "approvalsUrl" to s(o, "approvalsUrl"), "error" to s(o, "error"),
        "pending" to o.getValue("pending").jsonArray.map { e -> val p = e.jsonObject; mapOf("id" to s(p, "id"), "tool" to s(p, "tool"), "summary" to s(p, "summary"), "createdAt" to s(p, "createdAt"), "expiresAt" to s(p, "expiresAt"), "url" to s(p, "url")) },
    )

    @Test fun constantsMatchTheWebPort() {
        assertEquals(s(f, "default"), HubRules.DEFAULT)
        val p = f.getValue("paths").jsonObject
        assertEquals(listOf(s(p, "feed"), s(p, "approvals"), s(p, "login"), s(p, "account"), s(p, "logout"), s(p, "apps")),
            listOf(HubRules.PATH_FEED, HubRules.PATH_APPROVALS, HubRules.PATH_LOGIN, HubRules.PATH_ACCOUNT, HubRules.PATH_LOGOUT, HubRules.PATH_APPS))
        val l = f.getValue("limits").jsonObject
        val caps = l.getValue("fieldCaps").jsonObject
        assertEquals(listOf(l.getValue("feedMaxBytes").jsonPrimitive.int, l.getValue("feedMaxItems").jsonPrimitive.int, l.getValue("seenCap").jsonPrimitive.int,
            caps.getValue("tool").jsonPrimitive.int, caps.getValue("summary").jsonPrimitive.int, caps.getValue("time").jsonPrimitive.int),
            listOf(HubRules.FEED_MAX_BYTES, HubRules.FEED_MAX_ITEMS, HubRules.SEEN_CAP, HubRules.CAP_TOOL, HubRules.CAP_SUMMARY, HubRules.CAP_TIME))
        assertEquals(strings(f["statuses"]), HubFeedStatus.entries.map { it.id })
        val m = f.getValue("messages").jsonObject
        assertEquals(listOf(s(m, "answered"), s(m, "unexpected"), s(m, "tooLarge"), s(m, "unreachable")),
            listOf(HubRules.MSG_ANSWERED, HubRules.MSG_UNEXPECTED, HubRules.MSG_TOO_LARGE, HubRules.MSG_UNREACHABLE))
    }

    @Test fun addressRules() {
        for (c in arr("normalize")) assertEquals(s(c, "hub"), HubRules.normalize(s(c, "raw")), "normalize ${s(c, "raw")}")
        for (c in arr("origin")) assertEquals(s(c, "origin"), HubRules.origin(s(c, "url")), "origin ${s(c, "url")}")
        for (c in arr("isHub")) assertEquals(c.getValue("isHub").jsonPrimitive.content.toBoolean(), HubRules.isHub(s(c, "base"), s(c, "url")), "isHub ${s(c, "url")}")
    }

    @Test fun hubUrls() {
        val u = f.getValue("urls").jsonObject
        val b = s(u, "base")!!
        assertEquals(listOf(s(u, "approvals"), s(u, "apps"), s(u, "account"), s(u, "logout"), s(u, "feed"), s(u, "login")),
            listOf(HubRules.approvalsUrl(b), HubRules.appsUrl(b), HubRules.accountUrl(b), HubRules.logoutUrl(b), HubRules.feedUrl(b), HubRules.loginUrl(b)))
        for (c in arr("approval")) assertEquals(s(c, "url"), HubRules.approvalUrl(s(c, "base")!!, s(c, "id")), "approval ${s(c, "id")}")
        for (c in arr("login")) assertEquals(s(c, "url"), HubRules.loginUrl(s(c, "base")!!, s(c, "path")!!), "login ${s(c, "path")}")
        for (c in arr("apk")) assertEquals(s(c, "name"), HubRules.apkDownloadName(s(c, "base")!!, s(c, "url")), "apk ${s(c, "url")}")
        for (c in arr("csrf")) assertEquals(s(c, "token"), HubRules.csrfFromPage(s(c, "html")), "csrf ${s(c, "html")}")
    }

    @Test fun feedParsingAndStatusMapping() {
        for (c in arr("feeds")) {
            val got = HubRules.interpretFeed(s(c, "base")!!, c.getValue("status").jsonPrimitive.int, s(c, "body")!!)
            assertEquals(expectedFeed(c.getValue("feed").jsonObject), feedJson(got), "feed ${s(c, "name")}")
        }
        val u = f.getValue("unreachable").jsonObject
        assertEquals(expectedFeed(u.getValue("feed").jsonObject), feedJson(HubRules.unreachable(s(u, "base")!!, s(u, "error")!!)))
    }

    @Test fun seenIds() {
        for (c in arr("seen")) {
            val plan = HubRules.seenPlan(strings(c["seen"]), strings(c["current"]))
            val want = c.getValue("plan").jsonObject
            assertEquals(Triple(strings(want["fresh"]), strings(want["gone"]), strings(want["next"])), Triple(plan.fresh, plan.gone, plan.next), "seen ${strings(c["current"])}")
        }
    }

    @Test fun sizeCappedReader() {
        assertEquals("abc", HubClient.readLimited(ByteArrayInputStream("abc".toByteArray()), 3))
        assertFailsWith<IOException> { HubClient.readLimited(ByteArrayInputStream(ByteArray(HubRules.FEED_MAX_BYTES + 1)), HubRules.FEED_MAX_BYTES) }
    }

    @Test fun placeholdersAreNamed() {
        assertTrue(HubRules.PLACEHOLDERS.any { it.first == "axf.hub.axpp" })
        assertEquals(HubRules.PLACEHOLDERS.size, HubModule.placeholders().size)
        assertNull(HubRules.normalize("https://axhub.amberxai.com/auth"))
    }
}
