import { useEffect, useState } from 'react';
import { BuildOrigin, Button, Icon, Slot, TabGroup, useRuntime } from '@console/axf/react';
import { pluginApi } from '@console/plugins';
import * as consoleApi from '@console/api';
import { WatchLiveFor } from '@console/watchLive';
import * as core from './orchestrator-core.mjs';
import * as pendingCore from '@console/axf/plan/pending-core.mjs';
import pricing from '@console/axf/schemas/model-pricing.json';
import { DataGrid, RowHookButtons, registerRowRefTarget, type GridColumn, type GridGroup, type GridSort } from '@console/axf/libs/datagrid';
import { PipelineTab } from './pipeline';
import './orchestrator.css';

/*
 * Build orchestrator page: a tab group (Queued · Active · Accounts · Approvals · Rules). Queued and Active (pipeline.tsx)
 * are what Build Manager sent; Accounts = the Claude accounts and what the dispatcher starts next. A Queued / Active
 * row opens its steps (StepGrid: per-step model, phases and model-switch approvals, step move / remove) and the build
 * card (notes, add step, edit, next-phase brief, hide / archive). All rules are in orchestrator-core.mjs.
 */

export const FOLDER = 'build-orchestrator';
// grid-hook@1: a build card's right-click finds the row hooks for orchestrator builds
registerRowRefTarget('axf-orchestrator-build', (id) => (id ? { kind: 'orchestrator', id } : null));
const api = pluginApi(FOLDER, 'Build orchestrator', { unavailable: 'The build orchestrator is switched off or its server part is not running.' });
type Step = { id: string; text: string; model: 'Fable' | 'Opus'; why: string; phase: string; group: string; estimate: string; files: string[]; checks: string[]; session: 'same' | 'new'; agent: boolean; done: boolean; doneAt: string; note: string };
type Build = { id: string; title: string; category: string; detail: string; status: string; hidden: boolean; source: string; pendingId: string; branch: string; pr: string; createdAt: string; updatedAt: string; builtAt: string; notes: { text: string; at: string }[]; approvals: { phase: number; from: string; to: string; at: string; by?: string; via?: string; kind?: string; selfApproved?: boolean }[]; upgradeRequests?: { id: string; phase: number; from: string; to: string; at: string; by: string; state: string }[]; origin?: unknown; steps: Step[] };
type Rules = { sameSession: boolean; subAgents: boolean; approveModelSwitch: boolean; maxStepMinutes: number };
type State = { updatedAt: string; rules: Rules; builds: Build[] };
type Res = { ok: boolean; error?: string; state?: State; log?: string[]; brief?: string; upgradePolicy?: { approvalRequired: boolean; source: string } };
type Act = (c: Record<string, unknown>) => Promise<boolean>;

/** A build's headless runs, from the launcher's end-of-run notes (headless-context@1; same line format as
 * parseRunNote in framework/cli/headless-context.mjs): start tokens, cost, brief only or full chain. */
const RUN_NOTE = /^Headless run (\S+): (brief only|full chain) · (start [\d.]+K? tokens(?: \(\$[\d.]+\))?|no start recorded) · cost (\$[\d.]+(?: \(estimate\))?)/;
function headlessRuns(b: Build): { at: string; start: string; cost: string; mode: string }[] {
  return b.notes.map((n) => { const m = RUN_NOTE.exec(n.text); return m ? { at: n.at, start: m[3]!.replace(/^start /, ''), cost: m[4]!, mode: m[2]! } : null; })
    .filter((x): x is { at: string; start: string; cost: string; mode: string } => !!x).reverse();
}
const fmtDate = (v: string) => { if (!v) return '—'; const d = new Date(v); return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); };
const fmtTime = (v: string) => { const d = new Date(v); return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); };
// Split pages (Brett, Nov 9 2026): the orchestrator owns only what Build Manager sent it, Queued and Active; Pending and
// Complete are Build Manager's. Accounts = the Claude accounts, slots and dispatcher log (was the Pipeline tab).
export const TABS = [{ id: 'queued', label: 'Queued', icon: 'list' }, { id: 'active', label: 'Active', icon: 'play' }, { id: 'accounts', label: 'Accounts', icon: 'users' }, { id: 'approvals', label: 'Approvals', icon: 'check-circle' }, { id: 'rules', label: 'Rules', icon: 'settings' }] as const;
export const TAB_KEY = 'orch-tab';
const isTab = (v: unknown): v is Tab => TABS.some((t) => t.id === v);
type Tab = (typeof TABS)[number]['id'];

