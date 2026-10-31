import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Button, Chip, Container, Icon, Slot, useRuntime } from '../axf/react';
import * as api from '../api';
import { TokenDialog as ApiTokenDialog } from '../axf/libs/apiclient';
import * as core from '../axf/plan/build-queue-core.mjs';
import type { Proposal, QFeature, QueueState, StepView } from '../axf/plan/build-queue-core.mjs';
import { ModelChip, applyLocalStatuses, loadPlanStore, planFeatures, usePlan } from './Plan';
import { formatMinutes } from '../axf/plan/pending-core.mjs';
import { RowHookButtons, registerRowRefTarget } from '../axf/libs/datagrid';

// grid-hook@1: plugins' row hooks for build-queue steps (button + right-click on the step)
registerRowRefTarget('axf-queue-step', (id) => (id ? { kind: 'queue', id } : null));
import pricing from '../axf/schemas/model-pricing.json';

/*
 * Build queue (nav: Build queue; the Build manager plugin lists everything still to build): the plan's epics as an ordered build queue. Done steps stay put as history; the rest can be dragged
 * into a new order, after which the console prompts to reprocess (dependency order + rework check on built steps).
 * Completing a step marks the epic and its linked features built in the feature tracker; the feature tracker feeds
 * back (all features built → step complete). Both sync when the console starts.
 * All the queue logic lives in framework/plan/build-queue-core.mjs, shared with the API and the MCP server.
 */

const LOCAL_KEY = 'build-queue';

/* ---------------- expected build time and price (Brett, Oct 22 2026) ---------------- */
// Price = minutes × the model's cost of one working minute: the documented heuristic in framework/schemas/model-pricing.json
// (tokens a build session uses per minute, priced with that model's token prices) — the same rule as estimateCost() in
// framework/cli/model-pricing.mjs, which the Build manager and the build log use for their estimates.
type Price = { input?: number; output?: number; cacheRead?: number; cacheWrite?: number };
const PRICES = (pricing as { models?: Record<string, Price> }).models ?? {};
const PER_MIN = (pricing as { heuristic?: { tokensPerMinute?: Price } }).heuristic?.tokensPerMinute ?? { input: 5000, output: 3000, cacheRead: 300000, cacheWrite: 0 };
export function minutePrice(model: string): number | null {
  const p = PRICES[model];
  if (!p || p.input == null || p.output == null) return null;
  return ((PER_MIN.input ?? 0) * p.input + (PER_MIN.output ?? 0) * p.output + (PER_MIN.cacheRead ?? 0) * (p.cacheRead ?? p.input) + (PER_MIN.cacheWrite ?? 0) * (p.cacheWrite ?? p.input)) / 1e6;
}
export const priceFor = (model: string, minutes: number) => { const m = minutePrice(model); return m == null || !(minutes > 0) ? null : m * minutes; };
const usd = (v: number | null) => (v == null ? '' : v < 10 ? `$${v.toFixed(2)}` : `$${Math.round(v).toLocaleString('en-US')}`);
const mins = (n: number) => formatMinutes(n) || '0 min';
/** A step's expected time and price: what's left while it's being built, the whole of it once built. */
function stepCost(s: StepView): { minutes: number; price: number | null; left: boolean } {
  const done = s.state === 'done';
  const minutes = done ? s.minutesTotal : s.minutesLeft;
  return { minutes, price: priceFor(s.model, minutes), left: !done && s.stepsDone > 0 };
}
function TimePrice({ s }: { s: StepView }) {
  const c = stepCost(s);
  if (!s.minutesTotal) return <span className="bm-cost is-none" title="No build-time estimate yet: add one (or small steps) with build_steps">no estimate</span>;
  const title = `${s.state === 'done' ? 'Estimated build time' : c.left ? `Time left (${s.stepsDone}/${s.steps.length} steps done of ~${mins(s.minutesTotal)})` : 'Expected build time'} on ${api.modelLabel(s.model)}${c.price != null ? `, ~${usd(c.price)} at the model's price per working minute` : ''}`;
  return <span className="bm-cost" title={title}><Icon name="clock" size={12} />~{mins(c.minutes)}{c.left ? ' left' : ''}{c.price != null ? <span className="bm-cost__price"> · ~{usd(c.price)}</span> : null}</span>;
}
type Log = (t: string, l?: 'info' | 'ok' | 'warn' | 'error' | 'note') => void;

