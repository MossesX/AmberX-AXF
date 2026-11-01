/**
 * The approvals log (decision #94): every request with about sixty named fields and its timeline, filtered, sorted and
 * paged by the hub (`/auth/api/approvals/log`). Tap a row for every field. The auto-approve windows are listed under
 * it, and the whole log downloads as JSON. Calls that ran without an approval (decision #110, e.g. vps.build_*) have no
 * request page, so their tool, arguments, who ran it, when and the result show right on the row instead.
 */
import { useState } from 'react';
import { Button, Chip, Container, Note, SelectField, TextField, useRuntime } from '../axf/react';
import { directRunRows, ranWithoutApproval, relTime } from '../hub/core';
import { go } from '../hub/route';
import { HUB } from '../hub/useHub';
import { HubGate, useHubJson, when } from './hubPage';

type Entry = Record<string, unknown> & { id: string; confirmationId: string; qualifiedTool: string; status: string; createdAt: string; summary: string; decidedBy?: string; decisionSeconds?: number; events?: { at: string; kind?: string; note?: string }[] };
interface LogPage {
  total: number; page: number; pages: number; tools: string[]; statuses: string[]; counts: Record<string, number>; entries: Entry[];
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
              options={[{ value: 'newest', label: 'Newest first' }, { value: 'oldest', label: 'Oldest first' }, { value: 'tool', label: 'Tool' }, { value: 'status', label: 'Status' }, { value: 'wait', label: 'Longest wait' }]} />
          </div>
        </div>
      </Container>

      {res.error && <Note tone="danger" icon="alert">{res.error}</Note>}
      {d && d.entries.length === 0 && <Note>Nothing matches.</Note>}
      {d && d.entries.map((e) => {
        const direct = ranWithoutApproval(e);
        return (
        <Container key={e.id} title={e.qualifiedTool} icon="list" actions={<Chip>{e.status}</Chip>}>
          <div className="fx-stack">
            {direct ? (
              <table className="fx-table" data-axf-log-direct="">
                <tbody>
                  {directRunRows(e).map((r) => (
                    <tr key={r.key}><th>{r.label}</th><td className={r.mono ? 'fx-mono' : undefined}>{r.time ? when(r.value) : r.value}</td></tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <>
                <p className="fx-mono">{e.summary.length > 200 ? `${e.summary.slice(0, 200)}…` : e.summary}</p>
                <p className="fx-muted">
                  {when(e.createdAt)}{e.decidedBy ? ` · ${e.decidedBy}` : ''}{typeof e.decisionSeconds === 'number' ? ` · decided after ${Math.round(e.decisionSeconds)} s` : ''}
                </p>
              </>
            )}
            <div className="fx-row fx-row--wrap">
              <Button size="sm" icon={open === e.id ? 'chevron-up' : 'chevron-down'} onClick={() => setOpen(open === e.id ? '' : e.id)}>{open === e.id ? 'Less' : 'Every field'}</Button>
              {!direct && e.confirmationId && <Button size="sm" tone="ghost" icon="chevron-right" onClick={() => go(rt, 'approval', { id: e.confirmationId })}>The request</Button>}
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
        );
      })}

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