export function OrchestratorPage() {
  const rt = useRuntime();
  const log = (t: string, l: 'info' | 'ok' | 'warn' | 'error' = 'info') => rt.terminal.log('orchestrator', t, l);
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<Tab>(() => { const t = consoleApi.readLocal<string>(TAB_KEY, 'queued'); return isTab(t) ? t : 'queued'; });
  useEffect(() => { consoleApi.writeLocal(TAB_KEY, tab); }, [tab]);
  // build-orchestrator.open:<tab> (deep link, voice, MCP) switches the tab while the page is open
  useEffect(() => {
    const on = (e: Event) => { const t = (e as CustomEvent<string>).detail; if (isTab(t)) setTab(t); };
    globalThis.addEventListener?.('axf:orchestrator-tab', on);
    return () => globalThis.removeEventListener?.('axf:orchestrator-tab', on);
  }, []);
  const [stepHidden, setStepHidden] = useState<string[]>(() => consoleApi.readLocal<string[]>('orch-step-hidden', ['doneAt']));
  useEffect(() => { consoleApi.writeLocal('orch-step-hidden', stepHidden); }, [stepHidden]);

  const load = async () => {
    try { const r = await api.call<Res>('state'); if (!r.ok) throw new Error(r.error); if (r.upgradePolicy) core.setUpgradePolicy(r.upgradePolicy); setState(r.state!); setError(''); }
    catch (e) { setError((e as Error).message); setState((s) => s ?? (core.emptyState() as State)); }
  };
  useEffect(() => { void load(); }, []);

  const act: Act = async (change) => {
    setBusy(true);
    try {
      const r = await api.post<Res>('act', change);
      if (!r.ok) { log(r.error ?? 'failed', 'error'); rt.toast(r.error ?? 'Change failed', 'danger'); return false; }
      for (const l of r.log ?? []) log(l, 'ok');
      if (r.state) setState(r.state);
      return true;
    } catch (e) { log((e as Error).message, 'error'); rt.toast((e as Error).message, 'danger'); return false; }
    finally { setBusy(false); }
  };

  if (!state) return <div className="fx-empty">Loading the build orchestrator…</div>;
  const waiting = state.builds.filter((b) => b.status === 'waiting').length;
  const counts = core.counts(state.builds) as Record<string, number>;
  const activeN = (counts.running ?? 0) + (counts.waiting ?? 0) + (counts.blocked ?? 0) + (counts.failed ?? 0);
  const steps = (id: string) => { const b = state.builds.find((x) => x.id === id); return b ? <><StepGrid b={b} rules={state.rules} busy={busy} act={act} hidden={stepHidden} setHidden={setStepHidden} /><BuildCard b={b} rules={state.rules} busy={busy} act={act} embedded /></> : null; };
  return (
    <div className="fx-stack fx-stack--lg">
      <header className="fx-pagehead">
        <div>
          <p className="fx-eyebrow">Build orchestrator · {state.builds.length} builds{state.updatedAt ? ` · updated ${fmtTime(state.updatedAt)}` : ''}</p>
          <h1>Build orchestrator</h1>
          <p className="fx-muted" title="One session, no sub-agents unless a step says so. Tracker: _claude/builds/store.json">Only what Build Manager sent: Queued, then Active when the dispatcher starts it on a free account. A finished build goes back to Build Manager → Complete.</p>
        </div>
        <div className="fx-row fx-row--wrap"><Button icon="refresh" disabled={busy} onClick={() => load().then(() => log('reloaded', 'ok'))}>Reload</Button><Slot name="builds.toolbar" props={{ page: 'build-orchestrator' }} /></div>
      </header>
      {error && <div className="pl-note is-warn"><Icon name="alert" size={14} />{error}</div>}
      <TabGroup id="build-orchestrator.tabs" label="Build orchestrator" value={tab} onChange={setTab} tabs={TABS.map((t) => ({ value: t.id, label: t.label, icon: t.icon, badge: t.id === 'approvals' ? (waiting || undefined) : t.id === 'queued' ? counts.queued ?? 0 : t.id === 'active' ? activeN : undefined }))} />
      {(tab === 'queued' || tab === 'active' || tab === 'accounts') && <PipelineTab key={tab} api={api} log={log} view={tab} steps={steps} />}
      {tab === 'approvals' && <ApprovalsTab state={state} busy={busy} act={act} />}
      {tab === 'rules' && <RulesTab rules={state.rules} busy={busy} act={act} />}
    </div>
  );
}

