package ai.amberx.axf.axnotes.plugins.notesorter

import ai.amberx.axf.axnotes.model.Category
import ai.amberx.axf.axnotes.model.ListKind
import ai.amberx.axf.axnotes.model.Note
import ai.amberx.axf.axnotes.model.NoteList
import ai.amberx.axf.axnotes.model.NoteSource
import ai.amberx.axf.axnotes.model.Priority
import ai.amberx.axf.axnotes.model.TodoItem
import ai.amberx.axf.axnotes.pluginhost.PluginTriggers
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.time.LocalDateTime
import java.time.ZoneOffset

class SorterLogicTest {
    private val MODULE = "ai.amberx.axf.axnotes.plugins.note-sorter"
    private val zone = ZoneOffset.UTC
    private fun at(y: Int, mo: Int, d: Int, h: Int = 12) = LocalDateTime.of(y, mo, d, h, 0).toInstant(zone).toEpochMilli()
    private fun note(id: String, text: String, cat: String = "", at: Long = 1000, source: NoteSource = NoteSource.TYPED, title: String = "", tags: List<String> = emptyList()) =
        Note(id, title, text, cat, tags, at, at, source = source)

    @Test fun promptIsShortAndStructured() {
        val p = SorterPrompt.build("Call the client about the \"\"\"invoice\"\"\"", listOf("Work", "Home"), listOf(Correction("gym at six", "Work", "Health", 5)), 20)
        assertTrue(p.contains("ONE JSON object"))
        assertTrue(p.contains("one of Work, Home"))
        assertTrue(p.contains("\"gym at six\" -> Health"))
        assertTrue(p.contains("up to 20 words"))
        assertEquals(2, Regex("\"\"\"").findAll(p).count()) // the note can't close the quote block
    }

    @Test fun promptKeepsOnlyRecentExamples() {
        val many = (1..9).map { Correction("note $it", "A", "B$it", it.toLong()) }
        val p = SorterPrompt.build("x", emptyList(), many, 20)
        assertTrue(p.contains("B9") && p.contains("B5"))
        assertFalse(p.contains("B4"))
    }

    @Test fun parsesFencedReply() {
        val reply = "Sure! ```json\n{\"category\":\"Work.\",\"tags\":[\"#Invoices\",\"Client Call\",\"a\",\"b\",\"c\",\"d\"],\"title\":\"Call client\",\"summary\":\"one two three four five\",\"actions\":[\"call the client\",\"Call the client.\",\"- [ ] send invoice\"]}\n```"
        val r = SorterReply.parse(reply, 3)!!
        assertEquals("Work", r.category)
        assertEquals(listOf("invoices", "client-call", "a", "b", "c"), r.tags)
        assertEquals("one two three…", r.summary)
        assertEquals(listOf("Call the client", "Send invoice"), r.actions)
        assertTrue(r.fromAi)
    }

    @Test fun badReplyIsNull() {
        assertNull(SorterReply.parse("I can't do that", 20))
        assertNull(SorterReply.parse("{\"category\":\"\",\"tags\":[]}", 20))
        assertNull(SorterReply.parse("{broken", 20))
    }

    @Test fun localRulesUseCorrectionsFirst() {
        val corr = listOf(Correction("pick up the dry cleaning on main street", "Home", "Errands", 10))
        assertEquals("Errands", LocalSorter.category("dry cleaning pick up tomorrow", listOf("Home", "Errands"), corr))
        assertEquals("Work", LocalSorter.category("prepare the work deck", listOf("Home", "Work"), emptyList()))
        assertEquals("Work", LocalSorter.category("meeting with the client at 3", listOf("Home", "Work"), emptyList()))
        assertEquals("", LocalSorter.category("meeting with the client at 3", listOf("Home"), emptyList()))
    }

    @Test fun localSortGivesTagsTitleSummaryActions() {
        val r = LocalSorter.sort("Plan the trip #travel. I need to book the hotel. Remember to renew the passport!\n- [ ] pack bags", listOf("Travel"), emptyList(), 20)
        assertEquals("Travel", r.category)
        assertEquals(listOf("travel"), r.tags)
        assertEquals(listOf("Book the hotel", "Renew the passport", "Pack bags"), r.actions)
        assertFalse(r.fromAi)
        assertTrue(r.summary.startsWith("Plan the trip"))
    }

