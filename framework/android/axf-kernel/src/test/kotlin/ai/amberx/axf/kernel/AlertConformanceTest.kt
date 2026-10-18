package ai.amberx.axf.kernel

import ai.amberx.axf.kernel.alerts.Alert
import ai.amberx.axf.kernel.alerts.AlertEngine
import ai.amberx.axf.kernel.alerts.AlertInput
import ai.amberx.axf.kernel.alerts.AlertRules
import ai.amberx.axf.kernel.alerts.AlertSeverity
import ai.amberx.axf.kernel.alerts.ChannelRule
import ai.amberx.axf.kernel.alerts.Diagnostic
import ai.amberx.axf.kernel.asset.parseJsonObject
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals

/** Replays spec/fixtures/alerts.json (generated from core/engines/alerts.ts) against AlertEngine. */
class AlertConformanceTest {
    private val f: JsonObject = File("../../spec/fixtures/alerts.json").readText().parseJsonObject()!!

    private fun str(o: JsonObject, k: String): String? = (o[k] as? JsonPrimitive)?.takeIf { it !is JsonNull }?.content
    private fun input(o: JsonObject) = AlertInput(
        source = str(o, "source")!!, severity = str(o, "severity")!!, title = str(o, "title")!!,
        body = str(o, "body"), key = str(o, "key"), link = str(o, "link"),
        meta = (o["meta"] as? JsonObject)?.mapValues { it.value.jsonPrimitive } ?: emptyMap(),
    )
    private fun rules(o: JsonObject) = AlertRules(o.getValue("channels").jsonObject.mapValues { (_, r) ->
        val ro = r.jsonObject
        ChannelRule(str(ro, "min")!!, (ro["sources"] as? JsonObject)?.mapValues { it.value.jsonPrimitive.content } ?: emptyMap())
    })
    private fun strings(e: kotlinx.serialization.json.JsonElement) = (e as JsonArray).map { it.jsonPrimitive.content }

    @Test fun `severities, keys and ntfy priorities match`() {
        assertEquals(strings(f.getValue("severities")), AlertSeverity.entries.map { it.id })
        assertEquals(strings(f.getValue("keys")), listOf(AlertEngine.key("ci", "Failed"), AlertEngine.key(" ci ", " Failed ", "  "), AlertEngine.key("x", "y", "k1")))
        for ((s, p) in f.getValue("ntfyPriority").jsonObject) assertEquals(p.jsonPrimitive.content.toInt(), AlertEngine.ntfyPriority(AlertSeverity.parse(s)), s)
    }

    @Test fun `raise, repeat, escalate, resolve, reopen and deliver match the reference engine`() {
        val rules = rules(f.getValue("rules").jsonObject)
        val steps = f.getValue("steps").jsonArray
        val events = f.getValue("events").jsonArray
        var list = emptyList<Alert>()
        steps.forEachIndexed { i, s ->
            val st = s.jsonObject
            val exp = events[i].jsonObject
            when (str(st, "op")) {
                "raise" -> {
                    val r = AlertEngine.apply(list, input(st.getValue("input").jsonObject), st.getValue("at").jsonPrimitive.content.toLong())
                    list = r.list
                    assertEquals(str(exp, "key"), r.alert.key, "step $i key")
                    assertEquals(str(exp, "event"), r.event.id, "step $i event")
                    assertEquals(str(exp, "severity"), r.alert.severity.id, "step $i severity")
                    assertEquals(exp.getValue("count").jsonPrimitive.content.toInt(), r.alert.count, "step $i count")
                    assertEquals(exp.getValue("ack").jsonPrimitive.content.toBoolean(), r.alert.ack, "step $i ack")
                    assertEquals(strings(exp.getValue("targets")), AlertEngine.targets(r.alert.severity, r.alert.source, r.event, rules), "step $i targets")
                    assertEquals(strings(exp.getValue("defaultTargets")), AlertEngine.targets(r.alert.severity, r.alert.source, r.event), "step $i default targets")
                }
                "resolve" -> list = AlertEngine.resolve(list, strings(st.getValue("keys")), st.getValue("at").jsonPrimitive.content.toLong())
                "ack" -> list = AlertEngine.ack(list, (st["ids"] as? JsonArray)?.map { it.jsonPrimitive.content })
            }
            assertEquals(exp.getValue("unread").jsonPrimitive.content.toInt(), AlertEngine.unread(list), "step $i unread")
        }
        val final = f.getValue("final").jsonArray.map { it.jsonObject }
        val got = AlertEngine.sort(list)
        assertEquals(final.map { str(it, "key") }, got.map { it.key }, "final order")
        for ((e, a) in final.zip(got)) {
            assertEquals(str(e, "severity"), a.severity.id, a.key)
            assertEquals(str(e, "title"), a.title, a.key)
            assertEquals(str(e, "body"), a.body, a.key)
            assertEquals(str(e, "link"), a.link, a.key)
            assertEquals(e.getValue("count").jsonPrimitive.content.toInt(), a.count, a.key)
            assertEquals(e.getValue("firstAt").jsonPrimitive.content.toLong(), a.firstAt, a.key)
            assertEquals(e.getValue("lastAt").jsonPrimitive.content.toLong(), a.lastAt, a.key)
            assertEquals(e.getValue("resolved").jsonPrimitive.content.toBoolean(), a.resolved, a.key)
            assertEquals((e["resolvedAt"] as? JsonPrimitive)?.takeIf { it !is JsonNull }?.content?.toLong(), a.resolvedAt, a.key)
            assertEquals(e.getValue("meta").jsonObject.mapValues { it.value.jsonPrimitive.content }, a.meta.mapValues { it.value.content }, a.key)
        }
    }

    @Test fun `trimming keeps the same alerts`() {
        var t = emptyList<Alert>()
        for (i in 0 until 6) t = AlertEngine.apply(t, AlertInput("s", "info", "a$i"), 100L + i).list
        t = AlertEngine.resolve(t, listOf("s:a3"), 200)
        t = AlertEngine.ack(t, listOf("s:a1"))
        assertEquals(strings(f.getValue("trim").jsonObject.getValue("kept")), AlertEngine.trim(t, 4).map { it.key })
    }

    @Test fun `diagnostics become the same alerts`() {
        for (c in f.getValue("diagnostics").jsonArray) {
            val d = c.jsonObject.getValue("diagnostic").jsonObject
            val diag = when (str(d, "kind")) {
                "asset-conflict" -> Diagnostic.AssetConflict(str(d, "type")!!, str(d, "id")!!, str(d, "was")!!, str(d, "now")!!)
                "setting-conflict" -> Diagnostic.SettingConflict(str(d, "key")!!, str(d, "was")!!, str(d, "now")!!)
                "contribution-conflict" -> Diagnostic.ContributionConflict(str(d, "what")!!, str(d, "id")!!, str(d, "was")!!, str(d, "now")!!)
                else -> Diagnostic.Crash(str(d, "where")!!, str(d, "message")!!, str(d, "detail"))
            }
            val exp = c.jsonObject.getValue("alert").jsonObject
            val got = AlertEngine.fromDiagnostic(diag)
            assertEquals(str(exp, "source"), got.source)
            assertEquals(str(exp, "severity"), got.severity)
            assertEquals(str(exp, "key"), got.key)
            assertEquals(str(exp, "title"), got.title)
            assertEquals(str(exp, "body"), got.body)
            assertEquals(exp.getValue("meta").jsonObject.mapValues { it.value.jsonPrimitive.content }, got.meta.mapValues { it.value.content })
        }
    }
}
