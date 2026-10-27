package ai.amberx.axf.axnotes.plugins.codebase

import ai.amberx.axf.axnotes.model.CodeLink
import ai.amberx.axf.axnotes.model.Note
import ai.amberx.axf.axnotes.model.NoteSource
import ai.amberx.axf.axnotes.model.Priority
import ai.amberx.axf.axnotes.model.TodoItem
import ai.amberx.axf.axnotes.pluginhost.PluginTriggers
import ai.amberx.axf.kernel.triggers.Patterns
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.time.ZoneOffset

class CodebaseTest {
    private val repo = "MossesX/AmberX-AXF"
    private val module = "ai.amberx.axf.axnotes.plugins.ai-codebase-reader"

    // ---------------------------------------------------------------- harvest (fake repo listings)

    private val v1 = mapOf(
        "app/src/Main.kt" to """
            fun main() {
                // TODO: wire the hub client
                val x = 1 // FIXME(brett): off by one
                /* TODO handle errors */
            }
        """.trimIndent(),
        "README.md" to "Nothing to do here.\n<!-- TODO: add screenshots -->\nTODOS are not todos",
        "lib/Util.kt" to "// TODO: wire the hub client\n// TODO: wire the hub client",
    )

    @Test fun scanFindsTodoAndFixme() {
        val hits = CodeTodos.scan(repo, v1, "abc1234")
        assertEquals(listOf("README.md:2", "app/src/Main.kt:2", "app/src/Main.kt:3", "app/src/Main.kt:4", "lib/Util.kt:1"), hits.map { "${it.path}:${it.line}" })
        assertEquals("add screenshots", hits[0].text)
        assertEquals(TodoKind.FIXME, hits[2].kind)
        assertEquals("off by one", hits[2].text)
        assertEquals("handle errors", hits[3].text)
        assertEquals(CodeLink(repo, "app/src/Main.kt", 2, 2, "abc1234"), CodeTodos.link(hits[1]))
    }

    @Test fun stableIdsIgnoreLineAndCaseButNotFile() {
        val a = CodeTodos.stableId(repo, "a.kt", "Wire  the hub")
        assertEquals(a, CodeTodos.stableId(repo.lowercase(), "/a.kt", "wire the hub"))
        assertNotEquals(a, CodeTodos.stableId(repo, "b.kt", "wire the hub"))
        assertNotEquals(a, CodeTodos.stableId(repo, "a.kt", "wire the hub", TodoKind.FIXME))
        assertTrue(a.startsWith(CodeTodos.ID_PREFIX))
    }

    @Test fun mergeAddsUpdatesClosesAndReopens() {
        val first = CodeTodos.merge(emptyList(), CodeTodos.scan(repo, v1, "aaaaaaa"), emptySet(), 10)
        assertEquals(5, first.added.size)
        assertEquals(Priority.HIGH, first.items.first { it.text.startsWith("FIXME") }.priority)
        val mine = TodoItem("todo-mine", "My own item", createdAt = 1, updatedAt = 1)
        val list1 = first.items + mine

        // v2: Main.kt line 2 moved down, README TODO removed, Util.kt unchanged
        val v2 = v1 + mapOf(
            "app/src/Main.kt" to "fun main() {\n\n    // TODO: wire the hub client\n    val x = 1 // FIXME(brett): off by one\n    /* TODO handle errors */\n}",
            "README.md" to "Nothing.",
        )
        val second = CodeTodos.merge(list1, CodeTodos.scan(repo, v2, "bbbbbbb"), first.autoClosed, 20)
        assertTrue(second.added.isEmpty())
        val readme = CodeTodos.stableId(repo, "README.md", "add screenshots")
        assertEquals(listOf(readme), second.closed)
        assertTrue(readme in second.autoClosed)
        val wired = second.items.first { it.id == CodeTodos.stableId(repo, "app/src/Main.kt", "wire the hub client") }
        assertEquals(3, wired.codeLinks.single().lineStart)
        assertEquals("bbbbbbb", wired.codeLinks.single().commit)
        assertTrue(wired.id in second.updated)
        assertEquals(mine, second.items.last()) // hand-added item untouched
        assertTrue(second.items.first { it.id == readme }.done)

        // user ticks one that still exists: stays done; README line comes back: reopened
        val ticked = second.items.map { if (it.id == wired.id) it.copy(done = true, doneAt = 25) else it }
        val third = CodeTodos.merge(ticked, CodeTodos.scan(repo, v1, "ccccccc"), second.autoClosed, 30)
        assertEquals(listOf(readme), third.reopened)
        assertFalse(third.items.first { it.id == readme }.done)
        assertTrue(third.items.first { it.id == wired.id }.done)
        assertFalse(readme in third.autoClosed)
        assertEquals(third.items.size, ticked.size)

        // same input again: nothing changes
        val again = CodeTodos.merge(third.items, CodeTodos.scan(repo, v1, "ccccccc"), third.autoClosed, 40)
        assertFalse(again.changed)
        assertEquals(third.items, again.items)
    }