    @Test fun pendingSkipsAiNotesAndUnchangedText() {
        val a = note("a", "hello", at = 50)
        val b = note("b", "digest", source = NoteSource.AI, at = 60)
        val c = note("c", "old", at = 5)
        val d = note("d", "same", at = 70)
        val recs = mapOf("d" to SortRecord("d", Sorter.textHash(d), "", "", emptyList(), 70))
        assertEquals(listOf("a"), Sorter.pending(listOf(a, b, c, d), recs, since = 10).map { it.id })
        assertEquals(listOf("c", "a"), Sorter.pending(listOf(a, b, c, d), recs, since = 0).map { it.id })
        val edited = d.copy(text = "changed", updatedAt = 80)
        assertEquals(listOf("d"), Sorter.pending(listOf(edited), recs, 0).map { it.id })
    }

    @Test fun learnsFromRecategorization() {
        val cats = listOf(Category("work", "Work"), Category("health", "Health"))
        val n = note("n", "gym at six", "health")
        val recs = mapOf("n" to SortRecord("n", Sorter.textHash(n), "work", "", emptyList(), 1))
        val out = Sorter.corrections(listOf(n), recs, cats, 99)
        assertEquals(1, out.size)
        assertEquals("Work", out[0].second.from)
        assertEquals("Health", out[0].second.to)
        assertTrue(out[0].first.userSet)
        // text changed too → not a correction
        assertTrue(Sorter.corrections(listOf(n.copy(text = "other")), recs, cats, 99).isEmpty())
        // after learning, the user's category sticks
        assertTrue(Sorter.userCategory(n, out[0].first))
        assertFalse(Sorter.userCategory(n.copy(category = "work"), recs["n"]))
        assertTrue(Sorter.userCategory(n, null))
    }

    @Test fun learningKeepsNewestAndReplacesSameText() {
        var l = emptyList<Correction>()
        l = Learning.add(l, Correction("Gym at six", "A", "B", 1))
        l = Learning.add(l, Correction("gym at six!", "A", "C", 2))
        assertEquals(1, l.size)
        assertEquals("C", l[0].to)
        repeat(60) { l = Learning.add(l, Correction("n$it", "A", "B", 10L + it)) }
        assertEquals(Learning.MAX, l.size)
        assertEquals("n59", l[0].sample)
        assertEquals(l, SorterCodec.corrections(SorterCodec.corrections(l)))
    }

    @Test fun recordRoundTrips() {
        val r = SortRecord("n", "abc", "work", "sum", listOf("Do it"), 5, userSet = true)
        assertEquals(r, SorterCodec.record(SorterCodec.record(r)))
    }

    @Test fun titlesWrittenByTheUserStay() {
        assertFalse(Sorter.keepsTitle(note("a", "Buy milk and eggs today please", title = "Buy milk and eggs today please")))
        assertTrue(Sorter.keepsTitle(note("a", "Buy milk", title = "Groceries")))
        assertFalse(Sorter.keepsTitle(note("a", "x", title = "")))
    }

    @Test fun actionItemsDedupeAgainstListAndHistory() {
        val items = listOf(TodoItem("1", "Book the hotel", createdAt = 0, updatedAt = 0), TodoItem("2", "Old thing", done = true, createdAt = 0, updatedAt = 0))
        val fresh = ActionItems.newOnes(listOf("book the hotel", "Old thing", "Renew passport", "renew passport"), items, already = listOf("Pack"))
        assertEquals(listOf("Old thing", "Renew passport"), fresh)
        assertTrue(ActionItems.newOnes(listOf("Pack"), items, listOf("pack")).isEmpty())
    }

