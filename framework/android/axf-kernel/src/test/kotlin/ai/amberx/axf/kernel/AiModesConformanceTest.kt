package ai.amberx.axf.kernel

import ai.amberx.axf.kernel.ai.AI_MODES_CONTRACT
import ai.amberx.axf.kernel.ai.AI_SESSION_CAPABILITY
import ai.amberx.axf.kernel.ai.AI_SESSION_HOST
import ai.amberx.axf.kernel.ai.AiJson
import ai.amberx.axf.kernel.ai.AiMode
import ai.amberx.axf.kernel.ai.AiModePolicy
import ai.amberx.axf.kernel.ai.AiModeRegistry
import ai.amberx.axf.kernel.ai.AiModes
import ai.amberx.axf.kernel.ai.AiRequestInput
import ai.amberx.axf.kernel.ai.AiSessionRequest
import ai.amberx.axf.kernel.ai.ModelOption
import ai.amberx.axf.kernel.ai.ModelTier
import ai.amberx.axf.kernel.ai.PlaceholderAiSessionClient
import ai.amberx.axf.kernel.alerts.Diagnostic
import ai.amberx.axf.kernel.asset.parseJsonObject
import ai.amberx.axf.kernel.assistant.ChatContext
import ai.amberx.axf.kernel.live.LiveSessionInfo
import ai.amberx.axf.kernel.result.AxfFailure
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs

/**
 * Replays spec/fixtures/ai-modes.json (generated from core/ai-modes.ts) against the kernel's ai package: built-in modes,
 * the registry's rules, UAC gating per policy, mode resolution, model choice and whole requests. Written without a
 * compiler (CI runs :axf-kernel:test).
 */
class AiModesConformanceTest {
    private val f: JsonObject = File("../../spec/fixtures/ai-modes.json").readText().parseJsonObject()!!

    private fun objs(e: JsonElement?): List<JsonObject> = (e as? JsonArray)?.map { it.jsonObject } ?: emptyList()
    private fun diag(d: Diagnostic.ContributionConflict?): JsonElement = d?.let { JsonObject(mapOf("kind" to JsonPrimitive("contribution-conflict"), "what" to JsonPrimitive(it.what), "id" to JsonPrimitive(it.id), "was" to JsonPrimitive(it.was), "now" to JsonPrimitive(it.now))) } ?: JsonNull
    private val custom = AiMode("notes.summarize", "Summarize notes", "notes.ai", true, false, "assistant.chat", ModelTier.FAST, null, "ai.amberx.axf.notes")
    private fun modes(): List<AiMode> = AiModes.BUILTINS + custom
    private fun policies(): Map<String, AiModePolicy> = f.getValue("policies").jsonObject.mapValues { (_, v) -> AiModePolicy.parse(v.jsonObject) }
    private fun options(name: String): List<ModelOption> = objs(f.getValue("options").jsonObject[name]).map { ModelOption.parse(it) }

    @Test fun constantsAndBuiltinsMatchTheWebPort() {
        assertEquals(AiJson.str(f, "contract"), AI_MODES_CONTRACT)
        assertEquals(AiJson.str(f, "capability"), AI_SESSION_CAPABILITY)
        assertEquals(AiJson.str(f, "host"), AI_SESSION_HOST)
        assertEquals(AiJson.strings(f["tiers"]), ModelTier.IDS)
        assertEquals(AiJson.str(f, "defaultMode"), AiModes.DEFAULT_MODE)
        assertEquals(AiJson.strings(f["defaultAllowed"]), AiModes.DEFAULT_ALLOWED)
        assertEquals(objs(f["builtins"]), AiModes.BUILTINS.map { it.toJson() })
        assertEquals(AiModes.BUILTINS, objs(f["builtins"]).map { AiMode.parse(it) }, "built-ins parse back")
    }

