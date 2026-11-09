/**
 * Queues & API (build multi-queues-api-panel, Nov 9 2026). Brett: "we need to make an API job control panel to set rules
 * for it and we're gonna need a separate queue for the API jobs … I need to be able to make multiple queue lists."
 *
 * One screen (view build-queues: menu Builds → Queues & API, link `view:build-queues`, action build-queues.open[:<queue or build>]; ?queue=<id>&build=<id>
 * on the URL scrolls to that queue or build): every named queue with its queued builds and live running
 * jobs, Pending, the API accounts (key set / missing, never the value; caps, spend today and this week) and the rules
 * editor (overflow, routing by category or model, max cost per job, each on or off). Builds move by drag (a card onto a
 * queue or Pending) or the Move to picker. How the sections sit is a `settings` asset (three ship in ../assets/settings,
 * the UI Review options; the pick is the setting axf.build-orchestrator.queues.view). Every change goes through
 * GET/POST /queues… (queues.mjs), the same code the CLI, MCP and voice run.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { DragEvent, ReactNode } from 'react';
import { Button, Chip, Container, Icon, Meter, Note, PriorityTag, SelectField, Switch, TextField, useRuntime } from '@console/axf/react';
import { pluginApi } from '@console/plugins';
import columns from '../assets/settings/build-queues-columns.json';
import stacked from '../assets/settings/build-queues-stacked.json';
import apiFirst from '../assets/settings/build-queues-api-first.json';
import './queues.css';

export const QUEUES_VIEW_KEY = 'axf.build-orchestrator.queues.view';
export const QUEUE_LAYOUTS = [columns, stacked, apiFirst] as const;
type Section = 'api' | 'queues' | 'rules';

type Row = { id: string; title: string; status?: string; steps?: { done: number; total: number }; nextModel?: string; said?: string; pipeline?: { account?: string; launchedAt?: string; note?: string } | null };
type QRow = Row & { wait: string; launch: { account: string; model: string } | null; apiOk: boolean; asked: string };
type RRow = Row & { claim: { account: string; kind: string; maxCostUsd: number; overflowFrom: string } | null; costUsd: number };
type Queue = { id: string; name: string; paused: boolean; uses: 'subscription' | 'api' | 'both'; apiAccounts: string[]; subAccounts: string[]; maxParallel: number; defaultModel: string; priority: number; costCapUsd: number; note: string; position: number;
  queued: QRow[]; running: RRow[]; stats: { running: number; queued: number; spentToday: number; full: boolean }; maxCostUsd: number };
type Spend = { day: number; week: number; dayCap: number; weekCap: number; state: 'ok' | 'warn' | 'capped'; why: string };
type ApiAcct = { name: string; label: string; enabled: boolean; setUp: boolean; key: 'set' | 'missing'; running: number; building: number; costToday: number; costWeek: number; spend: Spend | null; why: string };
type Rule = { id: string; name: string; kind: 'overflow' | 'route' | 'max-cost'; enabled: boolean; from?: string; to?: string; queue?: string; maxCostUsd?: number; when?: { categories: string[]; models: string[] } };
type Status = { ok: boolean; at: string; owner: boolean; queues: Queue[]; pending: Row[]; api: ApiAcct[]; rules: Rule[]; approvals: Record<string, { by: string; at: string; maxCostUsd: number }>; asks: Record<string, string>;
  subscriptions: { name: string; usable: boolean }[]; plan: { launches: { id: string; account: string; queue: string }[]; idle: { reason: string } | null } };

const api = pluginApi('build-orchestrator', 'Build queues', { unavailable: 'The build orchestrator is switched off or its server part is not running.' });
const REFRESH_MS = 10_000;
const usd = (n: number) => `$${(n ?? 0).toFixed(2)}`;
const USES = [{ value: 'subscription', label: 'Subscription accounts' }, { value: 'api', label: 'API accounts (billed per token)' }, { value: 'both', label: 'Both (subscriptions first)' }];
const MODELS = [{ value: '', label: 'As pinned on each step' }, { value: 'opus', label: 'Opus' }, { value: 'fable', label: 'Fable' }];
const KINDS = [{ value: 'overflow', label: 'Overflow: subscriptions full → another queue' }, { value: 'route', label: 'Route by category or model' }, { value: 'max-cost', label: 'Max cost per job' }];
/** ?queue=<id>&build=<id> on the console URL (query or hash) picks what the screen scrolls to. */
let focusTarget = '';
/** What the build-queues.open:<id> action asked the screen to scroll to (a queue or a build id). */
export function setQueuesFocus(id: string) { focusTarget = String(id || '').slice(0, 80); }
const hashParam = (k: string) => new URLSearchParams(location.search).get(k) ?? new URLSearchParams(location.hash.split('?')[1] ?? '').get(k) ?? '';