type Mode = 'note' | 'step' | 'edit' | 'confirm' | null;
function BuildCard({ b, rules, busy, act, embedded }: { b: Build; rules: Rules; busy: boolean; act: Act; embedded?: boolean }) {
  const rt = useRuntime();
  const [mode, setMode] = useState<Mode>(null);
  const [statusOpen, setStatusOpen] = useState(false);
  const [text, setText] = useState('');
  const [stepModel, setStepModel] = useState<'Fable' | 'Opus'>('Opus');
  const [stepEst, setStepEst] = useState('');
  const [title, setTitle] = useState(b.title);
  const [detail, setDetail] = useState(b.detail);
  const [branch, setBranch] = useState(b.branch);
  const [category, setCategory] = useState(b.category);
  const [stepGroup, setStepGroup] = useState('');
  const [stepPhase, setStepPhase] = useState('');
  const p = core.progress(b);
  const n = core.nextUp(b, rules);
  const split = core.splitCheck(b, rules);
  const ps = core.phases(b);
  const open = (m: Mode) => { setMode(m); setText(''); setStepEst(''); setTitle(b.title); setDetail(b.detail); setBranch(b.branch); setCategory(b.category); };
  const save = async () => {
    if (mode === 'note' && text.trim()) { if (await act({ action: 'note', id: b.id, text })) setMode(null); }
    else if (mode === 'step' && text.trim()) { if (await act({ action: 'add-step', id: b.id, stepData: { text, model: stepModel, estimate: stepEst, group: stepGroup, phase: stepPhase } })) setMode(null); }
    else if (mode === 'edit') { if (await act({ action: 'update', id: b.id, title, detail, branch, category })) setMode(null); }
  };
  const copyBrief = async () => {
    try { const r = await api.call<Res>(`brief/${encodeURIComponent(b.id)}`); await navigator.clipboard.writeText(r.brief ?? core.brief(b, rules)); rt.toast(`Brief for "${b.title}" copied (current phase only)`, 'success'); }
    catch { rt.toast('Clipboard blocked', 'warning'); }
  };
  return (
    <article className={`${embedded ? 'oc-embedded ' : ''}pd-card is-${core.isFinished(b.status) ? 'complete' : b.status === 'failed' ? 'failed' : b.status === 'blocked' ? 'broken' : 'pending'}`} role={embedded ? undefined : "listitem"} data-fx-ctx-target="axf-orchestrator-build" data-fx-ctx-payload={b.id}>
      <div className="pd-card__top">
        <h2 className="pd-card__title">{embedded ? <span className="fx-small fx-muted">Build</span> : b.title}<span className="fx-muted fx-small fx-mono"> {b.id}</span>{b.hidden && <span className="fx-muted fx-small"> · hidden</span>}</h2>
        <button data-fx-row className={`pd-badge oc-badge is-${b.status}`} aria-expanded={statusOpen} aria-label={`Status: ${b.status}. Change`} onClick={() => setStatusOpen((o) => !o)}>{(core.STATUS_LABEL as Record<string, string>)[b.status]}</button>
      </div>
      {statusOpen && (
        <div className="fx-row fx-row--wrap">
          {core.STATUSES.map((s) => <button data-fx-row key={s} className={`pd-badge oc-badge is-${s}`} disabled={busy || s === b.status} onClick={async () => { if (await act({ action: 'status', id: b.id, status: s })) setStatusOpen(false); }}>{(core.STATUS_LABEL as Record<string, string>)[s]}</button>)}
        </div>
      )}
      {!embedded && <BuildOrigin origin={b.origin} showEmpty />}
      <div className="pd-meta">
        <span className={`pd-date ${b.builtAt ? 'is-built' : ''}`} title={`Added ${fmtTime(b.createdAt)}`}><Icon name={b.builtAt ? 'check-circle' : 'clock'} size={13} />{b.builtAt ? `Built ${fmtDate(b.builtAt)}` : `Added ${fmtDate(b.createdAt)}`}</span>
        {p.total > 0 && <span className="pd-est"><Icon name="check-circle" size={13} />{p.done}/{p.total} steps{p.minutesLeft ? ` · ${core.formatMinutes(p.minutesLeft)} left` : ''}</span>}
        {core.MODELS.map((m) => (p.byModel as Record<string, number>)[m] ? <span key={m} className={`oc-model is-${m.toLowerCase()}`}>{m} {core.formatMinutes((p.byModel as Record<string, number>)[m])}</span> : null)}
        {p.switches > 0 && <span title="Model switches; an upgrade waits for your approval, a downgrade does not"><Icon name="zap" size={13} />{p.switches} switch{p.switches === 1 ? '' : 'es'}</span>}
        {split.needsSplit && !core.isFinished(b.status) && <span className="pd-split" title={split.reasons.join('; ')}><Icon name="alert" size={13} />needs splitting</span>}
        {b.category && <span><Icon name="layers" size={13} />{b.category}</span>}
        {b.pendingId && <span className="fx-mono">pending:{b.pendingId}</span>}
        {b.branch && <span className="fx-mono">{b.branch}</span>}
        {(b.status === 'running' || b.status === 'waiting') && <WatchLiveFor branch={b.branch} text={`${b.id} ${b.pendingId ?? ''}`} />}
      </div>
      {!embedded && n.needsApproval && n.phase && (
        <div className="pl-note is-warn oc-gate"><Icon name="alert" size={14} />Next phase upgrades {n.phase.from} → {n.phase.model}. Only you can approve it; no session starts it before you do.
          <Button tone="primary" icon="check" disabled={busy} onClick={() => act({ action: 'approve', id: b.id, phase: n.phase!.index })}>Approve upgrade to {n.phase.model}</Button>
        </div>
      )}
      {!n.needsApproval && n.step && !core.isFinished(b.status) && <p className="fx-small fx-muted">Next: <b>{n.step.id}</b> on <span className={`oc-model is-${n.step.model.toLowerCase()}`}>{n.step.model}</span> — {n.step.text}</p>}
      {mode === 'edit' ? (
        <div className="fx-stack">
          <label className="pd-field">Title<input className="fx-input" value={title} onChange={(e) => setTitle(e.target.value)} /></label>
          <label className="pd-field">Details<textarea className="fx-input" rows={4} value={detail} onChange={(e) => setDetail(e.target.value)} /></label>
          <label className="pd-field">Category<input className="fx-input" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. Design & branding" /></label>
          <label className="pd-field">Branch<input className="fx-input" value={branch} onChange={(e) => setBranch(e.target.value)} /></label>
        </div>
      ) : b.detail && <p className="pd-detail">{b.detail}</p>}
      {!embedded && ps.map((ph) => (
        <div key={ph.index} className="pd-thread">
          <h3>{ph.name} · <span className={`oc-model is-${ph.model.toLowerCase()}`}>{ph.model}</span>{ph.gate && <span className="fx-muted fx-small"> · {switchNote(ph)}</span>}{ph.minutesLeft ? <span className="pd-est"> · {core.formatMinutes(ph.minutesLeft)} left</span> : null}</h3>
          {ph.groups.map((g, gi) => (
            <div key={gi} className="oc-group">
              {g.label && <h4 className="oc-group__head">{g.label}<span className="fx-muted fx-small"> · {g.done}/{g.steps.length}{g.minutesLeft ? ` · ${core.formatMinutes(g.minutesLeft)} left` : ''}</span></h4>}
              {g.steps.map((s) => <StepRow key={s.id} b={b} s={s as Step & { index: number }} locked={!ph.approved} busy={busy} act={act} last={b.steps.length - 1} />)}
            </div>
          ))}
        </div>
      ))}
      {headlessRuns(b).length > 0 && (
        <div className="pd-thread"><h3>Headless runs</h3>{headlessRuns(b).map((r, i) => (
          <div key={i} className="pd-entry"><time dateTime={r.at}>{fmtDate(r.at)}</time>
            <p><span className="fx-mono">{r.start}</span> start · {r.cost} · {r.mode}</p></div>))}</div>
      )}
      {b.notes.length > 0 && (
        <div className="pd-thread"><h3>Notes</h3>{b.notes.map((e, i) => <div key={i} className="pd-entry"><time dateTime={e.at}>{fmtDate(e.at)}</time><p>{e.text}</p></div>)}</div>
      )}
      {(mode === 'note' || mode === 'step') && (
        <div className="fx-stack">
          <textarea className="fx-input" rows={3} autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder={mode === 'note' ? 'Add a note' : 'Add a step (30 min or less)'} />
          {mode === 'step' && (
            <div className="pd-two">
              <label className="pd-field">Model<select className="fx-input" value={stepModel} onChange={(e) => setStepModel(e.target.value as 'Fable' | 'Opus')}>{core.MODELS.map((m) => <option key={m}>{m}</option>)}</select></label>
              <label className="pd-field">Build time (e.g. 25 min)<input className="fx-input" value={stepEst} onChange={(e) => setStepEst(e.target.value)} /></label>
              <label className="pd-field">Group<input className="fx-input" value={stepGroup} onChange={(e) => setStepGroup(e.target.value)} /></label>
              <label className="pd-field">Phase<input className="fx-input" value={stepPhase} onChange={(e) => setStepPhase(e.target.value)} /></label>
            </div>
          )}
        </div>
      )}
      {mode === 'confirm' ? (
        <div className="fx-row fx-row--wrap pd-confirm">Remove this build from the orchestrator?
          <Button tone="danger" icon="trash" disabled={busy} onClick={() => act({ action: 'remove', id: b.id })}>Remove</Button>
          <Button onClick={() => setMode(null)}>Keep</Button>
        </div>
      ) : mode ? (
        <div className="fx-row fx-row--wrap">
          <Button tone="primary" icon="save" disabled={busy} onClick={save}>{mode === 'note' ? 'Save note' : mode === 'step' ? 'Add step' : 'Save'}</Button>
          <Button onClick={() => setMode(null)}>Cancel</Button>
        </div>
      ) : (
        <div className="fx-row fx-row--wrap">
          <Button icon="edit" onClick={() => open('note')}>Add note</Button>
          <Button icon="plus" onClick={() => open('step')}>Add step</Button>
          <Button icon="file" onClick={() => open('edit')}>Edit</Button>
          <Button icon="copy" onClick={copyBrief}>Copy next brief</Button>
          <RowHookButtons rowRef={{ kind: 'orchestrator', id: b.id }} />
          <Button icon={b.hidden ? 'eye' : 'minimize'} disabled={busy} onClick={() => act({ action: b.hidden ? 'unhide' : 'hide', id: b.id })}>{b.hidden ? 'Unhide' : 'Hide'}</Button>
          <Button icon="package" disabled={busy || b.status === 'archived'} onClick={() => act({ action: 'archive', id: b.id })}>Archive</Button>
          <Button icon="trash" onClick={() => setMode('confirm')}>Remove</Button>
        </div>
      )}
    </article>
  );
}

