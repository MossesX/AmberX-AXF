/**
 * instance-look@1 reference engine (build own-look-per-grid-and-tab-group, Nov 16 2026). One grid or one tab row carries
 * its own look: a ten-key record whose values are token references or scaled steps (rules in instance-look-rules.mjs),
 * drawn over the skin. This file is the resolver every port reproduces (fixture spec/fixtures/instance-look.json):
 *
 *   skin      the look the skin implies for the kind: its style theme's component-tokens@1 `grid` / `tabs` maps read back
 *             into look keys (lookFromFamilies), only values that are token refs; a raw value in a skin stays a family
 *             value and is not a look value
 *   app       axf.chrome.<kind>.look: every instance of the kind in this app (rides the app's look document)
 *   instance  axf.chrome.<kind>.<id>.look: this one row / grid
 *
 * resolve(skin, app, instance) merges key by key, the child over the parent, and compiles the result to `--fx-inst-<key>`
 * variables plus the family tokens the kind's CSS already reads (bind), both for the instance's root element. Nothing is
 * emitted for a key nobody set (no var() fallbacks: the family's :root default stands), so an empty record resolves to
 * exactly the skin layer, and reset() drops the instance record from the settings. Pure TS: no DOM, no IO.
 *
 * Kotlin twin deferred (framework/spec/PORTING.md).
 */
import {
  INSTANCE_LOOK_BINDINGS,
  INSTANCE_LOOK_KEYS,
  INSTANCE_LOOK_KEY_IDS,
  RADIUS_STEPS,
  SPACE_STEPS,
  TEXT_STEPS,
  colourTokenName,
  instanceLookKeyError,
  instanceLookStored,
  instanceLookValue,
  instanceLookVar,
  isInstanceLookId,
  isInstanceLookKind,
  normalizeInstanceLook,
  type InstanceLook,
  type InstanceLookKeyId,
  type InstanceLookKind,
} from './instance-look-rules.mjs';
import { COMPONENT_TOKEN_FAMILIES, componentTokenVar } from './component-tokens.mjs';

export * from './instance-look-rules.mjs';

/** Where one resolved key's value came from. */
export type InstanceLookSource = 'skin' | 'app' | 'instance';
/** The three layers resolve() reads, lowest first. Any may be missing. */
export interface InstanceLookLayers { skin?: InstanceLook | null; app?: InstanceLook | null; instance?: InstanceLook | null }
export interface ResolvedInstanceLook {
  kind: InstanceLookKind;
  /** The merged record: only keys someone set, instance over app over skin. */
  look: InstanceLook;
  /** Key → the layer that decided it. */
  source: Partial<Record<InstanceLookKeyId, InstanceLookSource>>;
  /** `--fx-inst-<key>` → compiled CSS value, for every key in `look`. */
  vars: Record<string, string>;
  /** The kind's family tokens set to their `--fx-inst-*` variable, for every bound key in `look`. */
  bind: Record<string, string>;
  /** True when no layer set anything: the component draws the family defaults. */
  empty: boolean;
  /** True when the instance (or app) layer changed nothing against the skin: the row still "follows the skin". */
  followsSkin: boolean;
}

/** The settings key of one instance's record: axf.chrome.<kind>.<id>.look. */
export const instanceLookSettingsKey = (kind: InstanceLookKind, id: string): string => `axf.chrome.${kind}.${id}.look`;
/** The settings key of the app-wide record of a kind: axf.chrome.<kind>.look. */
export const kindLookSettingsKey = (kind: InstanceLookKind): string => `axf.chrome.${kind}.look`;
const LOOK_KEY = /^axf\.chrome\.(tab-group|grid)\.(?:([a-z0-9][a-z0-9._:/-]{0,119})\.)?look$/i;
/** 'axf.chrome.grid.ui-review.items.look' → { kind, id } ('' id = the app-wide record), or null for any other key. */
export function parseInstanceLookSettingsKey(key: unknown): { kind: InstanceLookKind; id: string } | null {
  if (typeof key !== 'string') return null;
  const m = LOOK_KEY.exec(key);
  if (!m || !isInstanceLookKind(m[1])) return null;
  return { kind: m[1], id: m[2] ?? '' };
}

/* ------------------------------------------------------------------ the skin layer */

const familyOf = (kind: InstanceLookKind): 'grid' | 'tabs' => (kind === 'grid' ? 'grid' : 'tabs');

/**
 * A component-tokens@1 family value read back as a look value for `key`, or null when it is not one (a raw colour, a
 * length in px, a shadow): `accentSoft` / `var(--fx-accent-soft)` → `accentSoft`; `dens-gap-md` → `md`; `radius.sm` →
 * `sm`; `999px` → `pill`; `0` → `none`; `var(--fx-border-w)` → `thin`; `calc(var(--fx-border-w) * 2)` → `medium`.
 */