function useLayout() {
  const rt = useRuntime();
  const id = useSyncExternalStore((fn) => rt.settings.subscribe(fn), () => String(rt.settings.get(QUEUES_VIEW_KEY) ?? ''), () => '');
  return QUEUE_LAYOUTS.find((a) => a.id === id) ?? columns;
}

export function QueuesPage() {
  const rt = useRuntime();
  const layout = useLayout();
  const [s, setS] = useState<Status | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [adding, setAdding] = useState(false);
  const timer = useRef<number | null>(null);
  const load = async () => {
    try { const r = await api.call<Status & { error?: string }>('queues'); if (!r.ok) throw new Error(r.error); setS(r); setError(''); }
    catch (e) { setError((e as Error).message); }
  };
  useEffect(() => {
    void load();
    const tickIt = () => { if (document.visibilityState === 'visible') void load(); };
    timer.current = window.setInterval(tickIt, REFRESH_MS);
    document.addEventListener('visibilitychange', tickIt);
    return () => { if (timer.current) window.clearInterval(timer.current); document.removeEventListener('visibilitychange', tickIt); };
  }, []);
  // deep link: #/build-queues?queue=api&build=<id> scrolls to it once the data is in
  useEffect(() => {
    if (!s) return;
    const id = focusTarget || hashParam('build') || hashParam('queue'); focusTarget = '';
    if (id) (document.querySelector(`[data-queue-build="${CSS.escape(id)}"]`) ?? document.querySelector(`[data-queue-id="${CSS.escape(id)}"]`))?.scrollIntoView({ block: 'center' });
  }, [s === null]);
  const act = async (path: string, body: Record<string, unknown>, what: string) => {
    setBusy(path + JSON.stringify(body));
    try { const r = await api.post<{ ok: boolean; error?: string; log?: string[] }>(path, body); if (!r.ok) throw new Error(r.error); rt.toast(r.log?.[0] ?? what, 'success'); rt.terminal.log('queues', r.log?.join(' ') ?? what, 'ok'); await load(); return true; }
    catch (e) { rt.toast((e as Error).message, 'danger'); rt.terminal.log('queues', (e as Error).message, 'error'); return false; }
    finally { setBusy(''); }
  };
  if (!s) return <div className="fx-empty">{error ? `Queues: ${error}` : 'Loading the queues…'}</div>;
  const ctx: Ctx = { s, busy: !!busy, act };
  const sections: Record<Section, ReactNode> = {
    api: <Container key="api" title="API accounts" icon="key" collapsible defaultOpen={layout.data.open.includes('api')} className="bq-section"><ApiAccounts ctx={ctx} /></Container>,
    queues: <Container key="queues" title={`Queues (${s.queues.length})`} icon="list" collapsible defaultOpen={layout.data.open.includes('queues')} className="bq-section"><QueueBoard ctx={ctx} view={layout.data.view} /></Container>,
    rules: <Container key="rules" title={`Rules (${s.rules.length})`} icon="settings" collapsible defaultOpen={layout.data.open.includes('rules')} className="bq-section"><Rules ctx={ctx} /></Container>,
  };
  return (
    <div className="fx-stack fx-stack--lg" data-bq-view={layout.data.view}>
      <header className="fx-pagehead">
        <div>
          <p className="fx-eyebrow">Build orchestrator · {s.queues.reduce((n, q) => n + q.running.length, 0)} running · {s.queues.reduce((n, q) => n + q.queued.length, 0)} queued · {s.pending.length} pending</p>
          <h1>Queues &amp; API</h1>
          <p className="fx-muted">Your queue lists, what runs where, the API keys' spend and the rules that send work to them. Drag a build onto a queue, or use Move to.</p>
        </div>
        <div className="bq-toolbar" role="toolbar" aria-label="Queues">
          <Button icon="plus" tone="primary" onClick={() => setAdding((v) => !v)}>New queue</Button>
          <Button icon="refresh" onClick={() => void load()}>Reload</Button>
          <SelectField label="Layout" value={layout.id} options={QUEUE_LAYOUTS.map((a) => ({ value: a.id, label: a.name.replace('Queues & API: ', '') }))} onChange={(v) => rt.settings.set(QUEUES_VIEW_KEY, v)} />
        </div>
      </header>
      {error && <Note tone="warning">{error}</Note>}
      {s.plan.idle && <Note tone="info">{s.plan.idle.reason}</Note>}
      {adding && <QueueForm ctx={ctx} onDone={() => setAdding(false)} />}
      {layout.data.order.map((k) => sections[k as Section])}
    </div>
  );
}

