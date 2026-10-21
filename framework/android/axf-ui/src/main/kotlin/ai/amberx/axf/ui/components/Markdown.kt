package ai.amberx.axf.ui.components

import ai.amberx.axf.ui.LocalAxfActions
import ai.amberx.axf.ui.icons.AxfIcon
import ai.amberx.axf.ui.theme.Axf
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withLink
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp

/*
 * Markdown for Compose (web: `framework/react/components/Markdown.tsx`, same grammar): headings, lists (nested by
 * indent, `-`/`*`/`+`/`•`/numbered), task items, quotes, tables, rules, fenced code with a Copy button, inline code,
 * bold, italic, strike, links and bare URLs. Safe by construction: the parser builds Compose text and layout only; raw
 * HTML stays text and a link opens only for http(s) / mailto targets (anything else is plain text).
 * Written without a compiler (Maven is blocked here).
 */

/** The block model the parser produces; public so apps can render or inspect it. */
public sealed class MdBlock {
    public data class Heading(val level: Int, val text: String) : MdBlock()
    public data class Paragraph(val lines: List<String>) : MdBlock()
    public data class Code(val lang: String, val code: String) : MdBlock()
    public data class ListBlock(val items: List<MdItem>, val ordered: Boolean) : MdBlock()
    public data class Quote(val blocks: List<MdBlock>) : MdBlock()
    public data class Table(val head: List<String>, val rows: List<List<String>>) : MdBlock()
    public object Rule : MdBlock()
}

/** One list item: `task` is null for a plain item, true/false for `[x]` / `[ ]`; `children` are nested items. */
public data class MdItem(val text: String, val task: Boolean? = null, val children: MdBlock.ListBlock? = null)

public object MarkdownParser {
    private val LIST = Regex("""^(\s*)([-*+•]|\d+[.)])\s+(.*)$""")
    private val FENCE = Regex("""^\s*(```|~~~)\s*([\w+-]*)""")
    private val HEADING = Regex("""^(#{1,6})\s+(.*)$""")
    private val RULE = Regex("""^\s*([-*_])(\s*\1){2,}\s*$""")
    private val TABLE_ROW = Regex("""^\s*\|.*\|\s*$""")
    private val TABLE_SEP = Regex("""^\s*\|?\s*:?-{2,}""")
    private val QUOTE = Regex("""^\s*>\s?""")
    private val CONTINUATION = Regex("""^\s{2,}\S""")
    private val BLOCK_START = Regex("""^\s*(```|~~~|#{1,6}\s|>|\|)""")
    private val TASK = Regex("""^\[( |x|X)\]\s+(.*)$""")

    /** Links the renderer will follow; everything else is shown as text. */
    public fun safeHref(href: String): String? { val h = href.trim(); return if (Regex("""^(https?:|mailto:)""", RegexOption.IGNORE_CASE).containsMatchIn(h)) h else null }

    public fun parse(src: String): List<MdBlock> {
        val lines = src.replace("\r\n", "\n").split('\n')
        val at = { n: Int -> lines.getOrNull(n) ?: "" }
        val out = ArrayList<MdBlock>()
        var i = 0
        while (i < lines.size) {
            val line = at(i)
            val fence = FENCE.find(line)
            if (fence != null) {
                val mark = fence.groupValues[1]
                val code = ArrayList<String>()
                i++
                while (i < lines.size && !at(i).trim().startsWith(mark)) { code.add(at(i)); i++ }
                i++
                out.add(MdBlock.Code(fence.groupValues[2], code.joinToString("\n")))
                continue
            }
            val h = HEADING.find(line)
            if (h != null) { out.add(MdBlock.Heading(h.groupValues[1].length, h.groupValues[2])); i++; continue }
            if (RULE.matches(line)) { out.add(MdBlock.Rule); i++; continue }
            if (TABLE_ROW.matches(line) && i + 1 < lines.size && TABLE_SEP.containsMatchIn(at(i + 1))) {
                val row = { l: String -> l.trim().removePrefix("|").removeSuffix("|").split('|').map { it.trim() } }
                val head = row(line)
                i += 2
                val rows = ArrayList<List<String>>()
                while (i < lines.size && TABLE_ROW.matches(at(i))) { rows.add(row(at(i))); i++ }
                out.add(MdBlock.Table(head, rows))
                continue
            }
            if (LIST.matches(line)) {
                val items = ArrayList<Triple<Int, Boolean, String>>()
                while (i < lines.size && (LIST.matches(at(i)) || (CONTINUATION.containsMatchIn(at(i)) && items.isNotEmpty()))) {
                    val m = LIST.find(at(i))
                    if (m != null) {
                        val depth = m.groupValues[1].replace("\t", "  ").length / 2
                        items.add(Triple(depth, m.groupValues[2].any { it.isDigit() }, m.groupValues[3]))
                    } else {
                        val last = items.removeAt(items.size - 1)
                        items.add(Triple(last.first, last.second, last.third + " " + at(i).trim()))
                    }
                    i++
                }
                out.add(list(items, 0, 0).first)
                continue
            }
            if (QUOTE.containsMatchIn(line)) {
                val q = ArrayList<String>()
                while (i < lines.size && QUOTE.containsMatchIn(at(i))) { q.add(at(i).replaceFirst(QUOTE, "")); i++ }
                out.add(MdBlock.Quote(parse(q.joinToString("\n"))))
                continue
            }
            if (line.isBlank()) { i++; continue }
            val para = ArrayList<String>()
            while (i < lines.size && at(i).isNotBlank() && !BLOCK_START.containsMatchIn(at(i)) && !LIST.matches(at(i))) { para.add(at(i)); i++ }
            if (para.isEmpty()) { para.add(at(i)); i++ }
            out.add(MdBlock.Paragraph(para))
        }
        return out
    }

