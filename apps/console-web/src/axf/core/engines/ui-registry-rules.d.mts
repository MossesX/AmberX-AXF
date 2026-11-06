/** ui-registry@1 typings (the rules live in ui-registry-rules.mjs; this file only types them). */

export type UiKind = 'screen' | 'dialog' | 'popup' | 'settings' | 'settings-group' | 'setting' | 'menu' | 'menu-item' | 'nav-item' | 'toolbar' | 'button' | 'link' | 'tab-group' | 'tab' | 'banner' | 'widget' | 'action' | 'window' | 'card' | 'control' | (string & {});
export type UiOpenVia = 'view' | 'dialog' | 'settings' | 'action' | 'url' | 'element' | 'menu';
export type UiSource = 'declared' | 'authored' | 'scanned' | 'live';
export type UiEffect = 'navigate' | 'read' | 'write' | 'destructive';

export interface UiOpen {
  via: UiOpenVia;
  view?: string;
  dialog?: string;
  arg?: string;
  tab?: string;
  anchor?: string;
  action?: string;
  url?: string;
  selector?: string;
  click?: boolean;
  menu?: string;
}

export interface UiItem {
  /** `<kind>:<key>`, e.g. `screen:plan-studio`, `button:plan-studio/new-plan` */
  id: string;
  kind: UiKind;
  label: string;
  open: UiOpen;
  /** the app (project manifest name) */
  app?: string;
  /** app | framework | plugin:<folder> | library:<id> */
  owner?: string;
  parent?: string;
  aliases?: string[];
  keywords?: string[];
  detail?: string;
  icon?: string;
  requires?: string;
  help?: string;
  effect?: UiEffect;
  source?: UiSource;
  hidden?: boolean;
}

export interface UiItemHit extends UiItem { score: number }

export interface UiRegistryData {
  $axf?: 'ui-registry@1';
  app: string;
  items: UiItem[];
  source?: UiSource | 'mixed';
  generatedFrom?: string[];
  generatedAt?: string;
}

export interface UiShortcut {
  id: string;
  phrase: string;
  item: string;
  aliases?: string[];
  say?: string;
  arg?: string;
  enabled?: boolean;
}

export type UiResolve =
  | { item: UiItem; via: 'id' | 'label' | 'alias' | 'fuzzy' }
  | { candidates: UiItem[]; ambiguous: true }
  | { candidates: UiItem[] };

export type UiSayResult =
  | { item: UiItem; via: 'shortcut' | 'id' | 'label' | 'alias' | 'fuzzy'; shortcut?: UiShortcut; say: string }
  | { candidates: UiItem[]; ambiguous?: true; shortcut?: UiShortcut; say: string };

export interface UiOpenPlan {
  via: UiOpenVia;
  url?: string;
  view?: string;
  dialog?: string;
  arg?: string;
  tab?: string;
  anchor?: string;
  action?: string;
  menu?: string;
  item?: string;
  selector?: string;
  click?: boolean;
}

export interface UiControlCommand { $axf: 'control@1'; op: 'act'; target: string; path: string; action: string; input?: Record<string, unknown> }

export interface UiCoverage { total: number; byKind: Record<string, number>; bySource: Record<string, number>; missing: string[]; unknown: string[] }

export interface UiVoiceCommand {
  id: string; title: string; effect: 'navigate'; confirm: 'never'; phrases: string[];
  slots?: Record<string, { type: string; required?: boolean; say?: string }>;
  run: Record<string, string>; say: string; help: string; source: 'generated' | 'authored';
}

export const UI_REGISTRY_TYPE: 'ui-registry';
export const UI_REGISTRY_FRAME: 'ui-registry@1';
export const UI_ATTR: 'data-axf-ui';
export const UI_OPEN_ACTION: 'ui.open';
export const UI_KINDS: readonly string[];
export const UI_KIND_LABELS: Record<string, string>;
export const UI_KIND_WORDS: Record<string, string>;
export const UI_KIND_RANK: Record<string, number>;
export const UI_OPEN_VIAS: readonly UiOpenVia[];
export const UI_SOURCES: readonly UiSource[];
export const UI_EFFECTS: readonly UiEffect[];
export const UI_OWNERS: readonly string[];
export const UI_LIMITS: { items: number; aliases: number; alias: number; label: number; id: number; detail: number; keywords: number; shortcuts: number; phrase: number };
export const UI_OPEN_VERBS: readonly string[];
export const UI_VOICE_PHRASES: readonly string[];
export const UI_VOICE_COMMAND_ID: 'ui.open';

export function uiId(kind: string, key: string): string;
export function parseUiId(id: unknown): { kind: string; key: string } | null;
export function uiElementSelector(item: UiItem): string;
export function normalizeUiOpen(raw: unknown): UiOpen | null;
export function uiEffect(item: UiItem | null | undefined): UiEffect;
export function normalizeUiItem(raw: unknown, defaults?: { app?: string; owner?: string; source?: string }): UiItem | null;
export function normalizeUiRegistry(raw: unknown): UiRegistryData & { $axf: 'ui-registry@1' };
export function uiRegistryErrors(type: string, raw: unknown): string[];
export function uiRegistrySchemaProperties(): Record<string, unknown>;
export function mergeUiItems(...lists: unknown[][]): UiItem[];
export function uiItemsFromConsoleCatalog(catalog: unknown, defaults?: { app?: string }): UiItem[];
export function ownerFromModule(module: unknown): string;
export function uiItemsFromSearchEntries(entries: unknown[], actions?: unknown[], defaults?: { app?: string }, ownerOf?: (kind: string, id: string) => string | undefined): UiItem[];
export function uiItemsFromMenuAsset(asset: unknown, defaults?: { app?: string; owner?: string; source?: string }): UiItem[];
export function uiItemsFromPluginManifest(manifest: unknown, folder: string, defaults?: { app?: string }): UiItem[];
export function nearWord(a: string, b: string, max?: number): boolean;
export function uiQueryWords(q: unknown): { words: string[]; kind: string; phrase: string; whole: string };
export function scoreUiItem(item: UiItem, words: string[], phrase: string): number;
export function searchUiItems(items: UiItem[], q?: string, opts?: { kind?: string; kinds?: string[]; app?: string; owner?: string; limit?: number; hidden?: boolean }): UiItemHit[];
export function resolveUiItem(items: UiItem[], q: unknown, opts?: { app?: string; kinds?: string[]; hidden?: boolean }): UiResolve;
export function uiOpenCommand(item: UiItem, opts?: { to?: string; arg?: string }): UiControlCommand;
export function uiOpenPlan(item: UiItem): UiOpenPlan;
export function normalizeUiShortcut(raw: unknown): UiShortcut | null;
export function uiShortcutErrors(raw: unknown): string[];
export function matchUiShortcut(shortcuts: UiShortcut[], heard: unknown): UiShortcut | null;
export function uiSay(items: UiItem[], shortcuts: UiShortcut[], heard: unknown, opts?: { app?: string; kinds?: string[] }): UiSayResult;
export function uiVoiceCommands(shortcuts?: unknown[], run?: { api?: string; mcp?: string; cli?: string }): UiVoiceCommand[];
export function uiRegistryCoverage(registry: UiItem[], found?: { id?: string }[]): UiCoverage;
