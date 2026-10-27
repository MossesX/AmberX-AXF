package ai.amberx.axf.kernel

import ai.amberx.axf.kernel.alerts.Diagnostic
import ai.amberx.axf.kernel.asset.parseJsonObject
import ai.amberx.axf.kernel.result.AxfFailure
import ai.amberx.axf.kernel.triggers.MatchEnv
import ai.amberx.axf.kernel.triggers.Observation
import ai.amberx.axf.kernel.triggers.Patterns
import ai.amberx.axf.kernel.triggers.PlaceholderDetector
import ai.amberx.axf.kernel.triggers.SettingPhrase
import ai.amberx.axf.kernel.triggers.SettingVoiceBinding
import ai.amberx.axf.kernel.triggers.SettingsActions
import ai.amberx.axf.kernel.triggers.SlotType
import ai.amberx.axf.kernel.triggers.SpokenNumbers
import ai.amberx.axf.kernel.triggers.TRIGGERS_CAPABILITY
import ai.amberx.axf.kernel.triggers.TRIGGERS_CONTRACT
import ai.amberx.axf.kernel.triggers.Thresholds
import ai.amberx.axf.kernel.triggers.Trigger
import ai.amberx.axf.kernel.triggers.TriggerArming
import ai.amberx.axf.kernel.triggers.TriggerFilter
import ai.amberx.axf.kernel.triggers.TriggerHosting
import ai.amberx.axf.kernel.triggers.TriggerJson
import ai.amberx.axf.kernel.triggers.TriggerKinds
import ai.amberx.axf.kernel.triggers.TriggerMatcher
import ai.amberx.axf.kernel.triggers.TriggerOutcome
import ai.amberx.axf.kernel.triggers.TriggerPlaceholders
import ai.amberx.axf.kernel.triggers.TriggerRegistry
import ai.amberx.axf.kernel.triggers.TriggerSource
import ai.amberx.axf.kernel.triggers.TriggerValidation
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
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Replays spec/fixtures/triggers.json (generated from core/triggers.ts) against the kernel's triggers package: kinds,
 * validation, phrase patterns + argument capture, spoken numbers / times, the matcher's decisions, the registry's
 * conflicts, lib-voice commands as triggers and settings bindings. Written without a compiler (CI runs :axf-kernel:test).
 */
class TriggersConformanceTest {
    private val f: JsonObject = File("../../spec/fixtures/triggers.json").readText().parseJsonObject()!!

    private fun objs(e: JsonElement?): List<JsonObject> = (e as? JsonArray)?.map { it.jsonObject } ?: emptyList()
    private fun num(e: JsonElement?): Double? = (e as? JsonPrimitive)?.takeUnless { it.isString || it is JsonNull }?.content?.toDoubleOrNull()
    private fun diag(d: Diagnostic.ContributionConflict): JsonObject = JsonObject(mapOf("kind" to JsonPrimitive("contribution-conflict"), "what" to JsonPrimitive(d.what), "id" to JsonPrimitive(d.id), "was" to JsonPrimitive(d.was), "now" to JsonPrimitive(d.now)))
    private fun diags(l: List<Diagnostic.ContributionConflict>): JsonArray = JsonArray(l.map { diag(it) })

    private fun observation(o: JsonObject): Observation = Observation(
        kind = TriggerJson.str(o, "kind")!!, at = TriggerJson.long(o, "at")!!, heard = TriggerJson.strings(o["heard"]), signature = TriggerJson.str(o, "signature"), confidence = TriggerJson.double(o, "confidence"),
    )

    private fun env(o: JsonObject): MatchEnv = MatchEnv(
        context = TriggerJson.str(o, "context") ?: "", armed = TriggerJson.strings(o["armed"]), kindsOff = TriggerJson.strings(o["kindsOff"]),
        lastFired = (o["lastFired"] as? JsonObject)?.mapValues { (_, v) -> num(v)!!.toLong() } ?: emptyMap(),
    )

