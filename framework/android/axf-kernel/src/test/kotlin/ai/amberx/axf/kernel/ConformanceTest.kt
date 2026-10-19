package ai.amberx.axf.kernel

import ai.amberx.axf.kernel.asset.AppMenu
import ai.amberx.axf.kernel.asset.ColorTheme
import ai.amberx.axf.kernel.asset.NavMenu
import ai.amberx.axf.kernel.asset.Toolbar
import ai.amberx.axf.kernel.asset.Layout
import ai.amberx.axf.kernel.asset.StyleTheme
import ai.amberx.axf.kernel.asset.UacPolicy
import ai.amberx.axf.kernel.asset.parseJsonObject
import ai.amberx.axf.kernel.engine.ComponentStyleEngine
import ai.amberx.axf.kernel.engine.LayoutEngine
import ai.amberx.axf.kernel.engine.Region
import ai.amberx.axf.kernel.engine.ThemeEngine
import ai.amberx.axf.kernel.engine.UacEngine
import ai.amberx.axf.kernel.engine.RollEngine
import ai.amberx.axf.kernel.engine.RollRules
import ai.amberx.axf.kernel.engine.SearchEngine
import ai.amberx.axf.kernel.asset.AssetEnvelope
import ai.amberx.axf.kernel.asset.AssetTypeRegistry
import ai.amberx.axf.kernel.engine.WindowClass
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals

/**
 * Port conformance: the Kotlin engines must reproduce the reference (TypeScript) engines' output for every
 * shared asset. Fixtures come from `npx tsx framework/spec/gen-fixtures.mts`; every port runs the same check.
 */
class ConformanceTest {
    private val fixtures = File("../../spec/fixtures")
    private val assets = File("../../assets")
    private fun fixture(name: String): JsonObject = File(fixtures, name).readText().parseJsonObject()!!
    private fun asset(type: String, id: String): JsonObject = File(assets, "$type/$id.json").readText().parseJsonObject()!!.getValue("data").jsonObject

    @Test fun `theme variables match the reference engine`() {
        val expected = fixture("theme.json")
        for ((key, vars) in expected) {
            val (type, id) = key.split(':')
            val data = asset(type, id)
            val actual = if (type == "color-theme") {
                ThemeEngine.compile(ColorTheme.fromJson(data), StyleTheme.fromJson(asset("style-theme", "soft-studio"))).cssVars
            } else ThemeEngine.compile(ColorTheme.fromJson(asset("color-theme", "amber-ember")), StyleTheme.fromJson(data)).cssVars
            for ((k, v) in vars.jsonObject) assertEquals(v.jsonPrimitive.content, actual[k], "$key $k")
        }
    }

    @Test fun `layout grid matches the reference engine`() {
        for ((id, f) in fixture("layout.json")) {
            val c = f.jsonObject.getValue("compiled").jsonObject
            val layout = Layout.fromJson(asset("layout", id))
            val desktop = LayoutEngine.compile(layout, WindowClass.EXPANDED)
            assertEquals(c.getValue("areas").jsonPrimitive.content, desktop.cssAreas, "$id areas")
            assertEquals(c.getValue("columns").jsonPrimitive.content, desktop.cssColumns, "$id columns")
            assertEquals(c.getValue("rows").jsonPrimitive.content, desktop.cssRows, "$id rows")
            assertEquals((c.getValue("regions") as JsonArray).map { it.jsonPrimitive.content }, desktop.regions.map { it.name.lowercase() }, "$id regions")
            val mobile = LayoutEngine.compile(layout, WindowClass.COMPACT)
            assertEquals(c.getValue("mobileAreas").jsonPrimitive.content, mobile.cssAreas, "$id mobile areas")
        }
    }

