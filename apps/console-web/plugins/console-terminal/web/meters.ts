/*
 * Live meters for headless tabs (headless-tabs, Nov 3 2026): agent, model, cost and status of every headless session
 * that has a tab open, read from the plugin's `GET headless/meters` (one ssh call for all of them, cached 2 s on the
 * server) every 2 s while the page is visible. deploy/claude-headless.sh writes the meters (deploy/claude-meter.mjs);
 * the cost is usage × framework/schemas/model-pricing.json, matched to Claude Code's own total when a run ends.
 */
import { useSyncExternalStore } from 'react';
import { call } from './api';

export type MeterStatus = 'starting' | 'working' | 'waiting' | 'done' | 'failed';
export interface Meter {
  session: string; name: string; agent: string; model: string; modelKey: string; status: MeterStatus; toolRunning: boolean; ended: boolean;
  costUsd: number; costEstimated: boolean; priced: boolean; tokens: { input: number; output: number; cacheRead: number; cacheWrite: number };
  turns: number; tools: number; runs: number; lastEventAt: string; startedAt: string; chainCount: number; chainVersion: number;
}

const WAIT_AFTER_MS = 60_000;
/** working → waiting when nothing came for a minute and no tool is running (Claude Code is quiet). Pure. */
export function statusOf(m: Pick<Meter, 'status' | 'toolRunning' | 'lastEventAt'> | null | undefined, now = Date.now()): MeterStatus | null {
  if (!m) return null;
  if (m.status === 'working' && !m.toolRunning && now - Date.parse(m.lastEventAt) > WAIT_AFTER_MS) return 'waiting';
  return m.status;
}
/** 'claude-opus-5-5' → 'Opus 5.5', 'opus' → 'Opus', '' → ''. Pure. */
export function modelName(id: string): string {
  const m = /(fable|opus|sonnet|haiku)[-_ ]?(\d+)?(?:[-_.](\d+))?/i.exec(id || '');
  if (!m) return id || '';
  const fam = m[1]!.charAt(0).toUpperCase() + m[1]!.slice(1).toLowerCase();
  return m[2] ? `${fam} ${m[2]}${m[3] ? `.${m[3]}` : ''}` : fam;
}
/** $0.00 under $10, $12.3 under $100, $123 above. Pure. */
export function money(v: number | null | undefined): string {
  if (typeof v !== 'number' || !Number.isFinite(v)) return '';
  return v < 10 ? `$${v.toFixed(2)}` : v < 100 ? `$${v.toFixed(1)}` : `$${Math.round(v)}`;
}

const meters = new Map<string, Meter>();
const wanted = new Map<string, number>(); // session → how many tabs show it
const listeners = new Set<() => void>();
let version = 0;
let timer: ReturnType<typeof setInterval> | null = null;
const emit = () => { version++; listeners.forEach((f) => f()); };

async function tick() {
  if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
  const names = [...wanted.keys()];
  if (!names.length) return;
  try {
    const r = await call<{ items: Record<string, Meter> }>(`headless/meters?names=${encodeURIComponent(names.join(','))}`);
    let changed = false;
    for (const [n, m] of Object.entries(r.items ?? {})) {
      const prev = meters.get(n);
      if (!prev || prev.costUsd !== m.costUsd || prev.status !== m.status || prev.lastEventAt !== m.lastEventAt || prev.chainVersion !== m.chainVersion) { meters.set(n, m); changed = true; }
    }
    if (changed) emit();
  } catch { /* VPS unreachable: keep the last values */ }
}

/** Start following a session's meter; returns the stop function. */
export function follow(session: string): () => void {
  wanted.set(session, (wanted.get(session) ?? 0) + 1);
  if (!timer) { timer = setInterval(() => void tick(), 2000); }
  void tick();
  return () => {
    const n = (wanted.get(session) ?? 1) - 1;
    if (n > 0) wanted.set(session, n); else wanted.delete(session);
    if (!wanted.size && timer) { clearInterval(timer); timer = null; }
  };
}
export const meterOf = (session: string | undefined) => (session ? meters.get(session) ?? null : null);
const subscribe = (f: () => void) => { listeners.add(f); return () => { listeners.delete(f); }; };
/** Re-render on any meter change. */
export function useMeters(): number { return useSyncExternalStore(subscribe, () => version); }
