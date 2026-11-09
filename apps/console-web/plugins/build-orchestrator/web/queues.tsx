import { useEffect, useRef, useState, type DragEvent } from 'react';
import { Chip, Icon, Note, useRuntime } from '@console/axf/react';
import type { AxfRuntime } from '@console/axf/core/runtime';
import type { MenuEntry } from '@console/axf/core/engines/windows';
import { pluginApi } from '@console/plugins';
import { writeLocal } from '@console/api';

/*
 * Account queues (Brett, Nov 9 2026: "I want to be able to hold a job down in the build manager or in the orchestrator
 * in the queue and send it to an API immediately. An API queue. I want every account to have its own queue.").
 *
 * Every Claude account, subscription and API (e.g. hulu-api), is a lane: what runs on it, what waits in its own queue,
 * what the next tick starts there. The shared lane holds builds any account may take. Long-press (or right-click) a
 * build card here, in the Pipeline tables or in the Builds tab → "Send to account queue" → any account: it runs only
 * there, ahead of unsent builds of its priority, and the dispatcher ticks at once (an API account still under its key,
 * caps and room). Drag a card onto another lane does the same; onto Shared takes it back.
 * API: GET /pipeline/queues, POST /pipeline/send {id, account, now?}; MCP / voice pipeline-queues, pipeline-send;
 * CLI pipeline.mjs queues | send <id> <account>|auto. The Build manager shows the same lanes through the builds.accounts slot.
 */

export const QUEUES_FOLDER = 'build-orchestrator';
export const CTX_TARGET = 'axf-orchestrator-build';
export const SEND_ACTION = 'build-orchestrator.send';
/** Deep link: opens Build orchestrator → Pipeline at the account queues (console_open / console actions / voice). */
export const SHOW_ACTION = 'build-orchestrator.queues';
export const SHOW_EVENT = 'axf:orchestrator-show';
const REFRESH_MS = 10_000;
const DRAG_TYPE = 'application/x-axf-build';

export type Lane = { name: string; kind: string; label: string; email: string; fable: boolean; parallel: number; running: string[]; waiting: string[]; next: string[]; free: number; why: string; spend: { day: number; week: number; dayCap?: number; weekCap?: number } | null };
export type Queues = { ok: boolean; at: string; accounts: Lane[]; shared: string[]; pending: string[]; why: Record<string, string>; titles: Record<string, string>; error?: string };

const api = pluginApi(QUEUES_FOLDER, 'Account queues', { unavailable: 'The build orchestrator is switched off or its server part is not running.' });

// one cache the context menu reads (a menu is built synchronously): the last lanes any view loaded
let last: Queues | null = null;
const subs = new Set<(q: Queues) => void>();
const remember = (q: Queues) => { last = q; subs.forEach((f) => f(q)); };
export async function loadQueues(): Promise<Queues> { const q = await api.call<Queues>('pipeline/queues'); if (!q.ok) throw new Error(q.error || 'no queues'); remember(q); return q; }

