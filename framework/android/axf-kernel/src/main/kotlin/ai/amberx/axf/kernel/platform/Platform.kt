package ai.amberx.axf.kernel.platform

import ai.amberx.axf.kernel.result.AxfResult
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers

/*
 * Platform seams (Foundations: f.pure, f.clock, f.coroutines, f.logging, f.telemetry, f.permissions, f.secure, f.fs).
 * The kernel only ever talks to these interfaces. axf-platform-android implements them for Android;
 * a desktop or iOS port implements the same set. Tests use the in-memory versions below.
 */

public interface AxfClock { public fun nowMillis(): Long; public fun nanoTime(): Long = System.nanoTime() }
public object SystemClock : AxfClock { override fun nowMillis(): Long = System.currentTimeMillis() }

public interface IdGenerator { public fun next(prefix: String = ""): String }
public class CounterIdGenerator(private val clock: AxfClock = SystemClock) : IdGenerator {
    private var seq = 0L
    override fun next(prefix: String): String = "$prefix${java.lang.Long.toString(clock.nowMillis(), 36)}${java.lang.Long.toString(++seq, 36)}"
}

/** Injected dispatchers so every module is main-safe and tests can replace them. */
public data class AxfDispatchers(val main: CoroutineDispatcher = Dispatchers.Main, val io: CoroutineDispatcher = Dispatchers.IO, val default: CoroutineDispatcher = Dispatchers.Default)

/** Small synchronous key-value store for kernel state (active assets, role, flags). DataStore-backed on Android. */
public interface KeyValueStore {
    public fun get(key: String): String?
    public fun put(key: String, value: String)
    public fun remove(key: String)
    public fun keys(): Set<String>
}
public class MemoryKeyValueStore : KeyValueStore {
    private val map = LinkedHashMap<String, String>()
    override fun get(key: String): String? = map[key]
    override fun put(key: String, value: String) { map[key] = value }
    override fun remove(key: String) { map.remove(key) }
    override fun keys(): Set<String> = map.keys.toSet()
}

/** Secrets never go through KeyValueStore; this is Keystore-backed on Android. */
public interface SecureStore {
    public suspend fun get(key: String): AxfResult<String?>
    public suspend fun put(key: String, value: String): AxfResult<Unit>
    public suspend fun remove(key: String): AxfResult<Unit>
}

public enum class LogLevel { VERBOSE, DEBUG, INFO, WARN, ERROR, ASSERT }
public data class LogEntry(val timeMillis: Long, val level: LogLevel, val tag: String, val message: String, val fields: Map<String, String> = emptyMap(), val throwable: Throwable? = null, val module: String? = null)

/** Structured logging API every module uses from its first line (Foundations: f.logging). lib-logging adds sinks, ring buffer, viewer. */
public interface AxfLogger {
    public fun log(entry: LogEntry)
    public fun isLoggable(level: LogLevel): Boolean = true
}
public object NoopLogger : AxfLogger { override fun log(entry: LogEntry) {} }
/** Convenience wrapper bound to a tag. */
public class Log(private val logger: AxfLogger, private val tag: String, private val clock: AxfClock = SystemClock, private val module: String? = null) {
    private fun e(l: LogLevel, m: String, f: Map<String, String>, t: Throwable?) { if (logger.isLoggable(l)) logger.log(LogEntry(clock.nowMillis(), l, tag, m, f, t, module)) }
    public fun v(m: String, vararg f: Pair<String, String>): Unit = e(LogLevel.VERBOSE, m, f.toMap(), null)
    public fun d(m: String, vararg f: Pair<String, String>): Unit = e(LogLevel.DEBUG, m, f.toMap(), null)
    public fun i(m: String, vararg f: Pair<String, String>): Unit = e(LogLevel.INFO, m, f.toMap(), null)
    public fun w(m: String, t: Throwable? = null, vararg f: Pair<String, String>): Unit = e(LogLevel.WARN, m, f.toMap(), t)
    public fun e(m: String, t: Throwable? = null, vararg f: Pair<String, String>): Unit = e(LogLevel.ERROR, m, f.toMap(), t)
}

/** Vendor-free telemetry seam (Foundations: f.telemetry). */
public interface Telemetry {
    public fun event(name: String, props: Map<String, String> = emptyMap())
    public fun error(t: Throwable, props: Map<String, String> = emptyMap())
    public fun breadcrumb(msg: String)
    public fun timing(name: String, millis: Long)
}
public object NoopTelemetry : Telemetry {
    override fun event(name: String, props: Map<String, String>) {}
    override fun error(t: Throwable, props: Map<String, String>) {}
    override fun breadcrumb(msg: String) {}
    override fun timing(name: String, millis: Long) {}
}

/** Permission engine abstraction (Foundations: f.permissions). Ids are the platform's (android.permission.CAMERA) or logical groups (axf.location). */
public enum class PermissionState { GRANTED, DENIED, DENIED_FOREVER, UNKNOWN }
public interface PermissionGateway {
    public fun state(permission: String): PermissionState
    /** Declares why; the platform shows the rationale when the OS asks for one. */
    public suspend fun request(permissions: List<String>, rationale: String? = null): Map<String, PermissionState>
    public fun openSettings()
}
public object NoopPermissions : PermissionGateway {
    override fun state(permission: String): PermissionState = PermissionState.UNKNOWN
    override suspend fun request(permissions: List<String>, rationale: String?): Map<String, PermissionState> = permissions.associateWith { PermissionState.UNKNOWN }
    override fun openSettings() {}
}

/** Schema-driven filesystem layout (Foundations: f.fs). Namespaced per module; the platform maps these to real dirs. */
public enum class FileArea { DATA, CACHE, EXPORT, ASSETS, LOGS, TEMP }
public interface FileLayout {
    /** Absolute path of `<area>/<module>/<relative>`; the directory is created. */
    public fun path(area: FileArea, module: String, relative: String = ""): String
    public fun read(path: String): AxfResult<String>
    public fun write(path: String, text: String): AxfResult<Unit>
    public fun exists(path: String): Boolean
    public fun list(path: String): List<String>
    public fun delete(path: String): Boolean
}

/** Host info the kernel may read (never a platform type). */
public data class HostInfo(val port: String, val osVersion: String, val device: String, val appId: String, val appVersion: String, val debug: Boolean, val locale: String, val windowWidthDp: Int = 0)
