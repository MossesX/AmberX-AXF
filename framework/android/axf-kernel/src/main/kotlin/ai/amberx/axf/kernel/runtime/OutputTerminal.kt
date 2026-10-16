package ai.amberx.axf.kernel.runtime

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update

/** Severity of one terminal line. */
public enum class TerminalLevel { INFO, OK, WARN, ERROR, NOTE }

/** One line of the output terminal: when, which channel (import / install / hot-swap / build / …), what. */
public data class TerminalLine(val at: Long, val channel: String, val level: TerminalLevel, val text: String)

/**
 * The output terminal: a single append-only log every long-running or user-visible operation writes to —
 * library installs, UI-library imports, hot swaps and the kit resolver's fallbacks ("CHART not covered by
 * kit cupertino → default"). Ports render it as a scrollable, auto-scrolling pane (tab kind `terminal`,
 * dialog `terminal`, or a floating window). Pure Kotlin so every port shares the model.
 */
public class OutputTerminal(private val limit: Int = 2000, private val clock: () -> Long = { System.currentTimeMillis() }) {
    private val _lines = MutableStateFlow<List<TerminalLine>>(emptyList())
    public val lines: StateFlow<List<TerminalLine>> get() = _lines
    private val seen = HashSet<String>()

    public fun log(channel: String, text: String, level: TerminalLevel = TerminalLevel.INFO) { _lines.update { (it + TerminalLine(clock(), channel, level, text)).takeLast(limit) } }
    public fun ok(channel: String, text: String): Unit = log(channel, text, TerminalLevel.OK)
    public fun warn(channel: String, text: String): Unit = log(channel, text, TerminalLevel.WARN)
    public fun error(channel: String, text: String): Unit = log(channel, text, TerminalLevel.ERROR)
    public fun note(channel: String, text: String): Unit = log(channel, text, TerminalLevel.NOTE)
    /** Logs `text` once per `key` (e.g. one fallback note per kit × kind, not once per recomposition). */
    public fun once(key: String, channel: String, text: String, level: TerminalLevel = TerminalLevel.NOTE) { if (seen.add(key)) log(channel, text, level) }
    public fun forget(prefix: String) { seen.removeAll { it.startsWith(prefix) } }
    /** Multi-line output (a build-engine `log` array) → one line each. */
    public fun lines(channel: String, text: String, level: TerminalLevel = TerminalLevel.INFO) { text.lineSequence().filter { it.isNotBlank() }.forEach { log(channel, it.trimEnd(), level) } }
    public fun clear() { _lines.value = emptyList(); seen.clear() }
    public fun channels(): List<String> = _lines.value.map { it.channel }.distinct()
    public fun export(): String = _lines.value.joinToString("\n") { "${it.at} [${it.channel}] ${it.level.name.lowercase()}: ${it.text}" }
}
