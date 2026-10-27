package ai.amberx.axf.axnotes.model

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class HostRequestsTest {
    private fun obj(s: String): JsonObject = NotesCodec.json.parseToJsonElement(s) as JsonObject

    private val inbox = NoteList("inbox", "Inbox", ListKind.NOTES, createdAt = 0, updatedAt = 0)
    private val work = NoteList("list-w", "Work stuff", ListKind.NOTES, createdAt = 0, updatedAt = 0)
    private val todo = NoteList("todo", "To-do", ListKind.TODO, createdAt = 0, updatedAt = 0)
    private val lists = listOf(inbox, work, todo)

    @Test fun parsesSaveRequest() {
        val r = HostRequests.saveRequest(obj("""{"id":"ai-codebase-reader.arch-x","title":"Arch","text":"Body","tags":["a"],"source":"ai","category":"Code",
            "fileInto":["Work stuff"," "],"codeLinks":[{"repo":"o/r","path":"a.kt","lineStart":3,"lineEnd":5,"commit":"abcdef1"},{"repo":""}]}"""))!!
        assertEquals("ai-codebase-reader.arch-x", r.id); assertEquals("Code", r.category); assertEquals(NoteSource.AI, r.source)
        assertEquals(listOf("Work stuff"), r.fileInto); assertEquals(listOf(CodeLink("o/r", "a.kt", 3, 5, "abcdef1")), r.codeLinks)
        val bare = HostRequests.saveRequest(obj("""{"text":"x"}"""))!!
        assertNull(bare.id); assertNull(bare.category); assertNull(bare.tags); assertNull(bare.codeLinks); assertNull(bare.source)
        assertNull(HostRequests.saveRequest(obj("""{"id":"bad id/../x","text":"x"}""")))
    }

    @Test fun createsWithGivenIdOrNew() {
        val r = NoteSaveRequest(id = "p.n1", text = " Hello there. More ", tags = listOf("#a", "A", "b"), fileInto = listOf("list-w"))
        val n = HostRequests.applySave(null, r, "code", listOf("list-w"), 100, "note-new", listOf("inbox"))!!
        assertEquals("p.n1", n.id); assertEquals("Hello there", n.title); assertEquals("Hello there. More", n.text); assertEquals("code", n.category)
        assertEquals(listOf("a", "b"), n.tags); assertEquals(listOf("inbox", "list-w"), n.listIds); assertEquals(NoteSource.AI, n.source)
        assertEquals("note-new", HostRequests.applySave(null, NoteSaveRequest(text = "x"), null, emptyList(), 1, "note-new")!!.id)
        assertNull(HostRequests.applySave(null, NoteSaveRequest(text = " "), null, emptyList(), 1, "n"))
    }

    @Test fun updatesKeepWhatIsNotGiven() {
        val old = Note("n1", "Mine", "Text", "work", listOf("x"), 10, 20, listOf("inbox"), listOf(CodeLink("o/r", "a.kt")), NoteSource.VOICE, Priority.HIGH)
        val same = HostRequests.applySave(old, NoteSaveRequest(id = "n1"), null, emptyList(), 30, "unused")!!
        assertEquals(old.copy(updatedAt = 30), same)
        val r = NoteSaveRequest(id = "n1", title = "New", text = "Text 2", tags = listOf("y"), codeLinks = emptyList())
        val upd = HostRequests.applySave(old, r, "ideas", listOf("list-w", "inbox"), 40, "unused")!!
        assertEquals("New", upd.title); assertEquals("Text 2", upd.text); assertEquals("ideas", upd.category); assertEquals(listOf("y"), upd.tags)
        assertEquals(listOf("inbox", "list-w"), upd.listIds); assertEquals(emptyList<CodeLink>(), upd.codeLinks); assertEquals(NoteSource.VOICE, upd.source)
        assertEquals(10L, upd.createdAt); assertEquals(40L, upd.updatedAt)
        assertEquals("", HostRequests.applySave(old, NoteSaveRequest(id = "n1", category = ""), "", emptyList(), 50, "u")!!.category)
    }

    @Test fun resolvesListsByIdOrName() {
        assertEquals(listOf("list-w", "inbox"), HostRequests.resolveLists(listOf("work STUFF", "inbox", "Missing", "todo", "list-w"), lists))
    }

    @Test fun savedPayloadCarriesChange() {
        val n = Note("n1", "T", "x", createdAt = 1, updatedAt = 2)
        val p = HostRequests.savedPayload(n, HostRequests.CHANGE_UPDATED)
        assertEquals(JsonPrimitive("updated"), p["change"]); assertEquals(n, NotesCodec.note(p))
    }

    @Test fun todoAdd() {
        val r = HostRequests.todoAddRequest(obj("""{"list":"To do","text":"Call Bob","noteId":"n1","category":"Work","createList":true}"""))!!
        assertEquals(TodoAddRequest("To do", "Call Bob", "n1", "Work", true), r)
        assertNull(HostRequests.todoAddRequest(obj("""{"list":"x"}""")))
        assertEquals("todo", HostRequests.findTodoList("to-do", lists)?.id)
        assertEquals("todo", HostRequests.findTodoList("todo", lists)?.id)
        assertNull(HostRequests.findTodoList("Work stuff", lists))
        val l = todo.copy(items = listOf(TodoItem("a", "Call Bob!", createdAt = 1, updatedAt = 1), TodoItem("b", "Pay rent", done = true, createdAt = 1, updatedAt = 1)))
        assertTrue(HostRequests.hasOpen(l, "call bob"))
        assertFalse(HostRequests.hasOpen(l, "pay rent"))
    }

    @Test fun parsesSync() {
        val r = HostRequests.todoSyncRequest(obj("""{"list":{"id":"cb.todos-r","name":"TODOs · r","kind":"todo"},"owner":"cb",
            "add":[{"id":"cbtodo-1","text":"Fix it","priority":"high","createdAt":5,"updatedAt":5,"codeLinks":[{"repo":"o/r","path":"a.kt","lineStart":2,"lineEnd":2}]}],
            "update":[],"close":["cbtodo-2"],"reopen":["cbtodo-3"]}"""))!!
        assertEquals("cb.todos-r", r.listId); assertEquals("cb", r.owner); assertEquals(Priority.HIGH, r.add.single().priority)
        assertEquals(listOf("cbtodo-2"), r.close); assertEquals(listOf("cbtodo-3"), r.reopen)
        assertNull(HostRequests.todoSyncRequest(obj("""{"list":{"id":"x"}}""")))
        assertEquals("x", HostRequests.listId(obj("""{"id":"x"}"""))); assertNull(HostRequests.listId(obj("{}")))
    }

    @Test fun syncTouchesOnlyTheOwnersItems() {
        val user = TodoItem("u1", "Mine", createdAt = 1, updatedAt = 1)
        val open = TodoItem("c1", "Old text", priority = Priority.MEDIUM, createdAt = 1, updatedAt = 1, owner = "cb")
        val closedByHarvest = TodoItem("c2", "Gone", done = true, doneAt = 2, createdAt = 1, updatedAt = 2, owner = "cb")
        val ticked = TodoItem("c3", "Ticked", done = false, createdAt = 1, updatedAt = 1, owner = "cb", noteIds = listOf("n1"))
        val r = TodoSyncRequest("l", "TODOs", "cb",
            add = listOf(TodoItem("c4", "New one", createdAt = 0, updatedAt = 0), TodoItem("u1", "steal", createdAt = 0, updatedAt = 0)),
            update = listOf(TodoItem("c1", "New text", done = false, priority = Priority.HIGH, createdAt = 0, updatedAt = 0, codeLinks = listOf(CodeLink("o/r", "a.kt"))),
                TodoItem("deleted", "x", createdAt = 0, updatedAt = 0)),
            close = listOf("c3", "u1"), reopen = listOf("c2", "c1"))
        val out = HostRequests.applySync(listOf(user, open, closedByHarvest, ticked), r, 99)
        val byId = out.items.associateBy { it.id }
        assertEquals(listOf("u1", "c1", "c2", "c3", "c4"), out.items.map { it.id })
        assertEquals(user, byId["u1"])
        assertEquals("New text", byId["c1"]!!.text); assertEquals(Priority.HIGH, byId["c1"]!!.priority); assertFalse(byId["c1"]!!.done)
        assertFalse(byId["c2"]!!.done); assertNull(byId["c2"]!!.doneAt)
        assertTrue(byId["c3"]!!.done); assertEquals(99L, byId["c3"]!!.doneAt); assertEquals(listOf("n1"), byId["c3"]!!.noteIds)
        assertEquals("cb", byId["c4"]!!.owner); assertEquals(99L, byId["c4"]!!.createdAt)
        assertEquals(listOf("c4"), out.added); assertEquals(listOf("c1"), out.updated); assertEquals(listOf("c3"), out.closed); assertEquals(listOf("c2"), out.reopened)
        assertTrue(out.changed)
        assertFalse(HostRequests.applySync(out.items, TodoSyncRequest("l", "TODOs", "cb", close = listOf("c3")), 100).changed)
    }

    @Test fun todoOwnerRoundTrips() {
        val t = TodoItem("c1", "x", createdAt = 1, updatedAt = 1, owner = "cb")
        assertEquals(t, NotesCodec.todo(NotesCodec.todoJson(t)))
    }
}
