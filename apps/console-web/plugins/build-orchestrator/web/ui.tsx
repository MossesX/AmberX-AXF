import { useEffect, useMemo, useState } from 'react';
import { Button, Icon, Segmented, Slot, useRuntime } from '@console/axf/react';
import { pluginApi } from '@console/plugins';
import * as consoleApi from '@console/api';
import * as core from './orchestrator-core.mjs';
import * as pendingCore from '@console/axf/plan/pending-core.mjs';
import pricing from '@console/axf/schemas/model-pricing.json';
import { DataGrid, RowHookButtons, registerRowRefTarget, type GridColumn, type GridGroup, type GridSort } from '@console/axf/libs/datagrid';
import './orchestrator.css';

/*
 * Build orchestrator page: a tab group (Builds · Approvals · Rules). The Builds tab looks and behaves exactly like
 * the console's Pending builds list (same pd-* cards, status strip, sort bar, step ticks, add form), with more
 * options: per-step model (Fable / Opus), phases and model-switch approvals, next-phase brief, hide / archive,
 * import from the pending list, step move / edit / remove. All rules are in orchestrator-core.mjs.
 */

export const FOLDER = 'build-orchestrator';
// grid-hook@1: a build card's right-click finds the row hooks for orchestrator builds
registerRowRefTarget('axf-orchestrator-build', (id) => (id ? { kind: 'orchestrator', id } : null));
const api = pluginApi(FOLDER, 'Build orchestrator', { unavailable: 'The build orchestrator is switched off or its server part is not running.' });
type Step = { id: string; text: string; model: 'Fable' | 'Opus'; why: string; phase: string; group: string; estimate: string; files: string[]; checks: string[]; session: 'same' | 'new'; agent: boolean; done: boolean; doneAt: string; note: string };
type Build = { id: string; title: string; category: string; detail: string; status: string; hidden: boolean; source: string; pendingId: string; branch: string; pr: string; createdAt: string; updatedAt: string; builtAt: string; notes: { text: string; at: string }[]; approvals: { phase: number; from: string; to: string; at: string }[]; steps: Step[] };
type Rules = { sameSession: boolean; subAgents: boolean; approveModelSwitch: boolean; maxStepMinutes: number };
type State = { updatedAt: string; rules: Rules; builds: Build[] };
type Res = { ok: boolean; error?: string; state?: State; log?: string[]; brief?: string };
type Act = (c: Record<string, unknown>) => Promise<boolean>;

const fmtDate = (v: string) => { if (!v) return '—'; const d = new Date(v); return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); };
const fmtTime = (v: string) => { const d = new Date(v); return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); };
const TABS = [{ id: 'builds', label: 'Builds', icon: 'list' }, { id: 'approvals', label: 'Approvals', icon: 'check-circle' }, { id: 'rules', label: 'Rules', icon: 'settings' }] as const;
type Tab = (typeof TABS)[number]['id'];

