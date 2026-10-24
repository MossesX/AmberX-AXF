package ai.amberx.axf.voicevault.sync

import ai.amberx.axf.kernel.contract.SettingKind
import ai.amberx.axf.kernel.contract.SettingSpec
import ai.amberx.axf.kernel.engine.AppearanceSourceState
import ai.amberx.axf.voicevault.notes.VoiceNotes
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** The same rules as the web lib-hubsync (`framework/spec/check-hubsync.mts`): both sides must agree on the hub's files. */
class HubSyncRulesTest {
    private fun spec(key: String, kind: SettingKind) = SettingSpec(key, key, kind)

    @Test fun lookModes() {
        assertEquals("follow", HubSyncRules.look(null))
        assertEquals("follow", HubSyncRules.look("nope"))
        assertEquals("required", HubSyncRules.look("required"))
    }

    @Test fun settingsFileMatchesWeb() {
        assertEquals("settings/apps/voice-vault.json", HubSyncRules.settingsFile("voice-vault"))
        assertEquals("settings/apps/app.json", HubSyncRules.settingsFile("../x"))
    }

    @Test fun followNeverWaits() {
        assertTrue(HubSyncRules.followState(AppearanceSourceState.Unauthorized("signed out")) is AppearanceSourceState.Ready)
        assertEquals("\"3\"", (HubSyncRules.followState(AppearanceSourceState.Ready("\"3\"")) as AppearanceSourceState.Ready).version)
    }

    @Test fun onlySafeSettingsGo() {
        assertTrue(HubSyncRules.mirrored(spec("voicevault.handsFree", SettingKind.TOGGLE)))
        assertFalse(HubSyncRules.mirrored(spec("x.token", SettingKind.SECRET)))
        assertFalse(HubSyncRules.mirrored(spec("x.link", SettingKind.LINK)))
        assertFalse(HubSyncRules.mirrored(spec(HubSyncRules.KEY_LOOK, SettingKind.CHOICE)))
        assertFalse(HubSyncRules.mirrored(spec(VoiceNotes.KEY_HUB, SettingKind.TEXT)))
    }

    @Test fun valuesTypedLikeTheWeb() {
        assertEquals(JsonPrimitive(false), HubSyncRules.toHub(spec("a", SettingKind.TOGGLE), JsonPrimitive("false")))
        assertEquals(JsonPrimitive(30L), HubSyncRules.toHub(spec("a", SettingKind.NUMBER), JsonPrimitive("30")))
        assertEquals(JsonPrimitive("30"), HubSyncRules.toHub(spec("a", SettingKind.CHOICE), JsonPrimitive("30")))
        assertTrue(HubSyncRules.same(JsonPrimitive("true"), JsonPrimitive(true)))
    }

    @Test fun documentRoundTrip() {
        val doc = HubSyncRules.mergeDoc(null, mapOf("a" to JsonPrimitive(true), "b" to JsonPrimitive("x")), "voice-vault", "2026-10-24T00:00:00Z")
        assertEquals("hub-settings@1", (doc["\$axf"] as JsonPrimitive).content)
        val next = HubSyncRules.mergeDoc(doc, mapOf("b" to null), "voice-vault", "t")
        assertEquals(setOf("a"), HubSyncRules.valuesOf(next).keys)
        assertTrue(HubSyncRules.valuesOf(JsonObject(mapOf("values" to JsonObject(emptyMap())))).isEmpty())
    }
}
