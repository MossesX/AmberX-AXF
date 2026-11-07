/**
 * Merge conflicts (build merge-conflict-alerts): the list of open PRs that conflict with main, with Fix conflicts now, at
 * the top of the Merge queue view, and the "Conflicts: N" chip on the main banner that stays until they are resolved.
 * The conflict watch (land/conflicts.mjs on the VPS) does the scanning; this only reads its answer and sends Brett's click.
 * Theme tokens and framework controls only.
 */
import { useEffect, useSyncExternalStore } from 'react';
import { Button } from '@console/axf/react';
import type { AxfRuntime } from '@console/axf/core';
import { api, ID } from './store';

export interface ConflictFix { state: 'running' | 'failed'; head: string; at: string; by?: string; build?: string; session?: string; why?: string }
export interface ConflictItem { pr: number; title: string; url?: string; branch?: string; head: string; files: string[]; why?: string; since: string; fix?: ConflictFix | null }
export interface ConflictState { at?: string; count: number; items: ConflictItem[]; asked: number[] }

export const CHIP_ID = 'pr-conflicts';
const COUNTER = 'push-banner-conflicts';
const POLL_MS = 60_000;

let state: { data: ConflictState | null; note: string; busy: number } = { data: null, note: '', busy: 0 };
const subs = new Set<() => void>();
const set = (p: Partial<typeof state>) => { state = { ...state, ...p }; subs.forEach((f) => f()); };
const useConflicts = () => useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => state);

export const filesLine = (it: ConflictItem): string => (it.files.length
  ? `${it.files.slice(0, 3).join(', ')}${it.files.length > 3 ? `, +${it.files.length - 3} more` : ''}`
  : it.why || 'GitHub refused the merge');

/** The chip's words. */
export const chipLabel = (n: number): string => `Conflicts: ${n}`;

function paint(rt: AxfRuntime, n: number): void {
  rt.registry.register({
    $axf: 'asset@1', type: 'status', id: CHIP_ID, name: 'Merge conflicts', version: '0.1.0', author: 'Push banner plugin',
    description: 'Open PRs that conflict with main. Stays on the banner until they are resolved.', tags: ['merge', 'status'],
    data: { counter: COUNTER, onLabel: chipLabel(n), offLabel: chipLabel(0), onTone: 'danger', offTone: 'muted', dot: true, link: 'push-banner.queue' },
  }, 'app', ID);
  rt.setBadge(COUNTER, n);
  if (n > 0) rt.attachToBanner({ type: 'status', id: CHIP_ID, at: 'right', order: 24, origin: `${ID}.conflicts`, widget: { label: 'Merge conflicts', size: 'compact', priority: 7, aliases: ['conflicts', 'merge conflicts'] } });
  else rt.detachFromBanner(`status:${CHIP_ID}`);
}

async function load(rt?: AxfRuntime): Promise<void> {
  try { const data = await api.call<ConflictState>('conflicts'); set({ data }); if (rt) paint(rt, data.count); }
  catch { /* the next poll tries again; the chip stays as it was */ }
}

let timer: ReturnType<typeof setInterval> | null = null;
/** Runs from the plugin's register, so the chip is there on every page without opening anything. */
export function startConflicts(rt: AxfRuntime): void {
  if (timer) return;
  void load(rt);
  timer = setInterval(() => { void load(rt); }, POLL_MS);
  // a tap on the phone's alert lands here
  if (new URLSearchParams(window.location.search).has('axf-conflicts')) setTimeout(() => rt.dispatch('settings.open:push-banner'), 500);
}

async function fix(it: ConflictItem): Promise<void> {
  set({ busy: it.pr, note: '' });
  try { set({ data: await api.post<ConflictState>('conflicts/fix', { pr: it.pr, head: it.head }), note: `Fix job for #${it.pr} starts at the next round (within 3 minutes).` }); }
  catch (e) { set({ note: e instanceof Error ? e.message : String(e) }); }
  finally { set({ busy: 0 }); }
}

function FixState({ it, asked }: { it: ConflictItem; asked: boolean }) {
  if (asked) return <span className="axp-push-banner__sub">Fix asked for; starts within 3 minutes.</span>;
  if (it.fix?.state === 'running') return <span className="axp-push-banner__sub">Fix running ({it.fix.build}).</span>;
  if (it.fix?.state === 'failed') return <span className="axp-push-banner__sub axp-mq__why">Fix failed: {it.fix.why}</span>;
  return null;
}

/** The section at the top of the Merge queue view; nothing when no PR conflicts. */
export function ConflictsSection() {
  const c = useConflicts();
  useEffect(() => { void load(); }, []);
  const items = c.data?.items ?? [];
  if (!items.length) return null;
  const asked = new Set(c.data?.asked ?? []);
  return (
    <section className="axp-push-banner__group is-warning" aria-label="Merge conflicts">
      <h4 className="axp-push-banner__group-title">Merge conflicts <span>{items.length}</span></h4>
      {c.note && <p className="fx-small axp-push-banner__note" role="status">{c.note}</p>}
      <ul className="axp-push-banner__list">{items.map((it) => {
        const running = it.fix?.state === 'running' || asked.has(it.pr);
        return (
          <li key={it.pr} className="axp-push-banner__item is-ci-failure">
            <span className="axp-push-banner__entry">
              <span className="axp-push-banner__line"><a className="axp-push-banner__name" href={it.url} target="_blank" rel="noreferrer">#{it.pr} {it.title}</a></span>
              <span className="axp-push-banner__sub">{filesLine(it)}</span>
              <FixState it={it} asked={asked.has(it.pr)} />
            </span>
            <div className="axp-push-banner__acts" role="toolbar" aria-label={`Merge conflicts #${it.pr}`}>
              <Button size="sm" tone="primary" icon="play" disabled={running || c.busy === it.pr} title="Merge main in, resolve the conflicts, rerun the checks and put it back in the queue" onClick={() => void fix(it)}>Fix conflicts now</Button>
            </div>
          </li>);
      })}</ul>
    </section>
  );
}
