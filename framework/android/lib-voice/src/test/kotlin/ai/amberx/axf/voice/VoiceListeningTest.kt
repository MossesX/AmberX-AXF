package ai.amberx.axf.voice

import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** Pure logic of continuous listening: sensitivity floor, arming state machine, dictation stop phrases. */
class VoiceListeningTest {
    private fun near(expected: Float, actual: Float) = assertTrue(kotlin.math.abs(expected - actual) < 1e-4f, "expected $expected, got $actual")

    // ---- sensitivity ----

    @Test fun sensitivityMapsToConfidenceFloor() {
        near(0.5f, VoiceSensitivity.confidenceFloor(0.5f))
        near(0.9f, VoiceSensitivity.confidenceFloor(0f))     // strictest end is capped
        near(0.2f, VoiceSensitivity.confidenceFloor(1f))     // loosest end never lets everything in
        near(0.3f, VoiceSensitivity.confidenceFloor(0.7f))
        near(0.9f, VoiceSensitivity.confidenceFloor(-3f))
        near(0.2f, VoiceSensitivity.confidenceFloor(7f))
        near(0.5f, VoiceSensitivity.confidenceFloor(Float.NaN))
    }

    @Test fun higherSensitivityNeverRaisesTheFloor() {
        var last = 1f
        for (i in 0..20) { val f = VoiceSensitivity.confidenceFloor(i / 20f); assertTrue(f <= last); last = f }
    }

    @Test fun passesUsesFloorForFinalsOnly() {
        val weak = VoiceResult("next", 0.4f, final = true)
        assertFalse(VoiceSensitivity.passes(weak, 0.5f))
        assertTrue(VoiceSensitivity.passes(weak, 0.7f))
        assertTrue(VoiceSensitivity.passes(VoiceResult("nex", VoiceResult.UNSCORED, final = false), 0f))
    }

    @Test fun parsesStoredSlider() {
        near(0.5f, VoiceSensitivity.parse(null))
        near(0.5f, VoiceSensitivity.parse("junk"))
        near(0.75f, VoiceSensitivity.parse("0.75"))
        near(0.7f, VoiceSensitivity.parse("70"))
        near(0f, VoiceSensitivity.parse("-1"))
    }

    // ---- arming ----

    @Test fun disarmedIgnoresUntilPhrase() {
        val a = VoiceArming(ArmingConfig(phrases = listOf("hey notes"), timeoutMs = 5_000))
        assertFalse(a.isArmed(0))
        assertEquals(ArmingDecision.Ignored, a.onHeard("new note", 0))
        assertEquals(ArmingDecision.Armed(1_000 + 5_000), a.onHeard("Hey, notes!", 1_000))
        assertTrue(a.isArmed(5_999))
        assertEquals(ArmingDecision.Pass("new note", 3_000 + 5_000), a.onHeard("New note", 3_000)) // extends
        assertTrue(a.isArmed(7_999))
        assertFalse(a.isArmed(8_000))
        assertEquals(ArmingDecision.Ignored, a.onHeard("new note", 8_000))
    }

    @Test fun phraseAndCommandInOneUtterance() {
        val a = VoiceArming(ArmingConfig(phrases = listOf("hey notes"), timeoutMs = 4_000))
        assertEquals(ArmingDecision.Pass("read it back", 4_000), a.onHeard("hey notes read it back", 0))
        // the last arming phrase wins when it is said twice
        assertEquals(ArmingDecision.Pass("stop", 4_000), a.onHeard("hey notes hey notes stop", 0))
        // only whole words: "hey notesy" isn't the phrase, but we're armed so it passes as a command
        assertEquals(ArmingDecision.Pass("hey notesy", 5_000), a.onHeard("hey notesy", 1_000))
    }

    @Test fun noExtendKeepsTheOriginalDeadline() {
        val a = VoiceArming(ArmingConfig(timeoutMs = 2_000, extendOnUse = false))
        a.onHeard(ArmingConfig.DEFAULT_PHRASE, 0)
        assertEquals(ArmingDecision.Pass("one", 2_000), a.onHeard("one", 1_500))
        assertEquals(ArmingDecision.Ignored, a.onHeard("two", 2_000))
    }

    @Test fun zeroTimeoutArmsOnlyThatUtterance() {
        val a = VoiceArming(ArmingConfig(timeoutMs = 0))
        assertEquals(ArmingDecision.Pass("save", 10), a.onHeard("hey notes save", 10))
        assertEquals(ArmingDecision.Ignored, a.onHeard("save", 10))
    }

