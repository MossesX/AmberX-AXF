// Types for console-commands.mjs (the console domain of control@1: open screens, dialogs, settings tabs, run actions).
import type { ControlCommand, ControlWireCode } from './control-rules.mjs';

export type ConsoleItemKind = 'screen' | 'dialog' | 'settings' | 'action' | 'field';
export type ConsoleActionEffect = 'navigate' | 'read' | 'write' | 'destructive';
export interface ConsoleItem { kind: ConsoleItemKind; id: string; label: string; detail?: string; icon?: string; keywords?: string[]; requires?: string; effect?: ConsoleActionEffect; params?: boolean; parent?: string; module?: string; /** field: its setting kind, current value as text (not for secrets), choices, range */ type?: string; value?: string; options?: string[]; min?: number; max?: number; secret?: boolean }
export interface ConsoleHere { screen?: string; screenLabel?: string; dialog?: string; settings?: string }
export interface ConsoleCatalog { $axf: 'console-catalog@1'; app: string; items: ConsoleItem[]; here: ConsoleHere }
export interface ConsoleClient { id: string; app?: string; title?: string; device?: string; user?: string; lastUsed?: number; lastSeen?: number; here?: ConsoleHere; catalog?: ConsoleCatalog }
export interface ConsoleMessage { $axf: 'console-command@1'; id: string; op: 'open' | 'run' | 'back' | 'home' | 'close' | 'refresh' | 'control'; /** op control: a console-control@1 command (spec/CONSOLE-CONTROL.md) */ command?: Record<string, unknown>; kind?: ConsoleItemKind; target?: string; label?: string; spec?: string; anchor?: string; arg?: string; /** a tab or an item to bring forward on the opened screen (runs `<screen>.focus:<focus>`) */ focus?: string; hard?: boolean; by: string; at: string; /** set by the console server on a queued command: `queued` (held until a console connected) or `woke` (AmberX opened the console for it) */ delivery?: 'queued' | 'woke' }
export type ConsoleRun =
  | { ok: true; data: Record<string, unknown>; deliver?: { to: string[]; message: ConsoleMessage } }
  | { ok: false; code: ControlWireCode; message: string; [k: string]: unknown };

export const CONSOLE_CATALOG_FRAME: 'console-catalog@1';
export const CONSOLE_COMMAND_FRAME: 'console-command@1';
export const CONSOLE_KINDS: Record<string, ConsoleItemKind>;
export const CONSOLE_ITEM_KINDS: readonly ConsoleItemKind[];
export const CONSOLE_FIELD_TYPES: readonly string[];
export const CONSOLE_DELIVERY: readonly string[];
export const CONSOLE_CATALOG_MAX: number;
export const CONSOLE_LIST_DEFAULT: number;
export const CONSOLE_CLIENT_STALE_MS: number;
export const CONSOLE_HEARTBEAT_MS: number;
export const CONSOLE_LATE_MS: number;
export const CONSOLE_TOOLS: readonly string[];
export function foldWords(s: unknown): string;
export function normalizeConsoleItem(raw: unknown): ConsoleItem | null;
export function normalizeConsoleCatalog(raw: unknown): ConsoleCatalog;
export function normalizeHere(raw: unknown): ConsoleHere;
export function consoleCatalogFrom(
  entries: readonly { kind: string; label: string; detail?: string; icon?: string; keywords?: string[]; requires?: string; parent?: string; focus: unknown; field?: Record<string, unknown> }[],
  actions?: readonly { id: string; meta: { label?: string; requires?: string; stub?: boolean; params?: boolean; module?: string; effect?: string } }[],
  extra?: { app?: string; here?: ConsoleHere },
): ConsoleCatalog;
export function consoleSearch(items: readonly ConsoleItem[], kind: ConsoleItemKind | null, q?: string, limit?: number): ConsoleItem[];
export function consoleResolve(items: readonly ConsoleItem[], kind: ConsoleItemKind, path: string): { item?: ConsoleItem; args?: string[]; focus?: string; candidates?: ConsoleItem[]; ambiguous?: boolean };
export function consoleResolveField(items: readonly ConsoleItem[], path: string): { item?: ConsoleItem };
export function consoleFieldValue(field: { type?: string; kind?: string; label?: string; key?: string; options?: readonly (string | { value: string })[]; min?: number; max?: number }, raw: unknown, current?: unknown): { value: unknown; error?: undefined } | { error: string; value?: undefined };
export function consoleActionEffect(item: Partial<ConsoleItem>): Exclude<ConsoleActionEffect, 'read'>;
export function consoleActionNeeds(item: Partial<ConsoleItem>): { effect: Exclude<ConsoleActionEffect, 'read'>; needs: string[] };
export function consolePickClients<C extends ConsoleClient>(clients: readonly C[], to?: string, now?: number): C[];
export function consoleClientSummary(c: ConsoleClient): Record<string, unknown>;
export function consoleMessage(fields: Partial<ConsoleMessage> & { op: ConsoleMessage['op'] }, opts?: { id?: string; by?: string; now?: number }): ConsoleMessage;
export function consoleMessageErrors(m: unknown): string[];
export function consoleMessageLate(m: unknown, now?: number): boolean;
export function consoleSplitFocus(screens: readonly ConsoleItem[], path: string): { item: ConsoleItem; focus: string } | null;
export function runConsoleCommand(c: ControlCommand, ctx?: { clients?: readonly ConsoleClient[]; grants?: readonly string[]; salt?: string; now?: number; id?: string; by?: string }): ConsoleRun;
export function consoleActionConfirm(spec: string, salt: string, now?: number): string;
