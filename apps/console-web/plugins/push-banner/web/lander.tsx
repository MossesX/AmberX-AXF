/**
 * Lander view (build merge-all-ready-buttons-server-side-lander, Brett Nov 12 2026). It replaces the merge queue view:
 * the server-side lander (land/lander.mjs, axf-lander.service on the VPS) merges ready PRs one at a time through the
 * main gate, and finished builds merge themselves. The banner chip shows live progress ("PR 412 Testing · 160 ready ·
 * 3 blocked · 5 merged") and Merge all ready; the view lists what is merging, what is blocked (and why), what is ready
 * (each with Merge) and what merged lately. Every button is also a REST route, an MCP tool, a CLI command and a voice
 * command (plugin.json lander-*). Theme tokens and framework controls only.
 */
import { useEffect, useSyncExternalStore } from 'react';
import { Button, Icon, PriorityTag } from '@console/axf/react';
import { api } from './store';

export interface LanderItem { pr: number; title: string; url?: string; branch?: string; build?: string; state: 'ready' | 'catching' | 'testing' | 'merging' | 'blocked' | 'waiting'; why?: string; finished?: boolean; requested?: boolean }
export interface LanderMerged { pr: number; title: string; build?: string; at: string }
export interface LanderState {
  on: boolean; drain: boolean; stop: boolean; alive: boolean; heartbeat?: string; restarts?: number; at?: string;
  current: { pr: number; phase: string; why?: string; since?: string } | null;
  items: LanderItem[]; merged: LanderMerged[];
  account: { account: string; label: string; why: string };
  progress: { text: string; now: string; ready: number; blocked: number; merged: number };
  chip: { label: string; count: number; tone: string };
}

const POLL_MS = 15_000;
let lstate: { data: LanderState | null; error: string; busy: string; note: string } = { data: null, error: '', busy: '', note: '' };
const subs = new Set<() => void>();
const set = (p: Partial<typeof lstate>) => { lstate = { ...lstate, ...p }; subs.forEach((f) => f()); };
export const useLander = () => useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => lstate);

export async function loadLander(): Promise<void> {
  try { set({ data: await api.call<LanderState>('lander'), error: '' }); }
  catch (e) { set({ error: e instanceof Error ? e.message : String(e) }); }
}
let timer: ReturnType<typeof setInterval> | null = null;
export function startLander(): void { if (timer) return; void loadLander(); timer = setInterval(() => void loadLander(), POLL_MS); }

type Cmd = 'merge-all' | 'merge' | 'unblock' | 'stop';
export async function landerCommand(cmd: Cmd, body: { pr?: number } | null, done: string): Promise<void> {
  set({ busy: `${cmd}:${body?.pr ?? ''}`, note: '' });
  try { set({ data: await api.post<LanderState>(`lander/${cmd}`, body ?? undefined), note: `${done} The lander takes it within a minute.` }); }
  catch (e) { set({ note: e instanceof Error ? e.message : String(e) }); }
  finally { set({ busy: '' }); }
}

const WORD: Record<LanderItem['state'], string> = { ready: 'Ready', catching: 'Updating from main', testing: 'Testing', merging: 'Merging', blocked: 'Blocked', waiting: 'Not ready' };
const ICON: Record<LanderItem['state'], string> = { ready: 'check-circle', catching: 'refresh', testing: 'clock', merging: 'branch', blocked: 'x-circle', waiting: 'pause' };

