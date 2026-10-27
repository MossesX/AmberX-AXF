package ai.amberx.axf.axnotes.plugins.buildbridge

import ai.amberx.axf.kernel.ai.AiMode
import ai.amberx.axf.kernel.ai.AiModePolicy
import ai.amberx.axf.kernel.ai.AiModes
import ai.amberx.axf.kernel.live.LiveEvent
import ai.amberx.axf.kernel.live.LiveKinds
import ai.amberx.axf.kernel.live.LiveSessionInfo
import ai.amberx.axf.kernel.live.LiveState
import ai.amberx.axf.kernel.triggers.Trigger
import ai.amberx.axf.kernel.triggers.TriggerKinds
import ai.amberx.axf.kernel.triggers.TriggerSource
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/*
 * ai-build-bridge, pure part: a note or a spoken "build …" becomes a build request for Brett's Build Orchestrator. The
 * request runs in mode ai.build-request (ai-modes@1: writes, needs approval) — the axHub session adds it to the
 * orchestrator only after Brett approves it through axHub's approval flow (approval link + push in the AXHub app). The
 * plugin never builds or edits code. Here: the request record, the approval state machine over live-session events,
 * the poll schedule (15 s for the first 10 tries, then every minute), the admin gate and the trigger data.
 */

enum class RequestStatus(val wire: String, val active: Boolean, val label: String) {
    SUBMITTING("submitting", true, "Sending"),
    PENDING_APPROVAL("pending-approval", true, "Waiting for approval"),
    /** approved: the hub session added it to the orchestrator; watched until the orchestrator reports the build done */
    APPROVED("approved", true, "Approved — in the orchestrator"),
    FINISHED("finished", false, "Build finished"),
    REJECTED("rejected", false, "Rejected"),
    EXPIRED("expired", false, "Expired"),
    CANCELLED("cancelled", false, "Cancelled"),
    FAILED("failed", false, "Failed");

    companion object { fun of(s: String?): RequestStatus = entries.firstOrNull { it.wire == s } ?: FAILED }
}

enum class RequestSource(val wire: String) {
    NOTE("note"), VOICE("voice"), MANUAL("manual");
    companion object { fun of(s: String?): RequestSource = entries.firstOrNull { it.wire == s } ?: MANUAL }
}

data class BuildRequest(
    val id: String,
    val title: String,
    val body: String,
    val source: RequestSource,
    val createdAt: Long,
    val updatedAt: Long,
    val status: RequestStatus = RequestStatus.SUBMITTING,
    val noteId: String? = null,
    val sessionId: String? = null,
    /** the axHub approval page (also pushed to the AXHub app) */
    val approvalUrl: String? = null,
    val approvalId: String? = null,
    /** the orchestrator's build id once it is added */
    val buildId: String? = null,
    /** status polls done so far */
    val polls: Int = 0,
    val nextPollAt: Long? = null,
    val lastSeq: Long = 0,
    val message: String? = null,
    val summary: String? = null,
)

/** A draft before it is sent. */
data class BuildDraft(val title: String, val body: String, val source: RequestSource, val noteId: String? = null)

object BuildIntents {
    const val TAG: String = "build"
    private val hashTag = Regex("(^|\\s)#build\\b", RegexOption.IGNORE_CASE)

    /** True when a note is tagged build (tag list or `#build` in its text). */
    fun isTagged(tags: List<String>, text: String): Boolean = tags.any { it.trim().trimStart('#').equals(TAG, ignoreCase = true) } || hashTag.containsMatchIn(text)

    /** A draft from a note (the app's note JSON: id, title, text, tags), or null when it isn't tagged build or is empty. */
    fun fromNote(note: JsonObject?): BuildDraft? {
        if (note == null) return null
        val text = str(note, "text") ?: ""
        val tags = (note["tags"] as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.content } ?: emptyList()
        if (!isTagged(tags, text)) return null
        val body = text.replace(hashTag, " ").replace(Regex("[ \\t]+"), " ").trim()
        val title = str(note, "title")?.trim()?.takeIf { it.isNotEmpty() } ?: titleFrom(body)
        if (body.isEmpty() && title.isEmpty()) return null
        return BuildDraft(title.ifEmpty { "Build request" }, body.ifEmpty { title }, RequestSource.NOTE, str(note, "id"))
    }

    fun fromVoice(text: String): BuildDraft? {
        val t = text.trim()
        if (t.isEmpty()) return null
        return BuildDraft(titleFrom(t), t, RequestSource.VOICE)
    }

