import { useEffect, useState, useSyncExternalStore } from 'react';
import type { AxfRuntime } from '../../../src/axf/core';
import { Button, Chip, Note, SelectField, TextField, useRuntime } from '../../../src/axf/react';
import { mollyFetch } from '../../../src/molly/host';
import { provideModule, type SurfaceModule } from '../../../src/molly/native';

/**
 * Expenses as a Molly module (build convert-every-app-into-a-molly-module, Nov 2026). Expenses is a Next.js app whose
 * screens cannot mount in Molly's page, so this plugin is its module: Molly draws the ledger and Add entry with
 * framework controls over the Expenses API (`/api/expenses/v1`) with Molly's one sign-in (app `expenses`). It is
 * registered with `provideModule`, so Settings → Modules switches it off and a crash in it stops only it.
 * Removing the folder puts Expenses back to opening on its own.
 */

const APP = 'expenses';
const OWNER = 'expenses';
const LIMIT = 50;

export interface Entry { id: string; date: string; merchant: string; category: string; paymentMethod?: string; kind?: string; total: number; note?: string }
export interface Totals { count: number; spentCents: number; incomeCents: number; netCents: number }

/* ---------- the ledger, read through Molly's sign-in ---------- */

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await mollyFetch(APP, path, init);
  const body = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (!r.ok) throw new Error(body.error || (r.status === 401 || r.status === 403 ? 'Sign in to Expenses first (App connections).' : `Expenses answered ${r.status}`));
  return body;
}

const store = { entries: [] as Entry[], totals: null as Totals | null, query: '', loading: false, error: '', rev: 0 };
const subs = new Set<() => void>();
const bump = () => { store.rev++; subs.forEach((f) => f()); };
const useStore = () => { useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => store.rev, () => store.rev); return store; };

export async function refresh(query = store.query): Promise<void> {
  store.query = query;
  store.loading = true;
  store.error = '';
  bump();
  try {
    const q = new URLSearchParams({ limit: String(LIMIT) });
    if (query.trim()) q.set('q', query.trim());
    const [list, t] = await Promise.all([api<{ entries: Entry[] }>(`entries?${q}`), api<{ totals: Totals }>('totals')]);
    store.entries = list.entries ?? [];
    store.totals = t.totals ?? null;
  } catch (e) {
    store.error = e instanceof Error ? e.message : String(e);
  } finally {
    store.loading = false;
    bump();
  }
}

export interface NewEntry { amount: number; merchant: string; category?: string; account?: string; kind?: 'expense' | 'income'; date?: string; note?: string }

/** `amount:merchant[:category[:account]]` → an entry (null when the amount or merchant is missing). */
export function parseEntry(spec: string): NewEntry | null {
  const [amt = '', merchant = '', category = '', account = ''] = spec.split(':').map((s) => s.trim());
  const amount = Number(amt.replace(/^\$/, ''));
  if (!Number.isFinite(amount) || amount <= 0 || !merchant) return null;
  return { amount, merchant, ...(category ? { category } : {}), ...(account ? { account } : {}) };
}

