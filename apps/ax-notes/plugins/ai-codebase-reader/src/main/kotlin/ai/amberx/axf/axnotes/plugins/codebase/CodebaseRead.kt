package ai.amberx.axf.axnotes.plugins.codebase

import ai.amberx.axf.axnotes.model.CodeLink
import ai.amberx.axf.axnotes.model.ListKind
import ai.amberx.axf.axnotes.model.ListSort
import ai.amberx.axf.axnotes.model.Note
import ai.amberx.axf.axnotes.model.NoteList
import ai.amberx.axf.axnotes.model.NoteSource
import ai.amberx.axf.axnotes.pluginhost.Hashes
import ai.amberx.axf.axnotes.pluginhost.J
import ai.amberx.axf.axnotes.pluginhost.ReplyJson
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

/*
 * AI codebase reader (plugin ai.amberx.axf.axnotes.plugins.ai-codebase-reader) — pure part. The plugin never reads
 * code itself: it asks an AI session in mode ai.read-codebase (read-only; the session reads the repo server-side on
 * axHub) for one JSON reply, and turns that reply into notes with CodeLinks, keyed by the repo's last commit.
 */

data class ModuleInfo(val path: String, val summary: String)
data class CodeChange(val path: String, val summary: String, val lineStart: Int? = null, val lineEnd: Int? = null)

data class CodebaseRead(
    val repo: String,
    /** HEAD sha the session read */
    val commit: String,
    val architecture: String,
    val modules: List<ModuleInfo>,
    /** null = the reply had no `todos` (don't touch the to-do list); else every TODO/FIXME found */
    val todos: List<CodeTodoHit>?,
    /** false = the session stopped early; the harvest adds and updates but closes nothing */
    val todosComplete: Boolean,
    val changes: List<CodeChange>,
)

/** What the plugin remembers per repo (its own data): last commit read, paths it knows, to-dos it closed. */
data class RepoState(
    val repo: String,
    val lastCommit: String? = null,
    val lastReadAt: Long? = null,
    val paths: List<String> = emptyList(),
    val autoClosed: Set<String> = emptySet(),
)

object Repos {
    private val REPO = Regex("^[A-Za-z0-9_.-]{1,100}/[A-Za-z0-9_.-]{1,100}$")
    private val SHA = Regex("^[0-9a-fA-F]{7,40}$")

    fun valid(repo: String): Boolean = REPO.matches(repo) && !repo.contains("..")
    fun validSha(s: String?): Boolean = s != null && SHA.matches(s)

    /** The allowed-repos setting: one per line or comma-separated, `owner/name` or a github.com URL. */
    fun parse(setting: String): List<String> = setting.split('\n', ',', ';', ' ').map { it.trim() }
        .map { it.removePrefix("https://").removePrefix("http://").removePrefix("github.com/").removeSuffix(".git").trim('/') }
        .filter { valid(it) }.distinctBy { it.lowercase() }.take(50)

    fun allowed(repo: String, allowed: List<String>): Boolean = allowed.any { it.equals(repo, ignoreCase = true) }

    fun slug(repo: String): String = repo.lowercase().replace(Regex("[^a-z0-9]+"), "-").trim('-').take(80)
}

object ReadPrompt {
    /** The read-only request for mode ai.read-codebase. [since] = last commit read (for "changes since"). */
    fun build(repo: String, since: String?): String = buildString {
        append("Read the GitHub repository ").append(repo).append(" (read-only, default branch). Write nothing anywhere.\n")
        append("Reply with ONE JSON object and nothing else:\n")
        append("{\"commit\":\"<full HEAD sha>\",\"architecture\":\"<how it is built, up to 200 words>\",")
        append("\"modules\":[{\"path\":\"<folder or file>\",\"summary\":\"<one line>\"}],")
        append("\"todos\":[{\"path\":\"<file>\",\"line\":<1-based line>,\"kind\":\"TODO|FIXME\",\"text\":\"<comment text>\"}],\"todosComplete\":true,")
        append("\"changes\":[{\"path\":\"<file>\",\"lineStart\":<n>,\"lineEnd\":<n>,\"summary\":\"<what changed>\"}]}\n")
        append("modules: up to 30, most important first. todos: every TODO and FIXME comment (set todosComplete false if you stopped early). ")
        if (Repos.validSha(since)) append("changes: what changed between commit ").append(since).append(" and HEAD, up to 40.")
        else append("changes: [] (first read).")
    }

