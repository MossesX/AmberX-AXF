package ai.amberx.axf.kernel

import ai.amberx.axf.kernel.asset.AssetRegistry
import ai.amberx.axf.kernel.asset.AssetTypeRegistry
import ai.amberx.axf.kernel.asset.parseJsonObject
import ai.amberx.axf.kernel.engine.Embed
import ai.amberx.axf.kernel.engine.EmbedEngine
import ai.amberx.axf.kernel.manifest.AxfManifest
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
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * embed@1 conformance (spec/fixtures/embed.json, from core/engines/embed.ts) + the runtime's forced layer: an embedded
 * app hides the host's chrome over the user's choice, the choice survives, a standalone runtime is untouched.
 */
class EmbedConformanceTest {
    private val fixtures = File("../../spec/fixtures")
    private val assetsDir = File("../../assets")
    private val types = AssetTypeRegistry.builtin()
    private fun fixture(name: String): JsonObject = File(fixtures, name).readText().parseJsonObject()!!
    private fun strings(e: kotlinx.serialization.json.JsonElement?): List<String>? = (e as? JsonArray)?.map { it.jsonPrimitive.content }
    private fun embed(e: kotlinx.serialization.json.JsonElement?): Embed? = (e as? JsonObject)?.let { Embed(it.getValue("host").jsonPrimitive.content, strings(it.getValue("hidden"))!!) }
    private fun str(e: kotlinx.serialization.json.JsonElement?): String? = (e as? JsonPrimitive)?.takeIf { it.isString }?.content

    @Test fun `embed engine matches the reference engine`() {
        val f = fixture("embed.json")
        assertEquals(f.getValue("token").jsonPrimitive.content, EmbedEngine.UA_TOKEN)
        assertEquals(strings(f.getValue("defaultHidden")), EmbedEngine.DEFAULT_HIDDEN)
        for (c in f.getValue("hosts") as JsonArray) {
            val input = c.jsonObject.getValue("input")
            // A number or null input is no host; the web test feeds those through the same function.
            val raw = if (input is JsonPrimitive && input.isString) input.content else null
            assertEquals(str(c.jsonObject.getValue("host")), EmbedEngine.host(raw), "host $input")
        }
        for (c in f.getValue("hidden") as JsonArray) {
            val input = c.jsonObject.getValue("input")
            val got = when (input) { is JsonArray -> EmbedEngine.hidden(types, strings(input)); is JsonNull -> EmbedEngine.hidden(types, null as String?); else -> EmbedEngine.hidden(types, input.jsonPrimitive.content) }
            assertEquals(strings(c.jsonObject.getValue("hidden")), got, "hidden $input")
        }
        for (c in f.getValue("queries") as JsonArray) assertEquals(embed(c.jsonObject["embed"]), EmbedEngine.fromQuery(types, c.jsonObject.getValue("input").jsonPrimitive.content), "query ${c.jsonObject["input"]}")
        for (c in f.getValue("userAgents") as JsonArray) assertEquals(embed(c.jsonObject["embed"]), EmbedEngine.fromUserAgent(types, c.jsonObject.getValue("input").jsonPrimitive.content), "ua ${c.jsonObject["input"]}")
        for (c in f.getValue("detect") as JsonArray) assertEquals(embed(c.jsonObject["embed"]), EmbedEngine.detect(types, str(c.jsonObject["search"]), str(c.jsonObject["userAgent"])), "detect ${c.jsonObject["search"]}")
        for (c in f.getValue("suffix") as JsonArray) {
            val hidden = strings(c.jsonObject["hidden"])
            val got = if (hidden == null) EmbedEngine.userAgentSuffix(types, c.jsonObject.getValue("host").jsonPrimitive.content) else EmbedEngine.userAgentSuffix(types, c.jsonObject.getValue("host").jsonPrimitive.content, hidden)
            assertEquals(c.jsonObject.getValue("suffix").jsonPrimitive.content, got, "suffix ${c.jsonObject}")
        }
        for (c in f.getValue("urls") as JsonArray) {
            val hidden = strings(c.jsonObject["hidden"])
            val url = c.jsonObject.getValue("url").jsonPrimitive.content
            val host = c.jsonObject.getValue("host").jsonPrimitive.content
            val got = if (hidden == null) EmbedEngine.embedUrl(types, url, host) else EmbedEngine.embedUrl(types, url, host, hidden)
            assertEquals(c.jsonObject.getValue("out").jsonPrimitive.content, got, "url $url")
        }
        assertFailsWith<IllegalArgumentException> { EmbedEngine.userAgentSuffix(types, "bad id") }
        assertFailsWith<IllegalArgumentException> { EmbedEngine.embedUrl(types, "https://x/", "") }
    }

    private fun runtime(embed: Embed?): AxfRuntime {
        val registry = AssetRegistry(types)
        for (dir in assetsDir.listFiles()!!.filter { it.isDirectory }) for (file in dir.listFiles()!!) registry.register(file.readText().parseJsonObject()!!)
        val defaults = File("../../defaults.json").readText().parseJsonObject()!!.mapValues { it.value.jsonPrimitive.content }
        val manifest = AxfManifest.fromJson(kotlinx.serialization.json.buildJsonObject {
            put("\$axf", JsonPrimitive("manifest@1"))
            put("app", kotlinx.serialization.json.buildJsonObject { put("id", JsonPrimitive("check-embed")); put("name", JsonPrimitive("x")); put("version", JsonPrimitive("0")) })
            put("framework", kotlinx.serialization.json.buildJsonObject { put("version", JsonPrimitive("0.2.0")); put("template", JsonPrimitive("android-compose")) })
            put("targets", JsonArray(listOf(JsonPrimitive("android"))))
            put("defaults", JsonObject(defaults.mapValues { JsonPrimitive(it.value) }))
        })
        return AxfRuntime(manifest, registry, embedded = embed).also { it.setRole("admin") }
    }

    @Test fun `an embedded runtime hides the host's chrome over the user's choice`() {
        val solo = runtime(null)
        assertNull(solo.embedded)
        assertFalse(solo.slotHidden("banner"))
        assertFalse(solo.slotHiddenByHost("banner"))

        val inside = runtime(Embed("patches", listOf("banner")))
        assertTrue(inside.slotHidden("banner"))
        assertTrue(inside.slotHiddenByHost("banner"))
        assertEquals(solo.slotHidden("toolbar"), inside.slotHidden("toolbar"), "other chrome untouched")
        inside.setSlotHidden("banner", false)
        assertTrue(inside.slotHidden("banner"), "show refused while embedded")
        assertTrue(inside.hiddenSlots().contains("banner"))

        val both = runtime(Embed("patches", listOf("banner", "toolbar")))
        assertTrue(both.hiddenSlots().containsAll(listOf("banner", "toolbar")))
    }
}
