package ai.amberx.axf.phoneconnect.approvals

import ai.amberx.axf.phoneconnect.auth.HubRules
import org.json.JSONObject

/**
 * axHub's waiting approvals (the hub's /auth/admin/approvals.json with the phone's session), as AmberX read them:
 * a pending approval (Approve / Deny) or a held veto call (Deny / Approve now / Shelve, with its countdown). Each
 * entry carries the reason's title and description. Anything not on the hub's origin or without a uuid is dropped.
 * Pure: parsed from the reply, unit tested.
 */
data class Approval(
    val id: String,
    val tool: String,
    val title: String,
    val why: String,
    val held: Boolean,
    val secondsLeft: Int,
    val actions: List<String>,
    val destructive: Boolean = false,
    val personOnly: Boolean = false,
    val project: String = "",
    val agent: String = "",
)

data class Feed(val status: String, val items: List<Approval>) // ok | signed-out | not-admin | unreachable

object ApprovalFeed {
    const val MAX_ITEMS = 50

    fun parse(status: Int, body: String, now: Long = System.currentTimeMillis()): Feed {
        if (status == 401) return Feed("signed-out", emptyList())
        if (status == 403) return Feed("not-admin", emptyList())
        if (status != 200) return Feed("unreachable", emptyList())
        return runCatching {
            val j = JSONObject(body)
            if (j.has("signedIn") && !j.optBoolean("signedIn", true)) return Feed("signed-out", emptyList())
            if (j.has("admin") && !j.optBoolean("admin", true)) return Feed("not-admin", emptyList())
            val arr = j.optJSONArray("pending")
            val out = mutableListOf<Approval>(); val seen = mutableSetOf<String>()
            for (i in 0 until (arr?.length() ?: 0)) {
                if (out.size >= MAX_ITEMS) break
                val p = arr!!.optJSONObject(i) ?: continue
                val id = p.optString("id")
                if (!HubRules.isApprovalId(id) || !seen.add(id)) continue
                if (listOf("url", "approvalUrl", "denyUrl", "approveNowUrl", "shelveUrl").any { p.has(it) && !HubRules.isHub(p.optString(it)) }) continue
                val reason = p.optJSONObject("reason")
                val tool = p.optString("tool", "call").take(120)
                val title = (p.optString("title").ifBlank { reason?.optString("title").orEmpty() }).ifBlank { tool }.take(200)
                val why = (reason?.optString("description").orEmpty()).ifBlank { p.optString("summary") }.take(600)
                val held = p.optString("status") == "held" || p.has("veto")
                val v = p.optJSONObject("veto") ?: p
                val left = when {
                    v.has("secondsLeft") -> v.optDouble("secondsLeft", 0.0).toInt()
                    v.has("runsAt") -> runCatching { ((java.time.Instant.parse(v.optString("runsAt")).toEpochMilli() - now) / 1000.0).toInt() }.getOrDefault(0)
                    else -> 0
                }.coerceIn(0, 24 * 3600)
                val acts = if (held) {
                    val a = v.optJSONArray("actions") ?: p.optJSONArray("actions")
                    val got = (0 until (a?.length() ?: 0)).map { a!!.optString(it) }.toSet()
                    if (a == null) listOf("deny") else HubRules.VETO_ACTIONS.filter { it in got }
                } else listOf("approve", "deny")
                out += Approval(id, tool, title, why, held, left, acts, p.optBoolean("destructive", false), p.optBoolean("personOnly", false),
                    p.optString("project").take(80), p.optString("agent").take(80))
            }
            Feed("ok", out)
        }.getOrDefault(Feed("unreachable", emptyList()))
    }

    /** The button an approval shows for a popup action name ("approve" on a held call is the hub's approve-now). */
    fun hubAction(a: Approval, action: String): String? = when {
        a.held && action == "approve" -> "approve-now".takeIf { it in a.actions }
        a.held -> action.takeIf { it in a.actions }
        action == "approve" || action == "deny" -> action
        else -> null
    }
}
