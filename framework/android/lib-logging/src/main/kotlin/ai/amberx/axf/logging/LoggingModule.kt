package ai.amberx.axf.logging

import ai.amberx.axf.kernel.AxfKernel
import ai.amberx.axf.kernel.contract.RouteSpec
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
import ai.amberx.axf.kernel.module.RouteContribution
import ai.amberx.axf.kernel.module.SettingsContribution
import ai.amberx.axf.kernel.platform.AxfLogger
import ai.amberx.axf.kernel.platform.FileArea
import ai.amberx.axf.kernel.platform.FileLayout
import ai.amberx.axf.kernel.platform.LogEntry
import ai.amberx.axf.kernel.platform.LogLevel
import ai.amberx.axf.kernel.runtime.AxfRuntime
import kotlinx.coroutines.launch
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.serialization.json.JsonPrimitive
import java.io.File

/** A destination for log entries. Contribute more through `ExtensionPoints.LOG_SINKS` (remote shipping is a placeholder). */
public interface LogSink { public fun write(entry: LogEntry); public fun flush() {} }

/**
 * Logging engine: wraps the platform logger, keeps a ring buffer for the viewer, writes a rolling file
 * sink, captures uncaught exceptions with breadcrumbs, and contributes the `logs` route + settings group.
 */
public class LoggingModule(private val ringSize: Int = 2000) : BaseModule(ID, "Logging") {
    override val provides: List<Capability> = listOf(Capability("axf.logging.engine", "Ring buffer, sinks, crash capture, viewer"), Capability("axf.logging.remote", "Ship logs to the VPS (placeholder)"))
    public val engine: LogEngine = LogEngine(ringSize)

    override fun register(ctx: ModuleContext) {
        val platformLogger = ctx.service(AxfLogger::class)
        engine.install(platformLogger, ctx.service(FileLayout::class))
        for (s in ctx.extensions.get(ExtensionPoints.LOG_SINKS)) (s as? LogSink)?.let(engine::addSink)
        ctx.extensions.onChange(ExtensionPoints.LOG_SINKS) { for (s in ctx.extensions.get(ExtensionPoints.LOG_SINKS)) (s as? LogSink)?.let(engine::addSink) }
        ctx.services.register(LogEngine::class, engine, "axf.logging.engine")
        ctx.services.register(AxfLogger::class, engine, "axf.logging")   // every Log(...) created after this writes through the engine
        val runtime = ctx.service(AxfRuntime::class)
        ctx.extensions.contribute(ExtensionPoints.ROUTES, id, RouteContribution(RouteSpec("logs", "Logs", icon = "terminal", module = id, requires = "dev.tools")))
        ctx.extensions.contribute(ExtensionPoints.ACTIONS, id, ActionContribution("app.logs", ActionMeta("Logs", "dev.tools", module = id)) { _, _ -> runtime?.navigate("logs") })
        ctx.extensions.contribute(ExtensionPoints.ACTIONS, id, ActionContribution("logs.crashTest", ActionMeta("Crash test", "dev.tools", module = id)) { _, _ -> engine.log(LogEntry(System.currentTimeMillis(), LogLevel.ERROR, "CrashTest", "Simulated crash", throwable = IllegalStateException("Crash test from the console"))); runtime?.toast("Simulated crash logged (no real crash).", ai.amberx.axf.kernel.runtime.ToastKind.WARNING, "Crash test") })
        ctx.extensions.contribute(ExtensionPoints.SETTINGS, id, SettingsContribution(SettingsGroup("logging", "Logging", "terminal", id, order = 800, settings = listOf(
            SettingSpec("axf.logging.level", "Minimum level", SettingKind.CHOICE, default = JsonPrimitive("DEBUG"), options = LogLevel.entries.map { it.name to it.name.lowercase().replaceFirstChar(Char::uppercase) }),
            SettingSpec("axf.logging.file", "Write log file", SettingKind.TOGGLE, "Rolling file in the app's logs folder", JsonPrimitive(true), SettingScope.DEVICE),
            SettingSpec("axf.logging.remote", "Ship logs to server", SettingKind.TOGGLE, "Placeholder until the remote sink is built", JsonPrimitive(false), SettingScope.DEVICE),
            SettingSpec("axf.logging.open", "Open log viewer", SettingKind.ACTION, target = "app.logs", icon = "terminal", requires = "dev.tools"),
        ))))
        ctx.service(AxfKernel::class)?.let { k -> engine.breadcrumbsFrom(k) }
    }
    override suspend fun start(ctx: ModuleContext) { engine.installCrashHandler() }

