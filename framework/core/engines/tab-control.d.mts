// Types for tab-control.mjs (tab-control@1: every tab row and titled section is reachable by path).
export interface TabTargetTab { value: string; label: string }
export interface TabTarget { kind: 'tab-group' | 'section'; id: string; label: string; screen?: string; tabs?: TabTargetTab[] }

export const TAB_CONTROL_FRAME: 'tab-control@1';
export const TAB_OPEN_ACTION: 'tab.open';
export const TAB_ACTION_PREFIX: 'tab.';
export const TAB_DEEP_LINK_PARAM: 'axf-open';
export const TAB_WAIT_MS: number;
export function splitTabPath(path: unknown): string[];
export function tabActionId(groupId: string, value: string): string;
export function matchTab(tabs: readonly TabTargetTab[] | undefined, want: unknown): string | null;
export function pickTabTarget<T extends TabTarget>(targets: readonly T[], part: unknown, opts?: { screen?: string }): { target: T; value: string | null } | null;
export function tabActionsOf(target: TabTarget, screenLabel?: string): { id: string; label: string; path: string }[];
export function normalizeTabTarget(raw: unknown): TabTarget | null;
