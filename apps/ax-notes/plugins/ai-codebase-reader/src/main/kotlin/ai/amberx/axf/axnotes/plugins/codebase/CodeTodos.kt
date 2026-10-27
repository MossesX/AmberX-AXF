package ai.amberx.axf.axnotes.plugins.codebase

import ai.amberx.axf.axnotes.model.CodeLink
import ai.amberx.axf.axnotes.model.Priority
import ai.amberx.axf.axnotes.model.TodoItem
import ai.amberx.axf.axnotes.pluginhost.Hashes

/*
 * TODO / FIXME harvest (build step s23) — pure and reusable: nothing here knows about the plugin, the AI or the store.
 * Input is either file contents ([CodeTodos.scan]) or hits someone else found (the read-codebase reply's `todos`).
 * Each hit gets a stable id from repo + path + text (not the line, so moving code keeps the to-do), hits are deduped,
 * and [CodeTodos.merge] turns them into a to-do list: new ones added, changed ones updated, ones whose line is gone
 * closed automatically (and reopened if the line comes back). Items the user added to that list by hand are left alone.
 */

enum class TodoKind { TODO, FIXME }

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
            TodoItem(h.id, itemText(h), priority = if (h.kind == TodoKind.FIXME) Priority.HIGH else Priority.MEDIUM, createdAt = now, updatedAt = now, codeLinks = listOf(link(h)))
        }
        // ids that are no longer in the list don't need remembering
        val allIds = known + fresh.map { it.id }
        return HarvestResult(items + fresh, added, updated, closed, reopened, auto.filter { it in allIds }.toSet())
    }
}
