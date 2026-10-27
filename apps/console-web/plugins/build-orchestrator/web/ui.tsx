import { useEffect, useMemo, useState } from 'react';
import { Button, Icon, Segmented, useRuntime } from '@console/axf/react';
import { pluginApi } from '@console/plugins';
import * as consoleApi from '@console/api';
import * as core from './orchestrator-core.mjs';
import './orchestrator.css';

/*
 * Build orchestrator page: a tab group (Builds · Approvals · Rules). The Builds tab looks and behaves exactly like
 * the console's Pending builds list (same pd-* cards, status strip, sort bar, step ticks, add form), with more
 * options: per-step model (Fable / Opus), phases and model-switch approvals, next-phase brief, hide / archive,
 * import from the pending list, step move / edit / remove. All rules are in orchestrator-core.mjs.
 */

export const FOLDER = 'build-orchestrator';
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
          <p className="fx-muted">Every build broken into small steps on Fable or Opus. A model switch waits for your approval. One session, no sub-agents unless a step says so. Tracker: <span className="fx-mono">_claude/builds/orchestrator.json</span>.</p>
        </div>
        <div className="fx-row fx-row--wrap"><Button icon="refresh" disabled={busy} onClick={() => load().then(() => log('reloaded', 'ok'))}>Reload</Button></div>
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
  const pickSort = (k: string) => { if (k === sort) setDir((d) => (d === 'asc' ? 'desc' : 'asc')); else { setSort(k); setDir(k === 'status' || k === 'next' ? 'asc' : 'desc'); } };
  return (
    <>
      <div className="pd-strip" role="group" aria-label="Filter by status">
        {core.STATUSES.map((s) => (
          <button data-fx-row key={s} className={`pd-count is-${s}`} aria-pressed={filter === s} onClick={() => setFilter((f) => (f === s ? '' : s))}>
            <b>{counts[s]}</b><span>{(core.STATUS_LABEL as Record<string, string>)[s]}</span>
          </button>
        ))}
      </div>
      <div className="pd-sortbar" role="group" aria-label="Category">
        <Segmented size="sm" label="View" value={view} onChange={setView} options={[{ value: 'grid', label: 'Grid', icon: 'grid' }, { value: 'list', label: 'List', icon: 'list' }]} />
        <span className="fx-small fx-muted">Category</span>
        {cats.map((c) => <button data-fx-row key={c.name} className="pd-sort" aria-pressed={cat === c.name} onClick={() => setCat((x) => (x === c.name ? '' : c.name))}>{c.name} <span className="fx-muted">{c.count}</span></button>)}
      </div>
      <div className="pd-sortbar" role="group" aria-label="Sort">
        <span className="fx-small fx-muted">Sort by</span>
        {core.SORTS.map((k) => (
          <button data-fx-row key={k} className="pd-sort" aria-pressed={sort === k} onClick={() => pickSort(k)} title={sort === k ? 'Click again to reverse' : undefined}>
            {(core.SORT_LABEL as Record<string, string>)[k]}{sort === k && <Icon name={dir === 'asc' ? 'chevron-up' : 'chevron-down'} size={13} />}
          </button>
        ))}
        {core.MODELS.map((m) => <button data-fx-row key={m} className="pd-sort" aria-pressed={model === m} onClick={() => setModel((x) => (x === m ? '' : m))}>Next on {m}</button>)}
        {hiddenCount > 0 && <button data-fx-row className="pd-sort" aria-pressed={showHidden} onClick={() => setShowHidden((v) => !v)}><Icon name={showHidden ? 'eye' : 'minimize'} size={13} />Hidden ({hiddenCount})</button>}
        {filter && <button data-fx-row className="pd-sort" onClick={() => setFilter('')}><Icon name="x" size={13} />{(core.STATUS_LABEL as Record<string, string>)[filter]} only</button>}
      </div>
      {builds.length === 0 ? <div className="fx-empty">{filter || cat ? 'No builds match.' : 'Nothing to orchestrate. Add a build below.'}</div>
        : view === 'grid' ? <BuildGrid builds={builds} rules={state.rules} busy={busy} act={act} sort={sort} dir={dir} pickSort={pickSort} />
        : <div className="pd-list" role="list">{builds.map((b) => <BuildCard key={b.id} b={b} rules={state.rules} busy={busy} act={act} />)}</div>}
      <AddForm busy={busy} act={act} />
      <ImportForm busy={busy} act={act} known={state.builds.map((b) => b.pendingId).filter(Boolean)} />
    </>
  );
}

