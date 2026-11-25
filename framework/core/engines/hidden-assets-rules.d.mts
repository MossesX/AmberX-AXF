/** Types for hidden-assets-rules.mjs (hidden-assets@1). */

/** One hidden chrome piece in an app's look document (app-look@1 `own.hiddenAssets`). */
export interface HiddenAsset {
  /** a hideable kind (`hiddenAssetKinds()`): tab-group | toolbar | banner | nav-menu | app-menu | widget */
  kind: string;
  /** the instance id, the chrome context menu's slug (`axf.chrome.<kind>.<id>`) */
  id: string;
  /** the asset id the piece was drawn with when it was hidden */
  assetRef?: string;
  /** ISO time it was hidden ('' when the saved entry had none) */
  hiddenAt: string;
  /** who hid it: the app id, a plugin, or an API caller ('' when unknown) */
  by: string;
}
/** What hide / unhide / isHidden take: a kind and an instance id. */
export interface HiddenAssetTarget { kind: string; id: string }

export const HIDDEN_ASSETS_CONTRACT: 'hidden-assets@1';
export const HIDDEN_ASSETS_FIELD: 'hiddenAssets';
export const HIDDEN_ASSETS_MAX: number;
export const HIDDEN_ASSET_WIDGET_KIND: 'widget';
export const HIDDEN_ASSET_ID: RegExp;
export function hiddenAssetKinds(): string[];
export function isHiddenAssetKind(k: unknown): k is string;
export function isHiddenAssetId(id: unknown): id is string;
export function hiddenAssetKey(kind: string, id: string): string;
export function parseHiddenAssetKey(key: unknown): HiddenAssetTarget | null;
export function normalizeHiddenAsset(raw: unknown): HiddenAsset | null;
export function normalizeHiddenAssets(raw: unknown): HiddenAsset[];
export function hiddenAssetsSchema(): Record<string, unknown>;
