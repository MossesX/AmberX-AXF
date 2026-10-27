package ai.amberx.axf.axnotes.plugins.notesorter

import ai.amberx.axf.kernel.ai.AiModes
import ai.amberx.axf.kernel.ai.AiModePolicy
import ai.amberx.axf.kernel.ai.AiRequestInput
import ai.amberx.axf.kernel.ai.AiSessionClient
import ai.amberx.axf.kernel.ai.AiSessionRequest
import ai.amberx.axf.kernel.ai.PlaceholderAiSessionClient
import ai.amberx.axf.kernel.assistant.ChatContext
import ai.amberx.axf.kernel.live.LiveDetach
import ai.amberx.axf.kernel.live.LiveEvent
import ai.amberx.axf.kernel.live.LiveReplay
import ai.amberx.axf.kernel.live.LiveSessionInfo
import ai.amberx.axf.kernel.live.LiveState
import ai.amberx.axf.kernel.result.AxfFailure
import ai.amberx.axf.kernel.result.AxfResult
import ai.amberx.axf.kernel.triggers.TriggerValidation
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDateTime
import java.time.ZoneOffset

class SorterLogicTest {
    private val zone = ZoneOffset.UTC
    private fun at(y: Int, mo: Int, d: Int, h: Int = 12) = LocalDateTime.of(y, mo, d, h, 0).toInstant(zone).toEpochMilli()
    private fun note(id: String, text: String, cat: String = "", at: Long = 1000, source: String = "typed", title: String = "", tags: List<String> = emptyList()) =
        NoteView(id, title, text, cat, tags, source, at, at)
    private fun rec(n: NoteView, cat: String, summary: String = "", actions: List<String> = emptyList(), at: Long = n.createdAt, digest: Boolean = false) =
        SortRecord(n.id, Sorter.textHash(n), cat, n.title, summary, actions, n.createdAt, at, digest = digest)

    @Test fun parsesTheAppsNoteJson() {
        val o = J.parse("""{"${'$'}axf":"axnotes-note@1","id":"n1","title":"T","text":"Body","category":"work","tags":["a"],"createdAt":5,"updatedAt":6,"source":"voice","codeLinks":[]}""")
        assertEquals(NoteView("n1", "T", "Body", "work", listOf("a"), "voice", 5, 6), NoteView.parse(o))
        assertNull(NoteView.parse(J.parse("{\"title\":\"no id\"}")))
    }

    @Test fun promptIsShortAndStructured() {
        val p = SorterPrompt.build("Call the client about the \"\"\"invoice\"\"\"", listOf("Work", "Home"), listOf(Correction("gym at six", "Work", "Health", 5)), 20)
        assertTrue(p.contains("ONE JSON object"))
        assertTrue(p.contains("one of Work, Home"))
        assertTrue(p.contains("\"gym at six\" -> Health"))
        assertTrue(p.contains("up to 20 words"))
        assertEquals(2, Regex("\"\"\"").findAll(p).count())
        val many = (1..9).map { Correction("note $it", "A", "B$it", it.toLong()) }
        val q = SorterPrompt.build("x", emptyList(), many, 20)
        assertTrue(q.contains("B9") && q.contains("B5") && !q.contains("B4"))
    }

    @Test fun parsesFencedReply() {
        val reply = "Sure! ```json\n{\"category\":\"Work.\",\"tags\":[\"#Invoices\",\"Client Call\",\"a\",\"b\",\"c\",\"d\"],\"title\":\"Call client\",\"summary\":\"one two three four five\",\"actions\":[\"call the client\",\"Call the client.\",\"- [ ] send invoice\"]}\n```"
        val r = SorterReply.parse(reply, 3)!!
        assertEquals("Work", r.category)
        assertEquals(listOf("invoices", "client-call", "a", "b", "c"), r.tags)
        assertEquals("one two three…", r.summary)
        assertEquals(listOf("Call the client", "Send invoice"), r.actions)
        assertNull(SorterReply.parse("I can't do that", 20))
        assertNull(SorterReply.parse("{\"category\":\"\",\"tags\":[]}", 20))
    }

