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
import spec from '../../schemas/asset-types.json';

export const APPEARANCE_FRAME = 'appearance@1';
/** Where the document lives on the data server: project `shared`, path inside `_data`. */
export const APPEARANCE_PROJECT = 'shared';
export const APPEARANCE_PATH = 'settings/appearance.json';
/** Largest document an app accepts (the hub's data API caps at 64 KB; this is far below). */
export const APPEARANCE_MAX_BYTES = 16 * 1024;
/** Slots an appearance document never carries: access policies come from the account / the app, never from shared data. */
export const APPEARANCE_NEVER: readonly string[] = ['uac-policy'];

const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
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

/**
 * Merge one app's change into the document (a save from Settings → Appearance, the theme manager or Build Pilot's
 * Look). Per key, last write wins (the framework's UI-editor rule): keys the change doesn't name are kept from `base`
 * — slots of types this app doesn't have included, so one app never erases another app's choices.
 */
export function mergeAppearance(base: AppearanceDocument | null, change: { slots?: Record<string, string>; spacing?: Spacing; hidden?: Record<string, boolean | null>; palette?: AppearanceDocument['palette'] }, by: string, now: string): AppearanceDocument {
  const doc: AppearanceDocument = normalizeAppearance({ ...(base ?? { $axf: APPEARANCE_FRAME }), $axf: APPEARANCE_FRAME }) ?? { $axf: APPEARANCE_FRAME };
  if (change.slots) doc.slots = { ...(doc.slots ?? {}), ...change.slots };
  if (change.spacing) doc.spacing = change.spacing;
  if (change.hidden) {
    const hidden = { ...(doc.hidden ?? {}) };
    for (const [t, v] of Object.entries(change.hidden)) { if (v === null) delete hidden[t]; else hidden[t] = v; }
    doc.hidden = hidden;
  }
  if (change.palette) doc.palette = change.palette;
  doc.updatedBy = by.slice(0, 80);
  doc.updatedAt = now;
  return normalizeAppearance(doc) ?? { $axf: APPEARANCE_FRAME };
}

/* ---------------------------------------------------------------------------------------------------------------
 * One look, each app its own frame (scoped appearance, Brett Oct 24 2026: "make it all function like 1 professional
 * app when Patches runs things").
 *
 * The document used to hold one id per slot for every app at once, so a layout, banner, menu, toolbar or hidden bar
 * picked in the Dev Console was applied in Patches, axHub and Pilot too (Patches lost its tab layout, its banner and
 * its menu whenever the Console saved its own). Now:
 *
 *   shared look      types marked `"shared": true` in asset-types.json (colour + style theme, buttons, sliders,
 *                    containers, dialogs, popups, tab groups, gauges, meters) and the spacing: top-level `slots` /
 *                    `spacing`, one value for every app, so every app looks the same.
 *   each app's own   every other type (layout, app menu, toolbar, nav menu, context menu, banner, widgets, settings
 *                    interface) and the hidden bars: per app, under `slots` / `hidden` keys `app--<app id>--<type>`.
 *
 * The per-app keys live inside the same two maps on purpose: apps on an older framework (and the Kotlin kernel until
 * its twin lands) keep those keys when they save (they keep every slot key) and skip them when they read (not a slot
 * type there), so nothing they do erases another app's frame. Top-level ids of per-app types (written before this
 * change, or by an older app) are ignored by `resolveAppearanceFor`: the app's own pick or its manifest default wins.
 * `resolveAppearance` / `mergeAppearance` above stay as they were (fixture-pinned on both ports).
 * --------------------------------------------------------------------------------------------------------------- */

const typeSpec = spec.types as Record<string, { shared?: boolean }>;
/** Prefix of a per-app key (`app--patches-web--layout`). */
export const APP_KEY_PREFIX = 'app--';
const APP_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Is this type's pick shared by every app (the look), or each app's own (its frame)? */
export function appearanceShared(type: string): boolean { return typeSpec[type]?.shared === true; }

/** The shared look types, in schema order. */
export function appearanceSharedTypes(types: readonly string[] = ASSET_TYPES): string[] { return types.filter((t) => appearanceShared(t)); }

/** The key an app's own pick of `type` is kept under, or null when the app id or the key can't be one. */
export function appSlotKey(appId: string, type: string): string | null {
  if (typeof appId !== 'string' || !APP_ID.test(appId) || typeof type !== 'string' || !ID.test(type) || type.includes('--')) return null;
  const key = `${APP_KEY_PREFIX}${appId}--${type}`;
  return ID.test(key) ? key : null;
}

