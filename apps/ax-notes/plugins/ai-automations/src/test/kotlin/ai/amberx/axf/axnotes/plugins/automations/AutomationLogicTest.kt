package ai.amberx.axf.axnotes.plugins.automations

import ai.amberx.axf.kernel.triggers.MatchEnv
import ai.amberx.axf.kernel.triggers.Observation
import ai.amberx.axf.kernel.triggers.TriggerMatcher
import ai.amberx.axf.kernel.triggers.TriggerValidation
import ai.amberx.axf.kernel.work.JobEffect
import ai.amberx.axf.kernel.work.JobEvent
import ai.amberx.axf.kernel.work.WorkEngine
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.ZoneOffset

class AutomationLogicTest {
    private val ask = AutomationRule("ask", "Ask", true, RuleTrigger.NoteTag("ask"), RuleAction.AskClaude("{text}"))

    private fun run(rules: List<AutomationRule>, signals: List<Signal>, start: Map<String, RuleMemory> = emptyMap()): Pair<List<List<Firing>>, Map<String, RuleMemory>> {
        var mem = start
        val out = ArrayList<List<Firing>>()
        for (s in signals) { val e = AutomationEngine.evaluate(rules, s, mem); out += e.firings; mem = e.memory }
        return out to mem
    }

    private fun note(id: String, text: String, at: Long, tags: List<String> = emptyList()) = Signal.NoteSaved(id, "", text, tags, at)

    @Test fun askNotesFireOncePerNote() {
        val (fired, _) = run(listOf(ask), listOf(
            note("n1", "What is a monad? #ask", 0),
            note("n1", "What is a monad? #ask (edited)", 60_000),
            note("n2", "nothing here", 120_000),
            note("n3", "Explain coroutines", 180_000, tags = listOf("Ask")),
            note("n4", "#ask loop", 240_000, tags = listOf(AutomationEngine.OWN_TAG)),
        ))
        assertEquals(listOf(1, 0, 0, 1, 0), fired.map { it.size })
        assertEquals("What is a monad?", fired[0][0].vars["text"])
        assertEquals("n3", fired[3][0].vars["noteId"])
    }

    @Test fun disabledRulesAndCooldown() {
        assertTrue(run(listOf(ask.copy(enabled = false)), listOf(note("n1", "#ask x", 0))).first.single().isEmpty())
        val (fired, mem) = run(listOf(ask), listOf(note("n1", "#ask a", 0), note("n2", "#ask b", 10_000), note("n3", "#ask c", 40_000)))
        assertEquals(listOf(1, 0, 1), fired.map { it.size })
        assertEquals(listOf("n1", "n2", "n3"), mem["ask"]!!.seenNotes) // the one inside the cooldown is not retried
        assertEquals(40_000L, mem["ask"]!!.lastFiredAt)
    }

    @Test fun everyNMinutesCountsFromWhenItWasArmed() {
        val r = AutomationRule("five", "Five", true, RuleTrigger.Schedule(everyMinutes = 5), RuleAction.RunAction("x.y"))
        val m = 60_000L
        val (fired, _) = run(listOf(r), listOf(0L, 4 * m, 5 * m, 9 * m, 10 * m).map { Signal.Tick(it) })
        assertEquals(listOf(0, 0, 1, 0, 1), fired.map { it.size })
    }

    @Test fun dailyAtLocalTimeAndDays() {
        val tz = ZoneOffset.ofHours(2)
        fun at(d: Int, h: Int, min: Int) = LocalDateTime.of(2026, 10, d, h, min).toInstant(tz).toEpochMilli()
        fun tick(d: Int, h: Int, min: Int) = Signal.Tick(at(d, h, min), 120)
        val daily = AutomationRule("am", "AM", true, RuleTrigger.Schedule(dailyAt = "08:00"), RuleAction.AskClaude("brief"))
        val (fired, _) = run(listOf(daily), listOf(tick(26, 7, 0), tick(26, 7, 59), tick(26, 8, 0), tick(26, 8, 1), tick(27, 7, 59), tick(27, 8, 2)))
        assertEquals(listOf(0, 0, 1, 0, 0, 1), fired.map { it.size })
        // weekends only: Monday Oct 26 2026 never fires; Saturday Oct 31 does
        val weekend = daily.copy(trigger = RuleTrigger.Schedule(dailyAt = "08:00", days = setOf(6, 7)))
        val (w, _) = run(listOf(weekend), listOf(tick(26, 7, 0), tick(26, 9, 0), tick(30, 9, 0), tick(31, 8, 5)))
        assertEquals(listOf(0, 0, 0, 1), w.map { it.size })
        for (d in 24..31) assertEquals(LocalDate.of(2026, 10, d).dayOfWeek.value, Schedules.isoDay(LocalDate.of(2026, 10, d).atTime(12, 0).toInstant(ZoneOffset.UTC).toEpochMilli()))
    }

