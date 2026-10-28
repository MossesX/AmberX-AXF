/**
 * The approvals log (decision 94): every request with about sixty named fields and its timeline, filtered, sorted and
 * paged by the hub (`/auth/api/approvals/log`). Tap a row for every field. The auto-approve windows are listed under
 * it, and the whole log downloads as JSON.
 */
import { useState } from 'react';
import { Button, Chip, Container, Note, SelectField, TextField, useRuntime } from '../axf/react';
import { relTime } from '../hub/core';
import { go } from '../hub/route';
import { HUB } from '../hub/useHub';
import { HubGate, useHubJson, when } from './hubPage';

type Cost = { model?: string; tokensIn?: number; tokensOut?: number; cacheRead?: number; usd?: number; checks?: number; note?: string; reportedAt: string; reports: number };
type Entry = Record<string, unknown> & { id: string; confirmationId: string; qualifiedTool: string; status: string; createdAt: string; summary: string; decidedBy?: string; decisionSeconds?: number; events?: { at: string; kind?: string; note?: string }[]; checks?: number; held?: boolean; cost?: Cost; vetoRunAt?: string };
/** Approval costs (axHub decision 103): checks counted by the hub, USD as sessions reported it. */
type CostSum = { approvals: number; checks: number; reported: number; usd: number; held: number };
interface LogPage {
  total: number; page: number; pages: number; tools: string[]; statuses: string[]; counts: Record<string, number>; entries: Entry[];
  costs?: { all: CostSum; days: (CostSum & { day: string })[]; tools: (CostSum & { tool: string })[] };
  windows: { id: string; minutes: number; by: string; openedAt?: string; until: string; closedAt?: string; closedBy?: string; approvedCount: number }[];
}

export function ApprovalLog() {
  return <HubGate admin what="the approvals log">{() => <Log />}</HubGate>;
}

