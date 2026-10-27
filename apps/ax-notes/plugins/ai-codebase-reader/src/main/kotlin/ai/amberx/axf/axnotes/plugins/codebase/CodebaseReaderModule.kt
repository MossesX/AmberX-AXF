package ai.amberx.axf.axnotes.plugins.codebase

import ai.amberx.axf.axnotes.AppModule
import ai.amberx.axf.axnotes.model.Note
import ai.amberx.axf.axnotes.model.NoteSource
import ai.amberx.axf.axnotes.pluginhost.ActionArgs
import ai.amberx.axf.axnotes.pluginhost.AxNotesPlugin
import ai.amberx.axf.axnotes.pluginhost.PluginData
import ai.amberx.axf.axnotes.pluginhost.PluginFootprint
import ai.amberx.axf.axnotes.pluginhost.PluginHostModule
import ai.amberx.axf.axnotes.pluginhost.PluginKit
import ai.amberx.axf.axnotes.views.Selection
import ai.amberx.axf.kernel.ai.AiModes
import ai.amberx.axf.kernel.ai.AiRequestInput
import ai.amberx.axf.kernel.asset.MenuItem
import ai.amberx.axf.kernel.assistant.ChatContext
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
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import java.time.ZoneId

/**
 * Plugin ai-codebase-reader (ai.amberx.axf.axnotes.plugins.ai-codebase-reader), build steps s16 + s23.
 *
 * - Reads the allowed repos (read-only) through an AI session in mode ai.read-codebase: the session reads the repo on
 *   axHub, the plugin sends the request and parses the JSON reply into notes (architecture, changes since the last
 *   commit read) with CodeLinks that open on GitHub.
 * - Harvests TODO / FIXME comments into one to-do list per repo (stable ids, deduped, closed when the line is gone).
 * - Voice (triggers@1 data): "note on <file> [line <n>] [saying <text>]" attaches a note to a file / line; "ask about
 *   <file> [line <n>] [question <q>]" asks the AI about that code with the file's notes as context; the answer is saved
 *   as a note on that file.
 *
 * Its data (per-repo state) lives in its own data module; the per-repo TODO lists are generated and removed with it.
 */
class CodebaseReaderModule : BaseModule(ID, "AI codebase reader"), AxNotesPlugin {
    override val dependsOn: List<String> = listOf(PluginHostModule.ID, AppModule.ID)
    override val provides: List<Capability> = listOf(
        Capability(SERVICE, "Reads repos (read-only) into notes with code links"),
        Capability(SERVICE_TODOS, "TODO/FIXME harvest into per-repo to-do lists"),
    )
    override val footprint: PluginFootprint = PluginFootprint(ID, FOLDER, DATA, SETTING_KEYS, listOf(CodebaseNotes.LIST_PREFIX), ID)

    private lateinit var kit: PluginKit
    private var ctx: ModuleContext? = null
    private val lock = Mutex()
    private val zone: ZoneId get() = ZoneId.systemDefault()
    private fun now() = System.currentTimeMillis()

    override fun register(ctx: ModuleContext) {
        this.ctx = ctx
        kit = ctx.require(PluginKit::class)
        fun action(id: String, label: String, params: Boolean = false, run: (JsonObject) -> Unit) =
            ctx.extensions.contribute(ExtensionPoints.ACTIONS, this.id, ActionContribution(id, ActionMeta(label, module = this.id, params = params)) { a, c -> run(ActionArgs.of(a, c)) })
        action(ACTION_READ, "Read my repos into notes") { kit.scope.launch(Dispatchers.IO) { readAll() } }
        action(ACTION_NOTE_ON_FILE, "Note on a file", params = true) { a -> kit.scope.launch(Dispatchers.IO) { noteOnFile(a) } }
        action(ACTION_ASK, "Ask about a file", params = true) { a -> kit.scope.launch(Dispatchers.IO) { askAboutFile(a) } }
        action(ACTION_PURGE, "Remove the codebase reader's data") {
            kit.scope.launch(Dispatchers.IO) {
                lock.withLock { kit.purge(footprint) }
                kit.toast("Codebase reader data and TODO lists removed from this phone. Its notes stay. Uninstall the plugin to remove its code.")
            }
        }

        ctx.extensions.contribute(ExtensionPoints.SETTINGS, id, SettingsContribution(SettingsGroup(
            "axnotes.plugin.$FOLDER", "Codebase reader", "package", id, order = 61, tab = FOLDER,
            description = "Reads GitHub repos (read-only, through an AI session on axHub) into notes with links to the code, and keeps a TODO list per repo.",
            settings = listOf(
                SettingSpec(KEY_REPOS, "Allowed repos", SettingKind.TEXT, "owner/name, one per line or comma-separated. Only these are ever read", JsonPrimitive(""), SettingScope.APP, icon = "package"),
                SettingSpec(KEY_HARVEST, "Keep a TODO list per repo", SettingKind.TOGGLE, "TODO and FIXME comments become to-dos; closed when the line is gone", JsonPrimitive(true), SettingScope.APP, icon = "check"),
                SettingSpec(KEY_SCHEDULE, "Schedule", SettingKind.CHOICE, "Placeholder: repos are read when you ask until background jobs (axf.jobs) land", JsonPrimitive("manual"), SettingScope.APP,
                    options = listOf("manual" to "When I ask", "daily" to "Daily (placeholder)", "weekly" to "Weekly (placeholder)")),
                SettingSpec("$KEY_PREFIX.readNow", "Read repos now", SettingKind.ACTION, "Reads every allowed repo and harvests its TODOs", target = ACTION_READ, icon = "package"),
                SettingSpec("$KEY_PREFIX.purgeNow", "Remove this plugin's data", SettingKind.ACTION,
                    "Deletes what it remembers per repo, its TODO lists and its settings on this phone. Notes it wrote stay", target = ACTION_PURGE),
            ),
        )))

        kit.menus(id, listOf(MenuItem("$FOLDER.read", "Read my repos", "package", ACTION_READ)))
    }

