/**
 * Token log viewer (token-turn@1, framework/cli/token-log.mjs): per session, account, build and model, the top token
 * eaters, filters and daily totals. Chat and voice rows are estimates and say so. Reads through the plugin's server.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Container, Note, SelectField, TabGroup, TextField } from '@console/axf/react';
import { DataGrid, type GridColumn } from '@console/axf/libs/datagrid';
import { pluginFetch } from '@console/plugins';

const FOLDER = 'claude-settings';
interface Row { key: string; turns: number; tokens: number; input: number; output: number; cacheRead: number; cacheWrite: number; costUsd: number; rulesReads: number; estimated: number }
interface Turn { id: string; at: string; session: string; name: string; account: string; model: string; build: string; step: string; source: string; estimated: boolean; input: number; output: number; cacheRead: number; cacheWrite: number; costUsd: number | null; rulesReads: string[]; turn: number }
interface Log {
  ok: boolean; message?: string; count: number; totals: Row; byDay: Row[]; bySession: Row[]; byAccount: Row[]; byBuild: Row[]; byModel: Row[];
  top: { sessions: Row[]; builds: Row[]; turns: Turn[] }; rows: Turn[]; options: Record<string, string[]>;
}
const W = (n: number) => `calc(var(--fx-space) * ${n * 3})`;
export const usd = (n: number | null | undefined) => (n == null ? '—' : `$${n < 10 ? n.toFixed(2) : n.toFixed(0)}`);
export const compact = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n));
const FILTERS: { key: string; label: string }[] = [{ key: 'session', label: 'Session' }, { key: 'account', label: 'Account' }, { key: 'build', label: 'Build' }, { key: 'model', label: 'Model' }, { key: 'source', label: 'Source' }];
const GROUPS = [{ id: 'bySession', label: 'Sessions' }, { id: 'byBuild', label: 'Builds' }, { id: 'byAccount', label: 'Accounts' }, { id: 'byModel', label: 'Models' }, { id: 'turns', label: 'Turns' }] as const;
type GroupId = (typeof GROUPS)[number]['id'];
const daysAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

function Stat({ label, value }: { label: string; value: string }) {
  return <div className="axp-cs-tl__stat"><b>{value}</b><span>{label}</span></div>;
}

/** Daily cost: one series, so no legend; each bar's value is on its tooltip and the Daily totals table has every number. */
function DailyBars({ days }: { days: Row[] }) {
  const max = Math.max(...days.map((d) => d.costUsd), 0.0001);
  return (
    <div className="axp-cs-tl__bars" role="img" aria-label={`Cost per day, ${days.length} days`}>
      {days.map((d) => <div key={d.key} className="axp-cs-tl__bar" title={`${d.key}: ${usd(d.costUsd)}, ${compact(d.tokens)} tokens`}><i style={{ height: `${(d.costUsd / max) * 100}%` }} /></div>)}
    </div>
  );
}

function RowGrid({ id, label, rows, first }: { id: string; label: string; rows: Row[]; first: string }) {
  const columns: GridColumn<Row>[] = [
    { id: 'key', label: first, width: `minmax(${W(12)}, 3fr)`, fixed: true, render: (r) => r.key },
    { id: 'cost', label: 'Cost', width: W(5), align: 'end', render: (r) => `${usd(r.costUsd)}${r.estimated ? ' est.' : ''}` },
    { id: 'tokens', label: 'Tokens', width: W(6), align: 'end', render: (r) => compact(r.tokens) },
    { id: 'turns', label: 'Turns', width: W(4), align: 'end', render: (r) => r.turns },
    { id: 'rules', label: 'Rules reads', width: W(5), align: 'end', render: (r) => r.rulesReads },
  ];
  return <div className="axp-cs-tl__scroll"><DataGrid<Row> id={id} label={label} compact dataset={false} hidden={[]} groups={[{ id: 'all', title: label, icon: 'chart', rows, groups: [], fixed: true }]} columns={columns} rowId={(r) => r.key} rowLabel={(r) => r.key} empty="Nothing logged yet." /></div>;
}