    fun titleFrom(text: String): String {
        val line = text.lineSequence().map { it.trim() }.firstOrNull { it.isNotEmpty() } ?: return ""
        return if (line.length > 70) line.take(69).trimEnd() + "…" else line
    }

    private fun str(o: JsonObject, k: String): String? = (o[k] as? JsonPrimitive)?.takeIf { it.isString }?.content
}

/** The prompt the ai.build-request session gets. It asks only to add the request to the orchestrator. */
object BuildPrompt {
    fun of(d: BuildDraft): String = buildString {
        append("Add this build request to Brett's Build Orchestrator (orchestrator@1) as a new build, broken into steps of 30 minutes or less. ")
        append("Do not build, edit code or start any step: only record the request. It is sent from the AX Notes app and needs Brett's approval in axHub first.\n\n")
        append("Title: ").append(d.title).append('\n')
        append("Source: AX Notes ").append(d.source.wire)
        if (d.noteId != null) append(" (note ").append(d.noteId).append(')')
        append("\n\n").append(d.body.trim())
    }
}

/** Only admins may send build requests (UAC): the policy must be admin AND allow the ai.build-request mode. */
object BridgeGate {
    const val DENIED: String = "Only admins can send build requests."

    fun check(policy: AiModePolicy, modes: List<AiMode>): String? {
        if (!policy.admin) return DENIED
        val mode = modes.firstOrNull { it.id == AiModes.BUILD_REQUEST } ?: return "The build-request mode isn't available in this app."
        return if (AiModes.allowed(mode, policy)) null else DENIED
    }
}

object ApprovalPoll {
    const val FAST_MS: Long = 15_000
    const val FAST_TRIES: Int = 10
    const val SLOW_MS: Long = 60_000
    /** a request still waiting for approval after this long expires */
    const val APPROVAL_TTL_MS: Long = 7L * 24 * 60 * 60 * 1000
    /** an approved request is watched for the orchestrator's "finished" this long */
    const val WATCH_TTL_MS: Long = 30L * 24 * 60 * 60 * 1000

    /** Wait before the next poll, after [polls] polls: 15 s for the first 10 tries, then every minute. */
    fun delayMs(polls: Int): Long = if (polls < FAST_TRIES) FAST_MS else SLOW_MS

    /** After a poll: counts it, expires stale requests, schedules the next one (none once the request is over). */
    fun afterPoll(r: BuildRequest, now: Long): BuildRequest {
        val polled = r.copy(polls = r.polls + 1, updatedAt = now)
        val ttl = if (r.status == RequestStatus.APPROVED) WATCH_TTL_MS else APPROVAL_TTL_MS
        if (polled.status.active && now - r.createdAt > ttl) {
            return if (r.status == RequestStatus.APPROVED) polled.copy(status = RequestStatus.EXPIRED, nextPollAt = null, message = "Approved, but no word of the build finishing within 30 days; stopped watching.")
            else polled.copy(status = RequestStatus.EXPIRED, nextPollAt = null, message = "No approval within 7 days.")
        }
        return polled.copy(nextPollAt = if (polled.status.active) now + delayMs(polled.polls) else null)
    }

    /** The request due first (earliest nextPollAt) among the active ones, or null. */
    fun due(requests: List<BuildRequest>): BuildRequest? = requests.filter { it.status.active && it.sessionId != null && it.nextPollAt != null }.minByOrNull { it.nextPollAt!! }
}

/** Result of folding events in: the request, and whether it just finished (the hook fires once). */
data class Fold(val request: BuildRequest, val justFinished: Boolean = false)

object ApprovalEvents {
    private val URL_KEYS = listOf("approvalUrl", "url", "link", "approval_url")
    private val ID_KEYS = listOf("approvalId", "confirmationId", "confirmation_id", "id")
    private val BUILD_KEYS = listOf("buildId", "build", "orchestratorId")

    fun fold(r: BuildRequest, events: List<LiveEvent>, now: Long): Fold {
        var cur = r
        var finished = false
        for (e in events) {
            if (e.seq in 1..cur.lastSeq) continue
            val next = apply(cur, e).copy(lastSeq = maxOf(cur.lastSeq, e.seq), updatedAt = now)
            if (cur.status != RequestStatus.FINISHED && next.status == RequestStatus.FINISHED) finished = true
            cur = next
        }
        return Fold(cur, finished)
    }