type Ctx = { s: Status; busy: boolean; act: (path: string, body: Record<string, unknown>, what: string) => Promise<boolean> };

/* ---------------- API accounts ---------------- */

function ApiAccounts({ ctx }: { ctx: Ctx }) {
  const { s } = ctx;
  if (!s.api.length) return <div className="fx-empty">No API account is set up. Add one in Settings → Plugins → Claude accounts → Job routing.</div>;
  return (
    <div className="bq-api">
      {s.api.map((a) => {
        const sp = a.spend;
        return (
          <article key={a.name} className="bq-api__acct" data-api-account={a.name}>
            <div className="bq-row">
              <b>{a.label || a.name}</b><span className="fx-muted fx-small fx-mono">{a.name}</span>
              <Chip tone={a.key === 'set' ? 'success' : 'warning'}>{a.key === 'set' ? 'Key set' : 'Key missing'}</Chip>
              <Chip tone={a.enabled ? 'accent' : undefined}>{a.setUp ? (a.enabled ? 'On' : 'Off') : 'Not set up'}</Chip>
              {sp && sp.state !== 'ok' && <Chip tone={sp.state === 'capped' ? 'danger' : 'warning'}>{sp.state === 'capped' ? 'Stopped at cap' : 'Near cap'}</Chip>}
            </div>
            <p className="fx-small fx-muted">{a.running}/{a.building} running · {usd(a.costToday)} today · {usd(a.costWeek)} this week</p>
            {sp && (sp.dayCap || sp.weekCap) ? (
              <div className="bq-meters">
                {sp.dayCap > 0 && <Meter small value={Math.min(100, (sp.day / sp.dayCap) * 100)} label={`${usd(sp.day)} of ${usd(sp.dayCap)} today`} />}
                {sp.dayCap > 0 && <span className="fx-small">{usd(sp.day)} of {usd(sp.dayCap)} today</span>}
                {sp.weekCap > 0 && <Meter small value={Math.min(100, (sp.week / sp.weekCap) * 100)} label={`${usd(sp.week)} of ${usd(sp.weekCap)} this week`} />}
                {sp.weekCap > 0 && <span className="fx-small">{usd(sp.week)} of {usd(sp.weekCap)} this week</span>}
              </div>
            ) : <p className="fx-small fx-muted">No spend cap</p>}
            {a.key === 'missing' && <p className="fx-small">To add the key: Terminal → VPS host → <span className="fx-mono">claude-account savekey {a.name}</span>, paste it at the hidden prompt.</p>}
            {a.why && a.key === 'set' && <p className="fx-small fx-muted">{a.why}</p>}
          </article>
        );
      })}
      <p className="fx-small fx-muted">Caps are set per account in Settings → Plugins → Claude accounts → Job routing (raising one is your click only). Every job on an API key stops at a cap; you get a notice at 80% and at the stop.</p>
    </div>
  );
}

/* ---------------- queues ---------------- */

