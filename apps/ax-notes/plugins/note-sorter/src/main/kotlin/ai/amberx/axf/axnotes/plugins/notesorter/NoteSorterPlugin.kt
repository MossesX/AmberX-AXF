package ai.amberx.axf.axnotes.plugins.notesorter

import ai.amberx.axf.kernel.ai.AiModes
import ai.amberx.axf.kernel.ai.AiRequestInput
import ai.amberx.axf.kernel.asset.MenuItem
import ai.amberx.axf.kernel.contract.SettingKind
import ai.amberx.axf.kernel.contract.SettingSpec
import ai.amberx.axf.kernel.contract.SettingsGroup
import ai.amberx.axf.kernel.engine.ActionMeta
import ai.amberx.axf.kernel.module.ActionContribution
import ai.amberx.axf.kernel.module.BaseModule
import ai.amberx.axf.kernel.module.Capability
import ai.amberx.axf.kernel.module.ExtensionPoints
import ai.amberx.axf.kernel.module.MenuContribution
import ai.amberx.axf.kernel.module.ModuleContext
import ai.amberx.axf.kernel.module.SettingsContribution
import ai.amberx.axf.kernel.runtime.ToastKind
import ai.amberx.axf.kernel.triggers.Trigger
import ai.amberx.axf.kernel.triggers.TriggerKinds
import ai.amberx.axf.kernel.triggers.TriggerRegistry
import ai.amberx.axf.kernel.triggers.TriggerSource
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import java.time.ZoneId

/** Voice triggers (triggers@1 records, registered under the plugin's module id while it is installed). */
object SorterTriggers {
    fun all(module: String): List<Trigger> = listOf(
        Trigger("note-sorter.digest-daily", TriggerKinds.VOICE, TriggerSource.PERMANENT, module, "Today's digest", listOf("daily digest", "today's digest", "make my daily digest"),
            NoteSorterPlugin.ACTION_DIGEST, args = JsonObject(mapOf("period" to JsonPrimitive("daily")))),
        Trigger("note-sorter.digest-weekly", TriggerKinds.VOICE, TriggerSource.PERMANENT, module, "This week's digest", listOf("weekly digest", "this week's digest", "make my weekly digest"),
            NoteSorterPlugin.ACTION_DIGEST, args = JsonObject(mapOf("period" to JsonPrimitive("weekly")))),
        Trigger("note-sorter.sort-all", TriggerKinds.VOICE, TriggerSource.PERMANENT, module, "Sort my notes", listOf("sort my notes", "sort notes"), NoteSorterPlugin.ACTION_SORT_ALL),
    )
}

/**
 * Plugin note-sorter (plugin@1 `ai.amberx.axf.axnotes.note-sorter`, step s14 of build ax-notes). Watches the app's
 * `axnotes.notes.saved` and asks the AI (mode ai.chat, one JSON reply) for category, tags, title, summary and action
 * items; saves the result back through `axnotes.notes.save` (with `fileInto` = the lists to file it in) and turns action
 * items into to-dos through `axnotes.todos.add` on the chosen list. Learns from re-categorizations by hand (examples in
 * the prompt, and local rules when AI is unavailable). Daily / weekly digest note, written to be read aloud.
 *
 * All data on the phone is in the KV store under `note-sorter.`; settings are `note-sorter.*` in its own tab under
 * Settings → Plugins. Removing the plugin leaves the app as it was (the notes and to-dos it made stay yours).
 */
class NoteSorterPlugin : BaseModule(ID, "Note sorter") {
    override val version: String = "0.1.0"
    override val optionalDependsOn: List<String> = listOf("ai.amberx.axf.settings")
    override val provides: List<Capability> = listOf(Capability(CAPABILITY, "Sorts notes (category, tags, title, summary, to-dos) and writes digests"))

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val lock = Mutex()
    private var host: PluginHost? = null
    private var loop: Job? = null
    private val removers = ArrayList<() -> Unit>()
    /** notes the sorter just saved: their next `saved` echo sets the record's category instead of counting as a correction */
    private val echo = HashSet<String>()
    @Volatile private var forceUntil = 0L
    private val zone: ZoneId get() = ZoneId.systemDefault()
    private fun now() = System.currentTimeMillis()

