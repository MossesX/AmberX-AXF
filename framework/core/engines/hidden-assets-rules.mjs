/**
 * Hidden assets (hidden-assets@1; Brett, Nov 17 2026, build rebuild-fresh-main-hide-any-asset: "We're supposed to be
 * able to hide toolbars and tab groups and all that and be able to see what's hidden."):
 * the per-app list of chrome pieces the user hid, kept in the app's own look document (app-look@1, `own.hiddenAssets`)
 * so it lives on axHub with the rest of the app's look, survives reloads, and Restore to default shows everything again.
 *
 * One entry per hidden piece: { kind, id, assetRef?, hiddenAt, by }
 *   kind      a hideable kind (`hiddenAssetKinds()`): the chrome-settings@1 kinds that draw something on the page
 *             (tab-group, toolbar, banner, nav-menu, app-menu) plus `widget` (a banner / toolbar widget). Never an app list.
 *   id        the instance id, the same slug the chrome context menu gives the piece (`axf.chrome.<kind>.<id>`)
 *   assetRef  the asset id the piece was drawn with when it was hidden (optional; the Hidden list names it)
 *   hiddenAt  ISO time it was hidden
 *   by        who hid it: the app id, a plugin, or an API caller
 *
 * Plain JS: the skins CLI, the console server and the runtime read the same list. Pure, no DOM. The engine that hides,
 * unhides and lists (hide / unhide / unhideAll / isHidden / listHidden) is engines/hidden-assets.ts. Kotlin twin deferred
 * (spec/PORTING.md).
 */
import { CHROME_TARGETS, CHROME_TYPES } from './chrome-settings-rules.mjs';

export const HIDDEN_ASSETS_CONTRACT = 'hidden-assets@1';
/** The field of a look part (app-look@1 `own` / `default` / `undo.own` / `backups[].own`) that holds the list. */
export const HIDDEN_ASSETS_FIELD = 'hiddenAssets';
/** The most entries kept; the oldest fall off first. */
export const HIDDEN_ASSETS_MAX = 500;
/** The kind a banner / toolbar widget is hidden as (widgets@1; not a chrome-settings kind of its own). */
export const HIDDEN_ASSET_WIDGET_KIND = 'widget';
/** An instance id: the chrome context menu's slug (chrome-settings@1 `isChromeInstanceId` is the same shape). */
export const HIDDEN_ASSET_ID = /^[a-z0-9][a-z0-9._:/-]{0,119}$/;
const ASSET_REF = /^[a-z0-9][a-z0-9._-]{0,119}$/;
const BY = /^[A-Za-z0-9][A-Za-z0-9 ._:@/-]{0,119}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * The kinds that may be hidden: every chrome-settings@1 kind that has a target on the page (a context menu has no
 * region, so it is not one) plus the widget kind. Read from the chrome kind list, never written down twice.
 */
export function hiddenAssetKinds() {
  return [...CHROME_TYPES.filter((k) => (CHROME_TARGETS[k] ?? []).length > 0), HIDDEN_ASSET_WIDGET_KIND];
}
export const isHiddenAssetKind = (k) => typeof k === 'string' && hiddenAssetKinds().includes(k);
export const isHiddenAssetId = (id) => typeof id === 'string' && HIDDEN_ASSET_ID.test(id);

/** The key one entry is matched by: `<kind>:<id>`. */
export const hiddenAssetKey = (kind, id) => `${kind}:${id}`;

/** `<kind>:<id>` → { kind, id }, or null when it is not one (unknown kind, bad id). */
export function parseHiddenAssetKey(key) {
  if (typeof key !== 'string') return null;
  const i = key.indexOf(':');
  if (i < 1) return null;
  const kind = key.slice(0, i);
  const id = key.slice(i + 1);
  return isHiddenAssetKind(kind) && isHiddenAssetId(id) ? { kind, id } : null;
}

/** One saved entry, cleaned: a valid kind and id, a well-formed time, optional assetRef and by; null = not an entry. */
export function normalizeHiddenAsset(raw) {
  if (!isObj(raw) || !isHiddenAssetKind(raw.kind) || !isHiddenAssetId(raw.id)) return null;
  const out = { kind: raw.kind, id: raw.id, hiddenAt: typeof raw.hiddenAt === 'string' && ISO.test(raw.hiddenAt) ? raw.hiddenAt : '', by: typeof raw.by === 'string' && BY.test(raw.by) ? raw.by : '' };
  if (typeof raw.assetRef === 'string' && ASSET_REF.test(raw.assetRef)) out.assetRef = raw.assetRef;
  return out;
}

/**
 * The saved list, cleaned: valid entries only, one per kind + id (the first hide stands), at most HIDDEN_ASSETS_MAX
 * (oldest dropped first). Anything that is not a list, or an old document with no list, reads as nothing hidden.
 */
export function normalizeHiddenAssets(raw) {
  const out = [];
  const seen = new Set();
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

/** The JSON Schema of the list, as app-look@1's schema embeds it (`axf schemas`). */
export function hiddenAssetsSchema() {
  return {
    type: 'array',
    description: 'hidden-assets@1: the chrome pieces hidden in this app (absent = nothing hidden); one entry per kind + id, oldest first, at most ' + HIDDEN_ASSETS_MAX,
    maxItems: HIDDEN_ASSETS_MAX,
    items: {
      type: 'object',
      required: ['kind', 'id', 'hiddenAt', 'by'],
      additionalProperties: false,
      properties: {
        kind: { enum: hiddenAssetKinds(), description: 'a hideable kind: the chrome-settings@1 kinds with a region on the page, plus widget' },
        id: { type: 'string', pattern: HIDDEN_ASSET_ID.source, description: 'the instance id (the chrome context menu slug, axf.chrome.<kind>.<id>)' },
        assetRef: { type: 'string', pattern: ASSET_REF.source, description: 'the asset id the piece was drawn with when hidden' },
        hiddenAt: { type: 'string', format: 'date-time', description: 'when it was hidden' },
        by: { type: 'string', pattern: BY.source, description: 'who hid it: the app id, a plugin, or an API caller' },
      },
    },
  };
}
