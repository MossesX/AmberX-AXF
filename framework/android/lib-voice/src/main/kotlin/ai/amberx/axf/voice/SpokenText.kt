package ai.amberx.axf.voice

/**
 * Turns what the recognizer heard into field text. Pure Kotlin (no Android imports), so other ports can mirror it.
 * Harvested from Voice Vault (Oct 2026); behaviour unchanged.
 */
public object SpokenText {
    private val dot = Regex("\\s+dot\\s+", RegexOption.IGNORE_CASE)
    private val spaces = Regex("\\s+")

    /** "Gmail dot com" → "gmail.com", "www.Netflix.com" → "netflix.com", "Bank of America" → "bank of america". */
    public fun site(heard: String): String = heard.trim().replace(dot, ".").replace(spaces, " ").lowercase().removePrefix("www.").trim(' ', '.')

    /** Spoken passwords are kept as heard (trimmed); the user edits them before saving. */
    public fun password(heard: String): String = heard.trim()

    /**
     * Spoken codes (unlock phrases) compare as normalized words, so punctuation and case never matter:
     * "Purple, Monkey!" and "purple monkey" are the same code. Use it on both save and check
     * (lib-lock's `SecretKind.passphrase(SpokenText::code)`).
     */
    public fun code(heard: String): String = PhraseMatcher.normalize(heard)
}
