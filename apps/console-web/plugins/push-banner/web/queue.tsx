/**
 * Merge queue view (build merge-queue, Brett Nov 4 2026: "And how am I going to access this merge queue?"). The line of
 * PRs the queue runner (land/merge-queue.mjs on the VPS) tests once each and merges: order, title, agent, test state,
 * ETA; drag or Move up / down to reorder, Remove from queue, Jump to front (Brett's own click), Add back. Shown in the
 * push banner (its "Merge queue: N" chip opens it), in Settings → Plugins → Push banner and as a Home card (card@1 on
 * the mergequeue-list command). Theme tokens and framework controls only.
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import { AgentAvatar, Button, Icon, PageToolbar, PriorityTag, usePublishPageState, useRuntime, useToolbarHandlers } from '@console/axf/react';
import { cardFromDrop } from '@console/axf/core/engines/card-rules.mjs';
import { api, FOLDER } from './store';

export interface QueueItem { inBatch?: boolean; pr: number; title: string; url?: string; branch?: string; build?: string; agent?: string; state: 'waiting' | 'testing' | 'passed' | 'merging' | 'kicked' | 'held'; ci?: string; why?: string; etaMin?: number; runUrl?: string; queueBranch?: string; ahead?: number[]; prCi?: string }
export interface QueueKick { pr: number; title: string; why: string; at: string; runUrl?: string }
export interface QueueMerged { pr: number; title: string; at: string; agent?: string }
export interface QueueBatch { prs: number[]; sha: string; ci: string; runUrl?: string; builtAt?: string; bisect?: boolean; why?: string }
export interface QueueState { mode?: 'batch' | 'stack'; batchSize?: number; batch?: QueueBatch | null; split?: number[]; on: boolean; depth: number; at?: string; items: QueueItem[]; waiting: QueueItem[]; kicked: QueueKick[]; merged: QueueMerged[]; avgMin: number | null; variable?: string; variableError?: string; chip: { label: string; count: number; testing: number; kicked: number; tone: string } }

/** What the lander did with a build's tracking files (GET /land/tracking, auto-land-tracking@1). */
interface TrackingMark { at: string; files?: string[]; generators?: string[]; commit?: string; sha?: string }
export interface TrackingState { show: boolean; items: { build: string; pr: number | null; tracking: { reset?: TrackingMark; takeMain?: TrackingMark; regenerate?: TrackingMark } }[] }

const POLL_MS = 60_000;
let qstate: { data: QueueState | null; tracking: TrackingState | null; error: string; busy: number; note: string; selected: number } = { data: null, tracking: null, error: '', busy: 0, note: '', selected: 0 };
/** The PR the merge queue toolbar acts on (a tap on a row selects it; again clears). */
const selectPr = (pr: number) => set({ selected: qstate.selected === pr ? 0 : pr });
const subs = new Set<() => void>();
const set = (p: Partial<typeof qstate>) => { qstate = { ...qstate, ...p }; subs.forEach((f) => f()); };
export const useQueue = () => useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => qstate);

