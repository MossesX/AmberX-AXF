package ai.amberx.axf.kernel.engine

import ai.amberx.axf.kernel.asset.AssetEnvelope
import ai.amberx.axf.kernel.asset.AssetTypeRegistry

/** Runtime overrides for randomize rolls: slot switches and per-asset switches keyed `type/id`. */
public data class RollRules(val slots: Map<String, Boolean> = emptyMap(), val assets: Map<String, Boolean> = emptyMap())

/**
 * Roll engine — what a randomize roll ("Randomize all") may touch. Mirrors core/engines/roll.ts:
 *  - slot: does the slot take part? (spec `rollDefaults.slot`, a type's `roll.slot`; context menus are off)
 *  - asset: may a roll pick this asset? (its own `roll` flag, else the type's `roll.asset`, else `rollDefaults.asset`)
 * `rollDefaults.never` slots (uac-policy) are never rolled. Fixtures: spec/fixtures/roll.json.
 */
public object RollEngine {
    public fun assetKey(type: String, id: String): String = "$type/$id"

    public fun never(types: AssetTypeRegistry, type: String): Boolean = type in types.rollNever

    public fun slotDefault(types: AssetTypeRegistry, type: String): Boolean =
        if (never(types, type)) false else types.get(type)?.rollSlot ?: types.rollSlotDefault

    public fun assetDefault(types: AssetTypeRegistry, asset: AssetEnvelope): Boolean =
        asset.roll ?: types.get(asset.type)?.rollAsset ?: types.rollAssetDefault

    public fun slotIncluded(types: AssetTypeRegistry, type: String, rules: RollRules = RollRules()): Boolean =
        if (never(types, type)) false else rules.slots[type] ?: slotDefault(types, type)

    public fun assetIncluded(types: AssetTypeRegistry, asset: AssetEnvelope, rules: RollRules = RollRules()): Boolean =
        rules.assets[assetKey(asset.type, asset.id)] ?: assetDefault(types, asset)

    /** Candidate ids per included slot (slots with no candidate are left out and keep their asset). */
    public fun plan(types: AssetTypeRegistry, slots: List<String>, list: (String) -> List<AssetEnvelope>, rules: RollRules = RollRules()): Map<String, List<String>> {
        val out = LinkedHashMap<String, List<String>>()
        for (t in slots) {
            if (!slotIncluded(types, t, rules)) continue
            val ids = list(t).filter { assetIncluded(types, it, rules) }.map { it.id }
            if (ids.isNotEmpty()) out[t] = ids
        }
        return out
    }
}
