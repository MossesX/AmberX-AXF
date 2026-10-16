package ai.amberx.axf.kernel.migrate

import ai.amberx.axf.kernel.result.AxfFailure
import ai.amberx.axf.kernel.result.AxfResult

/** What a migration touches. One registry orders all of them; each scope keeps its own applied-version marker. */
public enum class MigrationScope { ASSETS, SETTINGS, DATABASE, MANIFEST, FILES, MODULE }

/**
 * One ordered, idempotent migration step (Foundations: f.migrations). `version` is compared as semver;
 * steps run in ascending order per scope, each at most once, recorded through [MigrationLedger].
 */
public interface Migration {
    public val id: String
    public val scope: MigrationScope
    /** Framework/module version this migration brings the scope to. */
    public val version: String
    public val module: String get() = "kernel"
    public val description: String get() = id
    public suspend fun apply(ctx: MigrationContext): AxfResult<Unit>
}

public interface MigrationContext { public val log: (String) -> Unit }

/** Persists which migrations have run. The platform module backs it with DataStore; tests use memory. */
public interface MigrationLedger {
    public suspend fun applied(scope: MigrationScope): Set<String>
    public suspend fun markApplied(scope: MigrationScope, id: String, version: String)
}

public class InMemoryLedger : MigrationLedger {
    private val map = LinkedHashMap<MigrationScope, MutableSet<String>>()
    override suspend fun applied(scope: MigrationScope): Set<String> = map[scope] ?: emptySet()
    override suspend fun markApplied(scope: MigrationScope, id: String, version: String) { map.getOrPut(scope) { mutableSetOf() } += id }
}

public class MigrationRunner(private val ledger: MigrationLedger, private val log: (String) -> Unit = {}) {
    private val migrations = mutableListOf<Migration>()
    public fun register(m: Migration) { migrations += m }
    public fun registered(): List<Migration> = migrations.toList()

    public suspend fun run(scope: MigrationScope? = null): AxfResult<List<String>> {
        val ran = mutableListOf<String>()
        val ctx = object : MigrationContext { override val log: (String) -> Unit = this@MigrationRunner.log }
        for (s in MigrationScope.entries) {
            if (scope != null && s != scope) continue
            val done = ledger.applied(s)
            for (m in migrations.filter { it.scope == s }.sortedWith(compareBy({ Semver.parse(it.version) }, { it.id }))) {
                if (m.id in done) continue
                val r = m.apply(ctx)
                if (r is AxfResult.Err) return AxfResult.err(AxfFailure.Unexpected("Migration ${m.id} failed: ${r.failure.message}", r.failure.cause))
                ledger.markApplied(s, m.id, m.version); ran += m.id; log("migrated ${s.name.lowercase()} → ${m.version} (${m.id})")
            }
        }
        return AxfResult.ok(ran)
    }
}

/** Minimal semver compare used by migrations, deprecations and module compatibility. */
public data class Semver(val major: Int, val minor: Int, val patch: Int, val pre: String? = null) : Comparable<Semver> {
    override fun compareTo(other: Semver): Int = compareValuesBy(this, other, { it.major }, { it.minor }, { it.patch }) .let { if (it != 0) it else when { pre == other.pre -> 0; pre == null -> 1; other.pre == null -> -1; else -> pre.compareTo(other.pre) } }
    override fun toString(): String = "$major.$minor.$patch" + (pre?.let { "-$it" } ?: "")
    public companion object {
        public fun parse(s: String): Semver {
            val core = s.substringBefore('-'); val pre = s.substringAfter('-', "").ifEmpty { null }
            val p = core.split('.').map { it.toIntOrNull() ?: 0 }
            return Semver(p.getOrElse(0) { 0 }, p.getOrElse(1) { 0 }, p.getOrElse(2) { 0 }, pre)
        }
        public fun isCompatible(required: String, available: String): Boolean { val r = parse(required); val a = parse(available); return a.major == r.major && a >= r }
    }
}

/** Deprecation policy (Foundations: f.deprecate): nothing is removed without a shim; this records the shims in use so devtools can list them. */
public object Deprecations {
    public data class Entry(val id: String, val since: String, val removeIn: String, val replacement: String)
    private val used = LinkedHashMap<String, Entry>()
    public fun use(id: String, since: String, removeIn: String, replacement: String) { used.putIfAbsent(id, Entry(id, since, removeIn, replacement)) }
    public fun inUse(): List<Entry> = used.values.toList()
}