export async function addEntry(e: NewEntry): Promise<Entry> {
  const body = { date: e.date || new Date().toISOString().slice(0, 10), merchant: e.merchant, amount: e.amount, kind: e.kind ?? 'expense', ...(e.category ? { category: e.category } : {}), ...(e.account ? { account: e.account } : {}), ...(e.note ? { note: e.note } : {}) };
  const r = await api<{ entry: Entry }>('entries', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  void refresh();
  return r.entry;
}

const money = (cents: number) => (cents / 100).toLocaleString(undefined, { style: 'currency', currency: 'USD' });

/* ---------- screens ---------- */

function Ledger() {
  const rt = useRuntime();
  const s = useStore();
  const [q, setQ] = useState(s.query);
  useEffect(() => { if (!s.totals && !s.loading && !s.error) void refresh(); }, [s.totals, s.loading, s.error]);
  return (
    <div className="fx-stack fx-stack--lg molly-exp" data-axf-help-id="molly-expenses-ledger">
      <header className="fx-pagehead">
        <div>
          <p className="fx-eyebrow">Expenses</p>
          <h1>Ledger</h1>
          <p className="fx-muted">The Expense Tracker's ledger, inside Molly. Same entries as expenses.amberxai.com.</p>
        </div>
      </header>
      <div className="fx-row fx-row--wrap" role="toolbar" aria-label="Expenses">
        <Button tone="primary" icon="plus" onClick={() => rt.dispatch('expenses.open:add')}>Add entry</Button>
        <Button icon="refresh" disabled={s.loading} onClick={() => void refresh()}>Refresh</Button>
        <Button icon="external" onClick={() => window.open('https://expenses.amberxai.com', '_blank', 'noopener')}>Open on its own</Button>
      </div>
      {s.error && (
        <Note tone="warning">
          {s.error} <Button icon="key" onClick={() => rt.dispatch('molly.auth.open:expenses')}>App connections</Button>
        </Note>
      )}
      {s.totals && (
        <div className="molly-exp__totals" role="status">
          <Chip>{s.totals.count} entries</Chip>
          <Chip tone="danger">Spent {money(s.totals.spentCents)}</Chip>
          <Chip tone="success">Income {money(s.totals.incomeCents)}</Chip>
          <Chip tone="accent">Net {money(s.totals.netCents)}</Chip>
        </div>
      )}
      <form className="molly-exp__search" onSubmit={(e) => { e.preventDefault(); void refresh(q); }}>
        <TextField label="Search" value={q} onChange={setQ} placeholder="Merchant, note or item" />
        <Button type="submit" icon="search">Search</Button>
      </form>
      {s.loading && !s.entries.length ? <Note tone="info">Loading the ledger…</Note> : (
        <div className="molly-exp__table">
          <table className="fx-table">
            <thead><tr><th>Date</th><th>Merchant</th><th>Category</th><th>Account</th><th className="molly-exp__num">Total</th></tr></thead>
            <tbody>
              {s.entries.map((e) => (
                <tr key={e.id} data-kind={e.kind ?? 'expense'}>
                  <td className="fx-mono">{e.date}</td>
                  <td>{e.merchant}</td>
                  <td>{e.category}</td>
                  <td>{e.paymentMethod ?? ''}</td>
                  <td className="molly-exp__num fx-mono">{(e.kind ?? 'expense') === 'income' ? '+' : ''}{money(Math.round(e.total * 100))}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!s.entries.length && !s.error && <p className="fx-muted">No entries{s.query ? ` for “${s.query}”` : ''}.</p>}
        </div>
      )}
    </div>
  );
}

const KIND_OPTIONS = [{ value: 'expense', label: 'Expense' }, { value: 'income', label: 'Income' }];

function AddEntry() {
  const rt = useRuntime();
  const [f, setF] = useState({ amount: '', merchant: '', category: '', account: '', kind: 'expense', date: new Date().toISOString().slice(0, 10), note: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = (k: keyof typeof f) => (v: string) => setF((o) => ({ ...o, [k]: v }));
  const amount = Number(f.amount);
  const ok = Number.isFinite(amount) && amount > 0 && !!f.merchant.trim();
  const submit = async () => {
    setBusy(true); setErr('');
    try {
      await addEntry({ amount, merchant: f.merchant.trim(), category: f.category.trim(), account: f.account.trim(), kind: f.kind as 'expense' | 'income', date: f.date, note: f.note.trim() });
      rt.toast(`Added ${f.merchant.trim()} ${money(Math.round(amount * 100))}.`, 'success', 'Expenses');
      rt.navigate(APP);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  return (
    <div className="fx-stack fx-stack--lg molly-exp" data-axf-help-id="molly-expenses-add">
      <header className="fx-pagehead">
        <div>
          <p className="fx-eyebrow">Expenses</p>
          <h1>Add entry</h1>
        </div>
      </header>
      {err && <Note tone="warning">{err}</Note>}
      <form className="molly-exp__form" onSubmit={(e) => { e.preventDefault(); if (ok) void submit(); }}>
        <TextField label="Amount ($)" value={f.amount} onChange={set('amount')} required placeholder="12.50" />
        <TextField label="Merchant" value={f.merchant} onChange={set('merchant')} required />
        <SelectField label="Kind" value={f.kind} options={KIND_OPTIONS} onChange={set('kind')} />
        <TextField label="Date" type="date" value={f.date} onChange={set('date')} />
        <TextField label="Category" value={f.category} onChange={set('category')} />
        <TextField label="Account" value={f.account} onChange={set('account')} />
        <TextField label="Note" value={f.note} onChange={set('note')} />
        <div className="fx-row fx-row--wrap" role="toolbar" aria-label="Add entry">
          <Button type="submit" tone="primary" icon="save" disabled={!ok || busy}>Add</Button>
          <Button icon="arrow-left" onClick={() => rt.navigate(APP)}>Back to the ledger</Button>
        </div>
      </form>
    </div>
  );
}

/* ---------- the module (shell-surface@1 seam, in-process) ---------- */

const SCREENS = [{ id: 'home', title: 'Ledger', icon: 'chart' }, { id: 'add', title: 'Add entry', icon: 'plus' }];

let runtime: AxfRuntime | null = null;
export const expensesModule: SurfaceModule = {
  // in-process: Molly renders `render(view)` in its own tree; there is no element to mount into
  mountSurface: () => ({ show() {}, unmount() {} }),
  render: (view) => (view === 'add' ? <AddEntry /> : <Ledger />),
  screens: () => SCREENS,
  searchEntries: () => [
    ...SCREENS.map((s) => ({ id: `view:${s.id}`, kind: 'view', label: s.title, icon: s.icon, focus: { kind: 'view', view: s.id } })),
    { id: 'action:expenses.totals', kind: 'action', label: 'Expense totals', icon: 'chart', focus: { kind: 'action', spec: 'expenses.totals' } },
    { id: 'action:expenses.list', kind: 'action', label: 'Recent expenses', icon: 'list', focus: { kind: 'action', spec: 'expenses.list' } },
  ],
  run: (kind, id) => (kind === 'action' && runtime ? (runtime.dispatch(id), true) : false),
  subscribe: () => () => {},
  routes: [],
};

let started = false;
/** Provide the module and its actions (the plugin's `register`). */
export function registerExpenses(rt: AxfRuntime) {
  if (started) return; // StrictMode runs this twice in development
  started = true;
  runtime = rt;
  provideModule(OWNER, APP, expensesModule);
  const on = rt.actions.register.bind(rt.actions);
  const title = 'Expenses';
  const argOf = (args: string[], payload?: string) => (args.length ? args.join(':') : payload ?? '').trim();
  on('expenses.open', (args, ctx) => { const s = argOf(args, ctx.payload); rt.navigate(s === 'add' ? `${APP}/add` : APP); }, { label: 'Expenses: open (add)', params: true, effect: 'navigate' });
  on('expenses.list', async (args, ctx) => {
    await refresh(argOf(args, ctx.payload));
    if (store.error) { rt.toast(store.error, 'warning', title); return { error: store.error }; }
    const top = store.entries.slice(0, 5).map((e) => `${e.date} ${e.merchant} ${money(Math.round(e.total * 100))}`);
    rt.toast(top.join('\n') || 'No entries.', 'info', title);
    return store.entries;
  }, { label: 'Expenses: recent entries (words)', params: true, effect: 'read' });
  on('expenses.totals', async () => {
    await refresh();
    if (store.error || !store.totals) { rt.toast(store.error || 'No totals.', 'warning', title); return { error: store.error }; }
    const t = store.totals;
    rt.toast(`Spent ${money(t.spentCents)} · income ${money(t.incomeCents)} · net ${money(t.netCents)} (${t.count} entries)`, 'info', title);
    return t;
  }, { label: 'Expenses: totals', effect: 'read' });
  on('expenses.add', async (args, ctx) => {
    const e = parseEntry(argOf(args, ctx.payload));
    if (!e) { rt.toast('Say it as amount:merchant[:category[:account]], e.g. 12.50:Coffee:Food.', 'warning', title); return; }
    try {
      const entry = await addEntry(e);
      rt.toast(`Added ${e.merchant} ${money(Math.round(e.amount * 100))}.`, 'success', title);
      return entry;
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      rt.toast(m, 'warning', title);
      return { error: m };
    }
  }, { label: 'Expenses: add an entry (amount:merchant[:category[:account]])', params: true });
}
