/**
 * The native seam of Audio Output Recorder: an `OutputRecorder` Capacitor plugin, looked up through a phone shell's
 * Capacitor global. No shipped app provides it today (the phone records through Phone Connect, phone-connect@1), so on
 * the Dev Console and in a browser `nativeBridge()` is null and the page shows the axHub list only.
 */
import type { NativeEvent, Settings, UploadState } from './core';

export interface Handle { remove(): Promise<void> | void }

export interface NativeStatus {
  running: boolean;
  startedAt: string | null;
  upload: UploadState;
  message: string;
  waiting: number;
  waitingBytes: number;
  capBytes: number;
  nextTryAt: string;
  lastUploadAt: string;
  mic?: boolean;
  micBusy?: string | null;
  settings: Omit<Settings, never>;
}

export interface LocalChunk { id: string; startedAt: string; durationMs: number; bytes: number; uploadedParts: number; parts: number }

export interface OutputRecorderBridge {
  status(): Promise<NativeStatus>;
  /** Android's prompts (audio permission once, notifications once, capture every time), then records; `recorder` events follow. */
  start(): Promise<void>;
  stop(): Promise<void>;
  /** "Record my mic too" was switched on: Android's audio permission, asked only now (and only if it isn't there). */
  micPermission(): Promise<{ granted: boolean }>;
  /** Settings for the recorder and the quick-settings tile (from the next start). */
  configure(o: Partial<Settings>): Promise<{ settings: Settings }>;
  /** Chunks on the phone waiting for axHub, oldest first. */
  queue(): Promise<{ chunks: LocalChunk[] }>;
  /** Send now (instead of waiting for the next retry). */
  retry(): Promise<void>;
  /** Throw away a chunk that never reached axHub. */
  discard(o: { id: string }): Promise<void>;
  /** A recording from axHub saved to Music/AmberX Recorder (checked against its SHA-256); its content uri. */
  fetch(o: { id: string }): Promise<{ uri: string; name?: string }>;
  play(o: { uri: string }): Promise<void>;
  share(o: { uri: string }): Promise<void>;
  addListener(event: 'recorder', fn: (e: NativeEvent) => void): Promise<Handle>;
}

type CapacitorGlobal = {
  isPluginAvailable?: (name: string) => boolean;
  registerPlugin?: <T>(name: string) => T;
  getPlatform?: () => string;
};

let cached: OutputRecorderBridge | null | undefined;
let override: OutputRecorderBridge | null | undefined;

export function nativeBridge(): OutputRecorderBridge | null {
  if (override !== undefined) return override;
  if (cached !== undefined) return cached;
  const cap = (globalThis as { Capacitor?: CapacitorGlobal }).Capacitor;
  cached = cap?.getPlatform?.() === 'android' && cap.isPluginAvailable?.('OutputRecorder') && cap.registerPlugin
    ? cap.registerPlugin<OutputRecorderBridge>('OutputRecorder') : null;
  return cached;
}

/** Tests: run against a fake bridge (null = no native side). */
export function setBridge(b: OutputRecorderBridge | null | undefined): void { override = b; }