/* ---------------- queue state store (shared by the view, the dialog and the console's init) ---------------- */
let qState: QueueState | null | undefined;
const listeners = new Set<() => void>();
const setQ = (s: QueueState | null) => { qState = s; listeners.forEach((l) => l()); };
function useQueueState() { return useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l); }; }, () => qState, () => qState); }
async function loadQueue(force = false) {
  if (qState !== undefined && !force) return;
  const local = api.isBackendUp() ? null : api.readLocal<QueueState | null>(LOCAL_KEY, null);
  setQ(local ?? (await api.loadBuildQueueState()));
}
const feats = () => planFeatures() as unknown as QFeature[];
const saveLocal = (q: QueueState) => { api.writeLocal(LOCAL_KEY, q); setQ(q); };

type Act =
  | { kind: 'order'; order: string[] }
  | { kind: 'reprocess'; apply: boolean }
  | { kind: 'step'; id: string; action: core.StepAction; status?: string; note?: string }
  | { kind: 'sync'; by?: string };

/** Run an action through the API (repo files) or, offline, against this browser's copy. Returns the proposal for reprocess. */
async function act(a: Act, log: Log): Promise<Proposal | null> {
  if (api.isBackendUp()) {
    const body = a.kind === 'order' ? { order: a.order } : a.kind === 'reprocess' ? { apply: a.apply } : a.kind === 'step' ? { id: a.id, action: a.action, status: a.status, note: a.note } : { by: a.by ?? 'console' };
    const r = await api.buildPost(a.kind, body);
    if (!r.ok) { log(r.error ?? 'failed', 'error'); return null; }
    for (const l of r.log ?? []) log(l, l.startsWith('sync:') ? 'note' : 'info');
    if (r.state) setQ(r.state);
    if (a.kind !== 'order' && !(a.kind === 'reprocess' && !a.apply)) await loadPlanStore(true);
    return r.proposal ?? null;
  }
  const now = new Date().toISOString();
  const q = qState ?? null;
  if (a.kind === 'order') { saveLocal(core.reorder(feats(), q, a.order, now)); return null; }
  if (a.kind === 'reprocess') {
    if (!a.apply) return core.proposeReprocess(feats(), q);
    const r = core.applyReprocess(feats(), q, now);
    saveLocal(r.queue); log(`reprocessed (this browser): ${r.proposal.moves.length} move(s), ${r.proposal.rework.length} rework flag(s)`, 'warn');
    return r.proposal;
  }
  let next = q;
  if (a.kind === 'step') { const r = core.stepAction(feats(), q, { id: a.id, action: a.action, status: a.status, note: a.note }, now); applyLocalStatuses(r.changes); next = r.queue; for (const c of r.changes) log(`${c.id} → ${c.status} (this browser)`, 'warn'); }
  const s = core.syncQueue(feats(), next, now, a.kind === 'sync' ? a.by ?? 'console' : 'console');
  applyLocalStatuses(s.changes);
  for (const l of s.log) log(`sync: ${l}`, 'note');
  saveLocal(s.queue);
  return null;
}

/** Called once when the console starts: two-way sync of the feature tracker and the build queue. */
export async function initBuildSync(log: Log) {
  await loadPlanStore(true);
  if (api.isBackendUp()) {
    const r = await api.buildPost('sync', { by: 'console:init' });
    if (r.ok) {
      if (r.state) setQ(r.state);
      for (const l of r.log ?? []) log(l, 'note');
      await loadPlanStore(true);
      const v = r.view;
      log(`build queue synced: ${v?.counts.done ?? 0} done · next ${v?.next ?? '—'}${v?.rework ? ` · ${v.rework} need rework` : ''}`, 'ok');
      return;
    }
    log(r.unauthorized ? 'build queue: read-only until the console token is set (Home → Console token)' : `build queue sync failed: ${r.error}`, 'warn');
    await loadQueue(true);
    return;
  }
  await loadQueue(true);
  await act({ kind: 'sync', by: 'console:init' }, log);
  log('build queue synced in this browser (API offline)', 'warn');
}

const STATE_LABEL: Record<string, string> = { done: 'built', rework: 'needs rework', active: 'in progress', queued: 'queued', blocked: 'blocked', dropped: 'dropped', missing: 'missing' };