    private fun triggers(): List<Trigger> = objs(f["triggers"]).map { Trigger.parse(it) ?: error("fixture trigger ${it["id"]} must validate") }

    @Test fun constantsAndRegistriesMatchTheWebPort() {
        assertEquals(TriggerJson.str(f, "contract"), TRIGGERS_CONTRACT)
        assertEquals(TriggerJson.str(f, "capability"), TRIGGERS_CAPABILITY)
        val p = f.getValue("placeholders").jsonObject
        assertEquals(listOf(TriggerJson.str(p, "gesture"), TriggerJson.str(p, "face")), TriggerPlaceholders.ALL)
        assertEquals(objs(f["kinds"]), TriggerKinds.all().map { it.toJson() })
        assertEquals(TriggerJson.strings(f["sources"]), TriggerSource.entries.map { it.id })
        assertEquals(TriggerJson.strings(f["armings"]), TriggerArming.entries.map { it.id })
        assertEquals(TriggerJson.strings(f["outcomes"]), TriggerOutcome.IDS)
        assertEquals(TriggerJson.strings(f["slotTypes"]), SlotType.IDS)
        val t = f.getValue("threshold").jsonObject
        assertEquals(TriggerJson.double(t, "min"), Thresholds.MIN)
        assertEquals(TriggerJson.double(t, "max"), Thresholds.MAX)
        assertEquals(TriggerJson.double(t, "default"), Thresholds.DEFAULT)
        assertEquals(TriggerJson.long(t, "cooldownMs"), Thresholds.DEFAULT_COOLDOWN_MS)
        assertEquals(TriggerJson.str(t, "anyContext"), Thresholds.ANY_CONTEXT)
        assertEquals(TriggerJson.double(t, "voiceCommand"), Thresholds.VOICE_COMMAND)
        for (c in objs(t["clamp"])) {
            val n = if (TriggerJson.str(c, "n") == "NaN") Double.NaN else num(c["n"])!!
            assertEquals(TriggerJson.double(c, "clamped"), Thresholds.clamp(n), "clamp ${c["n"]}")
        }
        for (c in objs(f["ids"])) assertEquals(TriggerJson.bool(c, "ok"), TriggerValidation.isNamespacedId(TriggerJson.str(c, "id")), "id ${c["id"]}")
    }

    @Test fun validationMatchesCaseByCase() {
        for (c in objs(f["validate"])) {
            val raw = c["raw"].takeUnless { it is JsonNull }
            assertEquals(c.getValue("result").jsonObject, TriggerValidation.validate(raw).toJson(), "validate ${TriggerJson.str(c, "name")}")
        }
    }

    @Test fun patternsPhrasesNumbersAndTimes() {
        for (c in objs(f["patterns"])) {
            val p = TriggerJson.str(c, "pattern")!!
            assertEquals(objs(c["parts"]), Patterns.parse(p).map { it.toJson() }, "parts \"$p\"")
            assertEquals(TriggerJson.str(c, "error"), Patterns.errors(p), "error \"$p\"")
            assertEquals(TriggerJson.long(c, "words")!!.toInt(), Patterns.words(p), "words \"$p\"")
        }
        for (c in objs(f["phrases"])) {
            val heard = TriggerJson.str(c, "heard")!!
            val pattern = TriggerJson.str(c, "pattern")!!
            assertEquals(c.getValue("match").jsonObject, Patterns.match(heard, pattern).toJson(), "phrase \"$heard\" ~ \"$pattern\"")
        }
        for (c in objs(f["numbers"])) assertEquals(TriggerJson.long(c, "value")?.toInt(), SpokenNumbers.number(TriggerJson.str(c, "phrase")!!), "number ${c["phrase"]}")
        for (c in objs(f["times"])) assertEquals(TriggerJson.long(c, "seconds")?.toInt(), SpokenNumbers.seconds(TriggerJson.str(c, "phrase")!!), "time ${c["phrase"]}")
        for (c in objs(f["overlap"])) assertEquals(TriggerJson.bool(c, "overlap"), TriggerMatcher.contextsOverlap(TriggerJson.strings(c["a"]), TriggerJson.strings(c["b"])), "overlap ${c["a"]} ${c["b"]}")
    }

