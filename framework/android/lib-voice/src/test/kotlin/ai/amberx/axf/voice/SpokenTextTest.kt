package ai.amberx.axf.voice

import org.junit.Test
import kotlin.test.assertEquals

class SpokenTextTest {
    @Test fun sitesFromSpeech() {
        assertEquals("gmail.com", SpokenText.site("Gmail dot com"))
        assertEquals("gmail.com", SpokenText.site("  gmail DOT com  "))
        assertEquals("netflix.com", SpokenText.site("www.Netflix.com"))
        assertEquals("bank of america", SpokenText.site("Bank   of America"))
        assertEquals("mail.google.com", SpokenText.site("mail dot google dot com"))
        assertEquals("example.org", SpokenText.site("example.org."))
        assertEquals("", SpokenText.site("   "))
    }

    @Test fun passwordsKeptAsHeard() {
        assertEquals("HunterTwo!", SpokenText.password("  Hunter Two!  "))
        assertEquals("ab12cd", SpokenText.password("ab 12\tcd"))
    }

    @Test fun codesIgnorePunctuationAndCase() {
        assertEquals("purple monkey dishwasher", SpokenText.code("Purple, Monkey -- Dishwasher!"))
        assertEquals(SpokenText.code("purple monkey"), SpokenText.code("PURPLE   monkey."))
        assertEquals("", SpokenText.code("?!"))
    }
}
