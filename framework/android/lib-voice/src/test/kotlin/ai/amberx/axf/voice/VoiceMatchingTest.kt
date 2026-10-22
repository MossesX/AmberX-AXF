package ai.amberx.axf.voice

import ai.amberx.axf.kernel.platform.MemoryKeyValueStore
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class VoiceMatchingTest {
    @Test fun normalizes() {
        assertEquals("store password", PhraseMatcher.normalize("  Store,  Password! "))
        assertEquals("gmail com", PhraseMatcher.normalizeLabel("www.Gmail.com"))
        assertEquals("gmail com", PhraseMatcher.normalizeLabel("gmail dot com"))
    }

    @Test fun labelsMatchSpokenSites() {
        assertEquals(1.0, PhraseMatcher.labelScore("gmail dot com", "gmail.com"))
        assertTrue(PhraseMatcher.labelScore("gmail", "gmail.com") > 0.95)
        assertTrue(PhraseMatcher.labelScore("netflix", "gmail.com") < 0.5)
        val best = PhraseMatcher.best(listOf("amazon", "amazing"), listOf("gmail.com", "amazon.com", "bank of america"), 0.75, { it })
        assertEquals("amazon.com", best?.item)
    }

    @Test fun commandsMatchDefaultsAndCustomPhrases() {
        val kv = MemoryKeyValueStore()
        val c = VoiceCommands(kv)
        c.register(VoiceCommand("store", "Store password", listOf("store password", "save password")))
        c.register(VoiceCommand("retrieve", "Retrieve password", listOf("retrieve password", "recover password")))
        assertEquals("store", c.match(listOf("store password"))?.commandId)
        assertEquals("retrieve", c.match(listOf("okay recover password please"))?.commandId)
        assertEquals("retrieve", c.match(listOf("retreive password"))?.commandId) // small mishearing
        assertNull(c.match(listOf("what's the weather")))
        assertNull(c.addPhrase("store", "Lock it in"))
        assertEquals("store", c.match(listOf("lock it in"))?.commandId)
        assertNotNull(c.addPhrase("retrieve", "lock it in")) // already used by another command
        assertNull(c.match(listOf("store password"), among = listOf("retrieve")))
        // persisted
        val again = VoiceCommands(kv).apply { register(VoiceCommand("store", "Store password", listOf("store password", "save password"))) }
        assertTrue(again.phrases("store")!!.active.contains("lock it in"))
    }

    @Test fun defaultsSwitchOffButOnePhraseStays() {
        val c = VoiceCommands(MemoryKeyValueStore())
        c.register(VoiceCommand("confirm", "Confirm", listOf("confirm", "yes")))
        assertNull(c.removePhrase("confirm", "yes"))
        assertEquals(listOf("confirm"), c.phrases("confirm")!!.active)
        assertNotNull(c.removePhrase("confirm", "confirm"))
        assertNull(c.addPhrase("confirm", "yes"))
        assertEquals(listOf("confirm", "yes"), c.phrases("confirm")!!.active)
    }
}