    @Test fun matcherDecidesLikeTheReference() {
        val set = triggers()
        assertEquals(objs(f["triggers"]), set.map { it.toJson() }, "fixture triggers round trip")
        for (c in objs(f["matches"])) {
            val name = TriggerJson.str(c, "name")
            val got = TriggerMatcher.match(set, observation(c.getValue("obs").jsonObject), env(c.getValue("env").jsonObject))
            assertEquals(c.getValue("result").jsonObject, got.toJson(), "match $name")
        }
    }

    @Test fun registryConflictsRemovalUpdatesAndLists() {
        val r = f.getValue("registry").jsonObject
        val set = triggers()
        val raised = ArrayList<Diagnostic>()
        val reg = TriggerRegistry { raised += it }
        fun t(id: String, phrases: List<String>, action: String, module: String = "ai.amberx.axf.notes", worksIn: List<String> = emptyList(), source: TriggerSource = TriggerSource.PERMANENT) =
            Trigger(id, TriggerKinds.VOICE, source, module, id, phrases, action, null, Thresholds.DEFAULT, worksIn, TriggerArming.ALWAYS)
        val d1 = reg.register("ai.amberx.axf.notes", set.take(10))
        val d2 = reg.register("ai.amberx.axf.player", listOf(t("player.next", listOf("next"), "player.next", "ai.amberx.axf.player"), t("player.rewind", listOf("back"), "player.back", "ai.amberx.axf.player", listOf("player"))))
        val d3 = reg.register("ai.amberx.axf.other", listOf(t("notes.add", listOf("note <text>"), "other.add", "ai.amberx.axf.other"), t("other.tick", listOf("tick <text>"), "other.tick", "ai.amberx.axf.other", listOf("todo"))))
        val d4 = reg.register("ai.amberx.axf.cam", set.drop(10))
        assertEquals(r.getValue("diagnostics").jsonArray, JsonArray(listOf(d1, d2, d3, d4).map { diags(it) }), "registry diagnostics")
        assertEquals(JsonArray((d1 + d2 + d3 + d4).map { diag(it) }), JsonArray(raised.map { diag(it as Diagnostic.ContributionConflict) }), "diagnostics were reported")
        assertEquals(r.getValue("afterRegister").jsonArray, JsonArray(reg.list().map { JsonArray(listOf(JsonPrimitive(it.id), JsonPrimitive(it.module))) }), "after register")
        reg.register("ai.amberx.axf.notes", listOf(t("notes.mine", listOf("remind me <text>"), "notes.add", source = TriggerSource.CUSTOM)))
        val removed = r.getValue("removed").jsonObject
        assertEquals(TriggerJson.bool(removed, "permanent"), reg.remove("todo.add"), "remove permanent")
        assertEquals(TriggerJson.bool(removed, "missing"), reg.remove("nope.x"), "remove missing")
        assertEquals(TriggerJson.bool(removed, "custom"), reg.remove("notes.mine"), "remove custom")
        val updated = r.getValue("updated").jsonObject
        assertNull(reg.update("todo.check", JsonObject(mapOf("phrases" to JsonArray(emptyList())))), "update bad")
        assertEquals(updated.getValue("ok").jsonObject, reg.update("todo.check", JsonObject(mapOf("phrases" to JsonArray(listOf(JsonPrimitive("check off <text>"), JsonPrimitive("done with <text>"))), "threshold" to JsonPrimitive(120))))?.toJson(), "update ok")
        assertNull(reg.update("nope.x", JsonObject(mapOf("enabled" to JsonPrimitive(false)))), "update missing")
        assertEquals(TriggerJson.long(r, "unregistered")!!.toInt(), reg.unregister("ai.amberx.axf.player"), "unregister")
        val lists = r.getValue("lists").jsonObject
        assertEquals(TriggerJson.strings(lists["all"]), reg.list().map { it.id }, "list all")
        assertEquals(TriggerJson.strings(lists["voice"]), reg.list(TriggerFilter(kind = TriggerKinds.VOICE)).map { it.id }, "list voice")
        assertEquals(TriggerJson.strings(lists["todo"]), reg.list(TriggerFilter(context = "todo")).map { it.id }, "list todo")
        assertEquals(TriggerJson.strings(lists["cam"]), reg.list(TriggerFilter(module = "ai.amberx.axf.cam")).map { it.id }, "list cam")
        assertEquals(TriggerJson.str(lists, "owner"), reg.owner(TriggerKinds.VOICE, "Next!")?.id, "owner")
        assertEquals(TriggerJson.str(lists, "noOwner"), reg.owner(TriggerKinds.VOICE, "nothing")?.id, "no owner")
    }

