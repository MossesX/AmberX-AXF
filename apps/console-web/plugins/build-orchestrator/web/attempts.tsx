/**
 * done-means-merged@1 in the build views (framework/spec/DONE-MEANS-MERGED.md; build server-rule-done-means-merged-working).
 * Brett, Nov 17 2026: "Why should we say build it and then it fails and you don't say anything and we find out days later?"
 *
 *   StatusChip     the real status of a build: building, fixing, landing, landed, complete, escalated (and the waits),
 *                  with the open failure / the evidence in its title
 *   BuildDetail    the expanded row's TabGroup (asset tab-group, id build-orchestrator.build): Steps | Attempts
 *   AttemptsPanel  every attempt (strategy, model, account, result), the open failure, what the ladder tries next,
 *                  the escalation, the merge + verify evidence, and Retry (POST retry/<build>; also REST, MCP, CLI, voice)
 *
 * Tokens and framework controls only (Chip, Button, Note, TabGroup, DataGrid). Control@1 targets: the TabGroup registers
 * tab:build-orchestrator.build=steps|attempts; the Retry button carries data-axf-target button:retry-<build>.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { Button, Chip, Icon, Note, TabGroup } from '@console/axf/react';
import { DataGrid, type GridColumn } from '@console/axf/libs/datagrid';

export type Attempt = { n: number; kind: string; strategy: string; fixStrategy: string; model: string; account: string; session: string; step: string; head: string; pr: number; startedAt: string; endedAt: string; result: string; log: string; note: string; source: string };
export type Failure = { kind: string; at: string; why: string; head: string; step: string; exit: number | null } | null;
export type Landed = { pr: number; sha: string; mergedAt: string; ci: string; ciAt: string; ciRun: string; verifiedAt: string; verifyHow: string; verifyLog: string } | null;
export type Escalation = { at: string; kind: string; attempts: number; why: string; head: string; tried: string[]; bannerId: string; pushedAt: string } | null;
export type Next = { strategy: string; fixStrategy: string; model: string; account: string; notBefore: string; inFlight: boolean; reason: string } | null;
export type AttemptsData = { attempts?: Attempt[]; failure?: Failure; landed?: Landed; escalation?: Escalation; ladder?: string[]; next?: Next };

type Tone = 'accent' | 'success' | 'warning' | 'danger' | undefined;
/** Status → the chip's word and tone. `running` reads as building; `built` is the legacy word for landed. */
export const STATUS_CHIP: Record<string, { label: string; tone: Tone }> = {
  pending: { label: 'pending', tone: undefined }, queued: { label: 'queued', tone: undefined },
  running: { label: 'building', tone: 'accent' }, waiting: { label: 'needs you', tone: 'warning' },
  fixing: { label: 'fixing', tone: 'warning' }, landing: { label: 'landing', tone: 'accent' },
  landed: { label: 'landed', tone: 'success' }, built: { label: 'landed', tone: 'success' }, complete: { label: 'complete', tone: 'success' },
  escalated: { label: 'failed', tone: 'danger' }, failed: { label: 'failed', tone: 'danger' }, blocked: { label: 'blocked', tone: 'warning' }, archived: { label: 'archived', tone: undefined },
};
const KIND: Record<string, string> = { crash: 'crashed', 'ci-red': 'CI red', clash: 'clash with main', 'push-fail': 'push failed', stalled: 'stalled', 'fell-to-pending': 'fell to Pending', land: 'landing try' };
const RESULT_TONE: Record<string, Tone> = { ok: 'success', failed: 'danger', timeout: 'danger', started: 'accent', skipped: undefined };
const ago = (iso: string) => { const t = Date.parse(iso || ''); if (!Number.isFinite(t)) return ''; const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };
const rung = (s: string, f: string) => (s === 'fix' && f ? `fix: ${f}` : s);

