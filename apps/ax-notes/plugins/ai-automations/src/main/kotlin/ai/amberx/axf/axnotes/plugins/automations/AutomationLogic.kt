package ai.amberx.axf.axnotes.plugins.automations

import ai.amberx.axf.kernel.triggers.Patterns
import ai.amberx.axf.kernel.triggers.Trigger
import ai.amberx.axf.kernel.triggers.TriggerKinds
import ai.amberx.axf.kernel.triggers.TriggerSource
import ai.amberx.axf.kernel.work.DelayRule
import ai.amberx.axf.kernel.work.IntervalBounds
import ai.amberx.axf.kernel.work.JobSpec
import ai.amberx.axf.kernel.work.OutcomeRule
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/*
 * ai-automations, pure part: toggleable rules "when X, do Y" and their evaluation. Signals in (a voice phrase fired,
 * a scheduler tick, a new git push on a watched repo, a note tagged #build / #ask saved, the orchestrator finished a
 * build); firings out. No Android, no clock, no I/O: the plugin feeds signals and carries out firings. Unit-tested.
 */

sealed class RuleTrigger {
    /** a spoken phrase (registered as a triggers@1 voice trigger while the rule is on) */
    data class Voice(val phrase: String) : RuleTrigger()
    /** every N minutes, or every day at HH:MM (local time) on [days] (ISO 1 = Monday … 7; empty = every day) */
    data class Schedule(val everyMinutes: Int? = null, val dailyAt: String? = null, val days: Set<Int> = emptySet()) : RuleTrigger()
    /** a new commit at the head of [repo] (`owner/name`), on [branch] or the default branch */
    data class GitPush(val repo: String, val branch: String? = null) : RuleTrigger()
    /** a note saved with this tag (`build`, `ask`, …), as a tag or `#tag` in its text */
    data class NoteTag(val tag: String) : RuleTrigger()
    /** the Build Orchestrator finished a build (through ai-build-bridge's hook) */
    object BuildFinished : RuleTrigger()
}

sealed class RuleAction {
    /** ask Claude (ai.chat); the reply is saved as a note. [prompt] is a template: {text} {title} {repo} {sha} … */
    data class AskClaude(val prompt: String) : RuleAction()
    /** hand the note / text to ai-build-bridge (Brett's approval still needed) */
    object BuildRequest : RuleAction()
    /** a read-back summary note of a finished build, read aloud when [speak] */
    data class ReadBack(val speak: Boolean = true) : RuleAction()
    /** dispatch any action spec on the app's action bus */
    data class RunAction(val spec: String) : RuleAction()
}

data class AutomationRule(
    val id: String,
    val label: String,
    val enabled: Boolean,
    val trigger: RuleTrigger,
    val action: RuleAction,
    /** a rule never fires twice within this */
    val cooldownMs: Long = 30_000,
)

/** What a rule remembers between signals. */
data class RuleMemory(
    val lastFiredAt: Long? = null,
    /** when the rule first saw a tick / push (schedules count from here; the first push seen is the baseline) */
    val armedAt: Long? = null,
    val lastSha: String? = null,
    /** notes this rule already handled (a re-saved note never fires twice) */
    val seenNotes: List<String> = emptyList(),
)

sealed class Signal {
    abstract val at: Long
    data class VoiceFired(val ruleId: String, val text: String?, override val at: Long) : Signal()
    data class Tick(override val at: Long, val zoneOffsetMinutes: Int = 0) : Signal()
    data class GitHead(val repo: String, val branch: String?, val sha: String, override val at: Long, val message: String? = null) : Signal()
    data class NoteSaved(val noteId: String, val title: String, val text: String, val tags: List<String>, override val at: Long) : Signal()
    data class BuildDone(val title: String, val buildId: String?, val status: String, val summary: String?, override val at: Long) : Signal()
}

data class Firing(val ruleId: String, val action: RuleAction, val vars: Map<String, String>)

data class Evaluation(val firings: List<Firing>, val memory: Map<String, RuleMemory>)

object AutomationEngine {
    const val SEEN_NOTES_MAX: Int = 200
    /** notes this plugin writes carry this tag; they never trigger rules (no loops) */
    const val OWN_TAG: String = "ai-automations"