function Row({ it }: { it: LanderItem }) {
  const l = useLander();
  const busy = l.busy.endsWith(`:${it.pr}`);
  const live = ['catching', 'testing', 'merging'].includes(it.state);
  return (
    <li className={`axp-push-banner__item axp-lander__row is-${it.state}`}>
      <span className="axp-push-banner__entry">
        <span className="axp-push-banner__line">
          {it.url ? <a className="axp-push-banner__name" href={it.url} target="_blank" rel="noreferrer">#{it.pr} {it.title}</a> : <span className="axp-push-banner__name">#{it.pr} {it.title}</span>}
          <PriorityTag build={it.build} />
        </span>
        <span className="axp-push-banner__meta">
          <span className={`axp-lander__state is-${it.state}`}><Icon name={ICON[it.state]} size={14} /> {WORD[it.state]}</span>
          {it.finished ? ' · build just finished' : it.requested ? ' · asked to merge' : ''}
        </span>
        {it.why && <span className="axp-push-banner__sub axp-lander__why">{it.why.replace(/^blocked: /, '')}</span>}
      </span>
      {!live && (
        <div className="axp-push-banner__acts" role="toolbar" aria-label={`Lander #${it.pr}`}>
          {it.state === 'blocked'
            ? <Button size="sm" tone="neutral" icon="refresh" disabled={busy} title="Clear the block and try it again as it is" onClick={() => void landerCommand('unblock', { pr: it.pr }, `#${it.pr} will be tried again.`)}>Try again</Button>
            : <Button size="sm" tone="primary" icon="branch" disabled={busy || it.state === 'waiting' || it.requested} title="Merge this PR next: main merged in, tests, then main" onClick={() => void landerCommand('merge', { pr: it.pr }, `#${it.pr} merges next.`)}>Merge</Button>}
        </div>
      )}
    </li>
  );
}

function Section({ title, list, tone = '' }: { title: string; list: LanderItem[]; tone?: string }) {
  if (!list.length) return null;
  return (
    <section className={`axp-push-banner__group${tone ? ` is-${tone}` : ''}`} aria-label={title}>
      <h4 className="axp-push-banner__group-title">{title} <span>{list.length}</span></h4>
      <ul className="axp-push-banner__list">{list.map((it) => <Row key={it.pr} it={it} />)}</ul>
    </section>
  );
}

/** Merge all ready (and Stop while it drains): the banner and the page show the same button. */
export function MergeAllButton() {
  const l = useLander();
  const d = l.data;
  if (!d) return null;
  if (d.drain) return <Button size="sm" tone="quiet" icon="pause" disabled={!!l.busy} title="Stop after the PR in flight; finished builds still merge themselves" onClick={() => void landerCommand('stop', null, 'Merge all ready stops after the PR in flight.')}>Stop</Button>;
  return <Button size="sm" tone="primary" icon="branch" disabled={!!l.busy || !d.progress.ready} title="Merge every ready PR, one at a time through the main gate" onClick={() => void landerCommand('merge-all', null, `Merging ${d.progress.ready} ready PR(s), one at a time.`)}>Merge all ready</Button>;
}

/** The whole view: merging now, blocked (and why), ready (each with Merge), not ready, merged lately. */
export function LanderView({ compact = false }: { compact?: boolean }) {
  const l = useLander();
  useEffect(() => { startLander(); }, []);
  const d = l.data;
  if (!d) return <p className="fx-small fx-muted">{l.error || 'Reading the lander…'}</p>;
  const by = (st: LanderItem['state'][]) => d.items.filter((x) => st.includes(x.state));
  return (
    <div className="axp-lander fx-stack">
      <p className="fx-small fx-muted">
        Ready PRs merge into main one at a time: main is merged in when it is behind (never a force-push), the tests run on that exact head, and it merges when they pass. A red or conflicted PR is blocked with the reason until it gets a new commit. Builds merge themselves the moment they finish.
        {d.at ? ` Checked ${new Date(d.at).toLocaleTimeString()}.` : ''}
      </p>
      <p className={`fx-small axp-push-banner__note${d.alive ? '' : ' is-danger'}`} role="status">
        {d.alive ? d.progress.text : `The lander service isn't running (last heartbeat ${d.heartbeat ? new Date(d.heartbeat).toLocaleTimeString() : 'never'}); systemd restarts it.`}
        {d.account.label ? ` · conflict fixer on ${d.account.label}` : ''}
      </p>
      {l.note && <p className="fx-small axp-push-banner__note" role="status">{l.note}</p>}
      <Section title="Merging now" list={by(['catching', 'testing', 'merging'])} />
      <Section title="Blocked" tone="warning" list={by(['blocked'])} />
      {!compact && <Section title="Ready" list={by(['ready'])} />}
      {!compact && <Section title="Not ready" list={by(['waiting'])} />}
      {d.merged.length > 0 && <p className="fx-small fx-muted">Merged lately: {d.merged.slice(-8).reverse().map((m) => `#${m.pr}`).join(', ')}.</p>}
      <div className="axp-push-banner__foot" role="toolbar" aria-label="Lander">
        <MergeAllButton />
        <Button size="sm" tone="quiet" icon="refresh" onClick={() => void loadLander()}>Check now</Button>
      </div>
    </div>
  );
}

/** The banner chip: live progress; tapping it opens the lander in the banner. */
export function LanderChip({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const l = useLander();
  useEffect(() => { startLander(); }, []);
  const d = l.data;
  if (!d) return null;
  return (
    <button type="button" className={`fx-chip axp-lander__chip is-${d.alive ? d.chip.tone : 'danger'}`} aria-expanded={open} title={`${d.progress.text}: open the lander`} onClick={(e) => { e.stopPropagation(); onToggle(); }}>
      <Icon name="branch" size={14} /> {d.alive ? d.progress.now === 'idle' || d.progress.now === 'off' ? d.chip.label : d.progress.now : 'Lander down'}{d.progress.blocked ? ` · ${d.progress.blocked} blocked` : ''}
    </button>
  );
}