    override suspend fun start(ctx: ModuleContext) {
        kit.registerTriggers(id, TRIGGERS_ASSET)
    }

    // ------------------------------------------------------------------ data

    private fun data(): PluginData = kit.data(footprint)
    private fun state(repo: String): RepoState? = RepoStateCodec.parse(data().read(COL_REPOS, Repos.slug(repo)))
    private fun save(s: RepoState) = data().write(COL_REPOS, Repos.slug(s.repo), RepoStateCodec.toJson(s))
    private fun repos(): List<String> = Repos.parse(kit.setting(KEY_REPOS, ""))

    /** repo → paths the plugin has seen, for resolving spoken file names. */
    private fun knownPaths(): Map<String, List<String>> = repos().associateWith { state(it)?.paths ?: emptyList() }

    // ------------------------------------------------------------------ read (s16) + harvest (s23)

    private suspend fun readAll() {
        val list = repos()
        if (list.isEmpty()) { kit.toast("Add a repo under Settings → Plugins → Codebase reader first."); return }
        val ai = kit.ai()
        if (!ai.available()) { kit.toast("AI isn't connected yet, so repos can't be read."); return }
        var ok = 0
        val failed = ArrayList<String>()
        for (repo in list) if (readRepo(repo)) ok++ else failed += repo
        kit.toast(if (failed.isEmpty()) "Read $ok repo(s)." else "Read $ok repo(s); couldn't read ${failed.joinToString()}.")
    }

    private suspend fun readRepo(repo: String): Boolean {
        if (!Repos.allowed(repo, repos())) return false
        val prev = state(repo)
        val reply = kit.ai().ask(AiRequestInput(
            prompt = ReadPrompt.build(repo, prev?.lastCommit),
            context = ChatContext(view = "ax-notes", title = "Read $repo", extra = ReadPrompt.extra(repo, prev?.lastCommit)),
            requested = AiModes.READ_CODEBASE, title = "Read $repo",
        ), timeoutMs = 10 * 60_000L, pollMs = 1500).getOrNull() ?: return false
        val read = ReadReply.parse(reply, repo) ?: return false
        lock.withLock { apply(read, prev) }
        return true
    }

    /** Saves the read's notes and merges its TODOs (lock held). */
    private fun apply(read: CodebaseRead, prev: RepoState?) {
        val store = kit.store
        val t = now()
        val unchanged = prev?.lastCommit == read.commit
        if (!unchanged) {
            val category = store.ensureCategory(CodebaseNotes.CATEGORY).id
            val existing = store.notes.value.associateBy { it.id }
            for (n in CodebaseNotes.plan(read, prev, existing, category, t, zone)) store.saveNote(n, touch = false)
        }
        var autoClosed = prev?.autoClosed ?: emptySet()
        val todos = read.todos
        if (todos != null && kit.settingBool(KEY_HARVEST, true)) {
            val list = store.list(CodebaseNotes.todoListId(read.repo)) ?: CodebaseNotes.todoList(read.repo, t).also { store.saveList(it) }
            // An incomplete scan may add and update, never close.
            val hits = if (read.todosComplete) todos else todos + list.items.filter { CodeTodos.isHarvested(it.id) && !it.done }.mapNotNull { keep(it, read.repo) }
            val r = CodeTodos.merge(list.items, hits, autoClosed, t)
            if (r.changed) store.saveList(list.copy(items = r.items))
            autoClosed = r.autoClosed
        }
        save(RepoState(read.repo, read.commit, t, CodebaseNotes.knownPaths(read, prev?.paths ?: emptyList()), autoClosed))
    }