    /** Request context for the session (assistant@1 ChatContext.extra). */
    fun extra(repo: String, since: String?): JsonObject = JsonObject(buildMap {
        put("repo", JsonPrimitive(repo)); put("readOnly", JsonPrimitive(true)); put("appId", JsonPrimitive("ax-notes"))
        if (Repos.validSha(since)) put("since", JsonPrimitive(since))
    })
}

object ReadReply {
    /** Parses the session's reply for [repo]; null when it isn't usable (no object, or no valid commit sha). */
    fun parse(reply: String, repo: String): CodebaseRead? {
        val o = ReplyJson.extract(reply) ?: return null
        val commit = J.str(o, "commit")?.trim()?.lowercase()?.takeIf { Repos.validSha(it) } ?: return null
        val modules = J.objects(o["modules"], 60).mapNotNull { m ->
            val p = cleanPath(J.str(m, "path")) ?: return@mapNotNull null
            ModuleInfo(p, J.text(m, "summary", 300))
        }.distinctBy { it.path }.take(30)
        val todos = (o["todos"] as? JsonArray)?.let { arr ->
            CodeTodos.dedupe(J.objects(arr, CodeTodos.MAX_HITS).mapNotNull { t ->
                val p = cleanPath(J.str(t, "path")) ?: return@mapNotNull null
                val text = J.text(t, "text", 300)
                if (text.isEmpty()) return@mapNotNull null
                val kind = if (J.str(t, "kind")?.uppercase() == "FIXME") TodoKind.FIXME else TodoKind.TODO
                CodeTodoHit(repo, p, (J.int(t, "line") ?: 1).coerceAtLeast(1), text, kind, commit)
            })
        }
        val changes = J.objects(o["changes"], 80).mapNotNull { c ->
            val p = cleanPath(J.str(c, "path")) ?: return@mapNotNull null
            val s = J.int(c, "lineStart")?.takeIf { it >= 1 }
            CodeChange(p, J.text(c, "summary", 300), s, J.int(c, "lineEnd")?.takeIf { s != null && it >= s })
        }.take(40)
        return CodebaseRead(repo, commit, J.text(o, "architecture", 4000), modules, todos, J.bool(o, "todosComplete") != false, changes)
    }

    fun cleanPath(p: String?): String? {
        val t = p?.trim()?.trimStart('/')?.removePrefix("./") ?: return null
        if (t.isEmpty() || t.length > 300 || t.contains("..") || t.contains('\\') || t.contains("://")) return null
        return t
    }
}

/** Notes made from a read: one architecture note per repo (updated in place), one "changes since" note per new commit. */
object CodebaseNotes {
    const val CATEGORY = "Codebase"
    const val TAG = "codebase"
    const val NOTE_PREFIX = "cbnote-"
    const val LIST_PREFIX = "cbtodo-list-"
    private val DATE = DateTimeFormatter.ofPattern("d MMMM yyyy", Locale.ENGLISH)

    fun archId(repo: String) = "${NOTE_PREFIX}arch-${Repos.slug(repo)}"
    fun changesId(repo: String, commit: String) = "${NOTE_PREFIX}changes-${Repos.slug(repo)}-${commit.take(12)}"
    fun todoListId(repo: String) = LIST_PREFIX + Repos.slug(repo) + "-" + Hashes.fnv64(repo.lowercase()).take(6)

    fun todoList(repo: String, now: Long): NoteList =
        NoteList(todoListId(repo), "TODOs · ${repo.substringAfter('/')}", ListKind.TODO, ListSort.PRIORITY, createdAt = now, updatedAt = now)

