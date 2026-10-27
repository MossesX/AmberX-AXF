package ai.amberx.axf.axnotes.plugins.codebase

import ai.amberx.axf.kernel.ai.AiModes
import ai.amberx.axf.kernel.ai.AiRequestInput
import ai.amberx.axf.kernel.asset.MenuItem
import ai.amberx.axf.kernel.assistant.ChatContext
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
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import java.time.ZoneId

/** Voice phrases as data (triggers@1 records); `<file>` is matched against the watched repos' paths ([FileResolver]). */
object CodeTriggers {
    fun all(module: String): List<Trigger> = listOf(
        Trigger("ai-codebase-reader.note-on-file", TriggerKinds.VOICE, TriggerSource.PERMANENT, module, "Note on a file",
            listOf("note on <file> line <line:number> saying <text>", "note on <file> saying <text>", "note on <file> line <line:number>", "note on <file>"),
            CodebaseReaderPlugin.ACTION_NOTE_ON_FILE),
        Trigger("ai-codebase-reader.ask-about-file", TriggerKinds.VOICE, TriggerSource.PERMANENT, module, "Ask about a file",
            listOf("ask about <file> line <line:number> question <question>", "ask about <file> question <question>", "ask about <file> line <line:number>", "ask about <file>"),
            CodebaseReaderPlugin.ACTION_ASK),
        Trigger("ai-codebase-reader.read-now", TriggerKinds.VOICE, TriggerSource.PERMANENT, module, "Read my repos",
            listOf("read my repos", "read the codebase", "harvest todos"), CodebaseReaderPlugin.ACTION_READ),
    )
}

/**
 * Plugin ai-codebase-reader (plugin@1 `ai.amberx.axf.axnotes.ai-codebase-reader`, steps s16 + s23 of build ax-notes).
 *
 * - Reads the allowed repos read-only through an AI session in mode ai.read-codebase (the session reads the repo on
 *   axHub; the plugin sends the request and parses the JSON reply) into notes — architecture, changes since the last
 *   commit read — with CodeLinks that open on GitHub, saved through the app's `axnotes.notes.save` with stable ids.
 * - Harvests TODO / FIXME comments into one generated to-do list per repo (`axnotes.todos.sync`): stable ids, deduped,
 *   closed when the line is gone, reopened when it comes back ([CodeTodos], reusable and pure).
 * - Voice: "note on <file> …" attaches a note to a file / line; "ask about <file> …" asks the AI about that code with
 *   the file's notes (seen through `axnotes.notes.saved`) as context and saves the answer as a note on that file.
 *
 * Data on the phone: KV under `ai-codebase-reader.`; generated lists have ids starting with the same prefix.
 */
class CodebaseReaderPlugin : BaseModule(ID, "AI codebase reader") {
    override val version: String = "0.1.0"
    override val optionalDependsOn: List<String> = listOf("ai.amberx.axf.settings")
    override val provides: List<Capability> = listOf(
        Capability(CAPABILITY, "Reads repos (read-only) into notes with code links"),
        Capability(CAPABILITY_TODOS, "TODO/FIXME harvest into per-repo to-do lists"),
    )

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val lock = Mutex()
    private var host: PluginHost? = null
    private val removers = ArrayList<() -> Unit>()
    private val zone: ZoneId get() = ZoneId.systemDefault()
    private fun now() = System.currentTimeMillis()

    override fun register(ctx: ModuleContext) {
        val h = PluginHost(ctx, PREFIX)
        host = h
        fun action(aid: String, label: String, params: Boolean = false, fn: (JsonObject) -> Unit) =
            ctx.extensions.contribute(ExtensionPoints.ACTIONS, id, ActionContribution(aid, ActionMeta(label, module = id, params = params)) { a, c -> fn(ActionArgs.of(a, c.payload, c.extras)) })
        action(ACTION_READ, "Read my repos into notes") { scope.launch { readAll() } }
        action(ACTION_NOTE_ON_FILE, "Note on a file", params = true) { a -> scope.launch { noteOnFile(a) } }
        action(ACTION_ASK, "Ask about a file", params = true) { a -> scope.launch { askAboutFile(a) } }
        action(ACTION_PURGE, "Remove the codebase reader's data") { scope.launch { purge() } }

        removers += h.watch(HostActions.NOTE_SAVED) { o ->
            val id = J.str(o, "id") ?: return@watch
            val linked = LinkedNote.fromNote(o)
            scope.launch { lock.withLock { if (linked != null) h.put(K_NOTE + id, linked.toJson().toString()) else h.remove(K_NOTE + id) } }
        }

        ctx.extensions.contribute(ExtensionPoints.SETTINGS, id, SettingsContribution(SettingsGroup(TAB, "Codebase reader", "package", id, order = 57, tab = TAB,
            description = "Reads GitHub repos (read-only, through an AI session on axHub) into notes with links to the code, and keeps a TODO list per repo.",
            settings = listOf(
                SettingSpec(PREFIX + K_REPOS, "Allowed repos", SettingKind.TEXT, "owner/name, one per line or comma-separated. Only these are ever read", JsonPrimitive(""), icon = "package"),
                SettingSpec(PREFIX + K_HARVEST, "Keep a TODO list per repo", SettingKind.TOGGLE, "TODO and FIXME comments become to-dos; closed when the line is gone", JsonPrimitive(true), icon = "check"),
                SettingSpec(PREFIX + K_SCHEDULE, "Schedule", SettingKind.CHOICE, "Placeholder: repos are read when you ask until background jobs (work@1) run it", JsonPrimitive("manual"),
                    options = listOf("manual" to "When I ask", "daily" to "Daily (placeholder)", "weekly" to "Weekly (placeholder)")),
                SettingSpec("${PREFIX}readNow", "Read repos now", SettingKind.ACTION, "Reads every allowed repo and harvests its TODOs", target = ACTION_READ, icon = "package"),
                SettingSpec("${PREFIX}purgeNow", "Remove plugin data", SettingKind.ACTION,
                    "Deletes what it keeps on this phone and its TODO lists (run before uninstalling). Notes it wrote stay", target = ACTION_PURGE, icon = "trash"),
            ))))

        val item = MenuItem("$TAB.read", "Read my repos", "package", action = ACTION_READ)
        ctx.extensions.contribute(ExtensionPoints.MENU_ITEMS, id, MenuContribution("app-menu", "default", item))
        ctx.extensions.contribute(ExtensionPoints.MENU_ITEMS, id, MenuContribution("nav-menu", "default", item))

        ctx.service(TriggerRegistry::class)?.let { it.unregister(id); it.register(id, CodeTriggers.all(id)) }
    }

