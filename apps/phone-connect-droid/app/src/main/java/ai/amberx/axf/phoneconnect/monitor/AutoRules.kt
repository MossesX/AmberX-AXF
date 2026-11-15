package ai.amberx.axf.phoneconnect.monitor

import ai.amberx.axf.phoneconnect.approvals.Approval
import org.json.JSONObject

/**
 * The console's auto-approval rules as the phone runs them (phone-rules@1, synced on every poll). The same answer as
 * the console's rules.evaluate: never a destructive tool, a personOnly action or anything on the never-list
 * (recorder_start, vps.run), whatever a rule says. Pure, unit tested.
 */
data class Rule(val id: String, val what: String, val scope: String)

class AutoRules(val rules: List<Rule>, val never: Set<String>, private val destructive: Regex) {
    fun neverCovered(tool: String, destructiveFlag: Boolean, personOnly: Boolean): Boolean =
        tool in never || ALIASES[tool] in never || personOnly || destructiveFlag || destructive.containsMatchIn(tool.lowercase())

    /** The rule that approves [a], or null. */
    fun approves(a: Approval): Rule? {
        if (neverCovered(a.tool, a.destructive, a.personOnly)) return null
        val t = ALIASES[a.tool] ?: a.tool.lowercase()
        return rules.firstOrNull { r -> (r.what == t || (r.what.endsWith(".*") && t.startsWith(r.what.dropLast(1)))) && scopeHit(r.scope, a) }
    }

    private fun scopeHit(scope: String, a: Approval): Boolean {
        if (scope == "any") return true
        val (kind, value) = scope.split(":", limit = 2).let { it[0] to it.getOrElse(1) { "" } }
        return when (kind) { "project" -> a.project == value; "agent" -> a.agent == value; else -> false }
    }

    companion object {
        val ALIASES = mapOf("amberx.open_url" to "phone.open_url", "amberx.recorder_start" to "phone.recorder_start", "amberx.recorder_stop" to "phone.recorder_stop", "amberx.recorder_status" to "phone.recorder_status")
        val NEVER_DEFAULT = setOf("phone.recorder_start", "vps.run")
        val DESTRUCTIVE_DEFAULT = Regex("(^|[._-])(delete|remove|rm|drop|destroy|wipe|purge|reset|revoke|kill|uninstall|force_push|force-push|prune|truncate|overwrite)([._-]|$)")
        val NONE = AutoRules(emptyList(), NEVER_DEFAULT, DESTRUCTIVE_DEFAULT)

        /** From the poll's `rules` (phone-rules@1). The phone's own never-list is always kept, so a sync can only add to it. */
        fun parse(j: JSONObject?): AutoRules {
            if (j == null) return NONE
            val arr = j.optJSONArray("rules")
            val rules = (0 until (arr?.length() ?: 0)).mapNotNull { i ->
                val o = arr!!.optJSONObject(i) ?: return@mapNotNull null
                val what = o.optString("what")
                if (what.isBlank() || what == "*" || o.optBoolean("active", true).not()) null else Rule(o.optString("id"), what, o.optString("scope", "any"))
            }
            val nev = j.optJSONArray("never")
            val never = NEVER_DEFAULT + (0 until (nev?.length() ?: 0)).map { nev!!.optString(it) }
            return AutoRules(rules, never, DESTRUCTIVE_DEFAULT)
        }
    }
}
