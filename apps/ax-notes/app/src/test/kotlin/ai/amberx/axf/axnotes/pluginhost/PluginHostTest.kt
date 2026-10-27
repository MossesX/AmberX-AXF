package ai.amberx.axf.axnotes.pluginhost

import ai.amberx.axf.kernel.ai.AiModePolicy
import ai.amberx.axf.kernel.ai.AiModes
import ai.amberx.axf.kernel.ai.AiRequestInput
import ai.amberx.axf.kernel.ai.AiSessionClient
import ai.amberx.axf.kernel.ai.AiSessionRequest
import ai.amberx.axf.kernel.ai.PlaceholderAiSessionClient
import ai.amberx.axf.kernel.assistant.ChatContext
import ai.amberx.axf.kernel.engine.ActionContext
import ai.amberx.axf.kernel.live.LiveDetach
import ai.amberx.axf.kernel.live.LiveEvent
import ai.amberx.axf.kernel.live.LiveReplay
import ai.amberx.axf.kernel.live.LiveSessionInfo
import ai.amberx.axf.kernel.live.LiveState
import ai.amberx.axf.kernel.result.AxfFailure
import ai.amberx.axf.kernel.result.AxfResult
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class PluginHostTest {
    @Test fun parsesInstalledPlugins() {
        val text = """{"${'$'}axf":"axnotes-plugins@1","installed":[
            {"id":"ai.amberx.axf.axnotes.plugins.example","folder":"example","entry":"ai.amberx.axf.axnotes.plugins.example.ExampleModule"},
            {"id":"ai.amberx.axf.axnotes.plugins.example","folder":"dup","entry":"ai.amberx.axf.axnotes.plugins.x.X"},
            {"id":"evil.plugin","folder":"evil","entry":"java.lang.Runtime"},
            {"id":"a.b","folder":"../up","entry":"ai.amberx.axf.axnotes.plugins.x.X"},
            {"id":"a.b","folder":"ok"}
        ]}"""
        assertEquals(listOf("example"), PluginList.parse(text).map { it.folder })
        assertTrue(PluginList.parse("{\"${'$'}axf\":\"other@1\",\"installed\":[]}").isEmpty())
        assertTrue(PluginList.parse("not json").isEmpty())
        assertTrue(PluginList.parse("""{"${'$'}axf":"axnotes-plugins@1","installed":[]}""").isEmpty())
    }

    @Test fun shippedPluginListParses() {
        val f = listOf("src/main/assets/axnotes/plugins.json", "app/src/main/assets/axnotes/plugins.json").map(::File).firstOrNull { it.exists() } ?: return
        val entries = PluginList.parse(f.readText())
        for (e in entries) assertTrue("${e.folder} listed but its folder is missing", listOf("../plugins/${e.folder}", "plugins/${e.folder}").any { File(it, "plugin.json").exists() })
    }

    @Test fun removedFootprintsArePurged() {
        val a = PluginFootprint("x.a", "a", PluginList.DATA_PREFIX + "a", listOf("app.a.one"))
        val b = PluginFootprint("x.b", "b", PluginList.DATA_PREFIX + "b")
        assertEquals(listOf(b), PluginList.removed(listOf(a, b), listOf(PluginEntry("x.a", "a", "ai.amberx.axf.axnotes.plugins.a.A"))))
        assertEquals(a, PluginFootprint.parse(a.toJson()))
        // a footprint can never point outside the plugins' data area or delete non-plugin settings
        assertNull(PluginFootprint.parse(a.copy(dataModule = "ai.amberx.axf.axnotes").toJson()))
        assertEquals(emptyList<String>(), PluginFootprint.parse(a.copy(settingKeys = listOf("axnotes.hub")).toJson())!!.settingKeys)
    }

    @Test fun extractsJsonFromReplies() {
        assertEquals("1", ReplyJson.extract("{\"a\":1}")!!["a"].toString())
        assertEquals("\"x}\"", ReplyJson.extract("Sure:\n```json\n{\"a\":\"x}\",\"b\":{\"c\":2}}\n```\nDone {not json}")!!["a"].toString())
        assertEquals("2", ReplyJson.extract("{oops} then {\"b\":2}")!!["b"].toString())
        assertNull(ReplyJson.extract("no json here"))
        assertNull(ReplyJson.extract("{\"a\":"))
    }

    @Test fun hashesAreStable() {
        assertEquals("cbf29ce484222325", Hashes.fnv64(""))
        assertEquals(Hashes.fnv64("abc"), Hashes.fnv64("abc"))
        assertEquals(16, Hashes.fnv64("ünïcode").length)
    }

    @Test fun actionArgsMergeEverySource() {
        val ctx = ActionContext("{\"period\":\"weekly\"}", mapOf("args" to JsonObject(mapOf("file" to JsonPrimitive("readme"), "line" to JsonPrimitive(12)))))
        val a = ActionArgs.of(listOf("daily"), ctx)
        assertEquals("daily", ActionArgs.str(a, "0"))
        assertEquals("weekly", ActionArgs.str(a, "period", "0"))
        assertEquals("readme", ActionArgs.str(a, "file"))
        assertEquals(12, ActionArgs.int(a, "line"))
        assertNull(ActionArgs.str(ActionArgs.of(emptyList(), null), "x"))
    }

    // ---------------------------------------------------------------- AiAsk over a fake session client

    private class FakeClient(val events: List<List<LiveEvent>>, val up: Boolean = true) : AiSessionClient {
        var started: AiSessionRequest? = null
        var closed = false
        var stopped = false
        private var call = 0
        override val host = "fake"
        override suspend fun available() = up
        override suspend fun start(request: AiSessionRequest): AxfResult<LiveSessionInfo> { started = request; return AxfResult.ok(LiveSessionInfo("s1", request.sessionKind, request.title, LiveState.RUNNING, host, 0, 0, 0)) }
        override suspend fun attach(id: String, after: Long, onEvent: (LiveEvent) -> Unit, onReplay: (LiveReplay) -> Unit): AxfResult<LiveDetach> = AxfResult.err(AxfFailure.NotImplemented("x"))
        override suspend fun send(id: String, prompt: String, context: ChatContext?): AxfResult<Unit> = AxfResult.ok(Unit)
        override suspend fun stream(id: String, after: Long, max: Int): AxfResult<LiveReplay> {
            val e = events.getOrElse(call++) { emptyList() }.filter { it.seq > after }
            return AxfResult.ok(LiveReplay(e, e.lastOrNull()?.seq ?: after, gap = false, reset = false, more = false))
        }
        override suspend fun stop(id: String): AxfResult<Unit> { stopped = true; return AxfResult.ok(Unit) }
        override suspend fun close(id: String): AxfResult<Unit> { closed = true; return AxfResult.ok(Unit) }
        override suspend fun list(): AxfResult<List<LiveSessionInfo>> = AxfResult.ok(emptyList())
    }

    private fun text(seq: Long, s: String) = LiveEvent(seq, seq, "text", JsonObject(mapOf("text" to JsonPrimitive(s))))
    private fun ev(seq: Long, kind: String) = LiveEvent(seq, seq, kind)

    @Test fun asksOnceAndCollectsTheTurn() = runBlocking {
        val c = FakeClient(listOf(listOf(ev(1, "turn.start"), text(2, "{\"a\":")), listOf(text(3, "1}"), ev(4, "turn.end"))))
        val r = AiAsk(c, sleep = {}).ask(AiRequestInput("sort", requested = AiModes.CHAT))
        assertEquals("{\"a\":1}", r.getOrNull())
        assertEquals(AiModes.CHAT, c.started!!.mode)
        assertTrue(c.started!!.readOnly)
        assertTrue(c.closed)
    }

    @Test fun readCodebaseAllowedLocallyButBuildRequestIsNot() = runBlocking {
        val c = FakeClient(listOf(listOf(text(1, "ok"), ev(2, "turn.end"))))
        assertEquals("ok", AiAsk(c, sleep = {}).ask(AiRequestInput("read", requested = AiModes.READ_CODEBASE)).getOrNull())
        assertEquals("assistant.read", c.started!!.sessionKind)
        val denied = AiAsk(FakeClient(emptyList()), sleep = {}).ask(AiRequestInput("build", requested = AiModes.BUILD_REQUEST))
        assertTrue(denied.failureOrNull() is AxfFailure.Denied)
        // a policy without read-codebase never silently falls back to chat
        val chatOnly = AiAsk(FakeClient(emptyList()), policy = AiModePolicy(admin = false), sleep = {}).ask(AiRequestInput("read", requested = AiModes.READ_CODEBASE))
        assertTrue(chatOnly.failureOrNull() is AxfFailure.Denied)
    }

    @Test fun unavailableAndTimeout() = runBlocking {
        assertTrue(AiAsk(PlaceholderAiSessionClient).ask(AiRequestInput("x")).failureOrNull() is AxfFailure.Unavailable)
        var t = 0L
        val c = FakeClient(emptyList())
        val r = AiAsk(c, sleep = { t += it }, clock = { t }).ask(AiRequestInput("x", requested = AiModes.CHAT), timeoutMs = 2000, pollMs = 500)
        assertTrue(r.failureOrNull() is AxfFailure.Unavailable)
        assertTrue(c.stopped && c.closed)
    }
}
