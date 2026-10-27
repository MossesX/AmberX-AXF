package ai.amberx.axf.axnotes.plugins.notesorter

import ai.amberx.axf.axnotes.AppModule
import ai.amberx.axf.axnotes.model.Categories
import ai.amberx.axf.axnotes.model.ListKind
import ai.amberx.axf.axnotes.model.ListRules
import ai.amberx.axf.axnotes.model.Note
import ai.amberx.axf.axnotes.model.NoteList
import ai.amberx.axf.axnotes.model.NoteSource
import ai.amberx.axf.axnotes.pluginhost.ActionArgs
import ai.amberx.axf.axnotes.pluginhost.AxNotesPlugin
import ai.amberx.axf.axnotes.pluginhost.J
import ai.amberx.axf.axnotes.pluginhost.PluginData
import ai.amberx.axf.axnotes.pluginhost.PluginFootprint
import ai.amberx.axf.axnotes.pluginhost.PluginHostModule
import ai.amberx.axf.axnotes.pluginhost.PluginKit
import ai.amberx.axf.axnotes.views.Selection
import ai.amberx.axf.kernel.ai.AiModes
import ai.amberx.axf.kernel.ai.AiRequestInput
import ai.amberx.axf.kernel.asset.MenuItem
import ai.amberx.axf.kernel.contract.SettingKind
import ai.amberx.axf.kernel.contract.SettingScope
import ai.amberx.axf.kernel.contract.SettingSpec
import ai.amberx.axf.kernel.contract.SettingsGroup
import ai.amberx.axf.kernel.engine.ActionMeta
import ai.amberx.axf.kernel.module.ActionContribution
import ai.amberx.axf.kernel.module.BaseModule
import ai.amberx.axf.kernel.module.Capability
import ai.amberx.axf.kernel.module.ExtensionPoints
import ai.amberx.axf.kernel.module.ModuleContext
import ai.amberx.axf.kernel.module.SettingsContribution
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import java.time.ZoneId

/**
 * Plugin note-sorter (ai.amberx.axf.axnotes.plugins.note-sorter). Watches new and edited notes and asks the AI
 * (mode ai.chat, one JSON reply) for category, tags, title, summary and action items; files the note into matching
 * lists and turns action items into to-dos on the chosen to-do list. Learns from re-categorizations by hand (kept as
 * examples in the prompt and used by the local rules when AI isn't available). Daily / weekly digest note.
 *
 * Everything it keeps is in its own data module ([DATA]); its settings live in its own tab under Settings → Plugins.
 * Removing it (uninstall.mjs) leaves the app working; the host purges its data on the next launch.
 */
class NoteSorterModule : BaseModule(ID, "Note sorter"), AxNotesPlugin {
    override val dependsOn: List<String> = listOf(PluginHostModule.ID, AppModule.ID)
    override val provides: List<Capability> = listOf(Capability(SERVICE, "Sorts notes (category, tags, title, summary, to-dos) and writes digests"))
    override val footprint: PluginFootprint = PluginFootprint(ID, FOLDER, DATA, SETTING_KEYS, emptyList(), ID)

    private lateinit var kit: PluginKit
    private var ctx: ModuleContext? = null
    private val lock = Mutex()
    private var jobs: List<Job> = emptyList()
    private var records: MutableMap<String, SortRecord>? = null
    private var corrections: List<Correction>? = null
    private var state: State? = null
    private val zone: ZoneId get() = ZoneId.systemDefault()
    private fun now() = System.currentTimeMillis()

    private data class State(val enabledAt: Long, val lastDigestAt: Long?)

