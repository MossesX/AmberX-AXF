package ai.amberx.axf.voice

import kotlinx.coroutines.async
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.yield
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertTrue

/** dictate stops only an engine it started itself; hands-free listening that was already running keeps running. */
class DictateOwnershipTest {
    private class FakeEngine(initial: VoiceEngineState = VoiceEngineState.Idle) : VoiceEngine {
        override val kind: VoiceEngineKind = VoiceEngineKind.VOSK
        override val available: Boolean = true
        val st = MutableStateFlow(initial)
        override val state: StateFlow<VoiceEngineState> get() = st
        val out = MutableSharedFlow<VoiceResult>(extraBufferCapacity = 8)
        override val results: SharedFlow<VoiceResult> get() = out
        override val echoCancelActive: Boolean = false
        var starts = 0
        var stops = 0
        override suspend fun start(options: VoiceEngineOptions): Boolean { starts++; st.value = VoiceEngineState.Listening; return true }
        override fun stop() { stops++; st.value = VoiceEngineState.Idle }
        override fun close() { stop() }
    }

    @Test fun ownershipFollowsTheEngineState() {
        assertTrue(DictationOwnership.startsEngine(VoiceEngineState.Idle))
        assertTrue(DictationOwnership.startsEngine(VoiceEngineState.Failed("x")))
        assertFalse(DictationOwnership.startsEngine(VoiceEngineState.Listening))
        assertFalse(DictationOwnership.startsEngine(VoiceEngineState.Loading))
    }

    private suspend fun dictateOnce(e: FakeEngine): List<DictationEvent> = kotlinx.coroutines.coroutineScope {
        val events = async { e.dictate(VoiceEngineOptions(sensitivity = 1f)).toList() }
        while (e.out.subscriptionCount.value == 0) yield()
        e.out.emit(VoiceResult("buy milk end note", 0.9f, true))
        events.await()
    }

    @Test fun startsAndStopsAnIdleEngine() = runTest {
        val e = FakeEngine()
        val events = dictateOnce(e)
        assertEquals("buy milk", assertIs<DictationEvent.Ended>(events.last()).transcript)
        assertEquals(1, e.starts)
        assertEquals(1, e.stops)
        assertEquals(VoiceEngineState.Idle, e.state.value)
    }

    @Test fun leavesHandsFreeListeningRunning() = runTest {
        val e = FakeEngine(VoiceEngineState.Listening)
        val events = dictateOnce(e)
        assertEquals("buy milk", assertIs<DictationEvent.Ended>(events.last()).transcript)
        assertEquals(0, e.starts)
        assertEquals(0, e.stops)
        assertEquals(VoiceEngineState.Listening, e.state.value)
    }
}
