/**
 * Hidden assets engine (hidden-assets@1; Brett, Nov 17 2026, build rebuild-fresh-main-hide-any-asset: "We're supposed
 * to be able to hide toolbars and tab groups and all that and be able to see what's hidden.").
 *
 * Hide one chrome piece (this toolbar, that tab row, a banner, a nav or application menu, a widget) in one app, see what
 * is hidden, bring one or all of them back. The state is a list in the app's own look document (app-look@1,
 * `own.hiddenAssets`), so it lives on axHub with the rest of the app's look, survives reloads, and Restore to default
 * (own = {}) shows everything again. Only `own` is read and written: a default snapshot never hides anything.
 *
 * One entry per hidden piece: { kind, id, assetRef?, hiddenAt, by }
 *   kind      a hideable kind (`hiddenAssetKinds()`): the chrome-settings@1 kinds that draw something on the page
 *             (tab-group, toolbar, banner, nav-menu, app-menu) plus `widget` (a banner / toolbar widget, widgets@1).
 *             Read from the chrome kind list: a kind added there with a page target is hideable with no change here.
 *             There is no app list anywhere: any app's look document takes the same entries.
 *   id        the instance id, the same slug the chrome context menu gives the piece (`axf.chrome.<kind>.<id>`)
 *   assetRef  the asset id the piece was drawn with when it was hidden (optional; the Hidden list names it)
 *   hiddenAt  ISO time it was hidden ('' when unknown)
 *   by        who hid it: the app id, a plugin, or an API caller ('' when unknown)
 *
 * Every function is pure (no DOM, no storage) and returns the same document object when nothing changes (a refused
 * target, hiding what is hidden, unhiding what is not), so a writer can skip the save. An old document with no list
 * reads as nothing hidden. This is separate from the slot-level Hidden choice (engines/hide.ts, `own.hidden`), which
 * drops a whole chrome type's layout region; an entry here hides one instance.
 *
 * Kotlin twin deferred (spec/PORTING.md); fixture spec/fixtures/hidden-assets.json.
 */
import { CHROME_TARGETS, CHROME_TYPES } from './chrome-settings-rules.mjs';
import type { AppLookDocument } from './skin-rules.mjs';

export const HIDDEN_ASSETS_CONTRACT = 'hidden-assets@1';
/** The field of the look document's `own` part that holds the list. */
export const HIDDEN_ASSETS_FIELD = 'hiddenAssets';
/** The most entries kept; the oldest fall off first. */
export const HIDDEN_ASSETS_MAX = 500;
/** The kind a banner / toolbar widget is hidden as (widgets@1; not a chrome-settings kind of its own). */
export const HIDDEN_ASSET_WIDGET_KIND = 'widget';
/** An instance id: the chrome context menu's slug (the shape chrome-settings@1 `isChromeInstanceId` accepts). */
export const HIDDEN_ASSET_ID = /^[a-z0-9][a-z0-9._:/-]{0,119}$/;
const ASSET_REF = /^[a-z0-9][a-z0-9._-]{0,119}$/;
const BY = /^[A-Za-z0-9][A-Za-z0-9 ._:@/-]{0,119}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

/** One hidden piece, as saved. */
export interface HiddenAsset {
  kind: string;
  id: string;
  /** the asset id the piece was drawn with when it was hidden */
  assetRef?: string;
  /** ISO time, '' when unknown */
  hiddenAt: string;
  /** the app id, a plugin, or an API caller; '' when unknown */
  by: string;
}
/** What names a piece: its kind and instance id. */
export interface HiddenAssetTarget { kind: string; id: string }
/** What hide / unhide / isHidden take: `{ kind, id }` or the key `<kind>:<id>`. */
export type HiddenAssetRef = HiddenAssetTarget | string;
/** What a hide records besides the target. */
export interface HideOptions {
  /** ISO time (default: now; pass it for a reproducible result) */
  at?: string;
  /** who hides: the app id, a plugin, or an API caller */
  by?: string;
  /** the asset id the piece is drawn with right now */
  assetRef?: string;
}
/** The look document the engine reads: any app-look@1 document (the list sits in `own`). */
export type HiddenAssetsLook = AppLookDocument | null | undefined;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * The kinds that may be hidden: every chrome-settings@1 kind that has a target on the page (a context menu has no
 * region, so it is not one) plus the widget kind. Read from the chrome kind list, never written down twice.
 */
