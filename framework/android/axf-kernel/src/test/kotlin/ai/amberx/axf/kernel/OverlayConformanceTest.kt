package ai.amberx.axf.kernel

import ai.amberx.axf.kernel.asset.AssetTypeRegistry
import ai.amberx.axf.kernel.asset.AssetTypes
import ai.amberx.axf.kernel.asset.AssetValidator
import ai.amberx.axf.kernel.asset.parseJsonObject
import ai.amberx.axf.kernel.engine.OverlayData
import ai.amberx.axf.kernel.engine.OverlayEngine
import ai.amberx.axf.kernel.engine.OverlayLogLine
import ai.amberx.axf.kernel.engine.OverlayPoint
import ai.amberx.axf.kernel.engine.OverlayScreen
import ai.amberx.axf.kernel.engine.OverlaySize
import ai.amberx.axf.kernel.engine.OverlayStrip
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Replays spec/fixtures/overlay.json (generated from core/engines/overlay.ts) against OverlayEngine: both ports must agree
 * on normalising, validation messages, geometry clamps, log trimming + texts, strip expiry, chip state, settings over the
 * asset and the `w,h` / `x,y` parsers. Also checks the three starter assets validate and the type is registered as optional
 * hideable chrome. Written without a compiler (CI runs :axf-kernel:test).
 */
class OverlayConformanceTest {
    private val f: JsonObject = File("../../spec/fixtures/overlay.json").readText().parseJsonObject()!!
    private val starters: Map<String, OverlayData> = f.getValue("starters").jsonObject.mapValues { OverlayEngine.normalize(it.value) }

    private fun str(o: JsonObject, k: String): String? = (o[k] as? JsonPrimitive)?.takeIf { it.isString }?.content
    private fun num(e: JsonElement?): Double? = (e as? JsonPrimitive)?.takeUnless { it.isString || it is JsonNull }?.doubleOrNull
    private fun strings(e: JsonElement?): List<String> = (e as? JsonArray)?.map { it.jsonPrimitive.content } ?: emptyList()
    private fun screen(o: JsonObject): OverlayScreen = OverlayScreen(num(o["width"])!!.toInt(), num(o["height"])!!.toInt())
    private fun size(e: JsonElement?): OverlaySize? = (e as? JsonObject)?.let { OverlaySize(num(it["width"])!!.toInt(), num(it["height"])!!.toInt()) }
    private fun lines(): List<OverlayLogLine> = f.getValue("log").jsonObject.getValue("lines").jsonArray.map { OverlayLogLine.fromJson(it.jsonObject) }
    private fun strip(o: JsonObject): OverlayStrip = OverlayStrip(true, num(o["maxLines"])!!.toInt(), num(o["lineMs"])!!.toInt())
    private fun stringMap(o: JsonObject?): Map<String, String?> = o?.mapValues { (it.value as? JsonPrimitive)?.takeUnless { p -> p is JsonNull }?.content } ?: emptyMap()
    private fun boolMap(o: JsonObject?): Map<String, Boolean?> = o?.mapValues { (it.value as? JsonPrimitive)?.booleanOrNull } ?: emptyMap()

    @Test fun constantsMatchTheWebPort() {
        assertEquals(str(f, "type"), OverlayEngine.TYPE)
        assertEquals(AssetTypes.OVERLAY, OverlayEngine.TYPE)
        assertEquals(f.getValue("settings").jsonObject.mapValues { it.value.jsonPrimitive.content }, OverlayEngine.Settings.ALL)
        assertEquals(f.getValue("limits").jsonObject, OverlayEngine.Limits.toJson())
        assertEquals(strings(f["tones"]), OverlayEngine.CHIP_TONES)
        assertEquals(f.getValue("toneToken").jsonObject.mapValues { it.value.jsonPrimitive.content }, OverlayEngine.CHIP_TONE_TOKEN)
        for (t in OverlayEngine.CHIP_TONES) assertEquals(OverlayEngine.CHIP_TONE_TOKEN[t], OverlayEngine.chipToneToken(t))
        assertEquals("text", OverlayEngine.chipToneToken("pink"))
        for (k in OverlayEngine.Settings.ALL.values) assertTrue(k.startsWith("axf.overlay."), k)
    }

    @Test fun typeIsOptionalHideableChrome() {
        val types = AssetTypeRegistry.builtin()
        val spec = types.get(AssetTypes.OVERLAY)!!
        assertTrue(spec.optional, "optional")
        assertTrue(spec.hideable, "hideable")
        assertEquals("Chrome", spec.group)
        assertEquals(listOf("pill", "log", "strip", "mini"), spec.required)
        assertTrue(AssetTypes.OVERLAY in AssetTypes.OPTIONAL_SHARED)
    }

