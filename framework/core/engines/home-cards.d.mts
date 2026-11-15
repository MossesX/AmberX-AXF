// Types for home-cards.mjs (home-cards@1: home-picks@1 in, resolved home-cards@1 out; scores from plugin-activity.mjs).
export type HomeCardMode = 'pinned' | 'auto';
export type ActivityKind = 'open' | 'action' | 'job' | 'alert';
export type DropReason = 'disabled' | 'uninstalled' | 'duplicate' | 'invalid' | 'overflow';

/** Brett's selection: pinned plugin ids in his order and the slot count. An empty list means Home is all auto. */
export interface HomePicks { $axf: 'home-picks@1'; slots: number; plugins: string[]; at: string; updatedBy?: string }
export interface HomeCardSlot { plugin: string; mode: HomeCardMode; rank: number; score: number }
export interface HomeDropped { plugin: string; why: DropReason }
/** The resolved Home: cards in order, what was dropped and why, how many slots stayed empty (fewer plugins than slots). */
export interface HomeCardsResolved { $axf: 'home-cards@1'; at: string; slots: number; cards: HomeCardSlot[]; dropped: HomeDropped[]; short: number }

/** Inventory input: ids (all enabled), records, or { id: enabled }. Absent = not installed. */
export type InventoryInput = string[] | Array<{ id?: string; folder?: string; plugin?: string; enabled?: boolean }> | Record<string, boolean | string>;
/** Score input: plugin-activity@1 records, { plugin, score } pairs, or { id: score }. */
export type ActivityInput = Array<{ plugin?: string; id?: string; score: number }> | Record<string, number>;
export type PicksInput = HomePicks | Partial<HomePicks> | string[] | Array<{ id?: string; plugin?: string; folder?: string }> | null | undefined;

export interface ResolveInput { picks?: PicksInput; plugins?: InventoryInput; activity?: ActivityInput; slots?: number; at?: string }

export interface HomeCardsRegistry {
  schema: 'home-cards@1'; version: 1; picks: 'home-picks@1'; cards: 'home-cards@1'; activity: 'plugin-activity@1'; event: 'plugin-activity-event@1';
  modes: HomeCardMode[]; eventKinds: ActivityKind[]; dropReasons: DropReason[]; idPattern: string;
  slots: { default: number; min: number; max: number }; picksMax: number; eventsMax: number; countMax: number;
  window: { days: number; halfLifeDays: number; minDays: number; maxDays: number }; weights: Record<ActivityKind, number>; scoreDecimals: number;
}

export const SCHEMA: 'home-cards@1';
export const PICKS_FRAME: 'home-picks@1';
export const CARDS_FRAME: 'home-cards@1';
export const ACTIVITY_FRAME: 'plugin-activity@1';
export const EVENT_FRAME: 'plugin-activity-event@1';
export const VERSION: 1;
export const MODES: readonly HomeCardMode[];
export const EVENT_KINDS: readonly ActivityKind[];
export const DROP_REASONS: readonly DropReason[];
export const ID_PATTERN: string;
export const SLOTS: { readonly default: number; readonly min: number; readonly max: number };
export const PICKS_MAX: number;
export const EVENTS_MAX: number;
export const COUNT_MAX: number;
export const WINDOW: { readonly days: number; readonly halfLifeDays: number; readonly minDays: number; readonly maxDays: number };
export const WEIGHTS: Readonly<Record<ActivityKind, number>>;
export const SCORE_DECIMALS: number;
export const REGISTRY: Readonly<HomeCardsRegistry>;

export function isPluginId(v: unknown): v is string;
export function clampSlots(n: unknown): number;
export function pickList(picks: PicksInput): string[];
export function normPicks(raw: PicksInput, at?: string): HomePicks;
export function picksErrors(doc: unknown, path?: string): string[];
export function inventoryMap(plugins: InventoryInput | undefined): Map<string, boolean>;
export function scoreMap(activity: ActivityInput | undefined): Map<string, number>;
export function byRank(scores: Map<string, number>): (a: string, b: string) => number;
export function resolveHomeCards(input?: ResolveInput): HomeCardsResolved;
export function cardIds(cards: HomeCardsResolved | unknown): string[];
export function cardsErrors(doc: unknown, path?: string): string[];
export function jsonSchemas(): Record<string, Record<string, unknown>>;
