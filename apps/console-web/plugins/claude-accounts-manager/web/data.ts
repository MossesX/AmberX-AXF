/**
 * Claude accounts manager: data. One poll of GET accounts and GET settings shared by every surface (page, Terminal
 * column, banner widget, overlay), and the calls that change something. Names, emails, plans and numbers only.
 */
import { useCallback, useEffect, useState } from 'react';
import { pluginFetch } from '@console/plugins';

export const FOLDER = 'claude-accounts-manager';
export const ID = 'ai.amberx.axf.console.claude-accounts-manager';
export const VIEW = 'claude-accounts-manager';
export const CTX = 'claude-account';
export const POLL_MS = 60000;
export const NAME = /^[a-z0-9][a-z0-9-]{0,31}$/;

export interface UsageWindow { usedPct: number; leftPct: number; resetsAt: string; locked: boolean }
export interface Row {
  n: number | null; inOrder: boolean; name: string; label: string; display: string; email: string; plan: string;
  kind: 'subscription' | 'api'; active: boolean; role: string; status: 'builder' | 'worker' | 'console' | 'idle'; statusText: string;
  running: number; worker: boolean; outOfCredits: boolean; creditsWhy: string; hasKey: boolean;
  fiveHour: UsageWindow | null; weekly: UsageWindow | null; usedPct: number | null; leftPct: number | null;
  planUsd: number | null; totalUsd: number | null; usedUsd: number | null; leftUsd: number | null; usdBasis: string;
  costWeek: number; usable: boolean; why: string;
}
export interface View {
  ok: boolean; ready: boolean; why: string; active: string; usage: boolean; dispatch: boolean; accounts: Row[]; order: string[]; orderSaved: boolean;
  totals: { accounts: number; builders: number; workers: number; out: number; api: number; usedUsd: number; leftUsd: number; totalUsd: number };
}
export interface MenuItem { label: string; action: string }
export interface OverlayButton { id: string; label: string; icon: string; action: string; list: '' | 'session' | 'rename' | 'accounts'; menu: MenuItem[] }
export interface Overlay {
  open: boolean; scope: 'console' | 'os'; dock: 'free' | 'left' | 'right' | 'top' | 'bottom'; minimized: boolean; locked: boolean;
  x: number; y: number; w: number; h: number; opacity: number; buttons: OverlayButton[];
}
export interface Settings {
  widget: { on: boolean; account: string; show: string[] };
  column: { on: boolean; open: boolean };
  overlay: Overlay;
  prices: Record<string, number>;
  accountPrices: Record<string, number>;
}
export const SHOW_PARTS: { value: string; label: string }[] = [
  { value: 'number', label: 'Number in the order' }, { value: 'name', label: 'Name' }, { value: 'left', label: 'Usage left' },
  { value: 'kind', label: 'API or subscription' }, { value: 'email', label: 'Email' }, { value: 'plan', label: 'Plan' },
  { value: 'status', label: 'Builder / worker / out' }, { value: 'dollars', label: 'Dollars used' },
];

/* ---------------- one shared state ---------------- */

let view: View | null = null;
let settings: Settings | null = null;
let error = '';
const subs = new Set<() => void>();
const emit = () => { for (const f of subs) f(); };
export const snapshot = () => ({ view, settings, error });

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await pluginFetch(FOLDER, path, init);
  const j = (await r.json().catch(() => ({}))) as T & { detail?: string; ok?: boolean };
  if (!r.ok) throw new Error(typeof j.detail === 'string' ? j.detail : `HTTP ${r.status}`);
  return j;
}
const post = <T>(path: string, body: unknown) => json<T>(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

export async function load(): Promise<void> {
  try {
    const [v, s] = await Promise.all([json<View>('accounts'), json<{ settings: Settings }>('settings')]);
    view = v; settings = s.settings; error = '';
  } catch (e) { error = (e as Error).message; }
  emit();
}

export function useManager() {
  const [, tick] = useState(0);
  useEffect(() => { const f = () => tick((n) => n + 1); subs.add(f); if (!view && !error) void load(); return () => { subs.delete(f); }; }, []);
  const refresh = useCallback(() => load(), []);
  return { ...snapshot(), refresh };
}
export const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };

/** Every change: the server answers, then the list reloads. Throws the server's reason. */
async function change<T>(path: string, body: unknown): Promise<T> {
  try { return await post<T>(path, body); } finally { await load(); }
}
export const setOrder = (order: string[]) => change<{ message: string }>('order', { order });
export const move = (name: string, to: string | number) => change<{ message: string }>('move', { name, to });
export const rename = (name: string, label: string) => change<{ message: string }>('rename', { name, label });
export const addAccount = (name: string, kind: 'subscription' | 'api') => change<{ open: Record<string, unknown>; message: string }>('add', { name, kind });
export const sessionFor = (name: string) => post<{ open: Record<string, unknown> }>('session', { name });
export async function saveSettings(patch: Partial<Settings> | Record<string, unknown>): Promise<Settings> {
  const r = await post<{ settings: Settings }>('settings', patch);
  settings = r.settings; emit();
  return r.settings;
}

/* ---------------- words and numbers ---------------- */

export const usd = (n: number | null | undefined) => (n == null ? '—' : `$${n.toFixed(2)}`);
export const pct = (n: number | null | undefined) => (n == null ? '—' : `${Math.round(n)}%`);

/** The banner widget's line (the same parts as the server's model.widget_text). */
export function widgetText(r: Row | undefined, show: string[]): string {
  if (!r) return 'Claude: no account';
  const parts: string[] = [];
  for (const k of show) {
    if (k === 'number' && r.n) parts.push(`#${r.n}`);
    else if (k === 'name') parts.push(r.display);
    else if (k === 'kind') parts.push(r.kind === 'api' ? 'API' : 'Sub');
    else if (k === 'left') { if (r.leftUsd != null) parts.push(`${usd(r.leftUsd)} left`); else if (r.leftPct != null) parts.push(`${pct(r.leftPct)} left`); }
    else if (k === 'dollars' && r.usedUsd != null) parts.push(`${usd(r.usedUsd)} used`);
    else if (k === 'email' && r.email) parts.push(r.email);
    else if (k === 'plan' && r.plan) parts.push(r.plan);
    else if (k === 'status') parts.push(r.outOfCredits ? 'out of credits' : r.status);
  }
  return parts.join(' · ') || r.display;
}

/** The order after dragging `from` onto the place of `to` (names); an account out of the order joins it there. */
export function dropOrder(order: string[], from: string, to: string | null): string[] {
  const cur = order.filter((n) => n !== from);
  const at = to && cur.includes(to) ? cur.indexOf(to) + (order.indexOf(from) >= 0 && order.indexOf(from) < order.indexOf(to) ? 1 : 0) : cur.length;
  return [...cur.slice(0, at), from, ...cur.slice(at)];
}
