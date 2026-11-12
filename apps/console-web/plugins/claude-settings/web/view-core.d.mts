export const VIEW_FRAME: string;
export type Mode = 'classic' | 'tabbed';
export type Position = 'top' | 'bottom' | 'left' | 'right';
export type Labels = 'both' | 'words' | 'icons';
export interface ViewPrefs { mode: Mode; position: Position; labels: Labels; tab: string }
export const MODES: Mode[];
export const POSITIONS: Position[];
export const LABELS: Labels[];
export const DEFAULT_VIEW: ViewPrefs;
export const TAB_GROUP_ID: string;
export const LABEL_DISPLAY: Record<Labels, string>;
export function displayLabel(display: string): Labels;
export function deviceOk(d: unknown): boolean;
export function normView(v: unknown): ViewPrefs;
export function viewProblem(patch: Record<string, unknown>): string;
export interface TabGroupIn { id: string; label: string; icon: string; description: string }
export interface TabIn { id: string; label: string; icon: string; description?: string; groups?: string[]; always?: boolean }
export interface TabOut<G> { id: string; label: string; icon: string; description: string; always: boolean; groups: G[]; count: number }
export function tabsFor<G extends TabGroupIn>(groups: G[], tabs: TabIn[] | undefined, settings: { group: string }[]): TabOut<G>[];
export function matches(s: { label: string; key: string; description: string }, q: string): boolean;
