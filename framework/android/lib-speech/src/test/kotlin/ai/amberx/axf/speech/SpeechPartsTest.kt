package ai.amberx.axf.speech

import ai.amberx.axf.kernel.result.AxfFailure
import ai.amberx.axf.kernel.speech.SpeakOutcome
import ai.amberx.axf.kernel.speech.SpeechQueueEvent
import ai.amberx.axf.kernel.triggers.TriggerArming
import ai.amberx.axf.kernel.triggers.TriggerCommand
import ai.amberx.axf.kernel.triggers.TriggerKinds
import ai.amberx.axf.kernel.triggers.TriggerRegistry
import ai.amberx.axf.kernel.triggers.TriggerSource
import ai.amberx.axf.kernel.triggers.TriggerValidation
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonObject
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** Pure parts of lib-speech: settings, spoken controls as triggers, focus rules, utterance callbacks, the HQ placeholder. */
class SpeechPartsTest {
    // ---- settings ----

    @Test fun settingsDefaultWhenMissingOrBad() {
        assertEquals(SpeechSettings(), SpeechSettings.from { null })
        val bad = mapOf(SpeechSettings.READ_ALOUD to "maybe", SpeechSettings.RATE to "fast", SpeechSettings.PITCH to "", SpeechSettings.VOICE to "  ", SpeechSettings.LANGUAGE to "system")
        assertEquals(SpeechSettings(), SpeechSettings.from { bad[it] })
    }

    @Test fun settingsClampAndRead() {
        val m = mapOf(SpeechSettings.READ_ALOUD to "false", SpeechSettings.RATE to "9", SpeechSettings.PITCH to "0.1", SpeechSettings.VOICE to "en-us-x-sfg", SpeechSettings.LANGUAGE to "en-GB", SpeechSettings.DUCK to "false")
        val s = SpeechSettings.from { m[it] }
        assertEquals(SpeechSettings(false, "en-us-x-sfg", 2.0, 0.5, "en-GB", false), s)
        assertEquals("en-us-x-sfg", s.speakOptions().voice)
        assertEquals(2.0, s.speakOptions().rate)
    }

    @Test fun settingsGroupCoversEveryKey() {
        val g = SpeechSettings.group()
        assertEquals("speech", g.id)
        assertEquals(SpeechModule.ID, g.module)
        assertEquals(SpeechSettings.KEYS.toSet(), g.settings.map { it.key }.toSet())
    }

    // ---- spoken controls ----

    @Test fun everyRequiredPhraseIsATrigger() {
        val phrases = SpeechTriggers.all().flatMap { it.phrases }
        for (p in listOf("pause", "skip", "faster", "slower", "repeat", "stop reading")) assertTrue(p in phrases, "missing \"$p\"")
    }

    @Test fun triggersValidateAsPermanentVoiceTriggers() {
        for (t in SpeechTriggers.all()) {
            val check = TriggerValidation.validate(t.toJson())
            assertTrue(check.ok, "${t.id}: ${check.errors}")
            assertEquals(TriggerKinds.VOICE, t.kind)
            assertEquals(TriggerSource.PERMANENT, t.source)
            assertEquals(TriggerArming.ALWAYS, t.arming)
            assertEquals(SpeechModule.ID, t.module)
            assertEquals(t.action, t.id)
        }
        assertEquals(listOf("reading"), SpeechTriggers.all(worksIn = listOf("reading")).first().worksIn)
    }

    @Test fun triggersRegisterWithoutConflicts() {
        val reg = TriggerRegistry()
        assertEquals(0, reg.register(SpeechModule.ID, SpeechTriggers.all()).size)
        assertEquals(SpeechCommands.ALL.size, reg.unregister(SpeechModule.ID))
    }

