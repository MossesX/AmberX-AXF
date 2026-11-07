/**
 * Merge queue view (build merge-queue, Brett Nov 4 2026: "And how am I going to access this merge queue?"). The line of
 * PRs the queue runner (land/merge-queue.mjs on the VPS) tests once each and merges: order, title, agent, test state,
 * ETA; drag or Move up / down to reorder, Remove from queue, Jump to front (Brett's own click), Add back. Shown in the
 * push banner (its "Merge queue: N" chip opens it), in Settings → Plugins → Push banner and as a Home card (card@1 on
 * the mergequeue-list command). Theme tokens and framework controls only.
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import { AgentAvatar, Button, Icon, PriorityTag, useRuntime } from '@console/axf/react';
import { ConflictsSection } from './conflicts';
import { cardFromDrop } from '@console/axf/core/engines/card-rules.mjs';
import { api, FOLDER } from './store';

export interface QueueItem { pr: number; title: string; url?: string; branch?: string; build?: string; agent?: string; state: 'waiting' | 'testing' | 'passed' | 'merging' | 'kicked' | 'held'; ci?: string; why?: string; etaMin?: number; runUrl?: string; queueBranch?: string; ahead?: number[]; prCi?: string }
export interface QueueKick { pr: number; title: string; why: string; at: string; runUrl?: string }
export interface QueueMerged { pr: number; title: string; at: string; agent?: string }
export interface QueueState { on: boolean; depth: number; at?: string; items: QueueItem[]; waiting: QueueItem[]; kicked: QueueKick[]; merged: QueueMerged[]; avgMin: number | null; variable?: string; variableError?: string; chip: { label: string; count: number; testing: number; kicked: number; tone: string } }

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
          {it.state === 'testing' && it.ahead?.length ? ` · with ${it.ahead.map((n) => `#${n}`).join(', ')} ahead` : ''}
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
      <p className="fx-small fx-muted">Each PR is tested once, on top of main and every PR ahead of it ({d.depth} at a time); when its run is green it merges with no retest. A red one is kicked out with the reason and the ones behind it are retested without it.{d.avgMin ? ` A run takes ~${d.avgMin} min.` : ''}{d.at ? ` Checked ${new Date(d.at).toLocaleTimeString()}.` : ''}</p>
      {d.variableError && <p className="fx-small axp-push-banner__note is-danger">{d.variableError}</p>}
      {q.note && <p className="fx-small axp-push-banner__note" role="status">{q.note}</p>}
      <ConflictsSection />
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
      {!compact && d.merged.length > 0 && <p className="fx-small fx-muted">Merged lately: {d.merged.slice(-5).reverse().map((m) => `#${m.pr}`).join(', ')} (each tested once).</p>}
      <div className="axp-push-banner__foot" role="toolbar" aria-label="Merge queue">
        <Button size="sm" tone="quiet" icon="refresh" onClick={() => void loadQueue()}>Check now</Button>
        <Button size="sm" tone="quiet" icon="plus" title="Show the merge queue on Home" onClick={() => rt.openDialog('home-card', { draft: cardFromDrop({ plugin: FOLDER, command: 'mergequeue-list', title: 'Merge queue' }) })}>Add to Home</Button>
      </div>
    </div>
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
