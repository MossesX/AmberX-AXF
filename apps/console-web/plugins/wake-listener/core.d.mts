// Types for core.mjs (wake-listener@1).
export const FRAME: 'wake-listener@1';
export const FOLDER: 'wake-listener';
export const ENGINES: readonly string[];
export const PHASES: readonly string[];
export const MAX_PHRASES: number;
export const DEFAULT_PHRASES: readonly string[];

export type Engine = 'auto' | 'native' | 'webspeech' | 'off';
export type RunningEngine = 'native' | 'webspeech' | 'none';
export type Phase = 'off' | 'idle' | 'awake' | 'wizard';

export interface ListenerSettings {
  on: boolean;
  phrases: string[];
  engine: Engine;
  awakeSec: number;
  answerSec: number;
  speak: boolean;
  chime: boolean;
  indicator: 'always' | 'listening' | 'never';
  pauseHidden: boolean;
  /** Claude mode: understand commands with Claude while Claude is connected */
  useClaude: boolean;
  /** seconds Claude mode waits before the scripted matcher takes the command */
  claudeTimeoutSec: number;
}
export const DEFAULTS: Readonly<ListenerSettings>;
export const SETTING_KEYS: Readonly<Record<'axf.voice.useClaude' | 'axf.voice.claudeTimeoutSec', 'useClaude' | 'claudeTimeoutSec'>>;
export const CLAUDE_TIMEOUT_MIN: number;
export const CLAUDE_TIMEOUT_MAX: number;

export class ListenerError extends Error { code: string; constructor(code: string, message: string) }

export interface ListenerState {
  $axf: 'wake-listener@1';
  on: boolean;
  phase: Phase;
  engine: RunningEngine;
  listening: boolean;
  micOpen: boolean;
  awakeUntil: number;
  lastHeard: string;
  lastHeardAt: number;
  lastWake: string;
  lastWakeAt: number;
  lastCommand: string;
  lastReply: string;
  error: string;
  updatedAt: number;
}

export type HearEvent = 'ignored' | 'wake' | 'command' | 'wizard';
export interface Heard { state: ListenerState; event: HearEvent; command?: string }

export function normalizePhrase(text: unknown): string;
export function normalizePhrases(raw: unknown): string[];
export function normalizeSettings(raw: unknown): ListenerSettings;
export function applyPatch(settings: unknown, patch: Record<string, unknown>): ListenerSettings;
export function matchWake(text: unknown, phrases: unknown): { wake: string; rest: string } | null;
export function isBareWake(text: unknown, phrases: unknown): boolean;
export function pickEngine(setting: unknown, have: { native?: boolean; webspeech?: boolean }): RunningEngine;
export const ENGINE_LABEL: Record<RunningEngine, string>;
export function initialState(settings: unknown, now?: number): ListenerState;
export function hear(state: ListenerState, settings: unknown, text: unknown, now?: number): Heard;
export function sleep(state: ListenerState, now?: number): ListenerState;
export function wizardOn(state: ListenerState, now?: number): ListenerState;
export function wizardOff(state: ListenerState, now?: number): ListenerState;
export function switched(state: ListenerState, on: boolean, now?: number): ListenerState;
export function light(state: ListenerState | null | undefined): { label: string; tone: string; lit: boolean };
export function stateLine(state: ListenerState, settings: unknown): string;