    // ---------------------------------------------------------------- read-codebase reply → notes

    private val reply = """
        Here you go:
        ```json
        {"commit":"0123456789ABCDEF0123456789abcdef01234567","architecture":"Kernel plus modules.",
         "modules":[{"path":"framework/android/axf-kernel","summary":"pure kernel"},{"path":"../etc/passwd","summary":"bad"}],
         "todos":[{"path":"a.kt","line":3,"kind":"FIXME","text":"x"},{"path":"a.kt","line":9,"kind":"FIXME","text":"x"},{"path":"b.kt","line":1,"text":""}],
         "changes":[{"path":"a.kt","lineStart":3,"lineEnd":9,"summary":"fixed x"}]}
        ```
    """.trimIndent()

    @Test fun parsesReadReply() {
        val r = ReadReply.parse(reply, repo)!!
        assertEquals("0123456789abcdef0123456789abcdef01234567", r.commit)
        assertEquals(listOf("framework/android/axf-kernel"), r.modules.map { it.path })
        assertEquals(1, r.todos!!.size)
        assertEquals(3, r.todos!![0].line)
        assertTrue(r.todosComplete)
        assertEquals(CodeChange("a.kt", "fixed x", 3, 9), r.changes.single())
        assertNull(ReadReply.parse("{\"commit\":\"nope\"}", repo))
        assertNull(ReadReply.parse("{\"commit\":\"abcdef1\"}", repo)!!.todos) // no todos key → don't touch the list
    }

    @Test fun notesKeyedByCommit() {
        val r = ReadReply.parse(reply, repo)!!
        val first = CodebaseNotes.plan(r, null, emptyMap(), "codebase", 1000, ZoneOffset.UTC)
        assertEquals(listOf(CodebaseNotes.archId(repo)), first.map { it.id }) // first read: no changes note
        val arch = first[0]
        assertEquals(NoteSource.AI, arch.source)
        assertTrue(arch.text.startsWith("Read at commit 0123456"))
        assertEquals("https://github.com/MossesX/AmberX-AXF/blob/0123456789abcdef0123456789abcdef01234567/framework/android/axf-kernel", arch.codeLinks[0].githubUrl())

        val prev = RepoState(repo, "fedcba9876543210", 500)
        val kept = arch.copy(category = "mine", createdAt = 7, listIds = listOf("inbox"))
        val second = CodebaseNotes.plan(r, prev, mapOf(kept.id to kept), "codebase", 2000, ZoneOffset.UTC)
        assertEquals(2, second.size)
        assertEquals(7, second[0].createdAt)
        assertEquals("mine", second[0].category)
        assertEquals(listOf("inbox"), second[0].listIds)
        val changes = second[1]
        assertEquals(CodebaseNotes.changesId(repo, r.commit), changes.id)
        assertTrue(changes.title.startsWith("Changes since fedcba9"))
        assertEquals("https://github.com/MossesX/AmberX-AXF/blob/0123456789abcdef0123456789abcdef01234567/a.kt#L3-L9", changes.codeLinks.single().githubUrl())
        // same commit again → no new changes note
        assertEquals(1, CodebaseNotes.plan(r, prev.copy(lastCommit = r.commit), emptyMap(), "", 3000, ZoneOffset.UTC).size)
    }