    /** One event. Kinds are the hub session's (open set); unknown kinds change nothing. */
    fun apply(r: BuildRequest, e: LiveEvent): BuildRequest {
        val d = e.data as? JsonObject
        if (!r.status.active) return r
        return when (e.kind) {
            LiveKinds.WAIT, "approval.pending", "approval.required", "confirmation_required" -> pending(r, d)
            "approval" -> when (s(d, "state") ?: s(d, "status")) {
                "pending", "waiting" -> pending(r, d)
                "approved" -> approved(r, d)
                "rejected", "denied" -> r.copy(status = RequestStatus.REJECTED, nextPollAt = null, message = s(d, "reason") ?: "Brett rejected the request.")
                "expired" -> r.copy(status = RequestStatus.EXPIRED, nextPollAt = null, message = "The approval expired.")
                else -> r
            }
            "approval.approved" -> approved(r, d)
            "approval.rejected" -> r.copy(status = RequestStatus.REJECTED, nextPollAt = null, message = s(d, "reason") ?: "Brett rejected the request.")
            "approval.expired" -> r.copy(status = RequestStatus.EXPIRED, nextPollAt = null, message = "The approval expired.")
            LiveKinds.RESUME -> if (r.status == RequestStatus.PENDING_APPROVAL) approved(r, d) else r
            "orchestrator.added", "build.queued" -> approved(r, d).copy(message = "Added to the Build Orchestrator.")
            "build.finished", "orchestrator.finished" -> r.copy(
                status = RequestStatus.FINISHED, nextPollAt = null, buildId = first(d, BUILD_KEYS) ?: r.buildId,
                summary = s(d, "summary") ?: s(d, "text"), message = "Build ${s(d, "status") ?: "finished"}.",
            )
            "error" -> r.copy(status = RequestStatus.FAILED, nextPollAt = null, message = s(d, "message") ?: s(d, "text") ?: "The hub session failed.")
            LiveKinds.CLOSE -> if (r.status == RequestStatus.APPROVED) r else r.copy(status = RequestStatus.CANCELLED, nextPollAt = null, message = "The hub session closed before approval.")
            else -> r
        }
    }

    /** What the session list says (state waiting + the approval link in its meta). */
    fun fromInfo(r: BuildRequest, info: LiveSessionInfo): BuildRequest {
        if (!r.status.active) return r
        val url = URL_KEYS.firstNotNullOfOrNull { info.meta[it] }
        return when {
            info.state == LiveState.CLOSED && r.status != RequestStatus.APPROVED -> r.copy(status = RequestStatus.CANCELLED, nextPollAt = null, message = "The hub session closed before approval.")
            info.state == LiveState.WAITING || url != null -> r.copy(status = if (r.status == RequestStatus.SUBMITTING) RequestStatus.PENDING_APPROVAL else r.status, approvalUrl = url?.takeIf { safeUrl(it) } ?: r.approvalUrl)
            else -> r
        }
    }

    /** Only https links (or http on a local hub) are shown as the approval link. */
    fun safeUrl(u: String): Boolean = u.startsWith("https://") || u.startsWith("http://localhost") || u.startsWith("http://10.") || u.startsWith("http://192.168.")

    private fun pending(r: BuildRequest, d: JsonObject?): BuildRequest {
        val url = first(d, URL_KEYS)?.takeIf { safeUrl(it) }
        return r.copy(
            status = if (r.status == RequestStatus.APPROVED) r.status else RequestStatus.PENDING_APPROVAL,
            approvalUrl = url ?: r.approvalUrl, approvalId = first(d, ID_KEYS) ?: r.approvalId,
            message = if (url != null || r.approvalUrl != null) "Approve it in axHub (link below, or the push from the AXHub app)." else "Waiting for the approval link…",
        )
    }

    private fun approved(r: BuildRequest, d: JsonObject?): BuildRequest =
        r.copy(status = RequestStatus.APPROVED, buildId = first(d, BUILD_KEYS) ?: r.buildId, message = "Approved. The orchestrator has it; you'll hear when the build finishes.")

    private fun s(d: JsonObject?, k: String): String? = (d?.get(k) as? JsonPrimitive)?.takeIf { it.isString }?.content?.takeIf { it.isNotBlank() }
    private fun first(d: JsonObject?, keys: List<String>): String? = keys.firstNotNullOfOrNull { s(d, it) }
}

/** JSON for the KV store (records of this plugin only). */
object RequestCodec {
    const val MAX_KEPT: Int = 100