function StepRow({ b, s, locked, busy, act, last }: { b: Build; s: Step & { index: number }; locked: boolean; busy: boolean; act: Act; last: number }) {
  const other = s.model === 'Fable' ? 'Opus' : 'Fable';
  return (
    <div className={`pd-entry is-mono ${s.done ? 'is-done' : ''}`}>
      <input type="checkbox" className="pd-tick" checked={s.done} disabled={busy || core.isFinished(b.status) || (locked && !s.done)} onChange={(ev) => void act({ action: 'step', id: b.id, step: s.id, done: ev.target.checked })} aria-label={`Step ${s.id} done`} title={locked ? 'Approve the model switch first' : s.done && s.doneAt ? `Done ${fmtTime(s.doneAt)}` : 'Mark this step done'} />
      <time>{s.id}{s.estimate && <span className="pd-est"> · ~{s.estimate}</span>}</time>
      <p>{s.text}{s.why && <span className="fx-muted"> — {s.why}</span>}{s.session === 'new' && <span className="oc-flag"> new session</span>}{s.agent && <span className="oc-flag"> sub-agent ok</span>}</p>
      <span className="oc-steptools">
        <button data-fx-row className={`oc-model is-${s.model.toLowerCase()}`} disabled={busy || s.done} title={`Switch this step to ${other}`} onClick={() => act({ action: 'edit-step', id: b.id, step: s.id, stepData: { model: other } })}>{s.model}</button>
        <button className="fx-iconbtn" disabled={busy || s.index === 0} title="Move up" onClick={() => act({ action: 'move-step', id: b.id, step: s.id, dir: 'up' })}><Icon name="chevron-up" size={13} /></button>
        <button className="fx-iconbtn" disabled={busy || s.index === last} title="Move down" onClick={() => act({ action: 'move-step', id: b.id, step: s.id, dir: 'down' })}><Icon name="chevron-down" size={13} /></button>
        <button className="fx-iconbtn" disabled={busy} title="Remove step" onClick={() => act({ action: 'remove-step', id: b.id, step: s.id })}><Icon name="x" size={13} /></button>
      </span>
    </div>
  );
}

