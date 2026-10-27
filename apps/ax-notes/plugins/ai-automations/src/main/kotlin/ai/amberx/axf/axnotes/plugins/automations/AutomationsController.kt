package ai.amberx.axf.axnotes.plugins.automations

import ai.amberx.axf.kernel.ai.AiModes
import ai.amberx.axf.kernel.ai.AiRequestInput
import ai.amberx.axf.kernel.live.LiveKinds
import ai.amberx.axf.kernel.result.AxfFailure
import ai.amberx.axf.kernel.result.AxfResult
import ai.amberx.axf.kernel.speech.SpeakOptions
import ai.amberx.axf.kernel.triggers.TriggerRegistry
import ai.amberx.axf.kernel.work.JobEffect
import ai.amberx.axf.kernel.work.JobEvent
import ai.amberx.axf.kernel.work.JobPhase
import ai.amberx.axf.kernel.work.RunCondition
import ai.amberx.axf.kernel.work.WorkEngine
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import java.util.TimeZone

/** Where a watched repo's head comes from. Polled through the AI/hub session until axHub has a git feed API. */
internal fun interface GitFeed {
    suspend fun head(repo: String, branch: String?): AxfResult<String?>
}

/**
 * Feeds signals into [AutomationEngine] and carries out what fires. The scheduler is the kernel's work@1 state machine
 * ([AutomationJob] through [WorkEngine]) run in-process while the app is alive; the same spec is offered on
 * `axf.workers` for a background host. Rules, memory and nothing else live in the KV store under this plugin's prefix.
 */