/** A brief to paste into Claude Code for one step. */
function brief(s: StepView) {
  const m = api.MODELS.find((x) => x.id === s.model);
  return [
    `Build step ${s.position}: ${s.title} (${s.id})`,
    `Model: ${m?.label} (${m?.api}) — ${s.modelReason}`,
    s.summary && `\n${s.summary}`,
    s.deps.length ? `\nDepends on: ${s.deps.map((d) => `${d.title} [${d.status}]`).join(', ')}` : '',
    s.features.length ? `\nFeatures in this step:\n${s.features.map((f) => `- ${f.id} [${f.status}] ${f.title} (${api.modelLabel(f.model)})`).join('\n')}` : '',
    s.acceptance.length ? `\nAcceptance:\n${s.acceptance.map((x) => `- [${x.done ? 'x' : ' '}] ${x.text}`).join('\n')}` : '',
    s.rework ? `\nRework needed:\n${s.rework.reasons.map((r) => `- ${r}`).join('\n')}` : '',
    s.minutesTotal ? `\nExpected: ~${mins(s.minutesLeft)} left${priceFor(s.model, s.minutesLeft) != null ? `, ~${usd(priceFor(s.model, s.minutesLeft))}` : ''} on ${api.modelLabel(s.model)}` : '',
    s.steps.length ? `\nSmall steps (${s.stepsDone}/${s.steps.length} done, ~${s.estimate}; tick each off with build_steps(id="${s.id}", index=N, done=true)):\n${s.steps.map((x, i) => `${x.done ? '[x]' : '[ ]'} ${i + 1}. ${x.estimate ? `(~${x.estimate}) ` : ''}${x.text}`).join('\n')}` : s.estimate ? `\nBuild time: ~${s.estimate}` : '',
    `\nWhen done, mark it built in the console's Build view or with the AXF MCP tool build_step(id="${s.id}", action="${s.rework ? 'resolve-rework' : 'complete'}").`,
  ].filter(Boolean).join('\n');
}