export function hiddenAssetKinds(): string[] {
  const targets = CHROME_TARGETS as Record<string, string[] | undefined>;
  return [...(CHROME_TYPES as string[]).filter((k) => (targets[k] ?? []).length > 0), HIDDEN_ASSET_WIDGET_KIND];
}
export const isHiddenAssetKind = (k: unknown): k is string => typeof k === 'string' && hiddenAssetKinds().includes(k);
export const isHiddenAssetId = (id: unknown): id is string => typeof id === 'string' && HIDDEN_ASSET_ID.test(id);

/** The key one entry is matched by: `<kind>:<id>`. */
export const hiddenAssetKey = (kind: string, id: string): string => `${kind}:${id}`;

/** `<kind>:<id>` → { kind, id }, or null when it is not one (unknown kind, bad id). */
export function parseHiddenAssetKey(key: unknown): HiddenAssetTarget | null {
  if (typeof key !== 'string') return null;
  const i = key.indexOf(':');
  if (i < 1) return null;
  const kind = key.slice(0, i);
  const id = key.slice(i + 1);
  return isHiddenAssetKind(kind) && isHiddenAssetId(id) ? { kind, id } : null;
}

/** A reference as a target, or null when it is not one (unknown kind, bad id). */
export function hiddenAssetTarget(ref: HiddenAssetRef | null | undefined): HiddenAssetTarget | null {
  if (typeof ref === 'string') return parseHiddenAssetKey(ref);
  if (!isObj(ref)) return null;
  return isHiddenAssetKind(ref.kind) && isHiddenAssetId(ref.id) ? { kind: ref.kind, id: ref.id } : null;
}

/** Why a reference is refused, in plain words, or null when it is fine. */
export function hiddenAssetTargetError(ref: HiddenAssetRef | null | undefined): string | null {
  let kind = '';
  let id = '';
  if (typeof ref === 'string') {
    const i = ref.indexOf(':');
    kind = i < 0 ? ref : ref.slice(0, i);
    id = i < 0 ? '' : ref.slice(i + 1);
  } else if (isObj(ref)) {
    kind = typeof ref.kind === 'string' ? ref.kind : '';
    id = typeof ref.id === 'string' ? ref.id : '';
  }
  if (!isHiddenAssetKind(kind)) return `"${kind}" is not a kind that can be hidden (${hiddenAssetKinds().join(', ')})`;
  if (!isHiddenAssetId(id)) return `"${id}" is not an instance id`;
  return null;
}

/** One saved entry, cleaned: a valid kind and id, a well-formed time, optional assetRef and by; null = not an entry. */
export function normalizeHiddenAsset(raw: unknown): HiddenAsset | null {
  if (!isObj(raw) || !isHiddenAssetKind(raw.kind) || !isHiddenAssetId(raw.id)) return null;
  const out: HiddenAsset = {
    kind: raw.kind,
    id: raw.id,
    hiddenAt: typeof raw.hiddenAt === 'string' && ISO.test(raw.hiddenAt) ? raw.hiddenAt : '',
    by: typeof raw.by === 'string' && BY.test(raw.by) ? raw.by : '',
  };
  if (typeof raw.assetRef === 'string' && ASSET_REF.test(raw.assetRef)) out.assetRef = raw.assetRef;
  return out;
}

/**
 * The saved list, cleaned: valid entries only, one per kind + id (the first hide stands), at most HIDDEN_ASSETS_MAX
 * (oldest dropped first). Anything that is not a list, or an old document with no list, reads as nothing hidden.
 */
