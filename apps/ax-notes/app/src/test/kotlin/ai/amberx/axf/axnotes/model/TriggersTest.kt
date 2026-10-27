package ai.amberx.axf.axnotes.model

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate
import java.time.ZoneOffset

class TriggersTest {
    private fun hit(s: String) = NoteTriggers.match(s)

    @Test fun matchesNoteTriggers() {
        assertEquals(NoteTriggers.NOTE_TAKE, hit("Take a note")?.def?.id)
        assertEquals(NoteTriggers.NOTE_END, hit("end note.")?.def?.id)
        hit("Note: buy oat milk")!!.let { assertEquals(NoteTriggers.NOTE_QUICK, it.def.id); assertEquals("buy oat milk", it.arg) }
        assertNull(hit("note"))
        assertNull(hit("take a note please"))
        assertEquals("" to NoteTriggers.READ_BACK, hit("read back")!!.let { it.arg to it.def.id })
        assertEquals("today", hit("read back today")?.arg)
        assertEquals("work", hit("summarize work")?.arg)
        assertEquals("", hit("summarise")?.arg)
        assertEquals(NoteTriggers.OPEN_NOTES, hit("open notes")?.def?.id)
    }

    @Test fun matchesListTriggers() {
        hit("Add to-do buy milk to groceries")!!.let { assertEquals(NoteTriggers.TODO_ADD, it.def.id); assertEquals("buy milk to groceries", it.arg) }
        assertEquals(NoteTriggers.TODO_ADD, hit("add to do call mum")?.def?.id)
        assertEquals("the milk", hit("check off the milk")?.arg)
        assertEquals("groceries", hit("read my list groceries")?.arg)
        hit("read my groceries list")!!.let { assertEquals(NoteTriggers.LIST_READ, it.def.id); assertEquals("groceries", it.arg) }
        hit("new to-do list weekend")!!.let { assertEquals(NoteTriggers.LIST_NEW, it.def.id); assertEquals("weekend", it.arg); assertTrue(it.phrase.contains("todo")) }
        hit("new list books")!!.let { assertEquals(NoteTriggers.LIST_NEW, it.def.id); assertEquals("books", it.arg) }
        assertNull(hit("hello there"))
    }

    @Test fun readTargets() {
        val cats = listOf(Category("work", "Work"), Category("home", "Home"))
        assertEquals(ReadTarget.Last, ReadTarget.parse("", cats))
        assertEquals(ReadTarget.Today, ReadTarget.parse("today's", cats))
        assertEquals(ReadTarget.InCategory(cats[0]), ReadTarget.parse("my work notes", cats))
        assertTrue(ReadTarget.parse("garden", cats) is ReadTarget.Unknown)
    }

    @Test fun dictationRunsUntilEndNote() {
        val d = Dictation(listOf("end note", "stop note"), listOf("cancel note"))
        d.start()
        assertEquals(Dictation.Step.Continue("Remember the meeting"), d.feed("Remember the meeting"))
        assertEquals(Dictation.Step.Continue("Remember the meeting is at three"), d.feed("is at three"))
        assertEquals(Dictation.Step.Finished("Remember the meeting is at three in room 4"), d.feed("in room 4 end note thanks"))
        assertTrue(!d.active)
        d.start("first")
        assertEquals(Dictation.Step.Cancelled, d.feed("oops cancel note"))
        d.start()
        assertEquals(Dictation.Step.Finished(""), d.feed("End note."))
        d.start(); d.feed("half a thought")
        assertEquals("half a thought", d.finish())
    }

    @Test fun readBackSentences() {
        val zone = ZoneOffset.UTC
        val day = 86_400_000L
        val cats = listOf(Category("work", "Work"))
        val n = listOf(
            Note("1", "Old", "Old note", "work", createdAt = 10, updatedAt = 10),
            Note("2", "New", "Ship the build", "work", createdAt = day + 5, updatedAt = day + 5),
        )
        val today = LocalDate.of(1970, 1, 2)
        assertEquals("Your last note: Ship the build", ReadBack.notes(ReadTarget.Last, n, cats, today, zone))
        assertEquals("1 note today. Ship the build.", ReadBack.notes(ReadTarget.Today, n, cats, today, zone))
        assertEquals("2 notes in Work. Ship the build. Old note.", ReadBack.notes(ReadTarget.InCategory(cats[0]), n, cats, today, zone))
        val list = NoteList("g", "Groceries", ListKind.TODO, items = listOf(
            TodoItem("a", "milk", createdAt = 1, updatedAt = 1), TodoItem("b", "eggs", done = true, createdAt = 2, updatedAt = 2), TodoItem("c", "bread", createdAt = 3, updatedAt = 3),
        ), createdAt = 0, updatedAt = 0)
        assertEquals("Groceries: 2 items to do. milk. bread.", ReadBack.todoList(list, cats))
        assertEquals("Work has 2 notes: New; Old.", ReadBack.localSummary("Work", n))
    }

    @Test fun titlesAndIds() {
        assertEquals("Remember the meeting is at three…", Text.titleFrom("remember the meeting is at three in room four. Bring slides"))
        assertEquals("Buy milk", Text.titleFrom("buy milk."))
        assertEquals("Untitled note", Text.titleFrom("   "))
        assertTrue(Ids.next("note", 1000, 5).startsWith("note-rs"))
    }
}
