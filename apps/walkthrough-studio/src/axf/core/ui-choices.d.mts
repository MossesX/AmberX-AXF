export const CHOICES_TAG: 'ui-choices@1';
export const MIN_OPTIONS: number;
export const MULTI_VIEW_TYPES: string[];
export interface ChoiceOption { id: string; label: string; notes?: string; asset?: string }
export interface Choices { $axf: 'ui-choices@1'; set: string; assetType: string; owner: string; multi: boolean; options: ChoiceOption[]; chosen: string[]; decidedAt?: string; decidedBy?: string }
export function slug(v: unknown): string;
export function multiViewType(type: string): boolean;
export function minOptions(v: unknown): number;
export function normChoices(raw: unknown, opts?: { set?: string }): Choices;
export function choicesProblems(c: Choices, min?: number): string[];
export function submissionGap(fields: unknown, min?: number): string;
export function choose(c: Choices, ids: unknown, opts?: { by?: string; at?: string }): { choices?: Choices; error?: string };
export function defaultOption(c: Choices | null | undefined): string;
export function optionOfShot(src: unknown): string;
export function optionShots<T extends { src: string }>(shots: T[] | undefined, id: string): T[];
export function movePick(order: string[], id: string, by: number): string[];
export function optionAssetId(set: string, optionId: string): string;
export function optionAsset(c: Choices, option: ChoiceOption, data?: unknown, opts?: { name?: string; author?: string }): Record<string, unknown>;
export function optionAssetPath(c: Choices, option: ChoiceOption): string;
