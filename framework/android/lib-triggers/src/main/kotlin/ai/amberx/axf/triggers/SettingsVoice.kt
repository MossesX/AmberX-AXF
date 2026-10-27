package ai.amberx.axf.triggers

import ai.amberx.axf.kernel.config.Config
import ai.amberx.axf.kernel.config.ConfigLayer
import ai.amberx.axf.kernel.contract.SettingKind
import ai.amberx.axf.kernel.contract.SettingSpec
import ai.amberx.axf.kernel.triggers.Patterns
import ai.amberx.axf.kernel.triggers.SettingChange
import ai.amberx.axf.kernel.triggers.SettingVoiceBinding
import ai.amberx.axf.kernel.triggers.SettingsActions
import ai.amberx.axf.kernel.triggers.SpokenNumbers
import ai.amberx.axf.kernel.triggers.TriggerCommand
import ai.amberx.axf.kernel.triggers.TriggerHosting
import ai.amberx.axf.settings.SettingsEngine
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull

/*
 * Settings voice bindings: the kernel's TriggerHosting.bindingTriggers turns a SettingVoiceBinding into permanent
 * voice triggers firing axf.settings.set / axf.settings.toggle; TriggerHosting.settingChange turns a fired command
 * back into a SettingChange. This file does the last step: coerce the spoken value to the setting's kind and write it
 * through the framework settings API (lib-settings' SettingsEngine, or the kernel Config when lib-settings isn't installed).
 */

/** The bit of a settings API the binding needs. */
public interface SettingsAccess {
    public fun spec(key: String): SettingSpec?
    public fun get(key: String): JsonElement?
    public suspend fun set(key: String, value: JsonElement)
}

/** lib-settings' engine (DataStore + Config mirror + SettingChanged event). */
public class SettingsEngineAccess(private val engine: SettingsEngine) : SettingsAccess {
    override fun spec(key: String): SettingSpec? = engine.spec(key)
    override fun get(key: String): JsonElement? = engine.get(key)
    override suspend fun set(key: String, value: JsonElement) { engine.set(key, value) }
}

/** Fallback: the kernel Config USER layer (not persisted; for apps without lib-settings and for tests). */
public class ConfigSettingsAccess(private val config: Config, private val specs: (String) -> SettingSpec? = { null }) : SettingsAccess {
    override fun spec(key: String): SettingSpec? = specs(key)
    override fun get(key: String): JsonElement? = config.get(key) ?: specs(key)?.default
    override suspend fun set(key: String, value: JsonElement) { config.set(key, value, ConfigLayer.USER) }
}

/** What a setting command came to. */
public sealed interface SettingWrite {
    public val key: String
    public data class Write(override val key: String, val value: JsonElement) : SettingWrite
    public data class Refused(override val key: String, val reason: String) : SettingWrite
}

/** Pure coercion of a spoken change into a value the setting accepts (unit-tested). */
public object SettingValues {
    private val on = setOf("on", "true", "yes", "enable", "enabled", "start", "show")
    private val off = setOf("off", "false", "no", "disable", "disabled", "stop", "hide")

    /** Kinds a voice command may write. SECRET never: secrets are not spoken into settings. */
    public val VOICE_KINDS: Set<SettingKind> = setOf(SettingKind.TOGGLE, SettingKind.NUMBER, SettingKind.SLIDER, SettingKind.CHOICE, SettingKind.TEXT)

