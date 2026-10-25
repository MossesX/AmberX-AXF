package ai.amberx.axf.voicevault.voice

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class VoiceActionRulesTest {
    private val open = CustomAction("a1", "Open sites", listOf("show my sites"), ActionKind.OPEN, "vault")

    @Test fun actionsRoundTrip() {
        val list = listOf(open, CustomAction("a2", "Say hi", listOf("say hello"), ActionKind.SAY, "Hello Brett", background = true, on = false))
        assertEquals(list, VoiceActionRules.parseActions(VoiceActionRules.encodeActions(list)))
    }

    @Test fun badStoredActionsAreDropped() {
        val raw = """[{"id":"BAD ID","kind":"open","phrases":["x y"]},{"id":"a3","kind":"nope","phrases":["x y"]},{"id":"a4","kind":"lock","phrases":[]},{"id":"a5","kind":"lock","phrases":["Lock It Up!"]}]"""
        val got = VoiceActionRules.parseActions(raw)
        assertEquals(1, got.size)
        assertEquals("lock it up", got[0].phrases[0])
        assertEquals("lock it up", got[0].label)
        assertTrue(VoiceActionRules.parseActions("not json").isEmpty())
        assertTrue(VoiceActionRules.parseActions(null).isEmpty())
    }

    @Test fun newIdSkipsUsedOnes() {
        assertEquals("a1", VoiceActionRules.newId(emptyList()))
        assertEquals("a3", VoiceActionRules.newId(listOf(open, open.copy(id = "a2"))))
        assertEquals("a3", VoiceActionRules.newId(listOf(open.copy(id = "a2"))))
    }

    @Test fun problems() {
        val none: (String) -> String? = { null }
        assertNull(VoiceActionRules.problem(open, emptyList(), none, setOf("vault")))
        assertNotNull(VoiceActionRules.problem(open.copy(phrases = emptyList()), emptyList(), none))
        assertNotNull(VoiceActionRules.problem(open.copy(phrases = listOf("go")), emptyList(), none))
        assertNull(VoiceActionRules.problem(open.copy(phrases = listOf("banana")), emptyList(), none, setOf("vault")))
        assertNotNull(VoiceActionRules.problem(open, emptyList(), { "vault.store" }))
        assertNull(VoiceActionRules.problem(open, emptyList(), { "custom.a1" }, setOf("vault")))
        assertNotNull(VoiceActionRules.problem(open, listOf(open.copy(id = "a9", label = "Other")), none))
        assertNotNull(VoiceActionRules.problem(open.copy(arg = "nowhere"), emptyList(), none, setOf("vault")))
        assertNotNull(VoiceActionRules.problem(open.copy(kind = ActionKind.SAY, arg = ""), emptyList(), none))
        assertNotNull(VoiceActionRules.problem(open.copy(kind = ActionKind.RETRIEVE_SITE, arg = ""), emptyList(), none))
        assertNotNull(VoiceActionRules.problem(open.copy(kind = ActionKind.RUN, arg = "app.settings", background = true), emptyList(), none))
        assertNull(VoiceActionRules.problem(open.copy(kind = ActionKind.LOCK, arg = "", background = true), emptyList(), none))
    }

    @Test fun switches() {
        val off = VoiceActionRules.parseOff("vault.wake, vault.confirm,,custom.a1")
        assertEquals(setOf("vault.wake", "custom.a1"), off)
        assertFalse(VoiceActionRules.isOn("vault.wake", off))
        assertTrue(VoiceActionRules.isOn("vault.confirm", off + "vault.confirm"))
        assertTrue(VoiceActionRules.isOn("vault.store", off))
        assertEquals("custom.a1,vault.wake", VoiceActionRules.encodeOff(off + "vault.cancel"))
    }

    @Test fun quietHours() {
        assertEquals(22 * 60 + 30, VoiceActionRules.minutesOf("22:30"))
        assertEquals(7 * 60, VoiceActionRules.minutesOf("7"))
        assertNull(VoiceActionRules.minutesOf("24:00"))
        assertNull(VoiceActionRules.minutesOf("7:60"))
        assertEquals("7:05", VoiceActionRules.clock(7 * 60 + 5))
        val from = 22 * 60; val to = 7 * 60
        assertTrue(VoiceActionRules.isQuiet(23 * 60, from, to))
        assertTrue(VoiceActionRules.isQuiet(3 * 60, from, to))
        assertFalse(VoiceActionRules.isQuiet(12 * 60, from, to))
        assertFalse(VoiceActionRules.isQuiet(7 * 60, from, to))
        assertTrue(VoiceActionRules.isQuiet(13 * 60, 12 * 60, 14 * 60))
        assertFalse(VoiceActionRules.isQuiet(5, 300, 300))
        assertEquals(0L, VoiceActionRules.msUntilQuietEnds(12 * 60, 0, from, to))
        assertEquals(60_000L, VoiceActionRules.msUntilQuietEnds(6 * 60 + 59, 0, from, to))
        assertEquals(30_000L, VoiceActionRules.msUntilQuietEnds(6 * 60 + 59, 30, from, to))
        assertEquals(9 * 3_600_000L, VoiceActionRules.msUntilQuietEnds(22 * 60, 0, from, to))
    }

    @Test fun heardLog() {
        var log = emptyList<HeardEntry>()
        repeat(VoiceActionRules.MAX_LOG + 5) { log = VoiceActionRules.append(log, HeardEntry(it.toLong(), "Global trigger", "hey vault", "background")) }
        assertEquals(VoiceActionRules.MAX_LOG, log.size)
        assertEquals(VoiceActionRules.MAX_LOG + 4L, log.first().at)
        assertEquals(log, VoiceActionRules.parseLog(VoiceActionRules.encodeLog(log)))
    }

    @Test fun describes() {
        assertEquals("Opens Saved sites", VoiceActionRules.describe(open, { if (it == "vault") "Saved sites" else it }))
        assertEquals("Starts saving a password for gmail.com", VoiceActionRules.describe(open.copy(kind = ActionKind.STORE, arg = "gmail.com")))
        assertEquals("custom.a1", open.commandId)
    }
}
