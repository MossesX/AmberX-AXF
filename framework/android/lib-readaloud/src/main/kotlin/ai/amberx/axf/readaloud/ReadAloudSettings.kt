package ai.amberx.axf.readaloud

import ai.amberx.axf.kernel.contract.SettingKind
import ai.amberx.axf.kernel.contract.SettingSpec
import ai.amberx.axf.kernel.contract.SettingsGroup
import kotlinx.serialization.json.JsonPrimitive

/**
 * The read-aloud settings as generated settings groups (Voice, Speed & pitch, Pauses, Text, Reading in pieces, Queue,
 * Sound & interruptions, While reading, Timers & recovery), every slider using [ReadAloudRanges]. A plugin calls
 * [groups] with its own key prefix and settings tab; [ReadAloudPrefs.from] reads the same keys back.
 */
public object ReadAloudSettings {
    /** Languages offered in the picker; any BCP-47 tag typed into a TEXT setting also works. */
    public val LANGUAGES: List<Pair<String, String>> = listOf(
        "system" to "Phone language", "en-US" to "English (US)", "en-GB" to "English (UK)", "en-AU" to "English (Australia)", "en-IN" to "English (India)",
        "es-ES" to "Spanish (Spain)", "es-MX" to "Spanish (Mexico)", "fr-FR" to "French", "fr-CA" to "French (Canada)", "de-DE" to "German", "it-IT" to "Italian",
        "pt-BR" to "Portuguese (Brazil)", "pt-PT" to "Portuguese (Portugal)", "nl-NL" to "Dutch", "sv-SE" to "Swedish", "nb-NO" to "Norwegian", "da-DK" to "Danish",
        "fi-FI" to "Finnish", "pl-PL" to "Polish", "cs-CZ" to "Czech", "ru-RU" to "Russian", "uk-UA" to "Ukrainian", "tr-TR" to "Turkish", "el-GR" to "Greek",
        "ar-SA" to "Arabic", "he-IL" to "Hebrew", "hi-IN" to "Hindi", "ja-JP" to "Japanese", "ko-KR" to "Korean", "zh-CN" to "Chinese (Mandarin)", "zh-TW" to "Chinese (Taiwan)",
        "th-TH" to "Thai", "vi-VN" to "Vietnamese", "id-ID" to "Indonesian",
    )

    private fun slider(key: String, label: String, r: NumRange, description: String? = null, icon: String? = null) =
        SettingSpec(key, label, SettingKind.SLIDER, description, JsonPrimitive(r.default), min = r.min, max = r.max, step = r.step, icon = icon)
    private fun toggle(key: String, label: String, default: Boolean, description: String? = null, icon: String? = null) =
        SettingSpec(key, label, SettingKind.TOGGLE, description, JsonPrimitive(default), icon = icon)
    private fun choice(key: String, label: String, default: String, options: List<Pair<String, String>>, description: String? = null, icon: String? = null) =
        SettingSpec(key, label, SettingKind.CHOICE, description, JsonPrimitive(default), options = options, icon = icon)