export function BuildManager() {
  const rt = useRuntime();
  const { features, loaded } = usePlan();
  const state = useQueueState();
  const log: Log = (t, l = 'info') => rt.terminal.log('build', t, l);
  const [showDone, setShowDone] = useState(false);
  const [model, setModel] = useState<'' | api.ModelId>('');
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [drag, setDrag] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { loadQueue(); }, []);
  const view = useMemo(() => (loaded && state !== undefined ? core.computeQueue(features as unknown as QFeature[], state) : null), [features, loaded, state]);
  if (!view) return <div className="fx-empty">Loading the build queue…</div>;

  const run = async (a: Act) => { setBusy(true); try { return await act(a, log); } finally { setBusy(false); } };
  const done = view.steps.filter((s) => s.state === 'done' || s.state === 'rework');
  const remaining = view.steps.filter((s) => s.state !== 'done' && s.state !== 'rework');
  const reworks = view.steps.filter((s) => s.rework);
  const next = view.steps.find((s) => s.id === view.next);
  const needsReprocess = view.dirty || view.violations > 0;
  const toggle = (id: string) => setOpen((o) => { const n = new Set(o); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const drop = async (target: string) => {
    if (!drag || drag === target) return;
    const ids = remaining.map((s) => s.id).filter((id) => id !== drag);
    ids.splice(ids.indexOf(target), 0, drag);
    setDrag(null); setOver(null);
    await run({ kind: 'order', order: [...done.map((s) => s.id), ...ids] });
    rt.openDialog('build-reprocess');
  };
  const move = async (id: string, delta: number) => {
    const ids = remaining.map((s) => s.id);
    const i = ids.indexOf(id), j = Math.max(0, Math.min(ids.length - 1, i + delta));
    if (i === j) return;
    ids.splice(j, 0, ...ids.splice(i, 1));
    await run({ kind: 'order', order: [...done.map((s) => s.id), ...ids] });
    rt.openDialog('build-reprocess');
  };
  const copy = (s: StepView) => { navigator.clipboard?.writeText(brief(s)).then(() => rt.toast(`Brief for "${s.title}" copied — paste it into Claude Code (${s.modelLabel}).`, 'success'), () => rt.toast('Clipboard blocked', 'warning')); };
  const shown = (list: StepView[]) => (model ? list.filter((s) => s.model === model) : list);

  return (
    <div className="fx-stack fx-stack--lg">
      <header className="fx-pagehead">
        <div>
          <p className="fx-eyebrow">Build queue · {view.steps.length} steps · {done.length} built · {remaining.length} to go{view.updatedAt ? ` · updated ${view.updatedAt.slice(0, 16).replace('T', ' ')}` : ''}</p>
          <h1>Build queue</h1>
          <p className="fx-muted">Everything left in the plan, in the order it will be built. Drag steps to reorder; the console then checks dependencies and flags built steps that need rework. Each step names the model to build it with.</p>
        </div>
        <div className="fx-row fx-row--wrap">
          <Button tone="primary" icon="shuffle" disabled={busy} onClick={() => rt.openDialog('build-reprocess')}>Reprocess</Button>
          <Button icon="refresh" disabled={busy} onClick={() => run({ kind: 'sync' }).then(() => log('synced with the feature tracker', 'ok'))}>Sync</Button>
          <Button icon="layers" onClick={() => rt.navigate('plan')}>Feature tracker</Button>
          <Slot name="builds.toolbar" props={{ page: 'build' }} />
        </div>
      </header>

      {needsReprocess && (
        <div className="bm-banner" role="alert">
          <Icon name="alert" />
          <span className="fx-grow">{view.violations ? `${view.violations} step(s) now run before a dependency.` : 'The queue changed since it was last processed.'} Reprocess so every step comes after its dependencies and built steps are checked for rework.</span>
          <Button tone="primary" icon="shuffle" onClick={() => rt.openDialog('build-reprocess')}>Reprocess…</Button>
        </div>
      )}

      <div className="fx-grid">
        <Container title="Next up" icon="play">
          {next ? (
            <div className="fx-stack">
              <div className="fx-row fx-row--wrap" style={{ gap: 'var(--fx-dens-gap-lg)' }}><strong>{next.position}. {next.title}</strong><ModelChip model={next.model} reason={next.modelReason} long /><TimePrice s={next} /></div>
              <p className="fx-small fx-muted" style={{ margin: 0 }}>{next.modelReason}</p>
              <p className="fx-small" style={{ margin: 0 }}>{next.summary}</p>
              <div className="fx-row fx-row--wrap">
                {next.state !== 'active' && <Button icon="play" disabled={busy} onClick={() => run({ kind: 'step', id: next.id, action: 'start' })}>Start</Button>}
                <Button tone="primary" icon="check" disabled={busy} onClick={() => run({ kind: 'step', id: next.id, action: 'complete' })}>Mark built</Button>
                <Button icon="copy" onClick={() => copy(next)}>Copy brief</Button>
              </div>
            </div>
          ) : <p className="fx-muted">Nothing is ready: every remaining step waits on a dependency.</p>}
        </Container>
        <Container title="Progress" icon="chart">
          <table className="fx-table"><tbody>
            {Object.entries(view.counts).map(([k, n]) => <tr key={k}><th>{STATE_LABEL[k] ?? k}</th><td>{n}</td></tr>)}
            <tr><th>Remaining by model</th><td className="fx-row fx-row--wrap" style={{ gap: 'var(--fx-dens-gap-md)' }}>{api.MODELS.filter((m) => view.byModel[m.id]).map((m) => <span key={m.id}><ModelChip model={m.id} /> {view.byModel[m.id]}</span>)}</td></tr>
            {api.MODELS.filter((m) => view.byModel[m.id]).map((m) => {
              const left = view.minutesLeftByModel?.[m.id] ?? 0;
              return <tr key={`t-${m.id}`}><th>{m.label}: time left</th><td>~{mins(left)}{priceFor(m.id, left) != null ? <span className="bm-cost__price"> · ~{usd(priceFor(m.id, left))}</span> : null}</td></tr>;
            })}
            {(() => {
              const left = remaining.reduce((a, s) => a + s.minutesLeft, 0);
              const cost = remaining.reduce((a, s) => a + (priceFor(s.model, s.minutesLeft) ?? 0), 0);
              const none = remaining.filter((s) => !s.minutesTotal).length;
              return <tr><th>All of it</th><td><strong>~{mins(left)}</strong>{cost ? <span className="bm-cost__price"> · ~{usd(cost)}</span> : null}{none ? <span className="fx-muted"> · {none} step{none === 1 ? '' : 's'} without an estimate</span> : null}</td></tr>;
            })()}
          </tbody></table>
        </Container>
        <Container title={`Rework (${reworks.length})`} icon="undo">
          {reworks.length === 0 ? <p className="fx-muted">No built step needs rework.</p> : reworks.map((s) => (
            <div key={s.id} className="bm-rework">
              <div className="fx-row fx-row--wrap" style={{ gap: 'var(--fx-dens-gap-lg)' }}><strong>{s.title}</strong><ModelChip model={s.model} reason={s.modelReason} /></div>
              <ul className="fx-small">{s.rework!.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
              <div className="fx-row fx-row--wrap"><Button icon="copy" onClick={() => copy(s)}>Copy brief</Button><Button icon="check" disabled={busy} onClick={() => run({ kind: 'step', id: s.id, action: 'resolve-rework' })}>Reworked</Button></div>
            </div>
          ))}
        </Container>
      </div>

      <div className="fx-row fx-row--wrap">
        <label className="fx-row" style={{ gap: 'var(--fx-dens-gap-lg)' }}><input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> Show built steps ({done.length})</label>
        <label className="fx-row" style={{ gap: 'var(--fx-dens-gap-lg)' }}>Model<select className="fx-input" value={model} onChange={(e) => setModel(e.target.value as '' | api.ModelId)}><option value="">All</option>{api.MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</select></label>
      </div>

      <div className="bm-queue" role="list">
        {showDone && shown(done).map((s) => <StepRow key={s.id} s={s} open={open.has(s.id)} onToggle={() => toggle(s.id)} busy={busy} run={run} copy={copy} />)}
        {showDone && done.length > 0 && <div className="bm-divider">Still to build</div>}
        {shown(remaining).map((s) => (
          <div key={s.id} role="listitem" className={`bm-drop ${over === s.id && drag !== s.id ? 'is-over' : ''}`}
            onDragOver={(e) => { if (drag) { e.preventDefault(); setOver(s.id); } }} onDragLeave={() => setOver((o) => (o === s.id ? null : o))} onDrop={(e) => { e.preventDefault(); drop(s.id); }}>
            <StepRow s={s} open={open.has(s.id)} onToggle={() => toggle(s.id)} busy={busy} run={run} copy={copy} draggable onDragStart={() => setDrag(s.id)} onDragEnd={() => { setDrag(null); setOver(null); }} onMove={(d) => move(s.id, d)} />
          </div>
        ))}
      </div>
    </div>
  );
}

function StepRow({ s, open, onToggle, busy, run, copy, draggable, onDragStart, onDragEnd, onMove }: {
  s: StepView; open: boolean; onToggle: () => void; busy: boolean; run: (a: Act) => Promise<unknown>; copy: (s: StepView) => void;
  draggable?: boolean; onDragStart?: () => void; onDragEnd?: () => void; onMove?: (delta: number) => void;
}) {
  const rt = useRuntime();
  const builtFeatures = s.features.filter((f) => f.status === 'built').length;
  return (
    <div className={`bm-step is-${s.state} ${s.violations.length ? 'has-violation' : ''}`} data-fx-ctx-target="axf-queue-step" data-fx-ctx-payload={s.id} draggable={draggable} onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; onDragStart?.(); }} onDragEnd={onDragEnd}>
      <div className="bm-step__head">
        {draggable ? <span className="bm-grip" title="Drag to reorder"><Icon name="menu" size={14} /></span> : <span className="bm-grip is-fixed"><Icon name="lock" size={12} /></span>}
        <span className="bm-pos">{s.position}</span>
        <button data-fx-row className="bm-step__title" onClick={onToggle} aria-expanded={open}>
          <Icon name={open ? 'chevron-down' : 'chevron-right'} size={14} />
          <span className="fx-grow"><span>{s.title}</span><span className="fx-muted fx-small fx-mono"> {s.id}</span></span>
        </button>
        <span className={`bm-state is-${s.state}`}>{STATE_LABEL[s.state]}</span>
        <ModelChip model={s.model} reason={s.modelReason} />
        <TimePrice s={s} />
        <span className="bm-progress" title={`${s.progress}%${s.features.length ? ` · ${builtFeatures}/${s.features.length} features built` : ''}`}><span style={{ width: `${s.progress}%` }} /></span>
        {!s.ready && s.state !== 'done' && s.state !== 'rework' && <span title={`Waits on ${s.deps.filter((d) => !d.done).map((d) => d.title).join(', ')}`}><Icon name="lock" size={14} /></span>}
        {(s.violations.length > 0 || s.rework) && <span className="pl-warn" title={[...s.violations, ...(s.rework?.reasons ?? [])].join('\n')}><Icon name="alert" size={14} /></span>}
        <span className="bm-actions">
          <RowHookButtons rowRef={{ kind: 'queue', id: s.id }} />
          {onMove && <><button className="fx-iconbtn" aria-label="Move up" onClick={() => onMove(-1)}><Icon name="chevron-up" size={14} /></button><button className="fx-iconbtn" aria-label="Move down" onClick={() => onMove(1)}><Icon name="chevron-down" size={14} /></button></>}
        </span>
      </div>
      {open && (
        <div className="bm-step__body">
          <p className="fx-small" style={{ margin: 0 }}><ModelChip model={s.model} long /> {s.modelReason}{s.epicModel && s.epicModel !== s.model ? ` (the epic alone: ${api.modelLabel(s.epicModel)})` : ''}</p>
          {s.summary && <p className="fx-small fx-muted">{s.summary}</p>}
          {[...s.violations, ...s.missing].map((v, i) => <div key={i} className="pl-note is-warn"><Icon name="alert" size={14} />{v}</div>)}
          {s.rework && <div className="pl-note is-error"><Icon name="undo" size={14} /><span>Needs rework: {s.rework.reasons.join('; ')}</span></div>}
          <div className="bm-cols">
            <div><h4>Depends on</h4>{s.deps.length ? s.deps.map((d) => <div key={d.id} className="fx-small"><span className={`pl-dot is-${d.status}`} /> {d.title}{d.position ? <span className="fx-muted"> · step {d.position}</span> : ''}</div>) : <p className="fx-muted fx-small">Nothing</p>}</div>
            <div><h4>Features ({builtFeatures}/{s.features.length})</h4>{s.features.length ? s.features.map((f) => <div key={f.id} className="fx-small bm-feat"><span className={`pl-dot is-${f.status}`} title={f.status} /> <span className="fx-grow">{f.title}</span><ModelChip model={f.model} reason={f.modelReason} /></div>) : <p className="fx-muted fx-small">No catalog features linked — the step is the epic itself.</p>}</div>
          </div>
          {s.completedAt && <p className="fx-small fx-muted">Built {s.completedAt.slice(0, 16).replace('T', ' ')} by {s.completedBy}</p>}
          <div className="fx-row fx-row--wrap">
            {(s.state === 'queued' || s.state === 'blocked') && <Button icon="play" disabled={busy} onClick={() => run({ kind: 'step', id: s.id, action: 'start' })}>Start</Button>}
            {s.state !== 'done' && s.state !== 'rework' && <Button tone="primary" icon="check" disabled={busy} onClick={() => run({ kind: 'step', id: s.id, action: 'complete' })}>Mark built</Button>}
            {s.state === 'rework' && <Button tone="primary" icon="check" disabled={busy} onClick={() => run({ kind: 'step', id: s.id, action: 'resolve-rework' })}>Reworked</Button>}
            {(s.state === 'done' || s.state === 'rework') && <Button icon="undo" disabled={busy} onClick={() => run({ kind: 'step', id: s.id, action: 'reopen' })}>Reopen</Button>}
            <Button icon="copy" onClick={() => copy(s)}>Copy brief</Button>
            <Button icon="layers" onClick={() => rt.navigate('plan')}>In feature tracker</Button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Dialog: preview what a reprocess would change, then apply it. */
export function ReprocessDialog({ close }: { close: () => void }) {
  const rt = useRuntime();
  const log: Log = (t, l = 'info') => rt.terminal.log('build', t, l);
  const [p, setP] = useState<Proposal | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const dirty = !!useQueueState()?.dirty;
  useEffect(() => { act({ kind: 'reprocess', apply: false }, (t, l) => { if (l === 'error') setErr(t); log(t, l); }).then(setP); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const apply = async () => { setBusy(true); const r = await act({ kind: 'reprocess', apply: true }, log); setBusy(false); if (r) { log(`reprocessed: ${r.moves.length} move(s), ${r.rework.length} step(s) flagged for rework`, 'ok'); close(); } };
  const done = async () => { setBusy(true); if (dirty) await act({ kind: 'reprocess', apply: true }, log); setBusy(false); close(); };
  if (err) return <div className="fx-stack"><p className="pl-note is-error">{err}</p><Button onClick={close}>Close</Button></div>;
  if (!p) return <div className="fx-empty">Checking dependencies…</div>;
  const nothing = !p.changed && !p.moves.length && !p.rework.length;
  return (
    <div className="fx-stack bm-dialog">
      <p className="fx-muted" style={{ margin: 0 }}>Reprocessing keeps your order wherever dependencies allow, moves steps that would run before something they need, and checks every built step against what changed.</p>
      {nothing && <p>Everything is in dependency order and no built step needs rework.</p>}
      {p.moves.length > 0 && <><h4 style={{ margin: 0 }}>Moves ({p.moves.length})</h4><ul className="fx-small bm-list">{p.moves.map((m) => <li key={m.id}><strong>{m.title}</strong>: step {m.from} → {m.to} <span className="fx-muted">({m.reason})</span></li>)}</ul></>}
      {p.rework.length > 0 && <><h4 style={{ margin: 0 }}>Built steps to refactor ({p.rework.length})</h4><ul className="fx-small bm-list">{p.rework.map((r) => <li key={r.id}><strong>{r.title}</strong> <ModelChip model={r.model} />{r.already ? <span className="fx-muted"> (already flagged)</span> : ''}<br /><span className="fx-muted">{r.reasons.join('; ')}</span></li>)}</ul></>}
      {p.cycles.length > 0 && <p className="pl-note is-warn"><Icon name="alert" size={14} />Dependency cycle broken at: {p.cycles.map((c) => c.title).join(', ')} — fix the dependencies in the feature tracker.</p>}
      <div className="fx-row fx-row--wrap" style={{ justifyContent: 'flex-end' }}>
        {/* Nothing to move: the check itself is the reprocess, so closing clears "the queue changed" and its message. */}
        <Button disabled={busy} onClick={nothing ? done : close}>{nothing ? 'Close' : 'Later'}</Button>
        {!nothing && <Button tone="primary" icon="shuffle" disabled={busy} onClick={apply}>Apply</Button>}
      </div>
    </div>
  );
}

/** Home card. */
export function BuildSummaryCard() {
  const rt = useRuntime();
  const { features, loaded } = usePlan();
  const state = useQueueState();
  useEffect(() => { loadQueue(); }, []);
  const view = useMemo(() => (loaded && state !== undefined ? core.computeQueue(features as unknown as QFeature[], state) : null), [features, loaded, state]);
  const next = view?.steps.find((s) => s.id === view.next);
  return (
    <Container title="Build queue" icon="play" actions={<Button icon="external" onClick={() => rt.navigate('build')}>Open</Button>}>
      {!view ? <p className="fx-muted">Loading…</p> : (
        <table className="fx-table"><tbody>
          <tr><th>Built</th><td>{(view.counts.done ?? 0) + (view.counts.rework ?? 0)}/{view.steps.length} steps</td></tr>
          <tr><th>Next</th><td>{next ? <>{next.position}. {next.title} <ModelChip model={next.model} reason={next.modelReason} /></> : '—'}</td></tr>
          <tr><th>Needs attention</th><td>{view.rework ? <Chip tone="danger">{view.rework} rework</Chip> : null} {view.violations || view.dirty ? <Chip tone="warning">reprocess</Chip> : null}{!view.rework && !view.violations && !view.dirty ? 'nothing' : null}</td></tr>
        </tbody></table>
      )}
    </Container>
  );
}

/** Dialog: the console token (AXF_TOKEN) for writes when the API is deployed with one (the API client library's TokenDialog). */
export function TokenDialog({ close }: { close: () => void }) {
  const rt = useRuntime();
  return (
    <ApiTokenDialog tokens={api.consoleTokens} close={close} placeholder="AXF_TOKEN" ariaLabel="Console token"
      description="Writes (plan edits, the build queue, installs) need the AXF_TOKEN that install-console.sh printed. It is kept only in this browser. The same token connects Claude to this console's MCP endpoint at /mcp."
      savedToast="Console token saved in this browser" clearedToast="Console token cleared"
      onChange={() => { initBuildSync((m, l) => rt.terminal.log('build', m, l)); }} />
  );
}