type Mode = 'note' | 'step' | 'edit' | 'confirm' | null;
function BuildCard({ b, rules, busy, act }: { b: Build; rules: Rules; busy: boolean; act: Act }) {
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
    <article className={`pd-card is-${b.status === 'complete' ? 'complete' : b.status === 'failed' ? 'failed' : b.status === 'blocked' ? 'broken' : 'pending'}`} role="listitem" data-fx-ctx-target="axf-orchestrator-build" data-fx-ctx-payload={b.id}>
      <div className="pd-card__top">
        <h2 className="pd-card__title">{b.title}<span className="fx-muted fx-small fx-mono"> {b.id}</span>{b.hidden && <span className="fx-muted fx-small"> · hidden</span>}</h2>
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
      {n.needsApproval && n.phase && (
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
      {ps.map((ph) => (
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

const GRID_COLS: { key: string; label: string; sort?: string }[] = [
  { key: 'title', label: 'Build', sort: 'title' }, { key: 'category', label: 'Category', sort: 'category' }, { key: 'status', label: 'Status', sort: 'status' },
  { key: 'next', label: 'Next', sort: 'next' }, { key: 'steps', label: 'Steps' }, { key: 'left', label: 'Left', sort: 'left' }, { key: 'added', label: 'Added', sort: 'added' },
];

/** Grid: one row per build (sortable columns, like the Pending builds sort bar); a row expands to its full card. */
function BuildGrid({ builds, rules, busy, act, sort, dir, pickSort }: { builds: Build[]; rules: Rules; busy: boolean; act: Act; sort: string; dir: 'asc' | 'desc'; pickSort: (k: string) => void }) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  return (
    <div className="oc-grid" role="table" aria-label="Builds">
      <div className="oc-grid__row oc-grid__head" role="row">
        {GRID_COLS.map((c) => (
          <span key={c.key} role="columnheader" aria-sort={c.sort === sort ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
            {c.sort ? <button data-fx-row className="pd-sort" aria-pressed={sort === c.sort} onClick={() => pickSort(c.sort!)}>{c.label}{sort === c.sort && <Icon name={dir === 'asc' ? 'chevron-up' : 'chevron-down'} size={13} />}</button> : <span className="fx-small fx-muted">{c.label}</span>}
          </span>
        ))}
      </div>
      {builds.map((b) => {
        const p = core.progress(b); const n = core.nextUp(b, rules); const ps = core.phases(b); const isOpen = !!open[b.id];
        return (
          <div key={b.id} className={`oc-grid__item ${isOpen ? 'is-open' : ''}`} role="rowgroup">
            <button data-fx-row className={`oc-grid__row pd-card is-${b.status === 'complete' ? 'complete' : 'pending'}`} role="row" aria-expanded={isOpen} onClick={() => setOpen((o) => ({ ...o, [b.id]: !o[b.id] }))} data-fx-ctx-target="axf-orchestrator-build" data-fx-ctx-payload={b.id}>
              <span role="cell" className="oc-grid__title"><Icon name={isOpen ? 'chevron-down' : 'chevron-right'} size={14} /><b>{b.title}</b></span>
              <span role="cell">{b.category || <span className="fx-muted">—</span>}</span>
              <span role="cell"><span className={`pd-badge oc-badge is-${b.status}`}>{(core.STATUS_LABEL as Record<string, string>)[b.status]}</span></span>
              <span role="cell">{n.done ? '—' : n.needsApproval ? <span className="oc-flag">approve → {n.phase?.model}</span> : n.step ? <span className={`oc-model is-${n.step.model.toLowerCase()}`}>{n.step.model} {n.step.id}</span> : '—'}</span>
              <span role="cell">{p.done}/{p.total}<span className="fx-muted fx-small"> · {ps.length} phase{ps.length === 1 ? '' : 's'}</span></span>
              <span role="cell">{core.formatMinutes(p.minutesLeft) || '—'}</span>
              <span role="cell" className="fx-small">{fmtDate(b.createdAt)}</span>
            </button>
            {isOpen && <BuildCard b={b} rules={rules} busy={busy} act={act} />}
          </div>
        );
      })}
    </div>
  );
}