function Log() {
  const rt = useRuntime();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [via, setVia] = useState('');
  const [tool, setTool] = useState('');
  const [sort, setSort] = useState('newest');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState('');
  const query = new URLSearchParams({ q, status, via, tool, sort, page: String(page) }).toString();
  const res = useHubJson<LogPage>(`/auth/api/approvals/log?${query}`);
  const d = res.data;
  const reset = (f: (v: string) => void) => (v: string) => { setPage(1); f(v); };

  return (
    <div className="fx-stack fx-stack--lg">
      <header className="fx-pagehead">
        <div>
          <p className="fx-eyebrow">Approvals</p>
          <h1>Log</h1>
          <p className="fx-muted">Every request the hub asked about, how it was decided and what happened after.{d ? ` ${d.total} shown.` : ''}</p>
        </div>
        <div className="fx-row fx-row--wrap">
          <Button icon="arrow-left" onClick={() => go(rt, 'home')}>Requests</Button>
          <Button icon="download" onClick={() => { location.href = `${HUB}/auth/admin/approvals/log.json`; }}>Download JSON</Button>
        </div>
      </header>

      <Container title="Find" icon="search">
        <div className="fx-stack">
          <TextField label="Search" type="search" value={q} onChange={reset(setQ)} placeholder="Tool, caller, command, who decided, id" />
          <div className="fx-row fx-row--wrap">
            <SelectField label="Status" value={status} onChange={reset(setStatus)} empty="Any"
              options={(d?.statuses ?? []).map((s) => ({ value: s, label: `${s}${d?.counts[s] ? ` (${d.counts[s]})` : ''}` }))} />
            <SelectField label="Decided" value={via} onChange={reset(setVia)} empty="Any way"
              options={[{ value: 'pending', label: 'Not decided' }, { value: 'web', label: 'On the web' }, { value: 'cli', label: 'In the terminal' }, { value: 'auto', label: 'Automatically' }, { value: 'other', label: 'Other' }]} />
            <SelectField label="Tool" value={tool} onChange={reset(setTool)} empty="Any tool" options={(d?.tools ?? []).map((t) => ({ value: t, label: t }))} />
            <SelectField label="Sort" value={sort} onChange={reset(setSort)}
              options={[{ value: 'newest', label: 'Newest first' }, { value: 'oldest', label: 'Oldest first' }, { value: 'tool', label: 'Tool' }, { value: 'status', label: 'Status' }, { value: 'wait', label: 'Longest wait' }, { value: 'cost', label: 'Highest cost' }, { value: 'checks', label: 'Most checks' }]} />
          </div>
        </div>
      </Container>

      {d?.costs && <Costs c={d.costs} />}

      {res.error && <Note tone="danger" icon="alert">{res.error}</Note>}
      {d && d.entries.length === 0 && <Note>Nothing matches.</Note>}
      {d && d.entries.map((e) => (
        <Container key={e.id} title={e.qualifiedTool} icon="list" actions={<>{e.vetoRunAt && <Chip tone="warning">Run unless blocked</Chip>}<Chip>{e.status}</Chip></>}>
          <div className="fx-stack">
            <p className="fx-mono">{e.summary.length > 200 ? `${e.summary.slice(0, 200)}…` : e.summary}</p>
            <p className="fx-muted">
              {when(e.createdAt)}{e.decidedBy ? ` · ${e.decidedBy}` : ''}{typeof e.decisionSeconds === 'number' ? ` · decided after ${Math.round(e.decisionSeconds)} s` : ''}
            </p>
            <p className="fx-small">
              <strong>Cost:</strong> {costLine(e)}
            </p>
            <div className="fx-row fx-row--wrap">
              <Button size="sm" icon={open === e.id ? 'chevron-up' : 'chevron-down'} onClick={() => setOpen(open === e.id ? '' : e.id)}>{open === e.id ? 'Less' : 'Every field'}</Button>
              <Button size="sm" tone="ghost" icon="chevron-right" onClick={() => go(rt, 'approval', { id: e.confirmationId })}>The request</Button>
            </div>
            {open === e.id && (
              <table className="fx-table">
                <tbody>
                  {Object.entries(e).filter(([k]) => k !== 'events').map(([k, v]) => (
                    <tr key={k}><th>{k}</th><td className="fx-mono">{typeof v === 'string' ? v : JSON.stringify(v)}</td></tr>
                  ))}
                  {(e.events ?? []).map((ev, i) => (
                    <tr key={`ev${i}`}><th>{when(ev.at)}</th><td>{[ev.kind, ev.note].filter(Boolean).join(' · ')}</td></tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </Container>
      ))}

      {d && d.pages > 1 && (
        <div className="fx-row fx-row--wrap">
          <Button size="sm" icon="chevron-left" disabled={d.page <= 1} onClick={() => setPage(d.page - 1)}>Previous</Button>
          <span className="fx-muted">Page {d.page} of {d.pages}</span>
          <Button size="sm" icon="chevron-right" disabled={d.page >= d.pages} onClick={() => setPage(d.page + 1)}>Next</Button>
        </div>
      )}

      {d && d.windows.length > 0 && (
        <Container title="Auto-approve windows" icon="clock" collapsible defaultOpen={false}>
          <table className="fx-table">
            <tbody>
              {d.windows.map((w) => (
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

const usd = (n: number) => `$${n < 1 ? n.toFixed(4) : n.toFixed(2)}`;
const tok = (n?: number) => (n === undefined ? '' : n >= 1000 ? `${Math.round(n / 100) / 10}k` : String(n));

/** One line: checks the hub counted, and what the session reported (axHub decision 103). */
function costLine(e: Entry): string {
  const checks = `${e.checks ?? 0} check${e.checks === 1 ? '' : 's'}${e.held ? ' (held: sent once)' : ''}`;
  const c = e.cost;
  if (!c) return `${checks} · not reported by the session`;
  const parts = [c.usd !== undefined ? usd(c.usd) : '', c.model ?? '', c.tokensIn !== undefined ? `${tok(c.tokensIn)} in` : '', c.tokensOut !== undefined ? `${tok(c.tokensOut)} out` : '', c.cacheRead !== undefined ? `${tok(c.cacheRead)} cached` : ''].filter(Boolean);
  return `${checks} · ${parts.join(' · ') || 'reported'}${c.note ? ` · ${c.note}` : ''}`;
}

function Costs({ c }: { c: NonNullable<LogPage['costs']> }) {
  const a = c.all;
  return (
    <Container title="What approvals cost" icon="chart" collapsible defaultOpen>
      <div className="fx-stack">
        <p style={{ margin: 0 }}>
          <strong>{usd(a.usd)}</strong> reported over {a.reported} of {a.approvals} approvals · <strong>{a.checks}</strong> checks · {a.held} held (sent once, no checking)
        </p>
        <p className="fx-small fx-muted" style={{ margin: 0 }}>Checks are counted by the hub (re-sends while waiting and reads of a held call’s result). Dollars are what sessions reported with axhub.approval_cost; the hub never guesses a price. Totals follow the filters above.</p>
        {c.days.length > 0 && (
          <table className="fx-table">
            <thead><tr><th>Day</th><th>Approvals</th><th>Checks</th><th>Reported</th></tr></thead>
            <tbody>{c.days.map((x) => <tr key={x.day}><td>{x.day}</td><td>{x.approvals}</td><td>{x.checks}</td><td>{x.reported ? usd(x.usd) : '–'}</td></tr>)}</tbody>
          </table>
        )}
        {c.tools.length > 0 && (
          <table className="fx-table">
            <thead><tr><th>Tool</th><th>Approvals</th><th>Checks</th><th>Reported</th></tr></thead>
            <tbody>{c.tools.map((x) => <tr key={x.tool}><td className="fx-mono">{x.tool}</td><td>{x.approvals}</td><td>{x.checks}</td><td>{x.reported ? usd(x.usd) : '–'}</td></tr>)}</tbody>
          </table>
        )}
      </div>
    </Container>
  );
}
