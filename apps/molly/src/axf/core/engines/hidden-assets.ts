/**
 * Hidden assets engine (hidden-assets@1; Brett, Nov 17 2026, build rebuild-fresh-main-hide-any-asset: "We're supposed
 * to be able to hide toolbars and tab groups and all that and be able to see what's hidden.").
 *
 * Hide one chrome piece (this toolbar, that tab row, a banner, a nav or application menu, a widget) in one app, see what
 * is hidden, bring one or all of them back. The state is the app's own look document (app-look@1, `own.hiddenAssets`,
 * engines/hidden-assets-rules.mjs holds the entry format and the kind list), so it lives on axHub with the rest of the
 * app's look, survives reloads, and Restore to default (own = {}) shows everything again. Only `own` is read and
 * written: a snapshot never hides anything.
 *
 * Every function is pure and returns the same document object when nothing changes (a refused target, hiding what is
 * hidden, unhiding what is not), so a writer can skip the save. Kinds come from the chrome-settings@1 kind list plus
 * `widget`; there is no app list anywhere. Kotlin twin deferred (spec/PORTING.md); fixture spec/fixtures/hidden-assets.json.
 */
import { HIDDEN_ASSETS_FIELD, hiddenAssetKey, hiddenAssetKinds, isHiddenAssetId, isHiddenAssetKind, normalizeHiddenAssets, parseHiddenAssetKey, type HiddenAsset, type HiddenAssetTarget } from './hidden-assets-rules.mjs';
import type { AppLookDocument } from './skin-rules.mjs';

export { HIDDEN_ASSETS_CONTRACT, HIDDEN_ASSETS_FIELD, HIDDEN_ASSETS_MAX, HIDDEN_ASSET_ID, HIDDEN_ASSET_WIDGET_KIND, hiddenAssetKey, hiddenAssetKinds, hiddenAssetsSchema, isHiddenAssetId, isHiddenAssetKind, normalizeHiddenAsset, normalizeHiddenAssets, parseHiddenAssetKey } from './hidden-assets-rules.mjs';
export type { HiddenAsset, HiddenAssetTarget } from './hidden-assets-rules.mjs';

/** What hide / unhide / isHidden take: `{ kind, id }` or the key `<kind>:<id>`. */
export type HiddenAssetRef = HiddenAssetTarget | string;

/** What a hide records besides the target. */
export interface HideOptions {
  /** ISO time (default: now) */
  at?: string;
  /** who hides: the app id, a plugin, or an API caller */
  by?: string;
  /** the asset id the piece is drawn with right now */
  assetRef?: string;
}

const ASSET_REF = /^[a-z0-9][a-z0-9._-]{0,119}$/;

/** A reference as a target, or null when it is not one (unknown kind, bad id). */
export function hiddenAssetTarget(ref: HiddenAssetRef | null | undefined): HiddenAssetTarget | null {
  if (typeof ref === 'string') return parseHiddenAssetKey(ref);
  if (!ref || typeof ref !== 'object') return null;
  return isHiddenAssetKind(ref.kind) && isHiddenAssetId(ref.id) ? { kind: ref.kind, id: ref.id } : null;
}

/** Why a reference is refused, in plain words, or null when it is fine. */
export function hiddenAssetTargetError(ref: HiddenAssetRef | null | undefined): string | null {
  const kind = typeof ref === 'string' ? ref.slice(0, Math.max(0, ref.indexOf(':'))) : ref && typeof ref === 'object' ? String(ref.kind ?? '') : '';
  const id = typeof ref === 'string' ? ref.slice(ref.indexOf(':') + 1) : ref && typeof ref === 'object' ? String(ref.id ?? '') : '';
  if (!isHiddenAssetKind(kind)) return `"${kind}" is not a kind that can be hidden (${hiddenAssetKinds().join(', ')})`;
  if (!isHiddenAssetId(id)) return `"${id}" is not an instance id`;
  return null;
}

/** The hidden list of a document, oldest first (a copy; empty for no document or no list). */
export function listHidden(look: AppLookDocument | null | undefined): HiddenAsset[] {
  return normalizeHiddenAssets(look?.own?.[HIDDEN_ASSETS_FIELD]);
}

/** The entry of one hidden piece, or null when it is not hidden. */
export function hiddenEntry(look: AppLookDocument | null | undefined, ref: HiddenAssetRef): HiddenAsset | null {
  const t = hiddenAssetTarget(ref);
  if (!t) return null;
  const key = hiddenAssetKey(t.kind, t.id);
  return listHidden(look).find((e) => hiddenAssetKey(e.kind, e.id) === key) ?? null;
}

/** Is this piece hidden in this app? An unknown kind or a bad id is never hidden. */
export function isHidden(look: AppLookDocument | null | undefined, ref: HiddenAssetRef): boolean {
  return hiddenEntry(look, ref) !== null;
}

/** The hidden pieces of one kind, oldest first. */
export function hiddenOfKind(look: AppLookDocument | null | undefined, kind: string): HiddenAsset[] {
  return listHidden(look).filter((e) => e.kind === kind);
}

/** How many pieces are hidden. */
export function hiddenCount(look: AppLookDocument | null | undefined): number {
  return listHidden(look).length;
}

function withList(look: AppLookDocument, list: HiddenAsset[]): AppLookDocument {
  const own = { ...look.own };
  if (list.length) own[HIDDEN_ASSETS_FIELD] = list;
  else delete own[HIDDEN_ASSETS_FIELD];
  return { ...look, own };
}

/**
 * Hide a piece: a new document with the entry appended (oldest first; over HIDDEN_ASSETS_MAX the oldest falls off).
 * Refused (the same document back) for an unknown kind, a bad id, or a piece already hidden (the first hide stands).
 */
export function hide(look: AppLookDocument, ref: HiddenAssetRef, opts: HideOptions = {}): AppLookDocument {
  const t = hiddenAssetTarget(ref);
  if (!t || isHidden(look, t)) return look;
  const entry: HiddenAsset = { kind: t.kind, id: t.id, hiddenAt: opts.at ?? new Date().toISOString(), by: opts.by ?? '' };
  if (opts.assetRef && ASSET_REF.test(opts.assetRef)) entry.assetRef = opts.assetRef;
  return withList(look, normalizeHiddenAssets([...listHidden(look), entry]));
}

/** Show a piece again: a new document without its entry; the same document back when it was not hidden. */
export function unhide(look: AppLookDocument, ref: HiddenAssetRef): AppLookDocument {
  const t = hiddenAssetTarget(ref);
  if (!t || !isHidden(look, t)) return look;
  const key = hiddenAssetKey(t.kind, t.id);
  return withList(look, listHidden(look).filter((e) => hiddenAssetKey(e.kind, e.id) !== key));
}

/** Show everything again: a new document with no hidden list; the same document back when nothing was hidden. */
export function unhideAll(look: AppLookDocument): AppLookDocument {
  return listHidden(look).length ? withList(look, []) : look;
}

/** Hide or show, as asked: `on` true hides, false shows. */
export function setHidden(look: AppLookDocument, ref: HiddenAssetRef, on: boolean, opts: HideOptions = {}): AppLookDocument {
  return on ? hide(look, ref, opts) : unhide(look, ref);
}