export function lookValueFromFamily(key: InstanceLookKeyId, raw: unknown, colourTokens: readonly string[]): string | null {
  const spec = INSTANCE_LOOK_KEYS.find((x) => x.key === key);
  if (!spec || (typeof raw !== 'string' && typeof raw !== 'number')) return null;
  const v = String(raw).trim();
  const unvar = (s: string) => (/^var\(--fx-[a-z0-9-]+\)$/.test(s) ? s.slice(9, -1) : s);
  switch (spec.kind) {
    case 'colour': {
      if (v === 'transparent') return spec.transparent ? 'transparent' : null;
      const name = colourTokenName(unvar(v).replace(/^--fx-/, ''), colourTokens);
      return name;
    }
    case 'space': { const m = /^(?:var\(--fx-)?dens-gap-([a-z0-9]+)\)?$/.exec(v); return m && SPACE_STEPS.includes(m[1]) ? m[1] : null; }
    case 'text': { const m = /^(?:var\(--fx-)?type-root-([a-z0-9]+)\)?$/.exec(v); return m && TEXT_STEPS.includes(m[1]) ? m[1] : null; }
    case 'radius': {
      if (v === '0' || v === '0px') return 'none';
      if (v === '999px') return 'pill';
      const m = /^(?:radius\.|var\(--fx-radius-)([a-z]+)\)?$/.exec(v);
      return m && RADIUS_STEPS.includes(m[1]) ? m[1] : null;
    }
    case 'border': {
      if (v === '0' || v === '0px') return 'none';
      if (v === 'border-w' || v === 'var(--fx-border-w)') return 'thin';
      const m = /^calc\(var\(--fx-border-w\) \* (2|3)\)$/.exec(v);
      return m ? (m[1] === '2' ? 'medium' : 'thick') : null;
    }
    default: return null;
  }
}

/** The family token key (camel, as in the style theme's map) a look key reads from for a kind: the first binding. */
export function familyKeyFor(kind: InstanceLookKind, key: InstanceLookKeyId): string | null {
  const vars = INSTANCE_LOOK_BINDINGS[kind]?.[key] ?? [];
  const fam = COMPONENT_TOKEN_FAMILIES[familyOf(kind)];
  for (const v of vars) {
    const tok = fam.tokens.find((t) => componentTokenVar(familyOf(kind), t.key) === v);
    if (tok) return tok.key;
  }
  return null;
}

/**
 * The look a skin implies for a kind: its style theme's `grid` / `tabs` map (component-tokens@1) read through the
 * bindings, token-ref values only. A theme that sets none gives {} (the family :root defaults stand).
 */
export function lookFromFamilies(kind: InstanceLookKind, styleTheme: { grid?: Record<string, unknown>; tabs?: Record<string, unknown> } | null | undefined, colourTokens: readonly string[]): InstanceLook {
  const out: InstanceLook = {};
  if (!isInstanceLookKind(kind) || !styleTheme || typeof styleTheme !== 'object') return out;
  const map = styleTheme[familyOf(kind)];
  if (!map || typeof map !== 'object' || Array.isArray(map)) return out;
  for (const key of INSTANCE_LOOK_KEY_IDS) {
    const famKey = familyKeyFor(kind, key);
    if (!famKey || !(famKey in map)) continue;
    const v = lookValueFromFamily(key, (map as Record<string, unknown>)[famKey], colourTokens);
    if (v !== null) out[key] = v;
  }
  return out;
}

/* ------------------------------------------------------------------ resolve */

/**
 * Resolve one instance's look from its three layers, the child over the parent. `vars` and `bind` together are the
 * inline style of the instance's root element; `source` says where each value came from (the dialog shows it).
 */
export function resolveInstanceLook(kind: InstanceLookKind, layers: InstanceLookLayers, colourTokens: readonly string[]): ResolvedInstanceLook {
  const k: InstanceLookKind = isInstanceLookKind(kind) ? kind : 'tab-group';
  const skin = normalizeInstanceLook(layers?.skin, colourTokens);
  const app = normalizeInstanceLook(layers?.app, colourTokens);
  const instance = normalizeInstanceLook(layers?.instance, colourTokens);
  const look: InstanceLook = {};
  const source: ResolvedInstanceLook['source'] = {};
  const vars: Record<string, string> = {};
  const bind: Record<string, string> = {};
  let followsSkin = true;
  for (const key of INSTANCE_LOOK_KEY_IDS) {
    const from: InstanceLookSource | null = key in instance ? 'instance' : key in app ? 'app' : key in skin ? 'skin' : null;
    if (!from) continue;
    const stored = from === 'instance' ? instance[key]! : from === 'app' ? app[key]! : skin[key]!;
    if (from !== 'skin' && skin[key] !== stored) followsSkin = false;
    look[key] = stored;
    source[key] = from;
    const css = instanceLookValue(key, stored, colourTokens);
    if (css === null) continue;
    const v = instanceLookVar(key);
    vars[v] = css;
    for (const fam of INSTANCE_LOOK_BINDINGS[k][key] ?? []) bind[fam] = `var(${v})`;
  }
  return { kind: k, look, source, vars, bind, empty: Object.keys(look).length === 0, followsSkin };
}

