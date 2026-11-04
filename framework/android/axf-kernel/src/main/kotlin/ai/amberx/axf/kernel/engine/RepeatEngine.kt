package ai.amberx.axf.kernel.engine

import ai.amberx.axf.kernel.asset.AssetValidator
import ai.amberx.axf.kernel.asset.Layout
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull

/**
 * Repeating slots engine (layout.repeat), twin of core/engines/repeat.ts. A layout declares slots that repeat over a
 * data set the page declares by name: one item per entry, drawn as tabs, cards, a grid or a stack; when the page
 * declares none, or it is empty, the slot's fallback draws instead. Pure and tolerant: bad entries drop out, unknown
 * values fall back to the defaults. Fixture: spec/fixtures/layout-repeat.json.
 */
public enum class RepeatStyle { TABS, CARDS, GRID, STACKED;
    public val id: String get() = name.lowercase()
    public companion object { public fun parse(s: String?): RepeatStyle? = entries.firstOrNull { it.id == s } }
}

/** What draws when the data set is missing or empty: an asset by type (+ id), or a plain label. All null = none declared. */
public data class RepeatFallback(val type: String? = null, val id: String? = null, val label: String? = null)

public data class RepeatItem(val key: String, val label: String, val icon: String?, /** position among the cleaned items */ val index: Int,
    /** the page's entry (an object entry as given; a plain value as { value }) */ val data: JsonObject)

public data class CompiledRepeat(
    val id: String,
    val region: Region,
    val dataSet: String,
    val style: RepeatStyle,
    val columns: Int,
    /** items shown (at most `max`) */
    val items: List<RepeatItem>,
    /** items left out by `max` */
    val overflow: Int,
    /** the page declared no data set by that name, or it has no usable entries */
    val empty: Boolean,
    /** the fallback to draw when empty (the layout's, cleaned); null when not empty */
    val fallback: RepeatFallback?,
    /** tabs: the selected item's key (the asked one when shown, else the first); null for other styles or when empty */
    val active: String?,
)

public object RepeatEngine {
    public val STYLES: List<RepeatStyle> = AssetValidator.REPEAT_STYLES.mapNotNull { RepeatStyle.parse(it) }
    public val DEFAULT_STYLE: RepeatStyle = RepeatStyle.STACKED
    public const val MAX_COLUMNS: Int = AssetValidator.REPEAT_MAX_COLUMNS
    /** Columns when a grid / cards slot names none; tabs and stacked are always one column. */
    public val DEFAULT_COLUMNS: Map<RepeatStyle, Int> = mapOf(RepeatStyle.TABS to 1, RepeatStyle.CARDS to 2, RepeatStyle.GRID to 3, RepeatStyle.STACKED to 1)

    private fun str(v: JsonElement?): String? = (v as? JsonPrimitive)?.takeIf { it.isString && it.content.isNotBlank() }?.content
    private fun num(v: JsonElement?): Double? = (v as? JsonPrimitive)?.takeIf { !it.isString && it !is JsonNull && it.booleanOrNull == null }?.content?.toDoubleOrNull()
    private fun whole(v: JsonElement?, min: Int, max: Int): Int? = num(v)?.takeIf { it == kotlin.math.floor(it) && it >= min && it <= max }?.toInt()
    /** JS String(n): whole numbers print without a decimal point. */
    private fun numKey(d: Double, raw: String): String = if (d == kotlin.math.floor(d) && kotlin.math.abs(d) < 1e15) d.toLong().toString() else raw

