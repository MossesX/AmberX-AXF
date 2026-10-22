package ai.amberx.axf.kernel

import ai.amberx.axf.kernel.asset.parseJsonObject
import ai.amberx.axf.kernel.mcp.Mcp
import ai.amberx.axf.kernel.mcp.McpEngine
import ai.amberx.axf.kernel.mcp.McpPermissionSet
import ai.amberx.axf.kernel.mcp.McpToolEffect
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals

/** Replays spec/fixtures/mcp-client.json (generated from core/engines/mcp.ts) against McpEngine. Written without a compiler. */
class McpConformanceTest {
    private val f: JsonObject = File("../../spec/fixtures/mcp-client.json").readText().parseJsonObject()!!

    private fun str(o: JsonObject, k: String): String? = (o[k] as? JsonPrimitive)?.takeIf { it !is JsonNull }?.content
    private fun strings(e: JsonElement?) = (e as? JsonArray)?.map { it.jsonPrimitive.content } ?: emptyList()
    private fun bool(o: JsonObject, k: String) = o.getValue(k).jsonPrimitive.content.toBoolean()
    private fun int(o: JsonObject, k: String) = o.getValue(k).jsonPrimitive.content.toInt()
    private fun wireJson(w: ai.amberx.axf.kernel.interop.WireError): JsonObject = w.toJson()

    @Test fun `constants and initialize match`() {
        assertEquals(str(f, "version"), Mcp.PROTOCOL_VERSION)
        assertEquals(strings(f["supported"]), Mcp.SUPPORTED_VERSIONS)
        assertEquals(str(f, "sessionHeader"), Mcp.SESSION_HEADER)
        assertEquals(str(f, "versionHeader"), Mcp.VERSION_HEADER)
        val p = f.getValue("permissions").jsonObject
        assertEquals(str(p, "MANAGE"), Mcp.Permissions.MANAGE); assertEquals(str(p, "CALL"), Mcp.Permissions.CALL)
        assertEquals(str(p, "WRITE"), Mcp.Permissions.WRITE); assertEquals(str(p, "DESTRUCTIVE"), Mcp.Permissions.DESTRUCTIVE)
        assertEquals(f.getValue("initialize"), McpEngine.initializeParams())
        val reqs = f.getValue("requests").jsonArray
        assertEquals(reqs[0], McpEngine.request(1, "tools/list"))
        assertEquals(reqs[1], McpEngine.request(JsonPrimitive("x"), "tools/call", buildJsonObject { put("name", "t"); put("arguments", buildJsonObject { put("a", 1) }) }))
        assertEquals(reqs[2], McpEngine.notification("notifications/initialized"))
        assertEquals(reqs[3], McpEngine.notification("notifications/cancelled", buildJsonObject { put("requestId", 3); put("reason", "user") }))
    }

    @Test fun `messages parse the same`() {
        for (c in f.getValue("messages").jsonArray.map { it.jsonObject }) {
            assertEquals(c.getValue("parsed").jsonArray.toList(), McpEngine.parseMessages(str(c, "text")!!).map { it.toJson() }, str(c, "text"))
        }
    }

    @Test fun `sse parses the same`() {
        for (c in f.getValue("sse").jsonArray.map { it.jsonObject }) {
            assertEquals(c.getValue("events").jsonArray.toList(), McpEngine.parseSse(str(c, "text")!!).map { it.toJson() }, str(c, "text"))
        }
        val ch = f.getValue("sseChunked").jsonObject
        val p = McpEngine.SseParser()
        val events = strings(ch["chunks"]).flatMap { p.feed(it) } + p.end()
        assertEquals(ch.getValue("events").jsonArray.toList(), events.map { it.toJson() })
    }

    @Test fun `headers, responses, negotiation, offers`() {
        for (c in f.getValue("headers").jsonArray.map { it.jsonObject }) {
            val o = c.getValue("options").jsonObject
            val got = McpEngine.headers(str(o, "sessionId"), str(o, "protocolVersion"), str(o, "method") ?: "POST")
            assertEquals(c.getValue("headers").jsonObject.mapValues { it.value.jsonPrimitive.content }, got, o.toString())
        }
        for (c in f.getValue("responses").jsonArray.map { it.jsonObject }) {
            assertEquals(str(c, "kind"), McpEngine.classifyResponse(int(c, "status"), str(c, "contentType"), bool(c, "hadSession")).id, c.toString())
        }
        for (c in f.getValue("negotiate").jsonArray.map { it.jsonObject }) {
            val exp = c.getValue("outcome").jsonObject
            val (ok, err) = McpEngine.negotiate(c["result"])
            if (bool(exp, "ok")) {
                assertEquals(str(exp, "protocolVersion"), ok!!.protocolVersion)
                assertEquals(exp.getValue("capabilities"), ok.capabilities)
                assertEquals(exp["serverInfo"]?.takeIf { it !is JsonNull }, ok.serverInfo)
                assertEquals(str(exp, "instructions"), ok.instructions)
            } else assertEquals(exp.getValue("error"), wireJson(err!!))
        }
        for (c in f.getValue("offers").jsonArray.map { it.jsonObject }) {
            val caps = c["capabilities"] as? JsonObject
            for (k in listOf("tools", "resources", "prompts", "logging")) assertEquals(bool(c, k), McpEngine.offers(caps, k), "$caps $k")
        }
    }