    fun evaluate(rules: List<AutomationRule>, signal: Signal, memory: Map<String, RuleMemory>): Evaluation {
        val mem = LinkedHashMap(memory)
        val out = ArrayList<Firing>()
        for (rule in rules) {
            if (!rule.enabled) continue
            val m = mem[rule.id] ?: RuleMemory()
            val (vars, next) = match(rule, signal, m) ?: continue
            if (vars == null) { mem[rule.id] = next; continue }
            val last = m.lastFiredAt
            if (last != null && signal.at - last in 0 until rule.cooldownMs) { mem[rule.id] = next.copy(lastFiredAt = last); continue }
            out += Firing(rule.id, rule.action, vars)
            mem[rule.id] = next.copy(lastFiredAt = signal.at)
        }
        // forget rules that no longer exist
        val ids = rules.map { it.id }.toSet()
        return Evaluation(out, mem.filterKeys { it in ids })
    }

    /** null = this signal isn't for this rule; (null, memory) = memory changes but nothing fires; (vars, memory) = fire. */
    private fun match(rule: AutomationRule, s: Signal, m: RuleMemory): Pair<Map<String, String>?, RuleMemory>? {
        val t = rule.trigger
        return when {
            t is RuleTrigger.Voice && s is Signal.VoiceFired -> if (s.ruleId != rule.id) null else mapOf("text" to (s.text ?: ""), "phrase" to t.phrase) to m
            t is RuleTrigger.Schedule && s is Signal.Tick -> {
                val ref = m.lastFiredAt ?: m.armedAt ?: return null to m.copy(armedAt = s.at)
                if (Schedules.due(t, ref, s.at, s.zoneOffsetMinutes)) mapOf("text" to "", "when" to (t.dailyAt ?: "every ${t.everyMinutes} min")) to m else null
            }
            t is RuleTrigger.GitPush && s is Signal.GitHead -> {
                if (!s.repo.equals(t.repo, ignoreCase = true) || (t.branch != null && s.branch != null && !t.branch.equals(s.branch, ignoreCase = true))) null
                else if (m.lastSha == null) null to m.copy(lastSha = s.sha, armedAt = m.armedAt ?: s.at)
                else if (m.lastSha == s.sha) null
                else mapOf("repo" to s.repo, "branch" to (s.branch ?: ""), "sha" to s.sha, "message" to (s.message ?: ""), "text" to (s.message ?: "")) to m.copy(lastSha = s.sha)
            }
            t is RuleTrigger.NoteTag && s is Signal.NoteSaved -> {
                if (Tags.has(s.tags, OWN_TAG, "") || !Tags.has(s.tags, t.tag, s.text) || s.noteId in m.seenNotes) null
                else mapOf("noteId" to s.noteId, "title" to s.title, "text" to Tags.strip(s.text, t.tag), "tag" to t.tag) to m.copy(seenNotes = (m.seenNotes + s.noteId).takeLast(SEEN_NOTES_MAX))
            }
            t is RuleTrigger.BuildFinished && s is Signal.BuildDone ->
                mapOf("title" to s.title, "buildId" to (s.buildId ?: ""), "status" to s.status, "summary" to (s.summary ?: ""), "text" to (s.summary ?: "")) to m
            else -> null
        }
    }
}

object Schedules {
    private const val MINUTE: Long = 60_000
    private const val DAY: Long = 24 * 60 * MINUTE
    private val hhmm = Regex("^([01]?\\d|2[0-3]):([0-5]\\d)$")

    fun validTime(s: String?): Boolean = s != null && hhmm.matches(s.trim())

    /** True when an occurrence of [t] falls after [ref] and at or before [now]. */
    fun due(t: RuleTrigger.Schedule, ref: Long, now: Long, zoneOffsetMinutes: Int = 0): Boolean {
        val every = t.everyMinutes
        if (every != null && every > 0) return now - ref >= every * MINUTE
        val at = lastOccurrence(t, now, zoneOffsetMinutes) ?: return false
        return at > ref
    }

    /** The latest daily occurrence at or before [now] (UTC ms), or null when the schedule has none. */
    fun lastOccurrence(t: RuleTrigger.Schedule, now: Long, zoneOffsetMinutes: Int = 0): Long? {
        val m = hhmm.find(t.dailyAt?.trim() ?: return null) ?: return null
        val offset = zoneOffsetMinutes * MINUTE
        val local = now + offset
        var occ = Math.floorDiv(local, DAY) * DAY + (m.groupValues[1].toLong() * 60 + m.groupValues[2].toLong()) * MINUTE
        if (occ > local) occ -= DAY
        val days = t.days.filter { it in 1..7 }.toSet()
        var guard = 0
        while (days.isNotEmpty() && isoDay(occ) !in days && guard++ < 7) occ -= DAY
        return occ - offset
    }

