import { useEffect, useState } from 'react';
import type { AxfRuntime } from '../../../src/axf/core';

/**
 * The Expense Tracker's ledger API (`/api/expenses/v1/*` on expenses.amberxai.com), called cross-origin with the
 * signed-in session cookie (the API answers Molly's origin with CORS + credentials). The standalone app keeps working
 * on the same ledger: both read and write one document.
 */

export const API_BASE_KEY = 'expenses.apiBase';
export const DEFAULT_API_BASE = 'https://expenses.amberxai.com/api/expenses/v1';

export interface Entry {
  id: string; date: string; merchant: string; category: string; paymentMethod?: string; note?: string;
  kind?: 'income'; currency: string; totalCents: number; disputed?: boolean; reimbursable?: boolean; source?: string;
}
export interface EntryInput {
  date?: string; merchant?: string; category?: string; account?: string; note?: string; kind?: 'income' | 'expense';
  amount?: number; reimbursable?: boolean; disputed?: boolean;
}
export interface PaydaysData {
  schedule: { amount: number; amountDollars: number; every: string; weekday: number; dayOfMonth: number; payer: string; since: string; anchor: string };
  ready: boolean; today: string; next: string | null; missing: string[]; recent: Entry[];
}
export interface Bucket { key: string; label: string; count: number; total: number; share: number }
export interface Period { kind: string; key: string; label: string; from: string; to: string }
export interface StatementData {
  statement: {
    period: Period; opening: number; closing: number; subtotal: number; tax: number; tip: number; total: number;
    income: number; net: number; previousTotal: number | null; changePct: number | null; categories: Bucket[];
    merchants: Bucket[]; count: number; unreconciled: number;
  };
  periods: Period[];
  markdown: string;
}

/** The caller's own today (local time zone), sent so paydays land on the right day. */
export function todayIso(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export const apiBase = (rt: AxfRuntime): string => {
  const v = rt.settings.get(API_BASE_KEY);
  return (typeof v === 'string' && v.trim() ? v.trim() : DEFAULT_API_BASE).replace(/\/+$/, '');
};

export async function call<T>(rt: AxfRuntime, path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(`${apiBase(rt)}/${path}`, {
    method: init?.method ?? 'GET',
    credentials: 'include',
    headers: init?.body === undefined ? undefined : { 'content-type': 'application/json' },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(res.status === 401 ? 'Sign in to Expenses (expenses.amberxai.com) to see your ledger here.' : json.error ?? `HTTP ${res.status}`);
  return json;
}

/** Bumped after every write, so every open screen re-reads. */
let rev = 0;
const listeners = new Set<() => void>();
export function ledgerChanged(): void { rev++; listeners.forEach((f) => f()); }

export interface Loaded<T> { data: T | null; error: string | null; loading: boolean; reload: () => void }

/** GET `path` and re-read it whenever the ledger changes. */
export function useApi<T>(rt: AxfRuntime, path: string | null): Loaded<T> {
  const [, setTick] = useState(0);
  const [state, setState] = useState<{ data: T | null; error: string | null; loading: boolean }>({ data: null, error: null, loading: true });
  useEffect(() => { const f = () => setTick((n) => n + 1); listeners.add(f); return () => { listeners.delete(f); }; }, []);
  const key = `${path}#${rev}`;
  useEffect(() => {
    if (!path) return;
    let live = true;
    setState((s) => ({ ...s, loading: true }));
    call<T>(rt, path).then(
      (data) => { if (live) setState({ data, error: null, loading: false }); },
      (e: Error) => { if (live) setState({ data: null, error: e.message, loading: false }); },
    );
    return () => { live = false; };
  }, [rt, key]); // eslint-disable-line react-hooks/exhaustive-deps
  return { ...state, reload: ledgerChanged };
}

export const money = (cents: number, currency = 'USD'): string =>
  new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(cents / 100);

export function ledgerQuery(f: { q?: string; kind?: string; from?: string; to?: string; category?: string; account?: string }): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) if (v) p.set(k, v);
  const s = p.toString();
  return s ? `entries?${s}` : 'entries';
}
