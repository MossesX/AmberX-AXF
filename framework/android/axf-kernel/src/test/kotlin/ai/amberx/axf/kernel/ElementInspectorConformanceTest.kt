package ai.amberx.axf.kernel

import ai.amberx.axf.kernel.asset.parseJsonObject
import ai.amberx.axf.kernel.engine.InspectConfig
import ai.amberx.axf.kernel.engine.InspectEngine
import ai.amberx.axf.kernel.engine.InspectEvent
import ai.amberx.axf.kernel.engine.InspectOn
import ai.amberx.axf.kernel.engine.InspectPoint
import ai.amberx.axf.kernel.engine.InspectPointerType
import ai.amberx.axf.kernel.engine.InspectRect
import ai.amberx.axf.kernel.engine.InspectResult
import ai.amberx.axf.kernel.engine.InspectSize
import ai.amberx.axf.kernel.engine.InspectState
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.double
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals

/** element-inspector@1 conformance: InspectEngine replays spec/fixtures/element-inspector.json (from core/engines/inspect.ts). */
class ElementInspectorConformanceTest {
    private val f: JsonObject = File("../../spec/fixtures/element-inspector.json").readText().parseJsonObject()!!

    private fun d(o: JsonObject, k: String) = o.getValue(k).jsonPrimitive.double
    private fun size(e: JsonElement) = e.jsonObject.let { InspectSize(d(it, "w"), d(it, "h")) }
    private fun point(e: JsonElement?) = (e as? JsonObject)?.let { InspectPoint(d(it, "x"), d(it, "y")) }
    private fun rect(e: JsonElement) = e.jsonObject.let { InspectRect(d(it, "x"), d(it, "y"), d(it, "w"), d(it, "h")) }

    private fun config(e: JsonElement?): InspectConfig {
        val base = InspectConfig()
        val o = e as? JsonObject ?: return base
        return base.copy(
            doubleMs = o["doubleMs"]?.jsonPrimitive?.double ?: base.doubleMs,
            doubleDist = o["doubleDist"]?.jsonPrimitive?.double ?: base.doubleDist,
            offset = o["offset"]?.jsonPrimitive?.double ?: base.offset,
            margin = o["margin"]?.jsonPrimitive?.double ?: base.margin,
            panel = o["panel"]?.let(::size) ?: base.panel,
            min = o["min"]?.let(::size) ?: base.min,
        )
    }

    private fun event(e: JsonElement): InspectEvent {
        val o = e.jsonObject
        return when (val type = o.getValue("type").jsonPrimitive.content) {
            "unpin" -> InspectEvent.Unpin
            "viewport" -> InspectEvent.Viewport(d(o, "w"), d(o, "h"))
            else -> InspectEvent.Pointer(
                InspectPointerType.of(type)!!, d(o, "t"), d(o, "x"), d(o, "y"),
                button = o["button"]?.jsonPrimitive?.int ?: 0,
                primary = o["primary"]?.jsonPrimitive?.booleanOrNull ?: true,
                on = InspectOn.of(o["on"]?.jsonPrimitive?.content),
            )
        }
    }

    /** The state and result as the fixture writes them: same keys, numbers as doubles, null for absent. */
    private fun num(v: Double) = JsonPrimitive(v)
    private fun pt(p: InspectPoint?): JsonElement = p?.let { JsonObject(mapOf("x" to num(it.x), "y" to num(it.y))) } ?: JsonNull
    private fun rc(r: InspectRect) = JsonObject(mapOf("x" to num(r.x), "y" to num(r.y), "w" to num(r.w), "h" to num(r.h)))
    private fun st(s: InspectState) = JsonObject(mapOf(
        "viewport" to JsonObject(mapOf("w" to num(s.viewport.w), "h" to num(s.viewport.h))),
        "pressed" to JsonPrimitive(s.pressed),
        "follow" to pt(s.follow),
        "last" to (s.last?.let { JsonObject(mapOf("t" to num(it.t), "x" to num(it.x), "y" to num(it.y))) } ?: JsonNull),
        "pin" to (s.pin?.let { JsonObject(mapOf("at" to pt(it.at), "panel" to rc(it.panel))) } ?: JsonNull),
        "grab" to (s.grab?.let { JsonObject(mapOf("kind" to JsonPrimitive(it.kind.wire), "x" to num(it.x), "y" to num(it.y), "from" to rc(it.from))) } ?: JsonNull),
    ))
    private fun res(r: InspectResult) = JsonObject(mapOf("state" to st(r.state), "look" to pt(r.look), "pinned" to pt(r.pinned), "consume" to JsonPrimitive(r.consume)))

    /** Fixture JSON with every number as a double, so 10 and 10.0 compare equal. */
    private fun norm(e: JsonElement): JsonElement = when (e) {
        is JsonObject -> JsonObject(e.mapValues { norm(it.value) })
        is JsonArray -> JsonArray(e.map(::norm))
        is JsonPrimitive -> if (!e.isString && e.booleanOrNull == null && e !is JsonNull) JsonPrimitive(e.double) else e
    }

    @Test fun `contract and defaults match the reference engine`() {
        assertEquals(f.getValue("contract").jsonPrimitive.content, InspectEngine.VERSION)
        assertEquals(config(f["defaults"]), InspectConfig())
    }

    @Test fun `pointer scenarios replay step for step`() {
        for (sc in f.getValue("scenarios") as JsonArray) {
            val o = sc.jsonObject
            val cfg = config(o["config"])
            var s = InspectEngine.init(size(o.getValue("viewport")))
            for ((i, stepEl) in (o.getValue("steps") as JsonArray).withIndex()) {
                val step = stepEl.jsonObject
                val r = InspectEngine.step(s, event(step.getValue("event")), cfg)
                val want = norm(JsonObject(step.filterKeys { it != "event" }))
                assertEquals(want, norm(res(r)), "${o["name"]} step $i ${step["event"]}")
                s = r.state
            }
        }
    }

    @Test fun `panel geometry matches`() {
        val vp = size(f.getValue("viewport"))
        for (c in f.getValue("follow") as JsonArray) c.jsonObject.let { assertEquals(point(it["out"]), InspectEngine.followPanel(point(it["at"])!!, size(it.getValue("size")), vp), "follow $it") }
        for (c in f.getValue("clamp") as JsonArray) c.jsonObject.let { assertEquals(rect(it.getValue("out")), InspectEngine.clampPanel(rect(it.getValue("in")), vp), "clamp $it") }
        for (c in f.getValue("move") as JsonArray) c.jsonObject.let { assertEquals(rect(it.getValue("out")), InspectEngine.movePanel(rect(it.getValue("from")), d(it, "dx"), d(it, "dy"), vp), "move $it") }
        for (c in f.getValue("resize") as JsonArray) c.jsonObject.let { assertEquals(rect(it.getValue("out")), InspectEngine.resizePanel(rect(it.getValue("from")), d(it, "dw"), d(it, "dh"), vp), "resize $it") }
        for (c in f.getValue("pin") as JsonArray) c.jsonObject.let { assertEquals(rect(it.getValue("out")), InspectEngine.pinPanel(point(it["at"])!!, vp), "pin $it") }
    }
}