export async function loadQueue(): Promise<void> {
  try { set({ data: await api.call<QueueState>('queue'), error: '' }); }
  catch (e) { set({ error: e instanceof Error ? e.message : String(e) }); }
  try { set({ tracking: await api.call<TrackingState>('land/tracking') }); } catch { /* older server: no tracking line */ }
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
const when = (m?: TrackingMark) => (m?.at ? m.at.slice(0, 16).replace('T', ' ') : '');
/** One plain line: when the lander last reset this build's tracking files, took main's copy, or regenerated. */
function trackingLine(t: TrackingState | null, it: QueueItem): string {
  if (!t?.show) return '';
  const x = t.items.find((r) => (it.build && r.build === it.build) || r.pr === it.pr)?.tracking;
  if (!x) return '';
  const parts = [
    x.reset && `tracking files reset to main's copy ${when(x.reset)} (${x.reset.files?.length ?? 0})`,
    x.takeMain && `main's copy taken in a merge ${when(x.takeMain)} (${x.takeMain.files?.length ?? 0})`,
    x.regenerate && `regenerated ${x.regenerate.generators?.join(', ') ?? ''} ${when(x.regenerate)}`,
  ].filter(Boolean);
  return parts.join(' · ');
}
const eta = (m?: number) => (m == null ? '' : m < 60 ? `~${m} min` : `~${Math.round(m / 6) / 10} h`);

function Row({ it, i, count, onDrop }: { it: QueueItem; i: number; count: number; onDrop: (pr: number, to: number) => void }) {
  const q = useQueue();
  const [sure, setSure] = useState(false);
  const busy = q.busy === it.pr;
  return (
    <li className={`axp-push-banner__item axp-mq__row is-${it.state}${q.selected === it.pr ? ' is-selected' : ''}`} aria-selected={q.selected === it.pr} onClick={(e) => { if (!(e.target as HTMLElement).closest('a, button')) selectPr(it.pr); }} data-axf-row={it.build || `pr-${it.pr}`} draggable onDragStart={(e) => { e.dataTransfer.setData('text/x-axf-queue-pr', String(it.pr)); e.dataTransfer.effectAllowed = 'move'; }}
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
          {it.inBatch ? ' · in this batch' : it.state === 'testing' && it.ahead?.length ? ` · with ${it.ahead.map((n) => `#${n}`).join(', ')} ahead` : ''}
          {it.etaMin ? ` · merges ${eta(it.etaMin)}` : ''}
          {it.agent ? ` · ${it.agent}` : ''}
          {it.runUrl ? <> · <a className="axp-push-banner__ci" href={it.runUrl} target="_blank" rel="noreferrer">run</a></> : null}
        </span>
        {it.why && <span className="axp-push-banner__sub axp-mq__why">{it.why}</span>}
        {trackingLine(q.tracking, it) && <span className="axp-push-banner__sub axp-mq__tracking">{trackingLine(q.tracking, it)}</span>}
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
  // the merge queue toolbar (page-toolbar@1, assets/toolbar/push-banner-merge-queue.json): the selected PR's queue commands
  const items = d?.items ?? [];
  const index = items.findIndex((x) => x.pr === q.selected);
  const pick = index >= 0 ? items[index] : d?.waiting.find((x) => x.pr === q.selected);
  const red = pick?.why ? pick.why.replace(/^kicked out: /, '') : '';
  usePublishPageState('push-banner', {
    queued: items.length, kicked: d?.waiting.filter((w) => w.state === 'kicked').length ?? 0,
    selection: pick ? {
      pr: pick.pr, build: pick.build ?? '', index: Math.max(index, 0), inQueue: index >= 0, canAdd: index < 0,
      up: Math.max(0, index - 1), down: index + 1, canDown: index >= 0 && index < items.length - 1,
      runUrl: pick.runUrl ?? (pick.url ? `${pick.url}/checks` : ''), why: red,
    } : null,
  });
  useToolbarHandlers('push-banner', {
    'push-banner.open-ci': () => { const u = pick?.runUrl ?? (pick?.url ? `${pick.url}/checks` : ''); if (u) window.open(u, '_blank', 'noopener'); return u || null; },
    'push-banner.red-reason': () => { if (pick && red) rt.toast(red, 'warning', `#${pick.pr} ${pick.title}`); return pick ? { pr: pick.pr, why: red } : null; },
  });
  if (!d) return <p className="fx-small fx-muted">{q.error || 'Reading the merge queue…'}</p>;
  if (!d.on) return <p className="fx-small fx-muted">The merge queue is off: PRs merge one by one, each re-tested after main moves. Switch it on in Settings → Plugins → Push banner.</p>;
  const out = d.waiting.filter((w) => w.state !== 'kicked');
  const kickedOpen = d.waiting.filter((w) => w.state === 'kicked');
  return (
    <div className="axp-mq fx-stack">
      <PageToolbar view="push-banner" slot="merge-queue" />
      <p className="fx-small fx-muted">{d.mode === 'stack'
        ? `Each PR is tested once, on top of main and every PR ahead of it (${d.depth} at a time); when its run is green it merges with no retest. A red one is kicked out with the reason and the ones behind it are retested without it.`
        : `Every finished build lands through here. Up to ${d.batchSize ?? 8} ready PRs are combined into one build, CI runs once on it, and a green batch lands on main as that one commit. A red batch is split in half until the PR that broke it is found and kicked out.`}{d.avgMin ? ` A run takes ~${d.avgMin} min.` : ''}{d.at ? ` Checked ${new Date(d.at).toLocaleTimeString()}.` : ''}</p>
      {d.mode !== 'stack' && d.batch && (
        <p className="fx-small axp-push-banner__note" role="status">
          Batch {d.batch.prs.map((n) => `#${n}`).join(', ')}{d.batch.bisect ? ' (half of a red batch)' : ''}: {d.batch.ci === 'success' ? 'CI passed, landing' : d.batch.ci === 'failure' ? 'CI failed' : 'CI running'}
          {d.batch.runUrl ? <> · <a className="axp-push-banner__ci" href={d.batch.runUrl} target="_blank" rel="noreferrer">run</a></> : null}{d.batch.why ? ` · ${d.batch.why}` : ''}
        </p>
      )}
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
            <li key={w.pr} className={`axp-push-banner__item is-ci-failure${q.selected === w.pr ? ' is-selected' : ''}`} aria-selected={q.selected === w.pr} onClick={(e) => { if (!(e.target as HTMLElement).closest('a, button')) selectPr(w.pr); }}>
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
            <li key={w.pr} className={`axp-push-banner__item${q.selected === w.pr ? ' is-selected' : ''}`} aria-selected={q.selected === w.pr} onClick={(e) => { if (!(e.target as HTMLElement).closest('a, button')) selectPr(w.pr); }}>
              <span className="axp-push-banner__entry">
                <span className="axp-push-banner__line"><AgentAvatar agent={w.agent || null} size="small" /><a className="axp-push-banner__name" href={w.url} target="_blank" rel="noreferrer">#{w.pr} {w.title}</a></span>
                <span className="axp-push-banner__sub axp-mq__why">{(w.why || '').replace(/^kicked out: /, '')}</span>
              </span>
              {/by hand/.test(w.why || '') && <div className="axp-push-banner__acts" role="toolbar" aria-label={`Not queued #${w.pr}`}><Button size="sm" tone="neutral" icon="plus" disabled={q.busy === w.pr} onClick={() => void command('add', { pr: w.pr }, `#${w.pr} is back in the queue.`)}>Add to queue</Button></div>}
            </li>))}
          </ul>
        </section>
      )}
      {!compact && d.merged.length > 0 && <p className="fx-small fx-muted">Merged lately: {d.merged.slice(-5).reverse().map((m) => `#${m.pr}`).join(', ')} ({d.mode === 'stack' ? 'each tested once' : 'landed in batches, one CI run each'}).</p>}
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