    private fun list(items: List<Triple<Int, Boolean, String>>, start: Int, depth: Int): Pair<MdBlock.ListBlock, Int> {
        val lis = ArrayList<MdItem>()
        var i = start
        val ordered = items.getOrNull(start)?.second ?: false
        while (i < items.size && items[i].first >= depth) {
            if (items[i].first > depth) {
                val sub = list(items, i, items[i].first)
                if (lis.isEmpty()) lis.add(MdItem("", null, sub.first))
                else { val last = lis.removeAt(lis.size - 1); lis.add(MdItem(last.text, last.task, sub.first)) }
                i = sub.second
                continue
            }
            val t = TASK.find(items[i].third)
            if (t != null) lis.add(MdItem(t.groupValues[2], t.groupValues[1] != " ")) else lis.add(MdItem(items[i].third))
            i++
        }
        return Pair(MdBlock.ListBlock(lis, ordered), i)
    }

    /** Inline spans: code, bold, strike, italic, links, bare URLs (the same regex as the web renderer). */
    public val INLINE: Regex = Regex("""(`+)([\s\S]+?)\1|\*\*([^*]+)\*\*|__([^_]+)__|~~([^~]+)~~|\*([^*\s][^*]*)\*|_([^_\s][^_]*)_|\[([^\]]+)]\(([^)\s]+)\)|(https?://[^\s)<>]+)""")
}

/** Renders Markdown with the active theme. `compact` = tighter spacing, smaller type (banners, cards). */
@Composable
public fun AxfMarkdown(text: String, modifier: Modifier = Modifier, compact: Boolean = false) {
    val blocks = remember(text) { MarkdownParser.parse(text) }
    val theme = Axf.theme
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(if (compact) theme.spacing.half else theme.spacing.one)) {
        for (b in blocks) MdBlockView(b, compact)
    }
}

@Composable
private fun MdBlockView(b: MdBlock, compact: Boolean) {
    val theme = Axf.theme
    val c = theme.colors
    val body = if (compact) theme.typography.bodySmall else theme.typography.bodyMedium
    when (b) {
        is MdBlock.Heading -> {
            val style = if (compact) theme.typography.titleSmall else when (b.level) { 1 -> theme.typography.titleLarge; 2 -> theme.typography.titleMedium; else -> theme.typography.titleSmall }
            Text(mdInline(b.text), style = style.copy(fontWeight = theme.typography.headingWeight), color = c.text, modifier = Modifier.semantics { heading() }.padding(top = if (compact) 0.dp else theme.spacing.half))
        }
        is MdBlock.Paragraph -> Text(mdInline(b.lines.joinToString("\n")), style = body, color = c.text)
        is MdBlock.Code -> MdCode(b)
        is MdBlock.ListBlock -> MdList(b, compact, 0)
        is MdBlock.Quote -> Row(Modifier.fillMaxWidth()) {
            Box(Modifier.width(theme.spacing.borderWidth * 3).background(c.border).padding(vertical = theme.spacing.half))
            Column(Modifier.padding(start = theme.spacing.one), verticalArrangement = Arrangement.spacedBy(theme.spacing.half)) { for (x in b.blocks) MdBlockView(x, compact) }
        }
        is MdBlock.Table -> Column(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState())) {
            Row(Modifier.padding(vertical = theme.spacing.x(0.4))) { for (h in b.head) Text(mdInline(h), Modifier.width(theme.spacing.x(14)), style = body.copy(fontWeight = FontWeight.SemiBold), color = c.muted) }
            AxfDivider()
            for (r in b.rows) { Row(Modifier.padding(vertical = theme.spacing.x(0.4))) { for (cell in r) Text(mdInline(cell), Modifier.width(theme.spacing.x(14)), style = body, color = c.text) }; AxfDivider() }
        }
        MdBlock.Rule -> AxfDivider()
    }
}