/** How a phase's model switch reads: a downgrade needs nobody; an upgrade needs Brett (Nov 3 2026). */
function switchNote(ph: core.Phase): string {
  if (!ph.gate) return '';
  if (ph.kind === 'downgrade') return `downgrade from ${ph.from}, no approval needed`;
  return ph.approved ? `upgrade from ${ph.from}, approved` : `upgrade from ${ph.from}, needs your approval`;
}

/** Who gave an approval, as one plain line (old records carry no name). */
function approvalBy(b: Build, p: core.Phase): string {
  const a = [...b.approvals].reverse().find((x) => x.phase === p.index && x.to === p.model);
  if (!a) return '';
  if (a.selfApproved) return `Self-approved by ${a.by || 'a session'}, not you: doesn't count`;
  if (a.kind === 'downgrade') return 'Recorded by itself';
  if (a.via === 'policy') return `Upgraded by itself (Fable upgrades need my approval was off) · ${a.at.slice(0, 16).replace('T', ' ')}`;
  return a.via ? `Approved by ${a.by} (${a.via === 'axhub' ? 'axHub' : 'console'})` : 'Approved before Nov 3 2026 (approver not recorded)';
}

function ApprovalsTab({ state, busy, act }: { state: State; busy: boolean; act: Act }) {
  const gates = state.builds.flatMap((b) => core.phases(b).filter((p) => p.gate).map((p) => ({ b, p })));
  if (!gates.length) return <div className="fx-empty">No model switches in any build.</div>;
  return (
    <div className="pd-list" role="list">
      <p className="fx-small fx-muted">{core.upgradePolicy().approvalRequired
        ? 'Upgrades (Opus → Fable) wait for you: your click here, or the axHub approval a session asks for. A downgrade (Fable → Opus) goes on by itself.'
        : 'Fable upgrades need my approval is off (Settings → Plugins → Claude): a phase that needs Fable runs on Fable by itself and is logged here. A downgrade goes on by itself too.'}</p>
      {gates.map(({ b, p }) => {
        const down = p.kind === 'downgrade';
        const req = (b.upgradeRequests ?? []).find((x) => x.phase === p.index && x.state === 'open');
        const by = approvalBy(b, p);
        return (
          <article key={`${b.id}-${p.index}`} className={`pd-card ${p.approved ? 'is-complete' : 'is-pending'}`} role="listitem">
            <div className="pd-card__top">
              <h2 className="pd-card__title">{b.title}<span className="fx-muted fx-small"> · phase {p.index + 1}</span></h2>
              <span className={`pd-badge oc-badge is-${p.approved ? 'complete' : 'waiting'}`}>{down ? 'Downgrade' : p.approved ? (b.approvals.some((a) => a.phase === p.index && a.via !== 'policy') || core.upgradePolicy().approvalRequired ? 'Upgrade approved' : 'Upgrade: automatic') : 'Upgrade: needs you'}</span>
            </div>
            <div className="pd-meta"><span className={`oc-model is-${p.from.toLowerCase()}`}>{p.from}</span><Icon name="chevron-right" size={13} /><span className={`oc-model is-${p.model.toLowerCase()}`}>{p.model}</span><span>{p.steps.length} steps · {core.formatMinutes(p.minutesLeft) || 'done'}</span></div>
            {by && <p className="fx-small fx-muted">{by}</p>}
            {req && <p className="fx-small">Asked by {req.by || 'a session'} · {req.at.slice(0, 16).replace('T', ' ')}</p>}
            {!p.approved && <div><Button tone="primary" icon="check" disabled={busy} onClick={() => act({ action: 'approve', id: b.id, phase: p.index })}>Approve upgrade to {p.model}</Button></div>}
          </article>
        );
      })}
    </div>
  );
}