    @Test fun localRules() {
        val corr = listOf(Correction("pick up the dry cleaning on main street", "Home", "Errands", 10))
        assertEquals("Errands", LocalSorter.category("dry cleaning pick up tomorrow", listOf("Home", "Errands"), corr))
        assertEquals("Work", LocalSorter.category("prepare the work deck", listOf("Home", "Work"), emptyList()))
        assertEquals("Work", LocalSorter.category("meeting with the client at 3", listOf("Home", "Work"), emptyList()))
        assertEquals("", LocalSorter.category("meeting with the client at 3", listOf("Home"), emptyList()))
        val r = LocalSorter.sort("Plan the trip #travel. I need to book the hotel. Remember to renew the passport!\n- [ ] pack bags", listOf("Travel"), emptyList(), 20)
        assertEquals("Travel", r.category)
        assertEquals(listOf("travel"), r.tags)
        assertEquals(listOf("Book the hotel", "Renew the passport", "Pack bags"), r.actions)
        assertFalse(r.fromAi)
    }

    @Test fun sortsOnlyNewTextAndNeverAiNotes() {
        val a = note("a", "hello", at = 50)
        assertTrue(Sorter.needsSort(a, null, 10))
        assertFalse(Sorter.needsSort(a, null, 60))
        assertFalse(Sorter.needsSort(note("b", "digest", source = "ai", at = 60), null, 0))
        assertFalse(Sorter.needsSort(a, rec(a, ""), 0))
        assertTrue(Sorter.needsSort(a.copy(text = "changed"), rec(a, ""), 0))
    }

    @Test fun learnsFromRecategorization() {
        val n = note("n", "gym at six", "health")
        val r = rec(n, "work")
        val (updated, c) = Sorter.correction(n, r, 99)!!
        assertEquals("Work", c.from); assertEquals("Health", c.to)
        assertTrue(updated.userSet)
        assertNull(Sorter.correction(n.copy(text = "other"), r, 99))
        assertTrue(Sorter.userCategory(n, updated))
        assertFalse(Sorter.userCategory(n.copy(category = "work"), r))
        assertTrue(Sorter.userCategory(n, null))
        var l = emptyList<Correction>()
        l = Learning.add(l, Correction("Gym at six", "A", "B", 1))
        l = Learning.add(l, Correction("gym at six!", "A", "C", 2))
        assertEquals(listOf("C"), l.map { it.to })
        repeat(60) { l = Learning.add(l, Correction("n$it", "A", "B", 10L + it)) }
        assertEquals(Learning.MAX, l.size)
        assertEquals(l, SorterCodec.corrections(SorterCodec.corrections(l)))
    }

    @Test fun updatePayloadForTheApp() {
        val n = note("n", "Buy milk and eggs today please", title = Txt.titleFrom("Buy milk and eggs today please"), tags = listOf("food"))
        val res = SortResult("Shopping", listOf("groceries"), "Groceries run", "Buy milk", listOf("Buy milk"), true)
        val p = Sorter.updatePayload(n, res, keepCategory = false)!!
        assertEquals("n", J.str(p, "id"))
        assertEquals("Groceries run", J.str(p, "title"))
        assertEquals("Shopping", J.str(p, "category"))
        assertEquals(listOf("food", "groceries"), J.strings(p["tags"]))
        assertEquals(listOf("Shopping", "groceries"), J.strings(p["fileInto"]))
        assertEquals("shopping", Sorter.categoryAfter(n, res, false))
        val mine = n.copy(title = "Errands", category = "home")
        val q = Sorter.updatePayload(mine, res, keepCategory = true)!!
        assertNull(J.str(q, "category"))
        assertEquals("Errands", J.str(q, "title"))
        assertEquals(listOf("Home", "groceries"), J.strings(q["fileInto"]))
        assertEquals("home", Sorter.categoryAfter(mine, res, true))
        assertEquals(true, J.bool(Sorter.todoPayload("To-do", "Buy milk", "n", "Shopping"), "createList"))
        assertEquals(listOf("Renew passport"), ActionItems.newOnes(listOf("Pack", "Renew passport", "renew passport"), listOf("pack")))
    }

    @Test fun recordRoundTrips() {
        val r = SortRecord("n", "abc", "work", "T", "sum", listOf("Do it"), 4, 5, userSet = true, digest = false)
        assertEquals(r, SorterCodec.record(SorterCodec.record(r)))
    }

    @Test fun digestDueOncePerDayOrWeek() {
        val mon = at(2026, 10, 26)
        assertTrue(Digest.due(null, mon, DigestPeriod.DAILY, zone))
        assertFalse(Digest.due(mon - 3600_000, mon, DigestPeriod.DAILY, zone))
        assertTrue(Digest.due(at(2026, 10, 25, 23), mon, DigestPeriod.DAILY, zone))
        assertFalse(Digest.due(at(2026, 10, 26, 1), at(2026, 11, 1), DigestPeriod.WEEKLY, zone))
        assertTrue(Digest.due(at(2026, 10, 25), mon, DigestPeriod.WEEKLY, zone))
        assertFalse(Digest.due(null, mon, DigestPeriod.OFF, zone))
    }

