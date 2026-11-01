import spec from '../schemas/asset-types.json';
import { ASSET_TYPES, type AssetEnvelope, type AssetType } from './types';
import { hostSpec, validateHostAttachments } from './engines/widgets';
import { validateMenuItems } from './engines/appmenu';
import { designPackageErrors } from './engines/designpackage';
import { stylePackageErrors } from './engines/stylepackage';
import { interfaceErrors } from './engines/interface';
import { brandAssetErrors } from './engines/brand-rules.mjs';
import { scaleErrors } from './engines/scale-rules.mjs';
import { helpErrors } from './engines/help-rules.mjs';
import { agentCardErrors } from './engines/agent-card-rules.mjs';
import { behaviorErrors } from './engines/behavior';

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

/** Collection types (help): every asset of the type is in force at once, so there is no active pick to show in Appearance or roll. */
export function collectionType(t: string): boolean {
  return (spec.types as unknown as Record<string, { collection?: boolean }>)[t]?.collection === true;
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
  if (raw.type === 'layout' && 'repeat' in data) errors.push(...validateRepeat(data.repeat, (t) => isAssetType(t)));
  // Menu items (app-menu menus, context-menu targets): optional fields provider / badge / checked / order / before / after.
  if (raw.type === 'app-menu' && Array.isArray(data.menus)) {
    (data.menus as unknown[]).forEach((m, i) => {
      if (!isObj(m)) return;
      if ('order' in m && (typeof m.order !== 'number' || !Number.isFinite(m.order))) errors.push(`data.menus[${i}].order must be a number`);
      if ('items' in m) errors.push(...validateMenuItems(m.items, `data.menus[${i}].items`));
    });
  }
  if (raw.type === 'context-menu' && isObj(data.targets)) {
    for (const [t, items] of Object.entries(data.targets)) errors.push(...validateMenuItems(items, `data.targets.${t}`));
  }
  if (raw.type === 'design-package') errors.push(...designPackageErrors(data));
  if (raw.type === 'style-package') errors.push(...stylePackageErrors(data));
  if (raw.type === 'interface') errors.push(...interfaceErrors(data));
  if (raw.type === 'behavior-theme') errors.push(...behaviorErrors(data));
  // typography@1 / density@1 / sizing@1: ONE validator shared with the build engine (core/engines/scale-rules.mjs)
  errors.push(...scaleErrors(raw.type, data));
  // help@1: ONE validator shared with the build engine (core/engines/help-rules.mjs)
  errors.push(...helpErrors(raw.type, data));
  // agent-card@1: ONE validator shared with the build engine (core/engines/agent-card-rules.mjs)
  errors.push(...agentCardErrors(raw.type, data));
  errors.push(...(brandAssetErrors(raw.type, data) ?? []));
  // Widget hosts (banner.attach, toolbar.widgets): every entry names a type and side the host takes.
  const host = hostSpec(raw.type);
  if (host && host.field in data) errors.push(...validateHostAttachments(raw.type, data[host.field]));
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

/**
 * Repeating slots (layout.repeat, core/engines/repeat.ts): each names an id, the page data set it repeats over, and
 * optionally a region, style, columns, max and fallback. Same messages in build-engine.mjs and AssetValidator.kt.
 */
export function validateRepeat(repeat: unknown, known: (t: string) => boolean): string[] {
  const layout = spec.types.layout as unknown as { slots: { regions: string[] }; repeat: { styles: string[]; maxColumns: number } };
  if (!Array.isArray(repeat)) return ['data.repeat must be a list of repeating slots'];
  const errors: string[] = [];
  const seen = new Set<string>();
  const whole = (v: unknown, min: number, max = Infinity) => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
  repeat.forEach((r, i) => {
    const at = `data.repeat[${i}]`;
    if (!isObj(r)) { errors.push(`${at} must be an object`); return; }
    if (typeof r.id !== 'string' || !r.id.trim()) errors.push(`${at}.id must be a non-empty string`);
    else if (seen.has(r.id)) errors.push(`${at}.id "${r.id}" is used twice`);
    else seen.add(r.id);
    if (typeof r.dataSet !== 'string' || !r.dataSet.trim()) errors.push(`${at}.dataSet must be a non-empty string`);
    if ('region' in r && !layout.slots.regions.includes(r.region as string)) errors.push(`${at}.region is not a layout region (one of: ${layout.slots.regions.join(', ')})`);
    if ('style' in r && !layout.repeat.styles.includes(r.style as string)) errors.push(`${at}.style must be one of: ${layout.repeat.styles.join(', ')}`);
    if ('columns' in r && !whole(r.columns, 1, layout.repeat.maxColumns)) errors.push(`${at}.columns must be a whole number from 1 to ${layout.repeat.maxColumns}`);
    if ('max' in r && !whole(r.max, 0)) errors.push(`${at}.max must be a whole number, 0 or more`);
    if ('fallback' in r) {
      const f = r.fallback;
      if (!isObj(f)) errors.push(`${at}.fallback must be an object`);
      else {
        if ('type' in f && (typeof f.type !== 'string' || !known(f.type))) errors.push(`${at}.fallback.type is unknown asset type "${String(f.type)}"`);
        if ('id' in f && typeof f.id !== 'string') errors.push(`${at}.fallback.id must be a string`);
        if ('label' in f && typeof f.label !== 'string') errors.push(`${at}.fallback.label must be a string`);
      }
    }
  });
  return errors;
}

export function asEnvelope(raw: unknown): AssetEnvelope {
  return raw as AssetEnvelope;
}
