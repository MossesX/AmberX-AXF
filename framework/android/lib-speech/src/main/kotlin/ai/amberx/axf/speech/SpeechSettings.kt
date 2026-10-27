package ai.amberx.axf.speech

import ai.amberx.axf.kernel.contract.SettingKind
import ai.amberx.axf.kernel.contract.SettingSpec
import ai.amberx.axf.kernel.contract.SettingsGroup
import ai.amberx.axf.kernel.speech.SpeakOptions
import ai.amberx.axf.kernel.speech.SpeechQueue
import kotlinx.serialization.json.JsonPrimitive

/**
 * The user's speech settings (Settings → Speech). Pure: [from] reads them through any key lookup (the kernel
 * Config in the app, a map in tests), so a bad stored value falls back to the default instead of failing.
 */
public data class SpeechSettings(
    /** read text aloud automatically ([AxfSpeech.read]); explicit [AxfSpeech.say] always speaks */
    val readAloud: Boolean = true,
    /** provider voice id; null = the engine's default voice */
    val voice: String? = null,
    /** 0.5..2.0 */
    val rate: Double = SpeechQueue.RATE_DEFAULT,
    /** 0.5..2.0 */
    val pitch: Double = PITCH_DEFAULT,
    /** BCP-47 tag; null = the phone's language */
    val language: String? = null,
    /** lower other apps' audio while reading (else ask them to pause) */
    val duck: Boolean = true,
) {
    /** What the player passes to the provider for an item without its own options. */
    public fun speakOptions(): SpeakOptions = SpeakOptions(voice = voice, rate = rate, pitch = pitch, language = language)

    public companion object {
        public const val READ_ALOUD: String = "axf.speech.readAloud"
        public const val VOICE: String = "axf.speech.voice"
        public const val RATE: String = "axf.speech.rate"
        public const val PITCH: String = "axf.speech.pitch"
        public const val LANGUAGE: String = "axf.speech.language"
        public const val DUCK: String = "axf.speech.duck"
        public val KEYS: List<String> = listOf(READ_ALOUD, VOICE, RATE, PITCH, LANGUAGE, DUCK)
        public const val PITCH_DEFAULT: Double = 1.0

        /** Pitch uses the same 0.5..2.0 range (and rounding) as the rate. */
        public fun clampPitch(pitch: Double): Double = SpeechQueue.clampRate(pitch)

        /** Settings from a key lookup; anything missing or unreadable is the default. */
        public fun from(lookup: (String) -> String?): SpeechSettings {
            fun text(k: String): String? = lookup(k)?.trim()?.takeIf { it.isNotEmpty() && it != "default" && it != "system" }
            return SpeechSettings(
                readAloud = lookup(READ_ALOUD)?.trim()?.toBooleanStrictOrNull() ?: true,
                voice = text(VOICE),
                rate = lookup(RATE)?.trim()?.toDoubleOrNull()?.let { SpeechQueue.clampRate(it) } ?: SpeechQueue.RATE_DEFAULT,
                pitch = lookup(PITCH)?.trim()?.toDoubleOrNull()?.let { clampPitch(it) } ?: PITCH_DEFAULT,
                language = text(LANGUAGE),
                duck = lookup(DUCK)?.trim()?.toBooleanStrictOrNull() ?: true,
            )
        }

        /** Settings group "Speech" (id `speech`): read aloud, voice, speed, pitch, language, ducking. */
        public fun group(module: String = SpeechModule.ID): SettingsGroup = SettingsGroup("speech", "Speech", "play", module, order = 42, description = "How the app reads text out loud.", settings = listOf(
            SettingSpec(READ_ALOUD, "Read aloud", SettingKind.TOGGLE, "Read answers and notes out loud when an app asks to", JsonPrimitive(true)),
            SettingSpec(VOICE, "Voice", SettingKind.TEXT, "Voice id from the phone's text-to-speech engine; empty = its default voice", JsonPrimitive("")),
            SettingSpec(RATE, "Speed", SettingKind.SLIDER, "1 = normal; say \"faster\" or \"slower\" while it reads", JsonPrimitive(SpeechQueue.RATE_DEFAULT), min = SpeechQueue.RATE_MIN, max = SpeechQueue.RATE_MAX, step = 0.25),
            SettingSpec(PITCH, "Pitch", SettingKind.SLIDER, "1 = the voice's own pitch", JsonPrimitive(PITCH_DEFAULT), min = SpeechQueue.RATE_MIN, max = SpeechQueue.RATE_MAX, step = 0.05),
            SettingSpec(LANGUAGE, "Reading language", SettingKind.CHOICE, default = JsonPrimitive("system"), options = listOf("system" to "Phone language", "en-US" to "English (US)", "en-GB" to "English (UK)", "es-ES" to "Spanish", "fr-FR" to "French", "de-DE" to "German")),
            SettingSpec(DUCK, "Lower other audio while reading", SettingKind.TOGGLE, "Off: other apps pause instead", JsonPrimitive(true)),
        ))
    }
}
