package ai.amberx.axf.kernel

import ai.amberx.axf.kernel.asset.bool
import ai.amberx.axf.kernel.asset.objList
import ai.amberx.axf.kernel.asset.parseJsonObject
import ai.amberx.axf.kernel.asset.str
import ai.amberx.axf.kernel.asset.strList
import ai.amberx.axf.kernel.assistant.AssistantRules
import ai.amberx.axf.kernel.assistant.LiveReply
import ai.amberx.axf.kernel.assistant.Message
import ai.amberx.axf.kernel.assistant.ProviderRegistry
import ai.amberx.axf.kernel.assistant.Sse
import ai.amberx.axf.kernel.assistant.StreamEvent
import ai.amberx.axf.kernel.live.LiveKinds
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** Replays spec/fixtures/assistant.json (generated from core/assistant.ts) against the kernel's assistant package. */
class AssistantConformanceTest {
    private val f: JsonObject = File("../../spec/fixtures/assistant.json").readText().parseJsonObject()!!

    @Test fun `provider registry matches the shared schema`() {
        val exp = f.getValue("providers").jsonArray.map { it.jsonObject }
        assertEquals(exp.size, ProviderRegistry.kinds.size)
        for (p in exp) {
            val k = ProviderRegistry.get(p.str("kind")) ?: error("missing provider kind ${p.str("kind")}")
            assertEquals(p.str("protocol"), k.protocol); assertEquals(p.str("keyEnv"), k.keyEnv); assertEquals(p.str("auth"), k.auth); assertEquals(p.str("baseUrl"), k.baseUrl)
        }
    }

    @Test fun `secrets are redacted the same way`() {
        for (c in f.getValue("redact").jsonArray.map { it.jsonObject }) {
            assertEquals(c.str("on"), AssistantRules.redactSecrets(c.str("text"), true), c.str("text"))
            assertEquals(c.str("off"), AssistantRules.redactSecrets(c.str("text"), false))
        }
    }

    @Test fun `history window matches the reference`() {
        val h = f.getValue("history").jsonObject
        val msgs = h.objList("messages").map(Message::fromJson)
        for (w in h.objList("windows")) {
            val got = AssistantRules.wireHistory(msgs, w.getValue("limit").jsonPrimitive.int)
            val exp = w.objList("wire")
            assertEquals(exp.map { it.str("role") to it.str("content") }, got.map { it.role to it.content }, "limit ${w.getValue("limit")}")
            assertEquals(exp.map { it.objList("tool_calls").map { c -> c.str("id") } }, got.map { it.toolCalls.map { c -> c.id } })
            assertEquals(exp.map { it["tool_call_id"]?.jsonPrimitive?.content }, got.map { it.toolCallId })
            assertEquals(exp.map { it.objList("images").size }, got.map { it.images.size })
            assertEquals(exp.map { it.objList("thinking_blocks").size }, got.map { it.thinkingBlocks.size })
        }
        val orphan = h.objList("orphanStart")
        assertEquals(orphan.map { it.str("role") }, AssistantRules.wireHistory(msgs.drop(4), 5).map { it.role })
    }

    @Test fun `profile chain, permissions, settings and clamps match`() {
        for (c in f.objList("chains")) {
            val s = c["settings"]?.jsonObject
            assertEquals(c.strList("chain"), AssistantRules.profileChain(s?.get("profileId")?.jsonPrimitive?.content, c["agent"]?.let { (it as? JsonPrimitive)?.content }, c.str("def"), c.strList("fallback")))
        }
        for (c in f.objList("permissions")) assertEquals(c.bool("allowed"), AssistantRules.permissionAllows(c.strList("perms"), c.str("perm"), c.bool("admin")), c.toString())
        for (c in f.objList("settingsAllowed")) {
            val perms = c.strList("perms")
            assertEquals(c.strList("keys"), AssistantRules.settingsAllowedFor(c.bool("admin")) { AssistantRules.permissionAllows(perms, it) })
        }
        for (c in f.objList("clampParams")) {
            val got = AssistantRules.clampUserParams(c.getValue("params").jsonObject, c.bool("admin"), c.bool("canModels"))
            val exp = c.getValue("out").jsonObject
            assertEquals(exp.keys, got.keys, c.toString())
            for (k in exp.keys) assertEquals((exp[k] as? JsonPrimitive)?.doubleOrNull ?: exp[k].toString(), (got[k] as? JsonPrimitive)?.doubleOrNull ?: got[k].toString(), "$k in $c")
        }
    }

    @Test fun `titles, summaries and owner kinds match`() {
        for (c in f.objList("titles")) {
            assertEquals(c.str("title"), AssistantRules.batchTitle(c.str("text"), c.getValue("n").jsonPrimitive.int))
            assertEquals(c.str("convTitle"), AssistantRules.titleFromText(c.str("text")))
        }
        for (c in f.objList("summaries")) assertEquals(c.str("summary"), AssistantRules.summarizeArgs(c.getValue("args").jsonObject))
        for (c in f.objList("ownerKinds")) assertEquals(c.str("owner"), AssistantRules.ownerKind(c.str("kind"), LiveKinds.ALL))
        for (c in f.objList("reconnect")) assertEquals(c.getValue("delayMs").jsonPrimitive.long, AssistantRules.reconnectDelayMs(c.getValue("attempt").jsonPrimitive.int))
    }

    @Test fun `SSE framing and the live-reply fold match`() {
        val s = f.getValue("sse").jsonObject
        val (frames, rest) = Sse.parseText(s.str("text"))
        assertEquals(s.str("rest"), rest)
        assertEquals(s.objList("frames").map { Triple(it.str("event"), it.str("data"), it["id"]?.jsonPrimitive?.long) }, frames.map { Triple(it.event, it.data, it.id) })
        val events = s.objList("events")
        assertEquals(events.map { it.str("event") to it["seq"]?.jsonPrimitive?.long }, frames.map(Sse::toEvent).map { it.event to it.seq })

        val lr = f.getValue("liveReply").jsonObject
        val reply = LiveReply("Connecting…")
        val folds = lr.objList("folds")
        for ((i, e) in lr.objList("events").withIndex()) {
            reply.apply(StreamEvent(e.str("event"), e["data"], e["seq"]?.let { (it as? JsonPrimitive)?.long }))
            val exp = folds[i]
            assertEquals(exp.str("text"), reply.text, "fold $i text"); assertEquals(exp.str("status"), reply.status, "fold $i status")
            assertEquals(exp.str("turnId"), reply.turnId); assertEquals(exp.str("agent"), reply.agent); assertEquals(exp.str("thinking"), reply.thinking)
            assertEquals(exp.getValue("lastSeq").jsonPrimitive.long, reply.lastSeq, "fold $i seq"); assertEquals(exp.bool("done"), reply.done, "fold $i done")
            assertEquals(exp.objList("tools").map { Triple(it.str("id"), it.bool("done"), it.str("preview")) }, reply.tools.map { Triple(it.id, it.done, it.preview ?: "") })
        }
        val inter = lr.getValue("interrupted").jsonObject
        val r2 = LiveReply().apply(StreamEvent(LiveKinds.INTERRUPTED, null, 2))
        assertEquals(inter.str("error"), r2.error); assertTrue(r2.done); assertEquals(2L, r2.lastSeq)
    }
}