const DRAG_TYPE = 'application/x-axf-build';
function onDragStart(e: DragEvent, id: string) { e.dataTransfer.setData(DRAG_TYPE, id); e.dataTransfer.setData('text/plain', id); e.dataTransfer.effectAllowed = 'move'; }

function DropZone({ onDrop, className, children, label, ...rest }: { onDrop: (id: string) => void; className: string; children: ReactNode; label: string } & Record<string, unknown>) {
  const [over, setOver] = useState(false);
  return (
    <section className={`${className} ${over ? 'is-drop' : ''}`} aria-label={label} {...rest}
      onDragOver={(e) => { if (e.dataTransfer.types.includes(DRAG_TYPE)) { e.preventDefault(); setOver(true); } }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); const id = e.dataTransfer.getData(DRAG_TYPE); if (id) onDrop(id); }}>
      {children}
    </section>
  );
}

function QueueBoard({ ctx, view }: { ctx: Ctx; view: string }) {
  const { s, act } = ctx;
  const to = (id: string, q: Queue) => act('queues/assign', { build: id, queue: q.id }, `${id} → ${q.name}`);
  return (
    <div className={view === 'columns' ? 'bq-cols' : 'fx-stack'}>
      {s.queues.map((q, i) => (
        <DropZone key={q.id} className="bq-queue" label={`Queue ${q.name}`} data-queue-id={q.id} onDrop={(id) => void to(id, q)}>
          <QueueHead ctx={ctx} q={q} first={i === 0} last={i === s.queues.length - 1} />
          {q.running.map((r) => <RunningCard key={r.id} r={r} />)}
          {q.queued.length === 0 && q.running.length === 0 && <div className="fx-empty">Empty. Drag a build here or use Move to.</div>}
          {q.queued.map((r) => <QueuedCard key={r.id} ctx={ctx} q={q} r={r} />)}
        </DropZone>
      ))}
      <DropZone className="bq-queue bq-queue--pending" label="Pending" data-queue-id="pending" onDrop={(id) => void act('queues/pending', { build: id }, `${id} → Pending`)}>
        <div className="bq-qhead"><h3 className="bq-qhead__title">Pending <span className="fx-muted fx-small">{s.pending.length}</span></h3></div>
        {s.pending.length === 0 ? <div className="fx-empty">Nothing pending.</div> : s.pending.map((r) => (
          <article key={r.id} className="bq-card" draggable onDragStart={(e) => onDragStart(e, r.id)} data-queue-build={r.id}>
            <div className="bq-row"><b>{r.title}</b><PriorityTag build={r.id} /></div>
            <p className="fx-small fx-muted fx-mono">{r.id}{r.steps ? ` · ${r.steps.done}/${r.steps.total} steps` : ''}</p>
            <MoveTo ctx={ctx} id={r.id} current="" />
          </article>
        ))}
      </DropZone>
    </div>
  );
}