export function normalizeHiddenAssets(raw: unknown): HiddenAsset[] {
  const out: HiddenAsset[] = [];
  const seen = new Set<string>();
  for (const e of Array.isArray(raw) ? raw : []) {
    const n = normalizeHiddenAsset(e);
    if (!n) continue;
    const key = hiddenAssetKey(n.kind, n.id);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(n);
  }
  return out.length > HIDDEN_ASSETS_MAX ? out.slice(out.length - HIDDEN_ASSETS_MAX) : out;
}

/** The hidden list of a document, oldest first (a copy; empty for no document or no list). */
export function listHidden(look: HiddenAssetsLook): HiddenAsset[] {
  const own: unknown = look?.own;
  return normalizeHiddenAssets(isObj(own) ? own[HIDDEN_ASSETS_FIELD] : undefined);
}

/** The entry of one hidden piece, or null when it is not hidden. */
export function hiddenEntry(look: HiddenAssetsLook, ref: HiddenAssetRef): HiddenAsset | null {
  const t = hiddenAssetTarget(ref);
  if (!t) return null;
  const key = hiddenAssetKey(t.kind, t.id);
  return listHidden(look).find((e) => hiddenAssetKey(e.kind, e.id) === key) ?? null;
}

/** Is this piece hidden in this app? An unknown kind or a bad id is never hidden. */
export function isHidden(look: HiddenAssetsLook, ref: HiddenAssetRef): boolean {
  return hiddenEntry(look, ref) !== null;
}

/** The hidden pieces of one kind, oldest first. */
export function hiddenOfKind(look: HiddenAssetsLook, kind: string): HiddenAsset[] {
  return listHidden(look).filter((e) => e.kind === kind);
}

/** How many pieces are hidden. */
export function hiddenCount(look: HiddenAssetsLook): number {
  return listHidden(look).length;
}

function withList<T extends AppLookDocument>(look: T, list: HiddenAsset[]): T {
  const own: Record<string, unknown> = { ...look.own };
  if (list.length) own[HIDDEN_ASSETS_FIELD] = list;
  else delete own[HIDDEN_ASSETS_FIELD];
  return { ...look, own };
}

/**
 * Hide a piece: a new document with the entry appended (oldest first; over HIDDEN_ASSETS_MAX the oldest falls off).
 * Refused (the same document back) for an unknown kind, a bad id, or a piece already hidden (the first hide stands).
 */
export function hide<T extends AppLookDocument>(look: T, ref: HiddenAssetRef, opts: HideOptions = {}): T {
  const t = hiddenAssetTarget(ref);
  if (!t || isHidden(look, t)) return look;
  const entry: HiddenAsset = { kind: t.kind, id: t.id, hiddenAt: opts.at ?? new Date().toISOString(), by: opts.by ?? '' };
  if (opts.assetRef) entry.assetRef = opts.assetRef;
  return withList(look, normalizeHiddenAssets([...listHidden(look), entry]));
}

/** Show a piece again: a new document without its entry; the same document back when it was not hidden. */
export function unhide<T extends AppLookDocument>(look: T, ref: HiddenAssetRef): T {
  const t = hiddenAssetTarget(ref);
  if (!t || !isHidden(look, t)) return look;
  const key = hiddenAssetKey(t.kind, t.id);
  return withList(look, listHidden(look).filter((e) => hiddenAssetKey(e.kind, e.id) !== key));
}

/** Show everything again: a new document with no hidden list; the same document back when nothing was hidden. */
export function unhideAll<T extends AppLookDocument>(look: T): T {
  return listHidden(look).length ? withList(look, []) : look;
}

/** Hide or show, as asked: `on` true hides, false shows. */
export function setHidden<T extends AppLookDocument>(look: T, ref: HiddenAssetRef, on: boolean, opts: HideOptions = {}): T {
  return on ? hide(look, ref, opts) : unhide(look, ref);
}