    @Test fun filesIntoMatchingNoteLists() {
        val lists = listOf(
            NoteList("l1", "Recipes", ListKind.NOTES, createdAt = 0, updatedAt = 0),
            NoteList("l2", "Work", ListKind.NOTES, createdAt = 0, updatedAt = 0),
            NoteList("l3", "Work", ListKind.TODO, createdAt = 0, updatedAt = 0),
            NoteList("l4", "Ideas", ListKind.NOTES, createdAt = 0, updatedAt = 0),
        )
        assertEquals(listOf("l1", "l2"), Filing.listsFor("Work", listOf("recipe"), lists, emptyList()))
        assertEquals(listOf("l1"), Filing.listsFor("Work", listOf("recipe"), lists, listOf("l2")))
        assertTrue(Filing.listsFor("", emptyList(), lists, emptyList()).isEmpty())
    }

    @Test fun digestDueOncePerDayOrWeek() {
        val mon = at(2026, 10, 26) // a Monday
        assertTrue(Digest.due(null, mon, DigestPeriod.DAILY, zone))
        assertFalse(Digest.due(mon - 3600_000, mon, DigestPeriod.DAILY, zone))
        assertTrue(Digest.due(at(2026, 10, 25, 23), mon, DigestPeriod.DAILY, zone))
        assertFalse(Digest.due(at(2026, 10, 26, 1), at(2026, 11, 1), DigestPeriod.WEEKLY, zone))
        assertTrue(Digest.due(at(2026, 10, 25), mon, DigestPeriod.WEEKLY, zone))
        assertFalse(Digest.due(null, mon, DigestPeriod.OFF, zone))
    }

    @Test fun digestReadsAloudInPlainSentences() {
        val now = at(2026, 10, 27, 9)
        val y = at(2026, 10, 26, 10)
        val cats = listOf(Category("work", "Work"))
        val notes = listOf(
            note("a", "Call the client", "work", y, title = "Client"),
            note("b", "Milk", "", y + 1, title = "Milk"),
            note("old", "x", "work", at(2026, 10, 20)),
            note("dg", "earlier digest", "", y, NoteSource.AI, tags = listOf("digest")),
        )
        val todo = NoteList("t", "To-do", ListKind.TODO, items = listOf(
            TodoItem("1", "Pay rent", priority = Priority.HIGH, createdAt = y, updatedAt = y),
            TodoItem("2", "Done thing", done = true, doneAt = y, createdAt = 0, updatedAt = y),
        ), createdAt = 0, updatedAt = 0)
        val range = Digest.range(DigestPeriod.DAILY, now, zone, previous = true)
        val out = Digest.build(DigestPeriod.DAILY, range, notes, mapOf("a" to "Call the client about the invoice"), listOf(todo), cats)!!
        assertEquals("Daily digest, Monday 26 October", out.title)
        assertTrue(out.text.contains("You wrote 2 notes."))
        assertTrue(out.text.contains("Work, one note. Call the client about the invoice."))
        assertTrue(out.text.contains("Uncategorized, one note. Milk."))
        assertTrue(out.text.contains("To-dos: one added, one done, one still open. Most urgent: Pay rent."))
        assertFalse(out.text.contains("earlier digest"))
        assertFalse(out.text.contains("*") || out.text.contains("#"))
        // nothing happened → no digest
        assertNull(Digest.build(DigestPeriod.DAILY, Digest.range(DigestPeriod.DAILY, at(2026, 9, 1), zone, true), notes, emptyMap(), emptyList(), cats))
        val week = Digest.range(DigestPeriod.WEEKLY, now, zone, previous = false)
        assertEquals("the week of 26 October", week.label)
        assertNotNull(Digest.build(DigestPeriod.WEEKLY, week, notes, emptyMap(), listOf(todo), cats))
    }

    @Test fun shippedTriggersValidate() {
        val f = listOf("../plugins/note-sorter", "plugins/note-sorter", ".").map { File(it, "assets/axnotes/plugins/note-sorter/triggers.json") }.firstOrNull { it.exists() }
            ?: return // run from an unexpected folder: nothing to check
        val t = PluginTriggers.parse(f.readText(), MODULE)
        assertEquals(3, t.size)
        assertTrue(t.all { it.kind == "voice" && it.module == MODULE })
        assertEquals("weekly", t.first { it.id == "notesorter.digest-weekly" }.args?.get("period")?.toString()?.trim('"'))
    }
}
