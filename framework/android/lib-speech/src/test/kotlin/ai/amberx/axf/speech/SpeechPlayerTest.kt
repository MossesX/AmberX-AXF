package ai.amberx.axf.speech

import ai.amberx.axf.kernel.result.AxfResult
import ai.amberx.axf.kernel.speech.RepeatMode
import ai.amberx.axf.kernel.speech.SpeakOptions
import ai.amberx.axf.kernel.speech.SpeakOutcome
import ai.amberx.axf.kernel.speech.SpeechProvider
import ai.amberx.axf.kernel.speech.SpeechVoice
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** A provider that records what it was asked to say and finishes only when told. */
class FakeProvider : SpeechProvider {
    override val id: String = "fake"
    override val label: String = "Fake"
    val said = mutableListOf<String>()
    var stops = 0
    var failAll = false
    private var pending: CompletableDeferred<SpeakOutcome>? = null

    override suspend fun available(): Boolean = true
    override suspend fun speak(text: String, opts: SpeakOptions?): AxfResult<SpeakOutcome> {
        if (failAll) { said += "x:$text"; return AxfResult.ok(SpeakOutcome.FAILED) }
        said += "$text@${opts?.rate}" + (opts?.voice?.let { "/$it" } ?: "")
        val d = CompletableDeferred<SpeakOutcome>()
        pending = d
        return AxfResult.ok(d.await())
    }
    override suspend fun stop() { stops += 1; pending?.complete(SpeakOutcome.STOPPED); pending = null }
    override suspend fun voices(): AxfResult<List<SpeechVoice>> = AxfResult.ok(listOf(SpeechVoice("v1", "Voice 1", "en")))
    fun done() { pending?.complete(SpeakOutcome.DONE); pending = null }
}

class FakeFocus : SpeechFocus {
    val log = mutableListOf<String>()
    var listener: ((FocusChange) -> Unit)? = null
    override fun acquire(onChange: (FocusChange) -> Unit): Boolean { log += "acquire"; listener = onChange; return true }
    override fun release() { log += "release" }
}

@OptIn(ExperimentalCoroutinesApi::class)
class SpeechPlayerTest {
    private fun TestScope.player(p: FakeProvider, focus: SpeechFocus = SpeechFocus.NONE, repeat: RepeatMode = RepeatMode.NONE, defaults: () -> SpeakOptions? = { null }) =
        SpeechPlayer(p, this, 1.0, repeat, focus, defaults)

    @Test fun readsTheQueueInOrder() = runTest {
        val p = FakeProvider(); val focus = FakeFocus(); val pl = player(p, focus)
        pl.enqueue("Milk"); pl.enqueue("Eggs")
        advanceUntilIdle()
        assertEquals(listOf("Milk@1.0"), p.said)
        assertTrue(pl.state.value.speaking)
        p.done(); advanceUntilIdle()
        assertEquals(listOf("Milk@1.0", "Eggs@1.0"), p.said)
        p.done(); advanceUntilIdle()
        assertEquals(2, pl.state.value.index)
        assertFalse(pl.state.value.speaking)
        assertFalse(pl.active)
        assertEquals(SpeakOutcome.DONE, pl.lastOutcome.value)
        assertEquals(listOf("acquire", "release"), focus.log)
    }

    @Test fun fasterStopsAndRestartsAtTheNextStepAndTheLateStopIsIgnored() = runTest {
        val p = FakeProvider(); val pl = player(p)
        pl.enqueue("Milk"); pl.enqueue("Eggs")
        advanceUntilIdle()
        pl.faster(); advanceUntilIdle()
        assertEquals(1, p.stops)
        assertEquals(listOf("Milk@1.0", "Milk@1.25"), p.said)
        assertEquals(0, pl.state.value.index) // the stopped utterance did not move the queue
        assertTrue(pl.state.value.speaking)
        pl.slower(); pl.slower(); advanceUntilIdle()
        assertEquals("Milk@0.75", p.said.last())
        pl.stop(); advanceUntilIdle()
    }

