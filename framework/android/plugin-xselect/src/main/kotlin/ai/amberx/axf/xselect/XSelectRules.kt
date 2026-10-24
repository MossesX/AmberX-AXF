package ai.amberx.axf.xselect

/*
 * X Select's own rules, pure Kotlin (tested by XSelectRulesTest): which selection-menu entries show, what each entry
 * does, and what the axHub status badge says.
 */

/** One entry in the text selection menu: its activity-alias, and what tapping it does. */
public data class MenuEntry(val alias: String, val label: String, val slow: Boolean = false, val readNext: Boolean = false, val spell: Boolean = false)

public object XSelectMenu {
    public const val PKG: String = "ai.amberx.axf.xselect.menu."
    /** Main entry, one of these labels (only the chosen one shows). */
    public val MAIN: List<MenuEntry> = listOf(MenuEntry("ReadAloud", "Read aloud"), MenuEntry("ReadOutLoud", "Read out loud"), MenuEntry("Speak", "Speak"), MenuEntry("Listen", "Listen"))
    public val SLOW: MenuEntry = MenuEntry("ReadSlowly", "Read slowly", slow = true)
    public val NEXT: MenuEntry = MenuEntry("ReadNext", "Read next", readNext = true)
    public val SPELL: MenuEntry = MenuEntry("SpellOut", "Spell it out", spell = true)
    public val ALL: List<MenuEntry> = MAIN + listOf(SLOW, NEXT, SPELL)

    public fun entry(alias: String): MenuEntry = ALL.firstOrNull { it.alias == alias } ?: MAIN.first()

    /** Aliases that should be enabled: none when switched off, else the chosen main label + the extra entries picked. */
    public fun enabled(on: Boolean, mainLabel: String, slow: Boolean, next: Boolean, spell: Boolean): Set<String> {
        if (!on) return emptySet()
        val main = MAIN.firstOrNull { it.alias == mainLabel } ?: MAIN.first()
        return buildSet { add(main.alias); if (slow) add(SLOW.alias); if (next) add(NEXT.alias); if (spell) add(SPELL.alias) }
    }

    /** "Spell it out" reads characters one by one: letters and digits separated, spaces become a short pause. */
    public fun spelled(text: String): String = text.trim().split(Regex("\\s+")).filter { it.isNotEmpty() }.joinToString(". ") { w -> w.toCharArray().joinToString(" ") }

    /** The spoken intro when "Say how long it is" is on: "About 2 minutes." / "120 words." */
    public fun intro(words: Int, estimateMs: Long): String {
        val min = Math.round(estimateMs / 60_000.0).toInt()
        return if (min >= 2) "About $min minutes." else if (words == 1) "1 word." else "$words words."
    }
}

/** What the axHub badge shows; [tone] is a theme tone token (success, warning, danger, accent, muted). */
public data class HubBadgeView(val label: String, val tone: String, val icon: String, val tooltip: String)

public object XSelectBadge {
    /** [status] = lib-hub's HubFeedStatus id (ok, signed-out, not-admin, unreachable) or null before the first check. */
    public fun hub(status: String?, waiting: Int, compact: Boolean): HubBadgeView = when (status) {
        "ok" -> if (waiting > 0) HubBadgeView(if (compact) "$waiting" else "axHub · $waiting waiting", "accent", "shield", "axHub is up · $waiting approval${if (waiting == 1) "" else "s"} waiting")
                else HubBadgeView(if (compact) "Hub" else "axHub ✓", "success", "shield", "axHub is up and you're signed in")
        "not-admin" -> HubBadgeView(if (compact) "Hub" else "axHub ✓", "success", "shield", "axHub is up (signed in without admin rights)")
        "signed-out" -> HubBadgeView(if (compact) "Hub" else "axHub · sign in", "warning", "shield", "axHub is up but this app isn't signed in")
        "unreachable" -> HubBadgeView(if (compact) "Hub" else "axHub offline", "danger", "shield", "Can't reach axHub")
        else -> HubBadgeView(if (compact) "Hub" else "axHub …", "muted", "shield", "Checking axHub")
    }

    /** The read-aloud badge while something is being read: speed and position, or Paused. */
    public fun reading(paused: Boolean, rate: Double, position: Int, total: Int): HubBadgeView =
        if (paused) HubBadgeView("Paused", "warning", "pause", "Read aloud is paused")
        else HubBadgeView("Reading ${fmt(rate)}×", "accent", "mic", "Reading aloud · ${position + 1} of $total")

    public fun fmt(rate: Double): String = if (rate == Math.floor(rate)) "${rate.toInt()}" else String.format(java.util.Locale.US, "%.2f", rate).trimEnd('0')
}
