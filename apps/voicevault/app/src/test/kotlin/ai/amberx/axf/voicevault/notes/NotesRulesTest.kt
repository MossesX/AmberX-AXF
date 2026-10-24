package ai.amberx.axf.voicevault.notes

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The same cases as the console plugin's `voice-notes/core-check.mts`: both sides must read the hub's data alike. */
class NotesRulesTest {
    private val s = NotesRules.settings(null)
    private val lists = listOf(
        """{"number":1,"name":"Groceries","aliases":["shopping"],"askSubcategory":true,
            "subcategories":[{"id":"dairy","number":1,"name":"Dairy","aliases":["milk stuff"]},{"id":"veg","number":2,"name":"Vegetables","aliases":[]}],
            "questionSets":[{"id":"a","label":"Always","trigger":{"kind":"always"},"subcategory":"","questions":[{"id":"q1","ask":"Which store?","field":"store"}]},
              {"id":"b","label":"Urgent","trigger":{"kind":"phrase","phrase":"urgent"},"subcategory":"veg","questions":[]},
              {"id":"n","label":"Three","trigger":{"kind":"number","number":3},"subcategory":"","questions":[]}]}""" to "g",
        """{"number":2,"name":"Work ideas"}""" to "w",
        """{"number":12,"name":"Dentist"}""" to "d",
    ).map { (j, id) -> NotesRules.list(Json.parseToJsonElement(j), id)!! }

    private fun obj(j: String): JsonObject = Json.parseToJsonElement(j).jsonObject

    @Test fun defaultsAndClamps() {
        assertTrue(s.startTriggers.isNotEmpty() && s.stopTriggers.isNotEmpty() && s.beep.on)
        val x = NotesRules.settings(obj("""{"beep":{"hz":99999,"ms":-4,"volume":3},"maxSeconds":"x","language":"bad lang!"}"""))
        assertEquals(4000, x.beep.hz); assertEquals(40, x.beep.ms); assertEquals(1.0, x.beep.volume, 0.0); assertEquals(120, x.maxSeconds); assertEquals("en-US", x.language)
        assertEquals("Stop note|end", NotesRules.phrases(Json.parseToJsonElement("""["Stop note","stop  note!","","end"]"""), emptyList()).joinToString("|"))
    }

    @Test fun stopTrigger() {
        val st = NotesRules.stripStopTrigger("Buy milk and eggs. Stop note", s.stopTriggers)
        assertEquals("Buy milk and eggs", st.text); assertEquals("stop note", st.cut)
        assertEquals("remember the stop note thing", NotesRules.stripStopTrigger("remember the stop note thing end note", s.stopTriggers).text)
        assertNull(NotesRules.stripStopTrigger("no trigger here", s.stopTriggers).cut)
    }

    @Test fun numbersAndPicks() {
        assertEquals(listOf(3, 3, 12, 21, 2, 7, null), listOf("3", "three", "number twelve", "twenty one", "the second one", "list 7", "nothing").map(NotesRules::spokenNumber))
        assertEquals("w", NotesRules.pickList("number two", lists)?.id)
        assertEquals("g", NotesRules.pickList("put it in shopping", lists)?.id)
        assertEquals("d", NotesRules.pickList("twelve", lists)?.id)
        assertNull(NotesRules.pickList("the moon", lists))
        assertTrue(NotesRules.asksForLists("ok give me the list of lists please", s))
        assertTrue(NotesRules.isCancel("never mind", s))
        assertEquals("veg", NotesRules.pickSubcategory("two", lists[0])?.id)
        assertEquals("dairy", NotesRules.pickSubcategory("milk stuff", lists[0])?.id)
        assertEquals("b", NotesRules.pickQuestionSet("this is urgent", lists[0])?.id)
        assertEquals("n", NotesRules.pickQuestionSet("three", lists[0])?.id)
        assertEquals("a", NotesRules.pickQuestionSet("whatever", lists[0])?.id)
        assertEquals(listOf("1: Groceries", "2: Work ideas", "12: Dentist"), NotesRules.readLists(s, lists.reversed()))
        assertNull(NotesRules.list(Json.parseToJsonElement("\"nope\""), "x"))
        assertEquals("Saved to Groceries › Vegetables.", NotesRules.confirmText(s, lists[0], lists[0].subcategories[1]))
    }

    @Test fun noteRows() {
        val row = NoteRecord("n1", "g", "veg", "buy milk", mapOf("store" to "Aldi"), "2026-10-23T16:00:00Z", "voice-vault", "Pixel").toJson()
        assertEquals("buy milk", (row["text"] as kotlinx.serialization.json.JsonPrimitive).content)
        assertTrue(HubTables.chunk((1..300).associate { "r$it" to row }, 10_000).let { parts -> parts.size > 1 && parts.sumOf { it.size } == 300 && parts.all { Json.encodeToString(JsonObject.serializer(), JsonObject(it)).length <= 10_000 } })
    }
}
