export const TOKEN_REGISTRY_FRAME: 'token-registry@1';
export const SKIN_SNAPSHOT_FRAME: 'skin-snapshot@1';
export const TOKEN_MANIFEST_FRAME: 'token-registry@1';
export const SKIN_VOICE_FRAME: 'skin-editor-voice@1';
export type TokenArea = 'layout' | 'style' | 'colour' | 'behaviour';
export type TokenLevel = 'basic' | 'pro' | 'advanced';
export type TokenState = 'any' | 'idle' | 'hover' | 'active' | 'selected' | 'focus' | 'pressed' | 'disabled' | 'open' | 'on' | 'off' | 'checked';
export type TokenScheme = 'both' | 'light' | 'dark';
export type SnapshotKind = 'default' | 'edit' | 'revert' | 'import';
export const TOKEN_AREAS: readonly TokenArea[];
export const TOKEN_LEVELS: readonly TokenLevel[];
export const LEVEL_RANK: Readonly<Record<TokenLevel, number>>;
export const TOKEN_STATES: readonly TokenState[];
export const TOKEN_SCHEMES: readonly TokenScheme[];
export const SNAPSHOT_KINDS: readonly SnapshotKind[];
export const SNAPSHOT_MAX: number;
export const TOKEN_ID: RegExp;
export const SKIN_ID: RegExp;
export const DEFAULT_SKIN_ID: 'default';
export const DEFAULT_SKIN_LABEL: string;
export const SKIN_VARS_KEY: string;
export const TOKEN_ELEMENTS: Readonly<Record<string, string>>;
export const ELEMENT_LABELS: Readonly<Record<string, string>>;
export const TOKEN_DESCRIPTIONS: Readonly<Record<string, string>>;

export type TokenValue = string | number | boolean;
export interface TokenSetRef { target: string; path: string }
export interface RegistryToken {
  id: string; element: string; area: TokenArea; state: TokenState; scheme: TokenScheme; level: TokenLevel; description: string;
  default: TokenValue | ''; source: string; sources?: string[]; set?: TokenSetRef; deprecated?: boolean;
}
export interface TokenRegistry { $axf: 'token-registry@1'; version: number; updatedAt: string; tokens: RegistryToken[] }
export interface TokenClass { element: string; area: TokenArea; state: TokenState; scheme: TokenScheme; level: TokenLevel; description: string }
export interface TokenSearch { q?: string; area?: string; element?: string; level?: string; state?: string; scheme?: string; source?: string }
export interface RegistrySummary { total: number; elements: Record<string, number>; areas: Record<string, number>; levels: Record<string, number>; states: Record<string, number> }
export interface ManifestTokens { uses: string[]; defines: RegistryToken[] }
export interface Coverage { unregistered: { id: string; files: string[] }[]; unused: string[] }
export interface SetMaps { colourKeys?: string[]; styleFields?: Record<string, string>; layoutFields?: Record<string, string>; scaleFields?: Record<string, { type: string; path: string }> }

export function tokenWords(name: string): string[];
export function classifyToken(name: string, colourKeys?: string[]): TokenClass;
export function describeToken(name: string, element: string, state?: TokenState): string;
export function normalizeToken(raw: unknown, fallback?: Partial<RegistryToken> & { colourKeys?: string[] }): RegistryToken | null;
export function normalizeRegistry(raw: unknown): TokenRegistry;
export function registryErrors(raw: unknown): string[];
export function tokensAtLevel<T extends { level: TokenLevel }>(tokens: T[], level: TokenLevel): T[];
export function searchTokens(tokens: RegistryToken[], filter?: TokenSearch): RegistryToken[];
export function registrySummary(tokens: RegistryToken[]): RegistrySummary;
export function manifestTokens(manifest: unknown, source?: string): ManifestTokens | null;
export function manifestTokenErrors(manifest: unknown, opts?: { required?: boolean }): string[];
export function registryCoverage(registered: string[], used: Record<string, string[]>, prefixes?: string[]): Coverage;
export function manifestUsesDiff(listed: string[], read: string[]): { missing: string[]; stale: string[] };
export function tokenSet(name: string, maps?: SetMaps): TokenSetRef | null;

export interface SnapshotUi { kind: 'view' | 'dialog' | 'plugin' | 'element' | 'screen'; id: string; label: string }
export interface SnapshotEdit { token: string; from: TokenValue | null; to: TokenValue | null }
export type SkinState = Record<string, TokenValue>;
export interface SkinSnapshot {
  $axf: 'skin-snapshot@1'; id: string; parent: string | null; at: string; by: string; label: string; kind: SnapshotKind; ui: SnapshotUi; edits: SnapshotEdit[]; state: SkinState;
}
export interface SnapshotRow { id: string; parent: string | null; at: string; by: string; label: string; kind: SnapshotKind; edits: number; tokens: number; depth: number; onPath: boolean; head: boolean }
export interface SnapshotOpts { by?: string; at?: string; label?: string }
export function rootSnapshot(ui: Partial<SnapshotUi>, by?: string, at?: string): SkinSnapshot;
export function normalizeUi(ui: unknown): SnapshotUi;
export function normalizeSnapshot(raw: unknown): SkinSnapshot | null;
export function applyEdits(state: SkinState, edits: { token: string; to: TokenValue | null | undefined }[]): SkinState;
export function diffStates(a: SkinState, b: SkinState): SnapshotEdit[];
export function editLabel(edits: SnapshotEdit[]): string;
export function editSnapshot(chain: SkinSnapshot[], head: SkinSnapshot, edits: { token: string; to: TokenValue | null } | { token: string; to: TokenValue | null }[], opts?: SnapshotOpts): SkinSnapshot | null;
export function chainTo(chain: SkinSnapshot[], id: string): SkinSnapshot[];
export function snapshotRows(chain: SkinSnapshot[], headId: string): SnapshotRow[];
export function revertSnapshot(chain: SkinSnapshot[], head: SkinSnapshot, targetId: string, opts?: SnapshotOpts): SkinSnapshot | null;
export function snapshotBefore(chain: SkinSnapshot[], headId: string, iso: string): SkinSnapshot | null;
export function chainErrors(chain: unknown): string[];

export interface SkinBase { layoutTheme: string; colorTheme: string; styleTheme: string; behaviorTheme?: string; assets: Record<string, string>; extras?: Record<string, unknown>; iconPack?: string; parts?: Record<string, unknown> }
export interface ExportedSkin { asset: { $axf: 'asset@1'; type: 'skin'; id: string; name: string; version: string; description: string; author: string; tags: string[]; data: SkinBase & { preview: { caption: string } } }; mapped: string[]; unmapped: string[] }
export function exportSkin(state: SkinState, opts: { id: string; name?: string; base: SkinBase; description?: string; author?: string; tags?: string[]; sets?: Record<string, TokenSetRef | null> }): ExportedSkin;
export function skinState(skinData: unknown, sets?: Record<string, TokenSetRef | null>): SkinState;

export type SkinVoiceIntent =
  | { verb: 'revert'; minutes: number } | { verb: 'revert'; snapshot: string } | { verb: 'export'; name: string } | { verb: 'undo' }
  | { verb: 'open'; ui?: string } | { verb: 'set'; token: string; value: string } | { verb: 'registry'; q?: string };
export function cleanSkinPhrase(text: string): string;
export function skinVoiceIntent(text: string): SkinVoiceIntent | null;
