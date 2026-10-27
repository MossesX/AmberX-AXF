package ai.amberx.axf.axnotes.plugins.codebase

import ai.amberx.axf.kernel.triggers.Patterns
import ai.amberx.axf.kernel.triggers.TriggerValidation
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.ZoneOffset

class CodebaseTest {
    private val repo = "MossesX/AmberX-AXF"
    private val prefix = CodebaseReaderPlugin.PREFIX

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
        assertEquals("high", first.items.first { it.text.startsWith("FIXME") }.priority)
        val mine = TodoItem("todo-mine", "My own item", createdAt = 1, updatedAt = 1)
        val list1 = first.items + mine

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
        assertEquals(mine, second.items.last())
        val p = second.syncPayload("L", "TODOs · AmberX-AXF", CodebaseReaderPlugin.ID)
        assertEquals(listOf(readme), J.strings(p["close"]))
        assertEquals(wired.id, J.objects(p["update"]).map { J.str(it, "id") }.first { it == wired.id })
        assertEquals("L", J.str(p["list"] as kotlinx.serialization.json.JsonObject, "id"))

        val ticked = second.items.map { if (it.id == wired.id) it.copy(done = true, doneAt = 25) else it }
        val third = CodeTodos.merge(ticked, CodeTodos.scan(repo, v1, "ccccccc"), second.autoClosed, 30)
        assertEquals(listOf(readme), third.reopened)
        assertFalse(third.items.first { it.id == readme }.done)
        assertTrue(third.items.first { it.id == wired.id }.done)
        assertFalse(readme in third.autoClosed)

        val again = CodeTodos.merge(third.items, CodeTodos.scan(repo, v1, "ccccccc"), third.autoClosed, 40)
        assertFalse(again.changed)
        assertEquals(third.items, again.items)
        for (i in third.items) assertEquals(i, TodoItem.parse(i.toJson()))
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
        assertNull(ReadReply.parse("{\"commit\":\"abcdef1\"}", repo)!!.todos)
    }

    @Test fun notesKeyedByCommit() {
        val r = ReadReply.parse(reply, repo)!!
        val first = CodebaseNotes.plan(prefix, r, null, 1000, ZoneOffset.UTC)
        assertEquals(listOf(CodebaseNotes.archId(prefix, repo)), first.map { it.id })
        val arch = first[0]
        assertEquals("ai", arch.source)
        assertTrue(arch.text.startsWith("Read at commit 0123456"))
        assertEquals("https://github.com/MossesX/AmberX-AXF/blob/0123456789abcdef0123456789abcdef01234567/framework/android/axf-kernel", arch.codeLinks[0].githubUrl())
        val p = arch.payload()
        assertEquals(arch.id, J.str(p, "id"))
        assertEquals("Codebase", J.str(p, "category"))

        val second = CodebaseNotes.plan(prefix, r, RepoState(repo, "fedcba9876543210", 500), 2000, ZoneOffset.UTC)
        assertEquals(2, second.size)
        val changes = second[1]
        assertEquals(CodebaseNotes.changesId(prefix, repo, r.commit), changes.id)
        assertTrue(changes.title.startsWith("Changes since fedcba9"))
        assertEquals("https://github.com/MossesX/AmberX-AXF/blob/0123456789abcdef0123456789abcdef01234567/a.kt#L3-L9", changes.codeLinks.single().githubUrl())
        assertEquals(1, CodebaseNotes.plan(prefix, r, RepoState(repo, r.commit, 500), 3000, ZoneOffset.UTC).size)
        assertTrue(CodebaseNotes.todoListId(prefix, repo).startsWith(prefix))
    }

    @Test fun reposSettingAndState() {
        assertEquals(listOf("MossesX/AmberX-AXF", "a/b"), Repos.parse("MossesX/AmberX-AXF\nhttps://github.com/a/b.git, bad, ../x/y, mossesx/amberx-axf"))
        assertTrue(Repos.allowed("mossesx/AMBERX-axf", listOf(repo)))
        assertFalse(Repos.allowed("other/repo", listOf(repo)))
        val item = TodoItem("cbtodo-1", "X", createdAt = 1, updatedAt = 1, codeLinks = listOf(CodeLink(repo, "a.kt", 1, 1)))
        val s = RepoState(repo, "abcdef1", 5, listOf("a.kt"), setOf("cbtodo-1"), listOf(item))
        assertEquals(s, RepoStateCodec.parse(RepoStateCodec.toJson(s)))
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
        val store = "apps/ax-notes/app/src/main/kotlin/ai/amberx/axf/axnotes/data/NotesStore.kt"
        assertEquals(store, FileResolver.resolve("notes store", paths)!!.path)
        assertEquals(store, FileResolver.resolve("the notes store dot kotlin file", paths)!!.path)
        assertEquals(store, FileResolver.resolve("note store", paths)!!.path)
        assertEquals("README.md", FileResolver.resolve("readme", paths)!!.path)
        assertEquals("framework/android/axf-kernel/src/main/kotlin/ai/amberx/axf/kernel/ai/AiModes.kt", FileResolver.resolve("ai modes", paths)!!.path)
        assertNull(FileResolver.resolve("banana bread", paths))
        assertEquals(12, FileResolver.link(FileResolver.resolve("ai modes", paths)!!, 12, "abcdef1").lineStart)
    }

    @Test fun askPromptCarriesNotes() {
        val link = CodeLink(repo, "README.md", 4, 4, "abcdef1")
        val noteJson = J.parse("""{"id":"n1","title":"Readme gap","text":"The setup step is missing","updatedAt":3,"codeLinks":[{"repo":"$repo","path":"README.md","lineStart":9}]}""")
        val n = LinkedNote.fromNote(noteJson)!!
        assertEquals(n, LinkedNote.parse(n.toJson()))
        assertNull(LinkedNote.fromNote(J.parse("""{"id":"n2","codeLinks":[]}""")))
        val notes = AskPrompt.notesFor(listOf(n), repo, "README.md")
        assertEquals(listOf("n1"), notes.map { it.id })
        val p = AskPrompt.build(link, "why is setup missing?", notes)
        assertTrue(p.contains("README.md around line 4 at commit abcdef1"))
        assertTrue(p.contains("Question: why is setup missing?"))
        assertTrue(p.contains("The setup step is missing"))
        val save = AskPrompt.notePayload("Note on x", "t", link, "voice")
        assertEquals(link, CodeLink.parse(J.objects(save["codeLinks"]).single()))
    }

    @Test fun voiceTriggersValidateAndMatch() {
        val t = CodeTriggers.all(CodebaseReaderPlugin.ID)
        for (x in t) assertTrue(x.id, TriggerValidation.validate(x.toJson()).ok)
        val best = Patterns.best(listOf("note on notes store line 12 saying check the outbox"), t[0].phrases)
        assertNotNull(best)
        assertEquals("notes store", best!!.match.args["file"]?.toString()?.trim('"'))
        assertEquals("12", best.match.args["line"]?.toString())
        assertEquals("check the outbox", best.match.args["text"]?.toString()?.trim('"'))
        assertEquals("ai modes", Patterns.best(listOf("ask about ai modes"), t[1].phrases)!!.match.args["file"]?.toString()?.trim('"'))
    }
}