export function OrchestratorPage() {
  const rt = useRuntime();
  const log = (t: string, l: 'info' | 'ok' | 'warn' | 'error' = 'info') => rt.terminal.log('orchestrator', t, l);
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<Tab>(() => consoleApi.readLocal<Tab>('orch-tab', 'builds'));
  useEffect(() => { consoleApi.writeLocal('orch-tab', tab); }, [tab]);

  const load = async () => {
    try { const r = await api.call<Res>('state'); if (!r.ok) throw new Error(r.error); setState(r.state!); setError(''); }
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
  return (
    <div className="fx-stack fx-stack--lg">
      <header className="fx-pagehead">
        <div>
          <p className="fx-eyebrow">Build orchestrator · {state.builds.length} builds{state.updatedAt ? ` · updated ${fmtTime(state.updatedAt)}` : ''}</p>
          <h1>Build orchestrator</h1>
          <p className="fx-muted" title="One session, no sub-agents unless a step says so. Tracker: _claude/builds/orchestrator.json">Every build in small Fable / Opus steps; a model switch waits for your approval.</p>
        </div>
        <div className="fx-row fx-row--wrap"><Button icon="refresh" disabled={busy} onClick={() => load().then(() => log('reloaded', 'ok'))}>Reload</Button><Slot name="builds.toolbar" props={{ page: 'build-orchestrator' }} /></div>
      </header>
      {error && <div className="pl-note is-warn"><Icon name="alert" size={14} />{error}</div>}
      <div className="fx-tabs" role="tablist" aria-label="Build orchestrator">
        {TABS.map((t) => (
          <button key={t.id} role="tab" className="fx-tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}>
            <Icon name={t.icon} size={14} />{t.label}{t.id === 'approvals' && waiting > 0 && <span className="oc-count">{waiting}</span>}
          </button>
        ))}
      </div>
      {tab === 'builds' && <BuildsTab state={state} busy={busy} act={act} />}
      {tab === 'approvals' && <ApprovalsTab state={state} busy={busy} act={act} />}
      {tab === 'rules' && <RulesTab rules={state.rules} busy={busy} act={act} />}
    </div>
  );
}

function BuildsTab({ state, busy, act }: { state: State; busy: boolean; act: Act }) {
  const [sort, setSort] = useState<string>(() => consoleApi.readLocal('orch-sort', 'status'));
  const [dir, setDir] = useState<'asc' | 'desc'>(() => consoleApi.readLocal('orch-dir', 'asc'));
  const [filter, setFilter] = useState('');
  const [model, setModel] = useState('');
  const [showHidden, setShowHidden] = useState(false);
  const [view, setView] = useState<'list' | 'grid'>(() => consoleApi.readLocal('orch-view', 'grid'));
  const [cat, setCat] = useState('');
  useEffect(() => { consoleApi.writeLocal('orch-view', view); }, [view]);
  useEffect(() => { consoleApi.writeLocal('orch-sort', sort); consoleApi.writeLocal('orch-dir', dir); }, [sort, dir]);
  const builds = useMemo(() => {
    let all = state.builds.filter((b) => (showHidden ? true : !b.hidden));
    if (!filter) all = all.filter((b) => b.status !== 'archived');
    else all = all.filter((b) => b.status === filter);
    if (model) all = all.filter((b) => core.nextUp(b, state.rules).step?.model === model);
    if (cat) all = all.filter((b) => (b.category || core.UNCATEGORISED) === cat);
    return core.sortBuilds(all, sort, dir, state.rules) as Build[];
  }, [state, sort, dir, filter, model, showHidden, cat]);
  const cats = core.categories(state.builds.filter((b) => b.status !== 'archived'));
  const counts = core.counts(state.builds) as Record<string, number>;
  const hiddenCount = state.builds.filter((b) => b.hidden).length;
  return (
    <>
      <div className="pd-strip" role="group" aria-label="Filter by status">
        {core.STATUSES.map((s) => (
          <button data-fx-row key={s} className={`pd-count is-${s}`} aria-pressed={filter === s} onClick={() => setFilter((f) => (f === s ? '' : s))}>
            <b>{counts[s]}</b><span>{(core.STATUS_LABEL as Record<string, string>)[s]}</span>
          </button>
        ))}
      </div>
      <div className="oc-bar" role="toolbar" aria-label="Show">
        <Segmented size="sm" label="View" value={view} onChange={setView} options={[{ value: 'grid', label: 'Grid', icon: 'grid' }, { value: 'list', label: 'List', icon: 'list' }]} />
        <select className="fx-input oc-bar__pick" aria-label="Category" value={cat} onChange={(e) => setCat(e.target.value)}>
          <option value="">All categories</option>
          {cats.map((c) => <option key={c.name} value={c.name}>{c.name} ({c.count})</option>)}
        </select>
        <select className="fx-input oc-bar__pick" aria-label="Next step on" value={model} onChange={(e) => setModel(e.target.value)}>
          <option value="">Any model next</option>
          {core.MODELS.map((m) => <option key={m} value={m}>Next on {m}</option>)}
        </select>
        {view === 'list' && (
          <select className="fx-input oc-bar__pick" aria-label="Sort by" value={`${sort}:${dir}`} onChange={(e) => { const [k, d] = e.target.value.split(':'); setSort(k!); setDir(d as 'asc' | 'desc'); }}>
            {core.SORTS.flatMap((k) => (['asc', 'desc'] as const).map((d) => <option key={`${k}:${d}`} value={`${k}:${d}`}>{(core.SORT_LABEL as Record<string, string>)[k]} {d === 'asc' ? '↑' : '↓'}</option>))}
          </select>
        )}
        {hiddenCount > 0 && <button data-fx-row className="pd-sort" aria-pressed={showHidden} onClick={() => setShowHidden((v) => !v)}><Icon name={showHidden ? 'eye' : 'minimize'} size={13} />Hidden ({hiddenCount})</button>}
        {filter && <button data-fx-row className="pd-sort" onClick={() => setFilter('')}><Icon name="x" size={13} />{(core.STATUS_LABEL as Record<string, string>)[filter]} only</button>}
      </div>
      {builds.length === 0 ? <div className="fx-empty">{filter || cat ? 'No builds match.' : 'Nothing to orchestrate. Add a build below.'}</div>
        : view === 'grid' ? <BuildGrid builds={builds} rules={state.rules} busy={busy} act={act} />
        : <div className="pd-list" role="list">{builds.map((b) => <BuildCard key={b.id} b={b} rules={state.rules} busy={busy} act={act} />)}</div>}
      <AddForm busy={busy} act={act} />
      <ImportForm busy={busy} act={act} known={state.builds.map((b) => b.pendingId).filter(Boolean)} />
    </>
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
    <article className={`${embedded ? 'oc-embedded ' : ''}pd-card is-${b.status === 'complete' ? 'complete' : b.status === 'failed' ? 'failed' : b.status === 'blocked' ? 'broken' : 'pending'}`} role={embedded ? undefined : "listitem"} data-fx-ctx-target="axf-orchestrator-build" data-fx-ctx-payload={b.id}>
      <div className="pd-card__top">
        <h2 className="pd-card__title">{embedded ? <span className="fx-small fx-muted">Build</span> : b.title}<span className="fx-muted fx-small fx-mono"> {b.id}</span>{b.hidden && <span className="fx-muted fx-small"> · hidden</span>}</h2>
        <button data-fx-row className={`pd-badge oc-badge is-${b.status}`} aria-expanded={statusOpen} aria-label={`Status: ${b.status}. Change`} onClick={() => setStatusOpen((o) => !o)}>{(core.STATUS_LABEL as Record<string, string>)[b.status]}</button>
      </div>
      {statusOpen && (
        <div className="fx-row fx-row--wrap">
          {core.STATUSES.map((s) => <button data-fx-row key={s} className={`pd-badge oc-badge is-${s}`} disabled={busy || s === b.status} onClick={async () => { if (await act({ action: 'status', id: b.id, status: s })) setStatusOpen(false); }}>{(core.STATUS_LABEL as Record<string, string>)[s]}</button>)}
        </div>
      )}
      <div className="pd-meta">
        <span className={`pd-date ${b.builtAt ? 'is-built' : ''}`} title={`Added ${fmtTime(b.createdAt)}`}><Icon name={b.builtAt ? 'check-circle' : 'clock'} size={13} />{b.builtAt ? `Built ${fmtDate(b.builtAt)}` : `Added ${fmtDate(b.createdAt)}`}</span>
        {p.total > 0 && <span className="pd-est"><Icon name="check-circle" size={13} />{p.done}/{p.total} steps{p.minutesLeft ? ` · ${core.formatMinutes(p.minutesLeft)} left` : ''}</span>}
        {core.MODELS.map((m) => (p.byModel as Record<string, number>)[m] ? <span key={m} className={`oc-model is-${m.toLowerCase()}`}>{m} {core.formatMinutes((p.byModel as Record<string, number>)[m])}</span> : null)}
        {p.switches > 0 && <span title="Model switches; each one waits for your approval"><Icon name="zap" size={13} />{p.switches} switch{p.switches === 1 ? '' : 'es'}</span>}
        {split.needsSplit && b.status !== 'complete' && <span className="pd-split" title={split.reasons.join('; ')}><Icon name="alert" size={13} />needs splitting</span>}
        {b.category && <span><Icon name="layers" size={13} />{b.category}</span>}
        {b.pendingId && <span className="fx-mono">pending:{b.pendingId}</span>}
        {b.branch && <span className="fx-mono">{b.branch}</span>}
      </div>
      {!embedded && n.needsApproval && n.phase && (
        <div className="pl-note is-warn oc-gate"><Icon name="alert" size={14} />Next phase switches {n.phase.from} → {n.phase.model}. Approve before a session starts it.
          <Button tone="primary" icon="check" disabled={busy} onClick={() => act({ action: 'approve', id: b.id, phase: n.phase!.index })}>Approve switch to {n.phase.model}</Button>
        </div>
      )}
      {!n.needsApproval && n.step && b.status !== 'complete' && <p className="fx-small fx-muted">Next: <b>{n.step.id}</b> on <span className={`oc-model is-${n.step.model.toLowerCase()}`}>{n.step.model}</span> — {n.step.text}</p>}
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
          <h3>{ph.name} · <span className={`oc-model is-${ph.model.toLowerCase()}`}>{ph.model}</span>{ph.gate && <span className="fx-muted fx-small"> · switch from {ph.from} {ph.approved ? '(approved)' : '(needs approval)'}</span>}{ph.minutesLeft ? <span className="pd-est"> · {core.formatMinutes(ph.minutesLeft)} left</span> : null}</h3>
          {ph.groups.map((g, gi) => (
            <div key={gi} className="oc-group">
              {g.label && <h4 className="oc-group__head">{g.label}<span className="fx-muted fx-small"> · {g.done}/{g.steps.length}{g.minutesLeft ? ` · ${core.formatMinutes(g.minutesLeft)} left` : ''}</span></h4>}
              {g.steps.map((s) => <StepRow key={s.id} b={b} s={s as Step & { index: number }} locked={ph.gate && !ph.approved && rules.approveModelSwitch} busy={busy} act={act} last={b.steps.length - 1} />)}
            </div>
          ))}
        </div>
      ))}
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
      <input type="checkbox" className="pd-tick" checked={s.done} disabled={busy || b.status === 'complete' || (locked && !s.done)} onChange={(ev) => void act({ action: 'step', id: b.id, step: s.id, done: ev.target.checked })} aria-label={`Step ${s.id} done`} title={locked ? 'Approve the model switch first' : s.done && s.doneAt ? `Done ${fmtTime(s.doneAt)}` : 'Mark this step done'} />
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