    /** The notes to save for [read] ([existing] by id keeps their createdAt, lists and category). */
    fun plan(read: CodebaseRead, previous: RepoState?, existing: Map<String, Note>, categoryId: String, now: Long, zone: ZoneId): List<Note> {
        val out = ArrayList<Note>()
        val short = read.commit.take(7)
        val date = Instant.ofEpochMilli(now).atZone(zone).toLocalDate().format(DATE)
        val name = read.repo.substringAfter('/')
        val arch = buildString {
            append("Read at commit ").append(short).append(" on ").append(date).append(".\n\n")
            append(read.architecture.ifBlank { "No architecture summary in the reply." })
            if (read.modules.isNotEmpty()) {
                append("\n\nModules:\n")
                for (m in read.modules) append("- ").append(m.path).append(if (m.summary.isNotBlank()) " — ${m.summary}" else "").append('\n')
            }
            read.todos?.let { append("\n").append(it.size).append(" TODO/FIXME comment(s); see the list “TODOs · ").append(name).append("”.") }
        }.trimEnd()
        out += note(archId(read.repo), "Architecture · $name", arch, read.modules.map { CodeLink(read.repo, it.path, commit = read.commit) }, existing, categoryId, now, name)

        val since = previous?.lastCommit
        if (since != null && since != read.commit && read.changes.isNotEmpty()) {
            val text = buildString {
                append("Changes in ").append(read.repo).append(" from ").append(since.take(7)).append(" to ").append(short).append(" (read ").append(date).append(").\n\n")
                for (c in read.changes) {
                    append("- ").append(c.path)
                    if (c.lineStart != null) append(":").append(c.lineStart).append(if (c.lineEnd != null && c.lineEnd > c.lineStart) "-${c.lineEnd}" else "")
                    if (c.summary.isNotBlank()) append(" — ").append(c.summary)
                    append('\n')
                }
            }.trimEnd()
            out += note(changesId(read.repo, read.commit), "Changes since ${since.take(7)} · $name", text,
                read.changes.map { CodeLink(read.repo, it.path, it.lineStart, it.lineEnd, read.commit) }, existing, categoryId, now, name)
        }
        return out
    }

    private fun note(id: String, title: String, text: String, links: List<CodeLink>, existing: Map<String, Note>, categoryId: String, now: Long, repoName: String): Note {
        val old = existing[id]
        val tags = ((old?.tags ?: emptyList()) + listOf(TAG, repoName.lowercase())).distinct()
        return Note(id, title, text, old?.category?.takeIf { it.isNotBlank() } ?: categoryId, tags, old?.createdAt ?: now, now,
            old?.listIds ?: emptyList(), links.distinct().take(60), NoteSource.AI, old?.priority ?: ai.amberx.axf.axnotes.model.Priority.NONE)
    }

    /** Paths worth remembering for voice ("note on <file>"): modules, TODO files, changed files. */
    fun knownPaths(read: CodebaseRead, before: List<String>): List<String> =
        (read.modules.map { it.path } + (read.todos ?: emptyList()).map { it.path } + read.changes.map { it.path } + before).distinct().take(2000)
}

object RepoStateCodec {
    fun toJson(s: RepoState): JsonObject = JsonObject(buildMap {
        put("repo", JsonPrimitive(s.repo))
        if (s.lastCommit != null) put("lastCommit", JsonPrimitive(s.lastCommit))
        if (s.lastReadAt != null) put("lastReadAt", JsonPrimitive(s.lastReadAt))
        put("paths", J.arr(s.paths)); put("autoClosed", J.arr(s.autoClosed.sorted()))
    })

    fun parse(o: JsonObject?): RepoState? {
        val repo = J.str(o, "repo")?.takeIf { Repos.valid(it) } ?: return null
        return RepoState(repo, J.str(o, "lastCommit")?.takeIf { Repos.validSha(it) }, J.long(o, "lastReadAt"), J.strings(o?.get("paths"), 2000), J.strings(o?.get("autoClosed"), 5000).toSet())
    }
}