    override fun register(ctx: ModuleContext) {
        val h = PluginHost(ctx, PREFIX)
        host = h
        fun action(aid: String, label: String, params: Boolean = false, fn: (JsonObject) -> Unit) =
            ctx.extensions.contribute(ExtensionPoints.ACTIONS, id, ActionContribution(aid, ActionMeta(label, module = id, params = params)) { a, c -> fn(ActionArgs.of(a, c.payload, c.extras)) })
        action(ACTION_SORT_ALL, "Sort all notes now") { sortAll() }
        action(ACTION_DIGEST, "Make a digest note", params = true) { a ->
            val period = DigestPeriod.of(ActionArgs.str(a, "period", "0")).takeIf { it != DigestPeriod.OFF } ?: DigestPeriod.DAILY
            scope.launch { if (!makeDigest(period, previous = false)) h.toast("Nothing to put in a digest yet.") }
        }
        action(ACTION_FORGET, "Forget the sorter's learned corrections") { scope.launch { lock.withLock { h.remove(K_CORRECTIONS) }; h.toast("The sorter forgot its corrections.") } }
        action(ACTION_PURGE, "Remove the note sorter's data") {
            scope.launch {
                val n = lock.withLock { h.purge() }
                h.toast("Note sorter data removed ($n item${if (n == 1) "" else "s"}). Your notes and to-dos stay.", ToastKind.SUCCESS)
            }
        }

        removers += h.watch(HostActions.NOTE_SAVED) { o -> NoteView.parse(o)?.let { n -> scope.launch { runCatching { onSaved(n) } } } }

        ctx.extensions.contribute(ExtensionPoints.SETTINGS, id, SettingsContribution(SettingsGroup(TAB, "Note sorter", "layers", id, order = 56, tab = TAB,
            description = "Sorts new and edited notes with AI (category, tags, title, summary, action items). Without AI it uses simple rules and what it learned from your re-categorizations.",
            settings = listOf(
                SettingSpec(PREFIX + K_AUTO, "Sort new and edited notes", SettingKind.TOGGLE, "Off: sort only when you ask", JsonPrimitive(true), icon = "layers"),
                SettingSpec(PREFIX + K_CATEGORIES, "Categories", SettingKind.TEXT, "Comma-separated. Notes are filed under these (and the ones the sorter has seen)", JsonPrimitive("")),
                SettingSpec(PREFIX + K_SUMMARY, "Summary length", SettingKind.CHOICE, "Summaries appear in the digest", JsonPrimitive(SummaryLength.SHORT.wire),
                    options = SummaryLength.entries.map { it.wire to it.label }),
                SettingSpec(PREFIX + K_TODO_LIST, "To-do list for action items", SettingKind.TEXT, "Action items become to-dos on this list (made if it doesn't exist)", JsonPrimitive(DEFAULT_TODO_LIST), icon = "check"),
                SettingSpec(PREFIX + K_DIGEST, "Digest", SettingKind.CHOICE, "A note summing up the day or the week, written to be read aloud", JsonPrimitive(DigestPeriod.OFF.wire),
                    options = listOf("off" to "Off", "daily" to "Daily", "weekly" to "Weekly"), icon = "star"),
                SettingSpec("${PREFIX}sortAllNow", "Sort all notes now", SettingKind.ACTION, "Also sorts notes written before the plugin was installed", target = ACTION_SORT_ALL, icon = "layers"),
                SettingSpec("${PREFIX}digestNow", "Make today's digest", SettingKind.ACTION, target = "$ACTION_DIGEST:daily", icon = "star"),
                SettingSpec("${PREFIX}forgetNow", "Forget learned corrections", SettingKind.ACTION, target = ACTION_FORGET),
                SettingSpec("${PREFIX}purgeNow", "Remove plugin data", SettingKind.ACTION, "Deletes what the sorter keeps on this phone (run before uninstalling). Your notes and to-dos stay", target = ACTION_PURGE, icon = "trash"),
            ))))

        // Menu hooks: application menu + nav menu.
        for (item in listOf(MenuItem("$TAB.sort", "Sort notes", "layers", action = ACTION_SORT_ALL), MenuItem("$TAB.digest", "Today's digest", "star", action = "$ACTION_DIGEST:daily"))) {
            ctx.extensions.contribute(ExtensionPoints.MENU_ITEMS, id, MenuContribution("app-menu", "default", item))
            ctx.extensions.contribute(ExtensionPoints.MENU_ITEMS, id, MenuContribution("nav-menu", "default", item))
        }

        ctx.service(TriggerRegistry::class)?.let { it.unregister(id); it.register(id, SorterTriggers.all(id)) }
    }

