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
/** Largest document an app accepts (the hub's data API caps at 64 KB; this is far below). */
export const APPEARANCE_MAX_BYTES = 16 * 1024;
/** Slots an appearance document never carries: access policies come from the account / the app, never from shared data. */
export const APPEARANCE_NEVER: readonly string[] = ['uac-policy'];

const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const APP_ID = /^[a-z0-9][a-z0-9.-]{0,79}$/;
/** Most apps one document keeps hidden slots for. */
export const APPEARANCE_MAX_APPS = 40;

function hiddenMap(raw: unknown): Record<string, boolean> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const hidden: Record<string, boolean> = {};
  for (const [t, v] of Object.entries(raw as Record<string, unknown>)) if (typeof v === 'boolean' && ID.test(t)) hidden[t] = v;
  return Object.keys(hidden).length ? hidden : null;
}
const COLOR = /^(#[0-9a-f]{3,8}|rgba?\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*(,\s*[\d.]+\s*)?\))$/i;
const PALETTE_KEYS = ['bg', 'fg', 'muted', 'card', 'line', 'accent', 'danger', 'ok'] as const;

/** The on-the-wire document. Every field but `$axf` is optional; unknown fields are kept out when written back. */
export interface AppearanceDocument {
  $axf: typeof APPEARANCE_FRAME;
  /** asset type → asset id (appearance slots only) */
  slots?: Record<string, string>;
  spacing?: Spacing;
  /** chrome slots (hideable types) → hidden; absent = the app's default. Legacy, shared by every app: apps that
   *  pass their id to `resolveAppearance` ignore it and read `hiddenBy` instead (Brett, Oct 25 2026). */
  hidden?: Record<string, boolean>;
  /** app id → its own hidden chrome slots: hiding a bar in one app never hides it in another (Console vs Patches). */
  hiddenBy?: Record<string, Record<string, boolean>>;
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
  const flat = hiddenMap(o.hidden);
  if (flat) doc.hidden = flat;
  if (o.hiddenBy && typeof o.hiddenBy === 'object' && !Array.isArray(o.hiddenBy)) {
    const by: Record<string, Record<string, boolean>> = {};
    for (const [app, m] of Object.entries(o.hiddenBy as Record<string, unknown>)) {
      if (Object.keys(by).length >= APPEARANCE_MAX_APPS) break;
      const h = APP_ID.test(app) ? hiddenMap(m) : null;
      if (h) by[app] = h;
    }
    if (Object.keys(by).length) doc.hiddenBy = by;
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
 * skipped; spacing must be a known choice. Nothing here can crash on any input. With `app`, hidden slots come only
 * from that app's own entry in `hiddenBy` (the shared legacy `hidden` is ignored), so apps never hide each other's bars.
 */
export function resolveAppearance(doc: AppearanceDocument | null, has: (type: string, id: string) => boolean, types: readonly string[] = ASSET_TYPES, app?: string): ResolvedAppearance {
  const out: ResolvedAppearance = { slots: {}, spacing: null, hidden: {}, skipped: [] };
  if (!doc) return out;
  const slotTypes = appearanceSlotTypes(types);
  for (const [t, id] of Object.entries(doc.slots ?? {})) {
    if (!slotTypes.includes(t)) { out.skipped.push(`${t}:${id} (not a slot here)`); continue; }
    if (!has(t, id)) { out.skipped.push(`${t}:${id} (not in this app)`); continue; }
    out.slots[t] = id;
  }
  if (doc.spacing) out.spacing = spacingOf(doc.spacing);
  for (const [t, v] of Object.entries((app ? doc.hiddenBy?.[app] : doc.hidden) ?? {})) {
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
 * — slots of types this app doesn't have included, so one app never erases another app's choices. With `perApp`,
 * hidden changes go into `hiddenBy[by]` (this app's own bars) instead of the shared legacy `hidden`.
 */
export function mergeAppearance(base: AppearanceDocument | null, change: { slots?: Record<string, string>; spacing?: Spacing; hidden?: Record<string, boolean | null>; palette?: AppearanceDocument['palette'] }, by: string, now: string, perApp = false): AppearanceDocument {
  const doc: AppearanceDocument = normalizeAppearance({ ...(base ?? { $axf: APPEARANCE_FRAME }), $axf: APPEARANCE_FRAME }) ?? { $axf: APPEARANCE_FRAME };
  if (change.slots) doc.slots = { ...(doc.slots ?? {}), ...change.slots };
  if (change.spacing) doc.spacing = change.spacing;
  if (change.hidden) {
    const app = by.slice(0, 80);
    const hidden = { ...((perApp ? doc.hiddenBy?.[app] : doc.hidden) ?? {}) };
    for (const [t, v] of Object.entries(change.hidden)) { if (v === null) delete hidden[t]; else hidden[t] = v; }
    if (!perApp) doc.hidden = hidden;
    else if (APP_ID.test(app)) {
      const rest = Object.fromEntries(Object.entries(doc.hiddenBy ?? {}).filter(([a]) => a !== app));
      doc.hiddenBy = Object.keys(hidden).length ? { ...rest, [app]: hidden } : rest;
    }
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
  if (doc.hiddenBy) ordered.hiddenBy = Object.fromEntries(Object.entries(doc.hiddenBy).sort(([a], [b]) => a.localeCompare(b)).map(([a, h]) => [a, Object.fromEntries(Object.entries(h).sort(([x], [y]) => x.localeCompare(y)))]));
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