    @Test fun registryKeepsBuiltinsAndReportsConflicts() {
        val r = f.getValue("registry").jsonObject
        val raised = ArrayList<Diagnostic>()
        val reg = AiModeRegistry { raised += it }
        val d1 = reg.register(custom)
        val d2 = reg.register(custom.copy(module = "ai.amberx.axf.other", label = "Other"))
        val d3 = reg.register(AiModes.BUILTINS[0].copy(module = "ai.amberx.axf.plugin", label = "Plugin chat"))
        assertEquals(r.getValue("diagnostics"), JsonArray(listOf(d1, d2, d3).map { diag(it) }), "diagnostics")
        assertEquals<List<Diagnostic?>>(listOf(d2, d3), raised.toList(), "diagnostics were reported")
        val removed = r.getValue("removed").jsonObject
        assertEquals(AiJson.bool(removed, "builtin"), reg.unregister("ai.chat"))
        assertEquals(AiJson.bool(removed, "custom"), reg.unregister("notes.summarize"))
        assertEquals(AiJson.bool(removed, "missing"), reg.unregister("x.y"))
        assertEquals(r.getValue("list"), JsonArray(reg.list().map { JsonArray(listOf(JsonPrimitive(it.id), JsonPrimitive(it.module), JsonPrimitive(it.label))) }), "list")
    }

    @Test fun policiesGateAndResolveModes() {
        val modes = modes()
        val policies = policies()
        for (c in objs(f["allowed"])) {
            val name = AiJson.str(c, "policy")!!
            assertEquals(AiJson.strings(c["modes"]), AiModes.allowed(modes, policies.getValue(name)).map { it.id }, "allowed $name")
        }
        for (c in objs(f["resolve"])) {
            val name = AiJson.str(c, "policy")!!
            val pick = c.getValue("pick").jsonObject
            val got = AiModes.resolve(modes, policies.getValue(name), AiJson.str(pick, "override"), AiJson.str(pick, "requested"), AiJson.str(pick, "defaultMode"))
            assertEquals(c.getValue("result").jsonObject, got.toJson(), "resolve $name $pick")
        }
    }

    @Test fun modelChoiceByTierAndUserPick() {
        val modes = modes().associateBy { it.id }
        val policies = policies()
        for (c in objs(f["choices"])) {
            val got = AiModes.chooseModel(modes.getValue(AiJson.str(c, "mode")!!), options(AiJson.str(c, "options")!!), policies.getValue("anonymous"))
            assertEquals(c.getValue("choice").jsonObject, got.toJson(), "choose ${c["options"]} ${c["mode"]}")
        }
        for (c in objs(f["userPicks"])) {
            val got = AiModes.chooseModel(AiModes.BUILTINS[0], options("all"), policies.getValue(AiJson.str(c, "policy")!!), AiJson.str(c, "pick"))
            assertEquals(c.getValue("choice").jsonObject, got.toJson(), "user pick ${c["policy"]} ${c["pick"]}")
        }
    }

    @Test fun requestsResolveModeAndModel() {
        val modes = modes()
        val policies = policies()
        for (c in objs(f["requests"])) {
            val i = c.getValue("input").jsonObject
            val input = AiRequestInput(
                prompt = AiJson.str(i, "prompt") ?: "", context = ChatContext.fromJson(i["context"]), requested = AiJson.str(i, "requested"),
                triggerId = AiJson.str(i, "triggerId"), override = AiJson.str(i, "override"), model = AiJson.str(i, "model"), title = AiJson.str(i, "title"),
            )
            val got = AiModes.buildRequest(modes, policies.getValue(AiJson.str(c, "policy")!!), options("all"), input)
            assertEquals(c.getValue("result").jsonObject, got.toJson(), "request ${c["policy"]} ${i["prompt"]}")
        }
    }

    @Test fun placeholderClientRefuses() = runTest {
        assertEquals(AI_SESSION_HOST, PlaceholderAiSessionClient.host)
        assertFalse(PlaceholderAiSessionClient.available())
        assertEquals(emptyList<LiveSessionInfo>(), PlaceholderAiSessionClient.list().getOrNull())
        val r = PlaceholderAiSessionClient.start(AiSessionRequest("ai.chat", "assistant.chat", "hi", "", true, false, "hi"))
        assertIs<AxfFailure.NotImplemented>(r.failureOrNull())
        assertEquals(AI_SESSION_CAPABILITY, (r.failureOrNull() as AxfFailure.NotImplemented).capability)
    }
}
