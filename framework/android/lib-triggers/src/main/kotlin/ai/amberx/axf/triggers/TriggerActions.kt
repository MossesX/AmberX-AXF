package ai.amberx.axf.triggers

import ai.amberx.axf.kernel.contract.SettingKind
import ai.amberx.axf.kernel.contract.SettingsGroup
import ai.amberx.axf.kernel.engine.ActionMeta
import ai.amberx.axf.kernel.triggers.Patterns
import ai.amberx.axf.kernel.triggers.SettingsActions
import ai.amberx.axf.kernel.triggers.TriggerValidation
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/*
 * What a trigger can fire, grouped in tabs, for the dense action picker. Pure (unit-tested): the picker's search bar
 * filters live across ALL tabs and every hit says which tab it comes from.
 */

/** One pickable action (an action id plus fixed args, e.g. a settings toggle carries its `key`). */
public data class TriggerActionChoice(
    val id: String,
    val label: String,
    /** tab id (open: a module id, `settings`, …) */
    val tab: String,
    val tabLabel: String,
    val args: JsonObject? = null,
    /** short second line: what it does, the setting key, … */
    val detail: String? = null,
    val icon: String? = null,
    /** extra words the search matches */
    val keywords: List<String> = emptyList(),
) {
    /** Stable key for lists (one action id can appear with different args). */
    public val key: String get() = if (args.isNullOrEmpty()) id else "$id?${args}"
}

public data class TriggerActionTab(val id: String, val label: String, val count: Int)

/** A search hit; [tabLabel] is shown on the row so a match from another tab is never a surprise. */
public data class TriggerActionHit(val choice: TriggerActionChoice, val score: Int) {
    public val tabLabel: String get() = choice.tabLabel
}

public class TriggerActionCatalog(choices: List<TriggerActionChoice>) {
    /** Only namespaced action ids can be fired by a trigger (triggers@1), others are left out. */
    public val choices: List<TriggerActionChoice> = choices.filter { TriggerValidation.isNamespacedId(it.id) }.distinctBy { it.key }

    public fun tabs(): List<TriggerActionTab> =
        choices.groupBy { it.tab }.map { (id, list) -> TriggerActionTab(id, list.first().tabLabel, list.size) }

    public fun inTab(tab: String): List<TriggerActionChoice> = choices.filter { it.tab == tab }

    /** The choice for an action id + args (the picker's current selection). */
    public fun find(id: String, args: JsonObject? = null): TriggerActionChoice? =
        choices.firstOrNull { it.id == id && (args.isNullOrEmpty() || it.args == args) } ?: choices.firstOrNull { it.id == id }

    /**
     * Live filter across every tab. Every query word must appear in the label, id, detail, tab or keywords; ranked by
     * label start (300) > a label word start (200) > anywhere in the label (100) > elsewhere (10), then by label.
     */
    public fun search(query: String, limit: Int = 200): List<TriggerActionHit> {
        val words = Patterns.normalize(query).split(' ').filter { it.isNotEmpty() }
        if (words.isEmpty()) return emptyList()
        val hits = ArrayList<TriggerActionHit>()
        for (c in choices) {
            val label = Patterns.normalize(c.label)
            val hay = listOf(label, c.id.lowercase(), Patterns.normalize(c.detail ?: ""), Patterns.normalize(c.tabLabel), c.keywords.joinToString(" ") { Patterns.normalize(it) }).joinToString(" ")
            if (!words.all { hay.contains(it) }) continue
            var score = 0
            val first = words[0]
            score += when {
                label.startsWith(first) -> 300
                label.split(' ').any { it.startsWith(first) } -> 200
                label.contains(first) -> 100
                else -> 10
            }
            score += words.drop(1).count { label.contains(it) } * 20
            hits += TriggerActionHit(c, score)
        }
        return hits.sortedWith(compareByDescending<TriggerActionHit> { it.score }.thenBy { it.choice.label.lowercase() }).take(limit)
    }

    public companion object {
        public const val SETTINGS_TAB: String = "settings"

        /** Choices from the action bus (`runtime.actions.list()`): argument-free, non-stub actions, a tab per module. */
        public fun fromActions(actions: List<Pair<String, ActionMeta>>, moduleLabel: (String) -> String = ::defaultModuleLabel): List<TriggerActionChoice> =
            actions.filter { (_, m) -> !m.stub && !m.params }.map { (id, m) -> TriggerActionChoice(id, m.label, m.module, moduleLabel(m.module), detail = id) }

        /**
         * Choices from settings groups: a toggle → "Toggle <label>" (axf.settings.toggle), on and off; a choice → one per
         * option (axf.settings.set). All in the Settings tab; secrets and links never.
         */
        public fun fromSettings(groups: List<SettingsGroup>): List<TriggerActionChoice> = groups.flatMap { g ->
            g.settings.flatMap { s ->
                val key = JsonPrimitive(s.key)
                val detail = "${g.label} · ${s.key}"
                when (s.kind) {
                    SettingKind.TOGGLE -> listOf(
                        TriggerActionChoice(SettingsActions.TOGGLE, "Toggle ${s.label}", SETTINGS_TAB, "Settings", JsonObject(mapOf("key" to key)), detail, "settings", listOf(g.label)),
                        TriggerActionChoice(SettingsActions.SET, "${s.label}: on", SETTINGS_TAB, "Settings", JsonObject(mapOf("key" to key, "value" to JsonPrimitive(true))), detail, "settings", listOf(g.label)),
                        TriggerActionChoice(SettingsActions.SET, "${s.label}: off", SETTINGS_TAB, "Settings", JsonObject(mapOf("key" to key, "value" to JsonPrimitive(false))), detail, "settings", listOf(g.label)),
                    )
                    SettingKind.CHOICE -> s.options.map { (v, l) ->
                        TriggerActionChoice(SettingsActions.SET, "${s.label}: $l", SETTINGS_TAB, "Settings", JsonObject(mapOf("key" to key, "value" to JsonPrimitive(v))), detail, "settings", listOf(g.label))
                    }
                    SettingKind.NUMBER, SettingKind.SLIDER -> listOf(
                        TriggerActionChoice(SettingsActions.SET, "Set ${s.label}", SETTINGS_TAB, "Settings", JsonObject(mapOf("key" to key)), "$detail · say the value in a <value:number> slot", "settings", listOf(g.label)),
                    )
                    else -> emptyList()
                }
            }
        }

        /** `ai.amberx.axf.voice` → "Voice", `notes` → "Notes". */
        public fun defaultModuleLabel(module: String): String =
            module.substringAfterLast('.').replace('-', ' ').replaceFirstChar { it.uppercase() }.ifEmpty { "App" }
    }
}
