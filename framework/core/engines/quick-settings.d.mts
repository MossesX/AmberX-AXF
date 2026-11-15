export type QuickHandle = 'arrow' | 'chevron' | 'bar' | 'text';
export type QuickKind = 'settings' | 'plugin' | 'chrome' | 'banner';
export type QuickOverride = { kind: 'skin'; id: string } | { kind: 'asset'; type: string; id: string };
export type QuickOp =
  | { op: 'open'; scope: string }
  | { op: 'reset'; scope: string }
  | { op: 'collapse'; scope: string; value: 'on' | 'off' | 'toggle' }
  | { op: 'skin'; scope: string; skin: string | null }
  | { op: 'asset'; scope: string; type: string; id: string | null }
  | { op: 'handle'; handle: QuickHandle }
  | { op: 'state'; scope: string }
  | { error: string };

export const QUICK_HANDLES: QuickHandle[];
export const QUICK_HANDLE_LABEL: Record<QuickHandle, string>;
export const QUICK_HANDLE_KEY: string;
export const QUICK_DEFAULT_HANDLE: QuickHandle;
export const QUICK_ASSET_TYPES: Record<QuickKind, string[]>;
export const QUICK_ASSET_LABEL: Record<string, string>;
export const QUICK_ACTIONS: string[];
export function quickScopeId(raw: unknown): string;
export function isQuickScope(v: unknown): v is string;
export function quickKindOf(scope: string): QuickKind;
export function quickAssetTypes(scope: string): string[];
export function quickCollapsedKey(scope: string): string;
export function quickAssetsKey(scope: string): string;
export function quickSkinScopeKey(scope: string): string;
export function quickSkinUiId(scope: string): string;
export function quickHandleOf(v: unknown): QuickHandle;
export function normalizeQuickAssets(raw: unknown, scope: string): Record<string, string>;
export function setQuickAsset(raw: unknown, scope: string, type: string, id: string | null): Record<string, string>;
export function quickOverrides(o?: { skin?: string | null; assets?: Record<string, string> }): QuickOverride[];
export function quickNotice(list: QuickOverride[]): string;
export function parseQuickAction(id: string, args?: unknown[]): QuickOp;