/** `app--<app>--<type>` → { app, type }, else null (a shared key, or not one at all). */
export function parseAppSlotKey(key: string): { app: string; type: string } | null {
  if (typeof key !== 'string' || !key.startsWith(APP_KEY_PREFIX)) return null;
  const rest = key.slice(APP_KEY_PREFIX.length);
  const at = rest.indexOf('--');
  if (at <= 0) return null;
  const app = rest.slice(0, at), type = rest.slice(at + 2);
  return APP_ID.test(app) && ID.test(type) && !type.includes('--') ? { app, type } : null;
}

/** The apps that keep a frame of their own in the document (sorted). */
export function appearanceApps(doc: AppearanceDocument | null): string[] {
  const out = new Set<string>();
  for (const k of [...Object.keys(doc?.slots ?? {}), ...Object.keys(doc?.hidden ?? {})]) { const p = parseAppSlotKey(k); if (p) out.add(p.app); }
  return [...out].sort();
}

/**
 * What the document means for one app: the shared look from the top level, the app's own frame from its keys. Ids the
 * app doesn't ship are skipped (that slot keeps the app's default), like `resolveAppearance`; a top-level id of a
 * per-app type is skipped too ("each app keeps its own"), and other apps' keys are left alone without a word.
 */
export function resolveAppearanceFor(doc: AppearanceDocument | null, appId: string, has: (type: string, id: string) => boolean, types: readonly string[] = ASSET_TYPES): ResolvedAppearance {
  const out: ResolvedAppearance = { slots: {}, spacing: null, hidden: {}, skipped: [] };
  if (!doc) return out;
  const slotTypes = appearanceSlotTypes(types);
  const take = (t: string, id: string) => {
    if (!slotTypes.includes(t)) { out.skipped.push(`${t}:${id} (not a slot here)`); return; }
    if (!has(t, id)) { out.skipped.push(`${t}:${id} (not in this app)`); return; }
    out.slots[t] = id;
  };
  for (const [k, id] of Object.entries(doc.slots ?? {})) {
    const own = parseAppSlotKey(k);
    if (own) {
      if (own.app !== appId) continue;
      if (appearanceShared(own.type)) { out.skipped.push(`${own.type}:${id} (one look for every app: kept at the top level)`); continue; }
      take(own.type, id);
    } else if (appearanceShared(k)) take(k, id);
    else out.skipped.push(`${k}:${id} (each app keeps its own ${k})`);
  }
  if (doc.spacing) out.spacing = spacingOf(doc.spacing);
  for (const [k, v] of Object.entries(doc.hidden ?? {})) {
    const own = parseAppSlotKey(k);
    if (!own) { out.skipped.push(`hidden ${k} (each app keeps its own bars)`); continue; }
    if (own.app !== appId) continue;
    if (!types.includes(own.type) || !hideable(own.type)) { out.skipped.push(`hidden ${own.type} (not hideable)`); continue; }
    out.hidden[own.type] = v;
  }
  return out;
}

/** A change as an app pushes it: ids by type (null = back to the app's default), hidden bars, spacing, palette. */
export interface AppearanceChange { slots?: Record<string, string | null>; spacing?: Spacing; hidden?: Record<string, boolean | null>; palette?: AppearanceDocument['palette'] }

/**
 * Merge one app's change into the document, scoped: a shared type goes to the top level (every app follows it), any
 * other type and every hidden bar to this app's own keys. Null removes the key (the app's default again). Everything
 * else is kept: other apps' keys, top-level keys older apps still read. Last write wins per key, as before.
 */
export function mergeAppearanceFor(base: AppearanceDocument | null, change: AppearanceChange, appId: string, by: string, now: string): AppearanceDocument {
  const doc: AppearanceDocument = normalizeAppearance({ ...(base ?? { $axf: APPEARANCE_FRAME }), $axf: APPEARANCE_FRAME }) ?? { $axf: APPEARANCE_FRAME };
  if (change.slots) {
    const slots = { ...(doc.slots ?? {}) };
    for (const [t, id] of Object.entries(change.slots)) {
      if (APPEARANCE_NEVER.includes(t)) continue;
      const key = appearanceShared(t) ? t : appSlotKey(appId, t);
      if (!key) continue;
      if (id === null) delete slots[key]; else if (typeof id === 'string') slots[key] = id;
    }
    doc.slots = slots;
  }
  if (change.spacing) doc.spacing = change.spacing;
  if (change.hidden) {
    const hidden = { ...(doc.hidden ?? {}) };
    for (const [t, v] of Object.entries(change.hidden)) {
      const key = appSlotKey(appId, t);
      if (!key) continue;
      if (v === null) delete hidden[key]; else hidden[key] = v;
    }
    doc.hidden = hidden;
  }
  if (change.palette) doc.palette = change.palette;
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