    override suspend fun stop(ctx: ModuleContext) {
        for (r in removers) r()
        removers.clear()
        ctx.service(TriggerRegistry::class)?.unregister(id)
        scope.cancel()
    }

    // ------------------------------------------------------------------ data (KV under ai-codebase-reader.)

    private fun repos(): List<String> = Repos.parse(host!!.setting(K_REPOS, ""))
    private fun state(repo: String): RepoState? = RepoStateCodec.parse(J.parse(host!!.get(K_REPO + Repos.slug(repo))))
    private fun save(s: RepoState) = host!!.put(K_REPO + Repos.slug(s.repo), RepoStateCodec.toJson(s).toString())
    private fun knownPaths(): Map<String, List<String>> = repos().associateWith { state(it)?.paths ?: emptyList() }
    private fun linkedNotes(): List<LinkedNote> = host!!.keys(K_NOTE).mapNotNull { LinkedNote.parse(J.parse(host!!.get(it))) }

    private suspend fun purge() {
        val h = host ?: return
        val n = lock.withLock {
            for (k in h.keys(K_REPO)) RepoStateCodec.parse(J.parse(h.get(k)))?.let { s ->
                h.dispatchIfHandled(HostActions.DELETE_LIST, JsonObject(mapOf("id" to JsonPrimitive(CodebaseNotes.todoListId(PREFIX, s.repo)))))
            }
            h.purge()
        }
        h.toast("Codebase reader data and TODO lists removed ($n item${if (n == 1) "" else "s"}). Notes it wrote stay.", ToastKind.SUCCESS)
    }

    // ------------------------------------------------------------------ read (s16) + harvest (s23)

    private suspend fun readAll() {
        val h = host ?: return
        val list = repos()
        if (list.isEmpty()) { h.toast("Add a repo under Settings → Plugins → Codebase reader first."); return }
        if (!h.ai().available()) { h.toast("AI isn't connected yet, so repos can't be read."); return }
        val failed = ArrayList<String>()
        var ok = 0
        for (repo in list) if (readRepo(repo)) ok++ else failed += repo
        h.toast(if (failed.isEmpty()) "Read $ok repo(s)." else "Read $ok repo(s); couldn't read ${failed.joinToString()}.")
    }

    private suspend fun readRepo(repo: String): Boolean {
        val h = host ?: return false
        if (!Repos.allowed(repo, repos())) return false
        val prev = state(repo)
        val reply = h.ai().ask(AiRequestInput(
            prompt = ReadPrompt.build(repo, prev?.lastCommit),
            context = ChatContext(view = "ax-notes", title = "Read $repo", extra = ReadPrompt.extra(repo, prev?.lastCommit)),
            requested = AiModes.READ_CODEBASE, title = "Read $repo",
        ), timeoutMs = 10 * 60_000L, pollMs = 1500).getOrNull() ?: return false
        val read = ReadReply.parse(reply, repo) ?: return false
        lock.withLock { apply(read, state(repo)) }
        return true
    }