    @Test fun gitPushNeedsABaselineThenANewSha() {
        val r = AutomationRule("push", "Push", true, RuleTrigger.GitPush("MossesX/AmberX-AXF", "main"), RuleAction.AskClaude("Summarize {repo} {sha}"))
        val (fired, mem) = run(listOf(r), listOf(
            Signal.GitHead("mossesx/amberx-axf", "main", "a".repeat(40), 0),
            Signal.GitHead("MossesX/AmberX-AXF", "main", "a".repeat(40), 60_000),
            Signal.GitHead("MossesX/Other", "main", "b".repeat(40), 120_000),
            Signal.GitHead("MossesX/AmberX-AXF", "dev", "c".repeat(40), 180_000),
            Signal.GitHead("MossesX/AmberX-AXF", "main", "d".repeat(40), 240_000, "Fix sync"),
        ))
        assertEquals(listOf(0, 0, 0, 0, 1), fired.map { it.size })
        assertEquals("Summarize MossesX/AmberX-AXF ${"d".repeat(40)}", Templates.expand((r.action as RuleAction.AskClaude).prompt, fired[4][0].vars))
        assertEquals("d".repeat(40), mem["push"]!!.lastSha)
    }

    @Test fun finishedBuildsAreReadBack() {
        val r = DefaultRules.ALL.first { it.id == "build-finished" }
        val (fired, _) = run(listOf(r), listOf(Signal.BuildDone("Share button", "share-button", "done", "4 steps, all green", 0)))
        val f = fired.single().single()
        assertEquals(RuleAction.ReadBack(speak = true), f.action)
        val d = ReadBackNote.draft(f.vars)
        assertEquals("Build finished: Share button", (d["title"] as JsonPrimitive).content)
        assertEquals("Build done · share-button\n\n4 steps, all green", (d["text"] as JsonPrimitive).content)
        assertTrue((d["tags"] as JsonArray).any { (it as JsonPrimitive).content == AutomationEngine.OWN_TAG })
        assertEquals("Build finished: Share button. 4 steps, all green", ReadBackNote.spoken(f.vars))
    }

    @Test fun voiceRulesFireOnlyForTheirId() {
        val r = AutomationRule("status", "Status", true, RuleTrigger.Voice("status report"), RuleAction.AskClaude("status"))
        val (fired, _) = run(listOf(r), listOf(Signal.VoiceFired("other", null, 0), Signal.VoiceFired("status", null, 1)))
        assertEquals(listOf(0, 1), fired.map { it.size })
        val ts = AutomationTriggers.all(AutomationsPlugin.ID, listOf(r, r.copy(id = "off", enabled = false, trigger = RuleTrigger.Voice("never")), r.copy(id = "bad", trigger = RuleTrigger.Voice("<x>"))))
        assertEquals(listOf("ai-automations.open", "ai-automations.rule-status"), ts.map { it.id })
        for (t in ts) assertTrue(t.id, TriggerValidation.validate(t.toJson()).ok)
        val cmd = TriggerMatcher.match(ts, Observation("voice", 1_000, listOf("Status report")), MatchEnv("home")).fired!!
        assertEquals(AutomationTriggers.ACTION_FIRE, cmd.action)
        assertEquals("status", (cmd.args["rule"] as JsonPrimitive).content)
    }

    @Test fun memoryForgetsRemovedRules() {
        val (_, mem) = run(listOf(ask), listOf(note("n1", "#ask a", 0)), mapOf("gone" to RuleMemory(lastFiredAt = 1)))
        assertEquals(setOf("ask"), mem.keys)
    }

    @Test fun codecRoundTripsRulesAndMemory() {
        val extra = AutomationRule("w", "Weekend", true, RuleTrigger.Schedule(dailyAt = "9:30", days = setOf(7, 6)), RuleAction.RunAction("notes.open"), cooldownMs = 5)
        val rules = DefaultRules.ALL + extra
        assertEquals(rules, RuleCodec.rules(RuleCodec.rulesJson(rules)))
        val mem = mapOf("a" to RuleMemory(1, 2, "abc", listOf("n1")), "b" to RuleMemory())
        assertEquals(mem, RuleCodec.memory(RuleCodec.memory(mem)))
        assertEquals(null, RuleCodec.trigger(kotlinx.serialization.json.JsonObject(mapOf("kind" to JsonPrimitive("schedule"), "dailyAt" to JsonPrimitive("25:00")))))
        val merged = RuleCodec.merge(listOf(ask.copy(id = "ask-notes", enabled = false)))
        assertEquals(DefaultRules.ALL.size, merged.size)
        assertFalse(merged.first { it.id == "ask-notes" }.enabled)
    }

    @Test fun templatesAndTags() {
        assertEquals("Hi Brett", Templates.expand("Hi {name}{missing}", mapOf("name" to "Brett")))
        assertTrue(Tags.has(emptyList(), "#build", "do it #Build"))
        assertFalse(Tags.has(emptyList(), "build", "#buildings"))
        assertEquals("ship it now", Tags.strip("ship #build it now", "build"))
    }

    @Test fun theSchedulerJobIsValidWork() {
        val spec = AutomationJob.spec(AutomationsPlugin.ID)
        assertTrue(WorkEngine.validate(spec.toJson()).ok)
        val steps = WorkEngine.replay(spec, listOf(
            JobEvent.Start(checkNow = true) to emptyMap(), JobEvent.Outcome(AutomationJob.OK) to emptyMap(),
            JobEvent.Wake to emptyMap(), JobEvent.Outcome(AutomationJob.OFFLINE) to emptyMap(),
            JobEvent.Wake to emptyMap(), JobEvent.Outcome(AutomationJob.OFFLINE) to emptyMap(),
        ))
        val sleeps = steps.flatMap { it.effects }.filterIsInstance<JobEffect.Sleep>().map { it.ms }
        assertEquals(listOf(60_000L, 60_000L, 120_000L), sleeps)
    }
}
