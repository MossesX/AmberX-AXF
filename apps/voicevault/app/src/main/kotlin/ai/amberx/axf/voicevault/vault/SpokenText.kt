package ai.amberx.axf.voicevault.vault

import ai.amberx.axf.voice.PhraseMatcher

/** Turns what the recognizer heard into field text. Pure Kotlin. */
object SpokenText {
    private val dot = Regex("\\s+dot\\s+", RegexOption.IGNORE_CASE)
    private val spaces = Regex("\\s+")

    /** "Gmail dot com" → "gmail.com", "www.Netflix.com" → "netflix.com", "Bank of America" → "bank of america". */
    fun site(heard: String): String = heard.trim().replace(dot, ".").replace(spaces, " ").lowercase().removePrefix("www.").trim(' ', '.')

    /** Spoken passwords are kept as heard (trimmed); the user edits them before saving. */
    fun password(heard: String): String = heard.trim()

    /** Unlock codes compare as normalized words, so punctuation and case never matter. */
    fun code(heard: String): String = PhraseMatcher.normalize(heard)
}
