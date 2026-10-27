package ai.amberx.axf.axnotes.plugins.codebase

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive


/*
 * Voice on code (build step s23), pure: "note on <file>" attaches a note to a file (and line), "ask about <file>" asks
 * the AI about that code with the file's notes as context. The phrases themselves are triggers@1 data
 * (assets/axnotes/plugins/ai-codebase-reader/triggers.json); this resolves what was said to a real path.
 */

data class ResolvedFile(val repo: String, val path: String, val score: Double)

object FileResolver {
    private val SPLIT = Regex("(?<=[a-z0-9])(?=[A-Z])|[^A-Za-z0-9]+")
    private val SPOKEN_EXT = mapOf("kotlin" to "kt", "kt" to "kt", "json" to "json", "markdown" to "md", "md" to "md", "typescript" to "ts", "ts" to "ts",
        "tsx" to "tsx", "javascript" to "js", "js" to "js", "python" to "py", "py" to "py", "yaml" to "yaml", "yml" to "yml", "gradle" to "gradle", "kts" to "kts")

    /** Words of a file name: "NotesStore.kt" → [notes, store, kt]. */
    fun words(name: String): List<String> = name.split(SPLIT).map { it.lowercase() }.filter { it.isNotEmpty() }

    /** What was said, as words: "the notes store dot kotlin file" → [notes, store, kt]. */
    fun spoken(s: String): List<String> {
        val w = words(s.replace(" dot ", " ").replace(" slash ", " "))
        val body = w.filter { it !in setOf("the", "file", "a", "my", "in", "dot", "slash") }
        return body.mapIndexed { i, x -> if (i == body.lastIndex) SPOKEN_EXT[x] ?: x else x }
    }

    /**
     * The best path for [said] among [paths] (repo → paths). Exact name (with or without extension) wins, then fuzzy
     * on the file name, then on the path's last two parts; ties go to the shorter path. Null below [threshold].
     */
    fun resolve(said: String, paths: Map<String, List<String>>, threshold: Double = 0.75): ResolvedFile? {
        val q = spoken(said)
        if (q.isEmpty()) return null
        val qJoined = q.joinToString("")
        var best: ResolvedFile? = null
        for ((repo, list) in paths) for (p in list) {
            val file = p.substringAfterLast('/')
            val stem = file.substringBeforeLast('.', file)
            val fw = words(file)
            val sw = words(stem)
            val tail = words(p.split('/').takeLast(2).joinToString(" "))
            val score = when {
                qJoined == fw.joinToString("") || qJoined == sw.joinToString("") -> 1.0
                else -> maxOf(
                    Txt.ratio(qJoined, sw.joinToString("")),
                    Txt.ratio(qJoined, fw.joinToString("")),
                    Txt.ratio(q.map { Txt.stem(it) }.joinToString(""), sw.map { Txt.stem(it) }.joinToString("")),
                    0.95 * Txt.ratio(qJoined, tail.joinToString("")),
                )
            }
            val b = best
            if (score >= threshold && (b == null || score > b.score + 1e-9 || (Math.abs(score - b.score) < 1e-9 && p.length < b.path.length))) best = ResolvedFile(repo, p, score)
        }
        return best
    }

    /** A CodeLink for a resolved file and optional line. */
    fun link(f: ResolvedFile, line: Int?, commit: String?): CodeLink = CodeLink(f.repo, f.path, line?.takeIf { it >= 1 }, line?.takeIf { it >= 1 }, commit?.takeIf { Repos.validSha(it) })
}

/** A note the app announced that points at code (kept so "ask about <file>" can send it as context). */
data class LinkedNote(val id: String, val title: String, val text: String, val links: List<CodeLink>, val at: Long) {
    fun toJson(): JsonObject = JsonObject(linkedMapOf("id" to JsonPrimitive(id), "title" to JsonPrimitive(title), "text" to JsonPrimitive(text),
        "links" to JsonArray(links.map { it.toJson() }), "at" to JsonPrimitive(at)))

    companion object {
        /** From the app's note JSON; null when it has no code links. Text is capped to keep the KV small. */
        fun fromNote(o: JsonObject?): LinkedNote? {
            val id = J.str(o, "id") ?: return null
            val links = J.objects(o?.get("codeLinks"), 20).mapNotNull { CodeLink.parse(it) }
            if (links.isEmpty()) return null
            return LinkedNote(id, J.text(o, "title", 200), J.text(o, "text", 1500), links, J.long(o, "updatedAt") ?: 0L)
        }

        fun parse(o: JsonObject?): LinkedNote? {
            val id = J.str(o, "id") ?: return null
            return LinkedNote(id, J.text(o, "title", 200), J.text(o, "text", 1500), J.objects(o?.get("links"), 20).mapNotNull { CodeLink.parse(it) }, J.long(o, "at") ?: 0L)
        }
    }
}

object AskPrompt {
    const val MAX_CONTEXT = 3000

    /** Notes attached to this file (any line), newest first, for the AI's context. */
    fun notesFor(notes: List<LinkedNote>, repo: String, path: String): List<LinkedNote> =
        notes.filter { n -> n.links.any { it.repo.equals(repo, true) && it.path == path } }.sortedByDescending { it.at }

    /** Read-only question about one file for mode ai.read-codebase. */
    fun build(link: CodeLink, question: String?, notes: List<LinkedNote>): String = buildString {
        append("In the GitHub repository ").append(link.repo).append(" (read-only), look at ").append(link.path)
        if (link.lineStart != null) append(" around line ").append(link.lineStart)
        if (link.commit != null) append(" at commit ").append(link.commit)
        append(".\n")
        append(question?.trim()?.takeIf { it.isNotEmpty() }?.let { "Question: $it\n" } ?: "Explain what this code does, how it fits in, and anything that looks wrong.\n")
        val ctx = notes.joinToString("\n---\n") { "${it.title}\n${it.text}" }.take(MAX_CONTEXT)
        if (ctx.isNotBlank()) append("My notes on this file:\n\"\"\"\n").append(ctx.replace("\"\"\"", "\"")).append("\n\"\"\"\n")
        append("Answer in plain sentences (it may be read aloud), under 200 words.")
    }

    fun noteTitle(link: CodeLink, prefix: String): String = "$prefix ${link.label()}".take(120)

    /** `axnotes.notes.save` payload for a note on a file (voice) or an answer about it. */
    fun notePayload(title: String, text: String, link: CodeLink, source: String, extraTags: List<String> = emptyList()): JsonObject = JsonObject(linkedMapOf(
        "title" to JsonPrimitive(title), "text" to JsonPrimitive(text), "tags" to J.arr(listOf(CodebaseNotes.TAG) + extraTags), "source" to JsonPrimitive(source),
        "category" to JsonPrimitive(CodebaseNotes.CATEGORY), "codeLinks" to JsonArray(listOf(link.toJson())),
    ))
}
