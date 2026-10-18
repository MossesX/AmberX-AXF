package ai.amberx.axf.kernel

import ai.amberx.axf.kernel.asset.parseJsonObject
import ai.amberx.axf.kernel.project.ProjectManifests
import ai.amberx.axf.kernel.project.ProjectRules
import ai.amberx.axf.kernel.project.ProjectValidator
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.jsonObject
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull

/** Port conformance for project manifests: same rule ids, same order, as the reference (core/project.ts). */
class ProjectManifestTest {
    private val fixtures = File("../../spec/fixtures/project-manifest.json").readText().parseJsonObject()!!
    private val rules = ProjectRules.fromJson(File("../../schemas/project-rules.json").readText().parseJsonObject()!!)
    private fun ids(a: JsonObject, k: String) = (a[k] as JsonArray).map { (it as JsonPrimitive).content }

    @Test fun `project manifests validate like the reference`() {
        for ((name, f) in fixtures) {
            val c = f.jsonObject
            val existing = (c["existing"] as? JsonArray)?.map { (it as JsonPrimitive).content }
            val v = ProjectValidator.validate(c["manifest"], rules, existing?.let { list -> { p: String -> p in list } })
            assertEquals(ids(c, "errors"), v.errors.map { it.rule }, "$name errors")
            assertEquals(ids(c, "warnings"), v.warnings.map { it.rule }, "$name warnings")
            assertEquals((c["ok"] as JsonPrimitive).booleanOrNull, v.ok, "$name ok")
        }
    }

    @Test fun `the rules ship with the kernel`() {
        val shipped = assertNotNull(ProjectManifests.defaultRules())
        assertEquals(rules.rules.map { it.id }, shipped.rules.map { it.id })
    }
}
