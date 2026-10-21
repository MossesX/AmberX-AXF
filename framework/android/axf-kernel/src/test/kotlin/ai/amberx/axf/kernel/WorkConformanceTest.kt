package ai.amberx.axf.kernel

import ai.amberx.axf.kernel.asset.parseJsonObject
import ai.amberx.axf.kernel.work.DelayRule
import ai.amberx.axf.kernel.work.JobEffect
import ai.amberx.axf.kernel.work.JobEvent
import ai.amberx.axf.kernel.work.JobPhase
import ai.amberx.axf.kernel.work.JobSpec
import ai.amberx.axf.kernel.work.JobState
import ai.amberx.axf.kernel.work.RunCondition
import ai.amberx.axf.kernel.work.StopReasons
import ai.amberx.axf.kernel.work.WORK_CONTRACT
import ai.amberx.axf.kernel.work.WORK_POLL_CAPABILITY
import ai.amberx.axf.kernel.work.WorkEngine
import ai.amberx.axf.kernel.work.WorkJson
import ai.amberx.axf.kernel.work.WorkPlaceholders
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * Replays spec/fixtures/work.json (generated from core/engines/work.ts) against WorkEngine: the web port and the kernel
 * must agree on job kinds, spec validation, interval clamping, conditions, delay rules and every step of the job state
 * machine. Written without a compiler (CI runs :axf-kernel:test); the engine package was compiled and this file replayed
 * with a local kotlinc.
 */
class WorkConformanceTest {
    private val f: JsonObject = File("../../spec/fixtures/work.json").readText().parseJsonObject()!!

    private fun strings(e: JsonElement?): List<String> = (e as? JsonArray)?.map { it.jsonPrimitive.content } ?: emptyList()
    private fun specs(): Map<String, JobSpec> = f.getValue("specs").jsonObject.values.map { WorkEngine.validate(it).spec!! }.associateBy { it.id }
    private fun approvals(): JobSpec = specs().getValue("axhub.approvals")

    /** Fixture numbers (TS numbers) → the engine's inputs. */
    private fun numOrNull(e: JsonElement?): Double? = (e as? JsonPrimitive)?.takeUnless { it.isString || it is JsonNull }?.content?.toDoubleOrNull()

    private fun delayRule(o: JsonObject): DelayRule = when (WorkJson.str(o, "kind")) {
        "interval" -> DelayRule.Interval
        "fixed" -> DelayRule.Fixed(WorkJson.ms(o, "ms")!!)
        else -> DelayRule.Exponential(WorkJson.ms(o, "baseMs")!!, WorkJson.double(o, "factor") ?: DelayRule.DEFAULT_FACTOR, WorkJson.ms(o, "maxMs")!!)
    }

    private fun stateOf(o: JsonObject): JobState = JobState(
        phase = JobPhase.parse(WorkJson.str(o, "phase")),
        intervalMs = WorkJson.long(o, "intervalMs")!!,
        lastOutcome = WorkJson.str(o, "lastOutcome"),
        streak = WorkJson.long(o, "streak")!!.toInt(),
        runs = WorkJson.long(o, "runs")!!.toInt(),
        sleepMs = WorkJson.long(o, "sleepMs"),
        notices = strings(o["notices"]),
        stopReason = WorkJson.str(o, "stopReason"),
    )

