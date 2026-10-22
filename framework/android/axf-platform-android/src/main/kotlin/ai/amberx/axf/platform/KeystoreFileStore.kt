package ai.amberx.axf.platform

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

/** The file exists but can't be read with this phone's key (key reset, file damaged). Never treat it as "empty". */
public class KeystoreFileUnreadable(cause: Throwable) : Exception("The encrypted file can't be opened on this phone.", cause)

/**
 * One encrypted file: AES-256-GCM with a non-exportable Android Keystore key, written atomically ([AtomicFile]) to
 * `noBackupFilesDir/<fileName>`, so it is never in cloud backups or device transfers. Format: 12-byte IV + ciphertext
 * (with the 16-byte GCM tag). [erase] deletes the file and its key. Plaintext buffers the store makes are zeroed; the
 * caller owns (and should zero) the bytes it passes to [write]. Call from a background thread.
 *
 * Harvested from Voice Vault's vault store (Oct 2026): same format, so a file written before reads unchanged with the
 * same [fileName] and [keyAlias].
 *
 * [configureKey] customizes the key when it is first made. It is the hook for lib-lock's `axf.lock.keybound`
 * placeholder: `setUserAuthenticationRequired(true)` plus a BiometricPrompt `CryptoObject` around [decryptCipher] would
 * make every read need the fingerprint (not built: today the lock gates the UI and the key needs no auth).
 */
public class KeystoreFileStore(
    context: Context,
    public val fileName: String,
    public val keyAlias: String,
    private val configureKey: (KeyGenParameterSpec.Builder) -> Unit = {},
) {
    init {
        require(fileName.isNotEmpty() && fileName.none { it == '/' || it == '\\' } && fileName != "." && fileName != "..") { "fileName must be a plain file name" }
        require(keyAlias.isNotBlank()) { "keyAlias must not be blank" }
    }

    private val file = AtomicFile(File(context.applicationContext.noBackupFilesDir, fileName))

    public val exists: Boolean get() = file.baseFile.exists()

    /** Decrypted bytes, or null when there is no file. The caller zeroes them when done (or use [read] with a block). */
    public fun readBytes(): ByteArray? {
        if (!exists) return null
        val blob = runCatching { file.readFully() }.getOrElse { throw KeystoreFileUnreadable(it) }
        return runCatching { decrypt(blob) }.getOrElse { throw KeystoreFileUnreadable(it) }
    }

    /** Decrypts, hands the plaintext to [block], then zeroes it. Null when there is no file. Throws [KeystoreFileUnreadable]. */
    public fun <T> read(block: (ByteArray) -> T): T? {
        val plain = readBytes() ?: return null
        try { return block(plain) } finally { plain.fill(0) }
    }

    /** Encrypts [plain] and replaces the file atomically (a failed write leaves the old file). */
    public fun write(plain: ByteArray) {
        val out = file.startWrite()
        try { out.write(encrypt(plain)); file.finishWrite(out) } catch (t: Throwable) { file.failWrite(out); throw t }
    }

    /** Deletes the file and its key. Nothing written before can be read again. */
    public fun erase() {
        file.delete()
        runCatching { KeyStore.getInstance(KEYSTORE).apply { load(null) }.deleteEntry(keyAlias) }
    }

    /** A cipher ready to decrypt this file's current contents (for a future `CryptoObject`); null without a file. */
    public fun decryptCipher(): Cipher? {
        if (!exists) return null
        val blob = file.readFully()
        require(blob.size > IV) { "File is too short." }
        return Cipher.getInstance(TRANSFORM).apply { init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(TAG_BITS, blob, 0, IV)) }
    }

    private fun key(): SecretKey {
        val ks = KeyStore.getInstance(KEYSTORE).apply { load(null) }
        (ks.getKey(keyAlias, null) as? SecretKey)?.let { return it }
        val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE)
        val spec = KeyGenParameterSpec.Builder(keyAlias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256).setRandomizedEncryptionRequired(true)
        configureKey(spec)
        gen.init(spec.build())
        return gen.generateKey()
    }

    private fun encrypt(plain: ByteArray): ByteArray {
        val c = Cipher.getInstance(TRANSFORM).apply { init(Cipher.ENCRYPT_MODE, key()) }
        return c.iv + c.doFinal(plain)
    }

    private fun decrypt(blob: ByteArray): ByteArray {
        require(blob.size > IV) { "File is too short." }
        val c = Cipher.getInstance(TRANSFORM).apply { init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(TAG_BITS, blob, 0, IV)) }
        return c.doFinal(blob, IV, blob.size - IV)
    }

    private companion object {
        const val KEYSTORE = "AndroidKeyStore"
        const val TRANSFORM = "AES/GCM/NoPadding"
        const val IV = 12
        const val TAG_BITS = 128
    }
}
