package ai.amberx.axf.axnotes.model

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate
import java.time.ZoneOffset

class ListRulesTest {
    private val cats = listOf(Category("work", "Work", 0), Category("home", "Home", 1), Category("ideas", "Ideas", 2))

    private fun note(id: String, at: Long, cat: String = "", pr: Priority = Priority.NONE, tags: List<String> = emptyList(), lists: List<String> = emptyList(), text: String = "text $id") =
        Note(id, "Title $id", text, cat, tags, createdAt = at, updatedAt = at, listIds = lists, priority = pr)

    private fun item(id: String, text: String, at: Long = 0, done: Boolean = false, due: Long? = null, pr: Priority = Priority.NONE, cat: String = "") =
        TodoItem(id, text, done, due, pr, category = cat, createdAt = at, updatedAt = at)

    private val notes = listOf(
        note("a", 100, "work", Priority.LOW, listOf("Urgent"), listOf("L")),
        note("b", 300, "home", Priority.HIGH, lists = listOf("L")),
        note("c", 200, "", Priority.MEDIUM, listOf("urgent", "x"), listOf("L")),
        note("d", 400, "ideas", text = "Buy oat milk on Friday"),
    )

    private fun list(sort: ListSort, desc: Boolean = true, order: List<String> = emptyList()) = NoteList("L", "Mine", ListKind.NOTES, sort, desc, order, createdAt = 0, updatedAt = 0)

    @Test fun manualListHoldsItsNotesOnly() {
        assertEquals(listOf("b", "c", "a"), ListRules.notesOf(list(ListSort.DATE), notes).map { it.id })
        assertEquals(listOf("a", "c", "b"), ListRules.notesOf(list(ListSort.DATE, desc = false), notes).map { it.id })
    }

    @Test fun categorySortPutsUncategorizedLast() {
        assertEquals(listOf("b", "a", "c"), ListRules.notesOf(list(ListSort.CATEGORY, desc = false), notes, cats).map { it.id })
        assertEquals(listOf("a", "b", "c"), ListRules.notesOf(list(ListSort.CATEGORY, desc = true), notes, cats).map { it.id })
    }

    @Test fun prioritySortHighestFirst() {
        assertEquals(listOf("b", "c", "a"), ListRules.notesOf(list(ListSort.PRIORITY), notes, cats).map { it.id })
    }

    @Test fun manualOrderThenNewestForUnplaced() {
        assertEquals(listOf("a", "b", "c"), ListRules.notesOf(list(ListSort.MANUAL, order = listOf("a", "zz")), notes).map { it.id })
        assertEquals(listOf("c", "a", "b"), ListRules.notesOf(list(ListSort.MANUAL, order = listOf("c", "a", "b")), notes).map { it.id })
    }

    @Test fun moveReordersAndKeepsEveryId() {
        assertEquals(listOf("b", "c", "a"), ListRules.move(listOf("a", "b", "c"), "a", 2))
        assertEquals(listOf("c", "a", "b"), ListRules.move(listOf("a", "b", "c"), "c", 0))
        assertEquals(listOf("a", "b", "c"), ListRules.move(listOf("a", "b", "c"), "x", 0))
        assertEquals(listOf("b", "c", "a"), ListRules.move(listOf("a", "b", "c"), "a", 99))
    }

    @Test fun smartListFilters() {
        fun smart(f: SmartFilter) = NoteList("S", "Smart", ListKind.SMART, ListSort.DATE, filter = f, createdAt = 0, updatedAt = 0)
        assertEquals(listOf("d", "b", "c", "a"), ListRules.notesOf(smart(SmartFilter()), notes).map { it.id })
        assertEquals(listOf("a"), ListRules.notesOf(smart(SmartFilter(category = "work")), notes).map { it.id })
        assertEquals(listOf("c", "a"), ListRules.notesOf(smart(SmartFilter(tag = "URGENT")), notes).map { it.id })
        assertEquals(listOf("b", "c"), ListRules.notesOf(smart(SmartFilter(fromAt = 200, toAt = 300)), notes).map { it.id })
        assertEquals(listOf("d"), ListRules.notesOf(smart(SmartFilter(text = "oat MILK")), notes).map { it.id })
        assertEquals(emptyList<String>(), ListRules.notesOf(smart(SmartFilter(text = "oat milk", category = "work")), notes).map { it.id })
    }

    @Test fun searchMatchesTitleTextAndTags() {
        assertEquals(listOf("d"), ListRules.search(notes, "friday").map { it.id })
        assertEquals(listOf("c"), ListRules.search(notes, "x").map { it.id })
        assertEquals(4, ListRules.search(notes, "  ").size)
    }

    @Test fun todosOpenFirstThenSort() {
        val items = listOf(
            item("1", "milk", at = 1, due = 50), item("2", "eggs", at = 2, done = true, due = 10), item("3", "bread", at = 3),
            item("4", "call bank", at = 4, due = 20, pr = Priority.HIGH), item("5", "tax", at = 5, pr = Priority.MEDIUM, cat = "work"),
        )
        assertEquals(listOf("4", "1", "3", "5", "2"), ListRules.sortTodos(items, ListSort.DATE, false, emptyList(), cats).map { it.id })
        assertEquals(listOf("4", "5", "1", "3", "2"), ListRules.sortTodos(items, ListSort.PRIORITY, true, emptyList(), cats).map { it.id })
        assertEquals(listOf("5", "1", "3", "4", "2"), ListRules.sortTodos(items, ListSort.CATEGORY, false, emptyList(), cats).map { it.id })
        assertEquals(listOf("2", "3", "1", "4", "5"), ListRules.sortTodos(items, ListSort.MANUAL, false, listOf("2", "3"), cats).map { it.id })
    }