function QueueHead({ ctx, q, first, last }: { ctx: Ctx; q: Queue; first: boolean; last: boolean }) {
  const { act, busy } = ctx;
  const [edit, setEdit] = useState(false);
  const uses = q.uses === 'api' ? `API${q.apiAccounts.length ? `: ${q.apiAccounts.join(', ')}` : ''}` : q.uses === 'both' ? 'Subscriptions + API' : 'Subscriptions';
  return (
    <div className="bq-qhead">
      <div className="bq-row">
        <h3 className="bq-qhead__title">{q.name}</h3>
        <Chip tone={q.uses === 'subscription' ? undefined : 'accent'}>{uses}</Chip>
        {q.paused && <Chip tone="warning">Paused</Chip>}
        <span className="fx-small">{q.stats.running}/{q.maxParallel} running · {q.queued.length} queued · priority {q.priority}</span>
      </div>
      <p className="fx-small fx-muted">
        {q.defaultModel ? `Default model ${q.defaultModel} · ` : ''}
        {q.costCapUsd ? `${usd(q.stats.spentToday)} of ${usd(q.costCapUsd)} cap today` : 'No cost cap'}
        {q.maxCostUsd ? ` · max ${usd(q.maxCostUsd)} a job` : ''}{q.note ? ` · ${q.note}` : ''}
      </p>
      {q.costCapUsd > 0 && <Meter small value={Math.min(100, (q.stats.spentToday / q.costCapUsd) * 100)} label={`${usd(q.stats.spentToday)} of ${usd(q.costCapUsd)} today`} />}
      <div className="bq-toolbar" role="toolbar" aria-label={`Queue ${q.name}`}>
        <Button size="sm" icon={q.paused ? 'play' : 'pause'} disabled={busy} onClick={() => void act('queues/pause', { queue: q.id, paused: !q.paused }, `${q.name} ${q.paused ? 'resumed' : 'paused'}`)}>{q.paused ? 'Resume' : 'Pause'}</Button>
        <Button size="sm" icon="arrow-up" disabled={busy || first} title="Move this list up" onClick={() => void act('queues/move', { queue: q.id, to: 'up' }, `${q.name} up`)}>Up</Button>
        <Button size="sm" icon="arrow-down" disabled={busy || last} title="Move this list down" onClick={() => void act('queues/move', { queue: q.id, to: 'down' }, `${q.name} down`)}>Down</Button>
        <Button size="sm" icon="edit" onClick={() => setEdit((v) => !v)}>Settings</Button>
        <Button size="sm" tone="danger" icon="trash" disabled={busy} confirm={`Delete the ${q.name} queue? Its builds move to another queue.`} onClick={() => void act('queues/delete', { queue: q.id }, `${q.name} deleted`)}>Delete</Button>
      </div>
      {edit && <QueueForm ctx={ctx} q={q} onDone={() => setEdit(false)} />}
    </div>
  );
}

function QueueForm({ ctx, q, onDone }: { ctx: Ctx; q?: Queue; onDone: () => void }) {
  const { s, act, busy } = ctx;
  const [f, setF] = useState({ name: q?.name ?? '', uses: q?.uses ?? 'subscription', maxParallel: String(q?.maxParallel ?? 2), priority: String(q?.priority ?? 5), defaultModel: q?.defaultModel ?? '', costCapUsd: String(q?.costCapUsd ?? 0), apiAccounts: (q?.apiAccounts ?? []).join(', '), note: q?.note ?? '' });
  const set = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v }));
  const body = { name: f.name.trim(), uses: f.uses, maxParallel: Number(f.maxParallel) || 1, priority: Number(f.priority) || 5, defaultModel: f.defaultModel, costCapUsd: Number(f.costCapUsd) || 0, apiAccounts: f.apiAccounts.split(',').map((x) => x.trim()).filter(Boolean), note: f.note };
  const save = async () => { const ok = q ? await act('queues/update', { queue: q.id, ...body }, `${body.name} saved`) : await act('queues/create', body, `${body.name} created`); if (ok) onDone(); };
  return (
    <div className="bq-form">
      <TextField label="Name" value={f.name} onChange={set('name')} required />
      <SelectField label="Accounts it may use" value={f.uses} options={USES} onChange={set('uses')} hint={f.uses !== 'subscription' && !s.owner ? 'API use for a queue is your own click' : undefined} />
      {f.uses !== 'subscription' && <TextField label="API accounts" value={f.apiAccounts} onChange={set('apiAccounts')} placeholder={s.api.map((a) => a.name).join(', ')} hint="Comma list; empty = any API account" mono />}
      <TextField label="Max parallel" type="number" value={f.maxParallel} onChange={set('maxParallel')} />
      <TextField label="Priority (1 starts first)" type="number" value={f.priority} onChange={set('priority')} />
      <SelectField label="Default model" value={f.defaultModel} options={MODELS} onChange={set('defaultModel')} hint="Used only for steps with no model pinned" />
      <TextField label="Cost cap per 24 h (USD, 0 = none)" type="number" value={f.costCapUsd} onChange={set('costCapUsd')} hint="Lowering is anyone's; raising is your own click" />
      <TextField label="Note" value={f.note} onChange={set('note')} />
      <div className="bq-toolbar" role="toolbar" aria-label="Queue settings">
        <Button tone="primary" icon="check" disabled={busy || !f.name.trim()} onClick={() => void save()}>{q ? 'Save' : 'Create queue'}</Button>
        <Button icon="x" onClick={onDone}>Cancel</Button>
      </div>
    </div>
  );
}