    /** Every group, in order; [orderBase] spaces them so a plugin can put its own groups in between (step 10). */
    public fun groups(prefix: String, tab: String?, module: String, orderBase: Int = 100): List<SettingsGroup> {
        val k = ReadAloudKeys(prefix)
        val d = ReadAloudPrefs.DEFAULT
        val R = ReadAloudRanges
        fun group(id: String, label: String, icon: String, n: Int, description: String, settings: List<SettingSpec>) =
            SettingsGroup("${prefix}$id", label, icon, module, orderBase + n * 10, settings, description, tab)
        return listOf(
            group("voice", "Voice", "user", 0, "Which voice reads, and in what language.", listOf(
                SettingSpec(k.engine, "Speech engine", SettingKind.TEXT, "Package name of a text-to-speech engine, or empty for the phone's default (the screen lists the installed ones)", JsonPrimitive(""), icon = "box"),
                SettingSpec(k.voice, "Voice", SettingKind.TEXT, "Exact voice name, or empty to pick the best voice for the language (the screen lists every voice)", JsonPrimitive(""), icon = "user"),
                choice(k.language, "Language", d.language, LANGUAGES, "Used when no voice is named", "map"),
                toggle(k.preferOffline, "Prefer on-device voices", d.preferOffline, "Picks voices that work without the internet first"),
                toggle(k.allowNetworkVoices, "Allow online voices", d.allowNetworkVoices, "Some engines have better voices that need a connection"),
                choice(k.minQuality, "Lowest voice quality", "0", listOf("0" to "Any", "100" to "Very low and up", "200" to "Low and up", "300" to "Normal and up", "400" to "High and up", "500" to "Very high only")),
            )),
            group("speed", "Speed & pitch", "sliders", 1, "How fast, how high and how loud.", listOf(
                slider(k.rate, "Speed", R.RATE, "1.0 = normal; 0.1 (crawl) to 4.0 (chipmunk)"),
                slider(k.pitch, "Pitch", R.PITCH, "1.0 = normal; 0.25 (deep) to 4.0 (very high)"),
                slider(k.volume, "Volume", R.VOLUME, "Relative to the phone's media volume, 0–100%"),
                slider(k.pan, "Left / right", R.PAN, "-1 = left ear only, 0 = centre, 1 = right ear only"),
                slider(k.slowRate, "\"Read slowly\" speed", R.SLOW_RATE, "Used by the Read slowly menu entry"),
                slider(k.rateStep, "Faster / slower step", R.RATE_STEP, "How much each tap on Faster or Slower changes the speed"),
                toggle(k.longTextBoost, "Speed up long texts", d.longTextBoost, "Reads long articles a little faster"),
                slider(k.longTextChars, "Long text starts at (characters)", R.LONG_TEXT),
                slider(k.longTextRate, "Long text speed", R.LONG_RATE),
            )),
            group("pauses", "Pauses", "pause", 2, "Breathing room between pieces.", listOf(
                slider(k.startDelay, "Wait before starting (ms)", R.START_DELAY),
                slider(k.sentencePause, "After a sentence (ms)", R.SENTENCE_PAUSE),
                slider(k.clausePause, "After a comma (ms, clause mode)", R.CLAUSE_PAUSE),
                slider(k.paragraphPause, "After a paragraph (ms)", R.PARAGRAPH_PAUSE),
            )),
            group("text", "Text cleanup", "type", 3, "What gets read and what gets skipped.", listOf(
                choice(k.urls, "Links", d.urls.id, listOf("read" to "Read the whole address", "domain" to "Say \"link to\" + the site", "link" to "Just say \"link\"", "skip" to "Skip them"), icon = "link"),
                choice(k.emoji, "Emoji", d.emoji.id, listOf("skip" to "Skip", "keep" to "Let the voice describe them")),
                choice(k.numbers, "Long numbers", d.numbers.id, listOf("natural" to "As numbers (one hundred twenty)", "digits" to "Digit by digit (one two zero)")),
                toggle(k.stripMarkdown, "Drop formatting symbols", d.stripMarkdown, "Asterisks, headings, bullets, code marks"),
                toggle(k.skipBrackets, "Skip text in brackets", d.skipBrackets, "(asides like this) and [references]"),
                toggle(k.dropHashSigns, "Drop # and @ signs", d.dropHashSigns, "#hashtag reads as hashtag, @name as name"),
                toggle(k.expandAbbreviations, "Say abbreviations in full", d.expandAbbreviations, "e.g. → for example, Dr. → Doctor"),
                toggle(k.spellCaps, "Spell short ALL-CAPS words", d.spellCaps, "NASA → N A S A"),
                toggle(k.joinHyphenatedLines, "Join words split across lines", d.joinHyphenatedLines),
                toggle(k.readPunctuation, "Read punctuation out loud", d.readPunctuation, "Says comma, question mark, quote…"),
                toggle(k.spellOut, "Spell everything letter by letter", d.spellOut, "For codes, passwords and names"),
                SettingSpec(k.pronunciations, "Pronunciations", SettingKind.TEXT, "word=say it like this; one pair per line or separated by ;", JsonPrimitive(""), icon = "edit"),
                slider(k.maxChars, "Longest text (characters)", R.MAX_CHARS),
                choice(k.overLimit, "Text longer than that", d.overLimit.id, listOf("sentence" to "Read up to the last full sentence", "cut" to "Cut exactly at the limit", "refuse" to "Don't read it")),
            )),
            group("chunks", "Reading in pieces", "layers", 4, "How text is split for the voice (and for highlighting).", listOf(
                choice(k.chunk, "Split by", d.chunk.id, listOf("sentence" to "Sentence", "clause" to "Clause (commas too)", "line" to "Line", "paragraph" to "Paragraph", "fixed" to "Fixed length")),
                slider(k.maxUtterance, "Longest piece (characters)", R.MAX_UTTERANCE, "Longer pieces are split on a space"),
                choice(k.skipUnit, "Back / Next jump", d.skipUnit.id, listOf("sentence" to "One piece", "paragraph" to "One paragraph")),
            )),
            group("queue", "Queue", "list", 5, "What happens when you pick more text while it's reading.", listOf(
                choice(k.queue, "New text while reading", d.queue.id, listOf("replace" to "Stop and read the new text", "append" to "Add it to the end of the queue", "next" to "Read it next")),
                slider(k.queueSize, "Queue size", R.QUEUE_SIZE),
                slider(k.history, "Keep history (items)", R.HISTORY),
                choice(k.repeat, "Repeat", d.repeat.id, listOf("off" to "Off", "times" to "A number of times", "loop" to "Forever")),
                slider(k.repeatTimes, "Read it this many times", R.REPEAT_TIMES),
            )),
            group("audio", "Sound & interruptions", "mic", 6, "Which sound stream it plays on and what it does around other sound.", listOf(
                choice(k.usage, "Play as", d.usage.id, listOf("media" to "Media", "accessibility" to "Accessibility", "assistant" to "Assistant", "navigation" to "Navigation guidance", "notification" to "Notification", "alarm" to "Alarm")),
                choice(k.focus, "Other sound while reading", d.focus.id, listOf("duck" to "Lower it", "pause" to "Pause it", "none" to "Leave it alone")),
                choice(k.onFocusLoss, "When something else plays", d.onFocusLoss.id, listOf("pause" to "Pause reading", "stop" to "Stop reading", "keep" to "Keep reading")),
                toggle(k.resumeAfterFocus, "Carry on afterwards", d.resumeAfterFocus, "After a call or another app's sound ends"),
                toggle(k.pauseOnUnplug, "Pause when headphones come out", d.pauseOnUnplug),
            )),
            group("reading", "While reading", "eye", 7, "The notification and the live view.", listOf(
                choice(k.highlight, "Highlight", d.highlight.id, listOf("word" to "Each word", "sentence" to "The sentence", "none" to "Nothing")),
                choice(k.controls, "Notification controls", d.controls.id, listOf("full" to "Back, pause, next, slower, faster", "compact" to "Pause and stop", "none" to "None")),
                toggle(k.showSentence, "Show the sentence being read", d.showSentence, "In the notification (lock screen shows only the title)"),
                toggle(k.showProgress, "Show progress", d.showProgress),
            )),
            group("timers", "Timers & recovery", "clock", 8, "Stopping by itself, and what to do when the voice trips.", listOf(
                slider(k.sleep, "Sleep timer (minutes, 0 = off)", R.SLEEP),
                toggle(k.stopOnScreenOff, "Stop when the screen turns off", d.stopOnScreenOff),
                slider(k.initTimeout, "Wait for the voice to start (ms)", R.INIT_TIMEOUT),
                slider(k.retries, "Retries when a piece fails", R.RETRIES),
            )),
        )
    }

    /** Every key the groups use (for export, reset and search). */
    public fun keys(prefix: String): List<String> = groups(prefix, null, "x").flatMap { g -> g.settings.map { it.key } }
}
