package ai.amberx.axf.axnotes.plugins.codebase

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/*
 * TODO / FIXME harvest (build step s23) — pure and reusable: nothing here knows about the plugin, the AI or the store.
 * Input is either file contents ([CodeTodos.scan]) or hits someone else found (the read-codebase reply's `todos`).
 * Plugin-local types ([CodeLink], [TodoItem]) keep the app's JSON shapes, so no app class is imported.
 * Each hit gets a stable id from repo + path + text (not the line, so moving code keeps the to-do), hits are deduped,
 * and [CodeTodos.merge] turns them into a to-do list: new ones added, changed ones updated, ones whose line is gone
 * closed automatically (and reopened if the line comes back). Items the user added to that list by hand are left alone.
 */

enum class TodoKind { TODO, FIXME }

/** A pointer into a repository (same JSON as the app's CodeLink). [githubUrl] opens it on GitHub. */
data class CodeLink(val repo: String, val path: String, val lineStart: Int? = null, val lineEnd: Int? = null, val commit: String? = null) {
    fun githubUrl(): String? {
        val r = repo.trim().trim('/')
        if (!Repos.valid(r) || path.isBlank() || path.contains("..")) return null
        val ref = commit?.takeIf { Repos.validSha(it) } ?: "HEAD"
        val lines = when {
            lineStart == null || lineStart < 1 -> ""
            lineEnd != null && lineEnd > lineStart -> "#L$lineStart-L$lineEnd"
            else -> "#L$lineStart"
        }
        return "https://github.com/$r/blob/$ref/${path.trim().trimStart('/')}$lines"
    }

    /** Short label: `repo:path:12-20`. */
    fun label(): String = buildString {
        append(repo.substringAfter('/')); append(':'); append(path)
        if (lineStart != null) { append(':'); append(lineStart); if (lineEnd != null && lineEnd > lineStart) { append('-'); append(lineEnd) } }
    }

    fun toJson(): JsonObject = JsonObject(linkedMapOf(
        "repo" to JsonPrimitive(repo), "path" to JsonPrimitive(path), "lineStart" to (lineStart?.let { JsonPrimitive(it) } ?: JsonNull),
        "lineEnd" to (lineEnd?.let { JsonPrimitive(it) } ?: JsonNull), "commit" to (commit?.let { JsonPrimitive(it) } ?: JsonNull),
    ))

    companion object {
        fun parse(o: JsonObject?): CodeLink? {
            val repo = J.str(o, "repo") ?: return null
            val path = J.str(o, "path") ?: return null
            return CodeLink(repo, path, J.int(o, "lineStart"), J.int(o, "lineEnd"), J.str(o, "commit"))
        }
    }
}

/** A harvested to-do (same JSON as the app's to-do item). [priority] is `high` (FIXME) or `medium` (TODO). */
data class TodoItem(
    val id: String,
    val text: String,
    val done: Boolean = false,
    val priority: String = "medium",
    val createdAt: Long,
    val updatedAt: Long,
    val doneAt: Long? = null,
    val codeLinks: List<CodeLink> = emptyList(),
) {
    fun toJson(): JsonObject = JsonObject(linkedMapOf(
        "id" to JsonPrimitive(id), "text" to JsonPrimitive(text), "done" to JsonPrimitive(done), "priority" to JsonPrimitive(priority),
        "createdAt" to JsonPrimitive(createdAt), "updatedAt" to JsonPrimitive(updatedAt), "doneAt" to (doneAt?.let { JsonPrimitive(it) } ?: JsonNull),
        "codeLinks" to JsonArray(codeLinks.map { it.toJson() }),
    ))

    companion object {
        fun parse(o: JsonObject?): TodoItem? {
            val id = J.str(o, "id") ?: return null
            return TodoItem(id, J.str(o, "text") ?: "", J.bool(o, "done") ?: false, J.str(o, "priority") ?: "medium", J.long(o, "createdAt") ?: 0L,
                J.long(o, "updatedAt") ?: 0L, J.long(o, "doneAt"), J.objects(o?.get("codeLinks"), 10).mapNotNull { CodeLink.parse(it) })
        }
    }
}

data class CodeTodoHit(val repo: String, val path: String, val line: Int, val text: String, val kind: TodoKind = TodoKind.TODO, val commit: String? = null) {
    val id: String get() = CodeTodos.stableId(repo, path, text, kind)
}

data class HarvestResult(
    /** the list's items after the merge (order kept, new ones at the end) */
    val items: List<TodoItem>,
    val added: List<String>,
    val updated: List<String>,
    val closed: List<String>,
    val reopened: List<String>,
    /** ids closed by the harvest (not by the user), kept so they can be reopened */
    val autoClosed: Set<String>,
) {
    val changed: Boolean get() = added.isNotEmpty() || updated.isNotEmpty() || closed.isNotEmpty() || reopened.isNotEmpty()

    /** The app's `axnotes.todos.sync` payload for this change. */
    fun syncPayload(listId: String, listName: String, owner: String): JsonObject {
        val byId = items.associateBy { it.id }
        return JsonObject(linkedMapOf(
            "list" to JsonObject(mapOf("id" to JsonPrimitive(listId), "name" to JsonPrimitive(listName), "kind" to JsonPrimitive("todo"))),
            "owner" to JsonPrimitive(owner),
            "add" to JsonArray(added.mapNotNull { byId[it]?.toJson() }),
            "update" to JsonArray(updated.mapNotNull { byId[it]?.toJson() }),
            "close" to J.arr(closed), "reopen" to J.arr(reopened),
        ))
    }
}