    @Test fun reposSettingAndState() {
        assertEquals(listOf("MossesX/AmberX-AXF", "a/b"), Repos.parse("MossesX/AmberX-AXF\nhttps://github.com/a/b.git, bad, ../x/y, mossesx/amberx-axf"))
        assertTrue(Repos.allowed("mossesx/AMBERX-axf", listOf(repo)))
        assertFalse(Repos.allowed("other/repo", listOf(repo)))
        val s = RepoState(repo, "abcdef1", 5, listOf("a.kt"), setOf("cbtodo-1"))
        assertEquals(s, RepoStateCodec.parse(RepoStateCodec.toJson(s)))
        assertTrue(CodebaseNotes.todoListId(repo).startsWith(CodebaseNotes.LIST_PREFIX))
        assertTrue(ReadPrompt.build(repo, "abcdef1").contains("between commit abcdef1"))
        assertTrue(ReadPrompt.build(repo, null).contains("first read"))
    }

    // ---------------------------------------------------------------- voice on code

    private val paths = mapOf(repo to listOf(
        "apps/ax-notes/app/src/main/kotlin/ai/amberx/axf/axnotes/data/NotesStore.kt",
        "apps/ax-notes/README.md",
        "README.md",
        "framework/android/axf-kernel/src/main/kotlin/ai/amberx/axf/kernel/ai/AiModes.kt",
    ))

    @Test fun resolvesSpokenFileNames() {
        assertEquals("apps/ax-notes/app/src/main/kotlin/ai/amberx/axf/axnotes/data/NotesStore.kt", FileResolver.resolve("notes store", paths)!!.path)
        assertEquals("apps/ax-notes/app/src/main/kotlin/ai/amberx/axf/axnotes/data/NotesStore.kt", FileResolver.resolve("the notes store dot kotlin file", paths)!!.path)
        assertEquals("README.md", FileResolver.resolve("readme", paths)!!.path) // shorter path wins the tie
        assertEquals("framework/android/axf-kernel/src/main/kotlin/ai/amberx/axf/kernel/ai/AiModes.kt", FileResolver.resolve("ai modes", paths)!!.path)
        assertEquals("apps/ax-notes/app/src/main/kotlin/ai/amberx/axf/axnotes/data/NotesStore.kt", FileResolver.resolve("note store", paths)!!.path)
        assertNull(FileResolver.resolve("banana bread", paths))
        val l = FileResolver.link(FileResolver.resolve("ai modes", paths)!!, 12, "abcdef1")
        assertEquals(12, l.lineStart)
    }

    @Test fun askPromptCarriesNotes() {
        val link = CodeLink(repo, "README.md", 4, 4, "abcdef1")
        val n = Note("n1", "Readme gap", "The setup step is missing", createdAt = 1, updatedAt = 1, codeLinks = listOf(link.copy(lineStart = 9)))
        val other = Note("n2", "x", "y", createdAt = 1, updatedAt = 1)
        val notes = AskPrompt.notesFor(listOf(n, other), repo, "README.md")
        assertEquals(listOf("n1"), notes.map { it.id })
        val p = AskPrompt.build(link, "why is setup missing?", notes)
        assertTrue(p.contains("README.md around line 4 at commit abcdef1"))
        assertTrue(p.contains("Question: why is setup missing?"))
        assertTrue(p.contains("The setup step is missing"))
        assertTrue(p.contains("read-only"))
    }

    @Test fun shippedTriggersValidateAndMatch() {
        val f = listOf("../plugins/ai-codebase-reader", "plugins/ai-codebase-reader", ".").map { File(it, "assets/axnotes/plugins/ai-codebase-reader/triggers.json") }.firstOrNull { it.exists() }
            ?: return
        val t = PluginTriggers.parse(f.readText(), module)
        assertEquals(listOf("codebase.note-on-file", "codebase.ask-about-file", "codebase.read-now"), t.map { it.id })
        val note = t[0]
        val best = Patterns.best(listOf("note on notes store line 12 saying check the outbox"), note.phrases)
        assertNotNull(best)
        assertEquals("notes store", best!!.match.args["file"]?.toString()?.trim('"'))
        assertEquals("12", best.match.args["line"]?.toString())
        assertEquals("check the outbox", best.match.args["text"]?.toString()?.trim('"'))
        val ask = Patterns.best(listOf("ask about ai modes"), t[1].phrases)!!
        assertEquals("ai modes", ask.match.args["file"]?.toString()?.trim('"'))
    }
}
