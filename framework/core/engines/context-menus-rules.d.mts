// Types for context-menus-rules.mjs (context-menu@1: every context menu as one true source on axHub).
export type LevelId = 'beginner' | 'amateur' | 'pro' | 'advanced';
export type Weight = 'core' | 'common' | 'rare';
export type OwnerKind = 'framework' | 'console' | 'plugin' | 'app';
export type MenuSource = 'claude' | 'hand' | 'imported' | 'scan';

export interface Level { id: LevelId; label: string; order: number; perTarget: number; depth: number; zones: 'core' | 'common' | 'all'; shortcuts: boolean; developer: boolean; brief: string }
export interface CtxItem { id: string; label?: string; icon?: string; action?: string; shortcut?: string; checked?: string; note?: string; separator?: boolean; rare?: boolean; items?: CtxItem[] }
export interface Zone { $axf: 'ctx-zone@1'; id: string; label: string; owner: { kind: OwnerKind; id: string; app: string }; pages: string[]; elements: string[]; files: string[]; weight: Weight; implicit: boolean; note: string }
export interface MenuAsset { $axf: 'asset@1'; type: 'context-menu'; id: string; name: string; version: string; description: string; author: string; tags: string[]; data: { variant: 'compact' | 'roomy' | 'glass'; showIcons: boolean; showShortcuts: boolean; targets: Record<string, CtxItem[]>; contributions?: false } }
export interface MenuDoc { $axf: 'context-menu@1'; id: string; name: string; level: LevelId; app: string; page: string; source: MenuSource; model: string; by: string; active: boolean; createdAt: string; updatedAt: string; asset: MenuAsset }
export interface History { $axf: 'ctx-history@1'; id: string; versions: { v: number; at: string; by: string; doc: MenuDoc }[] }
export interface ActionRef { id: string; label?: string; module?: string }
export interface Prompt { system: string; messages: { role: 'user'; content: string }[]; level: LevelId; zones: string[]; actions: string[] }
export interface Summary { targets: number; items: number; depth: number; zones: string[] }
export interface TargetDiff { target: string; status: 'new' | 'gone' | 'changed' | 'same'; added: string[]; removed: string[] }
export type Phrase = { op: 'generate'; level: LevelId; app: string; preview: boolean } | { op: 'apply' } | { op: 'list'; level?: LevelId; app?: string } | { op: 'use'; id: string } | { op: 'restore' };

export const FORMAT: 'context-menu@1';
export const ZONE_FORMAT: 'ctx-zone@1';
export const LEVEL_FORMAT: 'ctx-level@1';
export const HISTORY_FORMAT: 'ctx-history@1';
export const DRAFT_FORMAT: 'ctx-draft@1';
export const CAPABILITY: 'context-menus@1';
export const ASSET_PREFIX: 'ctx-';
export const HISTORY_MAX: number;
export const DEFAULT_APP: string;
export const VARIANTS: readonly string[];
export const SOURCES: readonly string[];
export const WEIGHTS: readonly Weight[];
export const IMPLICIT_ZONES: readonly { id: string; label: string; weight: Weight; note: string }[];
export const LEVELS: Readonly<Record<LevelId, Level>>;
export const LEVEL_IDS: readonly LevelId[];
export function isLevel(x: unknown): x is LevelId;
export function slug(s: unknown, max?: number): string;
export function assetIdOf(id: string): string;
export function ownerOfPath(path: string): { kind: OwnerKind; id: string; app: string };
export function normalizeZone(raw: unknown): Zone;
export function mergeZones(...lists: unknown[]): Zone[];
export function weightOf(id: string, uses?: number): Weight;
export function zonesForLevel(level: LevelId, zones: Zone[]): Zone[];
export function normalizeItem(raw: unknown, depth?: number, maxDepth?: number): CtxItem;
export function normalizeItems(items: unknown, depth?: number, maxDepth?: number): CtxItem[];
export function validateItems(items: unknown, path?: string): string[];
export function countItems(items: CtxItem[] | undefined): number;
export function depthOf(items: CtxItem[] | undefined): number;
export function slim(items: CtxItem[], budget: number, depth?: number): CtxItem[];
export function normalizeMenu(raw: unknown, now?: string): MenuDoc;
export function validateMenu(doc: unknown): string[];
export function summarize(doc: MenuDoc | null | undefined): Summary;
export function diffMenus(current: MenuDoc | null | undefined, next: MenuDoc | null | undefined): TargetDiff[];
export function filterMenus(list: MenuDoc[], f?: { q?: string; app?: string; level?: string; zone?: string; source?: string }): MenuDoc[];
export function emptyHistory(id: string): History;
export function snapshot(history: History | null | undefined, doc: MenuDoc, by?: string, now?: string, max?: number): History;
export function restoreFrom(history: History | null | undefined, v: number | string, now?: string): MenuDoc | null;
export function buildPrompt(o?: { level?: LevelId; app?: string; page?: string; zones?: unknown[]; actions?: ActionRef[]; name?: string }): Prompt;
export function parseReply(text: unknown): Record<string, unknown> | null;
export function fromReply(reply: unknown, o?: { level?: LevelId; app?: string; page?: string; zones?: unknown[]; actions?: ActionRef[]; id?: string; name?: string; by?: string; model?: string; now?: string }): { doc: MenuDoc | null; warnings: string[] };
export function matchPhrase(text: unknown): Phrase | null;