    override suspend fun start(ctx: ModuleContext) {
        loop = scope.launch {
            lock.withLock { state(); prune() }
            while (isActive) {
                runCatching { autoDigest() }
                delay(15 * 60_000L)
            }
        }
    }

    override suspend fun stop(ctx: ModuleContext) {
        for (r in removers) r()
        removers.clear()
        loop?.cancel()
        ctx.service(TriggerRegistry::class)?.unregister(id)
        scope.cancel()
    }

    // ------------------------------------------------------------------ data (KV under note-sorter.)

    private data class State(val enabledAt: Long, val lastDigestAt: Long?)

    private fun state(): State {
        val h = host!!
        val o = J.parse(h.get(K_STATE))
        if (o != null) return State(J.long(o, "enabledAt") ?: now(), J.long(o, "lastDigestAt"))
        return State(now(), now()).also { save(it) }
    }

    private fun save(s: State) = host!!.put(K_STATE, JsonObject(buildMap {
        put("enabledAt", JsonPrimitive(s.enabledAt)); if (s.lastDigestAt != null) put("lastDigestAt", JsonPrimitive(s.lastDigestAt))
    }).toString())

    private fun record(id: String): SortRecord? = SorterCodec.record(J.parse(host!!.get(K_REC + id)))
    private fun save(r: SortRecord) = host!!.put(K_REC + r.noteId, SorterCodec.record(r).toString())
    private fun records(): List<SortRecord> = host!!.keys(K_REC).mapNotNull { SorterCodec.record(J.parse(host!!.get(it))) }
    private fun corrections(): List<Correction> = SorterCodec.corrections(J.parse(host!!.get(K_CORRECTIONS)))

    /** Keeps the KV small: records older than [KEEP_DAYS] days go. */
    private fun prune() {
        val cut = now() - KEEP_DAYS * 86_400_000L
        for (r in records()) if (r.at < cut && r.createdAt < cut) host!!.remove(K_REC + r.noteId)
    }

    // ------------------------------------------------------------------ sorting

    private fun categories(): List<String> {
        val fromSetting = host!!.setting(K_CATEGORIES, "").split(',', '\n', ';').map { it.trim() }.filter { it.isNotEmpty() }
        val seen = records().map { it.category }.filter { it.isNotBlank() && it != "digest" }.map { Txt.nameOfSlug(it) }
        return (fromSetting + seen).distinctBy { Txt.slug(it) }.take(40)
    }

    private suspend fun onSaved(n: NoteView) = lock.withLock {
        val h = host ?: return@withLock
        val rec = record(n.id)
        if (Sorter.isDigest(n)) {
            if (rec == null) save(SortRecord(n.id, Sorter.textHash(n), n.category, n.title, "", emptyList(), n.createdAt, now(), digest = true))
            return@withLock
        }
        if (echo.remove(n.id) && rec != null && rec.textHash == Sorter.textHash(n)) { save(rec.copy(category = n.category)); return@withLock }
        Sorter.correction(n, rec, now())?.let { (r, c) ->
            save(r)
            h.put(K_CORRECTIONS, SorterCodec.corrections(Learning.add(corrections(), c)).toString())
            return@withLock
        }
        val forced = now() < forceUntil
        if (!forced && !h.setting(K_AUTO, true)) return@withLock
        if (Sorter.needsSort(n, rec, if (forced) 0L else state().enabledAt)) sortNote(n, rec)
    }

