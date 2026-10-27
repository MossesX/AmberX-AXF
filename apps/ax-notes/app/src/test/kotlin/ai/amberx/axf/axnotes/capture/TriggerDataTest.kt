package ai.amberx.axf.axnotes.capture

import ai.amberx.axf.axnotes.host.PluginHost
import ai.amberx.axf.axnotes.model.NoteTriggers
import ai.amberx.axf.kernel.triggers.MatchEnv
import ai.amberx.axf.kernel.triggers.Observation
import ai.amberx.axf.kernel.triggers.TriggerKinds
import ai.amberx.axf.kernel.triggers.TriggerMatcher
import ai.amberx.axf.kernel.triggers.TriggerValidation
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The app's trigger data as triggers@1 records (TriggerData) and the plugin list parser (PluginHost). */
class TriggerDataTest {
    private val triggers = TriggerData.toTriggers(NoteTriggers.DEFAULTS, "ai.amberx.axf.axnotes")

    @Test fun idsAreNamespacedLowerCase() {
        assertEquals("axnotes.notes.read-back", TriggerData.kernelId("notes.readBack"))
        assertEquals("axnotes.lists.todo-add", TriggerData.kernelId("lists.todoAdd"))
        for (t in triggers) assertTrue(t.id, TriggerValidation.isNamespacedId(t.id))
    }

    @Test fun phrasesConvertSlots() {
        assertEquals(listOf("note <text>"), TriggerData.phrases("note {text}"))
        assertEquals(listOf("read back", "read back <target>"), TriggerData.phrases("read back {target?}"))
        assertEquals(listOf("read my <name> list"), TriggerData.phrases("read my {name} list"))
        assertEquals(listOf("take a note"), TriggerData.phrases("take a note"))
    }

    @Test fun everyTriggerValidates() {
        for (t in triggers) assertTrue("${t.id}: ${TriggerValidation.validate(t.toJson()).errors}", TriggerValidation.validate(t.toJson()).ok)
    }

    @Test fun firedCommandComesBackAsHit() {
        val out = TriggerMatcher.match(triggers, Observation(TriggerKinds.VOICE, 1000, listOf("note buy milk"), confidence = 95.0), MatchEnv("home"))
        val cmd = assertNotNullAndGet(out.fired)
        val hit = assertNotNullAndGet(TriggerData.hit(cmd, NoteTriggers.DEFAULTS))
        assertEquals(NoteTriggers.NOTE_QUICK, hit.def.id)
        assertEquals("buy milk", hit.arg)

        val take = TriggerMatcher.match(triggers, Observation(TriggerKinds.VOICE, 2000, listOf("take a note"), confidence = 95.0), MatchEnv("home")).fired
        assertEquals(NoteTriggers.NOTE_TAKE, TriggerData.hit(assertNotNullAndGet(take), NoteTriggers.DEFAULTS)?.def?.id)
    }

    @Test fun pluginListParses() {
        val list = PluginHost.parse("""{"${'$'}axf":"axnotes-plugins@1","plugins":[
            {"id":"com.example.notes.sample-plugin","folder":"sample-plugin","entry":"x.SamplePlugin","dataPrefix":"sample.","version":"0.1.0"},
            {"id":"broken"},{"id":"com.example.notes.sample-plugin","entry":"dup"}]}""")
        assertEquals(1, list.size)
        assertEquals("sample.", list[0].dataPrefix)
        assertEquals(emptyList<PluginHost.Entry>(), PluginHost.parse(null))
        assertEquals(mapOf("a.b" to "ab."), PluginHost.decodeKnown(PluginHost.encodeKnown(mapOf("a.b" to "ab."))))
    }

    private fun <T : Any> assertNotNullAndGet(v: T?): T { assertNotNull(v); return v!! }
}
