package ai.amberx.axf.platform

import android.content.Context
import android.content.SharedPreferences
import ai.amberx.axf.kernel.migrate.MigrationLedger
import ai.amberx.axf.kernel.migrate.MigrationScope
import ai.amberx.axf.kernel.platform.KeyValueStore
import ai.amberx.axf.kernel.platform.SecureStore
import ai.amberx.axf.kernel.result.AxfResult
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Synchronous [KeyValueStore] on SharedPreferences. The kernel reads it on the main thread at startup
 * (active assets + role), so it must answer without suspending; DataStore is used by axf-data/lib-settings
 * for everything that can be asynchronous.
 */
public class SharedPrefsKeyValueStore(context: Context, name: String = "axf.kv") : KeyValueStore {
    private val prefs: SharedPreferences = context.applicationContext.getSharedPreferences(name, Context.MODE_PRIVATE)
    override fun get(key: String): String? = prefs.getString(key, null)
    override fun put(key: String, value: String) { prefs.edit().putString(key, value).apply() }
    override fun remove(key: String) { prefs.edit().remove(key).apply() }
    override fun keys(): Set<String> = prefs.all.keys.toSet()
}

/** Keystore-backed [SecureStore] on EncryptedSharedPreferences (AES256-GCM values, AES256-SIV keys). */
public class EncryptedSecureStore(context: Context, name: String = "axf.secure", private val io: CoroutineDispatcher = Dispatchers.IO) : SecureStore {
    private val appContext = context.applicationContext
    private val prefs: SharedPreferences by lazy {
        val masterKey = MasterKey.Builder(appContext).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build()
        EncryptedSharedPreferences.create(
            appContext, name, masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    }

    override suspend fun get(key: String): AxfResult<String?> = withContext(io) { AxfResult.runCatching { prefs.getString(key, null) } }
    override suspend fun put(key: String, value: String): AxfResult<Unit> = withContext(io) {
        AxfResult.runCatching { if (!prefs.edit().putString(key, value).commit()) throw IllegalStateException("secure store write failed") }
    }
    override suspend fun remove(key: String): AxfResult<Unit> = withContext(io) { AxfResult.runCatching { prefs.edit().remove(key).commit(); Unit } }
}

/** Records applied migrations per scope in SharedPreferences (`<scope>` → string set of ids). */
public class SharedPrefsMigrationLedger(context: Context, name: String = "axf.migrations") : MigrationLedger {
    private val prefs: SharedPreferences = context.applicationContext.getSharedPreferences(name, Context.MODE_PRIVATE)
    override suspend fun applied(scope: MigrationScope): Set<String> = prefs.getStringSet(scope.name, emptySet())?.toSet() ?: emptySet()
    override suspend fun markApplied(scope: MigrationScope, id: String, version: String) {
        val set = (prefs.getStringSet(scope.name, emptySet()) ?: emptySet()).toMutableSet()
        set += id
        prefs.edit().putStringSet(scope.name, set).putString("${scope.name}.version", version).apply()
    }
    /** Last version a scope was migrated to (null when nothing ran yet). */
    public fun versionOf(scope: MigrationScope): String? = prefs.getString("${scope.name}.version", null)
}
