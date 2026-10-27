package ai.amberx.axf.triggers

import ai.amberx.axf.kernel.platform.MemoryKeyValueStore
import ai.amberx.axf.kernel.result.AxfResult
import ai.amberx.axf.kernel.triggers.Trigger
import ai.amberx.axf.kernel.triggers.TriggerKinds
import ai.amberx.axf.kernel.triggers.TriggerRegistry
import ai.amberx.axf.kernel.triggers.TriggerSource
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** Store: merge of permanent + custom, overrides, persistence, registry mirror. */
class TriggerStoreTest {
    private fun voice(id: String, phrase: String, source: TriggerSource = TriggerSource.PERMANENT, module: String = "notes", action: String = id) =
        Trigger(id = id, kind = TriggerKinds.VOICE, source = source, module = module, label = phrase, phrases = listOf(phrase), action = action)

    private val add = voice("notes.add", "add note")
    private val del = voice("notes.delete", "delete note")

    @Test fun permanentFirstThenCustom() {
        val store = TriggerStore(MemoryKeyValueStore())
        assertIs<AxfResult.Ok<Trigger>>(store.saveCustom(voice("custom.play", "play it", TriggerSource.CUSTOM, "custom", "player.play")))
        store.registerPermanent("notes", listOf(add, del))
        assertEquals(listOf("notes.add", "notes.delete", "custom.play"), store.list.value.map { it.id })
        assertTrue(store.get("notes.add")!!.permanent)
        assertFalse(store.get("notes.add")!!.canDelete)
        assertTrue(store.get("custom.play")!!.canDelete)
    }

    @Test fun customIsPersistedPermanentIsNot() {
        val kv = MemoryKeyValueStore()
        val a = TriggerStore(kv)
        a.registerPermanent("notes", listOf(add))
        a.saveCustom(voice("custom.play", "play it", TriggerSource.CUSTOM, "custom", "player.play"))
        val b = TriggerStore(kv)
        assertEquals(listOf("custom.play"), b.list.value.map { it.id })
        assertEquals(TriggerSource.CUSTOM, b.get("custom.play")!!.trigger.source)
        assertTrue(kv.get(TriggerStore.KEY)!!.contains(TriggerStoreCodec.FORMAT))
    }

    @Test fun saveCustomForcesSourceAndModuleAndValidates() {
        val store = TriggerStore(MemoryKeyValueStore())
        val r = store.saveCustom(voice("custom.x", "do x", TriggerSource.PERMANENT, "someone", "app.x"))
        val t = (r as AxfResult.Ok).value
        assertEquals(TriggerSource.CUSTOM, t.source)
        assertEquals(TriggerStore.CUSTOM_MODULE, t.module)
        val bad = store.saveCustom(voice("custom.y", "do y").copy(phrases = emptyList()))
        assertIs<AxfResult.Err>(bad)
        assertEquals(1, store.list.value.size)
    }

    @Test fun permanentCanNotBeDeletedNorShadowed() {
        val store = TriggerStore(MemoryKeyValueStore())
        store.registerPermanent("notes", listOf(add))
        assertFalse(store.removeCustom("notes.add"))
        assertIs<AxfResult.Err>(store.saveCustom(voice("notes.add", "something else", TriggerSource.CUSTOM)))
        assertEquals(1, store.list.value.size)
    }

    @Test fun mergeDropsACustomIdOwnedByAPermanentTrigger() {
        val data = TriggerStoreData(custom = listOf(voice("notes.add", "mine", TriggerSource.CUSTOM, "custom")))
        val merged = TriggerMerge.merge(listOf(PermanentTrigger(add)), data)
        assertEquals(1, merged.size)
        assertEquals(listOf("add note"), merged[0].trigger.phrases)
    }

    @Test fun overridesOnPermanentTriggersSurviveAndReset() {
        val kv = MemoryKeyValueStore()
        val a = TriggerStore(kv)
        a.registerPermanent("notes", listOf(add))
        a.setEnabled("notes.add", false)
        a.setThreshold("notes.add", 65.5)
        a.setWorksIn("notes.add", listOf("notes.editor", " ", "notes.editor"))
        val b = TriggerStore(kv)
        b.registerPermanent("notes", listOf(add))
        val s = b.get("notes.add")!!
        assertFalse(s.trigger.enabled)
        assertEquals(65.5, s.trigger.threshold)
        assertEquals(listOf("notes.editor"), s.trigger.worksIn)
        assertTrue(s.overridden)
        assertTrue(b.reset("notes.add"))
        assertTrue(b.get("notes.add")!!.trigger.enabled)
        assertFalse(b.get("notes.add")!!.overridden)
    }

    @Test fun overrideEqualToModuleValueIsDropped() {
        val store = TriggerStore(MemoryKeyValueStore())
        store.registerPermanent("notes", listOf(add))
        store.setEnabled("notes.add", false)
        store.setEnabled("notes.add", true)
        assertFalse(store.get("notes.add")!!.overridden)
        assertNull(store.data().overrides["notes.add"])
    }

