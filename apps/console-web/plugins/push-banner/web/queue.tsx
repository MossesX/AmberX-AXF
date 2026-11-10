/**
 * Merge queue view (build merge-queue, Brett Nov 4 2026: "And how am I going to access this merge queue?"). The line of
 * PRs the queue runner (land/merge-queue.mjs on the VPS) tests once each and merges: order, title, agent, test state,
 * ETA; drag or Move up / down to reorder, Remove from queue, Jump to front (Brett's own click), Add back. Shown in the
 * push banner (its "Merge queue: N" chip opens it), in Settings → Plugins → Push banner and as a Home card (card@1 on
 * the mergequeue-list command). Theme tokens and framework controls only.
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import { AgentAvatar, Button, Icon, PriorityTag, SelectField, Switch, useRuntime } from '@console/axf/react';
import { cardFromDrop } from '@console/axf/core/engines/card-rules.mjs';
import { api, FOLDER } from './store';

export interface QueueItem { inBatch?: boolean; pr: number; title: string; url?: string; branch?: string; build?: string; agent?: string; state: 'waiting' | 'testing' | 'passed' | 'merging' | 'kicked' | 'held'; ci?: string; why?: string; etaMin?: number; runUrl?: string; queueBranch?: string; ahead?: number[]; with?: number[]; batch?: number; prCi?: string }
export interface QueueBatch { id: number; branch: string; sha: string; base: string; members: { pr: number; head: string; title?: string }[]; ci?: string; runUrl?: string; bisect?: boolean; state?: string; why?: string; prNumber?: number; prUrl?: string }
export interface QueueBatchDone { id: number; prs: number[]; result: 'merged' | 'red' | 'kicked'; at: string; pr?: number; runUrl?: string }
export interface QueueSettings { on: boolean; mode: 'batch' | 'stack'; batchSize: number; aiResolve: boolean; autoFix: boolean; fixTries: number; fixTriesMax: number; depth: number; batchSizeMax: number; depthMax: number }
/** A red batch being split in halves (bisect): its PRs, the CI runs spent, the good ones merged, the ones sent back. */
export interface QueueBisect { of: number; prs: number[]; at: string; runs: number; merged: number[]; sentBack: number[]; failing?: string[]; runUrl?: string; doneAt?: string }
export interface QueueKick { pr: number; title: string; why: string; at: string; runUrl?: string; sentBack?: string; build?: string }
export interface QueueMerged { pr: number; title: string; at: string; agent?: string }
export interface QueueState { on: boolean; depth: number; mode?: 'batch' | 'stack'; batchSize?: number; aiResolve?: boolean; autoFix?: boolean; fixTries?: number; bisect?: QueueBisect | null; bisects?: QueueBisect[]; batch?: QueueBatch | null; suspects?: number[]; split?: number[]; enlisted?: { build: string; pr: number }[]; batches?: QueueBatchDone[]; at?: string; items: QueueItem[]; waiting: QueueItem[]; kicked: QueueKick[]; merged: QueueMerged[]; avgMin: number | null; variable?: string; variableError?: string; chip: { label: string; count: number; testing: number; kicked: number; tone: string } }

const POLL_MS = 60_000;
let qstate: { data: QueueState | null; error: string; busy: number; note: string } = { data: null, error: '', busy: 0, note: '' };
const subs = new Set<() => void>();
const set = (p: Partial<typeof qstate>) => { qstate = { ...qstate, ...p }; subs.forEach((f) => f()); };
export const useQueue = () => useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => qstate);

export async function loadQueue(): Promise<void> {
  try { set({ data: await api.call<QueueState>('queue'), error: '' }); }
  catch (e) { set({ error: e instanceof Error ? e.message : String(e) }); }
}
let timer: ReturnType<typeof setInterval> | null = null;
export function startQueue(): void { if (timer) return; void loadQueue(); timer = setInterval(() => void loadQueue(), POLL_MS); }

async function command(cmd: 'add' | 'remove' | 'move', body: { pr: number; to?: number; why?: string }, done: string): Promise<void> {
  set({ busy: body.pr, note: '' });
  try { set({ data: await api.post<QueueState>(`queue/${cmd}`, body), note: `${done} Takes effect at the next round (within 3 minutes).` }); }
  catch (e) { set({ note: e instanceof Error ? e.message : String(e) }); }
  finally { set({ busy: 0 }); }
}

