/**
 * Appearance engine — the shared appearance document (`appearance@1`) Brett's developer apps keep on the axHub
 * data server (decision Oct 20 2026: all settings and shared data of developer apps come from the hub; the theme is
 * the first such document, at `shared/settings/appearance.json`).
 *
 * The document holds **ids and small values only**: the chosen asset id per appearance slot, the spacing choice,
 * which chrome slots are hidden, and a small colour palette the hub's own pages use. Never asset bodies, never code.
 * Everything in it is validated against the app's own registry when applied (`resolveAppearance`): an id the app
 * doesn't ship means that slot keeps the app's default (a missing asset, not a fallback), a bad value is dropped.
 *
 * Pure and port-neutral: Kotlin mirrors it as `AppearanceEngine` (fixtures: spec/fixtures/appearance.json).
 */
import { hideable } from './hide';
import { spacingOf, type Spacing } from './spacing';
import { ASSET_TYPES } from '../types';

export const APPEARANCE_FRAME = 'appearance@1';
/** Where the document lives on the data server: project `shared`, path inside `_data`. */
export const APPEARANCE_PROJECT = 'shared';
export const APPEARANCE_PATH = 'settings/appearance.json';
/** Largest document an app accepts (the hub's data API caps at 64 KB; this is far below). Fixture-pinned on both ports. */
export const APPEARANCE_MAX_BYTES = 16 * 1024;
/** Largest single look setting value (its JSON) the document carries. */
export const APPEARANCE_SETTING_MAX_BYTES = 4 * 1024;
/** Slots an appearance document never carries: access policies come from the account / the app, never from shared data; help packs are all in force at once (no pick to share). */
export const APPEARANCE_NEVER: readonly string[] = ['uac-policy', 'help'];

const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
/** A look settings key (`axf.look`, `axf.custom.button.amber`, …); which keys count is the runtime's call. */
const SETTING_KEY = /^[a-z0-9][a-zA-Z0-9._:-]{1,159}$/;
type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue };
const COLOR = /^(#[0-9a-f]{3,8}|rgba?\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*(,\s*[\d.]+\s*)?\))$/i;
const PALETTE_KEYS = ['bg', 'fg', 'muted', 'card', 'line', 'accent', 'danger', 'ok'] as const;

/** The on-the-wire document. Every field but `$axf` is optional; unknown fields are kept out when written back. */
export interface AppearanceDocument {
  $axf: typeof APPEARANCE_FRAME;
  /** asset type → asset id (appearance slots only) */
  slots?: Record<string, string>;
  spacing?: Spacing;
  /** chrome slots (hideable types) → hidden; absent = the app's default */
  hidden?: Record<string, boolean>;
  /** a few colours for apps that don't run the theme engine (axHub's own pages); derived from the colour theme */
  palette?: Partial<Record<(typeof PALETTE_KEYS)[number], string>> & { scheme?: 'light' | 'dark' };
  /**
   * The look settings every app shares (Nov 1 2026, Brett: "Any theme change applies to all"): Sliders, per-asset
   * tokens, banner looks, rolls… (settings keys the runtime counts as appearance) → value. Present = the hub owns them:
   * an app clears its own look settings that aren't listed. Absent = an older document; nothing is cleared.
   */
  settings?: Record<string, JsonValue>;
  /** who saved it last (app id), when; informational */
  updatedBy?: string;
  updatedAt?: string;
}

/** What `resolveAppearance` returns: only values the app can apply, plus what it skipped and why. */
export interface ResolvedAppearance {
  /** slot → id, every id registered in this app */
  slots: Record<string, string>;
  spacing: Spacing | null;
  hidden: Record<string, boolean>;
  /** `type:id` entries the app doesn't have (that slot keeps its default), and other dropped fields */
  skipped: string[];
}

/** Which types count as appearance slots: every asset type the app has, except the access policy. */
export function appearanceSlotTypes(types: readonly string[] = ASSET_TYPES): string[] {
  return types.filter((t) => !APPEARANCE_NEVER.includes(t));
}

/**
 * Parse text into a document, or null when it isn't one (not JSON, wrong frame, too big). Unknown fields are
 * dropped, every value is shape-checked; registry checks happen in `resolveAppearance`.
 */
export function parseAppearance(text: string | null | undefined, maxBytes = APPEARANCE_MAX_BYTES): AppearanceDocument | null {
  if (typeof text !== 'string' || !text.trim() || text.length > maxBytes) return null;
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return null; }
  return normalizeAppearance(raw);
}