    @Test fun startersNormaliseAndValidate() {
        val validator = AssetValidator(AssetTypeRegistry.builtin())
        val dir = File("../../assets/overlay")
        val files = dir.listFiles { x -> x.name.endsWith(".json") }!!.toList()
        assertTrue(files.size >= 3, "starters")
        for (file in files) {
            val raw = file.readText().parseJsonObject()!!
            val id = str(raw, "id")!!
            val r = validator.validate(raw)
            assertTrue(r.ok, "$id: ${r.errors}")
            assertEquals(emptyList(), OverlayEngine.errors(raw["data"]), "$id engine errors")
            val want = f.getValue("starters").jsonObject.getValue(id).jsonObject
            assertEquals(want, OverlayEngine.normalize(raw["data"]).toJson(), "$id normalised")
            assertEquals(want, OverlayEngine.normalize(want).toJson(), "$id stable")
            assertTrue(!file.readText().contains("ActiveX", ignoreCase = true), "$id: no product name")
        }
        assertEquals(files.map { str(it.readText().parseJsonObject()!!, "id")!! }.sorted(), f.getValue("starters").jsonObject.keys.sorted())
    }

    @Test fun normalisingIsLenientAndStable() {
        for ((name, c) in f.getValue("normalize").jsonObject) {
            val o = c.jsonObject
            val out = o.getValue("out").jsonObject
            assertEquals(out, OverlayEngine.normalize(o["raw"]).toJson(), "normalize $name")
            assertEquals(out, OverlayEngine.normalize(out).toJson(), "normalize $name idempotent")
            assertEquals(emptyList(), OverlayEngine.errors(out), "normalized $name has no errors")
        }
        val clamped = OverlayEngine.normalize(f.getValue("normalize").jsonObject.getValue("clamped").jsonObject["raw"])
        assertEquals(listOf("a", "b"), clamped.pill.chips.map { it.id })
        assertEquals(OverlayEngine.Limits.LABEL_MAX, clamped.pill.chips[0].label.length)
        assertEquals("success", clamped.pill.chips[0].tone)
        assertEquals(OverlayEngine.Limits.LOG_LINES_MAX, clamped.log.maxLines)
        assertEquals(1.0, clamped.opacity)
        assertTrue(clamped.size.minWidth <= clamped.size.maxWidth && clamped.mini.width.min >= clamped.size.minWidth && clamped.mini.width.max <= clamped.size.maxWidth)
        assertEquals(OverlayEngine.Limits.OPACITY_MIN, OverlayEngine.normalize("""{"opacity":0.01}""".parseJsonObject()).opacity)
    }

    @Test fun errorsMatchTheSharedValidator() {
        for ((name, c) in f.getValue("errors").jsonObject) {
            val o = c.jsonObject
            assertEquals(strings(o["errors"]), OverlayEngine.errors(o["raw"]), "errors $name")
        }
        // the asset validator carries the engine's messages after the envelope + required-field rules
        val validator = AssetValidator(AssetTypeRegistry.builtin())
        val raw = """{"${'$'}axf":"asset@1","type":"overlay","id":"xx","name":"x","version":"1","data":{"pill":{"chips":"none"},"log":{"show":true},"strip":{"show":true},"mini":{"defaultOpen":false}}}""".parseJsonObject()!!
        assertEquals(listOf("data.pill.chips must be a list"), validator.validate(raw).errors)
    }

    @Test fun geometryClampsToAssetAndScreen() {
        for (g in f.getValue("geometry").jsonArray.map { it.jsonObject }) {
            val name = str(g, "name")
            val d = starters.getValue(str(g, "data")!!)
            val sc = screen(g.getValue("screen").jsonObject)
            val wanted = size(g["wanted"])
            assertEquals(g.getValue("max").jsonObject, OverlayEngine.maxSize(d, sc).toJson(), "max $name")
            val s = OverlayEngine.clampSize(d, wanted, sc)
            assertEquals(g.getValue("size").jsonObject, s.toJson(), "size $name")
            assertEquals(g.getValue("mini").jsonObject, OverlayEngine.miniSize(d, wanted, sc).toJson(), "mini $name")
            val pin = g["positionIn"] as? JsonObject
            val p = OverlayEngine.clampPosition(pin?.let { num(it["x"]) }, pin?.let { num(it["y"]) }, s, sc)
            assertEquals(g.getValue("position").jsonObject, p.toJson(), "position $name")
            assertTrue(p.x >= 0 && p.y >= 0 && p.x + s.width <= sc.width && p.y + s.height <= sc.height, "$name fits the screen")
        }
        assertEquals(OverlayPoint(0, 0), OverlayEngine.clampPosition(null, OverlaySize(100, 100), OverlayScreen(50, 50)))
        for (c in f.getValue("canDrag").jsonArray.map { it.jsonObject }) {
            assertEquals((c["out"] as JsonPrimitive).booleanOrNull, OverlayEngine.canDrag(starters.getValue(str(c, "data")!!), str(c, "setting")), "canDrag ${c["data"]} ${c["setting"]}")
        }
        assertTrue(OverlayEngine.canDrag(starters.getValue("quiet-strip"), false))
    }