    @Test fun `pagination`() {
        for (c in f.getValue("pageParams").jsonArray.map { it.jsonObject }) assertEquals(c["params"]?.takeIf { it !is JsonNull }, McpEngine.pageParams(str(c, "cursor")))
        for (c in f.getValue("pages").jsonArray.map { it.jsonObject }) {
            val pages = c.getValue("pages").jsonArray.map { p -> strings(p.jsonObject["items"]) to str(p.jsonObject, "nextCursor") }
            val exp = c.getValue("merged").jsonObject
            val got = McpEngine.mergePages(pages, int(c, "maxPages"))
            assertEquals(strings(exp["items"]), got.items); assertEquals(strings(exp["cursors"]), got.cursors)
            assertEquals(bool(exp, "truncated"), got.truncated); assertEquals(bool(exp, "loop"), got.loop)
        }
    }

    @Test fun `errors map to the same wire codes`() {
        for (c in f.getValue("rpcErrors").jsonArray.map { it.jsonObject }) {
            val e = c.getValue("error").jsonObject
            assertEquals(c.getValue("wire"), wireJson(McpEngine.errorFromRpc(e.getValue("code").jsonPrimitive.content.toLong(), str(e, "message") ?: "")))
        }
        for (c in f.getValue("httpErrors").jsonArray.map { it.jsonObject }) assertEquals(c.getValue("wire"), wireJson(McpEngine.errorFromHttp(int(c, "status"))), c.toString())
        for (c in f.getValue("transportErrors").jsonArray.map { it.jsonObject }) assertEquals(c.getValue("wire"), wireJson(McpEngine.errorFromTransport(str(c, "kind")!!, str(c, "message")!!)))
    }

    @Test fun `effects and the call gate`() {
        for (c in f.getValue("effects").jsonArray.map { it.jsonObject }) assertEquals(str(c, "effect"), McpEngine.toolEffect(c["annotations"] as? JsonObject, bool(c, "strict")).id, c.toString())
        for (c in f.getValue("gates").jsonArray.map { it.jsonObject }) {
            val exp = c.getValue("gate").jsonObject
            val got = McpEngine.callGate(McpToolEffect.entries.first { it.id == str(c, "effect") }, strings(c["granted"]).toSet())
            assertEquals(bool(exp, "allowed"), got.allowed, c.toString()); assertEquals(str(exp, "requires"), got.requires)
            assertEquals(bool(exp, "confirm"), got.confirm); assertEquals(str(exp, "effect"), got.effect.id)
            assertEquals(exp["error"], got.error?.let { wireJson(it) })
        }
    }

    @Test fun `mapped permission sets gate the same`() {
        for (c in f.getValue("mappedGates").jsonArray.map { it.jsonObject }) {
            val p = c.getValue("perms").jsonObject
            val perms = McpPermissionSet(str(p, "MANAGE")!!, str(p, "CALL")!!, str(p, "WRITE")!!, str(p, "DESTRUCTIVE")!!)
            val exp = c.getValue("gate").jsonObject
            val got = McpEngine.callGate(McpToolEffect.entries.first { it.id == str(c, "effect") }, strings(c["granted"]).toSet(), perms)
            assertEquals(bool(exp, "allowed"), got.allowed, c.toString()); assertEquals(str(exp, "requires"), got.requires)
            assertEquals(exp["error"], got.error?.let { wireJson(it) })
        }
    }

    @Test fun `content text, server ids, validation, skeletons`() {
        for (c in f.getValue("contentText").jsonArray.map { it.jsonObject }) assertEquals(str(c, "text"), McpEngine.contentText(c["content"] as? JsonArray))
        for (c in f.getValue("serverIds").jsonArray.map { it.jsonObject }) assertEquals(str(c, "id"), McpEngine.serverIdFor(str(c, "name")!!, strings(c["taken"])))
        for (c in f.getValue("validate").jsonArray.map { it.jsonObject }) {
            val i = c.getValue("input").jsonObject
            assertEquals(strings(c["problems"]), McpEngine.validateServerInput(str(i, "id"), str(i, "name"), str(i, "url"), str(i, "tokenEnv")), i.toString())
        }
        for (c in f.getValue("skeletons").jsonArray.map { it.jsonObject }) assertEquals(c.getValue("args"), McpEngine.argumentSkeleton(c["schema"] as? JsonObject), c.toString())
    }
}
