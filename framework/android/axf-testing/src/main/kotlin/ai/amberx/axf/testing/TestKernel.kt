package ai.amberx.axf.testing

import ai.amberx.axf.kernel.AxfKernel
import ai.amberx.axf.kernel.Platform
import ai.amberx.axf.kernel.asset.parseJsonObject
import ai.amberx.axf.kernel.contract.Router
import ai.amberx.axf.kernel.manifest.AxfManifest
import ai.amberx.axf.kernel.module.AxfModule
import ai.amberx.axf.kernel.platform.AxfClock
import ai.amberx.axf.kernel.platform.AxfDispatchers
import ai.amberx.axf.kernel.platform.LogEntry
import ai.amberx.axf.kernel.platform.AxfLogger
import ai.amberx.axf.kernel.platform.MemoryKeyValueStore
import ai.amberx.axf.kernel.platform.PermissionGateway
import ai.amberx.axf.kernel.platform.PermissionState
import ai.amberx.axf.kernel.platform.SecureStore
import ai.amberx.axf.kernel.result.AxfResult
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import java.io.File

/** A clock tests can move. */
public class FakeClock(public var now: Long = 1_700_000_000_000L) : AxfClock { override fun nowMillis(): Long = now; public fun advance(ms: Long) { now += ms } }

/** Collects log entries in memory. */
public class RecordingLogger : AxfLogger { public val entries: MutableList<LogEntry> = mutableListOf(); override fun log(entry: LogEntry) { entries += entry } }

public class FakeSecureStore : SecureStore {
    private val map = LinkedHashMap<String, String>()
    override suspend fun get(key: String): AxfResult<String?> = AxfResult.ok(map[key])
    override suspend fun put(key: String, value: String): AxfResult<Unit> { map[key] = value; return AxfResult.ok(Unit) }
    override suspend fun remove(key: String): AxfResult<Unit> { map.remove(key); return AxfResult.ok(Unit) }
}

public class FakePermissions(private val granted: MutableSet<String> = mutableSetOf()) : PermissionGateway {
    public fun grant(vararg p: String) { granted += p }
    override fun state(permission: String): PermissionState = if (permission in granted) PermissionState.GRANTED else PermissionState.DENIED
    override suspend fun request(permissions: List<String>, rationale: String?): Map<String, PermissionState> = permissions.associateWith { state(it) }
    override fun openSettings() {}
}

public class FakeRouter : Router {
    public val history: MutableList<String> = mutableListOf("home")
    private val results = LinkedHashMap<String, JsonElement>()
    override val current: String get() = history.last()
    override fun navigate(view: String, args: Map<String, String>) { history += view }
    override fun back(): Boolean = if (history.size > 1) { history.removeAt(history.size - 1); true } else false
    override fun setResult(type: String, value: JsonElement) { results[type] = value }
    override fun consumeResult(type: String): JsonElement? = results.remove(type)
    override fun deepLink(uri: String): Boolean { history += uri.substringAfterLast('/'); return true }
}

/** A kernel Platform with in-memory everything and a test dispatcher. */
public fun fakePlatform(clock: FakeClock = FakeClock(), logger: RecordingLogger = RecordingLogger()): Platform = Platform(
    clock = clock, store = MemoryKeyValueStore(), secure = FakeSecureStore(), logger = logger, permissions = FakePermissions(),
    dispatchers = AxfDispatchers(main = StandardTestDispatcher(), io = Dispatchers.Unconfined, default = Dispatchers.Unconfined),
)

public object TestKernel {
    public val manifestJson: String = """{"${'$'}axf":"manifest@1","app":{"id":"test","name":"Test","version":"0.1.0"},"framework":{"version":"${ai.amberx.axf.kernel.AxfVersion.FRAMEWORK}","template":"android-compose"},"targets":["android"],"startView":"home","defaults":{"color-theme":"amber-ember","style-theme":"soft-studio","layout":"classic-ide","app-menu":"standard-desktop","toolbar":"standard-icons","nav-menu":"sidebar-list","context-menu":"compact-classic","dialog":"centered-modal","popup":"corner-solid","button":"rounded-solid","slider":"classic-round","container":"soft-card","uac-policy":"standard"}}"""

    /** Loads every `<dir>/<type>/<id>.json` (point it at framework/assets, or a copy) and builds an un-started kernel. */
    public fun build(assetsDir: File, vararg modules: AxfModule, platform: Platform = fakePlatform(), manifest: AxfManifest = AxfManifest.parse(manifestJson)!!): AxfKernel {
        val assets: List<JsonObject> = assetsDir.walkTopDown().filter { it.isFile && it.extension == "json" }.mapNotNull { it.readText().parseJsonObject() }.toList()
        return AxfKernel.builder(manifest).assets(assets).platform(platform).modules(*modules).build()
    }
}