function RulesTab({ rules, busy, act }: { rules: Rules; busy: boolean; act: Act }) {
  const [r, setR] = useState(rules);
  useEffect(() => setR(rules), [rules]);
  const flip = (k: keyof Rules) => setR((x) => ({ ...x, [k]: !x[k] }));
  return (
    <div className="fx-stack">
      <article className="pd-card">
        <h2 className="pd-card__title">Token rules</h2>
        <label className="fx-row"><input type="checkbox" checked={r.sameSession} onChange={() => flip('sameSession')} />Stay in one session (a step can still ask for a new one)</label>
        <label className="fx-row"><input type="checkbox" checked={r.subAgents} onChange={() => flip('subAgents')} />Allow sub-agents (off = only steps marked “sub-agent ok”)</label>
        <p className="fx-small fx-muted">Model switches: an upgrade always waits for your approval; a downgrade goes on by itself (Nov 3 2026, not a setting).</p>
        <label className="pd-field">Largest step (minutes)<input className="fx-input" type="number" min={5} max={240} value={r.maxStepMinutes} onChange={(e) => setR((x) => ({ ...x, maxStepMinutes: Number(e.target.value) }))} /></label>
        <div><Button tone="primary" icon="save" disabled={busy} onClick={() => act({ action: 'rules', rules: r })}>Save rules</Button></div>
      </article>
      <article className="pd-card">
        <h2 className="pd-card__title">Which model a step gets</h2>
        {core.MODELS.map((m) => <p key={m}><span className={`oc-model is-${m.toLowerCase()}`}>{m}</span> {(core.MODEL_GUIDE as Record<string, string>)[m]}</p>)}
        <p className="fx-small fx-muted">Any session: <span className="fx-mono">node apps/console-web/plugins/build-orchestrator/orchestrator.mjs next</span> then <span className="fx-mono">brief &lt;id&gt;</span>.</p>
      </article>
    </div>
  );
}

