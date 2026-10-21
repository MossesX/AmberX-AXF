package ai.amberx.axf.kernel

import ai.amberx.axf.kernel.asset.bool
import ai.amberx.axf.kernel.asset.int
import ai.amberx.axf.kernel.asset.objList
import ai.amberx.axf.kernel.asset.parseJsonObject
import ai.amberx.axf.kernel.asset.str
import ai.amberx.axf.kernel.asset.strList
import ai.amberx.axf.kernel.asset.strOrNull
import ai.amberx.axf.kernel.plugins.DependencyStatus
import ai.amberx.axf.kernel.plugins.InventoryContext
import ai.amberx.axf.kernel.plugins.LiveService
import ai.amberx.axf.kernel.plugins.PLUGIN_INVENTORY_FRAME
import ai.amberx.axf.kernel.plugins.PluginHealth
import ai.amberx.axf.kernel.plugins.PluginInventoryEngine
import ai.amberx.axf.kernel.plugins.PluginRecord
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals

/** Replays spec/fixtures/plugin-inventory.json (generated from core/engines/plugins.ts) against PluginInventoryEngine. */
class PluginInventoryConformanceTest {
    private val f: JsonObject = File("../../spec/fixtures/plugin-inventory.json").readText().parseJsonObject()!!
    private fun strings(e: kotlinx.serialization.json.JsonElement) = (e as JsonArray).map { it.jsonPrimitive.content }
    private val ctxJson = f.getValue("context").jsonObject
    private val ctx = InventoryContext(
        apiLevels = (ctxJson.getValue("apiLevels") as JsonArray).map { it.jsonPrimitive.content.toInt() },
        target = ctxJson.strOrNull("target"),
        live = ctxJson.objList("live").map { LiveService(it.str("name"), it.str("folder"), it.bool("enabled")) },
    )
    private val records = f.objList("records").map { PluginRecord.fromJson(it) }

    @Test fun `frame, healths and dependency labels match`() {
        assertEquals(PLUGIN_INVENTORY_FRAME, f.str("frame"))
        assertEquals(strings(f.getValue("healths")), listOf(PluginHealth.OK, PluginHealth.PARTIAL, PluginHealth.OFF, PluginHealth.BLOCKED, PluginHealth.ERROR).map { it.id })
        for ((id, label) in f.getValue("dependencyLabels").jsonObject) assertEquals(label.jsonPrimitive.content, DependencyStatus.parse(id)!!.label, id)
    }

    private fun checkInventory(exp: JsonObject, inv: ai.amberx.axf.kernel.plugins.PluginInventory, full: Boolean) {
        val items = exp.objList("items")
        assertEquals(items.map { it.str("folder") }, inv.items.map { it.folder }, "item order")
        for ((e, a) in items.zip(inv.items)) {
            assertEquals(e.str("health"), a.health.id, "${a.folder} health")
            assertEquals(strings(e.getValue("conflicts")), a.conflicts, "${a.folder} conflicts")
            if (!full) continue
            val deps = e.objList("dependencies")
            assertEquals(deps.size, a.dependencies.size, "${a.folder} dependency count")
            for ((d, got) in deps.zip(a.dependencies)) {
                assertEquals(d.str("kind"), got.kind.id, "${a.folder} ${d.str("name")} kind")
                assertEquals(d.str("name"), got.name, "${a.folder} dependency name")
                assertEquals(d.bool("required"), got.required, "${a.folder} ${got.name} required")
                assertEquals(d.str("status"), got.status.id, "${a.folder} ${got.name} status")
                assertEquals(d.str("detail"), got.detail, "${a.folder} ${got.name} detail")
                val provs = d["providers"]?.let { (it as JsonArray).map { p -> p.jsonObject } }
                assertEquals(provs?.map { it.str("folder") }, got.providers?.map { it.folder }, "${a.folder} ${got.name} providers")
                provs?.zip(got.providers ?: emptyList())?.forEach { (p, g) -> assertEquals(p.bool("enabled"), g.enabled); assertEquals(p.bool("live"), g.live, "${a.folder} ${got.name} provider ${g.folder} live") }
            }
            val dependents = e.objList("dependents")
            assertEquals(dependents.map { Triple(it.str("folder"), it.str("service"), it.bool("required")) }, a.dependents.map { Triple(it.folder, it.service, it.required) }, "${a.folder} dependents")
        }
        val conflicts = exp.objList("conflicts")
        assertEquals(conflicts.map { it.str("id") }, inv.conflicts.map { it.id }, "conflict ids")
        for ((c, g) in conflicts.zip(inv.conflicts)) {
            assertEquals(c.str("kind"), g.kind); assertEquals(c.str("key"), g.key)
            assertEquals(strings(c.getValue("folders")), g.folders, g.id)
            assertEquals(c.str("severity"), g.severity.id, g.id)
            assertEquals(c.str("detail"), g.detail, g.id)
        }
        val counts = exp.getValue("counts").jsonObject
        assertEquals(counts.int("total"), inv.counts.total); assertEquals(counts.int("enabled"), inv.counts.enabled)
        assertEquals(counts.int("errors"), inv.counts.errors); assertEquals(counts.int("missingDeps"), inv.counts.missingDeps)
        assertEquals(counts.int("conflicts"), inv.counts.conflicts); assertEquals(counts.int("editors"), inv.counts.editors)
    }

    @Test fun `dependencies, dependents, health, clashes and counts match the reference engine`() {
        checkInventory(f.getValue("inventory").jsonObject, PluginInventoryEngine.build(records, ctx), full = true)
    }

    @Test fun `enabling the off provider unblocks its dependent and surfaces the UI-editor clash`() {
        val on = records.map { if (it.folder == "off-provider") it.copy(enabled = true) else it }
        checkInventory(f.getValue("enabledOffProvider").jsonObject, PluginInventoryEngine.build(on, ctx), full = false)
    }

    @Test fun `graph layout matches`() {
        val exp = f.getValue("graph").jsonObject
        val g = PluginInventoryEngine.graph(PluginInventoryEngine.build(records, ctx).items, ctx.live)
        assertEquals(exp.int("rows"), g.rows)
        val nodes = exp.objList("nodes")
        assertEquals(nodes.map { it.str("id") }, g.nodes.map { it.id }, "node order")
        for ((n, a) in nodes.zip(g.nodes)) {
            assertEquals(n.str("kind"), a.kind.id, a.id); assertEquals(n.str("label"), a.label, a.id)
            assertEquals(n.int("column"), a.column, a.id); assertEquals(n.int("row"), a.row, a.id)
            assertEquals(n.bool("missing"), a.missing, "${a.id} missing"); assertEquals(n.int("providers"), a.providers, "${a.id} providers")
            assertEquals(n.strOrNull("folder"), a.folder, "${a.id} folder")
        }
        val edges = exp.objList("edges")
        assertEquals(edges.map { listOf(it.str("from"), it.str("to"), it.str("kind"), it.bool("broken").toString()) }, g.edges.map { listOf(it.from, it.to, it.kind.id, it.broken.toString()) })
    }

    @Test fun `strList on the fixture's records round-trips every field used`() {
        // Guard against the fixture gaining a field the Kotlin record doesn't read.
        val known = setOf("folder", "id", "name", "version", "apiLevel", "targets", "provides", "requires", "optional", "uiEditor", "scopes", "enabled", "error", "serverPart", "server", "env", "dataDir", "dataDirProblem", "services")
        for (r in f.objList("records")) assertEquals(emptySet(), r.keys - known, "unknown record fields in ${r.str("folder")}")
        assertEquals(records.first().targets, f.objList("records").first().strList("targets"))
    }
}