    @Test fun `layout slot contract matches the reference engine`() {
        // Defaults for the shipped layouts.
        for ((id, f) in fixture("layout.json")) {
            val expected = f.jsonObject.getValue("compiled").jsonObject.getValue("slots").jsonObject
            val desktop = LayoutEngine.compile(Layout.fromJson(asset("layout", id)), WindowClass.EXPANDED)
            for ((region, types) in expected) assertEquals((types as JsonArray).map { it.jsonPrimitive.content }, desktop.slots[Region.parse(region)], "$id slot $region")
        }
        // Overrides: a region that refuses its chrome drops out of the grid.
        val base = asset("layout", "studio-dock")
        for ((case, f) in fixture("layout-slots.json")) {
            val slots = f.jsonObject.getValue("slots").jsonObject
            val c = f.jsonObject.getValue("compiled").jsonObject
            // `hidden-*` cases: slot types the user hid (HideEngine) drop out like a refusing slot.
            val hidden = (f.jsonObject["hidden"] as? JsonArray)?.map { it.jsonPrimitive.content } ?: emptyList()
            val desktop = LayoutEngine.compile(Layout.fromJson(JsonObject(base + ("slots" to slots))), WindowClass.EXPANDED, hidden)
            assertEquals(c.getValue("areas").jsonPrimitive.content, desktop.cssAreas, "$case areas")
            assertEquals(c.getValue("columns").jsonPrimitive.content, desktop.cssColumns, "$case columns")
            assertEquals(c.getValue("rows").jsonPrimitive.content, desktop.cssRows, "$case rows")
            assertEquals((c.getValue("regions") as JsonArray).map { it.jsonPrimitive.content }, desktop.regions.map { it.id }, "$case regions")
            for ((region, types) in c.getValue("slots").jsonObject) assertEquals((types as JsonArray).map { it.jsonPrimitive.content }, desktop.slots[Region.parse(region)], "$case slot $region")
        }
    }

    @Test fun `hidden slots match the reference engine`() {
        val f = fixture("hide.json")
        val types = ai.amberx.axf.kernel.asset.AssetTypeRegistry.builtin()
        assertEquals((f.getValue("hideable") as JsonArray).map { it.jsonPrimitive.content }, ai.amberx.axf.kernel.engine.HideEngine.hideableTypes(types), "hideable types")
        for (c in f.getValue("cases") as JsonArray) {
            val o = c.jsonObject.getValue("overrides").jsonObject.mapValues { it.value.jsonPrimitive.content.toBoolean() }
            assertEquals((c.jsonObject.getValue("hidden") as JsonArray).map { it.jsonPrimitive.content }, ai.amberx.axf.kernel.engine.HideEngine.hiddenSlots(types, o), "hidden for $o")
        }
    }

    @Test fun `banner engine matches the reference engine`() {
        val f = fixture("banner.json")
        val E = ai.amberx.axf.kernel.engine.BannerEngine
        assertEquals((f.getValue("attachable") as JsonArray).map { it.jsonPrimitive.content }, E.ATTACHABLE, "attachable types")
        assertEquals((f.getValue("sides") as JsonArray).map { it.jsonPrimitive.content }, E.SIDES, "sides")
        val thin = ai.amberx.axf.kernel.engine.BannerData.fromJson(asset("banner", "amberx-thin"))
        for ((id, vars) in f.getValue("vars").jsonObject) {
            val v = when (id) {
                "hidden" -> E.vars(thin, true); "none" -> E.vars(null)
                "too-tall", "too-short", "not-a-number" -> E.vars(thin.copy(height = when (id) { "too-tall" -> 400.0; "too-short" -> 2.0; else -> null }))
                else -> E.vars(ai.amberx.axf.kernel.engine.BannerData.fromJson(asset("banner", id)))
            }
            assertEquals(vars.jsonObject.getValue("--fx-banner-h").jsonPrimitive.content, v["--fx-banner-h"], "banner vars $id")
        }
        val exists = (f.getValue("exists") as JsonArray).map { it.jsonPrimitive.content }.toSet()
        for ((name, c) in f.getValue("place").jsonObject) {
            val o = c.jsonObject
            val b = (o["banner"] as? JsonObject)?.let { ai.amberx.axf.kernel.engine.BannerData.fromJson(it) }
            val extra = (o.getValue("extra") as JsonArray).map { e -> val x = e.jsonObject; ai.amberx.axf.kernel.engine.BannerAttachment(x.getValue("type").jsonPrimitive.content, x.getValue("id").jsonPrimitive.content, x.getValue("at").jsonPrimitive.content, x["order"]?.jsonPrimitive?.content?.toDoubleOrNull(), x["origin"]?.jsonPrimitive?.content) }
            val placed = E.place(b, extra) { t, id -> "$t:$id" in exists }
            for ((side, list) in o.getValue("placed").jsonObject) {
                val want = (list as JsonArray).map { val p = it.jsonObject; listOf("key", "at", "origin").joinToString("|") { k -> p.getValue(k).jsonPrimitive.content } + "|" + p.getValue("order").jsonPrimitive.content.toDouble() }
                val got = placed.getValue(side).map { "${it.key}|${it.at}|${it.origin}|${it.order}" }
                assertEquals(want, got, "place $name $side")
            }
        }
        for (c in f.getValue("clock") as JsonArray) {
            val o = c.jsonObject
            val clock = ai.amberx.axf.kernel.engine.ClockData.fromJson(o.getValue("clock").jsonObject)
            val p = o.getValue("parts").jsonObject
            fun i(k: String) = p.getValue(k).jsonPrimitive.content.toInt()
            assertEquals(o.getValue("text").jsonPrimitive.content, E.formatClock(clock, ai.amberx.axf.kernel.engine.ClockParts(i("year"), i("month"), i("day"), i("weekday"), i("hour"), i("minute"), i("second"))), "clock $o")
        }
        for ((tone, token) in f.getValue("tones").jsonObject) assertEquals(token.jsonPrimitive.content, E.toneToken(tone), "tone $tone")
    }

