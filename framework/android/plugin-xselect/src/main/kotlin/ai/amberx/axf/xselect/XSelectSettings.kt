package ai.amberx.axf.xselect

import ai.amberx.axf.hub.HubRules
import ai.amberx.axf.kernel.contract.SettingKind
import ai.amberx.axf.kernel.contract.SettingSpec
import ai.amberx.axf.kernel.contract.SettingsGroup
import ai.amberx.axf.readaloud.ReadAloudSettings
import kotlinx.serialization.json.JsonPrimitive

/** Every X Select setting: its own groups (menu, feedback, banner + badge, look) around lib-readaloud's nine. */
public object XSelectSettings {
    public const val PREFIX: String = "xselect."
    public const val TAB: String = "xselect"
    public const val ON: String = "xselect.enabled"
    public const val MAIN_LABEL: String = "xselect.menuLabel"
    public const val MENU_SLOW: String = "xselect.menuSlow"
    public const val MENU_NEXT: String = "xselect.menuNext"
    public const val MENU_SPELL: String = "xselect.menuSpell"
    public const val SELECTION_CAP: String = "xselect.selectionCap"
    public const val CONFIRM_OVER: String = "xselect.confirmOver"
    public const val TOAST_START: String = "xselect.toastStart"
    public const val ANNOUNCE: String = "xselect.announceLength"
    public const val SAY_TITLE: String = "xselect.sayTitle"
    public const val VIBRATE: String = "xselect.vibrate"
    public const val VIBRATE_MS: String = "xselect.vibrateMs"
    public const val CHIME: String = "xselect.chime"
    public const val CHIME_VOLUME: String = "xselect.chimeVolume"
    public const val HUB_BADGE: String = "xselect.hubBadge"
    public const val HUB_SIDE: String = "xselect.hubSide"
    public const val HUB_COMPACT: String = "xselect.hubCompact"
    public const val HUB_EVERY: String = "xselect.hubEveryMin"
    public const val HUB_ADDRESS: String = "xselect.hubAddress"
    public const val READING_BADGE: String = "xselect.readingBadge"
    public const val SCREEN_BANNER: String = "xselect.screenBanner"
    public const val SCREEN_TOOLBAR: String = "xselect.screenToolbar"
    public const val TONE: String = "xselect.highlightTone"
    public const val TEXT_SIZE: String = "xselect.textSize"
    public const val SHOW_VOICES: String = "xselect.showVoices"
    public const val SAMPLE: String = "xselect.sampleText"

    public const val DEFAULT_SAMPLE: String = "This is X Select. Pick any text on your phone, tap Read aloud next to Select all, and I'll read it to you."

    private fun toggle(k: String, l: String, d: Boolean, desc: String? = null, icon: String? = null) = SettingSpec(k, l, SettingKind.TOGGLE, desc, JsonPrimitive(d), icon = icon)
    private fun slider(k: String, l: String, d: Double, min: Double, max: Double, step: Double, desc: String? = null) = SettingSpec(k, l, SettingKind.SLIDER, desc, JsonPrimitive(d), min = min, max = max, step = step)
    private fun choice(k: String, l: String, d: String, o: List<Pair<String, String>>, desc: String? = null, icon: String? = null) = SettingSpec(k, l, SettingKind.CHOICE, desc, JsonPrimitive(d), options = o, icon = icon)

    public fun groups(module: String): List<SettingsGroup> = listOf(
        // First group of the tab: its label names the Settings → Plugins sub-tab.
        SettingsGroup("xselect.menu", "X Select", "mic", module, 100, listOf(
            SettingSpec("xselect.open", "Open X Select", SettingKind.LINK, "Test voice, live banner, voices and every setting on one screen", target = XSelectModule.ROUTE, icon = "mic"),
            toggle(ON, "Read aloud in the text menu", true, "Shows the entry next to Select all in every app", "mic"),
            choice(MAIN_LABEL, "Menu label", "ReadAloud", XSelectMenu.MAIN.map { it.alias to it.label }),
            toggle(MENU_SLOW, "Also show \"Read slowly\"", false),
            toggle(MENU_NEXT, "Also show \"Read next\"", false, "Adds the text after what's being read instead of stopping it"),
            toggle(MENU_SPELL, "Also show \"Spell it out\"", false, "Letter by letter, for codes and names"),
            slider(SELECTION_CAP, "Longest selection taken (characters)", 100_000.0, 100.0, 500_000.0, 100.0),
            slider(CONFIRM_OVER, "Ask first above (characters, 0 = never)", 0.0, 0.0, 100_000.0, 500.0),
        ), "The entries X Select adds to every app's text selection menu.", TAB),
    ) + ReadAloudSettings.groups(PREFIX, TAB, module, orderBase = 110) + listOf(
        SettingsGroup("xselect.feedback", "Feedback", "bell", module, 200, listOf(
            toggle(TOAST_START, "Show a note when reading starts", true),
            toggle(ANNOUNCE, "Say how long it is first", false, "\"120 words.\" or \"About 3 minutes.\""),
            toggle(SAY_TITLE, "Read the first line as a title first", false),
            toggle(VIBRATE, "Vibrate when it starts", false),
            slider(VIBRATE_MS, "Vibration length (ms)", 30.0, 5.0, 400.0, 5.0),
            toggle(CHIME, "Play a chime when it starts", false),
            slider(CHIME_VOLUME, "Chime volume", 60.0, 0.0, 100.0, 5.0),
        ), "Signs that it heard you.", TAB),
        SettingsGroup("xselect.banner", "Banner & badge", "flag", module, 210, listOf(
            toggle(HUB_BADGE, "axHub status badge on the banner", true, "Green when axHub is up, amber when signed out, red when unreachable", "shield"),
            choice(HUB_SIDE, "Badge side", "right", listOf("left" to "Left", "center" to "Centre", "right" to "Right")),
            toggle(HUB_COMPACT, "Short badge", false, "Just an icon and a word"),
            slider(HUB_EVERY, "Check axHub every (minutes)", 5.0, 1.0, 60.0, 1.0),
            SettingSpec(HUB_ADDRESS, "axHub address", SettingKind.TEXT, "https only", JsonPrimitive(HubRules.DEFAULT), icon = "link"),
            toggle(READING_BADGE, "\"Reading\" badge while it reads", true),
            toggle(SCREEN_BANNER, "Live banner on this screen", true, "Shows what's being read, with the word highlighted"),
            toggle(SCREEN_TOOLBAR, "Toolbar on this screen", true),
        ), "What X Select puts on the app's banner and its own screen.", TAB),
        SettingsGroup("xselect.look", "Look", "palette", module, 220, listOf(
            choice(TONE, "Highlight colour", "accent", listOf("accent" to "Accent", "success" to "Green", "warning" to "Amber", "danger" to "Red")),
            slider(TEXT_SIZE, "Live text size", 1.0, 0.8, 2.0, 0.05),
            toggle(SHOW_VOICES, "List installed voices on this screen", true),
            SettingSpec(SAMPLE, "Test sentence", SettingKind.TEXT, "What Test voice reads", JsonPrimitive(DEFAULT_SAMPLE), icon = "edit"),
        ), "How the X Select screen looks.", TAB),
    )
}