/* ---------------- grid view (the default) ---------------- */

type GStep = Step & { index: number; phaseIndex: number; locked: boolean; next: boolean };
const usdFor = (model: string, minutes: number) => (minutes ? pendingCore.costForMinutes(model, minutes, pricing) ?? 0 : 0);
const money = (v: number) => (v ? pendingCore.formatUsd(v) : '—');
const toggleIn = (list: readonly string[], v: string, on?: boolean) => { const has = list.includes(v); const want = on ?? !has; return want ? (has ? [...list] : [...list, v]) : list.filter((x) => x !== v); };
const nextSort = (cur: GridSort, col: string | null): GridSort => (!col ? null : cur?.col === col ? (cur.dir === 1 ? { col, dir: -1 } : null) : { col, dir: 1 });

/** The subgrid in an expanded row: every step, grouped by phase (a phase that switches model shows its approval). */
function StepGrid({ b, rules, busy, act, hidden, setHidden }: { b: Build; rules: Rules; busy: boolean; act: Act; hidden: string[]; setHidden: (f: (h: string[]) => string[]) => void }) {
  const [sort, setSort] = useState<GridSort>(null);
  const [open, setOpen] = useState<string[]>([]);
  const next = core.nextUp(b, rules).step?.id;
  const last = b.steps.length - 1;
  const groups: GridGroup<GStep>[] = core.phases(b).map((ph) => {
    const locked = !ph.approved; // only an upgrade Brett hasn't approved
    const rows = ph.steps.map((s) => ({ ...(s as Step & { index: number }), phaseIndex: ph.index, locked, next: s.id === next })) as GStep[];
    const done = rows.filter((s) => s.done).length;
    const cost = rows.filter((s) => !s.done).reduce((t, s) => t + usdFor(s.model, core.estimateMinutes(s.estimate) ?? 0), 0);
    return { id: `ph:${ph.index}`, title: `${ph.name} · ${ph.model}`, icon: ph.gate ? 'zap' : 'layers', rows, groups: [], fixed: true,
      progress: rows.length ? (done / rows.length) * 100 : undefined,
      summary: <>{done}/{rows.length} · {core.formatMinutes(ph.minutesLeft) || 'done'}{ph.minutesLeft ? ` · ${money(cost)}` : ''}{ph.gate && ` · ${switchNote(ph)}`}{locked && <> · <Button size="sm" tone="primary" icon="check" disabled={busy} onClick={(e) => { e.stopPropagation(); void act({ action: 'approve', id: b.id, phase: ph.index }); }}>Approve upgrade from {ph.from}</Button></>}</> };
  });
  const cols: GridColumn<GStep>[] = [
    { id: 'done', label: 'Done', width: 'calc(var(--fx-font-size) * 3)', sortable: true, sortValue: (s) => (s.done ? 1 : 0),
      render: (s) => <input type="checkbox" className="pd-tick" checked={s.done} disabled={busy || core.isFinished(b.status) || (s.locked && !s.done)} onClick={(e) => e.stopPropagation()} onChange={(ev) => void act({ action: 'step', id: b.id, step: s.id, done: ev.target.checked })} aria-label={`Step ${s.id} done`} title={s.locked ? 'Approve the model switch first' : s.done && s.doneAt ? `Done ${fmtTime(s.doneAt)}` : 'Mark this step done'} /> },
    { id: 'id', label: '#', width: 'calc(var(--fx-font-size) * 3.5)', sortable: true, sortValue: (s) => s.index, render: (s) => <span className="fx-small fx-mono">{s.id}{s.next && <span className="oc-flag"> next</span>}</span> },
    { id: 'text', label: 'Step', width: 'minmax(calc(var(--fx-font-size) * 14), calc(var(--fx-font-size) * 22))', fixed: true, sortable: true, sortValue: (s) => s.text.toLowerCase(),
      render: (s) => <span className="oc-cell-title" title={s.why ? `${s.text} — ${s.why}` : s.text}><span className={s.done ? 'oc-done' : ''}>{s.text}</span>{(s.why || s.session === 'new' || s.agent) && <span className="fx-small fx-muted">{s.why}{s.session === 'new' ? ' · new session' : ''}{s.agent ? ' · sub-agent ok' : ''}</span>}</span> },
    { id: 'model', label: 'Model', width: 'calc(var(--fx-font-size) * 4.5)', sortable: true, sortValue: (s) => s.model,
      render: (s) => { const other = s.model === 'Fable' ? 'Opus' : 'Fable'; return <button data-fx-row className={`oc-model is-${s.model.toLowerCase()}`} disabled={busy || s.done} title={`Switch this step to ${other}`} onClick={(e) => { e.stopPropagation(); void act({ action: 'edit-step', id: b.id, step: s.id, stepData: { model: other } }); }}>{s.model}</button>; } },
    { id: 'group', label: 'Group', width: 'calc(var(--fx-font-size) * 9)', sortable: true, sortValue: (s) => s.group, render: (s) => <span className="fx-small">{s.group || <span className="fx-muted">—</span>}</span> },
    { id: 'est', label: 'Time', width: 'calc(var(--fx-font-size) * 4)', align: 'end', sortable: true, sortValue: (s) => core.estimateMinutes(s.estimate) ?? -1, render: (s) => <span className="fx-small">{s.estimate || '—'}</span> },
    { id: 'cost', label: 'Cost', width: 'calc(var(--fx-font-size) * 4)', align: 'end', sortable: true, sortValue: (s) => usdFor(s.model, core.estimateMinutes(s.estimate) ?? 0), render: (s) => <span className="fx-small">{money(usdFor(s.model, core.estimateMinutes(s.estimate) ?? 0))}</span> },
    { id: 'doneAt', label: 'Done at', width: 'calc(var(--fx-font-size) * 8)', sortable: true, sortValue: (s) => s.doneAt || '', render: (s) => <span className="fx-small">{s.done && s.doneAt ? fmtTime(s.doneAt) : '—'}</span> },
    { id: 'tools', label: '', width: 'calc(var(--fx-font-size) * 5.5)', align: 'end',
      render: (s) => (
        <span className="oc-steptools" onClick={(e) => e.stopPropagation()}>
          <button className="fx-iconbtn" disabled={busy || s.index === 0} title="Move up" onClick={() => act({ action: 'move-step', id: b.id, step: s.id, dir: 'up' })}><Icon name="chevron-up" size={13} /></button>
          <button className="fx-iconbtn" disabled={busy || s.index === last} title="Move down" onClick={() => act({ action: 'move-step', id: b.id, step: s.id, dir: 'down' })}><Icon name="chevron-down" size={13} /></button>
          <button className="fx-iconbtn" disabled={busy} title="Remove step" onClick={() => act({ action: 'remove-step', id: b.id, step: s.id })}><Icon name="x" size={13} /></button>
        </span>
      ) },
  ];
  if (!b.steps.length) return <p className="fx-small fx-muted">No steps yet. Add steps of {rules.maxStepMinutes} minutes or less below.</p>;
  return (
    <div className="oc-subgrid">
      <DataGrid<GStep> id={`orch-steps-${b.id.replace(/[^a-z0-9-]/gi, '-')}`} label={`Steps of ${b.title}`} compact groups={groups} columns={cols}
        rowId={(s) => s.id} rowLabel={(s) => s.text}
        rowTone={(s) => (s.done ? 'success' : s.locked ? 'warning' : s.next ? 'accent' : 'muted')}
        hidden={hidden} onToggleColumn={(c, show) => setHidden((h) => toggleIn(h, c, show))} onShowAll={() => setHidden(() => [])}
        sort={sort} onSort={(c) => setSort((x) => nextSort(x, c))}
        expanded={open} onToggleExpand={(id) => setOpen((o) => toggleIn(o, id))} onRowClick={(s) => setOpen((o) => toggleIn(o, s.id))}
        renderDetail={(s) => (
          <div className="oc-stepdetail fx-small">
            <p><strong>{s.id}</strong> · {s.text}</p>
            {s.why && <p><strong>Why this model:</strong> {s.why}</p>}
            {s.files?.length > 0 && <p><strong>Files:</strong> <span className="fx-mono">{s.files.join(', ')}</span></p>}
            {s.checks?.length > 0 && <p><strong>Checks:</strong> <span className="fx-mono">{s.checks.join(' · ')}</span></p>}
            {s.note && <p><strong>Note:</strong> {s.note}</p>}
            <p className="fx-muted">{s.phase ? `Phase ${s.phase} · ` : ''}{s.session === 'new' ? 'Starts a new session' : 'Same session'} · {s.agent ? 'sub-agent allowed' : 'no sub-agents'}</p>
          </div>
        )} />
    </div>
  );
}
