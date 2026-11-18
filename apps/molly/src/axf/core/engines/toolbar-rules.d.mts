/** Types for toolbar-rules.mjs (page-toolbar@1: a toolbar asset bound to a page or plugin, buttons bound to action refs). */

export type ToolbarScopeKind = 'app' | 'view' | 'plugin';
export type ToolbarActionKind = 'action' | 'command' | 'control' | 'handler';
export type ToolbarBadgeKind = 'counter' | 'state';
export type ToolbarCheckedKind = 'setting' | 'counter' | 'slot' | 'hidden' | 'state';
export type ToolbarOverflow = 'auto' | 'never' | 'always';
export type WhenOperator = 'truthy' | '=' | '!=' | '>' | '<' | '>=' | '<=';

export interface ToolbarScope { kind: ToolbarScopeKind; id: string }
export interface ToolbarActionRef { kind: ToolbarActionKind; id: string; plugin?: string; command?: string }
export interface ToolbarBadge { kind: ToolbarBadgeKind; ref: string }
export interface ToolbarChecked { kind: ToolbarCheckedKind; ref: string }
export interface WhenTerm { key: string; op: WhenOperator; value: string; negate: boolean }
export type When = string | string[];
export interface ToolbarOverflowOption { when?: ToolbarOverflow; keep?: number; label?: string }

export const PAGE_TOOLBAR_CONTRACT: 'page-toolbar@1';
export const TOOLBAR_SCOPE_KINDS: readonly ToolbarScopeKind[];
export const TOOLBAR_ACTION_KINDS: readonly ToolbarActionKind[];
export const TOOLBAR_BADGE_KINDS: readonly ToolbarBadgeKind[];
export const TOOLBAR_CHECKED_KINDS: readonly ToolbarCheckedKind[];
export const TOOLBAR_OVERFLOW: readonly ToolbarOverflow[];
export const WHEN_OPERATORS: readonly string[];
export const TOOLBAR_LIMITS: { whenTerms: number; keyLength: number; confirmLength: number; groups: number; items: number; priority: [number, number] };
export const TOOLBAR_DEFAULTS: { scope: 'app'; slot: 'main'; priority: number; overflow: Required<ToolbarOverflowOption>; confirmText: string };
export const SLOT_PATTERN: RegExp;

export function parseToolbarScope(scope: unknown): ToolbarScope | null;
export function formatToolbarScope(scope: ToolbarScope | null | undefined): string;
export function pageToolbarSettingsId(scope: ToolbarScope | string | null | undefined, slot?: string | null): string;
export function parseActionRef(action: unknown): ToolbarActionRef | null;
export function parseBadge(badge: unknown): ToolbarBadge | null;
export function parseToolbarChecked(binding: unknown): ToolbarChecked | null;
export function parseWhenTerm(term: unknown): WhenTerm | null;
export function parseWhen(when: unknown): WhenTerm[] | null;
export function stateAt(state: unknown, key: string): unknown;
export function whenHolds(terms: WhenTerm[] | null | undefined, state: unknown): boolean;
export function toolbarStateKeys(data: unknown): string[];
export function isPageToolbar(data: unknown): boolean;
export function toolbarErrors(type: string, data: unknown): string[];
export function toolbarItemSchema(): Record<string, unknown>;
export function toolbarSchemaProperties(): Record<string, unknown>;
