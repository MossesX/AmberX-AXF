/**
 * The stale-row watchdog's client side: the same REST routes MCP (watchdog-* plugin commands), `axf watchdog` and the
 * voice actions use (server/watchdog.py → watchdog.mjs). The Watchdog card's open sub-tab lives here so the
 * orchestrator.watchdog.open action can switch it from outside.
 */
import { pluginApi } from '@console/plugins';
import { FOLDER } from './ui';

export type WatchdogSettings = { enabled: boolean; intervalMin: number; dryRun: boolean; 'tables.builds': boolean; 'tables.merge-queue': boolean; 'tables.ui-review': boolean; notify: boolean };
export type SettingSpec = { type: 'boolean' | 'integer'; title: string; min?: number; max?: number; default: boolean | number };
export type RunChange = { table: string; kind: string; id: string; build: string; pr: number; action: 'complete' | 'remove'; reason: string; applied: boolean; why: string; line: string };
export type WatchdogRun = {
  at: string; by?: string; dry: boolean; ok: boolean; skipped?: string; error?: string; rows?: number; keep?: number; planned?: number; cleaned?: number; durationMs?: number;
  tables?: { id: string; label: string; on: boolean; available: boolean; rows: number; why?: string }[];
  facts?: { github: { requests: number; notModified: number } | null; errors: string[] }; changes?: RunChange[];
};
export type LogRecord = { id: string; kind: string; rowId: string; build: string; pr: number; branch: string; action: 'keep' | 'complete' | 'remove'; reason: string; evidence: string[]; at: string; by: string; dry?: boolean; note?: string; table?: string };
export type WatchdogStatus = { settings: WatchdogSettings; schema: Record<keyof WatchdogSettings, SettingSpec>; last: WatchdogRun | null; lastOk: string; running: boolean; runs: WatchdogRun[]; log: LogRecord[] };

export const watchdogApi = pluginApi(FOLDER, 'Stale-row watchdog', { unavailable: 'The build orchestrator is switched off or its server part is not running.' });
export const loadStatus = (log = 50) => watchdogApi.call<WatchdogStatus>(`watchdog?log=${log}`);
export const runNow = () => watchdogApi.post<WatchdogRun>('watchdog/run', { force: true });
export const dryRun = () => watchdogApi.post<WatchdogRun>('watchdog/dry-run', {});
export const saveSettings = (patch: Partial<WatchdogSettings>) => watchdogApi.put<{ ok: boolean; settings: WatchdogSettings }>('watchdog/settings', patch);
export const loadLog = (q: { limit?: number; kind?: string; action?: string; build?: string } = {}) =>
  watchdogApi.call<{ records: LogRecord[] }>(`watchdog/log?${new URLSearchParams(Object.entries(q).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => [k, String(v)])).toString()}`);

/** One line for a run (toasts, voice, the card). */
export function runLine(r: WatchdogRun): string {
  if (r.skipped) return `Watchdog skipped: ${r.skipped}.`;
  if (!r.ok) return `Watchdog run failed: ${r.error ?? 'unknown error'}.`;
  return r.dry ? `Dry run: ${r.planned ?? 0} of ${r.rows ?? 0} rows would change.` : `Watchdog cleaned ${r.cleaned ?? 0} of ${r.planned ?? 0} stale rows (${r.rows ?? 0} read).`;
}

// ---------------------------------------------------------------- the card's sub-tab (Settings, Last runs, Cleanups log)
export const WATCHDOG_TABS = [{ id: 'settings', label: 'Settings' }, { id: 'runs', label: 'Last runs' }, { id: 'log', label: 'Cleanups log' }] as const;
export type WatchdogTab = (typeof WATCHDOG_TABS)[number]['id'];
let current: WatchdogTab = 'settings';
const listeners = new Set<(t: WatchdogTab) => void>();
export const watchdogTab = () => current;
export const isWatchdogTab = (s: string): s is WatchdogTab => WATCHDOG_TABS.some((t) => t.id === s);
export function showWatchdogTab(t: WatchdogTab): void { current = t; for (const l of listeners) l(t); }
export function onWatchdogTab(fn: (t: WatchdogTab) => void): () => void { listeners.add(fn); return () => { listeners.delete(fn); }; }
