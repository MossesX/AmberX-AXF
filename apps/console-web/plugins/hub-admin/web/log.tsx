/**
 * Hub → Approval log (hub-console@1 screen `log`): every request the hub asked about, how it was decided and what
 * happened after, as a framework DataGrid. The hub filters, sorts and pages (`q`, status, decided-via, tool, sort, pass,
 * page: approval-log@1); the service and who filters narrow the page in the browser (a service is a tool's namespace).
 * Filters are remembered in the registered setting `axf.hub.log.filters`. A row opens to every field and its timeline;
 * "The request" jumps to the Approvals screen on that row (hub.open:approvals:<id>).
 */
import { useEffect, useMemo, useState } from 'react';
import { Button, Chip, Container, Note, SelectField, TextField, useRuntime } from '@console/axf/react';
import { DataGrid, type GridColumn, type GridGroup, type GridSort } from '@console/axf/libs/datagrid';
import type { HubScreen } from '@console/axf/core/hub-console.mjs';
import { relTime, useHubRead, UNAVAILABLE_WORDS, when } from './data';
import { UnavailableNote } from './approvals';

export type LogEntry = Record<string, unknown> & {
  id: string; confirmationId?: string; qualifiedTool: string; status: string; createdAt: string; summary?: string; decidedBy?: string; decisionSeconds?: number;
  via?: string; ranBy?: string; passId?: string; events?: { at: string; kind?: string; note?: string }[]; source?: { kind?: string; label?: string; who?: string };
};
export interface LogPage {
  total: number; page: number; pages: number; tools: string[]; statuses: string[]; counts: Record<string, number>; entries: LogEntry[]; underPass?: number;
  windows: { id: string; minutes: number; by: string; openedAt?: string; until: string; closedAt?: string; closedBy?: string; approvedCount: number }[];
}

export const LOG_GRID = 'hub.log';
const FILTERS_KEY = 'axf.hub.log.filters';
const VIA_OPTIONS = [{ value: 'pending', label: 'Not decided' }, { value: 'web', label: 'On the web' }, { value: 'cli', label: 'In the terminal' }, { value: 'auto', label: 'Automatically' }, { value: 'other', label: 'Other' }];
const SORT_OPTIONS = [{ value: 'newest', label: 'Newest first' }, { value: 'oldest', label: 'Oldest first' }, { value: 'tool', label: 'Tool' }, { value: 'status', label: 'Status' }, { value: 'wait', label: 'Longest wait' }];
const OUTCOME_TONE: Record<string, 'accent' | 'success' | 'warning' | 'danger' | undefined> = {
  pending: 'accent', held: 'warning', running: 'accent', ran: 'success', approved: 'success', consumed: 'success', used: 'success', failed: 'danger', declined: 'danger', denied: 'danger', rejected: 'danger', revoked: 'danger', expired: undefined, ignored: undefined, postponed: 'warning',
};

interface Filters { q: string; status: string; via: string; tool: string; sort: string; pass: string; service: string; who: string }
const DEFAULTS: Filters = { q: '', status: '', via: '', tool: '', sort: 'newest', pass: '', service: '', who: '' };
const serviceOf = (tool: string) => (tool.includes('.') ? tool.split('.')[0]! : tool);
const whoOf = (e: LogEntry) => e.decidedBy || e.ranBy || e.source?.who || '';

function readFilters(raw: unknown): Filters {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const f: Filters = { ...DEFAULTS };
  for (const k of Object.keys(DEFAULTS) as (keyof Filters)[]) if (typeof o[k] === 'string') f[k] = (o[k] as string).slice(0, 200);
  if (!SORT_OPTIONS.some((s) => s.value === f.sort)) f.sort = 'newest';
  return f;
}

