package ai.amberx.axf.xselect

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class XSelectRulesTest {
    @Test fun menuEntries() {
        assertEquals(emptySet<String>(), XSelectMenu.enabled(false, "Speak", true, true, true))
        assertEquals(setOf("Speak", "ReadSlowly"), XSelectMenu.enabled(true, "Speak", true, false, false))
        assertEquals(setOf("ReadAloud"), XSelectMenu.enabled(true, "Bogus", false, false, false))
        assertTrue(XSelectMenu.entry("ReadSlowly").slow)
        assertTrue(XSelectMenu.entry("ReadNext").readNext)
        assertEquals("ReadAloud", XSelectMenu.entry("Unknown").alias)
        assertEquals(7, XSelectMenu.ALL.size)
    }

    @Test fun spellAndIntro() {
        assertEquals("A B 1. x y", XSelectMenu.spelled(" AB1  xy "))
        assertEquals("120 words.", XSelectMenu.intro(120, 50_000))
        assertEquals("About 3 minutes.", XSelectMenu.intro(500, 170_000))
        assertEquals("1 word.", XSelectMenu.intro(1, 100))
    }

    @Test fun badges() {
        assertEquals("success", XSelectBadge.hub("ok", 0, false).tone)
        assertEquals("axHub · 2 waiting", XSelectBadge.hub("ok", 2, false).label)
        assertEquals("warning", XSelectBadge.hub("signed-out", 0, false).tone)
        assertEquals("danger", XSelectBadge.hub("unreachable", 0, false).tone)
        assertEquals("muted", XSelectBadge.hub(null, 0, true).tone)
        assertEquals("Reading 1.25×", XSelectBadge.reading(false, 1.25, 0, 3).label)
        assertEquals("Reading 2×", XSelectBadge.reading(false, 2.0, 0, 3).label)
        assertEquals("Paused", XSelectBadge.reading(true, 1.0, 0, 3).label)
    }
}
