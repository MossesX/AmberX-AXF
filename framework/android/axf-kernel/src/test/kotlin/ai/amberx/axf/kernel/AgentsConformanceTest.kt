package ai.amberx.axf.kernel

import ai.amberx.axf.kernel.agents.AGENTS_CAPABILITY
import ai.amberx.axf.kernel.agents.AddonRisks
import ai.amberx.axf.kernel.agents.AgentContext
import ai.amberx.axf.kernel.agents.AgentMemory
import ai.amberx.axf.kernel.agents.AgentMemoryConfig
import ai.amberx.axf.kernel.agents.AgentPrompts
import ai.amberx.axf.kernel.agents.AgentValidator
import ai.amberx.axf.kernel.agents.ComposeInput
import ai.amberx.axf.kernel.agents.GlossaryEntry
import ai.amberx.axf.kernel.agents.LingoDef
import ai.amberx.axf.kernel.agents.MemoryItem
import ai.amberx.axf.kernel.agents.PersonaDef
import ai.amberx.axf.kernel.agents.PlaceholderAgentRuntime
import ai.amberx.axf.kernel.agents.ResolvedMemory
import ai.amberx.axf.kernel.agents.SkillDef
import ai.amberx.axf.kernel.agents.SkillExample
import ai.amberx.axf.kernel.asset.parseJsonObject
import ai.amberx.axf.kernel.result.AxfFailure
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.double
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertNull

/** Replays spec/fixtures/agents.json (generated from core/agents.ts) against the kernel's agents package. */
class AgentsConformanceTest {
    private val f: JsonObject = File("../../spec/fixtures/agents.json").readText().parseJsonObject()!!
    private fun strs(e: JsonElement?): List<String> = (e as? JsonArray)?.map { it.jsonPrimitive.content } ?: emptyList()
    private fun ctx(): AgentContext {
        val c = f.getValue("context").jsonObject
        val known = c.getValue("known").jsonObject.mapValues { (_, v) -> strs(v).toSet() }
        val builtins = c.getValue("builtins").jsonObject.mapValues { (_, v) -> (v.jsonObject["description"]?.jsonPrimitive?.content ?: "") to (v.jsonObject["parameters"]?.jsonObject ?: JsonObject(emptyMap())) }
        return AgentContext(known = known, builtins = builtins)
    }

    @Test fun `validation reports the same errors, warnings and normalised items`() {
        val ctx = ctx()
        for (c in f.getValue("validation").jsonArray) {
            val o = c.jsonObject
            val label = "${o.getValue("collection").jsonPrimitive.content}/${o.getValue("case").jsonPrimitive.content}"
            val exp = o.getValue("result").jsonObject
            val got = AgentValidator.validate(o.getValue("collection").jsonPrimitive.content, o["raw"], ctx)
            assertEquals(exp.getValue("ok").jsonPrimitive.boolean, got.ok, label)
            assertEquals(strs(exp["errors"]), got.errors, "$label errors")
            assertEquals(strs(exp["warnings"]), got.warnings, "$label warnings")
            assertEquals(canon(exp.getValue("item")), canon(got.item), "$label item")
        }
    }

    /** JSON compared by value: key order is free, 4 == 4.0, so a port may pick its own number types. */
    private fun canon(e: JsonElement?): Any? = when (e) {
        null, JsonNull -> null
        is JsonObject -> e.entries.associate { (k, v) -> k to canon(v) }.toSortedMap()
        is JsonArray -> e.map { canon(it) }
        is JsonPrimitive -> if (e.isString) e.content else e.booleanOrNull ?: e.content.toDoubleOrNull() ?: e.content
    }

