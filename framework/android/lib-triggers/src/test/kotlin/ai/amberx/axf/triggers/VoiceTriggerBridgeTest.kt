package ai.amberx.axf.triggers

import ai.amberx.axf.kernel.triggers.Trigger
import ai.amberx.axf.kernel.triggers.TriggerArming
import ai.amberx.axf.kernel.triggers.TriggerCommand
import ai.amberx.axf.kernel.triggers.TriggerKinds
import ai.amberx.axf.kernel.triggers.TriggerOutcome
import ai.amberx.axf.kernel.triggers.TriggerSource
import ai.amberx.axf.voice.ArmingConfig
import ai.amberx.axf.voice.VoiceArming
import ai.amberx.axf.voice.VoiceResult
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** Bridge decisions with fake results: sensitivity, arming gates, threshold, context, cooldown, slots, the log. */
class VoiceTriggerBridgeTest {
    private fun voice(id: String, vararg phrases: String, arming: TriggerArming = TriggerArming.ALWAYS, worksIn: List<String> = emptyList(), threshold: Double = 80.0) =
        Trigger(id = id, kind = TriggerKinds.VOICE, source = TriggerSource.PERMANENT, module = "notes", label = id, phrases = phrases.toList(), action = id, arming = arming, worksIn = worksIn, threshold = threshold)

    private fun final(text: String, confidence: Float = 0.9f) = VoiceResult(text, confidence, true)

    private val add = voice("notes.add", "add note")
    private val note = voice("notes.note", "note <text>")

    private fun decider(gate: ArmingGate = ArmingGate.PER_TRIGGER, always: Boolean = false) =
        VoiceTriggerDecider(VoiceArming(ArmingConfig(alwaysArmed = always)), gate)

    @Test fun firesWithInputConfidenceInPercent() {
        val step = decider().onResult(final("add note", 0.9f), 1_000, listOf(add), "*", 0.5f)
        val fired = assertNotNull(step.fired)
        assertEquals("notes.add", fired.action)
        assertEquals(90.0, step.entry.inputConfidence, 0.001)
        val d = step.entry.decisions.single()
        assertEquals(TriggerOutcome.FIRED, d.outcome)
        assertEquals(90.0, d.confidence, 0.01)
    }

    @Test fun belowThresholdIsLoggedWithItsConfidence() {
        val step = decider().onResult(final("add note", 0.7f), 1_000, listOf(add), "*", 0.9f)
        assertNull(step.fired)
        val d = step.entry.decisions.single()
        assertEquals(TriggerOutcome.BELOW_THRESHOLD, d.outcome)
        assertEquals(70.0, d.confidence, 0.01)
    }

    @Test fun sensitivityFloorDropsBeforeMatching() {
        val step = decider().onResult(final("add note", 0.3f), 1_000, listOf(add), "*", 0.5f)
        assertEquals(VoiceDrop.BELOW_SENSITIVITY, step.entry.dropped)
        assertNull(step.outcome)
    }

    @Test fun partialsNeverMatch() {
        val step = decider().onResult(VoiceResult("add note", VoiceResult.UNSCORED, false), 1_000, listOf(add), "*", 0.5f)
        assertEquals(VoiceDrop.PARTIAL, step.entry.dropped)
    }

    @Test fun gateAllNeedsTheArmingPhrase() {
        val d = decider(ArmingGate.ALL)
        assertEquals(VoiceDrop.NOT_ARMED, d.onResult(final("add note"), 1_000, listOf(add), "*", 0.5f).entry.dropped)
        assertEquals(VoiceDrop.ARMED_ONLY, d.onResult(final("hey notes"), 2_000, listOf(add), "*", 0.5f).entry.dropped)
        val step = d.onResult(final("add note"), 3_000, listOf(add), "*", 0.5f)
        assertNotNull(step.fired)
        assertTrue(step.entry.armed)
    }

    @Test fun armingPhraseAndCommandInOneUtterance() {
        val step = decider(ArmingGate.ALL).onResult(final("hey notes add note"), 1_000, listOf(add), "*", 0.5f)
        assertEquals("notes.add", step.fired?.action)
        assertEquals(listOf("add note"), step.entry.heard)
    }

