package ai.amberx.axf.kernel.library

import ai.amberx.axf.kernel.asset.bool
import ai.amberx.axf.kernel.asset.str
import ai.amberx.axf.kernel.asset.strList
import ai.amberx.axf.kernel.asset.strOrNull
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/*
 * library@1 install parameters: the one contract every wizard that asks for a library's parameters uses
 * (Compose `AxfLibraryParamField`, web `LibraryParamField`, the CLI wizard). A parameter is answered as **text**;
 * `toJson` turns the text into the typed value the installer expects and `validate` says why a text is not acceptable.
 * Same rules as the reference `framework/core/library.ts`; pinned by `spec/fixtures/library-params.json`.
 * Written without a compiler (Maven is blocked here); CI compiles and runs LibraryParamsTest.
 */

/** One entry of a library.json `params[]`. `type` is one of [LibraryParams.TYPES] (unknown types read as text). */
public data class LibraryParam(
    val key: String,
    val label: String,
    val type: String = "text",
    val required: Boolean = false,
    val default: JsonElement? = null,
    val help: String? = null,
    val choices: List<String> = emptyList(),
    val min: Double? = null,
    val max: Double? = null,
) {
    /** The default as the text a form shows ('' when there is none; lists join with commas). */
    val defaultText: String get() = LibraryParams.text(default)

    /** Is this text (or, when blank, the default) a "yes" for a bool parameter? */
    public fun isTrue(text: String): Boolean = LibraryParams.isTrue(text.trim().ifBlank { defaultText })

    /** Form text → the typed JSON value the installer takes; null for blank text (the installer then uses the default). */
    public fun toJson(text: String): JsonElement? = LibraryParams.toJson(this, text)

    /** Why this text is not acceptable, or null when it is. */
    public fun validate(text: String): String? = LibraryParams.validate(this, text)

    public companion object {
        public fun fromJson(o: JsonObject): LibraryParam = LibraryParam(
            o.str("key"), o.str("label"), o.str("type", "text"), o.bool("required"),
            o["default"]?.takeUnless { it is JsonNull }, o.strOrNull("help"), o.strList("choices"),
            (o["min"] as? JsonPrimitive)?.content?.toDoubleOrNull(), (o["max"] as? JsonPrimitive)?.content?.toDoubleOrNull(),
        )
    }
}

public object LibraryParams {
    public val TYPES: List<String> = listOf("text", "list", "bool", "number", "choice")

    /** Words that mean "yes" for a bool parameter (case-insensitive); everything else is false. */
    public val TRUE_WORDS: Set<String> = setOf("true", "yes", "y", "on", "1")

    public fun isTrue(text: String): Boolean = text.trim().lowercase() in TRUE_WORDS

    /** A stored/default value as form text (lists join with commas; numbers as people write them: 6, 0.5). */
    public fun text(value: JsonElement?): String = when (value) {
        null, is JsonNull -> ""
        is JsonPrimitive -> primitiveText(value)
        is JsonArray -> value.joinToString(",") { e -> (e as? JsonPrimitive)?.let { primitiveText(it) } ?: e.toString() }
        else -> value.toString()
    }

    private fun primitiveText(p: JsonPrimitive): String = if (p.isString) p.content else p.content.toDoubleOrNull()?.takeIf { it.isFinite() }?.let { numberText(it) } ?: p.content

    /** Whole numbers print without a decimal part (6, not 6.0), like the reference engine. */
    private fun number(n: Double): JsonPrimitive = if (n % 1.0 == 0.0 && n >= Long.MIN_VALUE.toDouble() && n <= Long.MAX_VALUE.toDouble()) JsonPrimitive(n.toLong()) else JsonPrimitive(n)

    private fun numberText(n: Double): String = if (n % 1.0 == 0.0) n.toLong().toString() else n.toString()

    /** Plain decimal numbers only (no hex, no Infinity, no `d`/`f` suffix), the same on every port. */
    private val DECIMAL = Regex("^[+-]?(\\d+\\.?\\d*|\\.\\d+)([eE][+-]?\\d+)?$")

    /** A plain decimal as a finite number, else null (reference: `parseDecimal` in core/library.ts). */
    public fun parseDecimal(t: String): Double? = if (DECIMAL.matches(t)) t.toDoubleOrNull()?.takeIf { it.isFinite() } else null

    public fun toJson(p: LibraryParam, text: String): JsonElement? {
        val t = text.trim()
        if (t.isEmpty()) return null
        return when (p.type) {
            "bool" -> JsonPrimitive(isTrue(t))
            "number" -> parseDecimal(t)?.let { number(it) }
            "list" -> JsonArray(t.split(',', '\n').map { it.trim() }.filter { it.isNotEmpty() }.map { JsonPrimitive(it) })
            else -> JsonPrimitive(t)
        }
    }

    public fun validate(p: LibraryParam, text: String): String? {
        val t = text.trim()
        if (t.isEmpty()) return if (p.required && p.default == null) "Required" else null
        if (p.type == "number") {
            val n = parseDecimal(t) ?: return "Must be a number"
            val lo = p.min
            val hi = p.max
            if (lo != null && n < lo) return "Must be ≥ ${numberText(lo)}"
            if (hi != null && n > hi) return "Must be ≤ ${numberText(hi)}"
        }
        if (p.type == "choice" && p.choices.isNotEmpty() && t !in p.choices) return "One of ${p.choices.joinToString(", ")}"
        return null
    }

    /** Every parameter's starting answer (its default as text), keyed by `key`. */
    public fun defaults(params: List<LibraryParam>): Map<String, String> = params.associate { it.key to it.defaultText }
}