    @Test fun alwaysArmedPassesEverything() {
        val a = VoiceArming(ArmingConfig(alwaysArmed = true))
        assertTrue(a.isArmed(0))
        assertNull(a.remainingMs(0))
        assertEquals(ArmingDecision.Pass("new note", Long.MAX_VALUE), a.onHeard("New note.", 999_999))
        assertEquals(ArmingDecision.Pass("new note", Long.MAX_VALUE), a.onHeard("hey notes new note", 0))
        assertEquals(ArmingDecision.Armed(Long.MAX_VALUE), a.onHeard("hey notes", 0))
        assertEquals(ArmingDecision.Ignored, a.onHeard("  ?! ", 0))
    }

    @Test fun manualArmDisarmAndConfigSwitch() {
        val a = VoiceArming(ArmingConfig(timeoutMs = 1_000))
        a.arm(0)
        assertEquals(400L, a.remainingMs(600))
        a.disarm()
        assertEquals(0L, a.remainingMs(600))
        a.config = a.config.copy(alwaysArmed = true)
        assertTrue(a.isArmed(10_000_000))
        a.config = a.config.copy(alwaysArmed = false)
        assertFalse(a.isArmed(0))
    }

    @Test fun timeoutIsCapped() {
        val a = VoiceArming(ArmingConfig(timeoutMs = Long.MAX_VALUE))
        assertEquals(ArmingConfig.MAX_TIMEOUT_MS, a.arm(0))
    }

    @Test fun parsesPhraseLists() {
        assertEquals(listOf("hey notes", "ok notes"), ArmingConfig.parsePhrases(" Hey Notes, ok notes ,, hey notes\n"))
        assertEquals(emptyList(), ArmingConfig.parsePhrases(null))
        assertEquals(EndPhrases.DEFAULT, EndPhrases.parse("  "))
        assertEquals(listOf("end note", "stop dictation"), EndPhrases.parse("End note, stop dictation"))
    }

    // ---- dictation stop phrases ----

    @Test fun findsTrailingEndPhrase() {
        val p = listOf("end note")
        assertEquals(EndPhraseMatch("end note", "Buy milk"), EndPhrases.find("Buy milk end note", p))
        assertEquals(EndPhraseMatch("end note", "Buy milk,"), EndPhrases.find("Buy milk, End Note.", p))
        assertEquals(EndPhraseMatch("end note", ""), EndPhrases.find("end note", p))
        assertNull(EndPhrases.find("the end note of the song", p))
        assertNull(EndPhrases.find("weekend note", p))
        assertNull(EndPhrases.find("note", p))
        assertNull(EndPhrases.find("", p))
    }

    @Test fun longestEndPhraseWins() {
        val m = EndPhrases.find("call mom stop note", listOf("note", "stop note"))
        assertEquals(EndPhraseMatch("stop note", "call mom"), m)
    }

    @Test fun assemblerBuildsTranscriptUntilStop() {
        val d = DictationAssembler(listOf("end note"))
        assertEquals(DictationStep("buy milk", "buy milk", false), d.accept("buy milk"))
        assertEquals("buy milk and eg", d.preview("and eg"))
        assertEquals(DictationStep("and eggs", "buy milk and eggs", true, "end note"), d.accept(" and eggs end note "))
        assertTrue(d.ended)
        assertEquals(DictationStep("", "buy milk and eggs", true), d.accept("more words"))
        assertEquals(listOf("buy milk", "and eggs"), d.segments)
    }

    @Test fun stopPhraseAloneEndsWithoutAddingText() {
        val d = DictationAssembler()
        d.accept("first line")
        val step = d.accept("end note")
        assertEquals("", step.added)
        assertTrue(step.ended)
        assertEquals("first line", d.transcript)
    }

    @Test fun engineKindFallsBackToDefault() {
        assertEquals(VoiceEngineKind.VOSK, VoiceEngineKind.of(null))
        assertEquals(VoiceEngineKind.VOSK, VoiceEngineKind.of("nope"))
        assertEquals(VoiceEngineKind.CLOUD, VoiceEngineKind.of("cloud"))
    }

    @Test fun placeholdersNeverStart() = kotlinx.coroutines.test.runTest {
        val e = CloudVoiceEngine()
        assertFalse(e.available)
        assertFalse(e.start(VoiceEngineOptions()))
        assertIs<VoiceEngineState.Failed>(e.state.value)
    }
}