    /** An open harvested item as a hit again (so an incomplete scan doesn't close it). */
    private fun keep(item: ai.amberx.axf.axnotes.model.TodoItem, repo: String): CodeTodoHit? {
        val l = item.codeLinks.firstOrNull() ?: return null
        val fixme = item.text.startsWith("FIXME: ")
        val text = item.text.removePrefix("FIXME: ")
        val hit = CodeTodoHit(repo, l.path, l.lineStart ?: 1, text, if (fixme) TodoKind.FIXME else TodoKind.TODO, l.commit)
        // only when the id matches (text was capitalized for display; the id uses normalized text, so it does)
        return hit.takeIf { it.id == item.id }
    }

    // ------------------------------------------------------------------ voice: note on / ask about a file

    private fun resolve(a: JsonObject): Pair<ResolvedFile, Int?>? {
        val said = ActionArgs.str(a, "file", "0") ?: return null
        val f = FileResolver.resolve(said, knownPaths()) ?: return null
        return f to ActionArgs.int(a, "line", "1")
    }

    private suspend fun noteOnFile(a: JsonObject) {
        val (file, line) = resolve(a) ?: run { kit.toast("I couldn't match that to a file in your repos. Read them first, or say the file name again."); return }
        val link = FileResolver.link(file, line, state(file.repo)?.lastCommit)
        val text = ActionArgs.str(a, "text", "2").orEmpty()
        val store = kit.store
        val note = lock.withLock {
            val n = store.createNote(text.ifEmpty { "Note on ${link.label()}" }, AskPrompt.noteTitle(link, "Note on"), CodebaseNotes.CATEGORY, listOf(CodebaseNotes.TAG), NoteSource.VOICE)
            n.copy(codeLinks = listOf(link)).also { store.saveNote(it) }
        }
        open(note)
    }

    private suspend fun askAboutFile(a: JsonObject) {
        val (file, line) = resolve(a) ?: run { kit.toast("I couldn't match that to a file in your repos."); return }
        if (!Repos.allowed(file.repo, repos())) return
        val link = FileResolver.link(file, line, state(file.repo)?.lastCommit)
        val store = kit.store
        val notes = AskPrompt.notesFor(store.notes.value, link.repo, link.path)
        val question = ActionArgs.str(a, "question", "2")
        val ai = kit.ai()
        if (!ai.available()) { kit.toast("AI isn't connected yet."); return }
        val answer = ai.ask(AiRequestInput(
            prompt = AskPrompt.build(link, question, notes),
            context = ChatContext(view = "ax-notes", title = link.label(), note = notes.firstOrNull()?.text?.take(2000),
                extra = JsonObject(mapOf("repo" to JsonPrimitive(link.repo), "path" to JsonPrimitive(link.path), "readOnly" to JsonPrimitive(true)))),
            requested = AiModes.READ_CODEBASE, title = "Ask about ${link.label()}",
        ), timeoutMs = 3 * 60_000L, pollMs = 1000)
        val text = answer.getOrNull()?.trim()?.takeIf { it.isNotEmpty() } ?: run { kit.toast("No answer: ${answer.failureOrNull()?.message ?: "empty reply"}"); return }
        val note = lock.withLock {
            val body = (question?.let { "Q: $it\n\n" } ?: "") + text
            val n = store.createNote(body, AskPrompt.noteTitle(link, "About"), CodebaseNotes.CATEGORY, listOf(CodebaseNotes.TAG, "answer"), NoteSource.AI)
            n.copy(codeLinks = listOf(link)).also { store.saveNote(it) }
        }
        open(note)
    }

    private fun open(n: Note) {
        ctx?.service(Selection::class)?.editNote(n.id)
        kit.runtime?.navigate(Selection.ROUTE_EDITOR)
    }

    companion object {
        const val ID = "ai.amberx.axf.axnotes.plugins.ai-codebase-reader"
        const val FOLDER = "ai-codebase-reader"
        const val DATA = "ai.amberx.axf.axnotes.plugin.ai-codebase-reader"
        const val SERVICE = "axnotes.codebase@1"
        const val SERVICE_TODOS = "axnotes.code-todos@1"
        const val TRIGGERS_ASSET = "axnotes/plugins/ai-codebase-reader/triggers.json"
        const val KEY_PREFIX = "app.codebase"
        const val KEY_REPOS = "$KEY_PREFIX.repos"
        const val KEY_HARVEST = "$KEY_PREFIX.harvestTodos"
        const val KEY_SCHEDULE = "$KEY_PREFIX.schedule"
        val SETTING_KEYS: List<String> = listOf(KEY_REPOS, KEY_HARVEST, KEY_SCHEDULE)
        const val ACTION_READ = "codebase.read-now"
        const val ACTION_NOTE_ON_FILE = "codebase.note-on-file"
        const val ACTION_ASK = "codebase.ask-about-file"
        const val ACTION_PURGE = "codebase.purge"
        const val COL_REPOS = "repos"
    }
}