    override fun register(ctx: ModuleContext) {
        this.ctx = ctx
        kit = ctx.require(PluginKit::class)
        fun action(id: String, label: String, params: Boolean = false, run: (JsonObject) -> Unit) =
            ctx.extensions.contribute(ExtensionPoints.ACTIONS, this.id, ActionContribution(id, ActionMeta(label, module = this.id, params = params)) { a, c -> run(ActionArgs.of(a, c)) })
        action(ACTION_SORT_ALL, "Sort all notes now") { kit.scope.launch(Dispatchers.IO) { sortAll() } }
        action(ACTION_DIGEST, "Make a digest note", params = true) { a ->
            val period = DigestPeriod.of(ActionArgs.str(a, "period", "0")).takeIf { it != DigestPeriod.OFF } ?: DigestPeriod.DAILY
            kit.scope.launch(Dispatchers.IO) { if (!makeDigest(period, previous = false, open = true)) kit.toast("Nothing to put in a digest yet.") }
        }
        action(ACTION_FORGET, "Forget the sorter's learned corrections") { kit.scope.launch(Dispatchers.IO) { lock.withLock { corrections = emptyList(); data().delete(COL_CORRECTIONS, "all") }; kit.toast("The sorter forgot its corrections.") } }
        action(ACTION_PURGE, "Remove the note sorter's data") {
            kit.scope.launch(Dispatchers.IO) {
                lock.withLock { kit.purge(footprint); records = null; corrections = null; state = null }
                kit.toast("Note sorter data removed from this phone. Uninstall the plugin to remove its code.")
            }
        }

        ctx.extensions.contribute(ExtensionPoints.SETTINGS, id, SettingsContribution(SettingsGroup(
            "axnotes.plugin.$FOLDER", "Note sorter", "layers", id, order = 60, tab = FOLDER,
            description = "Sorts new and edited notes with AI (category, tags, title, summary, action items). Without AI it uses simple rules and what it learned from your re-categorizations.",
            settings = listOf(
                SettingSpec(KEY_AUTO, "Sort new and edited notes", SettingKind.TOGGLE, "Off: sort only when you ask", JsonPrimitive(true), SettingScope.APP, icon = "layers"),
                SettingSpec(KEY_CATEGORIES, "Categories", SettingKind.TEXT, "Comma-separated. Notes are filed under these and the categories you already have", JsonPrimitive(""), SettingScope.APP),
                SettingSpec(KEY_SUMMARY, "Summary length", SettingKind.CHOICE, "Summaries appear in the digest", JsonPrimitive(SummaryLength.SHORT.wire), SettingScope.APP,
                    options = SummaryLength.entries.map { it.wire to it.label }),
                SettingSpec(KEY_TODO_LIST, "To-do list for action items", SettingKind.TEXT, "Action items become to-dos on this list (made if it doesn't exist)", JsonPrimitive(DEFAULT_TODO_LIST), SettingScope.APP, icon = "check"),
                SettingSpec(KEY_DIGEST, "Digest", SettingKind.CHOICE, "A note summing up the day or the week, written to be read aloud", JsonPrimitive(DigestPeriod.OFF.wire), SettingScope.APP,
                    options = listOf("off" to "Off", "daily" to "Daily", "weekly" to "Weekly"), icon = "star"),
                SettingSpec("$KEY_PREFIX.sortAllNow", "Sort all notes now", SettingKind.ACTION, "Also sorts notes written before the plugin was installed", target = ACTION_SORT_ALL, icon = "layers"),
                SettingSpec("$KEY_PREFIX.digestNow", "Make today's digest", SettingKind.ACTION, target = "$ACTION_DIGEST:daily", icon = "star"),
                SettingSpec("$KEY_PREFIX.forgetNow", "Forget learned corrections", SettingKind.ACTION, target = ACTION_FORGET),
                SettingSpec("$KEY_PREFIX.purgeNow", "Remove this plugin's data", SettingKind.ACTION,
                    "Deletes the sorter's records, corrections and settings on this phone. Your notes, categories and to-dos stay", target = ACTION_PURGE),
            ),
        )))

        // Menu hooks: application menu + nav menu.
        kit.menus(id, listOf(
            MenuItem("$FOLDER.sortAll", "Sort notes", "layers", ACTION_SORT_ALL),
            MenuItem("$FOLDER.digest", "Today's digest", "star", "$ACTION_DIGEST:daily"),
        ))
    }

    override suspend fun start(ctx: ModuleContext) {
        kit.registerTriggers(id, TRIGGERS_ASSET)
        val store = kit.store
        jobs = listOf(
            kit.scope.launch(Dispatchers.IO) {
                store.loaded.first { it }
                store.notes.collectLatest { notes ->
                    delay(1500) // let typing settle; a newer emission cancels this one
                    runCatching { onNotes(notes) }.onFailure { kit.log(id).w("Sorting failed", it) }
                }
            },
            kit.scope.launch(Dispatchers.IO) {
                store.loaded.first { it }
                while (isActive) {
                    runCatching { autoDigest() }.onFailure { kit.log(id).w("Digest failed", it) }
                    delay(15 * 60_000L)
                }
            },
        )
    }