    @Test fun `widget engine matches the reference engine`() {
        val f = fixture("widgets.json")
        val W = ai.amberx.axf.kernel.engine.WidgetEngine
        assertEquals((f.getValue("widgetTypes") as JsonArray).map { it.jsonPrimitive.content }, W.WIDGET_TYPES, "widget types")
        assertEquals((f.getValue("toolbarSides") as JsonArray).map { it.jsonPrimitive.content }, W.TOOLBAR_SIDES, "toolbar sides")
        for ((w, n) in f.getValue("searchBarWidth").jsonObject) assertEquals(n.jsonPrimitive.content.toInt(), W.SEARCH_BAR_WIDTH[w], "search bar width $w")
        val exists = (f.getValue("exists") as JsonArray).map { it.jsonPrimitive.content }.toSet()
        for ((name, c) in f.getValue("toolbar").jsonObject) {
            val o = c.jsonObject
            val tb = o["toolbar"] as? JsonObject
            val extra = (o.getValue("extra") as JsonArray).map { e -> val x = e.jsonObject; ai.amberx.axf.kernel.engine.BannerAttachment(x.getValue("type").jsonPrimitive.content, x.getValue("id").jsonPrimitive.content, x.getValue("at").jsonPrimitive.content, x["order"]?.jsonPrimitive?.content?.toDoubleOrNull(), x["origin"]?.jsonPrimitive?.content) }
            val placed = W.placeToolbar(tb, extra) { t, id -> "$t:$id" in exists }
            for ((side, list) in o.getValue("placed").jsonObject) {
                val want = (list as JsonArray).map { val p = it.jsonObject; listOf("key", "at", "origin").joinToString("|") { k -> p.getValue(k).jsonPrimitive.content } + "|" + p.getValue("order").jsonPrimitive.content.toDouble() }
                val got = placed.getValue(side).map { "${it.key}|${it.at}|${it.origin}|${it.order}" }
                assertEquals(want, got, "toolbar $name $side")
            }
        }
        val bar = ai.amberx.axf.kernel.engine.SearchBarData.fromJson(asset("search-bar", "everything"))
        assertEquals("regular", bar.width, "search bar width field")
    }

    @Test fun `spacing choice matches the reference engine`() {
        val f = fixture("spacing.json")
        assertEquals(f.getValue("default").jsonPrimitive.content, ai.amberx.axf.kernel.engine.Spacing.DEFAULT.id, "default spacing")
        assertEquals((f.getValue("order") as JsonArray).map { it.jsonPrimitive.content }, ai.amberx.axf.kernel.engine.Spacing.entries.map { it.id }, "order")
        for ((raw, want) in f.getValue("parse").jsonObject) assertEquals(want.jsonPrimitive.content, ai.amberx.axf.kernel.engine.Spacing.of(raw).id, "parse '$raw'")
        for ((id, bySpacing) in f.getValue("vars").jsonObject) for ((sp, vars) in bySpacing.jsonObject) {
            val css = ThemeEngine.compile(ColorTheme.fromJson(asset("color-theme", "amber-ember")), StyleTheme.fromJson(asset("style-theme", id)), ai.amberx.axf.kernel.engine.Spacing.of(sp)).cssVars
            for ((k, v) in vars.jsonObject) assertEquals(v.jsonPrimitive.content, css[k], "$id/$sp $k")
        }
    }