    @Test fun groupsByCategoryTagAndDay() {
        assertEquals(listOf("Home", "Ideas", "Work", "Uncategorized"), ListRules.byCategory(notes, cats).map { it.first })
        assertEquals(listOf("#urgent", "#x", "No tags"), ListRules.byTag(notes).map { it.first })
        assertEquals(listOf("c", "a"), ListRules.byTag(notes)[0].second.map { it.id })
        val zone = ZoneOffset.UTC
        val day = 86_400_000L
        val byDay = ListRules.byDay(listOf(note("p", 10), note("q", day + 10), note("r", day + 20)), zone)
        assertEquals(listOf(LocalDate.of(1970, 1, 2), LocalDate.of(1970, 1, 1)), byDay.map { it.first })
        assertEquals(listOf("r", "q"), byDay[0].second.map { it.id })
        assertEquals(day to 2 * day - 1, ListRules.dayRange(LocalDate.of(1970, 1, 2), zone))
        assertEquals(day, ListRules.parseDay(" 1970-01-02 ", zone))
        assertEquals(2 * day - 1, ListRules.parseDay("1970-01-02", zone, endOfDay = true))
        assertNull(ListRules.parseDay("next friday", zone))
        assertEquals("1970-01-02", ListRules.isoDay(day + 5, zone))
    }

    @Test fun checkOffByFuzzyText() {
        val items = listOf(item("1", "Buy milk"), item("2", "Call the bank about the card"), item("3", "Pick up dry cleaning"), item("4", "Pay rent", done = true))
        assertEquals("1", (ListRules.checkOff("by milk", items) as ListRules.CheckOff.Found).item.id)
        assertEquals("1", (ListRules.checkOff("the milk", items) as ListRules.CheckOff.Found).item.id)
        assertEquals("2", (ListRules.checkOff("call bank", items) as ListRules.CheckOff.Found).item.id)
        assertEquals("3", (ListRules.checkOff("dry cleaning", items) as ListRules.CheckOff.Found).item.id)
        assertEquals("4", (ListRules.checkOff("pay rent", items) as ListRules.CheckOff.AlreadyDone).item.id)
        assertEquals(ListRules.CheckOff.None, ListRules.checkOff("walk the dog", items))
        val twins = listOf(item("a", "Email Sam"), item("b", "Email Pam"))
        assertTrue(ListRules.checkOff("email am", twins) is ListRules.CheckOff.Ambiguous)
        assertEquals("a", (ListRules.checkOff("email sam", twins) as ListRules.CheckOff.Found).item.id)
    }

    @Test fun findsListsAndSplitsTargets() {
        val lists = listOf(
            NoteList("g", "Groceries", ListKind.TODO, createdAt = 0, updatedAt = 0),
            NoteList("w", "Work tasks", ListKind.TODO, createdAt = 0, updatedAt = 0),
            NoteList("n", "Reading", ListKind.NOTES, createdAt = 0, updatedAt = 0),
        )
        assertEquals("g", ListRules.findList("grocery list", lists)?.id)
        assertEquals("w", ListRules.findList("work tasks", lists)?.id)
        assertNull(ListRules.findList("holiday", lists))
        assertEquals("buy milk" to lists[0], ListRules.splitTarget("buy milk to groceries", lists))
        assertEquals("buy milk" to lists[0], ListRules.splitTarget("buy milk to the groceries list", lists))
        assertEquals("email boss" to lists[1], ListRules.splitTarget("email boss on my work tasks", lists))
        assertEquals("go to the gym" to null, ListRules.splitTarget("go to the gym", lists))
        // A note list is never a to-do target.
        assertEquals("finish book in reading" to null, ListRules.splitTarget("finish book in reading", lists))
    }

    @Test fun codeLinksOpenOnGithub() {
        assertEquals("https://github.com/MossesX/AmberX-AXF/blob/abc1234/apps/x/A.kt#L10-L20", CodeLink("MossesX/AmberX-AXF", "apps/x/A.kt", 10, 20, "abc1234").githubUrl())
        assertEquals("https://github.com/MossesX/AmberX-AXF/blob/HEAD/README.md#L3", CodeLink("MossesX/AmberX-AXF", "/README.md", 3).githubUrl())
        assertNull(CodeLink("not a repo", "a.kt").githubUrl())
        assertNull(CodeLink("o/r", "../etc/passwd").githubUrl())
        assertEquals("AmberX-AXF:a.kt:3-4", CodeLink("MossesX/AmberX-AXF", "a.kt", 3, 4).label())
    }

    @Test fun categoriesResolveBySlugOrName() {
        assertEquals("work", Categories.resolve("WORK", cats).id)
        assertEquals("ideas", Categories.resolve("idea", cats).id)
        val fresh = Categories.resolve("garden plans", cats)
        assertEquals("garden-plans", fresh.id); assertEquals("Garden plans", fresh.name)
        assertEquals("Uncategorized", Categories.nameOf("", cats))
    }
}