    /** ISO day of week (1 = Monday … 7 = Sunday) of a local-time instant. 1970-01-01 was a Thursday. */
    fun isoDay(localMs: Long): Int = (Math.floorMod(Math.floorDiv(localMs, DAY) + 3, 7L) + 1).toInt()
}

object Tags {
    fun has(tags: List<String>, tag: String, text: String): Boolean {
        val want = tag.trim().trimStart('#')
        if (want.isEmpty()) return false
        if (tags.any { it.trim().trimStart('#').equals(want, ignoreCase = true) }) return true
        return text.isNotEmpty() && Regex("(^|\\s)#" + Regex.escape(want) + "\\b", RegexOption.IGNORE_CASE).containsMatchIn(text)
    }

    fun strip(text: String, tag: String): String =
        text.replace(Regex("(^|\\s)#" + Regex.escape(tag.trim().trimStart('#')) + "\\b", RegexOption.IGNORE_CASE), " ").replace(Regex("[ \\t]+"), " ").trim()
}

object Templates {
    private val slot = Regex("\\{([a-zA-Z]+)}")
    fun expand(template: String, vars: Map<String, String>): String = template.replace(slot) { vars[it.groupValues[1]] ?: "" }.trim()
}

/** The read-back of a finished build: a note draft (the app's `axnotes.notes.save` payload) and what to say. */
object ReadBackNote {
    fun draft(vars: Map<String, String>): JsonObject {
        val title = vars["title"]?.takeIf { it.isNotBlank() } ?: "a build"
        val summary = vars["summary"]?.takeIf { it.isNotBlank() } ?: "The orchestrator sent no summary."
        val text = buildString {
            append("Build ").append(vars["status"]?.takeIf { it.isNotBlank() } ?: "finished")
            vars["buildId"]?.takeIf { it.isNotBlank() }?.let { append(" · ").append(it) }
            append("\n\n").append(summary)
        }
        return JsonObject(linkedMapOf(
            "title" to JsonPrimitive("Build finished: $title"), "text" to JsonPrimitive(text),
            "tags" to JsonArray(listOf("build", "orchestrator", AutomationEngine.OWN_TAG).map { JsonPrimitive(it) }), "source" to JsonPrimitive("ai"),
        ))
    }

    fun spoken(vars: Map<String, String>): String =
        "Build finished: ${vars["title"]?.takeIf { it.isNotBlank() } ?: "a build"}. " + (vars["summary"]?.takeIf { it.isNotBlank() } ?: "No summary yet.")

    /** A Claude reply saved by an AskClaude rule. */
    fun reply(rule: String, prompt: String, reply: String): JsonObject = JsonObject(linkedMapOf(
        "title" to JsonPrimitive("Claude ($rule)"), "text" to JsonPrimitive("Q: ${prompt.trim()}\n\n${reply.trim()}"),
        "tags" to JsonArray(listOf("claude", AutomationEngine.OWN_TAG).map { JsonPrimitive(it) }), "source" to JsonPrimitive("ai"),
    ))
}

object DefaultRules {
    val ALL: List<AutomationRule> = listOf(
        AutomationRule("ask-notes", "Ask Claude about notes tagged #ask", true, RuleTrigger.NoteTag("ask"), RuleAction.AskClaude("{text}")),
        AutomationRule("build-notes", "Send notes tagged #build to the build bridge", false, RuleTrigger.NoteTag("build"), RuleAction.BuildRequest),
        AutomationRule("build-finished", "Read back finished builds", true, RuleTrigger.BuildFinished, RuleAction.ReadBack(speak = true)),
        AutomationRule("morning", "Morning briefing at 08:00", false, RuleTrigger.Schedule(dailyAt = "08:00"), RuleAction.AskClaude("Give me a short briefing of my notes and to-dos for today.")),
        AutomationRule("axf-push", "New push on MossesX/AmberX-AXF", false, RuleTrigger.GitPush("MossesX/AmberX-AXF"), RuleAction.AskClaude("Summarize what changed in {repo} at {sha}: {message}")),
        AutomationRule("status-voice", "Say \"status report\"", false, RuleTrigger.Voice("status report"), RuleAction.AskClaude("Give me a short status report of my open build requests and to-dos.")),
    )
}

