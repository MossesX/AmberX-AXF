package ai.amberx.axf.kernel

import ai.amberx.axf.kernel.asset.parseJsonObject
import ai.amberx.axf.kernel.result.AxfFailure
import ai.amberx.axf.kernel.speech.PlaceholderSpeechProvider
import ai.amberx.axf.kernel.speech.RepeatMode
import ai.amberx.axf.kernel.speech.SPEECH_CAPABILITY
import ai.amberx.axf.kernel.speech.SPEECH_CONTRACT
import ai.amberx.axf.kernel.speech.SpeechJson
import ai.amberx.axf.kernel.speech.SpeechQueue
import ai.amberx.axf.kernel.speech.SpeechQueueEvent
import ai.amberx.axf.kernel.speech.SpeechVoice
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs

/**
 * Replays spec/fixtures/speech.json (generated from core/speech.ts) against the kernel's speech package: rate clamping
 * and steps, and the queue reducer over every scripted session. Written without a compiler (CI runs :axf-kernel:test).
 */
class SpeechConformanceTest {
    private val f: JsonObject = File("../../spec/fixtures/speech.json").readText().parseJsonObject()!!

    private fun objs(e: JsonElement?): List<JsonObject> = (e as? JsonArray)?.map { it.jsonObject } ?: emptyList()
    private fun num(e: JsonElement?): Double? = (e as? JsonPrimitive)?.takeUnless { it.isString || it is JsonNull }?.content?.toDoubleOrNull()

    @Test fun constantsMatchTheWebPort() {
        assertEquals(SpeechJson.str(f, "contract"), SPEECH_CONTRACT)
        assertEquals(SpeechJson.str(f, "capability"), SPEECH_CAPABILITY)
        val r = f.getValue("rate").jsonObject
        assertEquals(SpeechJson.double(r, "min"), SpeechQueue.RATE_MIN)
        assertEquals(SpeechJson.double(r, "max"), SpeechQueue.RATE_MAX)
        assertEquals(SpeechJson.double(r, "default"), SpeechQueue.RATE_DEFAULT)
        assertEquals(r.getValue("steps").jsonArray.map { num(it) }, SpeechQueue.RATE_STEPS)
        assertEquals(f.getValue("repeatModes").jsonArray.map { (it as JsonPrimitive).content }, RepeatMode.IDS)
        assertEquals(f.getValue("events").jsonArray.map { (it as JsonPrimitive).content }, SpeechQueueEvent.TYPES)
    }

    @Test fun rateClampsAndSteps() {
        for (c in objs(f["clamp"])) {
            val rate = if (SpeechJson.str(c, "rate") == "NaN") Double.NaN else num(c["rate"])!!
            assertEquals(SpeechJson.double(c, "clamped"), SpeechQueue.clampRate(rate), "clamp ${c["rate"]}")
        }
        for (c in objs(f["steps"])) {
            val rate = num(c["rate"])!!
            assertEquals(SpeechJson.double(c, "up"), SpeechQueue.stepRate(rate, true), "up $rate")
            assertEquals(SpeechJson.double(c, "down"), SpeechQueue.stepRate(rate, false), "down $rate")
        }
    }

    @Test fun sessionsReplayStepByStep() {
        for (s in objs(f["sessions"])) {
            val name = SpeechJson.str(s, "name")
            val rate = SpeechJson.double(s, "rate") ?: SpeechQueue.RATE_DEFAULT
            val repeat = RepeatMode.parse(SpeechJson.str(s, "repeat")) ?: RepeatMode.NONE
            val steps = objs(s["steps"])
            val events = steps.map { SpeechQueueEvent.parse(it.getValue("event").jsonObject) ?: error("$name: unknown event ${it["event"]}") }
            val replayed = SpeechQueue.replay(events, rate, repeat)
            assertEquals(steps.size, replayed.size, "$name: step count")
            var state = SpeechQueue.initial(rate, repeat)
            steps.forEachIndexed { i, st ->
                val step = SpeechQueue.reduce(state, events[i])
                assertEquals(st.getValue("state").jsonObject, step.state.toJson(), "$name: step $i state ${st["event"]}")
                assertEquals(st.getValue("effects").jsonArray.map { it.jsonObject }, step.effects.map { it.toJson() }, "$name: step $i effects ${st["event"]}")
                assertEquals(step, replayed[i], "$name: step $i replay")
                state = step.state
            }
        }
    }

    @Test fun placeholderProviderRefuses() = runTest {
        assertFalse(PlaceholderSpeechProvider.available())
        assertEquals(emptyList<SpeechVoice>(), PlaceholderSpeechProvider.voices().getOrNull())
        val r = PlaceholderSpeechProvider.speak("hi")
        assertIs<AxfFailure.NotImplemented>(r.failureOrNull())
        assertEquals(SPEECH_CAPABILITY, (r.failureOrNull() as AxfFailure.NotImplemented).capability)
    }
}
