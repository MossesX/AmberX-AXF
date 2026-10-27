package ai.amberx.axf.triggers

import ai.amberx.axf.kernel.config.Config
import ai.amberx.axf.kernel.contract.SettingKind
import ai.amberx.axf.kernel.contract.SettingSpec
import ai.amberx.axf.kernel.platform.MemoryKeyValueStore
import ai.amberx.axf.kernel.triggers.SettingChange
import ai.amberx.axf.kernel.triggers.SettingPhrase
import ai.amberx.axf.kernel.triggers.SettingVoiceBinding
import ai.amberx.axf.voice.ArmingConfig
import ai.amberx.axf.voice.VoiceArming
import ai.amberx.axf.voice.VoiceResult
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertNotNull
import kotlin.test.assertNull

/** Setting voice bindings: value coercion per kind, and binding → trigger → fired command → setting write. */
class SettingsVoiceTest {
    private val toggle = SettingSpec("app.prompts", "Speak prompts", SettingKind.TOGGLE, default = JsonPrimitive(true))
    private val number = SettingSpec("app.volume", "Volume", SettingKind.NUMBER, default = JsonPrimitive(50), min = 0.0, max = 100.0)
    private val slider = SettingSpec("app.sensitivity", "Sensitivity", SettingKind.SLIDER, default = JsonPrimitive(0.5), min = 0.0, max = 1.0)
    private val choice = SettingSpec("app.lang", "Language", SettingKind.CHOICE, default = JsonPrimitive("system"), options = listOf("system" to "Phone language", "en-GB" to "English (UK)", "fr-FR" to "French"))
    private val secret = SettingSpec("app.token", "Token", SettingKind.SECRET)

    private fun write(change: SettingChange, spec: SettingSpec?, current: JsonPrimitive? = null) = SettingValues.resolve(change, spec, current)

    @Test fun togglesFlipTheCurrentValue() {
        assertEquals(SettingWrite.Write("app.prompts", JsonPrimitive(false)), write(SettingChange("app.prompts", toggle = true), toggle, JsonPrimitive(true)))
        assertEquals(SettingWrite.Write("app.prompts", JsonPrimitive(false)), write(SettingChange("app.prompts", toggle = true), toggle, null)) // default true
        assertEquals(SettingWrite.Write("app.prompts", JsonPrimitive(true)), write(SettingChange("app.prompts", toggle = true), toggle, JsonPrimitive("false")))
        assertIs<SettingWrite.Refused>(write(SettingChange("app.lang", toggle = true), choice))
    }

    @Test fun spokenOnOff() {
        assertEquals(SettingWrite.Write("app.prompts", JsonPrimitive(false)), write(SettingChange("app.prompts", JsonPrimitive("Off")), toggle))
        assertEquals(SettingWrite.Write("app.prompts", JsonPrimitive(true)), write(SettingChange("app.prompts", JsonPrimitive(true)), toggle))
        assertIs<SettingWrite.Refused>(write(SettingChange("app.prompts", JsonPrimitive("maybe")), toggle))
    }

    @Test fun numbersFromWordsAndDigitsAreClamped() {
        assertEquals(SettingWrite.Write("app.volume", JsonPrimitive(45.0)), write(SettingChange("app.volume", JsonPrimitive("forty five")), number))
        assertEquals(SettingWrite.Write("app.volume", JsonPrimitive(100.0)), write(SettingChange("app.volume", JsonPrimitive(150)), number))
        assertEquals(SettingWrite.Write("app.sensitivity", JsonPrimitive(0.7)), write(SettingChange("app.sensitivity", JsonPrimitive(70)), slider))
        assertEquals(SettingWrite.Write("app.sensitivity", JsonPrimitive(0.3)), write(SettingChange("app.sensitivity", JsonPrimitive("0.3")), slider))
        assertIs<SettingWrite.Refused>(write(SettingChange("app.volume", JsonPrimitive("loud")), number))
    }

    @Test fun choicesByIdLabelOrCloseLabel() {
        assertEquals(SettingWrite.Write("app.lang", JsonPrimitive("fr-FR")), write(SettingChange("app.lang", JsonPrimitive("french")), choice))
        assertEquals(SettingWrite.Write("app.lang", JsonPrimitive("en-GB")), write(SettingChange("app.lang", JsonPrimitive("english uk")), choice))
        assertEquals(SettingWrite.Write("app.lang", JsonPrimitive("en-GB")), write(SettingChange("app.lang", JsonPrimitive("englsh uk")), choice))
        assertIs<SettingWrite.Refused>(write(SettingChange("app.lang", JsonPrimitive("klingon")), choice))
    }

    @Test fun secretsAndMissingValuesAreRefused() {
        assertIs<SettingWrite.Refused>(write(SettingChange("app.token", JsonPrimitive("abc")), secret))
        assertIs<SettingWrite.Refused>(write(SettingChange("app.volume", null), number))
        // no spec: written as given
        assertEquals(SettingWrite.Write("x.y", JsonPrimitive("z")), write(SettingChange("x.y", JsonPrimitive("z")), null))
    }

    @Test fun bindingEndToEnd() = runBlocking {
        val config = Config()
        val specs = listOf(toggle, slider).associateBy { it.key }
        val store = TriggerStore(MemoryKeyValueStore())
        val bindings = SettingsVoiceBindings(store, ConfigSettingsAccess(config) { specs[it] })
        bindings.bind(SettingVoiceBinding("app.prompts", "app", "Speak prompts", listOf(SettingPhrase("prompts off", JsonPrimitive(false)), SettingPhrase("toggle prompts", toggle = true))))
        bindings.bind(SettingVoiceBinding("app.sensitivity", "app", "Sensitivity", listOf(SettingPhrase("sensitivity <value:number>"))))
        assertEquals(3, store.list.value.size)
        val decider = VoiceTriggerDecider(VoiceArming(ArmingConfig(alwaysArmed = true)))

        suspend fun say(text: String, at: Long): SettingWrite? {
            val cmd = assertNotNull(decider.onResult(VoiceResult(text, 0.95f, true), at, store.triggers(), "*", 0.5f).fired)
            return bindings.apply(cmd)
        }
        assertEquals(SettingWrite.Write("app.prompts", JsonPrimitive(false)), say("prompts off", 1_000))
        assertEquals(JsonPrimitive(false), config.get("app.prompts"))
        assertEquals(SettingWrite.Write("app.prompts", JsonPrimitive(true)), say("toggle prompts", 2_000))
        assertEquals(SettingWrite.Write("app.sensitivity", JsonPrimitive(0.7)), say("sensitivity seventy", 3_000))
        assertEquals(JsonPrimitive(0.7), config.get("app.sensitivity"))
    }

    @Test fun nonSettingCommandsAreNotHandled() = runBlocking {
        val bindings = SettingsVoiceBindings(TriggerStore(MemoryKeyValueStore()), ConfigSettingsAccess(Config()))
        val cmd = ai.amberx.axf.kernel.triggers.TriggerCommand("notes.add", "notes.add", kotlinx.serialization.json.JsonObject(emptyMap()))
        assertEquals(false, bindings.handles(cmd))
        assertNull(bindings.apply(cmd))
    }
}