    /** Sorts every note: asks the app to announce them all again (`axnotes.notes.announce`), sorting each as it comes. */
    private fun sortAll() {
        val h = host ?: return
        forceUntil = now() + 120_000L
        if (!h.dispatchIfHandled(HostActions.ANNOUNCE, JsonObject(mapOf("by" to JsonPrimitive(id))))) h.toast("Sorting notes as they're saved (this app can't list older notes yet).")
        else h.toast("Sorting your notes…")
    }

    /** Sorts one note (lock held). AI first; local rules when AI isn't there or its reply can't be used. */
    private suspend fun sortNote(n: NoteView, rec: SortRecord?) {
        val h = host!!
        val cats = categories()
        val len = SummaryLength.of(h.setting(K_SUMMARY, SummaryLength.SHORT.wire))
        val corr = corrections()
        val ai = h.ai()
        val res = (if (ai.available()) ai.ask(AiRequestInput(SorterPrompt.build(n.text, cats, corr, len.words), requested = AiModes.CHAT, title = "Sort note"), timeoutMs = 45_000)
            .getOrNull()?.let { SorterReply.parse(it, len.words) } else null)
            ?: LocalSorter.sort(n.text, cats, corr, len.words)

        val keep = Sorter.userCategory(n, rec)
        val category = Sorter.categoryAfter(n, res, keep)
        val catName = if (category.isBlank()) null else res.category.takeIf { !keep && it.isNotBlank() } ?: Txt.nameOfSlug(category)
        var sent = rec?.actions ?: emptyList()
        if (h.has(HostActions.ADD_TODO)) {
            val list = h.setting(K_TODO_LIST, DEFAULT_TODO_LIST).trim().ifEmpty { DEFAULT_TODO_LIST }
            val fresh = ActionItems.newOnes(res.actions, sent)
            for (a in fresh) h.dispatchIfHandled(HostActions.ADD_TODO, Sorter.todoPayload(list, a, n.id, catName))
            sent = (sent + fresh).takeLast(50)
        }
        // Record first: the save below makes the app announce the note again.
        save(SortRecord(n.id, Sorter.textHash(n), category, Sorter.updatePayload(n, res, keep)?.let { J.str(it, "title") } ?: n.title, res.summary, sent,
            n.createdAt.takeIf { it > 0 } ?: now(), now(), userSet = keep))
        Sorter.updatePayload(n, res, keep)?.let { p -> echo += n.id; if (!h.dispatchIfHandled(HostActions.SAVE_NOTE, p)) echo -= n.id }
    }

    // ------------------------------------------------------------------ digest

    private suspend fun autoDigest() {
        val h = host ?: return
        val period = DigestPeriod.of(h.setting(K_DIGEST, DigestPeriod.OFF.wire))
        if (period == DigestPeriod.OFF) return
        if (lock.withLock { Digest.due(state().lastDigestAt, now(), period, zone) }) makeDigest(period, previous = true)
    }

    /** Writes a digest note; false when there was nothing to tell (or the app can't save notes). */
    private suspend fun makeDigest(period: DigestPeriod, previous: Boolean): Boolean {
        val h = host ?: return false
        val out = lock.withLock {
            val t = now()
            save(state().copy(lastDigestAt = t))
            Digest.build(period, Digest.range(period, t, zone, previous), records())
        } ?: return false
        return h.dispatchIfHandled(HostActions.SAVE_NOTE, Digest.payload(out))
    }

    companion object {
        const val ID: String = "ai.amberx.axf.axnotes.note-sorter"
        const val CAPABILITY: String = "axnotes.note-sorter"
        const val PREFIX: String = "note-sorter."
        const val TAB: String = "note-sorter"
        const val ACTION_SORT_ALL: String = "note-sorter.sort-all"
        const val ACTION_DIGEST: String = "note-sorter.digest"
        const val ACTION_FORGET: String = "note-sorter.forget"
        const val ACTION_PURGE: String = "note-sorter.purge"
        const val K_AUTO = "autoSort"
        const val K_CATEGORIES = "categories"
        const val K_SUMMARY = "summaryLength"
        const val K_TODO_LIST = "todoList"
        const val K_DIGEST = "digest"
        const val K_STATE = "state"
        const val K_REC = "rec."
        const val K_CORRECTIONS = "corrections"
        const val DEFAULT_TODO_LIST = "To-do"
        const val KEEP_DAYS = 120L
    }
}