    public companion object { public const val ID: String = "ai.amberx.axf.logging" }
}

public class LogEngine(private val ringSize: Int) : AxfLogger {
    private var upstream: AxfLogger? = null
    private val sinks = mutableListOf<LogSink>()
    private val _entries = MutableStateFlow<List<LogEntry>>(emptyList())
    public val entries: StateFlow<List<LogEntry>> get() = _entries
    public var minLevel: LogLevel = LogLevel.VERBOSE
    private val breadcrumbs = ArrayDeque<String>()
    public var fileSink: FileSink? = null
        private set

    internal fun install(platform: AxfLogger?, files: FileLayout?) {
        upstream = platform
        files?.path(FileArea.LOGS, "axf.logging", "app.log")?.let { fileSink = FileSink(File(it)).also(::addSink) }
    }
    public fun addSink(s: LogSink) { if (s !in sinks) sinks += s }
    override fun isLoggable(level: LogLevel): Boolean = level >= minLevel
    override fun log(entry: LogEntry) {
        if (!isLoggable(entry.level)) return
        upstream?.log(entry)
        _entries.update { (it + entry).takeLast(ringSize) }
        for (s in sinks) runCatching { s.write(entry) }
    }
    public fun clear() { _entries.value = emptyList() }
    public fun breadcrumb(s: String) { breadcrumbs.addLast(s); while (breadcrumbs.size > 50) breadcrumbs.removeFirst() }
    internal fun breadcrumbsFrom(kernel: AxfKernel) { kernel.scope.launch { kernel.events.events.collect { e -> breadcrumb(e.topic) } } }
    public fun installCrashHandler() {
        val prev = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { t, e ->
            log(LogEntry(System.currentTimeMillis(), LogLevel.ASSERT, "Crash", "Uncaught ${e::class.simpleName} on ${t.name}: ${e.message}", mapOf("breadcrumbs" to breadcrumbs.joinToString(" › ")), e))
            fileSink?.flush()
            prev?.uncaughtException(t, e)
        }
    }
    public fun export(): String = _entries.value.joinToString("\n") { it.format() }
}

public fun LogEntry.format(): String = "${java.text.SimpleDateFormat("HH:mm:ss.SSS", java.util.Locale.US).format(java.util.Date(timeMillis))} ${level.name.first()}/$tag: $message" + (if (fields.isEmpty()) "" else " " + fields.entries.joinToString(" ") { "${it.key}=${it.value}" }) + (throwable?.let { "\n    ${it.stackTraceToString().take(800)}" } ?: "")

/** Rolling file sink: rotates at 1 MB, keeps one previous file. */
public class FileSink(private val file: File, private val maxBytes: Long = 1_000_000) : LogSink {
    private val writer by lazy { file.parentFile?.mkdirs(); java.io.FileWriter(file, true) }
    override fun write(entry: LogEntry) {
        synchronized(this) {
            if (file.length() > maxBytes) { writer.close(); file.renameTo(File(file.parentFile, file.name + ".1")) }
            writer.write(entry.format()); writer.write("\n")
            if (entry.level >= LogLevel.WARN) writer.flush()
        }
    }
    override fun flush() { synchronized(this) { runCatching { writer.flush() } } }
}