/** One-line descriptions for the screen. */
object RuleText {
    fun trigger(t: RuleTrigger): String = when (t) {
        is RuleTrigger.Voice -> "When you say \"${t.phrase}\""
        is RuleTrigger.Schedule -> if (t.everyMinutes != null) "Every ${t.everyMinutes} min" else "Every day at ${t.dailyAt}" + if (t.days.isNotEmpty()) " (${t.days.sorted().joinToString(",") { DAYS[it - 1] }})" else ""
        is RuleTrigger.GitPush -> "When ${t.repo}${t.branch?.let { " ($it)" } ?: ""} gets a new push"
        is RuleTrigger.NoteTag -> "When a note tagged #${t.tag} is saved"
        is RuleTrigger.BuildFinished -> "When the orchestrator finishes a build"
    }

    fun action(a: RuleAction): String = when (a) {
        is RuleAction.AskClaude -> "ask Claude and save the reply as a note"
        is RuleAction.BuildRequest -> "send it to the build bridge (needs Brett's approval)"
        is RuleAction.ReadBack -> if (a.speak) "save a summary note and read it aloud" else "save a summary note"
        is RuleAction.RunAction -> "run ${a.spec}"
    }

    private val DAYS = listOf("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")
}

/** JSON for the KV store. */
object RuleCodec {
    private fun p(s: String) = JsonPrimitive(s)
    private fun s(o: JsonObject?, k: String) = (o?.get(k) as? JsonPrimitive)?.takeIf { it.isString }?.content
    private fun n(o: JsonObject?, k: String) = (o?.get(k) as? JsonPrimitive)?.takeUnless { it.isString }?.content?.toDoubleOrNull()?.toLong()
    private fun b(o: JsonObject?, k: String) = (o?.get(k) as? JsonPrimitive)?.takeUnless { it.isString }?.content?.toBooleanStrictOrNull()

    fun trigger(t: RuleTrigger): JsonObject = JsonObject(when (t) {
        is RuleTrigger.Voice -> mapOf("kind" to p("voice"), "phrase" to p(t.phrase))
        is RuleTrigger.Schedule -> buildMap<String, JsonElement> {
            put("kind", p("schedule")); t.everyMinutes?.let { put("everyMinutes", JsonPrimitive(it)) }; t.dailyAt?.let { put("dailyAt", p(it)) }
            if (t.days.isNotEmpty()) put("days", JsonArray(t.days.sorted().map { JsonPrimitive(it) }))
        }
        is RuleTrigger.GitPush -> buildMap<String, JsonElement> { put("kind", p("git-push")); put("repo", p(t.repo)); t.branch?.let { put("branch", p(it)) } }
        is RuleTrigger.NoteTag -> mapOf("kind" to p("note-tag"), "tag" to p(t.tag))
        is RuleTrigger.BuildFinished -> mapOf("kind" to p("build-finished"))
    })

    fun trigger(o: JsonObject?): RuleTrigger? = when (s(o, "kind")) {
        "voice" -> s(o, "phrase")?.takeIf { it.isNotBlank() }?.let { RuleTrigger.Voice(it) }
        "schedule" -> RuleTrigger.Schedule(n(o, "everyMinutes")?.toInt()?.takeIf { it > 0 }, s(o, "dailyAt")?.takeIf { Schedules.validTime(it) },
            ((o?.get("days") as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.content?.toIntOrNull() } ?: emptyList()).filter { it in 1..7 }.toSet())
            .takeIf { it.everyMinutes != null || it.dailyAt != null }
        "git-push" -> s(o, "repo")?.takeIf { it.contains('/') }?.let { RuleTrigger.GitPush(it, s(o, "branch")) }
        "note-tag" -> s(o, "tag")?.trim()?.trimStart('#')?.takeIf { it.isNotEmpty() }?.let { RuleTrigger.NoteTag(it) }
        "build-finished" -> RuleTrigger.BuildFinished
        else -> null
    }

    fun action(a: RuleAction): JsonObject = JsonObject(when (a) {
        is RuleAction.AskClaude -> mapOf("kind" to p("ask-claude"), "prompt" to p(a.prompt))
        is RuleAction.BuildRequest -> mapOf("kind" to p("build-request"))
        is RuleAction.ReadBack -> mapOf("kind" to p("read-back"), "speak" to JsonPrimitive(a.speak))
        is RuleAction.RunAction -> mapOf("kind" to p("run-action"), "spec" to p(a.spec))
    })

    fun action(o: JsonObject?): RuleAction? = when (s(o, "kind")) {
        "ask-claude" -> s(o, "prompt")?.let { RuleAction.AskClaude(it) }
        "build-request" -> RuleAction.BuildRequest
        "read-back" -> RuleAction.ReadBack(b(o, "speak") ?: true)
        "run-action" -> s(o, "spec")?.takeIf { it.isNotBlank() }?.let { RuleAction.RunAction(it) }
        else -> null
    }