    override suspend fun stop(ctx: ModuleContext) { jobs.forEach { it.cancel() }; jobs = emptyList() }

    // ------------------------------------------------------------------ data

    private fun data(): PluginData = kit.data(footprint)

    private fun loadRecords(): MutableMap<String, SortRecord> = records ?: data().ids(COL_RECORDS).mapNotNull { data().read(COL_RECORDS, it)?.let(SorterCodec::record) }
        .associateBy { it.noteId }.toMutableMap().also { records = it }

    private fun saveRecord(r: SortRecord) { loadRecords()[r.noteId] = r; data().write(COL_RECORDS, r.noteId, SorterCodec.record(r)) }

    private fun loadCorrections(): List<Correction> = corrections ?: SorterCodec.corrections(data().read(COL_CORRECTIONS, "all")).also { corrections = it }

    private fun loadState(): State = state ?: run {
        val o = data().read(COL_STATE, "main")
        val s = if (o == null) State(now(), now()) else State(J.long(o, "enabledAt") ?: now(), J.long(o, "lastDigestAt"))
        if (o == null) saveState(s)
        state = s
        s
    }

    private fun saveState(s: State) {
        state = s
        data().write(COL_STATE, "main", JsonObject(buildMap {
            put("enabledAt", JsonPrimitive(s.enabledAt))
            if (s.lastDigestAt != null) put("lastDigestAt", JsonPrimitive(s.lastDigestAt))
        }))
    }

    // ------------------------------------------------------------------ sorting

    private fun summaryLength() = SummaryLength.of(kit.setting(KEY_SUMMARY, SummaryLength.SHORT.wire))

    private fun settingCategories(): List<String> =
        kit.setting(KEY_CATEGORIES, "").split(',', '\n', ';').map { it.trim() }.filter { it.isNotEmpty() }.distinctBy { Categories.slug(it) }.take(40)

    private fun categoryNames(): List<String> {
        val store = kit.store
        for (c in settingCategories()) store.ensureCategory(c)
        return store.categories.value.sortedBy { it.order }.map { it.name }
    }

    private suspend fun onNotes(notes: List<Note>) = lock.withLock {
        val store = kit.store
        val recs = loadRecords()
        // Learn: a note the sorter filed whose category was changed by hand (same text).
        for ((rec, corr) in Sorter.corrections(notes, recs, store.categories.value, now())) {
            saveRecord(rec)
            corrections = Learning.add(loadCorrections(), corr)
            data().write(COL_CORRECTIONS, "all", SorterCodec.corrections(corrections!!))
        }
        if (!kit.settingBool(KEY_AUTO, true)) return@withLock
        for (n in Sorter.pending(notes, recs, loadState().enabledAt).take(MAX_PER_PASS)) sortNote(n)
    }

    private suspend fun sortAll() {
        val notes = kit.store.notes.value
        var n = 0
        lock.withLock { for (note in Sorter.pending(notes, loadRecords(), 0L)) { sortNote(note); n++ } }
        kit.toast(if (n == 0) "All notes are sorted." else "Sorted $n note(s).")
    }