function TurnGrid({ id, label, rows }: { id: string; label: string; rows: Turn[] }) {
  const columns: GridColumn<Turn>[] = [
    { id: 'at', label: 'When', width: W(9), fixed: true, render: (r) => new Date(r.at).toLocaleString() },
    { id: 'who', label: 'Session', width: `minmax(${W(10)}, 2fr)`, render: (r) => r.name || r.session },
    { id: 'build', label: 'Build / step', width: W(10), render: (r) => [r.build, r.step].filter(Boolean).join(' · ') || '—' },
    { id: 'in', label: 'In', width: W(4), align: 'end', render: (r) => compact(r.input) },
    { id: 'out', label: 'Out', width: W(4), align: 'end', render: (r) => compact(r.output) },
    { id: 'cr', label: 'Cache read', width: W(5), align: 'end', render: (r) => compact(r.cacheRead) },
    { id: 'cw', label: 'Cache write', width: W(5), align: 'end', render: (r) => compact(r.cacheWrite) },
    { id: 'cost', label: 'Cost', width: W(5), align: 'end', render: (r) => `${usd(r.costUsd)}${r.estimated ? ' est.' : ''}` },
    { id: 'rules', label: 'Rules read', width: W(9), render: (r) => r.rulesReads?.join(', ') || '—' },
  ];
  return <div className="axp-cs-tl__scroll"><DataGrid<Turn> id={id} label={label} compact dataset={false} hidden={[]} groups={[{ id: 'all', title: label, icon: 'chart', rows, groups: [], fixed: true }]} columns={columns} rowId={(r) => r.id} rowLabel={(r) => r.id} empty="Nothing logged yet." /></div>;
}

export function TokenLogPanel() {
  const [filters, setFilters] = useState<Record<string, string>>({ from: daysAgo(7) });
  const [log, setLog] = useState<Log | null>(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<GroupId>('bySession');
  const query = useMemo(() => new URLSearchParams(Object.entries(filters).filter(([, v]) => v)).toString(), [filters]);
  const load = useCallback(() => {
    pluginFetch(FOLDER, `token-log?${query}`).then(async (r) => {
      const j = (await r.json()) as Log;
      if (!r.ok || !j.ok) throw new Error(j.message || `HTTP ${r.status}`);
      setLog(j); setError('');
    }).catch((e: Error) => setError(e.message));
  }, [query]);
  useEffect(load, [load]);
  const set = (k: string, v: string) => setFilters((f) => ({ ...f, [k]: v }));
  const t = log?.totals;
  return (
    <div className="fx-stack axp-cs-tl" data-testid="token-log">
      <p className="axp-cs-group__desc">Every turn of every session, read from transcripts by plain code on the VPS, so logging costs no tokens. Chat and voice turns are estimates from their text and are marked est.</p>
      {error && <Note tone="danger">Token log unavailable: {error}</Note>}
      <div className="axp-cs-tl__filters">
        <TextField label="From" type="date" value={filters.from ?? ''} onChange={(v) => set('from', v)} />
        <TextField label="To" type="date" value={filters.to ?? ''} onChange={(v) => set('to', v)} />
        {FILTERS.map((f) => <SelectField key={f.key} label={f.label} value={filters[f.key] ?? ''} options={[{ value: '', label: 'All' }, ...(log?.options[f.key] ?? []).map((v) => ({ value: v, label: v }))]} onChange={(v) => set(f.key, v)} />)}
        <SelectField label="Real or estimated" value={filters.estimated ?? ''} options={[{ value: '', label: 'Both' }, { value: 'no', label: 'Real counts' }, { value: 'yes', label: 'Estimates' }]} onChange={(v) => set('estimated', v)} />
      </div>
      {t && (
        <div className="axp-cs-tl__stats">
          <Stat label="Cost" value={usd(t.costUsd)} /><Stat label="Tokens" value={compact(t.tokens)} /><Stat label="Turns" value={String(t.turns)} /><Stat label="CLAUDE.md and rules reads" value={String(t.rulesReads)} />
        </div>
      )}
      {log && log.byDay.length > 0 && <Container title="Daily totals" icon="chart"><div className="fx-stack"><DailyBars days={log.byDay} /><RowGrid id="claude-token-days" label="Daily totals" rows={[...log.byDay].reverse()} first="Day" /></div></Container>}
      {log && (
        <Container title="Top token eaters" icon="zap">
          <div className="fx-stack">
            {log.top.builds.length > 0 && <RowGrid id="claude-token-top-builds" label="Top builds" rows={log.top.builds} first="Build" />}
            <RowGrid id="claude-token-top-sessions" label="Top sessions" rows={log.top.sessions} first="Session" />
            <TurnGrid id="claude-token-top-turns" label="Biggest turns" rows={log.top.turns} />
          </div>
        </Container>
      )}
      {log && (
        <div className="fx-stack">
          <TabGroup<GroupId> id="claude-settings.token-log" label="Group by" tabs={GROUPS.map((g) => ({ value: g.id, label: g.label }))} value={tab} onChange={setTab} />
          {tab === 'turns' ? <TurnGrid id="claude-token-turns" label="Turns" rows={log.rows} /> : <RowGrid id={`claude-token-${tab}`} label={GROUPS.find((g) => g.id === tab)?.label ?? ''} rows={log[tab]} first={GROUPS.find((g) => g.id === tab)?.label ?? ''} />}
          {log.count > log.rows.length && <p className="axp-cs-row__when">Showing the latest {log.rows.length} of {log.count} turns. Totals count all of them.</p>}
        </div>
      )}
      <div><Button size="sm" tone="ghost" icon="refresh" onClick={load}>Refresh</Button></div>
    </div>
  );
}
