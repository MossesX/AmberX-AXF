// Types for card-rules.mjs (card@1 + home-layout@1; shared by the TS engines, the build engine and every app showing cards).
export type CardSourceKind = 'command' | 'console';
export type CardRefreshKind = 'live' | 'every' | 'manual';
export type CardSize = 's' | 'm' | 'l' | 'wide';
export type CardChart = 'line' | 'bar' | 'spark';
export type CardReduce = 'none' | 'count' | 'sum' | 'avg' | 'min' | 'max' | 'first' | 'last';
export interface CardSource { kind: CardSourceKind; plugin?: string; command?: string; id?: string }
export interface CardData {
  title: string;
  icon: string;
  source: CardSource;
  args: Record<string, unknown>;
  path: string;
  where: Record<string, unknown>;
  reduce: CardReduce;
  view: string;
  chart: CardChart;
  fields: Record<string, string | string[]>;
  refresh: { kind: CardRefreshKind; every: number; channels: string[] };
  size: CardSize;
  limit: number;
  unit: string;
}
export interface CardViewDef { id: string; label: string; icon: string; fields: string[]; about: string; host?: boolean }
export interface CardItem { title: string; subtitle: string; badge: string; at: string; tone: string }
export interface CardModel {
  ok: boolean; view: string; shape?: string; size?: CardSize; message?: string; empty?: boolean;
  value?: unknown; raw?: number | null; unit?: string; label?: string;
  state?: string; tone?: string;
  items?: CardItem[]; more?: number;
  rows?: Array<{ label: string; value: number; max: number; pct: number; text: string }> | string[][];
  columns?: string[];
  kind?: CardChart; points?: Array<{ x: string; y: number; h: number }>; min?: number; max?: number; last?: string;
  fields?: Record<string, unknown>;
}
export interface CardSourceEntry { plugin: string; name: string; command: string; title: string; description: string; params: string[]; generic: boolean }
export interface HomeLayout { $axf: 'home-layout@1'; cards: Array<CardData & { id: string }>; order: string[]; hidden: string[]; sizes: Record<string, CardSize>; dismissed: string[] }
export interface HomeStarter { id: string; data?: Partial<CardData>; card?: Partial<CardData> }
export interface HomeCard { id: string; card: CardData; starter: boolean; hidden: boolean; size: CardSize }
export type LayoutOp =
  | { op: 'add'; card: Partial<CardData>; id?: string; at?: number }
  | { op: 'update'; id: string; card: Partial<CardData> }
  | { op: 'remove' | 'hide' | 'show'; id: string }
  | { op: 'move'; id: string; to: number }
  | { op: 'size'; id: string; size: CardSize }
  | { op: 'showAll' | 'hideAll' | 'reset' }
  | { op: 'dismiss'; suggestion: string };
export const CARD_TYPE: 'card';
export const HOME_LAYOUT: 'home-layout@1';
export const CARD_DROP_MIME: string;
export const CARD_ENUMS: { source: readonly CardSourceKind[]; refresh: readonly CardRefreshKind[]; size: readonly CardSize[]; chart: readonly CardChart[]; reduce: readonly CardReduce[] };
export const CARD_LIMITS: { title: number; path: number; args: number; fields: number; every: [number, number]; items: [number, number]; channels: number };
export const CARD_DEFAULTS: CardData;
export const CARD_SUGGESTIONS: ReadonlyArray<{ id: string; title: string; icon: string; unit?: string; candidates: ReadonlyArray<Record<string, unknown>> }>;
export const LIVE_FALLBACK_MS: number;
export function registerCardView(v: Partial<CardViewDef> & { id: string }): CardViewDef;
export function cardViews(): CardViewDef[];
export function cardViewIds(): string[];
export function cardErrors(type: string, data: unknown): string[];
export function normalizeCard(raw: unknown): CardData;
export function cardSchemaProperties(): Record<string, unknown>;
export function pathGet(value: unknown, path: string): unknown;
export function applyWhere(value: unknown, where: Record<string, unknown>): unknown;
export function reduceValue(value: unknown, how: CardReduce): unknown;
export function shapeOf(v: unknown): 'empty' | 'number' | 'boolean' | 'text' | 'status' | 'series' | 'rows' | 'list' | 'record';
export function pickView(v: unknown): string;
export function fieldsOf(v: unknown): Array<{ id: string; numeric: boolean; time: boolean }>;
export function defaultFields(view: string, v: unknown): Record<string, string | string[]>;
export function statusTone(state: unknown): '' | 'success' | 'warning' | 'danger' | 'accent';
export function cardModel(card: Partial<CardData>, result: unknown): CardModel;
export function refreshMs(card: Partial<CardData>): number;
export function liveChannels(card: Partial<CardData>): string[];
export function liveHit(card: Partial<CardData>, channel: string): boolean;
export function cardSources(registry: unknown): CardSourceEntry[];
export function cardForSource(src: CardSourceEntry, extra?: Partial<CardData>): CardData;
export function suggestCards(registry: unknown, have?: Array<Partial<CardData>>): Array<{ id: string; card: CardData }>;
export function cardKey(c: Partial<CardData>): string;
export function cardFromDrop(payload: unknown): CardData | null;
export function normalizeLayout(raw: unknown, starters?: HomeStarter[]): HomeLayout;
export function homeCards(layout: unknown, starters?: HomeStarter[]): HomeCard[];
export function applyLayout(layout: unknown, op: LayoutOp, starters?: HomeStarter[]): HomeLayout;