/** The inline style of an instance's root: its --fx-inst-* variables and the family tokens bound to them. */
export function instanceLookStyle(resolved: ResolvedInstanceLook): Record<string, string> {
  return { ...resolved.vars, ...resolved.bind };
}

/* ------------------------------------------------------------------ the settings store */

type Saved = Record<string, unknown>;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** One instance's saved record (cleaned), {} when it has none. */
export function readInstanceLook(saved: unknown, kind: InstanceLookKind, id: string, colourTokens: readonly string[]): InstanceLook {
  if (!isObj(saved) || !isInstanceLookKind(kind) || !isInstanceLookId(id)) return {};
  return normalizeInstanceLook(saved[instanceLookSettingsKey(kind, id)], colourTokens);
}

/** The app-wide record of a kind (cleaned), {} when there is none. */
export function readKindLook(saved: unknown, kind: InstanceLookKind, colourTokens: readonly string[]): InstanceLook {
  if (!isObj(saved) || !isInstanceLookKind(kind)) return {};
  return normalizeInstanceLook(saved[kindLookSettingsKey(kind)], colourTokens);
}

/** Resolve straight from the settings map and the skin's style theme (what the TabGroup and DataGrid controls call). */
export function resolveFromSettings(saved: unknown, kind: InstanceLookKind, id: string, styleTheme: { grid?: Record<string, unknown>; tabs?: Record<string, unknown> } | null | undefined, colourTokens: readonly string[]): ResolvedInstanceLook {
  return resolveInstanceLook(kind, { skin: lookFromFamilies(kind, styleTheme, colourTokens), app: readKindLook(saved, kind, colourTokens), instance: readInstanceLook(saved, kind, id, colourTokens) }, colourTokens);
}

/**
 * Set one key of a record (value null or '' drops the key). Returns the new record; throws with the rules' message on a
 * raw px / colour or an unknown key, leaving the record as it was. Pure: the caller saves the result under the key.
 */
export function setInstanceLookKey(record: unknown, key: string, value: unknown, colourTokens: readonly string[]): InstanceLook {
  const before = normalizeInstanceLook(record, colourTokens);
  if (!INSTANCE_LOOK_KEY_IDS.includes(key as InstanceLookKeyId)) throw new Error(instanceLookKeyError(key, value, colourTokens) ?? `${key} is not a look key`);
  const next: InstanceLook = { ...before };
  if (value === null || value === undefined || value === '') { delete next[key as InstanceLookKeyId]; return next; }
  const err = instanceLookKeyError(key, typeof value === 'string' ? value : typeof value === 'number' ? value : String(value), colourTokens);
  if (err) throw new Error(err);
  next[key as InstanceLookKeyId] = instanceLookStored(key, String(value), colourTokens)!;
  return next;
}

/** Save one instance's record into the settings map (a copy); an empty record removes the key (empty = skin). */
export function writeInstanceLook(saved: unknown, kind: InstanceLookKind, id: string, record: unknown, colourTokens: readonly string[]): Saved {
  const out: Saved = isObj(saved) ? { ...saved } : {};
  if (!isInstanceLookKind(kind) || !isInstanceLookId(id)) return out;
  const clean = normalizeInstanceLook(record, colourTokens);
  const key = instanceLookSettingsKey(kind, id);
  if (Object.keys(clean).length) out[key] = clean; else delete out[key];
  return out;
}

/** Reset: drop the instance's record so it follows the skin (and the app record) again. Other keys are untouched. */
export function resetInstanceLook(saved: unknown, kind: InstanceLookKind, id: string): Saved {
  const out: Saved = isObj(saved) ? { ...saved } : {};
  if (isInstanceLookKind(kind) && isInstanceLookId(id)) delete out[instanceLookSettingsKey(kind, id)];
  return out;
}

/** Every instance (and app-wide record) with a saved look: [{ kind, id, look }], app-wide rows first, then by kind and id. */
export function instanceLookList(saved: unknown, colourTokens: readonly string[]): Array<{ kind: InstanceLookKind; id: string; look: InstanceLook }> {
  const out: Array<{ kind: InstanceLookKind; id: string; look: InstanceLook }> = [];
  if (!isObj(saved)) return out;
  for (const [key, raw] of Object.entries(saved)) {
    const p = parseInstanceLookSettingsKey(key);
    if (!p) continue;
    const look = normalizeInstanceLook(raw, colourTokens);
    if (Object.keys(look).length) out.push({ kind: p.kind, id: p.id, look });
  }
  return out.sort((a, b) => Number(a.id !== '') - Number(b.id !== '') || a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));
}

/** The CSS custom property names a kind's root may carry, for stylesheets and checks: every --fx-inst-* plus the bound family tokens. */
export function instanceLookVarNames(kind: InstanceLookKind): string[] {
  const own = INSTANCE_LOOK_KEY_IDS.map((k) => instanceLookVar(k));
  const bound = Object.values(INSTANCE_LOOK_BINDINGS[kind] ?? {}).flat();
  return [...own, ...bound.filter((v, i, a) => a.indexOf(v) === i)];
}