    /** Sends the read's notes and the TODO changes to the app (lock held). */
    private fun apply(read: CodebaseRead, prev: RepoState?) {
        val h = host!!
        val t = now()
        if (prev?.lastCommit != read.commit) for (d in CodebaseNotes.plan(PREFIX, read, prev, t, zone)) h.dispatchIfHandled(HostActions.SAVE_NOTE, d.payload())
        var items = prev?.items ?: emptyList()
        var autoClosed = prev?.autoClosed ?: emptySet()
        val todos = read.todos
        if (todos != null && h.setting(K_HARVEST, true) && h.has(HostActions.SYNC_TODOS)) {
            // An incomplete scan may add and update, never close: keep the open items it didn't report.
            val hits = if (read.todosComplete) todos else todos + items.filter { !it.done }.mapNotNull { keep(it, read.repo) }
            val r = CodeTodos.merge(items, hits, autoClosed, t)
            val listId = CodebaseNotes.todoListId(PREFIX, read.repo)
            if (r.changed && h.dispatchIfHandled(HostActions.SYNC_TODOS, r.syncPayload(listId, CodebaseNotes.todoListName(read.repo), id))) {
                items = r.items; autoClosed = r.autoClosed
            }
        }
        save(RepoState(read.repo, read.commit, t, CodebaseNotes.knownPaths(read, prev?.paths ?: emptyList()), autoClosed, items))
    }

    /** An open harvested item as a hit again (so an incomplete scan doesn't close it). */
    private fun keep(item: TodoItem, repo: String): CodeTodoHit? {
        val l = item.codeLinks.firstOrNull() ?: return null
        val fixme = item.text.startsWith("FIXME: ")
        return CodeTodoHit(repo, l.path, l.lineStart ?: 1, item.text.removePrefix("FIXME: "), if (fixme) TodoKind.FIXME else TodoKind.TODO, l.commit).takeIf { it.id == item.id }
    }

    // ------------------------------------------------------------------ voice: note on / ask about a file

    private fun resolve(a: JsonObject): Pair<ResolvedFile, Int?>? {
        val said = ActionArgs.str(a, "file", "0") ?: return null
        val f = FileResolver.resolve(said, knownPaths()) ?: return null
        return f to ActionArgs.int(a, "line", "1")
    }

    private fun noteOnFile(a: JsonObject) {
        val h = host ?: return
        val (file, line) = resolve(a) ?: run { h.toast("I couldn't match that to a file in your repos. Read them first, or say the file name again."); return }
        val link = FileResolver.link(file, line, state(file.repo)?.lastCommit)
        val text = ActionArgs.str(a, "text", "2").orEmpty()
        val ok = h.dispatchIfHandled(HostActions.SAVE_NOTE, AskPrompt.notePayload(AskPrompt.noteTitle(link, "Note on"), text.ifEmpty { "Note on ${link.label()}" }, link, "voice"))
        h.toast(if (ok) "Note saved on ${link.label()}." else "This app can't save notes from plugins yet.")
    }

    private suspend fun askAboutFile(a: JsonObject) {
        val h = host ?: return
        val (file, line) = resolve(a) ?: run { h.toast("I couldn't match that to a file in your repos."); return }
        if (!Repos.allowed(file.repo, repos())) return
        val link = FileResolver.link(file, line, state(file.repo)?.lastCommit)
        val notes = lock.withLock { AskPrompt.notesFor(linkedNotes(), link.repo, link.path) }
        val question = ActionArgs.str(a, "question", "2")
        val ai = h.ai()
        if (!ai.available()) { h.toast("AI isn't connected yet."); return }
        val answer = ai.ask(AiRequestInput(
            prompt = AskPrompt.build(link, question, notes),
            context = ChatContext(view = "ax-notes", title = link.label(), note = notes.firstOrNull()?.text,
                extra = JsonObject(mapOf("repo" to JsonPrimitive(link.repo), "path" to JsonPrimitive(link.path), "readOnly" to JsonPrimitive(true)))),
            requested = AiModes.READ_CODEBASE, title = "Ask about ${link.label()}",
        ), timeoutMs = 3 * 60_000L, pollMs = 1000)
        val text = answer.getOrNull()?.trim()?.takeIf { it.isNotEmpty() } ?: run { h.toast("No answer: ${answer.failureOrNull()?.message ?: "empty reply"}"); return }
        val body = (question?.let { "Q: $it\n\n" } ?: "") + text
        h.dispatchIfHandled(HostActions.SAVE_NOTE, AskPrompt.notePayload(AskPrompt.noteTitle(link, "About"), body, link, "ai", listOf("answer")))
        h.toast("Answer saved as a note on ${link.label()}.")
    }

    companion object {
        const val ID: String = "ai.amberx.axf.axnotes.ai-codebase-reader"
        const val CAPABILITY: String = "axnotes.ai-codebase-reader"
        const val CAPABILITY_TODOS: String = "axnotes.code-todos"
        const val PREFIX: String = "ai-codebase-reader."
        const val TAB: String = "ai-codebase-reader"
        const val ACTION_READ: String = "ai-codebase-reader.read-now"
        const val ACTION_NOTE_ON_FILE: String = "ai-codebase-reader.note-on-file"
        const val ACTION_ASK: String = "ai-codebase-reader.ask-about-file"
        const val ACTION_PURGE: String = "ai-codebase-reader.purge"
        const val K_REPOS = "repos"
        const val K_HARVEST = "harvestTodos"
        const val K_SCHEDULE = "schedule"
        const val K_REPO = "repo."
        const val K_NOTE = "note."
    }
}