@Composable
private fun MdList(b: MdBlock.ListBlock, compact: Boolean, depth: Int) {
    val theme = Axf.theme
    val c = theme.colors
    val body = if (compact) theme.typography.bodySmall else theme.typography.bodyMedium
    Column(Modifier.padding(start = theme.spacing.x(if (depth == 0) 0.5 else 1.5)), verticalArrangement = Arrangement.spacedBy(theme.spacing.x(0.25))) {
        var n = 1
        for (item in b.items) {
            if (item.text.isNotEmpty() || item.task != null) Row(verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(theme.spacing.half)) {
                val task = item.task
                when {
                    task != null -> AxfIcon(if (task) "check-circle" else "box", size = 14.dp, tint = if (task) c.success else c.muted, contentDescription = if (task) "done" else "to do", modifier = Modifier.padding(top = theme.spacing.x(0.2)))
                    b.ordered -> Text("$n.", style = body, color = c.muted)
                    else -> Text("•", style = body, color = c.muted)
                }
                Text(mdInline(item.text), style = body, color = c.text)
            }
            val sub = item.children
            if (sub != null) MdList(sub, compact, depth + 1)
            n++
        }
    }
}

@Composable
private fun MdCode(b: MdBlock.Code) {
    val theme = Axf.theme
    val c = theme.colors
    val actions = LocalAxfActions.current
    var copied by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxWidth().clip(theme.shapes.smShape).border(theme.spacing.borderWidth, c.border, theme.shapes.smShape).background(c.surface, theme.shapes.smShape)) {
        Row(
            Modifier.fillMaxWidth().background(c.surface2).padding(horizontal = theme.spacing.x(0.75), vertical = theme.spacing.x(0.25)),
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            Text(b.lang.ifBlank { "code" }, style = theme.typography.code.copy(fontSize = theme.typography.bodySmall.fontSize), color = c.muted)
            Row(Modifier.clickable(onClickLabel = "Copy code") { if (actions.copy(b.code)) copied = true }, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(theme.spacing.x(0.25))) {
                AxfIcon(if (copied) "check" else "copy", size = 12.dp, tint = c.muted, contentDescription = null)
                Text(if (copied) "Copied" else "Copy", style = theme.typography.bodySmall, color = c.muted)
            }
        }
        Text(b.code, Modifier.horizontalScroll(rememberScrollState()).padding(theme.spacing.one), style = theme.typography.code, color = c.codeText)
    }
}

/** Inline markdown → AnnotatedString (bold, italic, strike, code, links). Only http(s)/mailto links are clickable. */
@Composable
public fun mdInline(s: String): AnnotatedString {
    val theme = Axf.theme
    val c = theme.colors
    val link = TextLinkStyles(style = SpanStyle(color = c.accent, textDecoration = TextDecoration.Underline))
    val code = SpanStyle(fontFamily = theme.typography.mono, background = c.surface2, color = c.codeText)
    return remember(s, c.accent, c.surface2, c.codeText) { build(s, link, code) }
}

private fun build(s: String, link: TextLinkStyles, code: SpanStyle): AnnotatedString = buildAnnotatedString { appendInline(s, link, code) }

private fun androidx.compose.ui.text.AnnotatedString.Builder.appendInline(s: String, link: TextLinkStyles, code: SpanStyle) {
    var last = 0
    for (m in MarkdownParser.INLINE.findAll(s)) {
        if (m.range.first > last) append(s.substring(last, m.range.first))
        val g = m.groups
        when {
            g[2] != null -> withStyle(code) { append(g[2]!!.value) }
            g[3] != null || g[4] != null -> withStyle(SpanStyle(fontWeight = FontWeight.Bold)) { appendInline(g[3]?.value ?: g[4]?.value ?: "", link, code) }
            g[5] != null -> withStyle(SpanStyle(textDecoration = TextDecoration.LineThrough)) { appendInline(g[5]!!.value, link, code) }
            g[6] != null || g[7] != null -> withStyle(SpanStyle(fontStyle = FontStyle.Italic)) { appendInline(g[6]?.value ?: g[7]?.value ?: "", link, code) }
            g[8] != null -> {
                val href = MarkdownParser.safeHref(g[9]?.value ?: "")
                if (href != null) withLink(LinkAnnotation.Url(href, link)) { appendInline(g[8]!!.value, link, code) } else appendInline(g[8]!!.value, link, code)
            }
            g[10] != null -> withLink(LinkAnnotation.Url(g[10]!!.value, link)) { append(g[10]!!.value) }
        }
        last = m.range.last + 1
    }
    if (last < s.length) append(s.substring(last))
}