function MoveTo({ ctx, id, current }: { ctx: Ctx; id: string; current: string }) {
  const { s, act, busy } = ctx;
  const options = [...s.queues.filter((q) => q.id !== current).map((q) => ({ value: q.id, label: q.name })), ...(current ? [{ value: 'pending', label: 'Pending' }] : [])];
  return (
    <SelectField label="Move to" value="" empty="Choose…" options={options} disabled={busy}
      onChange={(v) => { if (!v) return; void (v === 'pending' ? act('queues/pending', { build: id }, `${id} → Pending`) : act('queues/assign', { build: id, queue: v }, `${id} → ${v}`)); }} />
  );
}

function QueuedCard({ ctx, q, r }: { ctx: Ctx; q: Queue; r: QRow }) {
  const { act, busy, s } = ctx;
  const needsOk = /needs your OK/.test(r.wait);
  return (
    <article className="bq-card" draggable onDragStart={(e) => onDragStart(e, r.id)} data-queue-build={r.id}>
      <div className="bq-row"><b>{r.title}</b><PriorityTag build={r.id} />{r.apiOk && <Chip tone="success">API OK</Chip>}</div>
      <p className="fx-small fx-muted fx-mono">{r.id}{r.steps ? ` · ${r.steps.done}/${r.steps.total} steps` : ''}{r.nextModel ? ` · ${r.nextModel} next` : ''}</p>
      {r.launch ? <p className="fx-small"><Icon name="play" size={13} /> Next tick: starts on <b>{r.launch.account}</b></p> : r.wait && <p className="fx-small fx-muted"><Icon name="clock" size={13} /> {r.wait}</p>}
      <div className="bq-toolbar" role="toolbar" aria-label={`Build ${r.id}`}>
        {needsOk && s.owner && <Button size="sm" tone="primary" icon="check" disabled={busy} title="Let this build run on an API key (billed per token)" onClick={() => void act('queues/approve', { build: r.id }, `${r.id} may run on API keys`)}>OK to run on API</Button>}
        {needsOk && !s.owner && <span className="fx-small fx-muted">Waiting for Brett's OK</span>}
        {r.apiOk && <Button size="sm" icon="x" disabled={busy} onClick={() => void act('queues/revoke', { build: r.id }, `${r.id}: API OK withdrawn`)}>Withdraw API OK</Button>}
      </div>
      <MoveTo ctx={ctx} id={r.id} current={q.id} />
    </article>
  );
}

function RunningCard({ r }: { r: RRow }) {
  const c = r.claim;
  return (
    <article className="bq-card is-running" data-queue-build={r.id}>
      <div className="bq-row"><Icon name="play" size={13} /><b>{r.title}</b>{c?.kind === 'api' && <Chip tone="accent">API</Chip>}{c?.overflowFrom && <Chip>overflow</Chip>}</div>
      <p className="fx-small fx-muted">{c?.account || r.pipeline?.account || '?'}{r.steps ? ` · ${r.steps.done}/${r.steps.total} steps` : ''}{c?.kind === 'api' ? ` · ${usd(r.costUsd)}${c.maxCostUsd ? ` of ${usd(c.maxCostUsd)} max` : ''}` : ''}</p>
      {c?.kind === 'api' && c.maxCostUsd > 0 && <Meter small value={Math.min(100, (r.costUsd / c.maxCostUsd) * 100)} label={`${usd(r.costUsd)} of ${usd(c.maxCostUsd)}`} />}
    </article>
  );
}

/* ---------------- rules ---------------- */

const qName = (s: Status, id = '') => (id ? s.queues.find((q) => q.id === id)?.name ?? id : 'any queue');
function ruleLine(s: Status, r: Rule) {
  if (r.kind === 'overflow') return `When ${qName(s, r.from)} has no free subscription account, start its builds through ${qName(s, r.to)}.`;
  if (r.kind === 'route') return `Builds ${[r.when?.categories.length ? `in ${r.when.categories.join(', ')}` : '', r.when?.models.length ? `whose next step is ${r.when.models.join('/')}` : ''].filter(Boolean).join(' and ')} queue in ${qName(s, r.to)}.`;
  return `An API job in ${qName(s, r.queue)} stops at ${usd(r.maxCostUsd ?? 0)}.`;
}

function Rules({ ctx }: { ctx: Ctx }) {
  const { s, act, busy } = ctx;
  const [kind, setKind] = useState<Rule['kind']>('overflow');
  const [f, setF] = useState({ name: '', from: 'main', to: 'api', queue: '', categories: '', models: '', maxCostUsd: '5' });
  const set = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v }));
  const qOpts = s.queues.map((q) => ({ value: q.id, label: q.name }));
  const add = () => {
    const base = { kind, name: f.name.trim() || undefined, enabled: true };
    const rule = kind === 'overflow' ? { ...base, from: f.from, to: f.to } : kind === 'route' ? { ...base, to: f.to, when: { categories: f.categories.split(',').map((x) => x.trim()).filter(Boolean), models: f.models ? [f.models] : [] } } : { ...base, queue: f.queue, maxCostUsd: Number(f.maxCostUsd) || 0 };
    void act('queues/rule', { op: 'add', rule }, 'Rule added');
  };
  return (
    <div className="fx-stack">
      {s.rules.length === 0 && <div className="fx-empty">No rules yet.</div>}
      {s.rules.map((r, i) => (
        <div key={r.id} className="bq-rule">
          <Switch label={r.name} hint={ruleLine(s, r)} checked={r.enabled} disabled={busy} onChange={(v) => void act('queues/rule', { op: v ? 'on' : 'off', rule: r.id }, `${r.name} ${v ? 'on' : 'off'}`)} />
          <div className="bq-toolbar" role="toolbar" aria-label={`Rule ${r.name}`}>
            <Button size="sm" icon="arrow-up" disabled={busy || i === 0} onClick={() => void act('queues/rule', { op: 'move', rule: r.id, to: 'up' }, `${r.name} up`)}>Up</Button>
            <Button size="sm" icon="arrow-down" disabled={busy || i === s.rules.length - 1} onClick={() => void act('queues/rule', { op: 'move', rule: r.id, to: 'down' }, `${r.name} down`)}>Down</Button>
            <Button size="sm" tone="danger" icon="trash" disabled={busy} confirm={`Remove the rule ${r.name}?`} onClick={() => void act('queues/rule', { op: 'remove', rule: r.id }, `${r.name} removed`)}>Remove</Button>
          </div>
        </div>
      ))}
      <div className="bq-form">
        <SelectField label="New rule" value={kind} options={KINDS} onChange={(v) => setKind(v as Rule['kind'])} />
        <TextField label="Name" value={f.name} onChange={set('name')} placeholder="Optional" />
        {kind === 'overflow' && <SelectField label="From" value={f.from} options={qOpts} onChange={set('from')} />}
        {kind !== 'max-cost' && <SelectField label={kind === 'overflow' ? 'To' : 'Queue'} value={f.to} options={qOpts} onChange={set('to')} />}
        {kind === 'route' && <TextField label="Categories" value={f.categories} onChange={set('categories')} placeholder="docs, ui" hint="Comma list" />}
        {kind === 'route' && <SelectField label="Next step's model" value={f.models} empty="Any model" options={[{ value: 'opus', label: 'Opus' }, { value: 'fable', label: 'Fable' }]} onChange={set('models')} />}
        {kind === 'max-cost' && <SelectField label="Queue" value={f.queue} empty="Any queue" options={qOpts} onChange={set('queue')} />}
        {kind === 'max-cost' && <TextField label="Max cost per job (USD)" type="number" value={f.maxCostUsd} onChange={set('maxCostUsd')} />}
        <div className="bq-toolbar" role="toolbar" aria-label="New rule"><Button tone="primary" icon="plus" disabled={busy} onClick={add}>Add rule</Button></div>
      </div>
    </div>
  );
}