    @Test fun `chrome style attributes match the reference engine`() {
        val f = fixture("components.json")
        val st = ThemeEngine.compile(ColorTheme.fromJson(asset("color-theme", "amber-ember")), StyleTheme.fromJson(asset("style-theme", "soft-studio"))).style
        fun check(kind: String, attrs: (JsonObject) -> Map<String, String>) {
            for ((id, out) in f.getValue(kind).jsonObject) {
                val actual = attrs(asset(kind, id))
                for ((k, v) in out.jsonObject.getValue("attrs").jsonObject) assertEquals(v.jsonPrimitive.content, actual[k], "$kind/$id $k")
            }
        }
        fun attrsOf(t: Toolbar? = null, n: NavMenu? = null, a: AppMenu? = null): Map<String, String> {
            val m = mutableMapOf<String, String>()
            t?.let { val s = ComponentStyleEngine.toolbar(it, st); m["data-fx-toolbar"] = s.variant.name.lowercase().replace('_', '-'); m["data-fx-toolbar-surface"] = s.surface.name.lowercase(); m["data-fx-toolbar-divider"] = if (s.divider) "on" else "off" }
            n?.let { val s = ComponentStyleEngine.navMenu(it); m["data-fx-nav"] = s.style.name.lowercase(); m["data-fx-nav-indicator"] = s.indicator.name.lowercase(); m["data-fx-nav-icons"] = if (s.showIcons) "on" else "off" }
            a?.let { m["data-fx-menubar"] = ComponentStyleEngine.appMenu(it, st).surface.name.lowercase() }
            return m
        }
        check("toolbar") { attrsOf(t = Toolbar.fromJson(it)) }
        check("nav-menu") { attrsOf(n = NavMenu.fromJson(it)) }
        check("app-menu") { attrsOf(a = AppMenu.fromJson(it)) }
    }

    @Test fun `uac resolution matches the reference engine`() {
        for ((id, f) in fixture("uac.json")) {
            val policy = UacPolicy.fromJson(asset("uac-policy", id))
            for ((role, perms) in f.jsonObject.getValue("roles").jsonObject) {
                assertEquals((perms as JsonArray).map { it.jsonPrimitive.content }.sorted(), UacEngine.resolvePermissions(policy, role).sorted(), "$id/$role")
            }
            for (check in f.jsonObject.getValue("checks") as JsonArray) {
                val perm = check.jsonObject.getValue("perm").jsonPrimitive.content
                for ((role, expected) in check.jsonObject.getValue("byRole").jsonObject) {
                    assertEquals((expected as JsonPrimitive).content.toBoolean(), UacEngine.hasPermission(UacEngine.resolvePermissions(policy, role), perm), "$id/$role/$perm")
                }
            }
        }
    }

    @Test fun `randomize roll plan matches the reference engine`() {
        val types = AssetTypeRegistry.builtin()
        val f = fixture("roll.json")
        for ((t, v) in f.getValue("slotDefaults").jsonObject) assertEquals(v.jsonPrimitive.content.toBoolean(), RollEngine.slotDefault(types, t), "slot default $t")
        val core = f.getValue("slotDefaults").jsonObject.keys.toList()
        fun list(t: String) = (File(assets, t).listFiles() ?: emptyArray()).sortedBy { it.name }.map { AssetEnvelope.fromJson(it.readText().parseJsonObject()!!) }
        for ((case, c) in f.getValue("cases").jsonObject) {
            val r = c.jsonObject.getValue("rules").jsonObject
            fun bools(k: String) = (r[k] as? JsonObject)?.mapValues { it.value.jsonPrimitive.content.toBoolean() } ?: emptyMap()
            val plan = RollEngine.plan(types, core, ::list, RollRules(bools("slots"), bools("assets")))
            val expected = c.jsonObject.getValue("plan").jsonObject.mapValues { (_, ids) -> (ids as JsonArray).map { it.jsonPrimitive.content } }
            assertEquals(expected, plan, case)
        }
    }

    @Test fun `search scoring matches the reference engine`() {
        val cases = File(fixtures, "search.json").readText().let { ai.amberx.axf.kernel.asset.AxfJson.parseToJsonElement(it) as JsonArray }
        for (c in cases) {
            val o = c.jsonObject
            val kw = (o["keywords"] as? JsonArray)?.map { it.jsonPrimitive.content } ?: emptyList()
            val got = SearchEngine.score(o.getValue("label").jsonPrimitive.content, (o["detail"] as? JsonPrimitive)?.content, kw, o.getValue("kind").jsonPrimitive.content, o.getValue("query").jsonPrimitive.content)
            assertEquals(o.getValue("score").jsonPrimitive.content.toDouble(), Math.round(got * 1e6) / 1e6, o.getValue("query").jsonPrimitive.content)
        }
    }
}