    @Test fun pauseResumeSkipRepeatAndStop() = runTest {
        val p = FakeProvider(); val pl = player(p)
        pl.enqueue("A"); pl.enqueue("B"); pl.enqueue("C")
        advanceUntilIdle()
        pl.pause(); advanceUntilIdle()
        assertTrue(pl.state.value.paused); assertFalse(pl.state.value.speaking); assertEquals(1, p.stops)
        pl.resume(); advanceUntilIdle()
        assertEquals(listOf("A@1.0", "A@1.0"), p.said)
        pl.skip(); advanceUntilIdle()
        assertEquals("B@1.0", p.said.last()); assertEquals(1, pl.state.value.index)
        pl.again(); advanceUntilIdle()
        assertEquals(listOf("A@1.0", "A@1.0", "B@1.0", "B@1.0"), p.said)
        pl.stop(); advanceUntilIdle()
        assertEquals(0, pl.state.value.items.size)
        assertFalse(pl.state.value.speaking)
    }

    @Test fun sayInterruptsAndClearsTheQueue() = runTest {
        val p = FakeProvider(); val pl = player(p)
        pl.enqueue("A"); pl.enqueue("B")
        advanceUntilIdle()
        pl.say("Now")
        advanceUntilIdle()
        assertEquals(listOf("Now"), pl.state.value.items.map { it.text })
        assertEquals("Now@1.0", p.said.last())
        pl.stop(); advanceUntilIdle()
    }

    @Test fun defaultsFillTheItemOptionsButTheQueueOwnsTheRate() = runTest {
        val p = FakeProvider(); val pl = player(p, defaults = { SpeakOptions(voice = "v1", rate = 2.0) })
        pl.enqueue("A"); advanceUntilIdle()
        assertEquals("A@1.0/v1", p.said.last())
        pl.enqueue("B", SpeakOptions(voice = "v2")); p.done(); advanceUntilIdle()
        assertEquals("B@1.0/v2", p.said.last())
        pl.stop(); advanceUntilIdle()
    }

    @Test fun anEngineThatFailsEverythingClearsInsteadOfLooping() = runTest {
        val p = FakeProvider().apply { failAll = true }
        val pl = player(p, repeat = RepeatMode.ALL)
        pl.enqueue("A"); pl.enqueue("B")
        advanceUntilIdle()
        assertEquals(listOf("x:A", "x:B"), p.said)
        assertEquals(0, pl.state.value.items.size)
        assertEquals(SpeakOutcome.FAILED, pl.lastOutcome.value)
    }

    @Test fun transientFocusLossPausesAndGainResumes() = runTest {
        val p = FakeProvider(); val focus = FakeFocus(); val pl = player(p, focus)
        pl.enqueue("A"); advanceUntilIdle()
        focus.listener!!(FocusChange.LOSS_TRANSIENT_CAN_DUCK); advanceUntilIdle()
        assertTrue(pl.state.value.paused)
        assertEquals(listOf("acquire"), focus.log) // kept while paused by focus, so the gain arrives
        focus.listener!!(FocusChange.GAIN); advanceUntilIdle()
        assertFalse(pl.state.value.paused)
        assertEquals(listOf("A@1.0", "A@1.0"), p.said)
        pl.stop(); advanceUntilIdle()
        assertEquals(listOf("acquire", "release"), focus.log)
    }

    @Test fun permanentFocusLossPausesForGood() = runTest {
        val p = FakeProvider(); val focus = FakeFocus(); val pl = player(p, focus)
        pl.enqueue("A"); advanceUntilIdle()
        focus.listener!!(FocusChange.LOSS); advanceUntilIdle()
        assertTrue(pl.state.value.paused)
        assertEquals(listOf("acquire", "release"), focus.log)
        pl.stop(); advanceUntilIdle()
    }

    @Test fun axfSpeechHonoursReadAloudAndStartsAtTheUsersSpeed() = runTest {
        val p = FakeProvider()
        var settings = SpeechSettings(readAloud = false, rate = 1.5)
        val speech = AxfSpeech(p, { settings }, this)
        assertNull(speech.read("quiet"))
        settings = settings.copy(readAloud = true)
        speech.read("hello"); advanceUntilIdle()
        assertEquals("hello@1.5", p.said.last())
        assertTrue(speech.command(SpeechCommands.FASTER)); advanceUntilIdle()
        assertEquals("hello@1.75", p.said.last())
        assertFalse(speech.command("notes.add"))
        assertTrue(speech.command(SpeechCommands.STOP)); advanceUntilIdle()
        assertEquals(0, speech.player.state.value.items.size)
    }
}
