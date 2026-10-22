package ai.amberx.axf.kernel

import ai.amberx.axf.kernel.asset.objList
import ai.amberx.axf.kernel.asset.parseJsonObject
import ai.amberx.axf.kernel.asset.str
import ai.amberx.axf.kernel.catalog.Boilerplate
import ai.amberx.axf.kernel.catalog.BoilerplateIndex
import ai.amberx.axf.kernel.catalog.Catalog
import ai.amberx.axf.kernel.catalog.FeatureStatus
import ai.amberx.axf.kernel.catalog.LibrariesIndex
import ai.amberx.axf.kernel.catalog.LibraryCards
import ai.amberx.axf.kernel.catalog.LibraryDescriptor
import ai.amberx.axf.kernel.catalog.LibraryParam
import ai.amberx.axf.kernel.catalog.StatusMap
import ai.amberx.axf.kernel.catalog.Tracker
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals

/** Replays spec/fixtures/catalog.json (generated from core/catalog.ts) against ai.amberx.axf.kernel.catalog. */
class CatalogConformanceTest {
    private val f: JsonObject = File("../../spec/fixtures/catalog.json").readText().parseJsonObject()!!
    private val inputs: JsonObject = f.getValue("inputs").jsonObject
    private val lenientIn: JsonObject = inputs.getValue("lenient").jsonObject
    private val lenientOut: JsonObject = f.getValue("lenient").jsonObject
    private val empty = JsonObject(emptyMap())

    private val catalog = Catalog.fromJson(inputs.getValue("catalog").jsonObject)
    private val libraries = LibrariesIndex.fromJson(inputs.getValue("libraries").jsonObject)
    private val tracker = Tracker.fromJson(inputs.getValue("tracker").jsonObject)

    @Test fun `catalog parses like the reference`() {
        assertEquals(f.getValue("catalog"), catalog.toJson())
        assertEquals(lenientOut.getValue("catalog"), Catalog.fromJson(lenientIn.getValue("catalog").jsonObject).toJson())
    }

    @Test fun `status map parses like the reference`() {
        assertEquals(f.getValue("status"), StatusMap.toJson(StatusMap.fromJson(inputs.getValue("status").jsonObject)))
        assertEquals(FeatureStatus.PLANNED, FeatureStatus.parse("done"))
        assertEquals(FeatureStatus.BUILT, FeatureStatus.parse("BUILT"))
    }

    @Test fun `tracker parses like the reference`() {
        assertEquals(f.getValue("tracker"), tracker.toJson())
    }

    @Test fun `libraries and library descriptors parse like the reference`() {
        assertEquals(f.getValue("libraries"), libraries.toJson())
        assertEquals(lenientOut.getValue("library"), LibraryDescriptor.fromJson(lenientIn.getValue("library").jsonObject).toJson())
    }

    @Test fun `boilerplates and the index parse like the reference`() {
        val exp = f.getValue("boilerplates").jsonArray
        val got = inputs.getValue("boilerplates").jsonArray.map { Boilerplate.fromJson(it.jsonObject).toJson() }
        assertEquals(exp.size, got.size)
        for ((e, g) in exp.zip(got)) assertEquals(e, g, (e as JsonObject).str("id"))
        assertEquals(f.getValue("boilerplateIndex"), BoilerplateIndex.fromJson(inputs.getValue("boilerplateIndex").jsonObject).toJson())
    }

    @Test fun `empty and wrong inputs give the same defaults`() {
        val e = lenientOut.getValue("empty").jsonObject
        assertEquals(e.getValue("catalog"), Catalog.fromJson(empty).toJson())
        assertEquals(e.getValue("tracker"), Tracker.fromJson(empty).toJson())
        assertEquals(e.getValue("libraries"), LibrariesIndex.fromJson(empty).toJson())
        assertEquals(e.getValue("boilerplate"), Boilerplate.fromJson(empty).toJson())
    }

    @Test fun `install parameters - default text, answers and errors match`() {
        for (case in f.objList("params")) {
            val p = LibraryParam.fromJson(case.getValue("param").jsonObject)
            assertEquals(case.getValue("param"), p.toJson(), p.key)
            assertEquals(case.str("defaultText"), p.defaultText, "${p.key} default text")
            for (a in case.objList("answers")) {
                val text = a.str("text")
                assertEquals(a.getValue("json"), p.toJson(text) ?: JsonNull, "${p.key} <- \"$text\"")
                val err = a["error"]
                assertEquals(if (err is JsonPrimitive && err !is JsonNull) err.content else null, p.validate(text), "${p.key} error for \"$text\"")
            }
        }
    }

    @Test fun `library cards come from the catalog, library json and tracker`() {
        assertEquals(f.getValue("libraryCards"), JsonArray(LibraryCards.of(catalog, libraries.items, tracker).map { it.toJson() }))
        assertEquals(f.getValue("libraryCardsNoTracker"), JsonArray(LibraryCards.of(catalog, libraries.items, null).map { it.toJson() }))
    }
}
