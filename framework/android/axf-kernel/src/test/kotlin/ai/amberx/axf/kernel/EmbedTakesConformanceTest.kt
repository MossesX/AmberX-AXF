package ai.amberx.axf.kernel

import ai.amberx.axf.kernel.asset.AssetTypeRegistry
import ai.amberx.axf.kernel.asset.parseJsonObject
import ai.amberx.axf.kernel.engine.Embed
import ai.amberx.axf.kernel.engine.EmbedMessage
import ai.amberx.axf.kernel.engine.EmbedTakes
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals

/** embed@1 takes / page mode / messages (spec/fixtures/embed-takes.json, from core/engines/embed.ts). */
class EmbedTakesConformanceTest {
    private val types = AssetTypeRegistry.builtin()
    private val f: JsonObject = File("../../spec/fixtures/embed-takes.json").readText().parseJsonObject()!!
    private fun strings(e: JsonElement?): List<String>? = (e as? JsonArray)?.map { it.jsonPrimitive.content }
    private fun str(e: JsonElement?): String? = (e as? JsonPrimitive)?.takeIf { it.isString }?.content
    private fun embed(e: JsonElement?): Embed? = (e as? JsonObject)?.let {
        Embed(it.getValue("host").jsonPrimitive.content, strings(it.getValue("hidden"))!!, strings(it["takes"]) ?: emptyList(), str(it["page"]))
    }
    private fun cases(key: String) = f.getValue(key).jsonArray.map { it.jsonObject }

    /** The fixture's message object as the Kotlin message type (null when the reference refused it). */
    private fun message(e: JsonElement?): EmbedMessage? {
        val o = e as? JsonObject ?: return null
        return when (str(o["type"])) {
            "open-settings" -> EmbedMessage.OpenSettings(str(o["tab"]))
            "notify" -> EmbedMessage.Notify(str(o["title"])!!, str(o["body"]), str(o["tag"]), str(o["level"]), str(o["link"]))
            "ready" -> EmbedMessage.Ready(str(o["app"]))
            "open-tab" -> EmbedMessage.OpenTab(str(o["tab"])!!)
            else -> error("unknown type in fixture")
        }
    }

    @Test fun `takes, pages and markers match the reference engine`() {
        assertEquals(str(f["uaToken"]), EmbedTakes.UA_TOKEN)
        assertEquals(strings(f["ids"]), EmbedTakes.ids())
        for (c in cases("takes")) {
            val input = c.getValue("input")
            val got = when (input) { is JsonArray -> EmbedTakes.takes(strings(input)); is JsonNull -> EmbedTakes.takes(null as String?); else -> EmbedTakes.takes(input.jsonPrimitive.content) }
            assertEquals(strings(c["takes"]), got, "takes $input")
        }
        for (c in cases("pages")) assertEquals(str(c["page"]), EmbedTakes.page(str(c["input"])), "page ${c["input"]}")
        for (c in cases("queries")) assertEquals(embed(c["embed"]), EmbedTakes.fromQuery(types, str(c["input"])), "query ${c["input"]}")
        for (c in cases("userAgents")) assertEquals(embed(c["embed"]), EmbedTakes.fromUserAgent(types, str(c["input"])), "ua ${c["input"]}")
        for (c in cases("detect")) assertEquals(embed(c["embed"]), EmbedTakes.detect(types, str(c["search"]), str(c["userAgent"])), "detect ${c["search"]}")
        for (c in cases("takenBy")) assertEquals(str(c["fn"]), EmbedTakes.takenBy(embed(c["embed"]), str(c["action"])), "takenBy ${c["action"]}")
        for (c in cases("takenView")) assertEquals(str(c["fn"]), EmbedTakes.takenView(embed(c["embed"]), str(c["view"])), "takenView ${c["view"]}")
        for (c in cases("takenProvider")) assertEquals(str(c["fn"]), EmbedTakes.takenProvider(embed(c["embed"]), str(c["provider"])), "takenProvider ${c["provider"]}")
        for (c in cases("suffix")) {
            val hidden = strings(c["hidden"])
            val host = c.getValue("host").jsonPrimitive.content
            val got = if (hidden == null) EmbedTakes.userAgentSuffix(types, host, take = strings(c["takes"])!!) else EmbedTakes.userAgentSuffix(types, host, hidden, strings(c["takes"])!!)
            assertEquals(str(c["suffix"]), got, "suffix $c")
        }
        for (c in cases("urls")) {
            val o = c.getValue("opts").jsonObject
            val got = EmbedTakes.embedUrl(types, str(c["url"])!!, str(c["host"])!!, take = strings(o["takes"]) ?: emptyList(), page = str(o["page"]))
            assertEquals(str(c["out"]), got, "url ${c["url"]}")
        }
        for (c in cases("links")) assertEquals(c.getValue("ok").jsonPrimitive.content.toBoolean(), EmbedTakes.linkOk(str(c["link"])), "link ${c["link"]}")
        for (c in cases("settingsTab")) assertEquals(str(c["tab"]), EmbedTakes.settingsTabOf(str(c["action"])!!), "settingsTab ${c["action"]}")
    }

    @Test fun `messages are checked and cut like the reference`() {
        for (c in cases("messages")) {
            val input = c.getValue("input")
            val got = when (input) {
                is JsonObject -> EmbedTakes.parseMessage(input)
                is JsonPrimitive -> if (input.isString) EmbedTakes.parseMessage(input.content) else null
                else -> null // arrays and null are no message on either port
            }
            assertEquals(message(c["message"]), got, "message $input")
        }
        assertEquals("""{"${'$'}axf":"embed@1","type":"open-tab","tab":"plugins"}""", EmbedTakes.openTab("plugins"))
        assertEquals(null, EmbedTakes.openTab("bad tab"))
    }
}