    /** Sorts one note (lock held). AI first, local rules when AI isn't there or its reply can't be used. */
    private suspend fun sortNote(n: Note) {
        val store = kit.store
        val prev = loadRecords()[n.id]
        val cats = categoryNames()
        val len = summaryLength()
        val corr = loadCorrections()
        val ai = kit.ai()
        val res = (if (ai.available()) ai.ask(AiRequestInput(SorterPrompt.build(n.text, cats, corr, len.words), requested = AiModes.CHAT, title = "Sort note"), timeoutMs = 45_000)
            .getOrNull()?.let { SorterReply.parse(it, len.words) } else null)
            ?: LocalSorter.sort(n.text, cats, corr, len.words)

        val current = store.note(n.id) ?: return
        if (Sorter.textHash(current) != Sorter.textHash(n)) return // edited meanwhile: the next pass sorts the new text
        // A category the user chose (when writing, or by hand after the last sort) is kept.
        val userCategory = Sorter.userCategory(current, prev)
        val category = when {
            userCategory -> current.category
            res.category.isNotBlank() -> store.ensureCategory(res.category).id
            else -> current.category
        }
        val categoryName = if (category.isBlank()) "" else Categories.nameOf(category, store.categories.value)
        val filed = Filing.listsFor(categoryName, res.tags + current.tags, store.lists.value, current.listIds)
        val updated = current.copy(
            category = category,
            tags = Sorter.mergeTags(current.tags, res.tags),
            title = if (Sorter.keepsTitle(current) || res.title.isBlank()) current.title else res.title,
            listIds = current.listIds + filed,
        )
        if (updated != current) store.saveNote(updated)

        var made = prev?.actions ?: emptyList()
        val target = todoList()
        if (target != null) {
            val fresh = ActionItems.newOnes(res.actions, target.items, made)
            for (a in fresh) store.addTodo(target.id, a, categoryName = categoryName.takeIf { it.isNotBlank() })?.let { store.attachNote(target.id, it.id, n.id) }
            made = (made + fresh).takeLast(50)
        }
        saveRecord(SortRecord(n.id, Sorter.textHash(current), category, res.summary, made, now(), userSet = userCategory))
    }

    /** The chosen to-do list (by name), made when it doesn't exist. */
    private fun todoList(): NoteList? {
        val store = kit.store
        val name = kit.setting(KEY_TODO_LIST, DEFAULT_TODO_LIST).trim().ifEmpty { DEFAULT_TODO_LIST }
        return ListRules.findList(name, store.lists.value, ListKind.TODO) ?: store.createList(name, ListKind.TODO)
    }

    // ------------------------------------------------------------------ digest

    private suspend fun autoDigest() {
        val period = DigestPeriod.of(kit.setting(KEY_DIGEST, DigestPeriod.OFF.wire))
        if (period == DigestPeriod.OFF) return
        val due = lock.withLock { Digest.due(loadState().lastDigestAt, now(), period, zone) }
        if (due) makeDigest(period, previous = true, open = false)
    }

    /** Writes a digest note; false when there was nothing to tell. [previous]: the day / week that just ended. */
    private suspend fun makeDigest(period: DigestPeriod, previous: Boolean, open: Boolean): Boolean {
        val store = kit.store
        val note = lock.withLock {
            val t = now()
            val range = Digest.range(period, t, zone, previous)
            val out = Digest.build(period, range, store.notes.value, loadRecords().mapValues { it.value.summary }, store.lists.value, store.categories.value)
            saveState(loadState().copy(lastDigestAt = t))
            out?.let { store.createNote(it.text, it.title, Digest.CATEGORY, listOf(Digest.TAG), NoteSource.AI) }
        } ?: return false
        if (open) {
            ctx?.service(Selection::class)?.editNote(note.id)
            kit.runtime?.navigate(Selection.ROUTE_EDITOR)
        }
        return true
    }

    companion object {
        const val ID = "ai.amberx.axf.axnotes.plugins.note-sorter"
        const val FOLDER = "note-sorter"
        const val DATA = "ai.amberx.axf.axnotes.plugin.note-sorter"
        const val SERVICE = "axnotes.sorter@1"
        const val TRIGGERS_ASSET = "axnotes/plugins/note-sorter/triggers.json"
        const val KEY_PREFIX = "app.notesorter"
        const val KEY_AUTO = "$KEY_PREFIX.autoSort"
        const val KEY_CATEGORIES = "$KEY_PREFIX.categories"
        const val KEY_SUMMARY = "$KEY_PREFIX.summaryLength"
        const val KEY_TODO_LIST = "$KEY_PREFIX.todoList"
        const val KEY_DIGEST = "$KEY_PREFIX.digest"
        val SETTING_KEYS: List<String> = listOf(KEY_AUTO, KEY_CATEGORIES, KEY_SUMMARY, KEY_TODO_LIST, KEY_DIGEST)
        const val ACTION_SORT_ALL = "notesorter.sort-all"
        const val ACTION_DIGEST = "notesorter.digest"
        const val ACTION_FORGET = "notesorter.forget"
        const val ACTION_PURGE = "notesorter.purge"
        const val DEFAULT_TODO_LIST = "To-do"
        const val COL_RECORDS = "records"
        const val COL_CORRECTIONS = "corrections"
        const val COL_STATE = "state"
        const val MAX_PER_PASS = 10
    }
}
