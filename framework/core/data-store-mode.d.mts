/** Types for data-store-mode.mjs (data-store-mode@1: local → shadow → cutover → rollback per namespace). */
import type { Mode, NamespaceManifest, DataManifest } from './data-store.mjs';
export const SCHEMA: 'data-store-mode@1';
export const DRIFT_RECORD: 'data-drift@1';
export const VERSION: 1;
export const MODES: Mode[];
export type Event = 'start-shadow' | 'back-to-local' | 'cut-over' | 'roll-back' | 'finish-rollback' | 'cancel-rollback';
export const EVENTS: Event[];
export const TRANSITIONS: Readonly<Record<Event, [Mode, Mode]>>;
export const DRIFT_FREE_MS: number;
export type DriftKind = 'missing-remote' | 'missing-local' | 'etag' | 'entries' | 'write-failed' | 'append-failed';
export const DRIFT_KINDS: DriftKind[];
export type Side = 'local' | 'remote';
export interface Route { read: Side; write: Side[]; diff: boolean; localWritable: boolean; remoteRequired: boolean }
export const ROUTES: Readonly<Record<Mode, Route>>;
export interface NamespaceMode { mode: Mode; since: string; cursor: number; manifest: string; drift: number; lastDriftAt: string }
export interface ModeState { $axf: 'data-store-mode@1'; mode: Mode; since: string; by: string; cursor: number; manifest: string; namespaces: Record<string, NamespaceMode> }
export interface DriftSide { rev: number; etag: string; entries?: number }
export interface DriftEntry { $axf: 'data-drift@1'; at: string; op: 'read' | 'write' | 'append'; key: string; kind: DriftKind; local: DriftSide | null; remote: DriftSide | null; error?: string }
export interface Guard { ok: boolean; event: Event | ''; reason: string }
export interface GuardContext { manifests?: { local?: NamespaceManifest | DataManifest; remote?: NamespaceManifest | DataManifest } | Record<string, { local?: unknown; remote?: unknown }>; now?: string; remoteOk?: boolean; replayed?: boolean; acceptDrift?: string[]; minDriftFreeMs?: number }
export function initialState(at: string, by?: string): ModeState;
export function normState(v: unknown, at?: string): ModeState;
export function modeOf(state: ModeState, ns: string): Mode;
export function route(mode: Mode): Route;
export function readPlan(state: ModeState, ns: string): { mode: Mode; from: Side; compare: Side | '' };
export function writePlan(state: ModeState, ns: string): { mode: Mode; targets: Side[]; required: Side[]; refused: '' | 'read_only'; reason: string };
export function canTransition(state: ModeState, ns: string, to: Mode, ctx?: GuardContext): Guard;
export function transition(state: ModeState, o: { ns?: string | string[]; to: Mode; at: string; by?: string; cursor?: number; manifest?: string; ctx?: GuardContext }): { state: ModeState; changes: Array<{ ns: string; from: Mode; to: Mode; event: Event | ''; at: string; by: string }> };
export function driftEntry(op: 'read' | 'write' | 'append', key: string, local: unknown, remote: unknown, at: string): DriftEntry | null;
export function applyDrift(state: ModeState, entry: DriftEntry | null): ModeState;
export function nextStep(state: ModeState, ns: string, ctx?: GuardContext): Guard & { ns: string; mode: Mode; next: 'shadow' | 'wait' | 'cutover' | 'replay' | 'local' | 'done' };
export function summary(state: ModeState): string[];