    /** Clean a data set into items: objects (key ?: id ?: position), plain strings / numbers; others and repeated keys drop out. */
    public fun items(entries: JsonElement?): List<RepeatItem> {
        val list = entries as? JsonArray ?: return emptyList()
        val out = mutableListOf<RepeatItem>()
        val seen = mutableSetOf<String>()
        list.forEachIndexed { i, e ->
            val key: String
            var label: String? = null
            var icon: String? = null
            val data: JsonObject
            when {
                e is JsonObject -> { key = str(e["key"]) ?: str(e["id"]) ?: i.toString(); label = str(e["label"]) ?: str(e["title"]); icon = str(e["icon"]); data = e }
                e is JsonPrimitive && e.isString && e.content.isNotBlank() -> { key = e.content; data = JsonObject(mapOf("value" to e)) }
                num(e) != null -> { val p = e as JsonPrimitive; key = numKey(num(e)!!, p.content); data = JsonObject(mapOf("value" to p)) }
                else -> return@forEachIndexed
            }
            if (!seen.add(key)) return@forEachIndexed
            out += RepeatItem(key, label ?: key, icon, out.size, data)
        }
        return out
    }

    private fun cleanFallback(f: JsonElement?): RepeatFallback {
        val o = f as? JsonObject ?: return RepeatFallback()
        fun s(k: String) = (o[k] as? JsonPrimitive)?.takeIf { it.isString && it.content.isNotEmpty() }?.content
        return RepeatFallback(s("type"), s("id"), s("label"))
    }

    /** One repeating slot against the page's data sets; null when the entry has no id or data set. */
    public fun compile(def: JsonElement?, sets: Map<String, JsonElement?>, active: Map<String, String> = emptyMap()): CompiledRepeat? {
        val d = def as? JsonObject ?: return null
        val id = str(d["id"]) ?: return null
        val dataSet = str(d["dataSet"]) ?: return null
        val region = (d["region"] as? JsonPrimitive)?.takeIf { it.isString }?.content?.let { Region.parse(it) } ?: Region.MAIN
        val style = (d["style"] as? JsonPrimitive)?.takeIf { it.isString }?.content?.let { s -> RepeatStyle.parse(s) }?.takeIf { st -> st in STYLES } ?: DEFAULT_STYLE
        val columns = if (style == RepeatStyle.GRID || style == RepeatStyle.CARDS) whole(d["columns"], 1, MAX_COLUMNS) ?: DEFAULT_COLUMNS.getValue(style) else 1
        val max = whole(d["max"], 0, Int.MAX_VALUE) ?: 0
        val all = items(sets[dataSet])
        val shown = if (max > 0) all.take(max) else all
        val empty = all.isEmpty()
        val want = active[id]
        return CompiledRepeat(
            id, region, dataSet, style, columns, shown, all.size - shown.size, empty,
            if (empty) cleanFallback(d["fallback"]) else null,
            if (style == RepeatStyle.TABS && shown.isNotEmpty()) (if (want != null && shown.any { it.key == want }) want else shown.first().key) else null,
        )
    }

    /** Every repeating slot of a layout, in order; invalid entries drop out and a repeated id keeps the first. */
    public fun compileAll(l: Layout, sets: Map<String, JsonElement?>, active: Map<String, String> = emptyMap()): List<CompiledRepeat> {
        val out = mutableListOf<CompiledRepeat>()
        for (def in l.repeat) { val c = compile(def, sets, active) ?: continue; if (out.none { it.id == c.id }) out += c }
        return out
    }

    /** The data set names a layout's repeating slots ask the page for, in order, once each. */
    public fun declaredDataSets(l: Layout): List<String> {
        val out = mutableListOf<String>()
        val ids = mutableSetOf<String>()
        for (def in l.repeat) {
            val o = def as? JsonObject ?: continue
            val id = str(o["id"]) ?: continue
            val n = str(o["dataSet"]) ?: continue
            if (!ids.add(id)) continue
            if (n !in out) out += n
        }
        return out
    }

    /** The data sets a layout asks for that the page doesn't declare (their slots draw the fallback). */
    public fun missingDataSets(l: Layout, sets: Map<String, JsonElement?>): List<String> = declaredDataSets(l).filter { sets[it] !is JsonArray }

    public fun repeatsIn(compiled: List<CompiledRepeat>, region: Region): List<CompiledRepeat> = compiled.filter { it.region == region }

    /** CSS variables for one slot (web hosts, devtools); same as repeatVars in repeat.ts. */
    public fun vars(c: CompiledRepeat): Map<String, String> = mapOf("--fx-repeat-cols" to c.columns.toString())
}
