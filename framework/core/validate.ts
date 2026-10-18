import spec from '../schemas/asset-types.json';
import { ASSET_TYPES, type AssetEnvelope, type AssetType } from './types';

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

interface TypeSpec {
  label: string;
  group: string;
  icon: string;
  required: string[];
  enums?: Record<string, string[]>;
  nested?: Record<string, string[]>;
}

export const assetTypeSpecs = spec.types as unknown as Record<AssetType, TypeSpec>;
export const FRAMEWORK_VERSION: string = spec.frameworkVersion;

/** Attachable types (badge, clock): assets placed on a host (the banner), not slots picked in Appearance or rolled. */
export function attachable(t: string): boolean {
  return (spec.types as unknown as Record<string, { attachable?: boolean }>)[t]?.attachable === true;
}

export function isAssetType(t: unknown): t is AssetType {
  return typeof t === 'string' && (ASSET_TYPES as readonly string[]).includes(t);
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Validates an asset against the shared type spec (schemas/asset-types.json).
 * The same spec drives the CLI build engine, so an asset that passes here
 * passes `axf validate` and vice versa.
 */
export function validateAsset(raw: unknown): ValidationResult {
  const errors: string[] = [];
  if (!isObj(raw)) return { ok: false, errors: ['Asset must be a JSON object'] };

  for (const k of spec.envelope.required) {
    if (!(k in raw)) errors.push(`Missing envelope field "${k}"`);
  }
  if (raw.$axf !== spec.envelope.frame) errors.push(`"$axf" must be "${spec.envelope.frame}"`);
  if (!isAssetType(raw.type)) {
    errors.push(`Unknown asset type "${String(raw.type)}"`);
    return { ok: false, errors };
  }
  if (typeof raw.id !== 'string' || !new RegExp(spec.envelope.idPattern).test(raw.id)) {
    errors.push(`"id" must match ${spec.envelope.idPattern}`);
  }
  if (typeof raw.name !== 'string' || !raw.name.trim()) errors.push('"name" must be a non-empty string');
  if (!isObj(raw.data)) {
    errors.push('"data" must be an object');
    return { ok: false, errors };
  }

  const ts = assetTypeSpecs[raw.type];
  const data = raw.data;
  for (const k of ts.required) {
    if (!(k in data)) errors.push(`data.${k} is required for ${raw.type}`);
  }
  for (const [k, allowed] of Object.entries(ts.enums ?? {})) {
    if (k in data && !allowed.includes(data[k] as string)) {
      errors.push(`data.${k} must be one of: ${allowed.join(', ')}`);
    }
  }
  for (const [k, keys] of Object.entries(ts.nested ?? {})) {
    const inner = data[k];
    if (!isObj(inner)) continue;
    for (const nk of keys) if (!(nk in inner)) errors.push(`data.${k}.${nk} is required`);
  }
  if (raw.type === 'layout' && 'slots' in data) errors.push(...validateSlots(data.slots, (t) => isAssetType(t)));
  if (raw.type === 'uac-policy' && Array.isArray(data.roles)) {
    const ids = (data.roles as { id: string }[]).map((r) => r.id);
    if (!ids.includes(data.defaultRole as string)) errors.push('data.defaultRole must reference a role id');
  }
  return { ok: errors.length === 0, errors };
}

/**
 * Layout slot contract: keys must be regions from asset-types.json (layout.slots.regions),
 * values lists of known asset types. Same messages in build-engine.mjs and AssetValidator.kt.
 */
export function validateSlots(slots: unknown, known: (t: string) => boolean): string[] {
  const regions = (spec.types.layout as unknown as { slots: { regions: string[] } }).slots.regions;
  if (!isObj(slots)) return ['data.slots must be an object'];
  const errors: string[] = [];
  for (const [r, types] of Object.entries(slots)) {
    if (!regions.includes(r)) { errors.push(`data.slots.${r} is not a layout region (one of: ${regions.join(', ')})`); continue; }
    if (!Array.isArray(types)) { errors.push(`data.slots.${r} must be a list of asset types`); continue; }
    for (const t of types) if (typeof t !== 'string' || !known(t)) errors.push(`data.slots.${r} accepts unknown asset type "${String(t)}"`);
  }
  return errors;
}

export function asEnvelope(raw: unknown): AssetEnvelope {
  return raw as AssetEnvelope;
}