/** Why the build is in its status, one line (the chip's title). */
export function statusWhy(status: string, d: AttemptsData): string {
  if (status === 'fixing' && d.failure) return `Fixing: ${KIND[d.failure.kind] ?? d.failure.kind}${d.failure.step ? ` on ${d.failure.step}` : ''} (${d.failure.why}) since ${ago(d.failure.at)}`;
  if (status === 'escalated' && d.escalation) return `Failed ${ago(d.escalation.at)}, every option used up: ${d.escalation.why}`;
  if (status === 'landing') return 'Every step done: the auto-lander merges main in, waits for CI and lands it';
  if ((status === 'landed' || status === 'built') && d.landed) return `Merged ${ago(d.landed.mergedAt)}; CI on main ${d.landed.ci}${d.landed.verifiedAt ? '' : '; waiting for its verify'}`;
  if (status === 'complete' && d.landed) return `Merged, CI green on main and verified (${d.landed.verifyHow}) ${ago(d.landed.verifiedAt)}`;
  return '';
}

export function StatusChip({ status, data = {}, held = false }: { status: string; data?: AttemptsData; held?: boolean }) {
  if (held) return <Chip tone="warning">on hold</Chip>;
  const c = STATUS_CHIP[status] ?? { label: status, tone: undefined };
  const why = statusWhy(status, data);
  return <span title={why || c.label} data-status={status}><Chip tone={c.tone}>{c.label}</Chip></span>;
}

/** Steps | Attempts for one expanded build (the TabGroup asset; the tab is kept per build for the session). */
const TAB: Record<string, 'steps' | 'attempts'> = {};
const ATTEMPTS_EVENT = 'axf:orchestrator-attempts';
/** Open a build's Attempts tab (row:<build>/tab:attempts, build-orchestrator.attempts:<build>): kept for its next mount too. */
export function showAttempts(id: string): void { TAB[id] = 'attempts'; window.dispatchEvent(new CustomEvent(ATTEMPTS_EVENT, { detail: id })); }
export function BuildDetail({ id, data, steps, onRetry, busy, initial }: { id: string; data: AttemptsData; steps: ReactNode; onRetry: (strategy: string) => void; busy: boolean; initial?: 'steps' | 'attempts' }) {
  const n = data.attempts?.length ?? 0;
  const [tab, setTabState] = useState<'steps' | 'attempts'>(() => TAB[id] ?? initial ?? (data.failure || data.escalation ? 'attempts' : 'steps'));
  const setTab = (t: 'steps' | 'attempts') => { TAB[id] = t; setTabState(t); };
  useEffect(() => {
    const on = (e: Event) => { if ((e as CustomEvent<string>).detail === id) setTabState('attempts'); };
    window.addEventListener(ATTEMPTS_EVENT, on);
    return () => window.removeEventListener(ATTEMPTS_EVENT, on);
  }, [id]);
  return (
    <div className="fx-stack" data-axf-build-detail={id}>
      <TabGroup<'steps' | 'attempts'> id="build-orchestrator.build" label={`${id} details`} value={tab} onChange={setTab}
        tabs={[{ value: 'steps', label: 'Steps', icon: 'check-circle' }, { value: 'attempts', label: 'Attempts', icon: 'refresh', badge: n || undefined }]} />
      {tab === 'steps' ? steps : <AttemptsPanel id={id} data={data} onRetry={onRetry} busy={busy} />}
    </div>
  );
}

