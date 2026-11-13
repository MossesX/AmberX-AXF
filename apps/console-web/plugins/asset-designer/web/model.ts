/**
 * Asset designer — the pure model (no React, no DOM, no IO; test.mts replays it). The editor is built from the asset
 * type registry (framework/schemas/asset-types.json) and the chrome settings fields (chrome-settings@1), so a new asset
 * type or a new field shows up in the designer by itself:
 *
 *   fieldsFor(spec, chrome, type, sample)  every field of a type as a form field: chrome fields first (kind, options and
 *                                          default from chrome-settings-rules), then the type's required fields, then its
 *                                          optional fields; the kind comes from the enum, the chrome field, the sample
 *                                          value's JS type, then the field description, then the key's name
 *   starterFor(spec, chrome, type, from)   the data a new asset starts with (a copy of `from`, or every field's default)
 *   gate(validate, asset, fields)          the validation gate: ok, every error, and the errors per field (by the field
 *                                          the message names) so the UI can show each one next to its control
 *   newAsset / stripDesigned / parseJson / typeOptions / suggestId / chromeTypeOfSettings
 */

export interface TypeSpecLite { label: string; group?: string; icon?: string; description?: string; required?: string[]; enums?: Record<string, string[]>; optional_fields?: Record<string, string>; attachable?: boolean; hideable?: boolean; collection?: boolean; shared?: boolean }
export type Spec = Record<string, TypeSpecLite>;
export interface ChromeField { key: string; label: string; kind: string; options?: string[]; labels?: Record<string, string>; default?: unknown; min?: number; max?: number; group?: string; level?: string; instanceOnly?: boolean }
export type ChromeFields = Record<string, ChromeField[]>;

export type FieldKind = 'text' | 'number' | 'toggle' | 'choice' | 'color' | 'json';
export type FieldGroup = 'chrome' | 'required' | 'optional';
export interface FieldDef { key: string; label: string; kind: FieldKind; group: FieldGroup; required: boolean; hint: string; options?: string[]; labels?: Record<string, string>; default?: unknown; min?: number; max?: number; /** the field's default holds an object (not a list) when `kind` is json */ object?: boolean }

export interface Draft { $axf: 'asset@1'; type: string; id: string; name: string; version: string; description?: string; author?: string; tags?: string[]; roll?: boolean; data: Record<string, unknown>; designed?: unknown }
export interface Gate { ok: boolean; errors: string[]; byField: Record<string, string[]>; general: string[] }
export type Validate = (raw: unknown) => { ok: boolean; errors: string[] };

export const ASSET_ID_PATTERN = '^[a-z0-9][a-z0-9-]{1,47}$';
const ASSET_ID = new RegExp(ASSET_ID_PATTERN);
export const PREVIEW_PREFIX = 'ad-preview-';
export const HINT_MAX = 160;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** `groups[].items[].badge` → a note on `groups`; `items[].provider|badge` → `items`. */
export const rootKey = (key: string): string => key.split(/\[\]|\.|\|/)[0] ?? key;
const isSubPath = (key: string): boolean => /\[\]|\./.test(key) || key.includes('|');

/** `showSearch` → "Show search", `levelOf` → "Level of", `nav-style` → "Nav style". */
export function labelOf(key: string): string {
  const s = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[-_]+/g, ' ').trim().toLowerCase();
  return s ? s[0]!.toUpperCase() + s.slice(1) : key;
}

const TOGGLE_KEYS = /^(show[A-Z]\w*|divider|sticky|collapsible|closable|reorderable|badges|rememberLast|modal|live|levels|descriptions|search|hideable|enabled|disabled|visible|hidden|animated|loop|autoplay|sandbox|navStyle)$/;
const NUMBER_KEYS = /^(height|width|order|max|min|size|maxResults|depth|rows|columns|gap|radius|duration|delay|count|limit|opacity|scale|speed|weight|lineHeight|fontSize|revision)$/;
const COLOR_KEYS = /(color|colour|Color|Colour)$/;
const OBJECT_KEYS = /^(tokens|logo|levelOf|visible|search|attach|slots|repeat|origin|extras|labels|style|styles|look|layout|behaviour|behavior|output|panels|canvas|preview|voice|autosave|info|context|history|regions|sizes|fonts|scale|members|chrome|map)$/;

