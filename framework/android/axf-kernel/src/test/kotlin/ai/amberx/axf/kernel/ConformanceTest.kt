package ai.amberx.axf.kernel

import ai.amberx.axf.kernel.asset.ColorTheme
import ai.amberx.axf.kernel.asset.Layout
import ai.amberx.axf.kernel.asset.StyleTheme
import ai.amberx.axf.kernel.asset.UacPolicy
import ai.amberx.axf.kernel.asset.parseJsonObject
import ai.amberx.axf.kernel.engine.LayoutEngine
import ai.amberx.axf.kernel.engine.ThemeEngine
import ai.amberx.axf.kernel.engine.UacEngine
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
}