internal class AutomationsController(
    private val host: PluginHost,
    private val scope: CoroutineScope,
    private val module: String,
    private val triggers: TriggerRegistry?,
    private val clock: () -> Long = System::currentTimeMillis,
) {
    private val _rules = MutableStateFlow(load())
    val rules: StateFlow<List<AutomationRule>> = _rules.asStateFlow()
    private val _log = MutableStateFlow<List<String>>(emptyList())
    val log: StateFlow<List<String>> = _log.asStateFlow()
    private var memory: Map<String, RuleMemory> = runCatching { RuleCodec.memory(host.getString(KEY_MEMORY)?.let { PluginHost.json.parseToJsonElement(it) }) }.getOrDefault(emptyMap())
    private var loop: Job? = null
    private val kick = MutableStateFlow(0L)
    private var lastGitPoll = 0L
    /** git heads come from the hub session (a read-only ai.chat turn) until axHub offers a git feed */
    var gitFeed: GitFeed = GitFeed { repo, branch -> askHead(repo, branch) }

    val spec = AutomationJob.spec(module).copy(conditions = listOf(RunCondition(FLAG_ON)))

    fun on(): Boolean = host.setting(KEY_ENABLED, true)

    fun setEnabled(id: String, enabled: Boolean) {
        _rules.update { l -> l.map { if (it.id == id) it.copy(enabled = enabled) else it } }
        host.putString(KEY_RULES, RuleCodec.rulesJson(_rules.value).toString())
        registerVoice()
        note("${_rules.value.firstOrNull { it.id == id }?.label ?: id}: ${if (enabled) "on" else "off"}")
        wake()
    }

    fun registerVoice() {
        val reg = triggers ?: return
        reg.unregister(module)
        reg.register(module, AutomationTriggers.all(module, _rules.value))
    }

    /** One signal in: evaluate, remember, carry out what fired. */
    fun signal(s: Signal) {
        if (!on()) return
        val ev = synchronized(this) {
            AutomationEngine.evaluate(_rules.value, s, memory).also { memory = it.memory; host.putString(KEY_MEMORY, RuleCodec.memory(it.memory).toString()) }
        }
        for (f in ev.firings) scope.launch { execute(f) }
    }

    private suspend fun execute(f: Firing) {
        val label = _rules.value.firstOrNull { it.id == f.ruleId }?.label ?: f.ruleId
        when (val a = f.action) {
            is RuleAction.AskClaude -> {
                val prompt = Templates.expand(a.prompt, f.vars)
                if (prompt.isBlank()) { note("$label: nothing to ask"); return }
                ask(prompt)
                    .onOk { reply -> note(if (host.saveNote(ReadBackNote.reply(label, prompt, reply))) "$label: Claude's reply saved as a note" else "$label: Claude replied (the app can't save notes from plugins)") }
                    .onErr { note("$label: ${it.message}") }
            }
            is RuleAction.BuildRequest -> {
                val payload = JsonObject(buildMap<String, JsonElement> {
                    put("text", JsonPrimitive(f.vars["text"].orEmpty())); put("source", JsonPrimitive("note"))
                    f.vars["title"]?.takeIf { it.isNotBlank() }?.let { put("title", JsonPrimitive(it)) }
                    f.vars["noteId"]?.takeIf { it.isNotBlank() }?.let { put("noteId", JsonPrimitive(it)) }
                })
                note(if (host.dispatchIfHandled(ACTION_BRIDGE_REQUEST, payload)) "$label: sent to the build bridge" else "$label: the AI build bridge plugin isn't installed")
            }
            is RuleAction.ReadBack -> {
                val saved = host.saveNote(ReadBackNote.draft(f.vars))
                if (a.speak) host.speech().speak(ReadBackNote.spoken(f.vars), SpeakOptions())
                note("$label: ${if (saved) "summary note saved" else "summary ready (no note action in this app)"}")
            }
            is RuleAction.RunAction -> {
                val rt = host.runtime
                val id = a.spec.substringBefore(':')
                note(if (rt != null && rt.actions.has(id) && rt.dispatch(a.spec).isOk) "$label: ran ${a.spec}" else "$label: no handler for ${a.spec}")
            }
        }
    }

    /** One ai.chat turn on the hub session host; the reply text, or why not. */
    private suspend fun ask(prompt: String): AxfResult<String> {
        val ai = host.ai()
        if (!ai.available()) return AxfResult.err(AxfFailure.Unavailable("The assistant isn't connected (axHub)."))
        val req = AiModes.buildRequest(host.modes(), host.policy(), emptyList(), AiRequestInput(prompt, requested = AiModes.CHAT, title = "Automation: " + prompt.take(40))).request
            ?: return AxfResult.err(AxfFailure.Denied("ai.chat"))
        val info = when (val r = ai.start(req)) { is AxfResult.Ok -> r.value; is AxfResult.Err -> return r }
        val text = StringBuilder()
        var after = 0L
        val deadline = clock() + ASK_TIMEOUT_MS
        try {
            while (clock() < deadline) {
                val replay = ai.stream(info.id, after).getOrNull()
                if (replay != null) for (e in replay.events) {
                    after = maxOf(after, e.seq)
                    val d = e.data as? JsonObject
                    when (e.kind) {
                        "text" -> text.append((d?.get("text") as? JsonPrimitive)?.content ?: "")
                        "error" -> return AxfResult.err(AxfFailure.Unavailable((d?.get("message") as? JsonPrimitive)?.content ?: "The assistant failed."))
                        LiveKinds.TURN_END, "done", LiveKinds.CLOSE -> return AxfResult.ok(text.toString().trim())
                    }
                }
                delay(ASK_POLL_MS)
            }
        } finally { ai.close(info.id) }
        return if (text.isNotBlank()) AxfResult.ok(text.toString().trim()) else AxfResult.err(AxfFailure.Unavailable("No reply in time."))
    }

    private suspend fun askHead(repo: String, branch: String?): AxfResult<String?> =
        ask("Reply with only the full 40-character SHA of the latest commit on ${branch ?: "the default branch"} of the GitHub repository $repo. Nothing else.")
            .map { reply -> SHA.find(reply)?.value?.lowercase() }

    /** Starts (or re-plans) the scheduler loop. */
    fun wake() {
        kick.value = kick.value + 1
        if (loop?.isActive == true) return
        loop = scope.launch {
            var state = WorkEngine.initialState(spec)
            var event: JobEvent = JobEvent.Start(checkNow = true)
            while (isActive) {
                val step = WorkEngine.reduce(spec, state, event, mapOf(FLAG_ON to on()))
                state = step.state
                var nextEvent: JobEvent? = null
                for (fx in step.effects) when (fx) {
                    is JobEffect.Run -> nextEvent = JobEvent.Outcome(tick())
                    is JobEffect.Sleep -> {
                        val seen = kick.value
                        withTimeoutOrNull(fx.ms) { kick.first { it != seen } }
                        nextEvent = JobEvent.Wake
                    }
                    else -> Unit
                }
                if (state.phase == JobPhase.STOPPED || nextEvent == null) break
                event = nextEvent
            }
        }
    }

    /** One run of the job body (for a background host on `axf.workers`); returns the outcome. */
    suspend fun runOnce(): String = if (on()) tick() else AutomationJob.OK

    /** The job body: a tick for schedules, then (every [GIT_EVERY_MS]) the watched repos. */
    private suspend fun tick(): String {
        val now = clock()
        signal(Signal.Tick(now, TimeZone.getDefault().getOffset(now) / 60_000))
        val repos = _rules.value.filter { it.enabled }.mapNotNull { it.trigger as? RuleTrigger.GitPush }.distinctBy { it.repo.lowercase() to it.branch }
        if (repos.isEmpty() || now - lastGitPoll < GIT_EVERY_MS) return AutomationJob.OK
        lastGitPoll = now
        var offline = false
        for (r in repos) gitFeed.head(r.repo, r.branch)
            .onOk { sha -> if (sha != null) signal(Signal.GitHead(r.repo, r.branch, sha, clock())) }
            .onErr { offline = true; note("${r.repo}: can't read the latest push (${it.message})") }
        return if (offline) AutomationJob.OFFLINE else AutomationJob.OK
    }

    fun purge(): Int {
        loop?.cancel()
        triggers?.unregister(module)
        memory = emptyMap()
        _rules.value = DefaultRules.ALL
        return host.purge()
    }

    private fun note(line: String) { _log.update { (listOf(line) + it).take(50) } }

    private fun load(): List<AutomationRule> =
        RuleCodec.merge(runCatching { RuleCodec.rules(host.getString(KEY_RULES)?.let { PluginHost.json.parseToJsonElement(it) }) }.getOrDefault(emptyList()))

    companion object {
        const val KEY_RULES: String = "rules"
        const val KEY_MEMORY: String = "memory"
        const val KEY_ENABLED: String = "enabled"
        const val FLAG_ON: String = "ai-automations.enabled"
        const val ACTION_BRIDGE_REQUEST: String = "ai-build-bridge.request"
        const val HOOK_BUILD_FINISHED: String = "ai-build-bridge.finished"
        const val ASK_TIMEOUT_MS: Long = 120_000
        const val ASK_POLL_MS: Long = 1_500
        const val GIT_EVERY_MS: Long = 15 * 60_000
        private val SHA = Regex("\\b[0-9a-fA-F]{40}\\b")
    }
}
