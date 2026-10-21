package ai.amberx.axf.mcp

import ai.amberx.axf.kernel.mcp.McpException
import ai.amberx.axf.kernel.platform.MemoryKeyValueStore
import ai.amberx.axf.kernel.platform.SecureStore
import ai.amberx.axf.kernel.result.AxfResult
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.concurrent.TimeUnit

/**
 * lib-mcp against a MockWebServer speaking Streamable HTTP: session id, version header, pagination, SSE tool call,
 * forgotten session (404 → re-initialize once), rpc + http errors, bearer header from the credential provider,
 * redirects refused, DELETE on close; and the registry keeping tokens out of records. Written without a compiler.
 */
class McpClientTest {
    private class Fake : Dispatcher() {
        var inits = 0
        var forget = false
        var mode = "ok"
        val seen = ArrayList<RecordedRequest>()
        private fun json(body: String, vararg headers: Pair<String, String>) = MockResponse().setResponseCode(200).setHeader("Content-Type", "application/json").setBody(body).also { r -> headers.forEach { (k, v) -> r.setHeader(k, v) } }
        override fun dispatch(request: RecordedRequest): MockResponse {
            seen.add(request)
            if (request.method == "DELETE") return MockResponse().setResponseCode(200)
            if (mode == "redirect") return MockResponse().setResponseCode(302).setHeader("Location", "https://evil.example/mcp")
            if (mode.startsWith("http:")) return MockResponse().setResponseCode(mode.substring(5).toInt())
            val body = request.body.readUtf8()
            val m = ai.amberx.axf.kernel.asset.AxfJson.parseToJsonElement(body) as JsonObject
            val method = (m["method"] as? JsonPrimitive)?.content
            val id = m["id"]?.toString() ?: "null"
            fun res(r: String, vararg h: Pair<String, String>) = json("""{"jsonrpc":"2.0","id":$id,"result":$r}""", *h)
            return when (method) {
                "initialize" -> { inits++; res("""{"protocolVersion":"${if (mode == "badversion") "2030-01-01" else "2025-06-18"}","capabilities":{"tools":{},"resources":{},"prompts":{}},"serverInfo":{"name":"fake","version":"1"},"instructions":"hi"}""", "Mcp-Session-Id" to "S$inits") }
                "notifications/initialized", "notifications/cancelled" -> MockResponse().setResponseCode(202)
                else -> {
                    if (forget && request.getHeader("mcp-session-id") == "S1") return MockResponse().setResponseCode(404).setBody("gone")
                    when (method) {
                        "tools/list" -> if (body.contains("cursor")) res("""{"tools":[{"name":"b","annotations":{"destructiveHint":true}}]}""") else res("""{"tools":[{"name":"a","annotations":{"readOnlyHint":true}}],"nextCursor":"p2"}""")
                        "resources/list" -> res("""{"resources":[{"uri":"file:///x","name":"x"}]}""")
                        "resources/templates/list" -> res("""{"resourceTemplates":[]}""")
                        "prompts/list" -> res("""{"prompts":[{"name":"p"}]}""")
                        "tools/call" -> MockResponse().setResponseCode(200).setHeader("Content-Type", "text/event-stream").setBody(
                            "event: message\ndata: {\"jsonrpc\":\"2.0\",\"method\":\"notifications/progress\",\"params\":{\"progress\":0.5}}\n\n" +
                                "event: message\ndata: {\"jsonrpc\":\"2.0\",\"id\":$id,\"result\":{\"content\":[{\"type\":\"text\",\"text\":\"done\"}],\"structuredContent\":{\"ok\":1}}}\n\n")
                        "resources/read" -> res("""{"contents":[{"uri":"file:///x","text":"body"}]}""")
                        "prompts/get" -> res("""{"description":"d","messages":[{"role":"user","content":{"type":"text","text":"hello"}}]}""")
                        else -> json("""{"jsonrpc":"2.0","id":$id,"error":{"code":-32601,"message":"nope"}}""")
                    }
                }
            }
        }
    }

    private fun client(server: MockWebServer, fake: Fake, timeoutMs: Long = 5000, notes: MutableList<String>? = null): McpClient {
        val t = OkHttpMcpTransport(OkHttpClient.Builder().readTimeout(2, TimeUnit.SECONDS).build()) { sid -> "Bearer tok-$sid" }
        return McpClient("s", server.url("/mcp").toString(), t, timeoutMs, onNotification = { m, _ -> notes?.add(m) })
    }