const STATE_WORD: Record<QueueItem['state'], string> = { waiting: 'Waiting', testing: 'Testing', passed: 'Passed', merging: 'Merging', kicked: 'Kicked out', held: 'Not in the queue' };
const STATE_ICON: Record<QueueItem['state'], string> = { waiting: 'clock', testing: 'refresh', passed: 'check-circle', merging: 'branch', kicked: 'x-circle', held: 'pause' };
const eta = (m?: number) => (m == null ? '' : m < 60 ? `~${m} min` : `~${Math.round(m / 6) / 10} h`);

function Row({ it, i, count, onDrop }: { it: QueueItem; i: number; count: number; onDrop: (pr: number, to: number) => void }) {
  const q = useQueue();
  const [sure, setSure] = useState(false);
  const busy = q.busy === it.pr;
  return (
    <li className={`axp-push-banner__item axp-mq__row is-${it.state}`} draggable onDragStart={(e) => { e.dataTransfer.setData('text/x-axf-queue-pr', String(it.pr)); e.dataTransfer.effectAllowed = 'move'; }}
      onDragOver={(e) => { if (e.dataTransfer.types.includes('text/x-axf-queue-pr')) e.preventDefault(); }}
      onDrop={(e) => { const pr = Number(e.dataTransfer.getData('text/x-axf-queue-pr')); if (pr && pr !== it.pr) onDrop(pr, i); }}>
      <span className="axp-mq__pos" aria-label={`Place ${i + 1}`}>{i + 1}</span>
      <span className="axp-push-banner__entry">
        <span className="axp-push-banner__line">
          <AgentAvatar agent={it.agent || null} size="small" />
          {it.url ? <a className="axp-push-banner__name" href={it.url} target="_blank" rel="noreferrer">#{it.pr} {it.title}</a> : <span className="axp-push-banner__name">#{it.pr} {it.title}</span>}
          <PriorityTag build={it.build} />
        </span>
        <span className="axp-push-banner__meta">
          <span className={`axp-mq__state is-${it.state}`}><Icon name={STATE_ICON[it.state]} size={14} /> {STATE_WORD[it.state]}</span>
          {it.batch ? ` · batch ${it.batch}${it.with?.length ? ` with ${it.with.map((n) => `#${n}`).join(', ')}` : ''}` : ''}
          {!it.batch && it.state === 'testing' && it.ahead?.length ? ` · with ${it.ahead.map((n) => `#${n}`).join(', ')} ahead` : ''}
          {it.etaMin ? ` · merges ${eta(it.etaMin)}` : ''}
          {it.agent ? ` · ${it.agent}` : ''}
          {it.runUrl ? <> · <a className="axp-push-banner__ci" href={it.runUrl} target="_blank" rel="noreferrer">run</a></> : null}
        </span>
        {it.why && <span className="axp-push-banner__sub axp-mq__why">{it.why}</span>}
      </span>
      <div className="axp-push-banner__acts" role="toolbar" aria-label={`Merge queue #${it.pr}`}>
        <Button size="sm" tone="quiet" icon="chevron-up" disabled={busy || i === 0} title="Move up one place" onClick={() => void command('move', { pr: it.pr, to: Math.max(0, i - 1) }, `Moved #${it.pr} up.`)}>Up</Button>
        <Button size="sm" tone="quiet" icon="chevron-down" disabled={busy || i === count - 1} title="Move down one place" onClick={() => void command('move', { pr: it.pr, to: i + 1 }, `Moved #${it.pr} down.`)}>Down</Button>
        <Button size="sm" tone="neutral" icon="rocket" disabled={busy || i === 0} title="Jump to the front of the queue (your own click)" onClick={() => void command('move', { pr: it.pr, to: 0 }, `#${it.pr} is at the front.`)}>Jump to front</Button>
        {sure
          ? <><Button size="sm" tone="danger" icon="x" disabled={busy} onClick={() => { setSure(false); void command('remove', { pr: it.pr, why: 'removed in the console' }, `Took #${it.pr} out of the queue.`); }}>Remove?</Button><Button size="sm" tone="quiet" onClick={() => setSure(false)}>Cancel</Button></>
          : <Button size="sm" tone="quiet" icon="x" disabled={busy} title="Take it out of the queue until its next commit" onClick={() => setSure(true)}>Remove from queue</Button>}
      </div>
    </li>
  );
}

const BATCH_RESULT: Record<QueueBatchDone['result'], string> = { merged: 'merged as one', red: 'red, halved', kicked: 'red, PR kicked out' };

/** The batch under test: its PRs, its one CI run, and whether it is narrowing down a red batch. */
function BatchLine({ b }: { b: QueueBatch }) {
  const word = b.state === 'merging' ? 'merging' : b.state === 'passed' ? 'passed' : b.ci === 'success' ? 'passed' : 'testing';
  return (
    <p className="fx-small axp-mq__batch" role="status">
      <Icon name="branch" size={14} /> Batch {b.id}: {b.members.map((m) => `#${m.pr}`).join(', ')} on main {b.base.slice(0, 8)}, {word}{b.bisect ? ' (a smaller batch, to find which PR broke the last one)' : ''}
      {b.runUrl ? <> · <a className="axp-push-banner__ci" href={b.runUrl} target="_blank" rel="noreferrer">run</a></> : null}
      {b.prUrl ? <> · <a className="axp-push-banner__ci" href={b.prUrl} target="_blank" rel="noreferrer">PR #{b.prNumber}</a></> : null}
      {b.why ? ` · ${b.why}` : ''}
    </p>
  );
}

/** Merge queue settings (Settings → Plugins → Push banner, under the Merge queue switch): mode, batch size, AI fallback.
 * The same settings as GET/POST /queue/settings, MCP mergequeue-settings / mergequeue-set and `merge-queue.mjs settings`. */
export function MergeQueueSettings() {
  const [st, setSt] = useState<QueueSettings | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => { api.call<QueueSettings>('queue/settings').then(setSt, (e: Error) => setErr(e.message)); }, []);
  const save = (patch: Partial<Pick<QueueSettings, 'mode' | 'batchSize' | 'aiResolve' | 'autoFix' | 'fixTries' | 'depth'>>) => { setErr(''); api.post<QueueSettings>('queue/settings', patch).then((x) => { setSt(x); void loadQueue(); }, (e: Error) => setErr(e.message)); };
  if (!st) return err ? <p className="fx-small axp-push-banner__note is-danger">{err}</p> : null;
  const range = (n: number) => Array.from({ length: n }, (_, i) => ({ value: String(i + 1), label: String(i + 1) }));
  return (
    <div className="fx-stack">
      <SelectField label="How the merge queue tests PRs" value={st.mode}
        options={[{ value: 'batch', label: 'Batch: combine ready PRs into one build, merge as one' }, { value: 'stack', label: 'Stack: each PR on top of the ones ahead' }]}
        hint={st.mode === 'batch' ? 'Ready PRs are combined on the latest main into one queue/batch branch, CI runs once, main is pulled in again if it moved, and the batch merges as one PR. A red batch is halved until the PR that broke it is found.' : 'Each ready PR gets its own queue/pr branch on top of main and the PRs ahead of it; the green head merges with no retest.'}
        onChange={(v) => save({ mode: v as QueueSettings['mode'] })} />
      {st.mode === 'batch'
        ? <SelectField label="PRs per batch" value={String(st.batchSize)} options={range(st.batchSizeMax)} hint="How many ready PRs go into one build. Fewer PRs ready than this: the batch takes what is ready, no waiting." onChange={(v) => save({ batchSize: Number(v) })} />
        : <SelectField label="PRs tested at once" value={String(st.depth)} options={range(st.depthMax)} onChange={(v) => save({ depth: Number(v) })} />}
      {st.mode === 'batch' && <Switch label="AI fallback for code conflicts inside a batch" checked={st.aiResolve} onChange={(v) => save({ aiResolve: v })}
        hint="Off: plain code only; a PR that conflicts with one earlier in its batch waits for the next batch. On: it still waits, and one agent job (queue-conflict, Opus) makes its branch work with the others; CI still decides." />}
      {st.mode === 'batch' && <Switch label="Send the PR that broke a batch back to its build for a fix" checked={st.autoFix} onChange={(v) => save({ autoFix: v })}
        hint="A red batch is split in halves until one PR alone is red; the good ones merge on the way. On: that PR goes back to its build, one agent job (queue-fix, Opus) fixes its branch and pushes, and the fixed PR rejoins the queue and is retested. You get an alert on AmberX either way." />}
      {st.mode === 'batch' && st.autoFix && <SelectField label="Fix tries per PR" value={String(st.fixTries)}
        options={Array.from({ length: st.fixTriesMax + 1 }, (_, i) => ({ value: String(i), label: String(i) }))}
        hint="After this many automatic fixes the PR stays out of the queue and you get an alert to look at it." onChange={(v) => save({ fixTries: Number(v) })} />}
      {err && <p className="fx-small axp-push-banner__note is-danger">{err}</p>}
    </div>
  );
}

/** The whole view: the line, kicked-out PRs (and why), open PRs not in it (and why), the last merged. */
export function MergeQueueView({ compact = false }: { compact?: boolean }) {
  const rt = useRuntime();
  const q = useQueue();
  useEffect(() => { startQueue(); }, []);
  const d = q.data;
  if (!d) return <p className="fx-small fx-muted">{q.error || 'Reading the merge queue…'}</p>;
  if (!d.on) return <p className="fx-small fx-muted">The merge queue is off: PRs merge one by one, each re-tested after main moves. Switch it on in Settings → Plugins → Push banner.</p>;
  const out = d.waiting.filter((w) => w.state !== 'kicked');
  const kickedOpen = d.waiting.filter((w) => w.state === 'kicked');
  return (
    <div className="axp-mq fx-stack">
      <p className="fx-small fx-muted">{d.mode === 'batch'
        ? `Every finished build lands through here. Ready PRs are combined ${d.batchSize ?? 5} at a time into one build on the latest main; CI runs once on it and the whole batch merges as one. A red batch is split in halves until the PR that broke it is found; the good ones merge and ${d.autoFix === false ? 'the bad one waits for a fix' : 'the bad one goes back to its build for an automatic fix and a retest'}.`
        : `Each PR is tested once, on top of main and every PR ahead of it (${d.depth} at a time); when its run is green it merges with no retest. A red one is kicked out with the reason and the ones behind it are retested without it.`}{d.avgMin ? ` A run takes ~${d.avgMin} min.` : ''}{d.at ? ` Checked ${new Date(d.at).toLocaleTimeString()}.` : ''}</p>
      {d.mode === 'batch' && d.bisect && <BisectLine b={d.bisect} suspects={d.suspects || []} />}
      {d.mode === 'batch' && d.batch && <BatchLine b={d.batch} />}
      {d.variableError && <p className="fx-small axp-push-banner__note is-danger">{d.variableError}</p>}
      {q.note && <p className="fx-small axp-push-banner__note" role="status">{q.note}</p>}
      <section className="axp-push-banner__group" aria-label="In the queue">
        <h4 className="axp-push-banner__group-title">In the queue <span>{d.items.length}</span></h4>
        {d.items.length
          ? <ul className="axp-push-banner__list">{d.items.map((it, i) => <Row key={it.pr} it={it} i={i} count={d.items.length} onDrop={(pr, to) => void command('move', { pr, to }, `Moved #${pr} to place ${to + 1}.`)} />)}</ul>
          : <p className="fx-small fx-muted">Nothing waiting to merge.</p>}
      </section>
      {kickedOpen.length > 0 && (
        <section className="axp-push-banner__group is-warning" aria-label="Kicked out">
          <h4 className="axp-push-banner__group-title">Kicked out <span>{kickedOpen.length}</span></h4>
          <ul className="axp-push-banner__list">{kickedOpen.map((w) => (
            <li key={w.pr} className="axp-push-banner__item is-ci-failure">
              <span className="axp-push-banner__entry">
                <span className="axp-push-banner__line"><AgentAvatar agent={w.agent || null} size="small" /><a className="axp-push-banner__name" href={w.url} target="_blank" rel="noreferrer">#{w.pr} {w.title}</a></span>
                <span className="axp-push-banner__sub axp-mq__why">{(w.why || '').replace(/^kicked out: /, '')}</span>
                {sentBackOf(d, w.pr) && <span className="axp-push-banner__sub">{sentBackOf(d, w.pr)}</span>}
              </span>
              <div className="axp-push-banner__acts" role="toolbar" aria-label={`Kicked out #${w.pr}`}><Button size="sm" tone="neutral" icon="plus" disabled={q.busy === w.pr} title="Put it back in the queue as it is" onClick={() => void command('add', { pr: w.pr }, `#${w.pr} is back in the queue.`)}>Add back</Button></div>
            </li>))}
          </ul>
        </section>
      )}
      {!compact && out.length > 0 && (
        <section className="axp-push-banner__group" aria-label="Not in the queue yet">
          <h4 className="axp-push-banner__group-title">Not in the queue yet <span>{out.length}</span></h4>
          <ul className="axp-push-banner__list">{out.map((w) => (
            <li key={w.pr} className="axp-push-banner__item">
              <span className="axp-push-banner__entry">
                <span className="axp-push-banner__line"><AgentAvatar agent={w.agent || null} size="small" /><a className="axp-push-banner__name" href={w.url} target="_blank" rel="noreferrer">#{w.pr} {w.title}</a></span>
                <span className="axp-push-banner__sub axp-mq__why">{(w.why || '').replace(/^kicked out: /, '')}</span>
              </span>
              {/by hand/.test(w.why || '') && <div className="axp-push-banner__acts" role="toolbar" aria-label={`Not queued #${w.pr}`}><Button size="sm" tone="neutral" icon="plus" disabled={q.busy === w.pr} onClick={() => void command('add', { pr: w.pr }, `#${w.pr} is back in the queue.`)}>Add to queue</Button></div>}
            </li>))}
          </ul>
        </section>
      )}
      {!compact && d.mode === 'batch' && (d.batches || []).length > 0 && <p className="fx-small fx-muted">Last batches: {(d.batches || []).slice(-4).reverse().map((b) => `${b.id} (${b.prs.map((n) => `#${n}`).join(' ')}): ${BATCH_RESULT[b.result] || b.result}`).join(' · ')}</p>}
      {!compact && d.mode === 'batch' && (d.bisects || []).length > 0 && <p className="fx-small fx-muted">Last red batches: {(d.bisects || []).slice(-3).reverse().map((b) => `${b.of}: merged ${b.merged.map((n) => `#${n}`).join(' ') || 'none'}, sent back ${b.sentBack.map((n) => `#${n}`).join(' ') || 'none'} (${b.runs} run${b.runs === 1 ? '' : 's'})`).join(' · ')}</p>}
      {!compact && d.merged.length > 0 && <p className="fx-small fx-muted">Merged lately: {d.merged.slice(-5).reverse().map((m) => `#${m.pr}`).join(', ')} ({d.mode === 'stack' ? 'each tested once' : 'landed in batches, one CI run each'}).</p>}
      <div className="axp-push-banner__foot" role="toolbar" aria-label="Merge queue">
        <Button size="sm" tone="quiet" icon="refresh" onClick={() => void loadQueue()}>Check now</Button>
        <Button size="sm" tone="quiet" icon="plus" title="Show the merge queue on Home" onClick={() => rt.openDialog('home-card', { draft: cardFromDrop({ plugin: FOLDER, command: 'mergequeue-list', title: 'Merge queue' }) })}>Add to Home</Button>
      </div>
    </div>
  );
}

/** What happened to a kicked-out PR after the bisect found it: sent back to its build, or waiting for Brett. */
function sentBackOf(d: QueueState, pr: number): string {
  return [...(d.kicked || [])].reverse().find((k) => k.pr === pr)?.sentBack || '';
}

/** The red batch being split now: what merged, what went back, what is still to test. */
function BisectLine({ b, suspects }: { b: QueueBisect; suspects: number[] }) {
  const left = b.prs.filter((n) => suspects.includes(n));
  const list = (ns: number[]) => ns.map((n) => `#${n}`).join(', ');
  return (
    <p className="fx-small axp-push-banner__note" role="status">
      Batch {b.of} failed CI{b.failing?.length ? ` (${b.failing.join(', ')})` : ''}: splitting it to find the PR that broke it. {b.runs} run{b.runs === 1 ? '' : 's'} so far.
      {b.merged.length ? ` Merged: ${list(b.merged)}.` : ''}{b.sentBack.length ? ` Sent back: ${list(b.sentBack)}.` : ''}{left.length ? ` Still to test: ${list(left)}.` : ''}
      {b.runUrl ? <> <a href={b.runUrl} target="_blank" rel="noreferrer">Red run</a></> : null}
    </p>
  );
}

/** The banner chip: "Merge queue: N"; tapping it opens the queue in the banner. */
export function MergeQueueChip({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const q = useQueue();
  useEffect(() => { startQueue(); }, []);
  const c = q.data?.chip;
  if (!q.data?.on || !c) return null;
  return (
    <button type="button" className={`fx-chip axp-mq__chip is-${c.tone}`} aria-expanded={open} title={`${c.testing} testing${c.kicked ? `, ${c.kicked} kicked out` : ''}: open the merge queue`} onClick={(e) => { e.stopPropagation(); onToggle(); }}>
      <Icon name="branch" size={14} /> {c.label}{c.kicked ? ` · ${c.kicked} out` : ''}
    </button>
  );
}