export function AttemptsPanel({ id, data, onRetry, busy }: { id: string; data: AttemptsData; onRetry: (strategy: string) => void; busy: boolean }) {
  const list = [...(data.attempts ?? [])].reverse();
  const f = data.failure; const e = data.escalation; const l = data.landed; const nx = data.next;
  const cols: GridColumn<Attempt>[] = [
    { id: 'n', label: '#', width: 'calc(var(--fx-font-size) * 2.5)', align: 'end', render: (a) => <span className="fx-mono fx-small">{a.n}</span> },
    { id: 'kind', label: 'Failure', width: 'calc(var(--fx-font-size) * 8)', render: (a) => <span className="fx-small">{KIND[a.kind] ?? a.kind}{a.step ? ` · ${a.step}` : ''}</span> },
    { id: 'strategy', label: 'Strategy', width: 'calc(var(--fx-font-size) * 8)', render: (a) => <span className="fx-small">{rung(a.strategy, a.fixStrategy)}</span> },
    { id: 'model', label: 'Model', width: 'calc(var(--fx-font-size) * 5)', render: (a) => (a.model ? <span className={`oc-model is-${a.model.toLowerCase()}`}>{a.model}</span> : <span className="fx-muted">—</span>) },
    { id: 'account', label: 'Account', width: 'calc(var(--fx-font-size) * 7)', render: (a) => <span className="fx-small" title={a.session || a.source}>{a.account || (a.source === 'auto-lander' ? 'auto-lander' : '—')}</span> },
    { id: 'result', label: 'Result', width: 'calc(var(--fx-font-size) * 6)', render: (a) => <Chip tone={RESULT_TONE[a.result]}>{a.result === 'started' ? 'running' : a.result}</Chip> },
    { id: 'when', label: 'When', width: 'calc(var(--fx-font-size) * 6)', align: 'end', render: (a) => <span className="fx-small fx-muted" title={`${a.startedAt}${a.endedAt ? ` → ${a.endedAt}` : ''}`}>{ago(a.startedAt)}</span> },
    { id: 'note', label: 'What happened', width: 'minmax(calc(var(--fx-font-size) * 14), 1fr)', render: (a) => <span className="fx-small">{a.note}{a.log ? <> · <a href={a.log} target="_blank" rel="noreferrer">log</a></> : null}</span> },
  ];
  return (
    <div className="fx-stack" data-axf-attempts={id}>
      {e && <Note tone="danger">Failed {ago(e.at)}, every option used up after {e.attempts} attempt{e.attempts === 1 ? '' : 's'}: {e.why}{e.tried.length ? ` Tried: ${e.tried.join(', ')}.` : ''} It is on the systems check banner{e.pushedAt ? ' and went to your phone once' : ''}.</Note>}
      {f && !e && <Note tone="warning" icon="refresh">Fixing: {KIND[f.kind] ?? f.kind}{f.step ? ` on ${f.step}` : ''} ({f.why}) since {ago(f.at)}.{nx ? ` Next: ${rung(nx.strategy, nx.fixStrategy)}${nx.model ? ` on ${nx.model}` : ''}${nx.account ? ` (${nx.account})` : ''}${nx.inFlight ? ', running now' : nx.notBefore ? `, not before ${nx.notBefore.slice(11, 16)}` : ''}.` : ''}</Note>}
      {l && <p className="fx-small"><Icon name="branch" size={13} /> {l.mergedAt ? `Merged ${ago(l.mergedAt)}` : 'Not merged yet'}{l.sha ? ` at ${l.sha.slice(0, 10)}` : ''} · CI on main: {l.ci}{l.ciRun ? <> (<a href={l.ciRun} target="_blank" rel="noreferrer">run</a>)</> : null} · verify: {l.verifiedAt ? `${l.verifyHow}, ${ago(l.verifiedAt)}` : 'not yet'}{l.verifyLog ? ` · ${l.verifyLog}` : ''}</p>}
      {(data.ladder?.length ?? 0) > 0 && <p className="fx-small fx-muted">Ladder for {KIND[f?.kind ?? ''] ?? f?.kind}: {data.ladder!.join(' → ')}</p>}
      <div className="fx-row fx-row--wrap" role="toolbar" aria-label={`${id} attempts`}>
        {(f || e) && <span data-axf-target={`button:retry-${id}`}><Button size="sm" tone="primary" icon="refresh" disabled={busy} title="Start the ladder over for this failure (the attempts so far stay in the log)" onClick={() => onRetry('')}>Retry</Button></span>}
        {(f || e) && <span data-axf-target={`button:retry-fresh-${id}`}><Button size="sm" tone="neutral" icon="play" disabled={busy} title="Retry now in a fresh session" onClick={() => onRetry('fresh-session')}>Fresh session</Button></span>}
      </div>
      {list.length
        ? <DataGrid<Attempt> id="build-orchestrator.attempts" label={`${id} attempts`} groups={[{ id, title: `${list.length} attempt${list.length === 1 ? '' : 's'}`, rows: list, groups: [], fixed: true }]} columns={cols} rowId={(a) => String(a.n)} rowLabel={(a) => `attempt ${a.n}`} hidden={[]} />
        : <p className="fx-muted fx-small">No attempts: nothing has failed on this build.</p>}
    </div>
  );
}