    @Test fun thresholdIsClamped() {
        val store = TriggerStore(MemoryKeyValueStore())
        store.registerPermanent("notes", listOf(add))
        store.setThreshold("notes.add", 150.0)
        assertEquals(99.99, store.get("notes.add")!!.trigger.threshold)
        store.setThreshold("notes.add", -3.0)
        assertEquals(0.01, store.get("notes.add")!!.trigger.threshold)
    }

    @Test fun lockedPermanentTriggersCanNotBeSwitchedOff() {
        val store = TriggerStore(MemoryKeyValueStore())
        store.registerPermanent("notes", listOf(add), locked = setOf("notes.add"))
        assertIs<AxfResult.Err>(store.setEnabled("notes.add", false))
        assertTrue(store.get("notes.add")!!.trigger.enabled)
        assertFalse(store.get("notes.add")!!.canDisable)
        // a stored "off" (e.g. from before the module locked it) is ignored
        val merged = TriggerMerge.merge(listOf(PermanentTrigger(add, canDisable = false)), TriggerStoreData(overrides = mapOf("notes.add" to TriggerOverride(enabled = false))))
        assertTrue(merged[0].trigger.enabled)
        // threshold can still change
        assertIs<AxfResult.Ok<Trigger>>(store.setThreshold("notes.add", 70.0))
    }

    @Test fun customTriggersAreEditedDirectly() {
        val store = TriggerStore(MemoryKeyValueStore())
        store.saveCustom(voice("custom.play", "play it", TriggerSource.CUSTOM, "custom", "player.play"))
        store.setEnabled("custom.play", false)
        store.setThreshold("custom.play", 55.0)
        val t = store.get("custom.play")!!.trigger
        assertFalse(t.enabled)
        assertEquals(55.0, t.threshold)
        assertTrue(store.data().overrides.isEmpty())
        assertTrue(store.removeCustom("custom.play"))
        assertTrue(store.list.value.isEmpty())
        assertIs<AxfResult.Err>(store.setEnabled("custom.nope", true))
    }

    @Test fun unregisterKeepsOverridesForWhenTheModuleComesBack() {
        val store = TriggerStore(MemoryKeyValueStore())
        store.registerPermanent("notes", listOf(add))
        store.setEnabled("notes.add", false)
        assertEquals(1, store.unregisterPermanent("notes"))
        assertTrue(store.list.value.isEmpty())
        store.registerPermanent("notes", listOf(add))
        assertFalse(store.get("notes.add")!!.trigger.enabled)
    }

    @Test fun mirrorsIntoTheKernelRegistry() {
        val reg = TriggerRegistry()
        val store = TriggerStore(MemoryKeyValueStore(), reg)
        store.registerPermanent("notes", listOf(add, del))
        store.saveCustom(voice("custom.play", "play it", TriggerSource.CUSTOM, "custom", "player.play"))
        store.setEnabled("notes.delete", false)
        assertEquals(setOf("notes.add", "notes.delete", "custom.play"), reg.list().map { it.id }.toSet())
        assertFalse(reg.get("notes.delete")!!.enabled)
        store.unregisterPermanent("notes")
        assertEquals(listOf("custom.play"), reg.list().map { it.id })
        store.removeCustom("custom.play")
        assertTrue(reg.list().isEmpty())
    }

    @Test fun codecIsLenient() {
        assertTrue(TriggerStoreCodec.decode(null).custom.isEmpty())
        assertTrue(TriggerStoreCodec.decode("not json").custom.isEmpty())
        val text = """{"${'$'}axf":"trigger-store@1","custom":[{"id":"bad"},{"id":"custom.ok","kind":"voice","source":"custom","module":"custom","label":"Ok","phrases":["ok go"],"action":"app.go"}],"overrides":{"notes.add":{"threshold":250,"enabled":"nope"},"x.y":{}}}"""
        val d = TriggerStoreCodec.decode(text)
        assertEquals(listOf("custom.ok"), d.custom.map { it.id })
        assertEquals(TriggerOverride(threshold = 99.99), d.overrides["notes.add"])
        assertNull(d.overrides["x.y"])
        assertEquals(d, TriggerStoreCodec.decode(TriggerStoreCodec.encode(d)))
    }

    @Test fun newCustomIdsAreFreeAndNamespaced() {
        val store = TriggerStore(MemoryKeyValueStore())
        val a = store.newCustomId("Add Note!")
        assertEquals("custom.add-note", a)
        store.saveCustom(voice(a, "add note", TriggerSource.CUSTOM, "custom", "notes.add"))
        assertEquals("custom.add-note-2", store.newCustomId("add note"))
        assertEquals("custom.trigger", store.newCustomId("!!!"))
    }
}
