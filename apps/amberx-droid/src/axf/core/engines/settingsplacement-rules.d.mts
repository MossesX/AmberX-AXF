export type SettingsPlacement = 'dialog' | 'panel' | 'sheet' | 'inside' | 'page' | 'window';
export type Side = 'left' | 'right';
export type InsideMode = 'pane' | 'dropdown' | 'tab' | 'split' | 'inline';
export type PlacementChoice = 'dialog' | 'panel-left' | 'panel-right' | 'sheet' | 'inside' | 'page' | 'window';

export const SETTINGS_PLACEMENTS: readonly SettingsPlacement[];
export const SIDES: readonly Side[];
export const INSIDE_MODES: readonly InsideMode[];
export const PLACEMENT_CHOICES: readonly PlacementChoice[];
export const PLACEMENT_ALIASES: Readonly<Record<string, SettingsPlacement>>;
export const PLACEMENT_LABELS: Readonly<Record<SettingsPlacement, string>>;
export const CHOICE_LABELS: Readonly<Record<PlacementChoice, string>>;
export const PLACEMENT_WORDS: Readonly<Record<SettingsPlacement, readonly string[]>>;
export function placementTokens(x: unknown): string;
export function placementOf(x: unknown): SettingsPlacement | null;
export function isDefaultWord(x: unknown): boolean;
export function parsePlacementChoice(text: unknown): { choice: PlacementChoice; mode?: InsideMode } | 'default' | null;
export function choiceParts(choice: unknown): { placement: SettingsPlacement; side?: Side } | null;
