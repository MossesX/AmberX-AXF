export interface CoverEntry { service: string; tool?: string; scope?: string }
export type Coverage = 'all' | 'none' | CoverEntry[];
export type CoverMode = 'all' | 'pick';
export interface Pick { services: Record<string, true | string[]>; more: string }
export interface PickerService { namespace: string; displayName: string; tools: string[] }
export interface ServiceLike { namespace?: string; service?: string; displayName?: string; tools?: unknown }
export interface CoverChip { label: string; tone?: 'success' | 'warning' | 'danger' }
export interface RunLine { id: string; tool: string; skipped: string; at: string; failed: boolean }
export const COVER_MAX: number;
export const TOOLS_SHOWN: number;
export function emptyPick(): Pick;
export function entryText(e: CoverEntry): string;
export function entryLabel(e: CoverEntry): string;
export function parseEntry(item: string): CoverEntry | null;
export function parseEntries(text: string): { entries: CoverEntry[]; bad: string[] };
export function toolNames(service: ServiceLike | null | undefined): string[];
export function pickerServices(...lists: (readonly ServiceLike[] | null | undefined)[]): PickerService[];
export function filterTools(tools: string[], q?: string, limit?: number): { shown: string[]; more: number };
export function pickFromCovers(coverage: Coverage | null | undefined, services?: PickerService[]): { mode: CoverMode; pick: Pick };
export function toggleService(pick: Pick, namespace: string, on: boolean): Pick;
export function toggleTool(pick: Pick, namespace: string, tool: string, on: boolean, allTools?: string[]): Pick;
export function serviceState(pick: Pick, namespace: string): 'all' | 'some' | 'none';
export function toolPicked(pick: Pick, namespace: string, tool: string): boolean;
export function coversFromPick(mode: CoverMode, pick: Pick): { covers: 'all' | CoverEntry[] | null; error: string };
export function coverageChips(coverage: Coverage, includeIrreversible?: boolean, limit?: number): CoverChip[];
export function coverageSummary(covers: 'all' | CoverEntry[] | null, includeIrreversible?: boolean): string;
export function lengthLabel(minutes: number): string;
export function minutesError(text: string, limits: { min: number; max: number }): string;
export function grantBody(o: { covers: 'all' | CoverEntry[]; minutes: number | string; reason: string; includeIrreversible?: boolean; quietNotice?: boolean }): Record<string, unknown>;
export function updateBody(o: { covers: 'all' | CoverEntry[]; includeIrreversible?: boolean; quietNotice?: boolean }): Record<string, unknown>;
export function runLine(e: Record<string, unknown>): RunLine;
export function runLines(entries: unknown, limit?: number): RunLine[];
export function runsHeading(uses: number, lastAgo?: string): string;
