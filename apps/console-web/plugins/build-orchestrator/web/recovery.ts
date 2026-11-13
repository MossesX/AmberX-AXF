/**
 * Auto-recovery (build auto-recover-stuck-builds, Nov 13 2026): the shapes GET recovery answers and the one client the
 * Recovery log and Recovery settings share. Everything here is also reachable without the UI: REST (GET recovery,
 * POST recovery/run | settings | retry/<id> | park/<id>), the MCP plugin commands of the same names, the CLI
 * (recover.mjs status | run | retry | park | settings) and voice (recovery.run, recovery.status, recovery.retry).
 */
import { useCallback, useEffect, useState } from 'react';
import { pluginApi } from '@console/plugins';

export const FOLDER = 'build-orchestrator';
export const recoveryApi = pluginApi(FOLDER, 'Build orchestrator', { unavailable: 'The build orchestrator is switched off or its server part is not running.' });

export interface RecoverySettings { enabled: boolean; maxRetries: number; staleHeartbeatMin: number; backoffMin: string; fyi: boolean }
export interface RecoveryEvent { id: string; build: string; title?: string; priority?: string; phase: string; cause: string; exit: number | null; action: string; attempt: number; at: string; step: string; session: string; account: string; slot: string; line: string }
export interface RecoveryBuild { id: string; title: string; status: string; attempts: number; lastAt: string; lastCause: string; lastExit: number | null; nextAt: string; parkedAt: string; parked: boolean; priority: string }
export interface RecoveryState {
  ok: boolean;
  settings: RecoverySettings;
  lastRun: { at: string; by: string; actions: number; applied: { build: string; action: string; state: string; exit: number | null; attempt: number }[]; errors: { build?: string; error: string }[] } | null;
  requested: { at: string; by: string } | null;
  builds: RecoveryBuild[];
  events: RecoveryEvent[];
  health: { status: string; summary: string; details: string[] };
}

export const CAUSE_LABEL: Record<string, string> = { 'no-session': 'No live session', killed: 'Killed', failed: 'Failed', 'stale-heartbeat': 'Hung (no heartbeat)', 'slot-leaked': 'Leaked slot', '': '—' };
export const ACTION_LABEL: Record<string, string> = { requeue: 'Back in the Queue', retry: 'Retried', park: 'Parked', 'release-slot': 'Slot released', reset: 'Count reset' };

/** The Recovery state, refreshed every 30 s while shown; reload() after an action. */
export function useRecovery(pollMs = 30_000): { state: RecoveryState | null; error: string; reload: () => Promise<void> } {
  const [state, setState] = useState<RecoveryState | null>(null);
  const [error, setError] = useState('');
  const reload = useCallback(async () => {
    try { setState(await recoveryApi.call<RecoveryState>('recovery')); setError(''); }
    catch (e) { setError((e as Error).message); }
  }, []);
  useEffect(() => { void reload(); const t = setInterval(() => void reload(), pollMs); return () => clearInterval(t); }, [reload, pollMs]);
  return { state, error, reload };
}

/** The badge text a build view shows: '' when auto-recovery never touched it. */
export function badgeOf(b: RecoveryBuild | undefined): { text: string; tone: 'danger' | 'warning' | 'accent' } | null {
  if (!b || (!b.attempts && !b.parked)) return null;
  if (b.parked) return { text: `Parked after ${b.attempts} retries`, tone: 'danger' };
  return { text: `Recovered ${b.attempts}×${b.lastCause ? ` · ${CAUSE_LABEL[b.lastCause] ?? b.lastCause}` : ''}`, tone: b.nextAt && Date.parse(b.nextAt) > Date.now() ? 'warning' : 'accent' };
}