    @Test fun `memory config resolves like the reference`() {
        for (c in f.getValue("memoryConfigs").jsonArray) {
            val o = c.jsonObject
            val a = o.getValue("agent").jsonObject
            val m = a["memory"]?.jsonObject
            val d = o.getValue("defaults").jsonObject
            val cfg = m?.let {
                AgentMemoryConfig(type = it["type"]?.jsonPrimitive?.content, window = it["window"]?.jsonPrimitive?.int, scope = it["scope"]?.jsonPrimitive?.content,
                    decayDays = it["decayDays"]?.jsonPrimitive?.int, topK = it["topK"]?.jsonPrimitive?.content?.toIntOrNull())
            }
            val defaults = ResolvedMemory(d["type"]?.jsonPrimitive?.content ?: "hybrid", "", d["topK"]?.jsonPrimitive?.int ?: 6, d["window"]?.jsonPrimitive?.int ?: 8, d["maxItems"]?.jsonPrimitive?.int ?: 2000, "both", 0, "", 0.0)
            val got = AgentMemory.resolve(a.getValue("id").jsonPrimitive.content, cfg, defaults)
            val exp = o.getValue("result").jsonObject
            assertEquals(exp.getValue("type").jsonPrimitive.content, got.type); assertEquals(exp.getValue("scope").jsonPrimitive.content, got.scope)
            assertEquals(exp.getValue("topK").jsonPrimitive.int, got.topK); assertEquals(exp.getValue("window").jsonPrimitive.int, got.window)
            assertEquals(exp.getValue("maxItems").jsonPrimitive.int, got.maxItems); assertEquals(exp.getValue("decayDays").jsonPrimitive.int, got.decayDays)
            assertEquals(exp.getValue("record").jsonPrimitive.content, got.record)
        }
    }

    @Test fun `tokens, bm25, chunks and trimming match`() {
        for (c in f.getValue("tokens").jsonArray) assertEquals(strs(c.jsonObject["tokens"]), AgentMemory.tokens(c.jsonObject.getValue("text").jsonPrimitive.content))
        val bm = f.getValue("bm25").jsonObject
        val docs = bm.getValue("docs").jsonArray.map { it.jsonObject.getValue("text").jsonPrimitive.content to strs(it.jsonObject["tags"]) }
        for (c in bm.getValue("cases").jsonArray) {
            val q = c.jsonObject.getValue("query").jsonPrimitive.content
            val exp = c.jsonObject.getValue("rank").jsonArray.map { it.jsonArray[0].jsonPrimitive.double to it.jsonArray[1].jsonPrimitive.int }
            assertEquals(exp, AgentMemory.bm25(q, docs), "bm25($q)")
        }
        for (c in f.getValue("chunks").jsonArray) {
            val o = c.jsonObject
            assertEquals(strs(o["chunks"]), AgentMemory.chunk(o.getValue("text").jsonPrimitive.content, o.getValue("size").jsonPrimitive.int, o.getValue("overlap").jsonPrimitive.int))
        }
        val items = listOf(
            MemoryItem("m1", "episode", "", createdAt = 1, hits = 5), MemoryItem("m2", "fact", "", createdAt = 2), MemoryItem("m3", "episode", "", createdAt = 3),
            MemoryItem("m4", "knowledge", "", createdAt = 4, hits = 2), MemoryItem("m5", "fact", "", createdAt = 5),
        )
        for (c in f.getValue("trim").jsonArray) assertEquals(strs(c.jsonObject["kept"]), AgentMemory.trim(items, c.jsonObject.getValue("maxItems").jsonPrimitive.int).map { it.id })
    }

