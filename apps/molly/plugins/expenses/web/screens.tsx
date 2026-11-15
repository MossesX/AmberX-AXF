import { useMemo, useState } from 'react';
import { Button, Chip, Container, Note, Segmented, SelectField, TextField, useRuntime } from '../../../src/axf/react';
import { Meter } from '../../../src/axf/react/components/Meters';
import { DataGrid, type GridColumn, type GridGroup } from '../../../src/axf/libs/datagrid';
import { call, ledgerChanged, ledgerQuery, money, todayIso, useApi, type Entry, type EntryInput, type PaydaysData, type StatementData } from './api';

/**
 * The Expense Tracker's screens drawn natively in Molly (no frame): Ledger, Paydays and Reports. Every control is a
 * framework control and the CSS only lays out, so the axHub look restyles them. Every action here is also a Molly
 * action (`expenses.*`, index.tsx), so the console API, MCP, CLI and voice reach the same thing.
 */

/** Grid tracks on the space token: a floor that fits the content, then a share of the rest (phone: the grid scrolls). */
const W = {
  date: 'minmax(calc(var(--fx-space) * 22), 1fr)',
  main: 'minmax(calc(var(--fx-space) * 30), 3fr)',
  mid: 'minmax(calc(var(--fx-space) * 24), 2fr)',
  amount: 'minmax(calc(var(--fx-space) * 22), 1fr)',
};

const KINDS = [{ value: '', label: 'All' }, { value: 'expense', label: 'Spending' }, { value: 'income', label: 'Income' }];

