package ai.amberx.axf.kernel.project

import ai.amberx.axf.kernel.asset.parseJsonObject
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull

/**
 * Project manifests (project.manifest.json, project-manifest@1). Mirrors framework/core/project.ts, the
 * reference validator, rule for rule; framework/spec/fixtures/project-manifest.json is the contract.
 *
 * Every project built with or for AmberX AXF has a manifest: its `name` is the project's folder on the hub
 * (/projects/<name>), `repo` defines its repository (even one that doesn't exist yet) and `data.shared` lists
 * its shared data. No project is loaded or compiled without a manifest that passes the rules
 * (schemas/project-rules.json, managed in the Dev Console under Standards; shipped as a kernel resource).
 */
public object ProjectManifests {
    public const val TAG: String = "project-manifest@1"
    public const val FILE: String = "project.manifest.json"
    public const val RULES_TAG: String = "project-rules@1"

    /** The framework's own rules, read from the kernel's resources (framework/schemas/project-rules.json). */
    public fun defaultRules(): ProjectRules? =
        ProjectManifests::class.java.getResourceAsStream("/project-rules.json")?.bufferedReader()?.readText()?.parseJsonObject()?.let(ProjectRules::fromJson)
}

public enum class RuleSeverity { ERROR, WARN, OFF;
    public companion object {
        /** Same as the reference: "error" and "off" as written, anything else counts as a warning. */
        public fun parse(s: String?): RuleSeverity = when (s) { "error" -> ERROR; "off" -> OFF; else -> WARN }
    }
}

public data class ProjectRule(
    val id: String,
    val title: String,
    val severity: RuleSeverity,
    val locked: Boolean,
    /** The raw check object: op, path, required, value, values, pattern, vocab, min, max, when. */
    val check: JsonObject,
) {
    /** Locked rules are always errors. */
    public val effectiveSeverity: RuleSeverity get() = if (locked) RuleSeverity.ERROR else severity
}

public data class ProjectRules(
    val manifestFile: String,
    val vocab: Map<String, List<String>>,
    val knownKeys: List<String>,
    val rules: List<ProjectRule>,
) {
    public companion object {
        public fun fromJson(o: JsonObject): ProjectRules = ProjectRules(
            manifestFile = (o["manifestFile"] as? JsonPrimitive)?.content ?: ProjectManifests.FILE,
            vocab = (o["vocab"] as? JsonObject)?.mapValues { (_, v) -> (v as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.content } ?: emptyList() } ?: emptyMap(),
            knownKeys = (o["knownKeys"] as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.content } ?: emptyList(),
            rules = (o["rules"] as? JsonArray)?.mapNotNull { it as? JsonObject }?.map { r ->
                ProjectRule(
                    id = (r["id"] as? JsonPrimitive)?.content ?: "",
                    title = (r["title"] as? JsonPrimitive)?.content ?: "",
                    severity = RuleSeverity.parse((r["severity"] as? JsonPrimitive)?.content),
                    locked = (r["locked"] as? JsonPrimitive)?.booleanOrNull ?: false,
                    check = r["check"] as? JsonObject ?: JsonObject(emptyMap()),
                )
            } ?: emptyList(),
        )
    }
}

public data class ProjectIssue(val rule: String, val path: String, val message: String)

public data class ProjectValidation(val errors: List<ProjectIssue>, val warnings: List<ProjectIssue>) {
    public val ok: Boolean get() = errors.isEmpty()
}

public object ProjectValidator {
    private fun missing(v: JsonElement?): Boolean = v == null || v is JsonNull
    private fun isString(v: JsonElement?): Boolean = v is JsonPrimitive && v.isString
    private fun isBoolean(v: JsonElement?): Boolean = v is JsonPrimitive && !v.isString && v.booleanOrNull != null
    private fun show(v: JsonElement?): String = if (v is JsonPrimitive && v.isString) "\"${v.content}\"" else v.toString()
    private fun str(o: JsonObject, k: String): String? = (o[k] as? JsonPrimitive)?.takeIf { it.isString }?.content
    private fun num(o: JsonObject, k: String): Double? = (o[k] as? JsonPrimitive)?.takeUnless { it.isString }?.doubleOrNull

    /** Reads a dot path ("repo.name"); "$manifest" is a plain key. */
    public fun value(manifest: JsonElement, path: String): JsonElement? {
        var cur: JsonElement? = manifest
        for (part in path.split('.')) {
            val o = cur as? JsonObject ?: return null
            if (!o.containsKey(part)) return null
            cur = o[part]
        }
        return cur
    }

    private fun listFor(check: JsonObject, rules: ProjectRules): List<JsonElement> {
        val vocab = str(check, "vocab")
        if (vocab != null) return (rules.vocab[vocab] ?: emptyList()).map { JsonPrimitive(it) }
        return (check["values"] as? JsonArray)?.toList() ?: emptyList()
    }

    /** Values longer than this never match a pattern rule (no regex runs on them); same as MAX_PATTERN_INPUT. */
    public const val MAX_PATTERN_INPUT: Int = 300

