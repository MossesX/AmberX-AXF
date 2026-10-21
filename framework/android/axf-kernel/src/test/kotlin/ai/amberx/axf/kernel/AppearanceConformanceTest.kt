package ai.amberx.axf.kernel

import ai.amberx.axf.kernel.asset.AssetRegistry
import ai.amberx.axf.kernel.asset.AssetTypeRegistry
import ai.amberx.axf.kernel.asset.parseJsonObject
import ai.amberx.axf.kernel.engine.AppearanceChange
import ai.amberx.axf.kernel.engine.AppearanceDocument
import ai.amberx.axf.kernel.engine.AppearanceEngine
import ai.amberx.axf.kernel.engine.AppearanceSourceState
import ai.amberx.axf.kernel.engine.Spacing
import ai.amberx.axf.kernel.manifest.AxfManifest
import ai.amberx.axf.kernel.runtime.AppearanceEvent
import ai.amberx.axf.kernel.runtime.AppearanceSource
import ai.amberx.axf.kernel.runtime.AxfRuntime
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Appearance document conformance (spec/fixtures/appearance.json, from core/engines/appearance.ts) + the runtime's
 * source wiring: attach → waiting → ready applies → unknown ids keep the default → local changes push, pushed
 * documents don't echo → hub down = not ready (no fallback).
 */
class AppearanceConformanceTest {
    private val fixtures = File("../../spec/fixtures")
    private val assetsDir = File("../../assets")
    private fun fixture(name: String): JsonObject = File(fixtures, name).readText().parseJsonObject()!!
    private val docs = mapOf(
        "full" to """{"${'$'}axf":"appearance@1","slots":{"color-theme":"arctic-daylight","style-theme":"glass-orbit","layout":"focus-top","uac-policy":"admin-only","toolbar":"standard-icons"},"spacing":"compact","hidden":{"toolbar":true,"color-theme":true,"nav-menu":false},"palette":{"scheme":"light","bg":"#f2f5f8","accent":"rgb(31,111,235)","fg":"url(x)"},"updatedBy":"axf-console","updatedAt":"2026-10-21T00:00:00Z"}""",
        "unknown-ids" to """{"${'$'}axf":"appearance@1","slots":{"color-theme":"no-such-theme","layout":"classic-ide","not-a-type":"x","bad id!":"y","toolbar":"Bad Id"},"spacing":"roomy","hidden":{"toolbar":"yes"}}""",
        "wrong-frame" to """{"${'$'}axf":"asset@1","slots":{"layout":"classic-ide"}}""",
        "not-json" to "{oops",
        "empty" to "",
        "code-shaped" to """{"${'$'}axf":"appearance@1","slots":{"layout":"classic-ide"},"assets":[{"type":"color-theme","id":"evil","data":{}}],"script":"alert(1)"}""",
        "too-big" to """{"${'$'}axf":"appearance@1","pad":"${"x".repeat(20000)}"}""",
    )
    private val known = setOf("color-theme:arctic-daylight", "style-theme:glass-orbit", "layout:classic-ide", "layout:focus-top", "toolbar:standard-icons", "uac-policy:admin-only")
    private val types = AssetTypeRegistry.builtin()

    private fun docJson(d: AppearanceDocument?): JsonObject? = d?.toJson()
    private fun resolvedJson(r: ai.amberx.axf.kernel.engine.ResolvedAppearance): JsonObject = kotlinx.serialization.json.buildJsonObject {
        put("slots", JsonObject(r.slots.mapValues { JsonPrimitive(it.value) }))
        put("spacing", r.spacing?.let { JsonPrimitive(it.id) } ?: JsonNull)
        put("hidden", JsonObject(r.hidden.mapValues { JsonPrimitive(it.value) }))
        put("skipped", JsonArray(r.skipped.map { JsonPrimitive(it) }))
    }

    @Test fun `parse and resolve match the reference engine`() {
        val f = fixture("appearance.json")
        // Android registers extra platform types after the shared ones; the shared slot types come first, in the same order.
        val shared = (f.getValue("slotTypes") as JsonArray).map { it.jsonPrimitive.content }
        assertEquals(shared, AppearanceEngine.slotTypes(types).take(shared.size), "shared slot types first")
        assertFalse("uac-policy" in AppearanceEngine.slotTypes(types))
        for ((k, text) in docs) {
            val expected = f.getValue("parsed").jsonObject.getValue(k)
            val parsed = AppearanceEngine.parse(text)
            if (expected is JsonNull) assertNull(parsed, "parse $k") else assertEquals(expected.jsonObject, docJson(parsed), "parse $k")
            assertEquals(f.getValue("resolved").jsonObject.getValue(k).jsonObject, resolvedJson(AppearanceEngine.resolve(parsed, types) { t, id -> "$t:$id" in known }), "resolve $k")
        }
    }

