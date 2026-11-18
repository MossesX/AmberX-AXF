/** Types for hub-console.mjs (hub-console@1: every axHub web page as a console screen). */
export const FRAME: 'hub-console@1';
export const FIXTURE_FRAME: 'hub-console-fixture@1';
export const CODES: readonly string[];
export const WHO: readonly HubWho[];
export const EFFECTS: readonly HubEffect[];
export const CHANNELS: readonly HubChannel[];
export const GATES: readonly HubGate[];
export const SETTING_KINDS: readonly string[];
export const ID_RE: RegExp;
export const TOOL_RE: RegExp;
export const TAB_ROW_RE: RegExp;
export const SHAPE_RE: RegExp;
export const SETTING_KEY_RE: RegExp;
export const REST_ROOT: string;
export const SETTINGS_ROOT: string;
export const HUB_MISSING: 'hub_missing';

export type HubWho = 'person' | 'confirm' | 'command';
export type HubEffect = 'read' | 'write' | 'destructive' | 'navigate';
export type HubChannel = 'bearer' | 'session' | 'console';
export type HubGate = 'none' | 'user' | 'admin';

export interface HubRead {
  channel: HubChannel; hub: string; tool: string; shape: string; fields: string[];
  params?: Record<string, string | string[]>; poll?: { idleMs: number; heldMs?: number };
}
export interface HubMissing { why: string; proposed: string; cli?: string }
export interface HubAction {
  id: string; label: string; who: HubWho; effect: HubEffect; row?: boolean; method?: 'POST' | 'DELETE'; hub: string | null;
  channel?: HubChannel; tool?: string; input?: string[]; opens?: string; missing?: HubMissing;
}
export interface HubSetting {
  key: string; kind: 'toggle' | 'number' | 'text' | 'choice' | 'json'; label: string; default: unknown;
  options?: string[]; min?: number; max?: number; who?: HubWho; personOnly?: boolean; ownedBy?: string; writes?: string;
}
export interface HubRows { grid: string; idField: string; path: string; idPattern?: string; read?: HubRead }
export interface HubScreen {
  id: string; title: string; icon: string; order: number; aliases?: string[]; gate: HubGate; replaces: string[];
  state: HubRead; rows?: HubRows; actions: HubAction[]; settings: HubSetting[];
  health?: { id: string; label: string; what: string };
}
export interface HubConsoleTable {
  $axf: 'hub-console@1'; note?: string; view: string; tabRow: string; home?: string; plugin: string; settingsSubtab: string;
  hub: { session: string; feed: string; oldHub: string };
  channels: Record<HubChannel, string>; who: Record<HubWho, string>;
  reaches: { rest: string; mcp: string; cli: string; voice: string; deepLink: string };
  screens: HubScreen[]; deferred: { id: string; title: string; why: string }[];
}
export interface HubConsoleError { code: string; path: string; message: string }
export interface HubReaches { rest: string; tool: string | null; cli: string | null; voice: string | null; deepLink: string | null; who: HubWho | null; missing?: string; opens?: string }
export interface HubRoute { screen: string | null; params?: Record<string, string>; deferred?: string }
export interface HubCatalogAction { screen: string; action: string; tool: string | null; who: HubWho; effect: HubEffect; confirm: boolean; row: boolean; label: string; missing?: string; opens?: string }
export interface HubTool { tool: string; screen: string; kind: 'read' | 'row' | 'action'; action?: string; who?: HubWho; effect: HubEffect; confirm: boolean }
export interface HubCounts { screens: number; actions: number; person: number; commands: number; missing: number; tools: number; settings: number; deferred: number }

export function validateHubConsole(table: unknown): { ok: boolean; errors: HubConsoleError[] };
export function assertHubConsole<T>(table: T): T;
export function screensOf(table: HubConsoleTable | unknown): HubScreen[];
export function screenOf(table: HubConsoleTable | unknown, id: string): HubScreen | null;
export function screenWords(table: HubConsoleTable | unknown): string[];
export function actionOf(table: HubConsoleTable | unknown, screen: string, id: string): HubAction | null;
export function homeScreen(table: HubConsoleTable | unknown): HubScreen | null;
export function rowIdOk(screen: HubScreen | null | undefined, row: unknown): boolean;
export function screenAddress(table: HubConsoleTable, screen: string): string | null;
export function rowAddress(table: HubConsoleTable, screen: string, row: string): string | null;
export function actionAddress(table: HubConsoleTable, screen: string, action: string, row?: string | null): string | null;
export function settingAddress(table: HubConsoleTable, key: string): string | null;
export function toolOf(table: HubConsoleTable, screen: string, action: string): string | null;
export function reachesOf(table: HubConsoleTable, screen: string, opts?: { row?: string | null; action?: string | null }): HubReaches | null;
export function routeToScreen(table: HubConsoleTable, hash: string): HubRoute | null;
export function catalogActions(table: HubConsoleTable): HubCatalogAction[];
export function personActions(table: HubConsoleTable): string[];
export function hubMissing(table: HubConsoleTable): { screen: string; action: string; proposed: string; why: string; cli?: string }[];
export function settingsOf(table: HubConsoleTable): (HubSetting & { screen: string; address: string | null })[];
export function toolsOf(table: HubConsoleTable): HubTool[];
export function countsOf(table: HubConsoleTable): HubCounts;
