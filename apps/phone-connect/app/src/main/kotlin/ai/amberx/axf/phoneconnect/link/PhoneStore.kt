package ai.amberx.axf.phoneconnect.link

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import java.security.SecureRandom

/**
 * What the app keeps between runs, encrypted (EncryptedSharedPreferences, key in the Android keystore): the device id
 * (made once), the device token from pairing (never shown, never logged), the console origin and the hub address.
 */
class PhoneStore(context: Context) {
    private val prefs: SharedPreferences = run {
        val key = MasterKey.Builder(context.applicationContext).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build()
        EncryptedSharedPreferences.create(
            context.applicationContext, FILE, key,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    }

    val deviceId: String
        get() = prefs.getString(K_DEVICE, null)?.takeIf { LinkRules.isDeviceId(it) } ?: newDeviceId().also { prefs.edit().putString(K_DEVICE, it).apply() }

    var token: String?
        get() = prefs.getString(K_TOKEN, null)?.takeIf { LinkRules.isToken(it) }
        set(v) { prefs.edit().apply { if (v == null) remove(K_TOKEN) else putString(K_TOKEN, v) }.apply() }

    var origin: String
        get() = prefs.getString(K_ORIGIN, null) ?: LinkRules.DEFAULT_ORIGIN
        set(v) { prefs.edit().putString(K_ORIGIN, v).apply() }

    var hub: String
        get() = prefs.getString(K_HUB, null) ?: LinkRules.DEFAULT_HUB
        set(v) { prefs.edit().putString(K_HUB, v).apply() }

    var watch: Boolean
        get() = prefs.getBoolean(K_WATCH, true)
        set(v) { prefs.edit().putBoolean(K_WATCH, v).apply() }

    /** "Let the console listen once": Brett's opt-in for voice.listen; off by default, never set by a command. */
    var listen: Boolean
        get() = prefs.getBoolean(K_LISTEN, false)
        set(v) { prefs.edit().putBoolean(K_LISTEN, v).apply() }

    val paired: Boolean get() = token != null

    fun unpair() { token = null }

    companion object {
        private const val FILE = "phone-connect.secure"
        private const val K_DEVICE = "deviceId"
        private const val K_TOKEN = "deviceToken"
        private const val K_ORIGIN = "origin"
        private const val K_HUB = "hub"
        private const val K_WATCH = "watch"
        private const val K_LISTEN = "listen"

        fun newDeviceId(): String {
            val b = ByteArray(8)
            SecureRandom().nextBytes(b)
            return "phone-" + b.joinToString("") { String.format("%02x", it.toInt() and 0xff) }
        }
    }
}