    @Test fun logLinesTrimAndFormat() {
        val log = f.getValue("log").jsonObject
        val lines = lines()
        val raw = log.getValue("lines").jsonArray.map { it.jsonObject }
        for ((i, l) in lines.withIndex()) assertEquals(raw[i], l.toJson(), "line $i round trip")
        assertEquals(OverlayEngine.Limits.LINE_TEXT_MAX, lines[3].text.length)
        assertEquals(OverlayEngine.Limits.TAG_MAX, lines[3].tag.length)
        assertEquals(1.0, lines[3].confidence)
        assertEquals(0.0, lines[4].confidence)
        assertEquals(0.9123, lines[0].confidence)
        assertNull(lines[2].confidence)
        // the same inputs the web port used rebuild the same lines
        assertEquals(lines[0], OverlayEngine.logLine("swipe up", 0.91234, "fired", lines[0].at, "trig.swipe-up"))
        assertEquals(lines[3], OverlayEngine.logLine("x".repeat(300), 1.7, "tag that is far too long to keep whole", lines[3].at))
        assertEquals(lines[4], OverlayEngine.logLine("nod", -2.0, "cooldown", lines[4].at))
        assertEquals(lines[2], OverlayEngine.logLine("wave", null, "", lines[2].at, "trig.wave"))
        for ((i, t) in log.getValue("texts").jsonArray.map { it.jsonObject }.withIndex()) {
            assertEquals(str(t, "shown"), OverlayEngine.logLineText(lines[i], true), "text $i")
            assertEquals(str(t, "hidden"), OverlayEngine.logLineText(lines[i], false), "text hidden $i")
            assertEquals(str(t, "confidence"), OverlayEngine.confidenceText(lines[i].confidence), "confidence text $i")
        }
        assertEquals("swipe up · 91.2% · fired", OverlayEngine.logLineText(lines[0], true))
        for (c in log.getValue("trim").jsonArray.map { it.jsonObject }) {
            assertEquals(strings(c["out"]), OverlayEngine.trimLog(lines, num(c["maxLines"])!!.toInt()).map { it.text.take(8) }, "trim ${c["maxLines"]}")
        }
        val add = log.getValue("add").jsonObject
        val max = num(add["maxLines"])!!.toInt()
        assertEquals(starters.getValue("detector-panel").log.maxLines, max)
        var acc: List<OverlayLogLine> = emptyList()
        for (l in lines) acc = OverlayEngine.addLogLine(acc, l, max)
        assertEquals(add.getValue("out").jsonArray.map { num(it)!!.toLong() }, acc.map { it.at })
        for (c in log.getValue("fade").jsonArray.map { it.jsonObject }) {
            val n = num(c["count"])!!.toInt()
            assertEquals(c.getValue("out").jsonArray.map { num(it)!! }, (0 until n).map { OverlayEngine.logLineFade(it, n) }, "fade $n")
        }
        assertEquals(1.0, OverlayEngine.logLineFade(4, 5))
        assertEquals(0.35, OverlayEngine.logLineFade(0, 50))
    }