    @Test fun `merge, serialize, palette and retry match`() {
        val f = fixture("appearance.json")
        val base = AppearanceEngine.parse(docs.getValue("full"))
        val m = f.getValue("merged").jsonObject
        assertEquals(m.getValue("slot-over-full").jsonObject, AppearanceEngine.merge(base, AppearanceChange(slots = mapOf("color-theme" to "neon-tide")), "build-pilot", "2026-10-21T01:00:00Z").toJson())
        assertEquals(m.getValue("hidden-clear").jsonObject, AppearanceEngine.merge(base, AppearanceChange(hidden = mapOf("toolbar" to null, "app-menu" to true)), "axf-console", "2026-10-21T01:00:00Z").toJson())
        assertEquals(m.getValue("spacing-only-into-null").jsonObject, AppearanceEngine.merge(null, AppearanceChange(spacing = Spacing.REGULAR), "axhub-android", "2026-10-21T01:00:00Z").toJson())
        val other = AppearanceEngine.parse("""{"${'$'}axf":"appearance@1","slots":{"pilot-only-type":"thing","layout":"focus-top"}}""")
        assertEquals(m.getValue("keeps-other-apps-slots").jsonObject, AppearanceEngine.merge(other, AppearanceChange(slots = mapOf("layout" to "classic-ide")), "axf-console", "2026-10-21T01:00:00Z").toJson())
        // serialized text parses to the same document (key order is the engine's; whitespace differs from TS's pretty print)
        assertEquals(f.getValue("serialized").jsonPrimitive.content.parseJsonObject(), AppearanceEngine.merge(base, AppearanceChange(slots = mapOf("color-theme" to "neon-tide")), "build-pilot", "2026-10-21T01:00:00Z").serialize().parseJsonObject())
        for (file in File(assetsDir, "color-theme").listFiles()!!) {
            val a = file.readText().parseJsonObject()!!
            val expected = f.getValue("palette").jsonObject.getValue(a.getValue("id").jsonPrimitive.content).jsonObject.mapValues { it.value.jsonPrimitive.content }
            assertEquals(expected, AppearanceEngine.paletteFromColorTheme(a.getValue("data").jsonObject), "palette ${a["id"]}")
        }
        for ((n, ms) in f.getValue("retryMs").jsonObject) assertEquals(ms.jsonPrimitive.content.toLong(), AppearanceEngine.retryMs(n.toInt()), "retry $n")
    }

    private class FakeSource : AppearanceSource {
        var st: AppearanceSourceState = AppearanceSourceState.Connecting
        val listeners = LinkedHashSet<(AppearanceEvent) -> Unit>()
        val saved = ArrayList<AppearanceChange>()
        var started = 0; var stopped = 0; var refreshed = 0
        override fun state() = st
        override fun subscribe(listener: (AppearanceEvent) -> Unit): () -> Unit { listeners += listener; return { listeners -= listener } }
        override fun start() { started++ }
        override fun stop() { stopped++ }
        override fun refresh() { refreshed++ }
        override fun save(change: AppearanceChange) { saved += change }
        fun push(doc: AppearanceDocument?) { listeners.toList().forEach { it(AppearanceEvent.Document(doc, "v")) } }
        fun setState(s: AppearanceSourceState) { st = s; listeners.toList().forEach { it(AppearanceEvent.State(s)) } }
    }

