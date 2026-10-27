package ai.amberx.axf.axnotes.model

/**
 * AX Notes data model (pure Kotlin, no Android): notes, shared categories, note lists (manual, to-do, smart) and
 * to-do items. Times are epoch milliseconds (the axf-data offline repository compares `updatedAt` as a number).
 * JSON shape: [NotesCodec]. Same records go to axHub `_data` for project `ax-notes` (see data/NotesHubSync.kt).
 */

/** Where a note came from. Wire values: `voice`, `typed`, `ai`. */
enum class NoteSource {
    VOICE, TYPED, AI;

    val wire: String get() = name.lowercase()

    companion object {
        fun of(s: String?): NoteSource = entries.firstOrNull { it.wire == s?.trim()?.lowercase() } ?: TYPED
    }
}

/** Priority shared by notes and to-dos. Wire values: `none`, `low`, `medium`, `high`. */
enum class Priority(val rank: Int) {
    NONE(0), LOW(1), MEDIUM(2), HIGH(3);

    val wire: String get() = name.lowercase()

    companion object {
        fun of(s: String?): Priority = entries.firstOrNull { it.wire == s?.trim()?.lowercase() } ?: NONE
    }
}

/**
 * A pointer into a repository: owner/name, file path, optional line range and commit. Read-only; the codebase reader
 * (plugin ai-codebase-reader, step s16) fills these in. [githubUrl] opens it on GitHub.
 */
data class CodeLink(
    val repo: String,
    val path: String,
    val lineStart: Int? = null,
    val lineEnd: Int? = null,
    val commit: String? = null,
) {
    fun githubUrl(): String? {
        val r = repo.trim().trim('/')
        if (!REPO.matches(r) || path.isBlank() || path.contains("..")) return null
        val ref = commit?.takeIf { COMMIT.matches(it) } ?: "HEAD"
        val p = path.trim().trimStart('/')
        val lines = when {
            lineStart == null || lineStart < 1 -> ""
            lineEnd != null && lineEnd > lineStart -> "#L$lineStart-L$lineEnd"
            else -> "#L$lineStart"
        }
        return "https://github.com/$r/blob/$ref/$p$lines"
    }

    /** Short label: `repo:path:12-20`. */
    fun label(): String = buildString {
        append(repo.substringAfter('/')); append(':'); append(path)
        if (lineStart != null) { append(':'); append(lineStart); if (lineEnd != null && lineEnd > lineStart) { append('-'); append(lineEnd) } }
    }

    companion object {
        private val REPO = Regex("[A-Za-z0-9_.-]{1,100}/[A-Za-z0-9_.-]{1,100}")
        private val COMMIT = Regex("[0-9a-fA-F]{7,40}")
    }
}

data class Note(
    val id: String,
    val title: String,
    val text: String,
    /** Category id ([Category.id]); "" = uncategorized. Shared with to-dos. */
    val category: String = "",
    val tags: List<String> = emptyList(),
    val createdAt: Long,
    val updatedAt: Long,
    /** The manual note lists this note is in (smart lists are computed, to-do lists hold notes per item). */
    val listIds: List<String> = emptyList(),
    val codeLinks: List<CodeLink> = emptyList(),
    val source: NoteSource = NoteSource.TYPED,
    val priority: Priority = Priority.NONE,
)

/** One category, shared by notes and to-dos. [id] is the slug of the name ([Categories.slug]). */
data class Category(val id: String, val name: String, val order: Int = 0)

data class TodoItem(
    val id: String,
    val text: String,
    val done: Boolean = false,
    val dueAt: Long? = null,
    val priority: Priority = Priority.NONE,
    /** Notes attached to this item (note ids). */
    val noteIds: List<String> = emptyList(),
    val category: String = "",
    val createdAt: Long,
    val updatedAt: Long,
    val doneAt: Long? = null,
    val codeLinks: List<CodeLink> = emptyList(),
    /** Who made this item: "" = the user; a plugin id for items a plugin keeps in sync (`axnotes.todos.sync`). */
    val owner: String = "",
)

/** NOTES = notes picked by hand, TODO = to-do items, SMART = every note matching [NoteList.filter]. */
enum class ListKind {
    NOTES, TODO, SMART;

    val wire: String get() = name.lowercase()

    companion object {
        fun of(s: String?): ListKind = entries.firstOrNull { it.wire == s?.trim()?.lowercase() } ?: NOTES
    }
}

/** Each list sorts on its own. MANUAL = the order the user dragged / moved things into ([NoteList.order]). */
enum class ListSort {
    DATE, CATEGORY, PRIORITY, MANUAL;

    val wire: String get() = name.lowercase()

    companion object {
        fun of(s: String?): ListSort = entries.firstOrNull { it.wire == s?.trim()?.lowercase() } ?: DATE
    }
}

/** A smart list's rule. Every set field must match; an empty filter matches every note. Dates are inclusive. */
data class SmartFilter(
    val category: String? = null,
    val tag: String? = null,
    val fromAt: Long? = null,
    val toAt: Long? = null,
    val text: String? = null,
) {
    val isEmpty: Boolean get() = category.isNullOrBlank() && tag.isNullOrBlank() && fromAt == null && toAt == null && text.isNullOrBlank()
}

data class NoteList(
    val id: String,
    val name: String,
    val kind: ListKind = ListKind.NOTES,
    val sort: ListSort = ListSort.DATE,
    /** DATE: newest first when true. CATEGORY / PRIORITY: reverses the primary key. Ignored for MANUAL. */
    val descending: Boolean = true,
    /** Manual order: note ids (NOTES / SMART) or item ids (TODO). Ids not listed go after, newest first. */
    val order: List<String> = emptyList(),
    /** TODO lists only. */
    val items: List<TodoItem> = emptyList(),
    /** SMART lists only. */
    val filter: SmartFilter? = null,
    val createdAt: Long,
    val updatedAt: Long,
)

/** Category ids are slugs of their names, so the same word said or typed lands in the same category. */
object Categories {
    fun slug(name: String): String = Text.normalize(name).replace(' ', '-').take(60)

    /** The category for [name] (existing one by fuzzy name, else a new one). */
    fun resolve(name: String, known: List<Category>): Category {
        val id = slug(name)
        known.firstOrNull { it.id == id }?.let { return it }
        Fuzzy.best(name, known, threshold = 0.8) { it.name }?.let { return it.item }
        return Category(id, name.trim().replaceFirstChar { it.uppercase() }, known.size)
    }

    fun nameOf(id: String, known: List<Category>): String =
        if (id.isBlank()) "Uncategorized" else known.firstOrNull { it.id == id }?.name ?: id.replace('-', ' ').replaceFirstChar { it.uppercase() }
}

/** Ids: time-ordered base36 + random tail (same style as the other AXF apps). */
object Ids {
    fun next(prefix: String, now: Long, random: Int = (0 until 46656).random()): String =
        "$prefix-${now.toString(36)}${random.toString(36).padStart(3, '0')}"
}