    fun rule(r: AutomationRule): JsonObject = JsonObject(mapOf(
        "id" to p(r.id), "label" to p(r.label), "enabled" to JsonPrimitive(r.enabled), "trigger" to trigger(r.trigger), "action" to action(r.action), "cooldownMs" to JsonPrimitive(r.cooldownMs),
    ))

    fun rule(e: JsonElement?): AutomationRule? {
        val o = e as? JsonObject ?: return null
        val id = s(o, "id")?.takeIf { it.isNotBlank() } ?: return null
        val t = trigger(o["trigger"] as? JsonObject) ?: return null
        val a = action(o["action"] as? JsonObject) ?: return null
        return AutomationRule(id, s(o, "label") ?: id, b(o, "enabled") ?: false, t, a, n(o, "cooldownMs")?.takeIf { it >= 0 } ?: 30_000)
    }

    fun rules(e: JsonElement?): List<AutomationRule> = (e as? JsonArray)?.mapNotNull { rule(it) } ?: emptyList()
    fun rulesJson(rs: List<AutomationRule>): JsonArray = JsonArray(rs.map { rule(it) })

    fun memory(m: Map<String, RuleMemory>): JsonObject = JsonObject(m.mapValues { (_, v) ->
        JsonObject(buildMap<String, JsonElement> {
            v.lastFiredAt?.let { put("lastFiredAt", JsonPrimitive(it)) }; v.armedAt?.let { put("armedAt", JsonPrimitive(it)) }
            v.lastSha?.let { put("lastSha", p(it)) }
            if (v.seenNotes.isNotEmpty()) put("seenNotes", JsonArray(v.seenNotes.map { p(it) }))
        })
    })

    fun memory(e: JsonElement?): Map<String, RuleMemory> = (e as? JsonObject)?.mapValues { (_, v) ->
        val o = v as? JsonObject
        RuleMemory(n(o, "lastFiredAt"), n(o, "armedAt"), s(o, "lastSha"), (o?.get("seenNotes") as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.content } ?: emptyList())
    } ?: emptyMap()

    /** Saved rules over the defaults: saved ones win by id; defaults added later appear (off unless they ship on). */
    fun merge(saved: List<AutomationRule>, defaults: List<AutomationRule> = DefaultRules.ALL): List<AutomationRule> =
        saved + defaults.filter { d -> saved.none { it.id == d.id } }
}

/** Voice rules as triggers@1 data: one trigger per enabled voice rule, firing `ai-automations.fire` with `{rule}`. */
object AutomationTriggers {
    const val ACTION_FIRE: String = "ai-automations.fire"
    const val ACTION_OPEN: String = "ai-automations.open"

    fun all(module: String, rules: List<AutomationRule>): List<Trigger> =
        listOf(Trigger("ai-automations.open", TriggerKinds.VOICE, TriggerSource.PERMANENT, module, "Open automations", listOf("open automations", "show automations"), ACTION_OPEN)) +
            rules.filter { it.enabled && it.trigger is RuleTrigger.Voice && Patterns.errors((it.trigger as RuleTrigger.Voice).phrase).isEmpty() }.map { r ->
                Trigger("ai-automations.rule-${slug(r.id)}", TriggerKinds.VOICE, TriggerSource.CUSTOM, module, r.label, listOf((r.trigger as RuleTrigger.Voice).phrase), ACTION_FIRE,
                    args = JsonObject(mapOf("rule" to JsonPrimitive(r.id))))
            }

    fun slug(id: String): String = id.lowercase().replace(Regex("[^a-z0-9-]+"), "-").trim('-').ifEmpty { "rule" }
}

/** The scheduler job (work@1): ticks every minute while automations are on; backs off while the hub is unreachable. */
object AutomationJob {
    const val ID: String = "ai-automations.tick"
    const val OK: String = "ok"
    const val OFFLINE: String = "offline"

    fun spec(module: String): JobSpec = JobSpec(
        id = ID, kind = "poll", interval = IntervalBounds(60_000, 15_000, 3_600_000),
        outcomes = mapOf(
            OK to OutcomeRule(DelayRule.Interval, endsSpell = true),
            OFFLINE to OutcomeRule(DelayRule.Exponential(60_000, DelayRule.DEFAULT_FACTOR, 15 * 60_000)),
            JobSpec.FALLBACK_OUTCOME to OutcomeRule(DelayRule.Interval),
        ),
        label = "AI automations", module = module,
    )
}