    @Test fun actionsMapToQueueEvents() {
        assertEquals(SpeechQueueEvent.Pause, SpeechCommands.event(SpeechCommands.PAUSE))
        assertEquals(SpeechQueueEvent.Resume, SpeechCommands.event(SpeechCommands.RESUME))
        assertEquals(SpeechQueueEvent.Skip, SpeechCommands.event(SpeechCommands.SKIP))
        assertEquals(SpeechQueueEvent.Faster, SpeechCommands.event(SpeechCommands.FASTER))
        assertEquals(SpeechQueueEvent.Slower, SpeechCommands.event(SpeechCommands.SLOWER))
        assertEquals(SpeechQueueEvent.Again, SpeechCommands.event(SpeechCommands.REPEAT))
        assertEquals(SpeechQueueEvent.Clear, SpeechCommands.event(SpeechCommands.STOP))
        assertNull(SpeechCommands.event("notes.add"))
        assertEquals(SpeechQueueEvent.Skip, SpeechTriggers.event(TriggerCommand("speech.skip", "speech.skip", JsonObject(emptyMap()), "skip", "skip")))
        assertEquals(SpeechCommands.ALL.size, SpeechCommands.ACTIONS.toSet().size)
    }

    // ---- focus ----

    @Test fun focusPolicy() {
        assertEquals(FocusDecision(FocusAction.PAUSE, true), FocusPolicy.decide(FocusChange.LOSS_TRANSIENT, false, false))
        assertEquals(FocusDecision(FocusAction.PAUSE, true), FocusPolicy.decide(FocusChange.LOSS_TRANSIENT_CAN_DUCK, false, false))
        assertEquals(FocusDecision(FocusAction.PAUSE, false), FocusPolicy.decide(FocusChange.LOSS, false, false))
        assertEquals(FocusDecision(FocusAction.RESUME, false), FocusPolicy.decide(FocusChange.GAIN, true, true))
        assertEquals(FocusDecision(FocusAction.NONE, false), FocusPolicy.decide(FocusChange.GAIN, false, true))   // the user paused: stay paused
        assertEquals(FocusDecision(FocusAction.NONE, false), FocusPolicy.decide(FocusChange.LOSS_TRANSIENT, false, true))
    }

    // ---- utterances ----

    @Test fun utteranceCallbacksBecomeQueueEvents() {
        assertEquals(SpeechQueueEvent.Started, Utterances.event(UtteranceCallback.Start("u")))
        assertEquals(SpeechQueueEvent.Done(SpeakOutcome.DONE), Utterances.event(UtteranceCallback.Done("u")))
        assertEquals(SpeechQueueEvent.Done(SpeakOutcome.FAILED), Utterances.event(UtteranceCallback.Error("u", -3)))
        assertEquals(SpeechQueueEvent.Done(SpeakOutcome.STOPPED), Utterances.event(UtteranceCallback.Stop("u", true)))
        assertNull(Utterances.outcome(UtteranceCallback.Start("u")))
    }

    @Test fun trackerResolvesEachUtteranceOnce() {
        val t = UtteranceTracker("t")
        val a = t.newId(); val b = t.newId()
        assertEquals(listOf("t-1", "t-2"), listOf(a, b))
        val got = mutableListOf<String>()
        t.await(a) { got += "$a:${it.id}" }
        t.await(b) { got += "$b:${it.id}" }
        t.on(UtteranceCallback.Start(a))
        assertEquals(2, t.pending)
        t.on(UtteranceCallback.Done(a))
        t.on(UtteranceCallback.Stop(a, true))   // late callback: ignored
        assertFalse(t.finish(a, SpeakOutcome.FAILED))
        t.stopAll()
        assertEquals(listOf("t-1:done", "t-2:stopped"), got)
        assertEquals(0, t.pending)
    }

    // ---- HQ placeholder ----

    @Test fun hqProviderIsATypedPlaceholder() = runTest {
        assertFalse(HqSpeechProvider.available())
        val r = HqSpeechProvider.speak("hi", null)
        assertIs<AxfFailure.NotImplemented>(r.failureOrNull())
        assertEquals(HqSpeechProvider.CAPABILITY, (r.failureOrNull() as AxfFailure.NotImplemented).capability)
    }
}
