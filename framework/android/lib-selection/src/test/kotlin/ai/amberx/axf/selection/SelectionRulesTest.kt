package ai.amberx.axf.selection

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SelectionRulesTest {
    @Test fun cleansInvisibleAndControlCharacters() {
        val s = SelectionRules.clean("  Hel​lo­ wor\u0007ld\r\nnext  ", "ReadAloud")
        assertEquals("Hello world\nnext", s.text)
        assertEquals("ReadAloud", s.entry)
        assertFalse(s.truncated)
    }

    @Test fun cutsLongTextOnAWordBoundary() {
        val s = SelectionRules.clean("one two three four five six seven", maxChars = 20)
        assertTrue(s.truncated)
        assertEquals("one two three four", s.text)
        assertEquals(33, s.originalLength)
    }

    @Test fun capIsClamped() {
        assertEquals("a", SelectionRules.clean("abc", maxChars = 0).text)
        assertTrue(SelectionRules.clean(null).isEmpty)
    }

    @Test fun previewAndWords() {
        assertEquals("First line", SelectionRules.preview("\n  First line\nsecond"))
        assertEquals("abcdefg…", SelectionRules.preview("abcdefghijk", 8))
        assertEquals(4, SelectionRules.words("It's 3 o'clock, folks."))
    }
}