function kindFromDescription(desc: string): FieldKind | null {
  const d = desc.trim().toLowerCase();
  if (!d) return null;
  if (/^(boolean|true|false)\b/.test(d)) return 'toggle';
  if (/^(number|integer|px|\d)/.test(d)) return 'number';
  if (/^(\[|\{|object|array|list|map|id → |<type>)/.test(d) || /^\[\{/.test(d)) return 'json';
  if (/^(string|id|text|name|url|path|hex|css|slug|iso)\b/.test(d)) return 'text';
  if (/^[a-z-]+ \| [a-z-]+/.test(d)) return 'text'; // "a | b | c" without an enum entry: free text
  return null;
}

function kindFromSample(v: unknown): FieldKind | null {
  if (v === undefined || v === null) return null;
  if (typeof v === 'boolean') return 'toggle';
  if (typeof v === 'number') return 'number';
  if (typeof v === 'string') return 'text';
  return 'json';
}

function kindFromKey(key: string): FieldKind {
  if (TOGGLE_KEYS.test(key)) return 'toggle';
  if (NUMBER_KEYS.test(key)) return 'number';
  if (COLOR_KEYS.test(key)) return 'color';
  if (OBJECT_KEYS.test(key) || /s$/.test(key)) return 'json';
  return 'text';
}

const chromeKind = (k: string): FieldKind => (k === 'choice' ? 'choice' : k === 'toggle' ? 'toggle' : k === 'number' ? 'number' : k === 'color' ? 'color' : 'text');

/** Every field of a type as a form field (see the file header). `sample` (a built-in asset's data) refines the kinds. */
export function fieldsFor(spec: Spec, chrome: ChromeFields, type: string, sample?: Record<string, unknown>): FieldDef[] {
  const ts = spec[type];
  if (!ts) return [];
  const out: FieldDef[] = [];
  const seen = new Set<string>();
  const enums = ts.enums ?? {};
  const optional = ts.optional_fields ?? {};
  const notes = new Map<string, string[]>();
  for (const [k, d] of Object.entries(optional)) if (isSubPath(k)) notes.set(rootKey(k), [...(notes.get(rootKey(k)) ?? []), `${k}: ${d}`]);
  const hintOf = (key: string, desc: string): string => {
    const extra = notes.get(key)?.length ? ` · ${notes.get(key)!.join(' · ')}` : '';
    const s = `${desc}${extra}`.replace(/\s+/g, ' ').trim();
    return s.length > HINT_MAX ? `${s.slice(0, HINT_MAX - 1)}…` : s;
  };
  const required = new Set(ts.required ?? []);
  for (const cf of chrome[type] ?? []) {
    if (cf.instanceOnly || seen.has(cf.key)) continue;
    seen.add(cf.key);
    const kind = enums[cf.key] ? 'choice' : chromeKind(cf.key === 'density' || cf.key === 'surface' ? 'choice' : cf.kind);
    out.push({ key: cf.key, label: cf.label || labelOf(cf.key), kind, group: 'chrome', required: required.has(cf.key), hint: hintOf(cf.key, optional[cf.key] ?? ''), options: enums[cf.key] ?? cf.options, labels: cf.labels, default: cf.default, min: cf.min, max: cf.max });
  }
  const define = (key: string, group: FieldGroup): void => {
    if (seen.has(key) || isSubPath(key)) return;
    seen.add(key);
    const desc = optional[key] ?? '';
    const sampleV = sample?.[key];
    let kind: FieldKind = enums[key] ? 'choice' : kindFromSample(sampleV) ?? kindFromDescription(desc) ?? kindFromKey(key);
    if (kind === 'text' && COLOR_KEYS.test(key)) kind = 'color';
    const object = kind === 'json' && (isObj(sampleV) || (!Array.isArray(sampleV) && (OBJECT_KEYS.test(key) || /^(\{|object|map|id → )/.test(desc.trim().toLowerCase()))));
    out.push({ key, label: labelOf(key), kind, group, required: group === 'required', hint: hintOf(key, desc), options: enums[key], object });
  };
  for (const k of ts.required ?? []) define(k, 'required');
  for (const k of Object.keys(optional)) define(k, 'optional');
  for (const k of Object.keys(enums)) define(k, 'optional');
  return out;
}

/** A field's default value: the chrome default, the first enum option, false / 0 / '' / [] / {} by kind. */
export function defaultOf(f: FieldDef): unknown {
  if (f.default !== undefined) return f.default;
  switch (f.kind) {
    case 'choice': return f.options?.[0] ?? '';
    case 'toggle': return false;
    case 'number': return f.min ?? 0;
    case 'json': return f.object ? {} : [];
    case 'color': return '';
    default: return '';
  }
}

/** The data a new asset starts with: a deep copy of `from`, or every required (and chrome) field's default. */
export function starterFor(spec: Spec, chrome: ChromeFields, type: string, from?: Record<string, unknown>): Record<string, unknown> {
  if (isObj(from)) return JSON.parse(JSON.stringify(from)) as Record<string, unknown>;
  const data: Record<string, unknown> = {};
  for (const f of fieldsFor(spec, chrome, type)) if (f.required || f.group === 'chrome') data[f.key] = defaultOf(f);
  return data;
}

export function newAsset(type: string, id: string, name: string, data: Record<string, unknown>): Draft {
  return { $axf: 'asset@1', type, id, name, version: '1.0.0', description: '', tags: [], data };
}

/** The asset without its designed@1 manifest (the server makes a fresh one on save; a stale one would fail the hash check). */
export function stripDesigned<T extends { designed?: unknown }>(a: T): Omit<T, 'designed'> {
  const { designed: _d, ...rest } = a;
  return rest;
}

const ENVELOPE_KEYS = ['id', 'name', 'version', 'type', 'description', 'author', 'tags', 'roll'];

/** Which field a validator message is about: `data.groups…`, `"showSearch"`, `showSearch:`; envelope fields by name; '' when none. */
export function fieldOfError(msg: string, keys: readonly string[]): string {
  const m = /^data\.([A-Za-z0-9_-]+)/.exec(msg) ?? /\bdata\.([A-Za-z0-9_-]+)/.exec(msg);
  if (m && keys.includes(m[1]!)) return m[1]!;
  for (const k of keys) {
    if (new RegExp(`(^|[\\s"'\`(])${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([\\s"'\`:),.\\[]|$)`).test(msg)) return k;
  }
  for (const k of ENVELOPE_KEYS) if (new RegExp(`"${k}"|\\b${k}\\b must|^${k}:`, 'i').test(msg)) return k;
  if (/\$axf|envelope/i.test(msg)) return 'id';
  return '';
}

/** The validation gate: the whole result plus the errors per field. Save is allowed only when `ok`. */
export function gate(validate: Validate, asset: Draft, fields: readonly FieldDef[]): Gate {
  const errors: string[] = [];
  if (!ASSET_ID.test(asset.id)) errors.push(`"id" must match ${ASSET_ID_PATTERN} (2–48 lowercase letters, digits and dashes)`);
  else if (asset.id.startsWith(PREVIEW_PREFIX)) errors.push(`"id" may not start with ${PREVIEW_PREFIX} (reserved for the live preview)`);
  if (!asset.name.trim()) errors.push('"name" is required');
  const r = validate(stripDesigned(asset));
  for (const e of r.errors) if (!errors.includes(e)) errors.push(e);
  const keys = fields.map((f) => f.key);
  const byField: Record<string, string[]> = {};
  const general: string[] = [];
  for (const e of errors) {
    const k = fieldOfError(e, keys);
    if (k) (byField[k] ??= []).push(e);
    else general.push(e);
  }
  return { ok: errors.length === 0, errors, byField, general };
}

/** JSON text → value, or an error message. */
export function parseJson(text: string): { value?: unknown; error?: string } {
  try { return { value: JSON.parse(text) }; } catch (e) { return { error: (e as Error).message.replace(/^JSON\.parse: /, '') }; }
}

/** The type picker's options: every type, grouped by the registry's group, labelled "Group · Label". */
export function typeOptions(spec: Spec): { value: string; label: string; group: string }[] {
  return Object.entries(spec)
    .map(([value, t]) => ({ value, label: t.label, group: t.group ?? 'Other' }))
    .sort((a, b) => a.group.localeCompare(b.group) || a.label.localeCompare(b.label))
    .map((o) => ({ ...o, label: `${o.group} · ${o.label}` }));
}

/** An id from a name (slug), unique against `existing` (-2, -3…). */
export function suggestId(name: string, existing: readonly string[] = []): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 44) || 'asset';
  let id = base.length < 2 ? `${base}-1` : base;
  let n = 2;
  while (existing.includes(id)) id = `${base.slice(0, 44)}-${n++}`;
  return id;
}

/** The chrome type a settings asset is the interface of (data.for), or null. */
export const chromeTypeOfSettings = (a: Draft, chromeTypes: readonly string[]): string | null => (a.type === 'settings' && typeof a.data.for === 'string' && chromeTypes.includes(a.data.for) ? a.data.for : null);

/** Types whose active asset can be swapped for the live preview (not attachable widgets, not the access policy). */
export const previewable = (spec: Spec, type: string): boolean => Boolean(spec[type]) && !spec[type]!.attachable && !spec[type]!.collection && type !== 'uac-policy';