    @Test fun voiceCommandsAndSettingsBindings() {
        for (c in objs(f["voiceCommands"])) {
            val cmd = c.getValue("command").jsonObject
            val got = TriggerHosting.voiceCommand(TriggerJson.str(cmd, "id")!!, TriggerJson.str(cmd, "label")!!, TriggerJson.strings(cmd["defaults"]), TriggerJson.str(cmd, "module"))
            assertEquals(c.getValue("trigger").jsonObject, got.toJson(), "voice command ${cmd["id"]}")
        }
        val b = f.getValue("binding").jsonObject
        assertEquals(TriggerJson.str(b, "setAction"), SettingsActions.SET)
        assertEquals(TriggerJson.str(b, "toggleAction"), SettingsActions.TOGGLE)
        val input = b.getValue("input").jsonObject
        val binding = SettingVoiceBinding(
            key = TriggerJson.str(input, "key")!!, module = TriggerJson.str(input, "module")!!, label = TriggerJson.str(input, "label")!!,
            phrases = objs(input["phrases"]).map { SettingPhrase(TriggerJson.str(it, "pattern")!!, it["value"], TriggerJson.bool(it, "toggle") ?: false) },
            threshold = TriggerJson.double(input, "threshold"), worksIn = (input["worksIn"] as? JsonArray)?.let { TriggerJson.strings(it) },
        )
        val bound = TriggerHosting.bindingTriggers(binding)
        assertEquals(objs(b["triggers"]), bound.map { it.toJson() }, "binding triggers")
        for ((i, c) in objs(b["commands"]).withIndex()) {
            val cmdJson = c["command"] as? JsonObject
            val heard = cmdJson?.let { TriggerJson.str(it, "heard") } ?: continue
            val fired = TriggerMatcher.match(bound, Observation(TriggerKinds.VOICE, 1000, listOf(heard)), MatchEnv("home")).fired!!
            assertEquals(cmdJson, fired.toJson(), "binding command $i")
            assertEquals(c["change"], TriggerHosting.settingChange(fired)?.toJson() ?: JsonNull, "binding change $i")
        }
    }

    @Test fun placeholderDetectorRefuses() = runTest {
        val ph = PlaceholderDetector(TriggerKinds.FACE, TriggerPlaceholders.FACE)
        assertFalse(ph.available())
        val r = ph.start {}
        assertIs<AxfFailure.NotImplemented>(r.failureOrNull())
        assertEquals(TriggerPlaceholders.FACE, (r.failureOrNull() as AxfFailure.NotImplemented).capability)
        assertTrue(TriggerKinds.get(TriggerKinds.GESTURE)!!.status.id == "placeholder")
    }
}