/** Send one build to an account's own queue ('auto' = the shared queue); toasts the outcome and reloads every lane view. */
export async function sendBuild(rt: AxfRuntime, id: string, account: string): Promise<void> {
  try {
    const r = await api.post<{ ok: boolean; error?: string; next?: string; account?: string }>('pipeline/send', { id, account });
    if (!r.ok) throw new Error(r.error);
    rt.toast(`${id} → ${account === 'auto' ? 'shared queue' : `${account}'s queue`}${r.next ? `: ${r.next}` : ''}`, 'success');
  } catch (e) { rt.toast((e as Error).message, 'danger'); }
  try { await loadQueues(); } catch { /* the next refresh says it */ }
}

const laneTitle = (l: Lane) => `${l.label || l.name}${l.kind === 'api' ? ' (API)' : ''}`;
const inLane = (q: Queues, id: string) => q.accounts.find((l) => l.waiting.includes(id))?.name ?? (q.shared.includes(id) ? '' : null);

/** The long-press / right-click entries for one build: "Send to account queue" → every account (API ones marked), and Shared. */
export function sendMenu(id: string): MenuEntry[] {
  const q = last;
  if (!q || !id) return [];
  const where = inLane(q, id);
  // only builds in Pending or the Queue move (a Pending one is in no lane yet: sending it queues it)
  if (where === null && !(q.pending ?? []).includes(id)) return [];
  return [{ id: 'orch-send', label: 'Send to account queue', icon: 'arrow-right', items: [
    ...q.accounts.map((l) => ({ id: `orch-send-${l.name}`, label: `${laneTitle(l)}${l.why ? ` · ${l.why}` : l.free > 0 ? ' · starts now' : ''}`, icon: where === l.name ? 'check' : l.kind === 'api' ? 'zap' : 'user', action: `${SEND_ACTION}:${id}:${l.name}` })),
    ...(where !== null && where !== '' ? [{ id: 'orch-send-sep', separator: true }, { id: 'orch-send-auto', label: 'Shared queue (any account)', icon: 'list', action: `${SEND_ACTION}:${id}:auto` }] : []),
  ] }];
}

/** Wire the action and the menus once per runtime: the orchestrator's build cards, and Build manager rows whose key names a build. */
export function registerSend(rt: AxfRuntime): void {
  rt.actions.register(SHOW_ACTION, () => {
    writeLocal('orch-tab', 'pipeline');
    rt.navigate('build-orchestrator');
    window.dispatchEvent(new CustomEvent(SHOW_EVENT, { detail: { tab: 'pipeline', anchor: 'account-queues' } }));
    window.setTimeout(() => document.getElementById('account-queues')?.scrollIntoView({ block: 'start' }), 300);
  }, { label: 'Show the account queues (Build orchestrator → Pipeline)' });
  rt.actions.register(SEND_ACTION, ([id = '', account = '']) => { if (id && account) void sendBuild(rt, id, account); }, { label: 'Send a build to an account queue', params: true } as never);
  // every target ('*:' key, so no other contributor's menu is replaced): the orchestrator's build cards, and Build
  // manager rows (axf-build-item, payload source:id) whose id is a Pending or queued build
  rt.contextExtras.set('*:build-orchestrator.send', (target, payload = '') => (target === CTX_TARGET ? sendMenu(payload) : target === 'axf-build-item' ? sendMenu(payload.replace(/^[a-z]+:/, '')) : []));
  void loadQueues().catch(() => { /* the lanes view shows the error */ });
}

/** Every account's own queue as lanes; long-press a card for the send menu, drag it to another lane. */
export function AccountQueues({ compact = false }: { compact?: boolean }) {
  const rt = useRuntime();
  const [q, setQ] = useState<Queues | null>(last);
  const [error, setError] = useState('');
  const [over, setOver] = useState('');
  const timer = useRef<number | null>(null);
  useEffect(() => {
    const f = (x: Queues) => setQ(x); subs.add(f);
    const load = () => { if (document.visibilityState === 'visible') loadQueues().then(() => setError('')).catch((e) => setError((e as Error).message)); };
    load();
    timer.current = window.setInterval(load, REFRESH_MS);
    document.addEventListener('visibilitychange', load);
    return () => { subs.delete(f); if (timer.current) window.clearInterval(timer.current); document.removeEventListener('visibilitychange', load); };
  }, []);
  if (!q) return error ? <Note tone="warning">Account queues: {error}</Note> : <div className="fx-empty">Loading the account queues…</div>;
  const drop = (lane: string) => (e: DragEvent) => { e.preventDefault(); setOver(''); const id = e.dataTransfer.getData(DRAG_TYPE); if (id && inLane(q, id) !== (lane === 'auto' ? '' : lane)) void sendBuild(rt, id, lane); };
  const dragOver = (lane: string) => (e: DragEvent) => { if (e.dataTransfer.types.includes(DRAG_TYPE)) { e.preventDefault(); setOver(lane); } };
  const card = (id: string, state: 'running' | 'waiting' | 'next') => (
    <li key={`${state}-${id}`} className={`pd-card oq-card is-${state}`} draggable={state !== 'running'} data-fx-ctx-target={CTX_TARGET} data-fx-ctx-payload={id}
      onDragStart={(e) => { e.dataTransfer.setData(DRAG_TYPE, id); e.dataTransfer.effectAllowed = 'move'; }}
      title={state === 'running' ? 'Running on this account' : `${q.why[id] || 'Waiting'} · hold (or right-click) to send it to another account, or drag it to another lane`}>
      <Icon name={state === 'running' ? 'play' : state === 'next' ? 'arrow-right' : 'clock'} size={13} />
      <span className="oq-card__title">{q.titles[id] || id}</span>
      {!compact && state === 'waiting' && q.why[id] && <span className="fx-small fx-muted oq-card__why">{q.why[id]}</span>}
    </li>
  );
  const lane = (key: string, title: string, sub: string, l: Lane | null, ids: { running: string[]; waiting: string[] }) => (
    <section key={key} className={`pd-card oq-lane${over === key ? ' is-over' : ''}${l?.kind === 'api' ? ' is-api' : ''}`} aria-label={`${title} queue`}
      onDragOver={dragOver(key)} onDragLeave={() => setOver('')} onDrop={drop(key)}>
      <div className="pd-card__top">
        <h3 className="pd-card__title">{title}</h3>
        {l && <Chip tone={l.kind === 'api' ? 'accent' : undefined}>{l.running.length}/{l.parallel}</Chip>}
      </div>
      <p className="fx-small fx-muted">{sub}</p>
      <ul className="oq-list">
        {ids.running.map((id) => card(id, 'running'))}
        {ids.waiting.map((id) => card(id, l?.next.includes(id) ? 'next' : 'waiting'))}
        {!ids.running.length && !ids.waiting.length && <li className="fx-small fx-muted oq-empty">Empty: drop a build here</li>}
      </ul>
    </section>
  );
  return (
    <div className="fx-stack" data-axf-account-queues="">
      {error && <Note tone="warning">{error}</Note>}
      <div className="oq-lanes">
        {q.accounts.map((l) => lane(l.name, laneTitle(l), [l.kind === 'api' ? 'API key, billed per token, under its caps' : 'subscription', l.fable ? 'Fable' : 'Opus only', l.why].filter(Boolean).join(' · '), l, { running: l.running, waiting: l.waiting }))}
        {lane('auto', 'Shared queue', 'any free account takes these (Fable phases to accounts with Fable)', null, { running: [], waiting: q.shared })}
      </div>
    </div>
  );
}