/** Same as parseAppearance, from an already-parsed value. */
export function normalizeAppearance(raw: unknown): AppearanceDocument | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (o.$axf !== APPEARANCE_FRAME) return null;
  const doc: AppearanceDocument = { $axf: APPEARANCE_FRAME };
  if (o.slots && typeof o.slots === 'object' && !Array.isArray(o.slots)) {
    const slots: Record<string, string> = {};
    for (const [t, id] of Object.entries(o.slots as Record<string, unknown>)) {
      if (typeof id === 'string' && ID.test(id) && typeof t === 'string' && ID.test(t) && !APPEARANCE_NEVER.includes(t)) slots[t] = id;
    }
    if (Object.keys(slots).length) doc.slots = slots;
  }
  if (typeof o.spacing === 'string' && spacingOf(o.spacing) === o.spacing) doc.spacing = o.spacing as Spacing;
  if (o.hidden && typeof o.hidden === 'object' && !Array.isArray(o.hidden)) {
    const hidden: Record<string, boolean> = {};
    for (const [t, v] of Object.entries(o.hidden as Record<string, unknown>)) if (typeof v === 'boolean' && ID.test(t)) hidden[t] = v;
    if (Object.keys(hidden).length) doc.hidden = hidden;
  }
  if (o.palette && typeof o.palette === 'object' && !Array.isArray(o.palette)) {
    const p = o.palette as Record<string, unknown>;
    const palette: NonNullable<AppearanceDocument['palette']> = {};
    for (const k of PALETTE_KEYS) { const v = p[k]; if (typeof v === 'string' && v.length <= 40 && COLOR.test(v)) palette[k] = v; }
    if (p.scheme === 'light' || p.scheme === 'dark') palette.scheme = p.scheme;
    if (Object.keys(palette).length) doc.palette = palette;
  }
  if (o.settings && typeof o.settings === 'object' && !Array.isArray(o.settings)) {
    const settings: Record<string, JsonValue> = {};
    for (const [k, v] of Object.entries(o.settings as Record<string, unknown>)) {
      if (!SETTING_KEY.test(k) || v === undefined || v === null) continue;
      let text: string;
      try { text = JSON.stringify(v); } catch { continue; }
      if (typeof text === 'string' && text.length <= APPEARANCE_SETTING_MAX_BYTES) settings[k] = JSON.parse(text) as JsonValue;
    }
    doc.settings = settings; // kept even when empty: an empty map still says "the hub owns the look settings"
  }
  if (typeof o.updatedBy === 'string' && o.updatedBy.length <= 80) doc.updatedBy = o.updatedBy;
  if (typeof o.updatedAt === 'string' && o.updatedAt.length <= 40) doc.updatedAt = o.updatedAt;
  return doc;
}

/**
 * Check a document against what this app actually has. `has(type, id)` is the app's registry; `types` its asset
 * types. An unknown slot id is skipped (the slot keeps the app's default); a hidden flag on a non-hideable type is
 * skipped; spacing must be a known choice. Nothing here can crash on any input.
 */
export function resolveAppearance(doc: AppearanceDocument | null, has: (type: string, id: string) => boolean, types: readonly string[] = ASSET_TYPES): ResolvedAppearance {
  const out: ResolvedAppearance = { slots: {}, spacing: null, hidden: {}, skipped: [] };
  if (!doc) return out;
  const slotTypes = appearanceSlotTypes(types);
  for (const [t, id] of Object.entries(doc.slots ?? {})) {
    if (!slotTypes.includes(t)) { out.skipped.push(`${t}:${id} (not a slot here)`); continue; }
    if (!has(t, id)) { out.skipped.push(`${t}:${id} (not in this app)`); continue; }
    out.slots[t] = id;
  }
  if (doc.spacing) out.spacing = spacingOf(doc.spacing);
  for (const [t, v] of Object.entries(doc.hidden ?? {})) {
    if (!types.includes(t) || !hideable(t)) { out.skipped.push(`hidden ${t} (not hideable)`); continue; }
    out.hidden[t] = v;
  }
  return out;
}

/** Palette for the hub's own pages, from a colour theme's tokens (the keys axHub's CSS uses). */
export function paletteFromColorTheme(data: { scheme?: string; tokens?: Record<string, string> } | null | undefined): AppearanceDocument['palette'] | undefined {
  const t = data?.tokens;
  if (!t) return undefined;
  const pick = (k: string) => (typeof t[k] === 'string' && COLOR.test(t[k]!) ? t[k] : undefined);
  const p: NonNullable<AppearanceDocument['palette']> = {};
  const map: Record<(typeof PALETTE_KEYS)[number], string> = { bg: 'bg', fg: 'text', muted: 'muted', card: 'surface', line: 'border', accent: 'accent', danger: 'danger', ok: 'success' };
  for (const [k, token] of Object.entries(map) as [(typeof PALETTE_KEYS)[number], string][]) { const v = pick(token); if (v) p[k] = v; }
  if (data?.scheme === 'light' || data?.scheme === 'dark') p.scheme = data.scheme;
  return Object.keys(p).length ? p : undefined;
}