    public fun resolve(change: SettingChange, spec: SettingSpec?, current: JsonElement?): SettingWrite {
        val key = change.key
        if (spec != null && spec.kind !in VOICE_KINDS) return SettingWrite.Refused(key, "${spec.kind.name.lowercase()} settings can't be changed by voice")
        if (change.toggle) {
            if (spec != null && spec.kind != SettingKind.TOGGLE) return SettingWrite.Refused(key, "only on/off settings can be toggled")
            val now = bool(current) ?: bool(spec?.default) ?: false
            return SettingWrite.Write(key, JsonPrimitive(!now))
        }
        val raw = change.value ?: return SettingWrite.Refused(key, "no value was given")
        val text = (raw as? JsonPrimitive)?.content?.trim() ?: return SettingWrite.Refused(key, "the value isn't a single value")
        return when (spec?.kind) {
            null -> SettingWrite.Write(key, raw)
            SettingKind.TOGGLE -> bool(raw)?.let { SettingWrite.Write(key, JsonPrimitive(it)) } ?: SettingWrite.Refused(key, "\"$text\" isn't on or off")
            SettingKind.NUMBER, SettingKind.SLIDER -> number(raw, spec)?.let { SettingWrite.Write(key, JsonPrimitive(it)) } ?: SettingWrite.Refused(key, "\"$text\" isn't a number")
            SettingKind.CHOICE -> choice(text, spec)?.let { SettingWrite.Write(key, JsonPrimitive(it)) } ?: SettingWrite.Refused(key, "\"$text\" isn't one of the choices")
            SettingKind.TEXT -> if (text.isEmpty()) SettingWrite.Refused(key, "empty text") else SettingWrite.Write(key, JsonPrimitive(text))
            else -> SettingWrite.Refused(key, "not a voice setting")
        }
    }

    public fun bool(e: JsonElement?): Boolean? {
        val p = e as? JsonPrimitive ?: return null
        if (!p.isString) return p.booleanOrNull
        val w = Patterns.normalize(p.content)
        return when { w in on -> true; w in off -> false; else -> null }
    }

    /** A number from a JSON number, digits or words; a 0..1 slider takes a spoken percent ("seventy" → 0.7); clamped to min..max. */
    public fun number(e: JsonElement, spec: SettingSpec): Double? {
        val p = e as? JsonPrimitive ?: return null
        var n = (if (p.isString) null else p.doubleOrNull) ?: p.content.trim().toDoubleOrNull() ?: SpokenNumbers.number(p.content)?.toDouble() ?: return null
        val max = spec.max
        if (max != null && max <= 1.0 && n > 1.0 && n <= 100.0) n /= 100.0
        spec.min?.let { if (n < it) n = it }
        if (max != null && n > max) n = max
        return n
    }

    /** The option whose id or label was said (exact after normalizing, else the closest at ≥ 0.75 similarity). */
    public fun choice(text: String, spec: SettingSpec): String? {
        val h = Patterns.normalize(text)
        if (h.isEmpty()) return null
        spec.options.firstOrNull { (id, label) -> Patterns.normalize(id) == h || Patterns.normalize(label) == h }?.let { return it.first }
        var best: Pair<String, Double>? = null
        for ((id, label) in spec.options) {
            val s = maxOf(Patterns.similarity(h, Patterns.normalize(id)), Patterns.similarity(h, Patterns.normalize(label)))
            if (s >= 0.75 && (best == null || s > best.second)) best = id to s
        }
        return best?.first
    }
}

/**
 * Hosts setting voice bindings: [bind] registers a binding's triggers as permanent triggers in the [store];
 * [apply] writes the setting a fired `axf.settings.*` command means.
 */
public class SettingsVoiceBindings(private val store: TriggerStore, private val access: SettingsAccess) {
    /** Registers the binding's triggers (ids `<key>.<n>`) under the binding's module. */
    public fun bind(binding: SettingVoiceBinding, locked: Boolean = false) {
        val ts = TriggerHosting.bindingTriggers(binding)
        store.registerPermanent(binding.module, ts, if (locked) ts.map { it.id }.toSet() else emptySet())
    }

    public fun handles(cmd: TriggerCommand): Boolean = cmd.action == SettingsActions.SET || cmd.action == SettingsActions.TOGGLE

    /** Writes the change; null when [cmd] isn't a settings command. */
    public suspend fun apply(cmd: TriggerCommand): SettingWrite? {
        val change = TriggerHosting.settingChange(cmd) ?: return null
        val w = SettingValues.resolve(change, access.spec(change.key), access.get(change.key))
        if (w is SettingWrite.Write) access.set(w.key, w.value)
        return w
    }
}