function ApprovalsTab({ state, busy, act }: { state: State; busy: boolean; act: Act }) {
  const gates = state.builds.flatMap((b) => core.phases(b).filter((p) => p.gate).map((p) => ({ b, p })));
  if (!gates.length) return <div className="fx-empty">No model switches in any build.</div>;
  return (
    <div className="pd-list" role="list">
      {gates.map(({ b, p }) => (
        <article key={`${b.id}-${p.index}`} className={`pd-card ${p.approved ? 'is-complete' : 'is-pending'}`} role="listitem">
          <div className="pd-card__top">
            <h2 className="pd-card__title">{b.title}<span className="fx-muted fx-small"> · phase {p.index + 1}</span></h2>
            <span className={`pd-badge oc-badge is-${p.approved ? 'complete' : 'waiting'}`}>{p.approved ? 'Approved' : 'Needs approval'}</span>
          </div>
          <div className="pd-meta"><span className={`oc-model is-${p.from.toLowerCase()}`}>{p.from}</span><Icon name="chevron-right" size={13} /><span className={`oc-model is-${p.model.toLowerCase()}`}>{p.model}</span><span>{p.steps.length} steps · {core.formatMinutes(p.minutesLeft) || 'done'}</span></div>
          {!p.approved && <div><Button tone="primary" icon="check" disabled={busy} onClick={() => act({ action: 'approve', id: b.id, phase: p.index })}>Approve switch to {p.model}</Button></div>}
        </article>
      ))}
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
        <label className="fx-row"><input type="checkbox" checked={r.approveModelSwitch} onChange={() => flip('approveModelSwitch')} />Ask for approval at every Fable ↔ Opus switch</label>
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

function AddForm({ busy, act }: { busy: boolean; act: Act }) {
  const [title, setTitle] = useState('');
  const [detail, setDetail] = useState('');
  const [steps, setSteps] = useState('');
  const [category, setCategory] = useState('');
  return (
    <details className="pd-add">
      <summary>Add a build</summary>
      <form className="fx-stack" onSubmit={async (e) => {
        e.preventDefault();
        let phase = ''; let group = '';
        const list = steps.split('\n').map((l) => l.trim()).filter(Boolean).flatMap((l) => {
          if (l.startsWith('## ')) { group = l.slice(3).trim(); return []; }
          if (l.startsWith('# ')) { phase = l.slice(2).trim(); group = ''; return []; }
          const m = /^(fable|opus)\s*[:|-]\s*(.*?)(?:\s*\((\d+\s*(?:min|h))\))?$/i.exec(l);
          return [{ ...(m ? { model: (m[1] ?? "").toLowerCase() === "fable" ? "Fable" : "Opus", text: m[2] ?? l, estimate: m[3] ?? '' } : { model: 'Opus', text: l, estimate: '' }), phase, group }];
        });
        if (title.trim() && (await act({ action: 'add', title, detail, category, steps: list, source: 'console' }))) { setTitle(''); setDetail(''); setSteps(''); }
      }}>
        <label className="pd-field">Title<input className="fx-input" required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What to build" /></label>
        <label className="pd-field">Details<textarea className="fx-input" rows={3} value={detail} onChange={(e) => setDetail(e.target.value)} placeholder="Scope, files touched, acceptance notes" /></label>
        <label className="pd-field">Category<input className="fx-input" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. Console UI" /></label>
        <label className="pd-field">Steps, one per line ("# Phase name" and "## Group name" lines label the steps below them): “Fable: design the contract (25 min)” or “Opus: wire the route (20 min)”<textarea className="fx-input fx-mono" rows={5} value={steps} onChange={(e) => setSteps(e.target.value)} /></label>
        <div><Button tone="primary" icon="plus" disabled={busy || !title.trim()} type="submit">Add to orchestrator</Button></div>
      </form>
    </details>
  );
}

function ImportForm({ busy, act, known }: { busy: boolean; act: Act; known: string[] }) {
  const [items, setItems] = useState<{ id: string; title: string; model: string; status: string; detail: string; subPrompts: unknown[] }[] | null>(null);
  const [pick, setPick] = useState('');
  const open = async () => { if (items) return; try { const s = await consoleApi.loadPending(); setItems((s.items as never[]).filter((i: { status: string }) => i.status === 'pending' || i.status === 'unsafe')); } catch { setItems([]); } };
  const left = (items ?? []).filter((i) => !known.includes(i.id));
  return (
    <details className="pd-add" onToggle={(e) => { if ((e.target as HTMLDetailsElement).open) void open(); }}>
      <summary>Import from Pending builds</summary>
      {!items ? <div className="fx-empty">Loading…</div> : left.length === 0 ? <div className="fx-empty">Every open pending build is already here.</div> : (
        <div className="fx-row fx-row--wrap">
          <select className="fx-input" value={pick} onChange={(e) => setPick(e.target.value)}><option value="">Pick a pending build</option>{left.map((i) => <option key={i.id} value={i.id}>{i.title} ({i.model})</option>)}</select>
          <Button tone="primary" icon="download" disabled={busy || !pick} onClick={async () => { const it = left.find((i) => i.id === pick); if (it && (await act({ action: 'import', item: it }))) setPick(''); }}>Import</Button>
        </div>
      )}
    </details>
  );
}

/* ---------------- grid view (the default) ---------------- */

type GStep = Step & { index: number; phaseIndex: number; locked: boolean; next: boolean };
const usdFor = (model: string, minutes: number) => (minutes ? pendingCore.costForMinutes(model, minutes, pricing) ?? 0 : 0);
const money = (v: number) => (v ? pendingCore.formatUsd(v) : '—');
const toggleIn = (list: readonly string[], v: string, on?: boolean) => { const has = list.includes(v); const want = on ?? !has; return want ? (has ? [...list] : [...list, v]) : list.filter((x) => x !== v); };
const nextSort = (cur: GridSort, col: string | null): GridSort => (!col ? null : cur?.col === col ? (cur.dir === 1 ? { col, dir: -1 } : null) : { col, dir: 1 });
const summary = (b: Build) => { const t = (b.detail || '').replace(/\s+/g, ' ').trim(); const dot = t.search(/[.!?](\s|$)/); return dot > 0 && dot < 160 ? t.slice(0, dot + 1) : t.length > 160 ? `${t.slice(0, 157)}…` : t; };
const STATUS_TONE: Record<string, string> = { pending: 'muted', running: 'accent', waiting: 'warning', blocked: 'warning', failed: 'danger', complete: 'success', archived: 'muted' };

/** Time and dollars for a build: total and left, priced per step on the step's own model. */
function figures(b: Build) {
  let total = 0, left = 0, cost = 0, costLeft = 0;
  for (const s of b.steps) { const m = core.estimateMinutes(s.estimate) ?? 0; total += m; cost += usdFor(s.model, m); if (!s.done) { left += m; costLeft += usdFor(s.model, m); } }
  return { total, left, cost, costLeft };
}

/** Grid: one row per build, grouped by category (columns like the Pending builds grid); a row expands to its steps as a subgrid plus the build's actions. */
function BuildGrid({ builds, rules, busy, act }: { builds: Build[]; rules: Rules; busy: boolean; act: Act }) {
  const [sort, setSort] = useState<GridSort>(() => consoleApi.readLocal<GridSort>('orch-grid-sort', null));
  const [hidden, setHidden] = useState<string[]>(() => consoleApi.readLocal<string[]>('orch-grid-hidden', ['left']));
  const [stepHidden, setStepHidden] = useState<string[]>(() => consoleApi.readLocal<string[]>('orch-step-hidden', ['doneAt']));
  const [open, setOpen] = useState<string[]>([]);
  const [collapsed, setCollapsed] = useState<string[]>([]);
  useEffect(() => { consoleApi.writeLocal('orch-grid-sort', sort); consoleApi.writeLocal('orch-grid-hidden', hidden); consoleApi.writeLocal('orch-step-hidden', stepHidden); }, [sort, hidden, stepHidden]);
  const fig = useMemo(() => new Map(builds.map((b) => [b.id, figures(b)])), [builds]);
  const groups: GridGroup<Build>[] = useMemo(() => {
    const by = new Map<string, Build[]>();
    for (const b of builds) { const c = b.category || core.UNCATEGORISED; by.set(c, [...(by.get(c) ?? []), b]); }
    return [...by.entries()].sort((a, c) => a[0].localeCompare(c[0])).map(([name, rows]) => {
      const t = rows.reduce((a, b) => { const f = fig.get(b.id)!; const p = core.progress(b); return { left: a.left + f.left, cost: a.cost + f.costLeft, done: a.done + p.done, total: a.total + p.total }; }, { left: 0, cost: 0, done: 0, total: 0 });
      return { id: `cat:${name}`, title: `${name} (${rows.length})`, icon: 'layers', rows, groups: [], collapsed: collapsed.includes(`cat:${name}`),
        summary: `${core.formatMinutes(t.left) || 'nothing'} left · ${money(t.cost)}`, progress: t.total ? (t.done / t.total) * 100 : undefined };
    });
  }, [builds, fig, collapsed]);
  const cols: GridColumn<Build>[] = [
    { id: 'title', label: 'Build', width: 'minmax(calc(var(--fx-font-size) * 16), calc(var(--fx-font-size) * 25))', fixed: true, sortable: true, sortValue: (b) => b.title.toLowerCase(),
      render: (b) => <span className="oc-cell-title" title={b.detail || b.title}><strong>{b.title}{b.hidden && <span className="fx-muted fx-small"> · hidden</span>}</strong>{summary(b) && <span className="fx-small fx-muted">{summary(b)}</span>}</span> },
    { id: 'status', label: 'Status', width: 'calc(var(--fx-font-size) * 7.5)', sortable: true, sortValue: (b) => core.STATUSES.indexOf(b.status),
      render: (b) => <span className={`pd-badge oc-badge is-${b.status}`}>{(core.STATUS_LABEL as Record<string, string>)[b.status]}</span> },
    { id: 'next', label: 'Next', width: 'calc(var(--fx-font-size) * 6)', sortable: true, sortValue: (b) => core.nextUp(b, rules).step?.model ?? 'zz',
      render: (b) => { const n = core.nextUp(b, rules); return n.done ? <span className="fx-muted">—</span> : n.needsApproval ? <span className="oc-flag" title="The next phase switches model: approve it first">approve → {n.phase?.model}</span> : n.step ? <span className={`oc-model is-${n.step.model.toLowerCase()}`}>{n.step.model} {n.step.id}</span> : <span className="fx-muted">—</span>; } },
    { id: 'steps', label: 'Steps', width: 'calc(var(--fx-font-size) * 3.5)', align: 'end', sortable: true, sortValue: (b) => core.progress(b).total,
      render: (b) => { const p = core.progress(b); return <span className="fx-small" title={`${core.phases(b).length} phase(s)`}>{p.done}/{p.total}</span>; } },
    { id: 'time', label: 'Time', width: 'calc(var(--fx-font-size) * 4)', align: 'end', sortable: true, sortValue: (b) => fig.get(b.id)!.total,
      render: (b) => { const f = fig.get(b.id)!; return <span className="fx-small" title={`${core.formatMinutes(f.left) || 'nothing'} left`}>{core.formatMinutes(f.total) || '—'}</span>; } },
    { id: 'left', label: 'Left', width: 'calc(var(--fx-font-size) * 4)', align: 'end', sortable: true, sortValue: (b) => fig.get(b.id)!.left,
      render: (b) => <span className="fx-small">{core.formatMinutes(fig.get(b.id)!.left) || '—'}</span> },
    { id: 'cost', label: 'Cost', width: 'calc(var(--fx-font-size) * 4)', align: 'end', sortable: true, sortValue: (b) => fig.get(b.id)!.cost,
      render: (b) => { const f = fig.get(b.id)!; return <span className="fx-small" title={`Estimated: minutes × the model’s price per working minute · ${money(f.costLeft)} left`}>{money(f.cost)}</span>; } },
    { id: 'added', label: 'Added', width: 'calc(var(--fx-font-size) * 7)', align: 'end', sortable: true, sortValue: (b) => b.createdAt,
      render: (b) => <span className="fx-small" title={fmtTime(b.createdAt)}>{fmtDate(b.createdAt)}</span> },
  ];
  return (
    <>
      <div className="pd-sortbar">
        <Button size="sm" tone="neutral" icon={open.length ? 'chevron-up' : 'chevron-down'} onClick={() => setOpen(open.length ? [] : builds.map((b) => b.id))}>{open.length ? 'Collapse all' : 'Expand all'}</Button>
        <span className="fx-small fx-muted">Tap a column to sort · right-click a column to hide it</span>
      </div>
      <div className="oc-grid">
        <DataGrid<Build> id="orch-builds" label="Builds" groups={groups} columns={cols} rowId={(b) => b.id} rowLabel={(b) => b.title}
          rowTone={(b) => STATUS_TONE[b.status] ?? 'muted'}
          hidden={hidden} onToggleColumn={(c, show) => setHidden((h) => toggleIn(h, c, show))} onShowAll={() => setHidden([])}
          sort={sort} onSort={(c) => setSort((s) => nextSort(s, c))}
          expanded={open} onToggleExpand={(id) => setOpen((o) => toggleIn(o, id))} onRowClick={(b) => setOpen((o) => toggleIn(o, b.id))}
          onToggleGroup={(id) => setCollapsed((c) => toggleIn(c, id))}
          rowCtx={(b) => ({ target: 'axf-orchestrator-build', payload: b.id })} rowRef={(b) => ({ kind: 'orchestrator', id: b.id })}
          renderDetail={(b) => (
            <div className="oc-detail">
              <StepGrid b={b} rules={rules} busy={busy} act={act} hidden={stepHidden} setHidden={setStepHidden} />
              <BuildCard b={b} rules={rules} busy={busy} act={act} embedded />
            </div>
          )} />
      </div>
    </>
  );
}

/** The subgrid in an expanded row: every step, grouped by phase (a phase that switches model shows its approval). */
function StepGrid({ b, rules, busy, act, hidden, setHidden }: { b: Build; rules: Rules; busy: boolean; act: Act; hidden: string[]; setHidden: (f: (h: string[]) => string[]) => void }) {
  const [sort, setSort] = useState<GridSort>(null);
  const [open, setOpen] = useState<string[]>([]);
  const next = core.nextUp(b, rules).step?.id;
  const last = b.steps.length - 1;
  const groups: GridGroup<GStep>[] = core.phases(b).map((ph) => {
    const locked = ph.gate && !ph.approved && rules.approveModelSwitch;
    const rows = ph.steps.map((s) => ({ ...(s as Step & { index: number }), phaseIndex: ph.index, locked, next: s.id === next })) as GStep[];
    const done = rows.filter((s) => s.done).length;
    const cost = rows.filter((s) => !s.done).reduce((t, s) => t + usdFor(s.model, core.estimateMinutes(s.estimate) ?? 0), 0);
    return { id: `ph:${ph.index}`, title: `${ph.name} · ${ph.model}`, icon: ph.gate ? 'zap' : 'layers', rows, groups: [], fixed: true,
      progress: rows.length ? (done / rows.length) * 100 : undefined,
      summary: <>{done}/{rows.length} · {core.formatMinutes(ph.minutesLeft) || 'done'}{ph.minutesLeft ? ` · ${money(cost)}` : ''}{ph.gate && (ph.approved ? ` · switch from ${ph.from} approved` : ' · ')}{locked && <Button size="sm" tone="primary" icon="check" disabled={busy} onClick={(e) => { e.stopPropagation(); void act({ action: 'approve', id: b.id, phase: ph.index }); }}>Approve switch from {ph.from}</Button>}</> };
  });
  const cols: GridColumn<GStep>[] = [
    { id: 'done', label: 'Done', width: 'calc(var(--fx-font-size) * 3)', sortable: true, sortValue: (s) => (s.done ? 1 : 0),
      render: (s) => <input type="checkbox" className="pd-tick" checked={s.done} disabled={busy || b.status === 'complete' || (s.locked && !s.done)} onClick={(e) => e.stopPropagation()} onChange={(ev) => void act({ action: 'step', id: b.id, step: s.id, done: ev.target.checked })} aria-label={`Step ${s.id} done`} title={s.locked ? 'Approve the model switch first' : s.done && s.doneAt ? `Done ${fmtTime(s.doneAt)}` : 'Mark this step done'} /> },
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
        expanded={open} onToggleExpand={(id) => setOpen((o) => toggleIn(o, id))}
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