    @Test fun `happy path over Streamable HTTP`() = runBlocking {
        val fake = Fake(); val server = MockWebServer().apply { dispatcher = fake; start() }
        try {
            val notes = ArrayList<String>()
            val c = client(server, fake, notes = notes)
            val conn = c.connect()
            assertEquals("S1", conn.session.sessionId)
            assertEquals("2025-06-18", conn.session.protocolVersion)
            assertEquals(listOf("a", "b"), conn.tools.map { it.name })
            assertEquals(1, conn.resources.size); assertEquals(1, conn.prompts.size)
            assertNull(fake.seen[0].getHeader("mcp-session-id"))
            assertEquals("Bearer tok-s", fake.seen[0].getHeader("Authorization"))
            assertEquals("S1", fake.seen[1].getHeader("mcp-session-id"))
            assertEquals("2025-06-18", fake.seen[1].getHeader("mcp-protocol-version"))
            val r = c.callTool("t", buildJsonObject { put("a", 1) })
            assertFalse(r.isError); assertEquals("done", ai.amberx.axf.kernel.mcp.McpEngine.contentText(r.content))
            assertEquals(listOf("notifications/progress"), notes)
            assertEquals("body", (c.readResource("file:///x")[0]["text"] as JsonPrimitive).content)
            assertEquals(1, (c.getPrompt("p")["messages"] as kotlinx.serialization.json.JsonArray).size)
            val err = runCatching { c.ping() }.exceptionOrNull() as McpException
            assertEquals("not_found", err.code)
            fake.forget = true
            assertEquals(listOf("a", "b"), c.listTools().items.map { it.name })
            assertEquals(2, fake.inits); assertEquals("S2", c.sessionId)
            fake.forget = false
            c.close()
            assertEquals("DELETE", fake.seen.last().method); assertEquals("S2", fake.seen.last().getHeader("mcp-session-id"))
            assertFalse(c.connected)
        } finally { server.shutdown() }
    }

    @Test fun `errors keep their wire codes`() = runBlocking {
        val fake = Fake(); val server = MockWebServer().apply { dispatcher = fake; start() }
        try {
            fake.mode = "badversion"; assertEquals("invalid", (runCatching { client(server, fake).initialize() }.exceptionOrNull() as McpException).code)
            for ((status, code) in listOf(401 to "denied", 404 to "not_found", 503 to "unavailable", 418 to "invalid")) { fake.mode = "http:$status"; assertEquals(code, (runCatching { client(server, fake).initialize() }.exceptionOrNull() as McpException).code) }
            fake.mode = "redirect"; assertEquals("invalid", (runCatching { client(server, fake).initialize() }.exceptionOrNull() as McpException).code)
            fake.mode = "ok"
            server.shutdown()
            val e = runCatching { client(server, fake, timeoutMs = 1500).initialize() }.exceptionOrNull() as McpException
            assertTrue(e.code == "unavailable" || e.code == "timeout")
        } finally { runCatching { server.shutdown() } }
    }

    private class MemSecure : SecureStore {
        val m = HashMap<String, String>()
        override suspend fun get(key: String): AxfResult<String?> = AxfResult.ok(m[key])
        override suspend fun put(key: String, value: String): AxfResult<Unit> { m[key] = value; return AxfResult.ok(Unit) }
        override suspend fun remove(key: String): AxfResult<Unit> { m.remove(key); return AxfResult.ok(Unit) }
    }

    @Test fun `registry keeps tokens in the secure store only`() = runBlocking {
        val kv = MemoryKeyValueStore(); val sec = MemSecure()
        val reg = McpServerRegistry(kv, sec) { 1000L }
        val s = (reg.save(null, "axHub", "https://hub/mcp", token = "sEcReT-1") as AxfResult.Ok).value
        assertEquals("axhub", s.id); assertTrue(s.hasToken)
        assertFalse(kv.get(McpServerRegistry.KEY)!!.contains("sEcReT-1"))
        assertEquals("Bearer sEcReT-1", reg.credentials.authorization("axhub"))
        assertEquals("axhub-2", (reg.save(null, "axHub", "https://hub/mcp") as AxfResult.Ok).value.id)
        assertTrue((reg.save("axhub", "axHub", "https://hub/mcp", token = null) as AxfResult.Ok).value.hasToken)
        assertFalse((reg.save("axhub", "axHub", "https://hub/mcp", token = "") as AxfResult.Ok).value.hasToken)
        assertNull(reg.credentials.authorization("axhub"))
        assertTrue(reg.save(null, "", "ftp://x") is AxfResult.Err)
        reg.remove("axhub"); assertNull(reg.get("axhub")); assertNull(sec.m[McpServerRegistry.tokenKey("axhub")])
    }
}