object CodeTodos {
    const val ID_PREFIX = "cbtodo-"
    const val MAX_HITS = 2000
    const val MAX_LINE = 1000
    private val MARK = Regex("(?<![A-Za-z0-9_])(TODO|FIXME)(?![A-Za-z0-9_])(?:\\([^)]{0,40}\\))?\\s*[:\\-]?\\s*(.*)$")
    private val CLOSERS = Regex("\\s*(\\*/|-->|--}}|#}|%>|\\*\\)|\\*+)\\s*$")

    fun normalizeText(s: String): String = s.lowercase().replace(Regex("\\s+"), " ").trim()

    fun stableId(repo: String, path: String, text: String, kind: TodoKind = TodoKind.TODO): String =
        ID_PREFIX + Hashes.fnv64(repo.trim().lowercase() + "\u0000" + path.trim().trimStart('/') + "\u0000" + kind.name + "\u0000" + normalizeText(text))

    fun isHarvested(id: String): Boolean = id.startsWith(ID_PREFIX)

    /** TODO / FIXME comments in [files] (path → contents). Lines are 1-based. */
    fun scan(repo: String, files: Map<String, String>, commit: String? = null): List<CodeTodoHit> {
        val out = ArrayList<CodeTodoHit>()
        for ((path, content) in files.entries.sortedBy { it.key }) {
            if (path.isBlank() || path.contains("..")) continue
            content.lineSequence().forEachIndexed { i, line ->
                if (out.size >= MAX_HITS || line.length > MAX_LINE) return@forEachIndexed
                val m = MARK.find(line) ?: return@forEachIndexed
                val kind = if (m.groupValues[1] == "FIXME") TodoKind.FIXME else TodoKind.TODO
                var text = CLOSERS.replace(m.groupValues[2], "").trim()
                if (text.isEmpty()) text = CLOSERS.replace(line.trim(), "").trim()
                out += CodeTodoHit(repo, path.trimStart('/'), i + 1, text.take(300), kind, commit)
            }
        }
        return dedupe(out)
    }

    /** One hit per stable id: the first by path, then line. */
    fun dedupe(hits: List<CodeTodoHit>): List<CodeTodoHit> =
        hits.sortedWith(compareBy<CodeTodoHit> { it.path }.thenBy { it.line }).distinctBy { it.id }.take(MAX_HITS)

    fun itemText(h: CodeTodoHit): String = (if (h.kind == TodoKind.FIXME) "FIXME: " else "") + h.text.replaceFirstChar { it.uppercase() }

    fun link(h: CodeTodoHit): CodeLink = CodeLink(h.repo, h.path, h.line, h.line, h.commit)

    /**
     * Merges [hits] (the complete set for one repo) into a to-do list's [existing] items. A harvested item whose hit is
     * gone is closed (doneAt = [now]); a harvested item the harvest closed comes back open when its hit returns; one the
     * user ticked stays done. Items not made by the harvest are never touched.
     */
    fun merge(existing: List<TodoItem>, hits: List<CodeTodoHit>, autoClosed: Set<String>, now: Long): HarvestResult {
        val byId = LinkedHashMap<String, CodeTodoHit>()
        for (h in dedupe(hits)) byId[h.id] = h
        val added = ArrayList<String>(); val updated = ArrayList<String>(); val closed = ArrayList<String>(); val reopened = ArrayList<String>()
        val auto = autoClosed.toMutableSet()
        val items = existing.map { item ->
            if (!isHarvested(item.id)) return@map item
            val h = byId[item.id]
            when {
                h == null && !item.done -> { closed += item.id; auto += item.id; item.copy(done = true, doneAt = now, updatedAt = now) }
                h == null -> item
                else -> {
                    var next = item
                    val text = itemText(h)
                    val links = listOf(link(h))
                    if (item.text != text || item.codeLinks != links) next = next.copy(text = text, codeLinks = links)
                    if (item.done && item.id in auto) { next = next.copy(done = false, doneAt = null); reopened += item.id; auto -= item.id }
                    if (next != item) { if (item.id !in reopened) updated += item.id; next.copy(updatedAt = now) } else item
                }
            }
        }
        val known = existing.map { it.id }.toSet()
        val fresh = byId.values.filter { it.id !in known }.map { h ->
            added += h.id
            TodoItem(h.id, itemText(h), priority = if (h.kind == TodoKind.FIXME) "high" else "medium", createdAt = now, updatedAt = now, codeLinks = listOf(link(h)))
        }
        // ids that are no longer in the list don't need remembering
        val allIds = known + fresh.map { it.id }
        return HarvestResult(items + fresh, added, updated, closed, reopened, auto.filter { it in allIds }.toSet())
    }
}
