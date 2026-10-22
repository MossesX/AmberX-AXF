package ai.amberx.axf.voicevault.vault

import android.content.Context
import ai.amberx.axf.platform.KeystoreFileStore
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long

/** One saved login. Lives in memory only while the vault is unlocked. */
data class VaultEntry(val id: String, val site: String, val password: String, val updatedAt: Long) {
    /** Never prints the password (logs, crash reports, state dumps). */
    override fun toString(): String = "VaultEntry(id=$id, site=$site)"
}

/** The vault file can't be read with this phone's key (key reset, file damaged). */
class VaultUnreadable(cause: Throwable) : Exception("The vault can't be opened on this phone.", cause)

/**
 * The vault on disk: the framework's [KeystoreFileStore] (AES-256-GCM, non-exportable Keystore key, atomic writes in
 * `noBackupFilesDir`, so never in backups or device transfers) holding `{"v":1,"entries":[…]}`. Same file name and
 * key alias as before the harvest, so existing vaults open unchanged. Call from a background thread.
 */
class VaultStore(context: Context) {
    private val file = KeystoreFileStore(context, FILE, ALIAS)

    val exists: Boolean get() = file.exists

    fun load(): List<VaultEntry> {
        val parsed = try {
            file.read { plain ->
                val doc = Json.parseToJsonElement(plain.decodeToString()).jsonObject
                doc["entries"]?.jsonArray.orEmpty().map { e ->
                    val o = e.jsonObject
                    VaultEntry(o.getValue("id").jsonPrimitive.content, o.getValue("site").jsonPrimitive.content, o.getValue("password").jsonPrimitive.content, o["updated"]?.jsonPrimitive?.long ?: 0L)
                }
            }
        } catch (t: Throwable) { throw VaultUnreadable(t) }
        return parsed ?: emptyList()
    }

    fun save(entries: List<VaultEntry>) {
        val doc = JsonObject(mapOf("v" to JsonPrimitive(1), "entries" to JsonArray(entries.map { e ->
            JsonObject(mapOf("id" to JsonPrimitive(e.id), "site" to JsonPrimitive(e.site), "password" to JsonPrimitive(e.password), "updated" to JsonPrimitive(e.updatedAt)))
        })))
        val plain = doc.toString().encodeToByteArray()
        try { file.write(plain) } finally { plain.fill(0) }
    }

    /** Deletes the vault file and its key (used when the vault can't be opened any more). */
    fun erase() = file.erase()

    private companion object {
        const val FILE = "vault.bin"
        const val ALIAS = "voicevault.vault.v1"
    }
}
