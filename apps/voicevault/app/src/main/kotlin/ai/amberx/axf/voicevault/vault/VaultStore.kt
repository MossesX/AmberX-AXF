package ai.amberx.axf.voicevault.vault

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.AtomicFile
import java.io.File
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long

/** One saved login. Lives in memory only while the vault is unlocked. */
data class VaultEntry(val id: String, val site: String, val password: String, val updatedAt: Long)

/** The vault file can't be read with this phone's key (key reset, file damaged). */
class VaultUnreadable(cause: Throwable) : Exception("The vault can't be opened on this phone.", cause)

/**
 * Encrypted vault on disk: AES-256-GCM with a non-exportable Android Keystore key, written atomically
 * to `noBackupFilesDir/vault.bin` (never in cloud backups or device transfers). Format: 12-byte IV +
 * ciphertext of `{"v":1,"entries":[…]}`. Call from a background thread.
 */
class VaultStore(context: Context) {
    private val file = AtomicFile(File(context.noBackupFilesDir, FILE))

    val exists: Boolean get() = file.baseFile.exists()

    fun load(): List<VaultEntry> {
        if (!exists) return emptyList()
        val bytes = runCatching { file.readFully() }.getOrElse { throw VaultUnreadable(it) }
        val plain = runCatching { decrypt(bytes) }.getOrElse { throw VaultUnreadable(it) }
        try {
            val doc = Json.parseToJsonElement(plain.decodeToString()).jsonObject
            return doc["entries"]?.jsonArray.orEmpty().map { e ->
                val o = e.jsonObject
                VaultEntry(o.getValue("id").jsonPrimitive.content, o.getValue("site").jsonPrimitive.content, o.getValue("password").jsonPrimitive.content, o["updated"]?.jsonPrimitive?.long ?: 0L)
            }
        } catch (t: Throwable) { throw VaultUnreadable(t) } finally { plain.fill(0) }
    }

    fun save(entries: List<VaultEntry>) {
        val doc = JsonObject(mapOf("v" to JsonPrimitive(1), "entries" to JsonArray(entries.map { e ->
            JsonObject(mapOf("id" to JsonPrimitive(e.id), "site" to JsonPrimitive(e.site), "password" to JsonPrimitive(e.password), "updated" to JsonPrimitive(e.updatedAt)))
        })))
        val plain = doc.toString().encodeToByteArray()
        val out = file.startWrite()
        try { out.write(encrypt(plain)); file.finishWrite(out) } catch (t: Throwable) { file.failWrite(out); throw t } finally { plain.fill(0) }
    }

    /** Deletes the vault file and its key (used when the vault can't be opened any more). */
    fun erase() {
        file.delete()
        runCatching { KeyStore.getInstance(KEYSTORE).apply { load(null) }.deleteEntry(ALIAS) }
    }

    private fun key(): SecretKey {
        val ks = KeyStore.getInstance(KEYSTORE).apply { load(null) }
        (ks.getKey(ALIAS, null) as? SecretKey)?.let { return it }
        val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE)
        gen.init(KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256).setRandomizedEncryptionRequired(true).build())
        return gen.generateKey()
    }

    private fun encrypt(plain: ByteArray): ByteArray {
        val c = Cipher.getInstance(TRANSFORM).apply { init(Cipher.ENCRYPT_MODE, key()) }
        return c.iv + c.doFinal(plain)
    }

    private fun decrypt(blob: ByteArray): ByteArray {
        require(blob.size > IV) { "Vault file is too short." }
        val c = Cipher.getInstance(TRANSFORM).apply { init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, blob, 0, IV)) }
        return c.doFinal(blob, IV, blob.size - IV)
    }

    private companion object {
        const val FILE = "vault.bin"
        const val KEYSTORE = "AndroidKeyStore"
        const val ALIAS = "voicevault.vault.v1"
        const val TRANSFORM = "AES/GCM/NoPadding"
        const val IV = 12
    }
}