    private fun runtime(): AxfRuntime {
        val registry = AssetRegistry(types)
        for (dir in assetsDir.listFiles()!!.filter { it.isDirectory }) for (file in dir.listFiles()!!) registry.register(file.readText().parseJsonObject()!!)
        val defaults = File("../../defaults.json").readText().parseJsonObject()!!.mapValues { it.value.jsonPrimitive.content }
        val manifest = AxfManifest.fromJson(kotlinx.serialization.json.buildJsonObject {
            put("\$axf", JsonPrimitive("manifest@1"))
            put("app", kotlinx.serialization.json.buildJsonObject { put("id", JsonPrimitive("check-appearance")); put("name", JsonPrimitive("x")); put("version", JsonPrimitive("0")) })
            put("framework", kotlinx.serialization.json.buildJsonObject { put("version", JsonPrimitive("0.2.0")); put("template", JsonPrimitive("android-compose")) })
            put("targets", JsonArray(listOf(JsonPrimitive("android"))))
            put("defaults", JsonObject(defaults.mapValues { JsonPrimitive(it.value) }))
            put("hidden", JsonArray(listOf(JsonPrimitive("toolbar"))))
        })
        return AxfRuntime(manifest, registry).also { it.setRole("admin") }
    }

    @Test fun `runtime applies the hub document and pushes local changes`() {
        val rt = runtime()
        val defaults = rt.manifest.defaults
        assertTrue(rt.appearanceReady()); assertFalse(rt.hasAppearanceSource())
        val src = FakeSource()
        rt.attachAppearanceSource(src)
        assertEquals(1, src.started); assertFalse(rt.appearanceReady())
        src.setState(AppearanceSourceState.Unreachable("down", 2000, 1))
        assertFalse(rt.appearanceReady(), "hub down: not ready (no fallback)")
        assertEquals(defaults["color-theme"], rt.current.active["color-theme"])
        src.setState(AppearanceSourceState.Ready("v"))
        src.push(AppearanceEngine.parse("""{"${'$'}axf":"appearance@1","slots":{"color-theme":"neon-tide","layout":"no-such-layout","nav-menu":"pill-tabs"},"spacing":"regular","hidden":{"toolbar":false,"nav-menu":true}}"""))
        assertTrue(rt.appearanceReady())
        assertEquals("neon-tide", rt.current.active["color-theme"])
        assertEquals(defaults["layout"], rt.current.active["layout"], "unknown id → the default")
        assertTrue(rt.appearanceSkipped().any { it.startsWith("layout:no-such-layout") })
        assertEquals(Spacing.REGULAR, rt.spacing())
        assertFalse(rt.slotHidden("toolbar")); assertTrue(rt.slotHidden("nav-menu"))
        assertTrue(src.saved.isEmpty(), "pushed document isn't echoed")
        rt.swap("style-theme", "soft-studio")
        assertEquals(AppearanceChange(slots = mapOf("style-theme" to "soft-studio")), src.saved.last())
        rt.swap("color-theme", "arctic-daylight")
        assertEquals("#f2f5f8", src.saved.last().palette?.get("bg"))
        rt.setSpacing(Spacing.COMPACT)
        assertEquals(AppearanceChange(spacing = Spacing.COMPACT), src.saved.last())
        rt.setSlotHidden("toolbar", true)
        assertEquals(AppearanceChange(hidden = mapOf("toolbar" to null)), src.saved.last(), "back at the app default = cleared")
        rt.swap("uac-policy", "admin-only")
        assertTrue(src.saved.none { "uac-policy" in it.slots })
        rt.refreshFromSaved()
        assertEquals(1, src.refreshed)
        // a viewer can't change the shared look
        rt.swap("uac-policy", "strict-enterprise"); rt.setRole("viewer")
        val n = src.saved.size
        rt.swap("color-theme", "neon-tide"); rt.setSlotHidden("nav-menu", false)
        assertEquals(n, src.saved.size, "denied changes push nothing")
        src.push(AppearanceEngine.parse("""{"${'$'}axf":"appearance@1","slots":{"color-theme":"amber-ember"}}"""))
        assertEquals("amber-ember", rt.current.active["color-theme"], "pushed document applies whatever the role")
        assertEquals(defaults["style-theme"], rt.current.active["style-theme"], "missing key = app default")
        assertEquals(Spacing.TIGHT, rt.spacing())
        rt.detachAppearanceSource()
        assertEquals(1, src.stopped); assertTrue(rt.appearanceReady())
        rt.setRole("owner")
        val src2 = FakeSource(); rt.attachAppearanceSource(src2); src2.setState(AppearanceSourceState.Ready(null)); src2.push(null)
        rt.reset()
        assertEquals(defaults["color-theme"], src2.saved.last().slots["color-theme"])
        assertTrue(src2.saved.last().hidden.containsKey("toolbar") && src2.saved.last().hidden["toolbar"] == null)
        assertEquals(Spacing.TIGHT, rt.currentAppearance().spacing)
    }
}