    @Test fun digestReadsAloudInPlainSentences() {
        val y = at(2026, 10, 26, 10)
        val recs = listOf(
            rec(note("a", "Call the client", at = y, title = "Client"), "work", "Call the client about the invoice", listOf("Call client", "Send invoice")),
            rec(note("b", "Milk", at = y + 1, title = "Milk"), ""),
            rec(note("old", "x", at = at(2026, 10, 20)), "work"),
            rec(note("dg", "earlier digest", at = y, source = "ai"), "", digest = true),
        )
        val out = Digest.build(DigestPeriod.DAILY, Digest.range(DigestPeriod.DAILY, at(2026, 10, 27, 9), zone, previous = true), recs)!!
        assertEquals("Daily digest, Monday 26 October", out.title)
        assertTrue(out.text.contains("You wrote 2 notes."))
        assertTrue(out.text.contains("Work, one note. Call the client about the invoice."))
        assertTrue(out.text.contains("Uncategorized, one note. Milk."))
        assertTrue(out.text.contains("2 action items became to-dos."))
        assertFalse(out.text.contains("earlier digest") || out.text.contains("*") || out.text.contains("#"))
        assertNull(Digest.build(DigestPeriod.DAILY, Digest.range(DigestPeriod.DAILY, at(2026, 9, 1), zone, true), recs))
        assertEquals("the week of 26 October", Digest.range(DigestPeriod.WEEKLY, at(2026, 10, 27), zone, false).label)
        val p = Digest.payload(out)
        assertTrue(Sorter.isDigest(NoteView("x", "", "t", "", J.strings(p["tags"]), J.str(p, "source")!!, 0, 0)))
    }

    @Test fun triggersValidate() {
        val t = SorterTriggers.all(NoteSorterPlugin.ID)
        assertEquals(3, t.size)
        for (x in t) assertTrue(x.id, TriggerValidation.validate(x.toJson()).ok)
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
    private val chat = AiModePolicy(admin = false)

    @Test fun asksOnceAndCollectsTheTurn() = runBlocking {
        val c = FakeClient(listOf(listOf(LiveEvent(1, 1, "turn.start"), text(2, "{\"a\":")), listOf(text(3, "1}"), LiveEvent(4, 4, "turn.end"))))
        assertEquals("{\"a\":1}", AiAsk(c, AiModes.BUILTINS, chat, sleep = {}).ask(AiRequestInput("sort", requested = AiModes.CHAT)).getOrNull())
        assertEquals(AiModes.CHAT, c.started!!.mode)
        assertTrue(c.closed)
        assertTrue(AiAsk(FakeClient(emptyList()), AiModes.BUILTINS, chat, sleep = {}).ask(AiRequestInput("x", requested = AiModes.READ_CODEBASE)).failureOrNull() is AxfFailure.Denied)
        assertTrue(AiAsk(PlaceholderAiSessionClient, AiModes.BUILTINS, chat).ask(AiRequestInput("x")).failureOrNull() is AxfFailure.Unavailable)
        var t = 0L
        val slow = FakeClient(emptyList())
        assertNotNull(AiAsk(slow, AiModes.BUILTINS, chat, sleep = { t += it }, clock = { t }).ask(AiRequestInput("x", requested = AiModes.CHAT), timeoutMs = 2000).failureOrNull())
        assertTrue(slow.stopped && slow.closed)
    }

    @Test fun helpers() {
        assertTrue(Policies.fromPermissions(setOf("*")).admin)
        assertEquals(listOf(AiModes.CHAT, AiModes.READ_CODEBASE), Policies.fromPermissions(setOf("ai.mode.ai.read-codebase")).allowedModes)
        val args = ActionArgs.of(listOf("daily"), "{\"period\":\"weekly\"}", mapOf("args" to JsonObject(mapOf("file" to JsonPrimitive("x")))))
        assertEquals("weekly", ActionArgs.str(args, "period", "0"))
        assertEquals("x", ActionArgs.str(args, "file"))
        assertEquals("cbf29ce484222325", Hashes.fnv64(""))
        assertEquals("{\"b\":2}", ReplyJson.extract("{oops} then ```json {\"b\":2} ```").toString())
    }
}
