package ai.amberx.axf.readaloud

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ReadAloudRulesTest {
    private val p = ReadAloudPrefs.DEFAULT

    @Test fun prefsClampAndFallBack() {
        val v = mapOf("x.rate" to "9", "x.pitch" to "abc", "x.urls" to "nope", "x.queue" to "append", "x.maxUtterance" to "5", "x.voice" to "auto")
        val r = ReadAloudPrefs.from("x.") { v[it] }
        assertEquals(4.0, r.rate, 0.0)
        assertEquals(1.0, r.pitch, 0.0)
        assertEquals(UrlMode.DOMAIN, r.urls)
        assertEquals(QueuePolicy.APPEND, r.queue)
        assertEquals(40, r.maxUtterance)
        assertEquals("", r.voice)
    }

    @Test fun rateForSlowAndLongText() {
        val q = p.copy(longTextBoost = true, longTextChars = 100, longTextRate = 1.5)
        assertEquals(1.5, q.rateFor(200), 0.0)
        assertEquals(1.0, q.rateFor(50), 0.0)
        assertEquals(0.6, q.rateFor(200, slow = true), 0.0)
    }

    @Test fun prepCleansText() {
        val s = TextPrep.prepare("**Hi** #team, see https://www.example.com/x?y=1 😀 e.g. now (aside)", p.copy(skipBrackets = true))
        assertEquals("Hi team, see link to example.com for example now", s)
        assertEquals("N A S A rocks", TextPrep.prepare("NASA rocks", p.copy(spellCaps = true)))
        assertEquals("say jif", TextPrep.prepare("say GIF", p.copy(pronunciations = "GIF=jif; =bad")))
        assertEquals("1 2 3", TextPrep.prepare("123", p.copy(numbers = NumberMode.DIGITS)))
        assertEquals("one two\n\nthree", TextPrep.prepare("one\ntwo\n\n\n three", p))
        assertEquals("hyphenated", TextPrep.prepare("hyphen-\nated", p))
    }

    @Test fun limitModes() {
        val t = "First one. Second sentence here."
        assertEquals("First one.", TextPrep.limit(t, 20, OverLimit.SENTENCE))
        assertEquals("First one. Second s", TextPrep.limit(t, 19, OverLimit.CUT))
        assertNull(TextPrep.limit(t, 5, OverLimit.REFUSE))
        assertEquals(t, TextPrep.limit(t, 100, OverLimit.REFUSE))
    }

    @Test fun chunkSentencesWithOffsetsAndPauses() {
        val text = "One. Two!\n\nThree?"
        val u = TextChunker.chunk(text, p)
        assertEquals(listOf("One.", "Two!", "Three?"), u.map { it.text })
        u.forEach { assertEquals(it.text, text.substring(it.start, it.end)) }
        assertEquals(p.sentencePauseMs, u[0].pauseAfterMs)
        assertEquals(p.paragraphPauseMs, u[1].pauseAfterMs)
        assertTrue(u[1].paragraphEnd)
        assertEquals(0, u[2].pauseAfterMs)
    }

    @Test fun longPiecesSplitOnSpaces() {
        val text = (1..40).joinToString(" ") { "word$it" }
        val u = TextChunker.chunk(text, p.copy(chunk = ChunkMode.PARAGRAPH, maxUtterance = 60))
        assertTrue(u.size > 1)
        assertTrue(u.all { it.text.length <= 60 })
        u.forEach { assertEquals(it.text, text.substring(it.start, it.end)) }
    }

    @Test fun skipByParagraph() {
        val u = TextChunker.chunk("A. B.\n\nC. D.\n\nE.", p)
        assertEquals(2, TextChunker.skip(u, 0, true, SkipUnit.PARAGRAPH))
        assertEquals(2, TextChunker.skip(u, 3, false, SkipUnit.PARAGRAPH))
        assertEquals(0, TextChunker.skip(u, 2, false, SkipUnit.PARAGRAPH))
        assertEquals(1, TextChunker.skip(u, 0, true, SkipUnit.SENTENCE))
        assertEquals(1..5, TextChunker.wordAt(" hello there", 3))
    }

    @Test fun queuePolicies() {
        fun item(id: Long) = ReadAloudPlan.item("Item $id.", p, id, "t$id")!!
        var q = ReadQueue().add(item(1), QueuePolicy.APPEND, 3, 5, 0)
        assertEquals(1L, q.current?.id)
        q = q.add(item(2), QueuePolicy.APPEND, 3, 5, 0).add(item(3), QueuePolicy.NEXT, 3, 5, 0)
        assertEquals(listOf(3L, 2L), q.next.map { it.id })
        q = q.add(item(4), QueuePolicy.APPEND, 3, 5, 0)
        assertEquals(2, q.next.size)
        q = q.add(item(5), QueuePolicy.REPLACE, 3, 5, 0)
        assertEquals(5L, q.current?.id)
        assertEquals(listOf(3L, 2L), q.next.map { it.id })
        assertEquals(1, q.history.size)
        q = q.finish(true, 5, 1)
        assertEquals(3L, q.current?.id)
        assertTrue(q.history.first().finished)
        assertFalse(q.clear(5, 2).let { it.current != null || it.next.isNotEmpty() })
    }

    @Test fun planAndRepeat() {
        assertNull(ReadAloudPlan.item("   ", p, 1, "x"))
        assertNull(ReadAloudPlan.item("a".repeat(500), p.copy(maxChars = 100, overLimit = OverLimit.REFUSE), 1, "x"))
        assertTrue(ReadAloudPlan.shouldRepeat(p.copy(repeat = RepeatMode.TIMES, repeatTimes = 2), 1))
        assertFalse(ReadAloudPlan.shouldRepeat(p.copy(repeat = RepeatMode.TIMES, repeatTimes = 2), 2))
        assertFalse(ReadAloudPlan.shouldRepeat(p, 0))
    }

    @Test fun everySettingIsReadAndInRange() {
        val asked = mutableSetOf<String>()
        ReadAloudPrefs.from("x.") { asked += it; null }
        val keys = ReadAloudSettings.keys("x.").toSet()
        assertEquals(keys, asked)
        for (g in ReadAloudSettings.groups("x.", "tab", "m")) for (s in g.settings) if (s.min != null) {
            val v = (s.default as kotlinx.serialization.json.JsonPrimitive).content.toDouble()
            assertTrue("${s.key} default in range", v >= s.min!! && v <= s.max!!)
        }
    }
}