    @Test fun perTriggerArmingFollowsTheKernel() {
        val armedOnly = voice("notes.clear", "clear all", arming = TriggerArming.REQUIRED)
        val d = decider()
        val cold = d.onResult(final("clear all"), 1_000, listOf(armedOnly), "*", 0.5f)
        assertEquals(TriggerOutcome.NOT_ARMED, cold.entry.decisions.single().outcome)
        val warm = d.onResult(final("hey notes clear all"), 2_000, listOf(armedOnly), "*", 0.5f)
        assertEquals("notes.clear", warm.fired?.action)
        // always-armed config: no phrase needed
        assertNotNull(decider(always = true).onResult(final("clear all"), 1_000, listOf(armedOnly), "*", 0.5f).fired)
    }

    @Test fun contextFilters() {
        val editorOnly = voice("notes.bold", "bold", worksIn = listOf("notes.editor"))
        val d = decider()
        assertEquals(TriggerOutcome.WRONG_CONTEXT, d.onResult(final("bold"), 1_000, listOf(editorOnly), "home", 0.5f).entry.decisions.single().outcome)
        assertNotNull(d.onResult(final("bold"), 5_000, listOf(editorOnly), "notes.editor", 0.5f).fired)
    }

    @Test fun cooldownIsKeptBetweenUtterances() {
        val d = decider()
        assertNotNull(d.onResult(final("add note"), 1_000, listOf(add), "*", 0.5f).fired)
        val again = d.onResult(final("add note"), 1_100, listOf(add), "*", 0.5f)
        assertNull(again.fired)
        assertEquals(TriggerOutcome.COOLDOWN, again.entry.decisions.single().outcome)
        assertNotNull(d.onResult(final("add note"), 2_000, listOf(add), "*", 0.5f).fired)
    }

    @Test fun slotsAreCaptured() {
        val step = decider().onResult(final("note buy milk"), 1_000, listOf(add, note), "*", 0.5f)
        assertEquals("notes.note", step.fired?.action)
        assertEquals(JsonPrimitive("buy milk"), step.fired?.args?.get("text"))
    }

    @Test fun kindOffAndNoMatchLogging() {
        val d = decider()
        assertEquals(TriggerOutcome.KIND_OFF, d.onResult(final("add note"), 1_000, listOf(add), "*", 0.5f, kindsOff = listOf(TriggerKinds.VOICE)).entry.decisions.single().outcome)
        // a slot pattern that doesn't match scores 0 → NO_MATCH, which is left out of the log unless asked for
        assertTrue(d.onResult(final("something else entirely"), 2_000, listOf(note), "*", 0.5f).entry.decisions.isEmpty())
        d.logNoMatch = true
        assertEquals(TriggerOutcome.NO_MATCH, d.onResult(final("something else entirely"), 3_000, listOf(note), "*", 0.5f).entry.decisions.single().outcome)
    }

    @Test fun bridgeProcessLogsAndEmits() {
        val logged = ArrayList<TriggerLogEntry>()
        var triggers = listOf(add)
        val bridge = VoiceTriggerBridge(MutableSharedFlow(), VoiceArming(), { triggers }, { "*" }, log = { logged += it }, clock = { 1_000L })
        bridge.process(VoiceResult("add", VoiceResult.UNSCORED, false))
        assertTrue(logged.isEmpty())  // partials are not logged
        assertNotNull(bridge.process(final("add note")).fired)
        triggers = emptyList()        // read fresh every time
        assertNull(bridge.process(final("add note")).fired)
        assertEquals(2, logged.size)
        assertEquals("notes.add", logged[0].fired?.action)
    }

    @OptIn(ExperimentalCoroutinesApi::class)
    @Test fun bridgeCollectsTheEngineFlow() = runTest {
        val src = MutableSharedFlow<VoiceResult>()
        var now = 1_000L
        val bridge = VoiceTriggerBridge(src, VoiceArming(), { listOf(add) }, { "*" }, clock = { now })
        val got = ArrayList<TriggerCommand>()
        backgroundScope.launch { bridge.commands.collect { got += it } }
        bridge.start(backgroundScope)
        runCurrent()
        src.emit(final("add note"))
        runCurrent()
        now = 5_000L
        src.emit(final("add note"))
        runCurrent()
        assertEquals(2, got.size)
        assertTrue(bridge.running)
        bridge.stop()
        assertTrue(!bridge.running)
    }
}