    @Test fun `system prompts compose identically`() {
        for (c in f.getValue("compose").jsonArray) {
            val i = c.jsonObject.getValue("input").jsonObject
            val a = i.getValue("agent").jsonObject
            val persona = i["persona"]?.jsonObject?.let { p ->
                PersonaDef(name = p["name"]?.jsonPrimitive?.content ?: "", role = p["role"]?.jsonPrimitive?.content, voice = p["voice"]?.jsonPrimitive?.content, tone = p["tone"]?.jsonPrimitive?.content,
                    traits = strs(p["traits"]), rules = strs(p["rules"]), samples = strs(p["samples"]))
            }
            val skills = i["skills"]?.jsonArray?.map { s -> s.jsonObject.let { SkillDef(name = it["name"]?.jsonPrimitive?.content ?: "", instructions = it["instructions"]?.jsonPrimitive?.content, triggers = strs(it["triggers"]),
                examples = it["examples"]?.jsonArray?.map { e -> SkillExample(e.jsonObject["input"]?.jsonPrimitive?.content ?: "", e.jsonObject["output"]?.jsonPrimitive?.content ?: "") } ?: emptyList()) } } ?: emptyList()
            val lingo = i["lingo"]?.jsonArray?.map { l -> l.jsonObject.let { LingoDef(name = it["name"]?.jsonPrimitive?.content ?: "", style = it["style"]?.jsonPrimitive?.content,
                glossary = it["glossary"]?.jsonArray?.map { g -> GlossaryEntry(g.jsonObject["term"]?.jsonPrimitive?.content ?: "", g.jsonObject["meaning"]?.jsonPrimitive?.content ?: "") } ?: emptyList(),
                phrases = strs(it["phrases"]), avoid = strs(it["avoid"])) } } ?: emptyList()
            val got = AgentPrompts.compose(ComposeInput(agentId = a.getValue("id").jsonPrimitive.content, name = a["name"]?.jsonPrimitive?.content, description = a["description"]?.jsonPrimitive?.content,
                instructions = a["instructions"]?.jsonPrimitive?.content, persona = persona, skills = skills, lingo = lingo, extras = strs(i["extras"]), memory = i["memory"]?.jsonPrimitive?.booleanOrNull ?: false, tools = strs(i["tools"])))
            assertEquals(c.jsonObject.getValue("prompt").jsonPrimitive.content, got)
        }
    }

    @Test fun `workflow templates, router picks and tool templates match`() {
        for (c in f.getValue("templates").jsonArray) {
            val o = c.jsonObject
            val steps = o.getValue("steps").jsonObject.mapValues { it.value.jsonPrimitive.content }
            assertEquals(o.getValue("filled").jsonPrimitive.content, AgentPrompts.fillWorkflow(o.getValue("tpl").jsonPrimitive.content, o.getValue("input").jsonPrimitive.content, steps, o.getValue("previous").jsonPrimitive.content))
        }
        for (c in f.getValue("router").jsonArray) {
            val o = c.jsonObject
            assertEquals(strs(o["picked"]), AgentPrompts.parseRouterPick(o.getValue("reply").jsonPrimitive.content, strs(o["stepIds"])))
        }
        for (c in f.getValue("toolTemplates").jsonArray) {
            val o = c.jsonObject
            assertEquals(o.getValue("filled").jsonPrimitive.content, AgentPrompts.fillTool(o.getValue("template").jsonPrimitive.content, o.getValue("args").jsonObject, o.getValue("url").jsonPrimitive.boolean))
        }
    }

    @Test fun `add-on checks, risks and stripping match`() {
        for (c in f.getValue("addons").jsonArray) {
            val o = c.jsonObject
            val label = o.getValue("case").jsonPrimitive.content
            val (errors, bundle) = AgentValidator.validateAddon(o["raw"])
            assertEquals(o.getValue("ok").jsonPrimitive.boolean, errors.isEmpty(), label)
            assertEquals(strs(o["errors"]), errors, "$label errors")
            if (bundle != null) {
                assertEquals(strs(o["risks"]), AddonRisks.addon(bundle), "$label risks")
                assertEquals(canon(o["stripped"]), canon(AddonRisks.stripAddon(bundle)), "$label stripped")
            } else assertEquals(JsonNull, o["risks"] ?: JsonNull)
        }
    }

    @Test fun `placeholder runtime refuses to run tools and the kernel declares the capability`() = runTest {
        assertIs<AxfFailure.NotImplemented>(PlaceholderAgentRuntime.runTool("a", "t", JsonObject(emptyMap())).failureOrNull())
        assertNull(PlaceholderAgentRuntime.getAgent("a").getOrNull())
        assertEquals(emptyList(), PlaceholderAgentRuntime.listAgents().getOrNull())
        assertEquals(AGENTS_CAPABILITY, (PlaceholderAgentRuntime.runTool("a", "t", JsonObject(emptyMap())).failureOrNull() as AxfFailure.NotImplemented).capability)
    }
}