/** One app's change: only the keys it names (null = remove that hidden flag / look setting). */
export interface AppearanceChange {
  slots?: Record<string, string>;
  spacing?: Spacing;
  hidden?: Record<string, boolean | null>;
  palette?: AppearanceDocument['palette'];
  settings?: Record<string, unknown>;
}

/** Fold a later change into an earlier pending one (per key, the later wins). */
export function combineAppearanceChanges(a: AppearanceChange | null, b: AppearanceChange): AppearanceChange {
  if (!a) return b;
  const out: AppearanceChange = {};
  if (a.slots || b.slots) out.slots = { ...a.slots, ...b.slots };
  if (a.hidden || b.hidden) out.hidden = { ...a.hidden, ...b.hidden };
  if (a.settings || b.settings) out.settings = { ...a.settings, ...b.settings };
  const spacing = b.spacing ?? a.spacing; if (spacing) out.spacing = spacing;
  const palette = b.palette ?? a.palette; if (palette) out.palette = palette;
  return out;
}

/**
 * Merge one app's change into the document (a save from Settings → Appearance, the theme manager or Build Pilot's
 * Look). Per key, last write wins (the framework's UI-editor rule): keys the change doesn't name are kept from `base`
 * — slots of types this app doesn't have included, so one app never erases another app's choices.
 */
export function mergeAppearance(base: AppearanceDocument | null, change: AppearanceChange, by: string, now: string): AppearanceDocument {
  const doc: AppearanceDocument = normalizeAppearance({ ...(base ?? { $axf: APPEARANCE_FRAME }), $axf: APPEARANCE_FRAME }) ?? { $axf: APPEARANCE_FRAME };
  if (change.slots) doc.slots = { ...(doc.slots ?? {}), ...change.slots };
  if (change.spacing) doc.spacing = change.spacing;
  if (change.hidden) {
    const hidden = { ...(doc.hidden ?? {}) };
    for (const [t, v] of Object.entries(change.hidden)) { if (v === null) delete hidden[t]; else hidden[t] = v; }
    doc.hidden = hidden;
  }
  if (change.palette) doc.palette = change.palette;
  if (change.settings) {
    const before = doc.settings;
    const settings = { ...(before ?? {}) };
    for (const [k, v] of Object.entries(change.settings)) { if (v === null || v === undefined) delete settings[k]; else settings[k] = v as JsonValue; }
    doc.settings = settings;
    // never write a document other apps would refuse: look settings that don't fit keep what the hub had
    if (serializeAppearance(doc).length > APPEARANCE_MAX_BYTES) { if (before) doc.settings = before; else delete doc.settings; }
  }
  doc.updatedBy = by.slice(0, 80);
  doc.updatedAt = now;
  return normalizeAppearance(doc) ?? { $axf: APPEARANCE_FRAME };
}

/** The document's text, stable key order, compact. */
export function serializeAppearance(doc: AppearanceDocument): string {
  const ordered: AppearanceDocument = { $axf: APPEARANCE_FRAME };
  if (doc.slots) ordered.slots = Object.fromEntries(Object.entries(doc.slots).sort(([a], [b]) => a.localeCompare(b)));
  if (doc.spacing) ordered.spacing = doc.spacing;
  if (doc.hidden) ordered.hidden = Object.fromEntries(Object.entries(doc.hidden).sort(([a], [b]) => a.localeCompare(b)));
  if (doc.palette) ordered.palette = doc.palette;
  if (doc.settings) ordered.settings = Object.fromEntries(Object.entries(doc.settings).sort(([a], [b]) => a.localeCompare(b)));
  if (doc.updatedBy) ordered.updatedBy = doc.updatedBy;
  if (doc.updatedAt) ordered.updatedAt = doc.updatedAt;
  return JSON.stringify(ordered, null, 2);
}

/* ---------------- the source contract (what an app plugs in) ---------------- */

/** Why the hub isn't answering; the waiting screen shows it. */
export type AppearanceSourceState =
  | { status: 'connecting' }
  | { status: 'ready'; version: string | null }
  | { status: 'unauthorized'; reason: string }
  | { status: 'unreachable'; reason: string; retryInMs: number; attempt: number };

/**
 * Backoff for reconnects: 1 s, 2 s, 4 s … capped at 30 s, the same numbers on every port (fixture-pinned).
 */
export function appearanceRetryMs(attempt: number): number {
  const a = Math.max(0, Math.floor(attempt));
  return Math.min(30_000, 1000 * 2 ** Math.min(a, 5));
}
