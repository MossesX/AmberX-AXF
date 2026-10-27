package ai.amberx.axf.triggers

import ai.amberx.axf.kernel.platform.MemoryKeyValueStore
import ai.amberx.axf.kernel.triggers.Trigger
import ai.amberx.axf.kernel.triggers.TriggerKinds
import ai.amberx.axf.kernel.triggers.TriggerRegistry
import ai.amberx.axf.kernel.triggers.TriggerSource
import ai.amberx.axf.voice.ArmingConfig
import ai.amberx.axf.voice.VoiceArming
import ai.amberx.axf.voice.VoiceResult
import kotlinx.coroutines.flow.MutableSharedFlow
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** The voice bridge matches store triggers plus registry-only ones (lib-speech, plugins); store copies win; live updates. */
class TriggerUnionTest {
    private fun voice(id: String, phrase: String, module: String = "notes", threshold: Double = 80.0, enabled: Boolean = true) =
        Trigger(id = id, kind = TriggerKinds.VOICE, source = TriggerSource.PERMANENT, module = module, label = id, phrases = listOf(phrase), action = id, threshold = threshold, enabled = enabled)

    @Test fun mergeKeepsStoreFirstAndDropsDuplicateIds() {
        val a = voice("a", "alpha", threshold = 60.0)
        val aReg = voice("a", "alpha", threshold = 90.0)
        val b = voice("b", "bravo", module = "speech")
        val out = TriggerUnion.merge(listOf(a), listOf(aReg, b, b))
        assertEquals(listOf("a", "b"), out.map { it.id })
        assertEquals(60.0, out.first().threshold)
    }

    @Test fun sourceIncludesRegistryOnlyTriggersAndStoreOverridesWin() {
        val reg = TriggerRegistry()
        val store = TriggerStore(MemoryKeyValueStore(), reg)
        store.registerPermanent("notes", listOf(voice("notes.add", "add note")))
        store.setThreshold("notes.add", 55.0)
        reg.register("ai.amberx.axf.speech", listOf(voice("speech.pause", "pause reading", module = "ai.amberx.axf.speech")))
        val src = UnionTriggerSource(store, reg)
        val got = src()
        assertEquals(listOf("notes.add", "speech.pause"), got.map { it.id })
        assertEquals(55.0, got.first { it.id == "notes.add" }.threshold)
        assertEquals(1, got.count { it.id == "notes.add" })
        src.close()
    }

    @Test fun sourceFollowsRegistryAndStoreChanges() {
        val reg = TriggerRegistry()
        val store = TriggerStore(MemoryKeyValueStore(), reg)
        val src = UnionTriggerSource(store, reg)
        assertTrue(src().isEmpty())
        reg.register("plugin.x", listOf(voice("x.go", "go x", module = "plugin.x")))
        assertEquals(listOf("x.go"), src().map { it.id })
        store.registerPermanent("notes", listOf(voice("notes.add", "add note")))
        assertEquals(setOf("notes.add", "x.go"), src().map { it.id }.toSet())
        reg.unregister("plugin.x")
        assertEquals(listOf("notes.add"), src().map { it.id })
        src.close()
        // after close the cache no longer hears the registry, but store changes still refresh it
        reg.register("plugin.y", listOf(voice("y.go", "go y", module = "plugin.y")))
        store.registerPermanent("notes", listOf(voice("notes.del", "delete note")))
        assertTrue("notes.del" in src().map { it.id })
    }

    @Test fun bridgeFiresARegistryOnlyTrigger() {
        val reg = TriggerRegistry()
        val store = TriggerStore(MemoryKeyValueStore(), reg)
        val src = UnionTriggerSource(store, reg)
        var closed = false
        val bridge = VoiceTriggerBridge(MutableSharedFlow(), VoiceArming(ArmingConfig(alwaysArmed = true)), src, { "*" }, { 0.5f }, onClose = { closed = true; src.close() }, clock = { 1_000 })
        assertEquals(null, bridge.process(VoiceResult("pause reading", 0.9f, true)).fired)
        reg.register("ai.amberx.axf.speech", listOf(voice("speech.pause", "pause reading", module = "ai.amberx.axf.speech")))
        assertEquals("speech.pause", bridge.process(VoiceResult("pause reading", 0.9f, true)).fired?.action)
        assertFalse(closed)
        bridge.close(); bridge.close()
        assertTrue(closed)
    }
}