    @Test fun stripLinesExpire() {
        val lines = lines()
        val strip = OverlayStrip(true, 3, 3000)
        for (c in f.getValue("strip").jsonArray.map { it.jsonObject }) {
            val now = num(c["now"])!!.toLong()
            assertEquals(c.getValue("out").jsonArray.map { num(it)!!.toLong() }, OverlayEngine.stripLines(lines, now, strip).map { it.at }, "strip $now")
            assertEquals(num(c["next"])?.toLong(), OverlayEngine.nextStripExpiry(lines, now, strip), "strip next $now")
        }
        val one = f.getValue("stripOne").jsonObject
        val oneStrip = strip(one.getValue("strip").jsonObject)
        val now = num(one["now"])!!.toLong()
        assertEquals(one.getValue("out").jsonArray.map { num(it)!!.toLong() }, OverlayEngine.stripLines(lines, now, oneStrip).map { it.at })
        assertEquals(num(one["next"])?.toLong(), OverlayEngine.nextStripExpiry(lines, now, oneStrip))
        val t0 = lines[0].at
        assertEquals(emptyList(), OverlayEngine.stripLines(lines, t0 - 1, strip))
        assertEquals(emptyList(), OverlayEngine.stripLines(lines, t0 + 6200, strip))
        assertNull(OverlayEngine.nextStripExpiry(lines, t0 + 9000, strip))
        assertEquals(16L, OverlayEngine.nextStripExpiry(lines, t0 + 1199, 6, 1200))
    }

    @Test fun chipsResolveFromState() {
        val chips = starters.getValue("detector-panel").pill.chips
        for ((name, c) in f.getValue("chips").jsonObject) {
            val o = c.jsonObject
            assertEquals(o.getValue("out").jsonArray.map { it.jsonObject }, OverlayEngine.resolveChips(chips, boolMap(o["states"] as? JsonObject)).map { it.toJson() }, "chips $name")
        }
        val none = OverlayEngine.resolveChips(chips, emptyMap())
        assertEquals("Idle", none[0].text)
        assertEquals("muted", none[1].tone)
        val on = OverlayEngine.resolveChips(chips, mapOf("armed" to true))
        assertEquals("Armed", on[0].text)
        assertEquals("success", on[0].tone)
        for (c in f.getValue("setChip").jsonArray.map { it.jsonObject }) {
            val out = OverlayEngine.setChip(boolMap(c["states"] as? JsonObject), str(c, "id")!!, (c["on"] as JsonPrimitive).booleanOrNull!!)
            assertEquals(c.getValue("out").jsonObject.mapValues { (it.value as JsonPrimitive).booleanOrNull!! }, out, "setChip ${c["id"]}")
        }
    }

    @Test fun settingsOverTheAsset() {
        for ((name, c) in f.getValue("withSettings").jsonObject) {
            val o = c.jsonObject
            val d = starters.getValue(str(o, "data")!!)
            val out = OverlayEngine.withSettings(d, stringMap(o["values"] as? JsonObject))
            assertEquals(o.getValue("out").jsonObject, out.toJson(), "withSettings $name")
            assertEquals(emptyList(), OverlayEngine.errors(out.toJson()), "withSettings $name still valid")
        }
        val compact = starters.getValue("pill-compact")
        assertEquals(compact, OverlayEngine.withSettings(compact, emptyMap()))
        val all = OverlayEngine.withSettings(compact, mapOf(OverlayEngine.Settings.SIZE to "300,200", OverlayEngine.Settings.OPACITY to "0.5", OverlayEngine.Settings.POSITION_LOCK to "true", OverlayEngine.Settings.LOG to "true", OverlayEngine.Settings.STRIP to "false"))
        assertEquals(0.5, all.opacity)
        assertTrue(all.positionLock && all.log.show && !all.strip.show)
        assertEquals(300 to 200, all.mini.width.default to all.mini.height.default)
    }

    @Test fun pairsParseAndSerialize() {
        val parse = f.getValue("parse").jsonObject
        for (c in parse.getValue("size").jsonArray.map { it.jsonObject }) {
            val want = (c["out"] as? JsonObject)?.let { num(it["width"])!! to num(it["height"])!! }
            assertEquals(want, OverlayEngine.parseSize(str(c, "raw")), "parseSize ${c["raw"]}")
        }
        for (c in parse.getValue("position").jsonArray.map { it.jsonObject }) {
            val want = (c["out"] as? JsonObject)?.let { num(it["x"])!! to num(it["y"])!! }
            assertEquals(want, OverlayEngine.parsePosition(str(c, "raw")), "parsePosition ${c["raw"]}")
        }
        val ser = parse.getValue("serialize").jsonObject
        assertEquals(str(ser, "size"), OverlayEngine.serializeSize(10.4, 20.6))
        assertEquals(str(ser, "position"), OverlayEngine.serializePosition(-3.5, 2.49))
        assertEquals("300,200", OverlayEngine.serializeSize(OverlaySize(300, 200)))
        assertEquals(300.0 to 200.0, OverlayEngine.parseSize("300,200"))
        assertNull(OverlayEngine.parseSize("0,10"))
        assertNull(OverlayEngine.parseSize(null))
    }
}
