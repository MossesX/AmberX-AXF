package ai.amberx.axf.axnotes.model

import kotlinx.serialization.json.JsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.io.File

class NotesCodecTest {
    @Test fun noteRoundTrips() {
        val n = Note("note-1", "Fix build", "The CI fails on lib-x", "work", listOf("ci", "urgent"), 10, 20, listOf("L1"),
            listOf(CodeLink("MossesX/AmberX-AXF", "a/B.kt", 3, 9, "abcdef1")), NoteSource.VOICE, Priority.HIGH)
        assertEquals(n, NotesCodec.note(NotesCodec.noteJson(n)))
    }

    @Test fun listsRoundTrip() {
        val todo = NoteList("g", "Groceries", ListKind.TODO, ListSort.PRIORITY, false, listOf("b", "a"), listOf(
            TodoItem("a", "milk", true, 50, Priority.LOW, listOf("note-1"), "home", 1, 2, 3, listOf(CodeLink("o/r", "x.kt"))),
            TodoItem("b", "eggs", createdAt = 4, updatedAt = 4),
        ), null, 0, 9)
        assertEquals(todo, NotesCodec.list(NotesCodec.listJson(todo)))
        val smart = NoteList("s", "Urgent work", ListKind.SMART, filter = SmartFilter("work", "urgent", 1, 2, "ci"), createdAt = 0, updatedAt = 0)
        assertEquals(smart, NotesCodec.list(NotesCodec.listJson(smart)))
        val c = Category("work", "Work", 2)
        assertEquals(c, NotesCodec.category(NotesCodec.categoryJson(c)))
    }

    @Test fun tolerantReads() {
        val o = NotesCodec.json.parseToJsonElement("""{"title":"x","tags":["a",3],"source":"weird","createdAt":"5","extra":true}""") as JsonObject
        val n = NotesCodec.note(o, "fallback")!!
        assertEquals("fallback", n.id); assertEquals(listOf("a"), n.tags); assertEquals(NoteSource.TYPED, n.source); assertEquals(5L, n.updatedAt)
        assertNull(NotesCodec.note(JsonObject(emptyMap())))
        assertNull(NotesCodec.triggers("""{"${'$'}axf":"other"}"""))
        assertNull(NotesCodec.triggers("not json"))
    }

    /** The shipped trigger data and the in-code defaults are the same set. */
    @Test fun shippedTriggersMatchDefaults() {
        val f = listOf(File("src/main/assets/axnotes/triggers.json"), File("app/src/main/assets/axnotes/triggers.json")).first { it.exists() }
        assertEquals(NoteTriggers.DEFAULTS, NotesCodec.triggers(f.readText()))
    }
}