    @Test fun constantsAndRegistriesMatchTheWebPort() {
        assertEquals(WorkJson.str(f, "contract"), WORK_CONTRACT)
        assertEquals(WorkJson.str(f, "pollCapability"), WORK_POLL_CAPABILITY)
        assertEquals(f.getValue("kinds").jsonArray.map { it.jsonObject }, WorkEngine.kinds().map { it.toJson() })
        val p = f.getValue("placeholders").jsonObject
        assertEquals(listOf(WorkJson.str(p, "manager"), WorkJson.str(p, "alarm"), WorkJson.str(p, "chain")), WorkPlaceholders.ALL)
        assertEquals(strings(f["delayKinds"]), DelayRule.KINDS)
        assertEquals(strings(f["conditionKinds"]), RunCondition.KINDS)
        assertEquals(strings(f["phases"]), JobPhase.entries.map { it.id })
        assertEquals(strings(f["eventTypes"]), JobEvent.TYPES)
        assertEquals(strings(f["effects"]), JobEffect.NAMES)
        assertEquals(f.getValue("stopReasons").jsonObject, StopReasons.toJson())
        assertEquals(WorkJson.str(f, "fallbackOutcome"), JobSpec.FALLBACK_OUTCOME)
        assertEquals(WorkJson.double(f, "defaultBackoffFactor"), DelayRule.DEFAULT_FACTOR)
    }

    @Test fun specsValidateToThemselves() {
        for ((name, raw) in f.getValue("specs").jsonObject) {
            val r = WorkEngine.validate(raw)
            assertTrue(r.ok, "spec $name: ${r.errors}")
            assertEquals(raw.jsonObject, r.spec!!.toJson(), "spec $name round trip")
        }
        for (c in f.getValue("validate").jsonArray.map { it.jsonObject }) {
            val raw = c["raw"].takeUnless { it is JsonNull }
            assertEquals(c.getValue("result").jsonObject, WorkEngine.validate(raw).toJson(), "validate ${WorkJson.str(c, "name")}")
        }
    }

    @Test fun clampingConditionsAndDelays() {
        val a = approvals()
        val d = specs().getValue("demo.backoff")
        for (c in f.getValue("clamp").jsonArray.map { it.jsonObject }) {
            assertEquals(WorkJson.long(c, "clamped"), WorkEngine.clampInterval(a.interval, numOrNull(c["ms"])), "clamp ${c["ms"]}")
        }
        for (c in f.getValue("conditions").jsonArray.map { it.jsonObject }) {
            val flags = WorkJson.flags(c["flags"] as? JsonObject)
            assertEquals(strings(c["unmet"]), WorkEngine.unmetConditions(a, flags), "unmet $flags")
            assertEquals(WorkJson.bool(c, "restart"), WorkEngine.shouldRestart(a, flags), "restart $flags")
            assertEquals(WorkJson.bool(c, "restartNoBoot"), WorkEngine.shouldRestart(d, flags), "restartNoBoot $flags")
        }
        for (c in f.getValue("delays").jsonArray.map { it.jsonObject }) {
            assertEquals(WorkJson.long(c, "ms"), WorkEngine.delayFor(delayRule(c.getValue("rule").jsonObject), WorkJson.long(c, "intervalMs")!!, WorkJson.long(c, "streak")!!.toInt()), "delay ${c["rule"]} streak ${c["streak"]}")
        }
    }

    @Test fun scenariosReplayStepByStep() {
        val specs = specs()
        for (s in f.getValue("scenarios").jsonArray.map { it.jsonObject }) {
            val name = WorkJson.str(s, "name")
            val spec = specs.getValue(WorkJson.str(s, "spec")!!)
            var state = WorkEngine.initialState(spec, WorkJson.long(s, "intervalMs"))
            assertEquals(s.getValue("initial").jsonObject, state.toJson(), "$name: initial")
            assertEquals(stateOf(s.getValue("initial").jsonObject), state, "$name: initial parsed")
            s.getValue("steps").jsonArray.map { it.jsonObject }.forEachIndexed { i, st ->
                val event = JobEvent.parse(st.getValue("event").jsonObject)!!
                val step = WorkEngine.reduce(spec, state, event, WorkJson.flags(st["flags"] as? JsonObject))
                assertEquals(st.getValue("state").jsonObject, step.state.toJson(), "$name: step $i state ${st["event"]}")
                assertEquals(st.getValue("effects").jsonArray.map { it.jsonObject }, step.effects.map { it.toJson() }, "$name: step $i effects ${st["event"]}")
                state = step.state
            }
        }
    }
}
