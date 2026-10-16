package ai.amberx.axf.data

import android.content.Context
import ai.amberx.axf.kernel.contract.SettingScope
import ai.amberx.axf.kernel.data.QueryPersistence
import ai.amberx.axf.kernel.module.BaseModule
import ai.amberx.axf.kernel.module.Capability
import ai.amberx.axf.kernel.module.ModuleContext
import ai.amberx.axf.kernel.platform.FileArea
import ai.amberx.axf.kernel.platform.FileLayout
import ai.amberx.axf.kernel.result.AxfFailure
import ai.amberx.axf.kernel.result.AxfResult
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.doublePreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.intPreferencesKey
import androidx.datastore.preferences.core.longPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.serialization.json.JsonObject
import java.io.File

private val Context.axfPrefs: DataStore<Preferences> by preferencesDataStore(name = "axf_prefs")

/** Registers the preference store, document store and query persistence. Capability `axf.data`. */
public class DataModule(private val context: Context) : BaseModule(ID, "Data") {
    override val provides: List<Capability> = listOf(Capability("axf.data", "Preferences, documents, offline repositories"), Capability("axf.prefs"), Capability("axf.documents"))
    override fun register(ctx: ModuleContext) {
        val prefs = PreferenceStore(context.axfPrefs)
        ctx.services.register(PreferenceStore::class, prefs, "axf.prefs")
        val files = ctx.service(FileLayout::class)
        val docs = JsonDocumentStore(files, context)
        ctx.services.register(JsonDocumentStore::class, docs, "axf.documents")
        ctx.services.register(QueryPersistence::class, DocumentQueryPersistence(docs), "axf.queries.persistence")
        ctx.services.register(DbRegistry::class, DbRegistry(context), "axf.db")
    }
    public companion object { public const val ID: String = "ai.amberx.axf.data" }
}

/** A typed preference key. Scope decides which store namespace it lives in (device vs user vs app). */
public class PrefKey<T>(public val name: String, public val default: T, public val scope: SettingScope = SettingScope.USER)

/** DataStore-backed typed preferences with flows and defaults. Values are String/Boolean/Int/Long/Double. */
public class PreferenceStore(private val store: DataStore<Preferences>) {
    private fun full(k: PrefKey<*>) = "${k.scope.name.lowercase()}.${k.name}"
    @Suppress("UNCHECKED_CAST")
    private fun <T> prefKey(k: PrefKey<T>): Preferences.Key<T> = when (k.default) {
        is Boolean -> booleanPreferencesKey(full(k)); is Int -> intPreferencesKey(full(k)); is Long -> longPreferencesKey(full(k)); is Double -> doublePreferencesKey(full(k)); else -> stringPreferencesKey(full(k))
    } as Preferences.Key<T>
    public fun <T> flow(k: PrefKey<T>): Flow<T> = store.data.map { it[prefKey(k)] ?: k.default }
    public suspend fun <T> get(k: PrefKey<T>): T = flow(k).first()
    public suspend fun <T> set(k: PrefKey<T>, value: T) { store.edit { it[prefKey(k)] = value } }
    public suspend fun <T> remove(k: PrefKey<T>) { store.edit { it.remove(prefKey(k)) } }
    public suspend fun raw(name: String): String? = store.data.first()[stringPreferencesKey(name)]
    public suspend fun setRaw(name: String, value: String) { store.edit { it[stringPreferencesKey(name)] = value } }
    public suspend fun snapshot(): Map<String, Any> = store.data.first().asMap().mapKeys { it.key.name }
}

/** JSON documents in the schema-driven file layout: `<data>/<module>/documents/<collection>/<id>.json`. */
public class JsonDocumentStore(private val layout: FileLayout?, private val context: Context) {
    private fun dir(module: String, collection: String): File {
        val base = layout?.path(FileArea.DATA, module, "documents/$collection") ?: File(context.filesDir, "axf/$module/documents/$collection").absolutePath
        return File(base).apply { mkdirs() }
    }
    public fun read(module: String, collection: String, id: String): AxfResult<JsonObject> {
        val f = File(dir(module, collection), "$id.json")
        if (!f.exists()) return AxfResult.err(AxfFailure.NotFound("document", "$collection/$id"))
        return AxfResult.runCatching { ai.amberx.axf.kernel.asset.AxfJson.parseToJsonElement(f.readText()) as JsonObject }
    }
    public fun write(module: String, collection: String, id: String, doc: JsonObject): AxfResult<Unit> = AxfResult.runCatching { File(dir(module, collection), "$id.json").writeText(ai.amberx.axf.kernel.asset.AxfJson.encodeToString(JsonObject.serializer(), doc)) }
    public fun delete(module: String, collection: String, id: String): Boolean = File(dir(module, collection), "$id.json").delete()
    public fun list(module: String, collection: String): List<String> = dir(module, collection).listFiles { f -> f.extension == "json" }?.map { it.nameWithoutExtension }?.sorted() ?: emptyList()
    public fun exportAll(module: String): Map<String, Map<String, JsonObject>> = (dir(module, "").listFiles { f -> f.isDirectory } ?: emptyArray()).associate { c -> c.name to list(module, c.name).mapNotNull { id -> read(module, c.name, id).getOrNull()?.let { id to it } }.toMap() }
}

/** Disk layer for the kernel's QueryClient (`persist = true` queries survive process death). */
public class DocumentQueryPersistence(private val docs: JsonDocumentStore) : QueryPersistence {
    private val module = "axf.queries"
    override suspend fun read(key: String): Pair<String, Long>? = docs.read(module, "cache", key.safe()).getOrNull()?.let { (it["json"] as? kotlinx.serialization.json.JsonPrimitive)?.content?.let { j -> j to ((it["at"] as? kotlinx.serialization.json.JsonPrimitive)?.content?.toLongOrNull() ?: 0L) } }
    override suspend fun write(key: String, json: String, updatedAtMillis: Long) { docs.write(module, "cache", key.safe(), kotlinx.serialization.json.buildJsonObject { put("json", kotlinx.serialization.json.JsonPrimitive(json)); put("at", kotlinx.serialization.json.JsonPrimitive(updatedAtMillis)) }) }
    override suspend fun remove(key: String) { docs.delete(module, "cache", key.safe()) }
    private fun String.safe() = replace(Regex("[^A-Za-z0-9._-]"), "_")
}

/** One Room database per module (Foundations: f.dbstrategy). Modules register their RoomDatabase subclass here; the console lists them. */
public class DbRegistry(public val context: Context) {
    private val dbs = LinkedHashMap<String, androidx.room.RoomDatabase>()
    public fun <T : androidx.room.RoomDatabase> register(module: String, db: T): T { dbs[module] = db; return db }
    public fun get(module: String): androidx.room.RoomDatabase? = dbs[module]
    public fun modules(): List<String> = dbs.keys.toList()
    /** Builds a database at `<module>.db`; the module's migrations are passed in (and also recorded in the kernel migration ledger by the module). */
    public inline fun <reified T : androidx.room.RoomDatabase> build(module: String, vararg migrations: androidx.room.migration.Migration): T =
        androidx.room.Room.databaseBuilder(context, T::class.java, "$module.db").addMigrations(*migrations).build()
}
