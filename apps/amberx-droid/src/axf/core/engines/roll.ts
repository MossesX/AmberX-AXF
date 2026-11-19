/**
 * Roll engine — decides what a randomize roll ("Randomize all") may touch.
 *
 * Two switches, both data-driven from schemas/asset-types.json and overridable at runtime:
 *  - slot:  does the slot take part in a roll at all? (`rollDefaults.slot`, a type's `roll.slot`).
 *           Context menus are OFF by default, so a roll never changes the context menu.
 *  - asset: may a roll pick this particular asset? The asset's own `roll` boolean, else the type's
 *           `roll.asset`, else `rollDefaults.asset`. Context-menu assets default to OFF (opt-in each one).
 * `rollDefaults.never` lists slots no override can turn on (uac-policy: rolls never change access).
 *
 * Pure and framework-agnostic; the Kotlin kernel mirrors it as RollEngine (fixtures: spec/fixtures/roll.json).
 */
import spec from '../../schemas/asset-types.json';
import type { AssetEnvelope } from '../types';

interface RollSpec { slot?: boolean; asset?: boolean }

/** Runtime overrides: slot switches and per-asset switches keyed `type/id`. */
export interface RollRules {
  slots?: Record<string, boolean>;
  assets?: Record<string, boolean>;
}

const defaults = (spec as unknown as { rollDefaults?: RollSpec & { never?: string[] } }).rollDefaults ?? {};
const typeRoll = (type: string): RollSpec => ((spec.types as Record<string, { roll?: RollSpec }>)[type]?.roll ?? {});

/** Slots a roll can never touch, whatever the overrides say. */
export function rollNever(type: string): boolean {
  return (defaults.never ?? []).includes(type);
}

/** Built-in slot default (before runtime overrides). */
export function rollSlotDefault(type: string): boolean {
  if (rollNever(type)) return false;
  return typeRoll(type).slot ?? defaults.slot ?? true;
}

/** Built-in asset default (before runtime overrides): the asset's own flag, else its type's default. */
export function rollAssetDefault(asset: Pick<AssetEnvelope, 'type' | 'roll'>): boolean {
  if (typeof asset.roll === 'boolean') return asset.roll;
  return typeRoll(asset.type).asset ?? defaults.asset ?? true;
}

export const rollAssetKey = (type: string, id: string) => `${type}/${id}`;

/** Does the slot take part in a roll? */
export function rollSlotIncluded(type: string, rules: RollRules = {}): boolean {
  if (rollNever(type)) return false;
  return rules.slots?.[type] ?? rollSlotDefault(type);
}

/** May a roll pick this asset? */
export function rollAssetIncluded(asset: Pick<AssetEnvelope, 'type' | 'id' | 'roll'>, rules: RollRules = {}): boolean {
  return rules.assets?.[rollAssetKey(asset.type, asset.id)] ?? rollAssetDefault(asset);
}

/**
 * What a roll may pick, per slot: only included slots, only included assets. A slot whose candidate list is
 * empty is left out (it keeps its current asset). Order follows `types` and each list's order.
 */
export function rollPlan(
  types: readonly string[],
  list: (type: string) => Pick<AssetEnvelope, 'type' | 'id' | 'roll'>[],
  rules: RollRules = {},
): Record<string, string[]> {
  const plan: Record<string, string[]> = {};
  for (const t of types) {
    if (!rollSlotIncluded(t, rules)) continue;
    const ids = list(t).filter((a) => rollAssetIncluded(a, rules)).map((a) => a.id);
    if (ids.length) plan[t] = ids;
  }
  return plan;
}