function Toolbar({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="axp-exp__toolbar" role="toolbar" aria-label={label}>{children}</div>;
}

function Problem({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <Note tone="warning" icon="alert">
      <span>{error}</span>{' '}
      <Button size="sm" tone="ghost" icon="refresh" onClick={onRetry}>Try again</Button>
    </Note>
  );
}

/* --------------------------------- ledger --------------------------------- */

const blank = (): Required<Pick<EntryInput, 'merchant' | 'date' | 'category' | 'account' | 'note'>> & { amount: string; kind: 'expense' | 'income' } =>
  ({ merchant: '', amount: '', date: todayIso(), category: '', account: '', note: '', kind: 'expense' });

export function LedgerScreen() {
  const rt = useRuntime();
  const [q, setQ] = useState('');
  const [kind, setKind] = useState('');
  const [hidden, setHidden] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [form, setForm] = useState<ReturnType<typeof blank> | null>(null);
  const [busy, setBusy] = useState(false);
  const { data, error, loading, reload } = useApi<{ entries: Entry[]; count: number; of: number }>(rt, ledgerQuery({ q, kind }));

  const groups = useMemo<GridGroup<Entry>[]>(() => {
    const byMonth = new Map<string, Entry[]>();
    for (const e of [...(data?.entries ?? [])].sort((a, b) => b.date.localeCompare(a.date))) {
      const m = e.date.slice(0, 7);
      byMonth.set(m, [...(byMonth.get(m) ?? []), e]);
    }
    return [...byMonth].map(([m, rows]) => {
      const spent = rows.filter((r) => r.kind !== 'income').reduce((n, r) => n + r.totalCents, 0);
      const label = new Date(`${m}-01T00:00:00`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
      return { id: m, title: label, rows, groups: [], summary: <span>{money(spent)} spent</span>, counts: <span>{rows.length}</span> };
    });
  }, [data]);

  const columns: GridColumn<Entry>[] = [
    { id: 'date', label: 'Date', width: W.date, sortable: true, sortValue: (r) => r.date, render: (r) => r.date },
    { id: 'merchant', label: 'Merchant', width: W.main, fixed: true, sortable: true, sortValue: (r) => r.merchant, render: (r) => r.merchant },
    { id: 'category', label: 'Category', width: W.mid, sortable: true, sortValue: (r) => r.category, render: (r) => r.category },
    { id: 'account', label: 'Account', width: W.mid, render: (r) => r.paymentMethod ?? '' },
    { id: 'amount', label: 'Amount', width: W.amount, align: 'end', sortable: true, sortValue: (r) => r.totalCents,
      render: (r) => r.kind === 'income' ? <Chip tone="success">+{money(r.totalCents, r.currency)}</Chip> : money(r.totalCents, r.currency) },
  ];

  const edit = (e: Entry) => {
    setSelected(e.id);
    setForm({ merchant: e.merchant, amount: String(e.totalCents / 100), date: e.date, category: e.category, account: e.paymentMethod ?? '', note: e.note ?? '', kind: e.kind === 'income' ? 'income' : 'expense' });
  };

  const save = async () => {
    if (!form) return;
    setBusy(true);
    try {
      const body: EntryInput = { merchant: form.merchant, amount: Number(form.amount), date: form.date, category: form.category, account: form.account, note: form.note, kind: form.kind };
      await call(rt, selected ? `entries/${encodeURIComponent(selected)}` : 'entries', { method: selected ? 'PATCH' : 'POST', body });
      rt.toast(selected ? 'Entry saved.' : 'Entry added.', 'success', 'Expenses');
      setForm(null); setSelected(null); ledgerChanged();
    } catch (e) { rt.toast((e as Error).message, 'danger', 'Expenses'); }
    setBusy(false);
  };

  return (
    <div className="axp-exp" data-screen="expenses.ledger">
      <Toolbar label="Ledger">
        <TextField label="Search" value={q} onChange={setQ} placeholder="Merchant, category, note" className="axp-exp__grow" />
        <SelectField label="Show" value={kind} options={KINDS} onChange={setKind} />
        <Button icon="plus" tone="primary" onClick={() => { setSelected(null); setForm(blank()); }}>Add entry</Button>
        <Button icon="refresh" tone="ghost" busy={loading} onClick={reload}>Refresh</Button>
        <Button icon="download" tone="ghost" onClick={() => rt.dispatch('expenses.export')}>Export CSV</Button>
      </Toolbar>
      {form && (
        <Container title={selected ? 'Edit entry' : 'Add entry'} icon={selected ? 'edit' : 'plus'}
          actions={<><Button tone="primary" icon="check" busy={busy} disabled={!form.merchant.trim() || !Number.isFinite(Number(form.amount)) || form.amount === ''} onClick={save}>Save</Button>
            <Button tone="ghost" icon="x" onClick={() => { setForm(null); setSelected(null); }}>Cancel</Button></>}>
          <div className="axp-exp__form">
            <TextField label="Merchant" value={form.merchant} onChange={(v) => setForm({ ...form, merchant: v })} required autoFocus />
            <TextField label="Amount" type="number" value={form.amount} onChange={(v) => setForm({ ...form, amount: v })} required />
            <TextField label="Date" type="date" value={form.date} onChange={(v) => setForm({ ...form, date: v })} />
            <SelectField label="Kind" value={form.kind} options={KINDS.slice(1)} onChange={(v) => setForm({ ...form, kind: v === 'income' ? 'income' : 'expense' })} />
            <TextField label="Category" value={form.category} onChange={(v) => setForm({ ...form, category: v })} />
            <TextField label="Account" value={form.account} onChange={(v) => setForm({ ...form, account: v })} />
            <TextField label="Note" value={form.note} onChange={(v) => setForm({ ...form, note: v })} className="axp-exp__wide" />
          </div>
        </Container>
      )}
      {error ? <Problem error={error} onRetry={reload} /> : (
        <div className="axp-exp__scroll"><DataGrid<Entry> id="expenses-ledger" label="Ledger" groups={groups} columns={columns} rowId={(r) => r.id} rowLabel={(r) => r.merchant}
          hidden={hidden} onToggleColumn={(c, show) => setHidden((h) => (show ?? h.includes(c)) ? h.filter((x) => x !== c) : [...h, c])} onShowAll={() => setHidden([])}
          selected={selected} onRowClick={edit} rowTone={(r) => (r.kind === 'income' ? 'success' : r.disputed ? 'warning' : '')}
          rowCtx={(r) => ({ target: 'expenses-entry', payload: r.id })} dataset={false}
          empty={loading ? 'Loading the ledger…' : 'No entries match.'} /></div>
      )}
      {data && <p className="axp-exp__foot">{data.count} of {data.of} entries · same ledger as expenses.amberxai.com</p>}
    </div>
  );
}

/* --------------------------------- paydays -------------------------------- */

const EVERY: Record<string, string> = { weekly: 'every week', biweekly: 'every two weeks', semimonthly: 'twice a month', monthly: 'once a month' };
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function PaydaysScreen() {
  const rt = useRuntime();
  const { data, error, loading, reload } = useApi<PaydaysData>(rt, `paydays?today=${todayIso()}`);
  const s = data?.schedule;
  const recent: GridGroup<Entry>[] = data ? [{ id: 'recent', title: 'Recent paydays', rows: data.recent, groups: [] }] : [];
  return (
    <div className="axp-exp" data-screen="expenses.paydays">
      <Toolbar label="Paydays">
        <Button icon="plus" tone="primary" disabled={!data?.missing.length} onClick={() => rt.dispatch('expenses.paydays.fill')}>
          Add {data?.missing.length ?? 0} missing payday{data?.missing.length === 1 ? '' : 's'}
        </Button>
        <Button icon="refresh" tone="ghost" busy={loading} onClick={reload}>Refresh</Button>
        <Button icon="settings" tone="ghost" onClick={() => rt.dispatch('expenses.settings')}>Pay schedule…</Button>
      </Toolbar>
      {error && <Problem error={error} onRetry={reload} />}
      {data && !data.ready && <Note tone="info" icon="info">No pay schedule yet. Set the take-home amount and how often you are paid in Expenses settings.</Note>}
      {data && data.ready && s && (
        <div className="axp-exp__cards">
          <Container title="Schedule" icon="clock">
            <p className="axp-exp__big">{money(s.amount)}</p>
            <p>{s.payer}, {EVERY[s.every] ?? s.every}{s.every === 'weekly' || s.every === 'biweekly' ? ` on ${DAYS[s.weekday]}` : s.every === 'monthly' ? ` on day ${s.dayOfMonth}` : ''}</p>
          </Container>
          <Container title="Next payday" icon="star">
            <p className="axp-exp__big">{data.next ?? 'None'}</p>
          </Container>
          <Container title="Missing" icon="alert">
            {data.missing.length ? <div className="axp-exp__chips">{data.missing.map((d) => <Chip key={d} tone="warning">{d}</Chip>)}</div> : <p>Every payday is in the ledger.</p>}
          </Container>
        </div>
      )}
      {data && (
        <div className="axp-exp__scroll"><DataGrid<Entry> id="expenses-paydays" label="Recent paydays" groups={recent} rowId={(r) => r.id} hidden={[]} dataset={false}
          columns={[
            { id: 'date', label: 'Date', width: W.date, render: (r) => r.date },
            { id: 'payer', label: 'Payer', width: W.main, fixed: true, render: (r) => r.merchant },
            { id: 'amount', label: 'Amount', width: W.amount, align: 'end', render: (r) => money(r.totalCents, r.currency) },
          ]}
          empty="No paydays in the ledger yet." /></div>
      )}
    </div>
  );
}

/* --------------------------------- reports -------------------------------- */

const PERIOD_KINDS = [{ value: 'month' as const, label: 'Month' }, { value: 'quarter' as const, label: 'Quarter' }, { value: 'year' as const, label: 'Year' }];

/** The report period on screen (also what `expenses.report` opens and `expenses.report.get` reads). */
export const reportState = { kind: 'month' as 'month' | 'quarter' | 'year', date: '' };

export function ReportsScreen() {
  const rt = useRuntime();
  const [kind, setKind] = useState(reportState.kind);
  const [date, setDate] = useState(reportState.date || todayIso());
  reportState.kind = kind; reportState.date = date;
  const { data, error, loading, reload } = useApi<StatementData>(rt, `statement?kind=${kind}&date=${date}&today=${todayIso()}`);
  const st = data?.statement;
  const periods = (data?.periods ?? []).map((p) => ({ value: p.from, label: p.label }));
  if (st && !periods.some((p) => p.value === st.period.from)) periods.unshift({ value: st.period.from, label: st.period.label });
  return (
    <div className="axp-exp" data-screen="expenses.reports">
      <Toolbar label="Reports">
        <Segmented label="Period" value={kind} options={PERIOD_KINDS} onChange={(v) => setKind(v)} />
        <SelectField label="Showing" value={st?.period.from ?? date} options={periods} onChange={setDate} />
        <Button icon="copy" tone="ghost" disabled={!data} onClick={() => rt.dispatch('expenses.report.copy')}>Copy as text</Button>
        <Button icon="refresh" tone="ghost" busy={loading} onClick={reload}>Refresh</Button>
      </Toolbar>
      {error && <Problem error={error} onRetry={reload} />}
      {st && (
        <>
          <div className="axp-exp__cards">
            <Container title="Spent" icon="chart"><p className="axp-exp__big">{money(st.total)}</p>
              {st.changePct !== null && <p>{st.changePct > 0 ? '+' : ''}{st.changePct}% on the period before</p>}</Container>
            <Container title="Income" icon="download"><p className="axp-exp__big">{money(st.income)}</p></Container>
            <Container title="Net" icon="layers"><p className="axp-exp__big">{money(st.net)}</p><p>Balance {money(st.opening)} → {money(st.closing)}</p></Container>
          </div>
          <Container title="By category" icon="grid">
            {st.categories.length ? st.categories.map((c) => (
              <div key={c.key} className="axp-exp__bar">
                <span>{c.label}</span><Meter value={c.share} label={`${c.label} ${c.share}%`} small /><span>{money(c.total)}</span>
              </div>
            )) : <p>No spending in this period.</p>}
          </Container>
          <Container title="Top merchants" icon="list" defaultOpen={false}>
            {st.merchants.map((m) => <div key={m.key} className="axp-exp__bar"><span>{m.label}</span><Meter value={m.share} label={`${m.label} ${m.share}%`} small /><span>{money(m.total)}</span></div>)}
          </Container>
          <p className="axp-exp__foot">{st.count} entries{st.unreconciled ? ` · ${st.unreconciled} unreconciled` : ''} · {st.period.from} to {st.period.to}</p>
        </>
      )}
    </div>
  );
}
