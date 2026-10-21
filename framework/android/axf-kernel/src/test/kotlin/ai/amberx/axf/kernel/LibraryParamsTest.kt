package ai.amberx.axf.kernel

import ai.amberx.axf.kernel.asset.parseJsonObject
import ai.amberx.axf.kernel.library.LibraryParam
import ai.amberx.axf.kernel.library.LibraryParams
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.jsonObject
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals

/**
 * Port conformance for library@1 parameters: the Kotlin rules give the same text / typed value / error as the
 * reference (core/library.ts) for every fixture case. Written without a compiler; CI runs it.
 */
class LibraryParamsTest {
    private val fixture: JsonObject = File("../../spec/fixtures/library-params.json").readText().parseJsonObject()!!
    private fun strings(a: JsonArray): List<String> = a.map { (it as JsonPrimitive).content }

    @Test fun `library parameters match the reference engine`() {
        assertEquals(strings(fixture.getValue("types") as JsonArray), LibraryParams.TYPES, "types")
        assertEquals(strings(fixture.getValue("trueWords") as JsonArray).toSet(), LibraryParams.TRUE_WORDS, "true words")
        val params = (fixture.getValue("params") as JsonArray).map { LibraryParam.fromJson(it.jsonObject) }
        val byKey = params.associateBy { it.key }
        val defaults = fixture.getValue("defaults").jsonObject.mapValues { (_, v) -> (v as JsonPrimitive).content }
        assertEquals(defaults, LibraryParams.defaults(params), "defaults")
        for (c in (fixture.getValue("cases") as JsonArray).map { it.jsonObject }) {
            val key = (c.getValue("key") as JsonPrimitive).content
            val text = (c.getValue("text") as JsonPrimitive).content
            val p = byKey.getValue(key)
            assertEquals((c.getValue("defaultText") as JsonPrimitive).content, p.defaultText, "$key default text")
            val bool = c["bool"]
            if (bool != null && bool !is JsonNull) assertEquals((bool as JsonPrimitive).booleanOrNull, p.isTrue(text), "$key bool '$text'")
            val wantJson = c.getValue("json")
            val gotJson = p.toJson(text)
            if (wantJson is JsonNull) assertEquals(null, gotJson, "$key json '$text' is null") else assertEquals(wantJson.toString(), gotJson.toString(), "$key json '$text'")
            val wantErr = c.getValue("error")
            assertEquals(if (wantErr is JsonNull) null else (wantErr as JsonPrimitive).content, p.validate(text), "$key error '$text'")
        }
    }
}