    fun toJson(r: BuildRequest): JsonObject = JsonObject(buildMap<String, JsonElement> {
        put("id", JsonPrimitive(r.id)); put("title", JsonPrimitive(r.title)); put("body", JsonPrimitive(r.body)); put("source", JsonPrimitive(r.source.wire))
        put("createdAt", JsonPrimitive(r.createdAt)); put("updatedAt", JsonPrimitive(r.updatedAt)); put("status", JsonPrimitive(r.status.wire))
        put("polls", JsonPrimitive(r.polls)); put("lastSeq", JsonPrimitive(r.lastSeq))
        fun opt(k: String, v: Any?) { put(k, when (v) { null -> JsonNull; is Long -> JsonPrimitive(v); else -> JsonPrimitive(v.toString()) }) }
        opt("noteId", r.noteId); opt("sessionId", r.sessionId); opt("approvalUrl", r.approvalUrl); opt("approvalId", r.approvalId)
        opt("buildId", r.buildId); opt("nextPollAt", r.nextPollAt); opt("message", r.message); opt("summary", r.summary)
    })

    fun fromJson(e: JsonElement?): BuildRequest? {
        val o = e as? JsonObject ?: return null
        fun s(k: String) = (o[k] as? JsonPrimitive)?.takeIf { it.isString }?.content
        fun l(k: String) = (o[k] as? JsonPrimitive)?.takeUnless { it.isString }?.content?.toDoubleOrNull()?.toLong()
        val id = s("id") ?: return null
        return BuildRequest(
            id = id, title = s("title") ?: "", body = s("body") ?: "", source = RequestSource.of(s("source")), createdAt = l("createdAt") ?: 0, updatedAt = l("updatedAt") ?: 0,
            status = RequestStatus.of(s("status")), noteId = s("noteId"), sessionId = s("sessionId"), approvalUrl = s("approvalUrl"), approvalId = s("approvalId"),
            buildId = s("buildId"), polls = (l("polls") ?: 0).toInt(), nextPollAt = l("nextPollAt"), lastSeq = l("lastSeq") ?: 0, message = s("message"), summary = s("summary"),
        )
    }

    fun listToJson(rs: List<BuildRequest>): JsonArray = JsonArray(keep(rs).map { toJson(it) })
    fun listFromJson(e: JsonElement?): List<BuildRequest> = (e as? JsonArray)?.mapNotNull { fromJson(it) } ?: emptyList()

    /** Newest first; active requests are always kept, the oldest finished ones go past [MAX_KEPT]. */
    fun keep(rs: List<BuildRequest>): List<BuildRequest> {
        val sorted = rs.sortedByDescending { it.createdAt }
        if (sorted.size <= MAX_KEPT) return sorted
        val active = sorted.count { it.status.active }
        val done = sorted.filterNot { it.status.active }.take(maxOf(0, MAX_KEPT - active)).map { it.id }.toSet()
        return sorted.filter { it.status.active || it.id in done }
    }

    /** The hook payload other plugins (ai-automations) get when the orchestrator finishes a build. */
    fun finishedHook(r: BuildRequest): JsonObject = JsonObject(buildMap<String, JsonElement> {
        put("requestId", JsonPrimitive(r.id)); put("title", JsonPrimitive(r.title)); put("status", JsonPrimitive("finished"))
        r.buildId?.let { put("buildId", JsonPrimitive(it)) }
        r.summary?.let { put("summary", JsonPrimitive(it)) }
    })
}

object BridgeTriggers {
    const val ACTION_REQUEST: String = "ai-build-bridge.request"
    const val ACTION_OPEN: String = "ai-build-bridge.open"

    fun all(module: String): List<Trigger> = listOf(
        Trigger("ai-build-bridge.request", TriggerKinds.VOICE, TriggerSource.PERMANENT, module, "Build request", listOf("build <text>", "build request <text>", "send a build request <text>"), ACTION_REQUEST),
        Trigger("ai-build-bridge.open", TriggerKinds.VOICE, TriggerSource.PERMANENT, module, "Open build requests", listOf("show build requests", "open build requests", "check build requests"), ACTION_OPEN),
    )

    fun textArg(args: JsonObject?): String? =
        listOf("text", "body").firstNotNullOfOrNull { k -> (args?.get(k) as? JsonPrimitive)?.takeIf { it.isString }?.content?.trim()?.takeIf { it.isNotEmpty() } }
}
