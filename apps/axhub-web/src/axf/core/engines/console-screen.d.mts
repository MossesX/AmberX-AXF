// Types for console-screen.mjs (console-screen@1: the numbered element map of the open console and the pointer actions on it).
export type ScreenElementKind = 'row' | 'expander' | 'menuitem' | 'menu' | 'tab' | 'button' | 'link' | 'input' | 'checkbox' | 'switch' | 'select' | 'option' | 'item';
export type ScreenAction = 'map' | 'click' | 'right_click' | 'double_click' | 'menu' | 'context_menu' | 'expand' | 'collapse' | 'scroll' | 'type' | 'key';
export interface ScreenBox { x: number; y: number; w: number; h: number }
export interface ScreenElementState { expanded?: boolean; selected?: boolean; disabled?: boolean; checked?: boolean; pressed?: boolean; danger?: boolean; value?: string }
/** What the console collects from its DOM, before numbering. */
export interface RawScreenElement { label: string; kind: ScreenElementKind | string; group?: string; state?: ScreenElementState; address?: string; box: ScreenBox; visible?: boolean }
export interface ScreenElement { n: number; label: string; kind: ScreenElementKind; group?: string; state?: ScreenElementState; address?: string; box: ScreenBox; visible: boolean }
export interface ScreenKey { key: string; ctrl: boolean; shift: boolean; alt: boolean; meta: boolean }
export interface ScreenCommand {
  $axf: 'console-screen@1'; action: ScreenAction; target?: string; item?: string; to?: string; path?: string[]; text?: string; keys?: ScreenKey[];
  dir?: 'up' | 'down' | 'page-up' | 'page-down' | 'top' | 'bottom'; submit?: boolean; confirm?: boolean; scale?: number;
}
export type ScreenResolved =
  | { point: { x: number; y: number }; element?: undefined; candidates?: undefined; ambiguous?: undefined }
  | { element: ScreenElement; point?: undefined; candidates?: undefined; ambiguous?: undefined }
  | { candidates: ScreenElement[]; ambiguous?: boolean; element?: undefined; point?: undefined };

export const CONSOLE_SCREEN_FRAME: 'console-screen@1';
export const CONSOLE_SCREEN_TOOLS: readonly string[];
export const CONSOLE_SCREEN_ACTIONS: readonly ScreenAction[];
export const CONSOLE_SCREEN_KINDS: readonly ScreenElementKind[];
export const CONSOLE_SCREEN_SCROLL_DIRS: readonly string[];
export const CONSOLE_SCREEN_MAP_MAX: number;
export const CONSOLE_SCREEN_LABEL_MAX: number;
export const CONSOLE_DESCRIBE_TIMEOUT_MS: number;
export const CONSOLE_DESCRIBE_CACHE_MS: number;
export function screenElementMap(raw: readonly RawScreenElement[], max?: number): ScreenElement[];
export function screenElementLine(e: ScreenElement): string;
export function screenMapText(elements: readonly ScreenElement[], limit?: number): string;
export function screenResolveTarget(elements: readonly ScreenElement[], target: unknown, opts?: { prefer?: readonly string[] }): ScreenResolved;
export function screenTargetGuard(element: { label?: string; address?: string; state?: ScreenElementState } | null | undefined): 'person' | 'destructive' | null;
export function screenMenuPath(path: unknown): string[];
export function screenKeys(keys: unknown): { keys: ScreenKey[]; error?: undefined } | { error: string; keys?: undefined };
export function normalizeScreenCommand(raw: unknown): { command: ScreenCommand; errors?: undefined } | { errors: string[]; command?: undefined };
export function screenActionWrites(action: string): boolean;
