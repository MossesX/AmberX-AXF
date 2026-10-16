package ai.amberx.axf.platform

import android.util.Log
import ai.amberx.axf.kernel.platform.AxfLogger
import ai.amberx.axf.kernel.platform.LogEntry
import ai.amberx.axf.kernel.platform.LogLevel

/**
 * Forwards every [LogEntry] to logcat. lib-logging wraps this with a ring buffer and sinks; until then
 * this is the whole logging story. `minLevel` drops VERBOSE/DEBUG in release builds.
 */
public class LogcatLogger(private val minLevel: LogLevel = LogLevel.VERBOSE, private val prefix: String = "axf.") : AxfLogger {
    override fun isLoggable(level: LogLevel): Boolean = level.ordinal >= minLevel.ordinal

    override fun log(entry: LogEntry) {
        if (!isLoggable(entry.level)) return
        val tag = (prefix + entry.tag).take(MAX_TAG)
        val msg = if (entry.fields.isEmpty()) entry.message else entry.message + " " + entry.fields.entries.joinToString(" ") { "${it.key}=${it.value}" }
        when (entry.level) {
            LogLevel.VERBOSE -> Log.v(tag, msg, entry.throwable)
            LogLevel.DEBUG -> Log.d(tag, msg, entry.throwable)
            LogLevel.INFO -> Log.i(tag, msg, entry.throwable)
            LogLevel.WARN -> Log.w(tag, msg, entry.throwable)
            LogLevel.ERROR -> Log.e(tag, msg, entry.throwable)
            LogLevel.ASSERT -> Log.wtf(tag, msg, entry.throwable)
        }
    }

    private companion object { const val MAX_TAG = 23 }
}
