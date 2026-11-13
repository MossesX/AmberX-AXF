// Types for console-control-rules.mjs (console-control@1; shared by the TS engine, the build engine and the console server).
export type ConsoleControlKind = 'view' | 'tab' | 'subtab' | 'setting' | 'button' | 'function' | 'plugin' | 'grid' | 'row' | 'step' | 'panel' | 'scroll';
export type ConsoleControlVerb = 'open' | 'state' | 'press' | 'set' | 'scroll' | 'focus' | 'search' | 'list' | 'plugin.enable' | 'plugin.disable';
export type ConsoleControlEffect = 'read' | 'navigate' | 'write';
export type ConsoleControlCode = 'invalid' | 'not_found' | 'ambiguous' | 'denied' | 'validation' | 'unavailable' | 'confirmation_required' | 'not_implemented' | 'unexpected';
export type ConsoleControlScrollDir = 'up' | 'down' | 'page-up' | 'page-down' | 'top' | 'bottom' | 'to';
export interface ConsoleControlVerbSpec { effect: ConsoleControlEffect; requires: string; takes: string[]; doc: string }

export const CONSOLE_CONTROL_FRAME: 'console-control@1';
export const CONSOLE_CONTROL_TARGETS_FRAME: 'console-control-targets@1';
export const CONSOLE_CONTROL_KINDS: readonly ConsoleControlKind[];
export const CONSOLE_CONTROL_PARENTS: Record<ConsoleControlKind, readonly (ConsoleControlKind | null)[]>;
export const CONSOLE_CONTROL_VALUED_KINDS: readonly ConsoleControlKind[];
export const CONSOLE_CONTROL_VERBS: Record<ConsoleControlVerb, ConsoleControlVerbSpec>;
export const CONSOLE_CONTROL_VERB_IDS: readonly ConsoleControlVerb[];
export const CONSOLE_CONTROL_ADDRESS_REQUIRED: readonly ConsoleControlVerb[];
export const CONSOLE_CONTROL_SCROLL_DIRS: readonly ConsoleControlScrollDir[];
export const CONSOLE_CONTROL_SCROLL_DEFAULT: number;
export const CONSOLE_CONTROL_HIGHLIGHT_MS: number;
export const CONSOLE_CONTROL_SEARCH_LIMIT: number;
export const CONSOLE_CONTROL_SEARCH_MAX: number;
export const CONSOLE_CONTROL_NEAREST_MAX: number;
export const CONSOLE_CONTROL_ID_MAX: number;
export const CONSOLE_CONTROL_ADDRESS_MAX_DEPTH: number;
export const CONSOLE_CONTROL_WIRE: {
  INVALID: 'invalid'; NOT_FOUND: 'not_found'; AMBIGUOUS: 'ambiguous'; DENIED: 'denied'; VALIDATION: 'validation'; UNAVAILABLE: 'unavailable';
  CONFIRMATION_REQUIRED: 'confirmation_required'; NOT_IMPLEMENTED: 'not_implemented'; UNEXPECTED: 'unexpected';
};
export const CONSOLE_CONTROL_CODES: readonly ConsoleControlCode[];
export const CONSOLE_CONTROL_DEFAULT_CAN: Record<ConsoleControlKind, readonly ConsoleControlVerb[]>;
export const CONSOLE_CONTROL_SEGMENT_PATTERN: string;
export const CONSOLE_CONTROL_ADDRESS_PATTERN: string;
export function isConsoleControlKind(k: unknown): k is ConsoleControlKind;
export function isConsoleControlVerb(v: unknown): v is ConsoleControlVerb;
export function consoleControlEffect(verb: string): ConsoleControlEffect | null;
export function consoleControlPermission(verb: string): string | null;
export function jsonSchemas(): Record<string, Record<string, unknown>>;
export function consoleControlRegistry(): Record<string, unknown>;
