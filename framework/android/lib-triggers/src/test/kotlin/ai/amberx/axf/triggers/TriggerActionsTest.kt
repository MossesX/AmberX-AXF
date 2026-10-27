package ai.amberx.axf.triggers

import ai.amberx.axf.kernel.contract.SettingKind
import ai.amberx.axf.kernel.contract.SettingSpec
import ai.amberx.axf.kernel.contract.SettingsGroup
import ai.amberx.axf.kernel.engine.ActionMeta
import ai.amberx.axf.kernel.platform.MemoryKeyValueStore
import ai.amberx.axf.kernel.result.AxfResult
import ai.amberx.axf.kernel.triggers.SettingsActions
import ai.amberx.axf.kernel.triggers.TriggerArming
import ai.amberx.axf.kernel.triggers.TriggerKinds
import ai.amberx.axf.kernel.triggers.TriggerSource
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** Action picker catalog (tabs, cross-tab search with tab labels) and the add-trigger draft. */
class TriggerActionsTest {
    private val group = SettingsGroup("voice", "Voice", settings = listOf(
        SettingSpec("app.prompts", "Speak prompts", SettingKind.TOGGLE),
        SettingSpec("app.lang", "Language", SettingKind.CHOICE, options = listOf("en" to "English", "fr" to "French")),
        SettingSpec("app.token", "Token", SettingKind.SECRET),
    ))
    private val catalog = TriggerActionCatalog(
        TriggerActionCatalog.fromActions(listOf(
            "notes.add" to ActionMeta("Add note", module = "ai.amberx.notes"),
            "notes.delete" to ActionMeta("Delete note", module = "ai.amberx.notes"),
            "player.play" to ActionMeta("Play", module = "player"),
            "player.stub" to ActionMeta("Stub", module = "player", stub = true),
            "swap" to ActionMeta("Swap", module = "kernel", params = true),
            "plain" to ActionMeta("Not namespaced", module = "kernel"),
        )) + TriggerActionCatalog.fromSettings(listOf(group)),
    )

    @Test fun tabsAndFiltering() {
        val tabs = catalog.tabs()
        assertEquals(listOf("ai.amberx.notes", "player", TriggerActionCatalog.SETTINGS_TAB), tabs.map { it.id })
        assertEquals("Notes", tabs[0].label)
        assertEquals(2, tabs[0].count)
        assertEquals(listOf("Play"), catalog.inTab("player").map { it.label }) // stub left out
        assertTrue(catalog.choices.none { it.id == "plain" || it.id == "swap" })
        // toggle → toggle/on/off; choice → one per option; secret → nothing
        assertEquals(5, catalog.inTab(TriggerActionCatalog.SETTINGS_TAB).size)
    }

    @Test fun searchCrossesTabsAndSaysWhereFrom() {
        val hits = catalog.search("note")
        assertEquals(setOf("Add note", "Delete note"), hits.map { it.choice.label }.toSet())
        assertTrue(hits.all { it.tabLabel == "Notes" })
        val speak = catalog.search("speak")
        assertEquals(3, speak.size)
        assertTrue(speak.all { it.tabLabel == "Settings" })
        // label start ranks first
        assertEquals("Play", catalog.search("pl").first().choice.label)
        // every word must match; tab names count
        assertEquals(listOf("Language: French"), catalog.search("language fr").map { it.choice.label })
        assertEquals(2, catalog.search("voice language").size)
        assertTrue(catalog.search("   ").isEmpty())
        assertTrue(catalog.search("zzz").isEmpty())
    }

    @Test fun settingsChoicesCarryTheirArgs() {
        val off = catalog.choices.first { it.label == "Speak prompts: off" }
        assertEquals(SettingsActions.SET, off.id)
        assertEquals(JsonObject(mapOf("key" to JsonPrimitive("app.prompts"), "value" to JsonPrimitive(false))), off.args)
        assertEquals(off, catalog.find(SettingsActions.SET, off.args))
        assertEquals("Add note", catalog.find("notes.add")?.label)
        assertNull(catalog.find("nope.nope"))
    }

    @Test fun draftPhrasesAndReadiness() {
        var d = TriggerDraft()
        assertTrue(d.spoken)
        assertTrue(d.ready(AddTriggerStep.KIND))
        assertFalse(d.ready(AddTriggerStep.PHRASES))
        assertTrue(d.phraseError("<a> <b>").isNotEmpty())
        assertEquals("empty", d.phraseError("  "))
        d = d.addPhrase("note <text>").addPhrase("Note <text>").addPhrase("<bad")
        assertEquals(listOf("note <text>"), d.phrases)
        assertEquals("already added", d.phraseError("NOTE <text>"))
        assertTrue(d.ready(AddTriggerStep.PHRASES))
        assertFalse(d.ready(AddTriggerStep.ACTION))
        d = d.copy(action = catalog.find("notes.add"))
        assertTrue(d.ready(AddTriggerStep.DETAILS))
        assertEquals("note <text> → Add note", d.effectiveLabel())
    }

    @Test fun draftBuildsAValidCustomTrigger() {
        val off = catalog.choices.first { it.label == "Speak prompts: off" }
        val d = TriggerDraft(phrases = listOf("quiet please"), action = off, threshold = 120.0, worksIn = listOf("notes.editor"))
        val t = assertNotNull(d.build("custom.quiet").trigger)
        assertEquals(TriggerSource.CUSTOM, t.source)
        assertEquals(TriggerStore.CUSTOM_MODULE, t.module)
        assertEquals(99.99, t.threshold)
        assertEquals(off.args, t.args)
        assertEquals(TriggerArming.ALWAYS, t.arming)
        // gesture kind: signature ids, arming required by default
        val g = TriggerDraft(kind = TriggerKinds.GESTURE, phrases = listOf("open-palm"), action = catalog.find("player.play")).build("custom.palm").trigger
        assertEquals(TriggerArming.REQUIRED, assertNotNull(g).arming)
        // no action → invalid
        assertFalse(TriggerDraft(phrases = listOf("x")).build("custom.x").ok)
        // and the store accepts what the draft builds
        val store = TriggerStore(MemoryKeyValueStore())
        assertTrue(store.saveCustom(t) is AxfResult.Ok)
    }
}