export function LogScreen(_props: { screen: HubScreen }) {
  const rt = useRuntime();
  const [f, setF] = useState<Filters>(() => readFilters(rt.settings.get(FILTERS_KEY)));
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<GridSort>(null);
  const [hidden, setHidden] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<string[]>([]);
  useEffect(() => { rt.settings.set(FILTERS_KEY, { q: f.q, status: f.status, via: f.via, tool: f.tool, sort: f.sort } as never); }, [rt, f.q, f.status, f.via, f.tool, f.sort]);
  const set = (k: keyof Filters) => (v: string) => { setPage(1); setF((cur) => ({ ...cur, [k]: v, ...(k === 'service' && v && cur.tool && serviceOf(cur.tool) !== v ? { tool: '' } : {}) })); };

  const { data, stale, reload } = useHubRead<LogPage>('log', { q: f.q, status: f.status, via: f.via, tool: f.tool, sort: f.sort, pass: f.pass, page }, 30000);
  const g = data && data.ok ? data : null;
  const services = useMemo(() => [...new Set((g?.tools ?? []).map(serviceOf))].sort(), [g]);
  const tools = useMemo(() => (g?.tools ?? []).filter((t) => !f.service || serviceOf(t) === f.service), [g, f.service]);
  const whos = useMemo(() => [...new Set((g?.entries ?? []).map(whoOf).filter(Boolean))].sort(), [g]);
  const rows = useMemo(() => (g?.entries ?? []).filter((e) => (!f.service || serviceOf(e.qualifiedTool) === f.service) && (!f.who || whoOf(e) === f.who)), [g, f.service, f.who]);

  const columns: GridColumn<LogEntry>[] = [
    { id: 'when', label: 'When', width: 'minmax(max-content, 1fr)', sortable: true, sortValue: (r) => Date.parse(r.createdAt) || 0, render: (r) => <span className="fx-muted" title={when(r.createdAt)}>{relTime(r.createdAt)}</span> },
    { id: 'tool', label: 'Tool', width: 'minmax(max-content, 1.2fr)', sortable: true, sortValue: (r) => r.qualifiedTool, render: (r) => <Chip>{r.qualifiedTool}</Chip> },
    { id: 'what', label: 'What', width: 'minmax(calc(var(--fx-space) * 14), 4fr)', fixed: true, sortable: true, sortValue: (r) => String(r.summary ?? ''), render: (r) => <span className="axp-hub-admin-what__title" title={String(r.title ?? r.summary ?? '')}>{String(r.title ?? '') || String(r.summary ?? '').slice(0, 200) || r.qualifiedTool}</span> },
    { id: 'who', label: 'Who', width: 'minmax(calc(var(--fx-space) * 8), 1.2fr)', sortable: true, sortValue: whoOf, render: (r) => <span className="axp-hub-admin-who">{whoOf(r) || '—'}</span> },
    { id: 'outcome', label: 'Outcome', width: 'minmax(max-content, 1fr)', sortable: true, sortValue: (r) => r.status, render: (r) => <span className="fx-row"><Chip tone={OUTCOME_TONE[r.status]}>{r.status}</Chip>{r.via ? <span className="fx-muted fx-small">{String(r.via)}</span> : null}</span> },
    { id: 'took', label: 'Decided after', width: 'minmax(max-content, 1fr)', align: 'end', sortable: true, sortValue: (r) => (typeof r.decisionSeconds === 'number' ? r.decisionSeconds : -1), render: (r) => <span className="fx-muted">{typeof r.decisionSeconds === 'number' ? `${Math.round(r.decisionSeconds)} s` : '—'}</span> },
  ];
  const groups: GridGroup<LogEntry>[] = [{ id: 'log', title: g ? `${rows.length} of ${g.total} shown` : 'Log', icon: 'list', rows, groups: [], fixed: true }];

  return (
    <div className="fx-stack fx-stack--lg" data-axf-hub-screen="log">
      <header className="fx-pagehead">
        <div>
          <p className="fx-eyebrow">axHub · approvals</p>
          <h1>Approval log</h1>
          <p className="fx-muted">Every request the hub asked about, how it was decided and what happened after.{g ? ` ${g.total} on the hub${g.underPass ? `, ${g.underPass} ran under a pass` : ''}.` : ''}</p>
        </div>
        <div className="fx-row fx-row--wrap">
          <Button icon="refresh" onClick={() => void reload()}>Check now</Button>
          <Button icon="shield" onClick={() => rt.dispatch('hub.open:approvals')}>Requests</Button>
          {g && <Button icon="download" onClick={() => window.open(`${g.hub}/auth/admin/approvals/log.json`, '_blank', 'noopener,noreferrer')}>Download JSON</Button>}
        </div>
      </header>

      {data && !data.ok && <UnavailableNote r={data} />}
      {stale && <Note tone="warning">The last read failed ({UNAVAILABLE_WORDS[stale.code] ?? stale.message}); showing the previous answer.</Note>}

      <Container title="Find" icon="search" collapsible defaultOpen>
        <div className="fx-stack">
          <TextField label="Search" type="search" value={f.q} onChange={set('q')} placeholder="Tool, caller, command, who decided, id" />
          <div className="fx-row fx-row--wrap">
            <SelectField label="Service" value={f.service} onChange={set('service')} empty="Any service" options={services.map((s) => ({ value: s, label: s }))} />
            <SelectField label="Tool" value={f.tool} onChange={set('tool')} empty="Any tool" options={tools.map((t) => ({ value: t, label: t }))} />
            <SelectField label="Who" value={f.who} onChange={set('who')} empty="Anyone" options={whos.map((w) => ({ value: w, label: w }))} />
            <SelectField label="Outcome" value={f.status} onChange={set('status')} empty="Any outcome" options={(g?.statuses ?? []).map((s) => ({ value: s, label: `${s}${g?.counts[s] ? ` (${g.counts[s]})` : ''}` }))} />
            <SelectField label="Decided" value={f.via} onChange={set('via')} empty="Any way" options={VIA_OPTIONS} />
            <SelectField label="Pass" value={f.pass === '' || f.pass === 'any' ? f.pass : 'one'} onChange={(v) => { setPage(1); setF((cur) => ({ ...cur, pass: v === 'one' ? cur.pass : v })); }} empty="With or without"
              options={[{ value: 'any', label: `Ran under a pass${g?.underPass ? ` (${g.underPass})` : ''}` }, ...(f.pass && f.pass !== 'any' ? [{ value: 'one', label: `Pass ${f.pass.slice(0, 8)}…` }] : [])]} />
            <SelectField label="Sort" value={f.sort} onChange={set('sort')} options={SORT_OPTIONS} />
          </div>
          {(f.q || f.service || f.tool || f.who || f.status || f.via || f.pass) && <div className="fx-row"><Button size="sm" tone="ghost" icon="x" onClick={() => { setPage(1); setF({ ...DEFAULTS, sort: f.sort }); }}>Clear filters</Button></div>}
        </div>
      </Container>

      {!data && <p className="fx-muted">Reading the hub…</p>}
      {g && rows.length === 0 && <Note>Nothing matches.</Note>}
      {g && rows.length > 0 && (
        <DataGrid<LogEntry>
          id={LOG_GRID}
          label="Approval log"
          groups={groups}
          columns={columns}
          rowId={(r) => r.id}
          rowLabel={(r) => `${r.qualifiedTool} ${whoOf(r)} ${r.status}`}
          hidden={hidden}
          onToggleColumn={(c, show) => setHidden((h) => (show ?? h.includes(c) ? h.filter((x) => x !== c) : [...h, c]))}
          onShowAll={() => setHidden([])}
          sort={sort}
          onSort={(c) => setSort((s0) => (c === null ? null : s0 && s0.col === c ? (s0.dir === 1 ? { col: c, dir: -1 } : null) : { col: c, dir: 1 }))}
          expanded={expanded}
          onToggleExpand={(id) => setExpanded((e) => (e.includes(id) ? e.filter((x) => x !== id) : [...e, id]))}
          onRowClick={(r, e) => { if (!(e.target as Element).closest?.('button, a, input, select, textarea')) setExpanded((x) => (x.includes(r.id) ? x.filter((y) => y !== r.id) : [...x, r.id])); }}
          renderDetail={(r) => <EntryDetail entry={r} />}
          rowTone={(r) => OUTCOME_TONE[r.status] ?? 'muted'}
          empty="Nothing matches."
        />
      )}

      {g && g.pages > 1 && (
        <div className="fx-row fx-row--wrap">
          <Button size="sm" icon="chevron-left" disabled={g.page <= 1} onClick={() => setPage(g.page - 1)}>Previous</Button>
          <span className="fx-muted">Page {g.page} of {g.pages}</span>
          <Button size="sm" icon="chevron-right" disabled={g.page >= g.pages} onClick={() => setPage(g.page + 1)}>Next</Button>
        </div>
      )}

      {g && g.windows.length > 0 && (
        <Container title="Auto-approve windows" icon="clock" collapsible defaultOpen={false}>
          <table className="fx-table">
            <tbody>
              {g.windows.map((w) => (
                <tr key={w.id}>
                  <th>{w.openedAt ? when(w.openedAt) : w.id}</th>
                  <td>{w.minutes} min by {w.by} · {w.approvedCount} approved · {w.closedAt ? `stopped ${relTime(w.closedAt)}${w.closedBy ? ` by ${w.closedBy}` : ''}` : `until ${when(w.until)}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Container>
      )}
    </div>
  );
}

/** Every field of one entry and its timeline. */
function EntryDetail({ entry: e }: { entry: LogEntry }) {
  const rt = useRuntime();
  const fields = Object.entries(e).filter(([k, v]) => k !== 'events' && v !== null && v !== undefined && v !== '');
  return (
    <div className="fx-stack axp-hub-admin-detail">
      {e.summary ? <p className="fx-mono">{String(e.summary).length > 400 ? `${String(e.summary).slice(0, 400)}…` : String(e.summary)}</p> : null}
      <table className="fx-table">
        <tbody>
          {fields.map(([k, v]) => <tr key={k}><th>{k}</th><td className="fx-mono">{typeof v === 'string' ? v : JSON.stringify(v)}</td></tr>)}
          {(e.events ?? []).map((ev, i) => <tr key={`ev${i}`}><th>{when(ev.at)}</th><td>{[ev.kind, ev.note].filter(Boolean).join(' · ')}</td></tr>)}
        </tbody>
      </table>
      {e.confirmationId ? <div className="fx-row"><Button size="sm" tone="ghost" icon="chevron-right" onClick={() => rt.dispatch(`hub.open:approvals:${e.confirmationId}`)}>The request</Button></div> : null}
    </div>
  );
}