    /**
     * JavaScript's RegExp.test: a match anywhere. Java's `$` also matches before a final line break, JavaScript's
     * doesn't, so when the value contains a line break a match must really end at the end (or not use `$`).
     */
    private fun matchesLikeJs(pattern: String, value: String): Boolean {
        if (value.length > MAX_PATTERN_INPUT) return false
        val re = Regex(pattern)
        if (!value.contains('\n') && !value.contains('\r')) return re.containsMatchIn(value)
        return Regex(pattern.replace(Regex("""(?<!\\)\$"""), "\\\\z")).containsMatchIn(value)
    }

    private val drive = Regex("^[A-Za-z]:")
    private fun isRelativePath(p: JsonElement?): Boolean {
        if (!isString(p)) return false
        val s = (p as JsonPrimitive).content
        return s.isNotEmpty() && !s.startsWith("/") && !s.contains('\\') && !s.split('/').contains("..") && !drive.containsMatchIn(s)
    }

    private fun runCheck(manifest: JsonObject, check: JsonObject, rules: ProjectRules, exists: ((String) -> Boolean)?): String? {
        val op = str(check, "op")
        val path = str(check, "path") ?: ""
        if (op == "knownKeys") {
            val extra = manifest.keys.filter { it !in rules.knownKeys }
            return if (extra.isEmpty()) null else "unknown field(s) ${extra.joinToString(", ") { "\"$it\"" }}; put extensions under \"x\""
        }
        val v = value(manifest, path)
        if (op == "requiredWhen") {
            val w = check["when"] as? JsonObject ?: return null
            val wPath = str(w, "path") ?: return null
            return if (value(manifest, wPath) == w["equals"] && missing(v)) "$path is required when $wPath is ${show(w["equals"])}" else null
        }
        if (missing(v)) return if ((check["required"] as? JsonPrimitive)?.booleanOrNull == true) "$path is required" else null
        return when (op) {
            "equals" -> if (v == check["value"]) null else "$path must be ${show(check["value"])}"
            "pattern" -> if (isString(v) && matchesLikeJs(str(check, "pattern") ?: "", (v as JsonPrimitive).content)) null else "$path must match ${str(check, "pattern")}"
            "notIn" -> if (((check["values"] as? JsonArray)?.toList() ?: emptyList()).contains(v)) "$path can't be ${show(v)}" else null
            "string" -> {
                if (!isString(v)) return "$path must be text"
                val n = (v as JsonPrimitive).content.trim().length
                val min = num(check, "min") ?: 0.0
                val max = num(check, "max") ?: Double.MAX_VALUE
                if (n < min || n > max) "$path must be ${min.toInt()} to ${if (max == Double.MAX_VALUE) "∞" else max.toInt().toString()} characters" else null
            }
            "oneOf" -> { val list = listFor(check, rules); if (list.contains(v)) null else "$path must be one of ${list.joinToString(", ") { show(it) }}" }
            "eachOneOf" -> {
                val arr = v as? JsonArray ?: return "$path must be a list"
                val list = listFor(check, rules)
                val bad = arr.filter { it !in list }
                if (bad.isEmpty()) null else "$path has ${bad.joinToString(", ") { show(it) }}, not in ${list.joinToString(", ") { show(it) }}"
            }
            "boolean" -> if (isBoolean(v)) null else "$path must be true or false"
            "relativePaths" -> {
                val arr = v as? JsonArray ?: return "$path must be a list of paths"
                val bad = arr.filter { !isRelativePath(it) }
                if (bad.isEmpty()) null else "$path must be paths inside the project: ${bad.joinToString(", ") { show(it) }}"
            }
            "pathsExist" -> {
                val test = exists ?: return null
                val paths = (if (v is JsonArray) v.toList() else listOf(v!!)).filter { isRelativePath(it) }.map { (it as JsonPrimitive).content }
                val gone = paths.filter { !test(it.trimEnd('/')) }
                if (gone.isEmpty()) null else "$path: not found in the project: ${gone.joinToString(", ") { "\"$it\"" }}"
            }
            else -> "unknown rule op \"$op\""
        }
    }

    /** Validates a manifest. [exists] tells whether a project-relative path exists; without it pathsExist rules are skipped. */
    public fun validate(raw: JsonElement?, rules: ProjectRules, exists: ((String) -> Boolean)? = null): ProjectValidation {
        val manifest = raw as? JsonObject
            ?: return ProjectValidation(listOf(ProjectIssue("manifest-object", "", "${rules.manifestFile} must be a JSON object")), emptyList())
        val errors = mutableListOf<ProjectIssue>()
        val warnings = mutableListOf<ProjectIssue>()
        for (rule in rules.rules) {
            val severity = rule.effectiveSeverity
            if (severity == RuleSeverity.OFF) continue
            val message = runCheck(manifest, rule.check, rules, exists) ?: continue
            val issue = ProjectIssue(rule.id, str(rule.check, "path") ?: "", message)
            if (severity == RuleSeverity.ERROR) errors += issue else warnings += issue
        }
        return ProjectValidation(errors, warnings)
    }
}
