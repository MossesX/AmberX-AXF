/* Feature assistant UI: the “Describe a feature” box (slot plan.top), the feature-detail buttons (slot plan.feature),
   the Build with Mosses dialog and the settings panels. Theme tokens only, axp-feature-assist prefix. */
import { useEffect, useState, useSyncExternalStore } from 'react';
import { Button, Chip, Icon, IconButton, useRuntime } from '@console/axf/react';
import { call, getStatus, onStatus, planChanged, post, refreshStatus, rememberFeatures, type BuildPlan, type Draft, type DraftResult, type Status } from './api';

const P = 'axp-feature-assist';
const MODEL_LABEL: Record<string, string> = { fable: 'Fable 5.1', opus: 'Opus 5.5', sonnet: 'Sonnet 5.5' };
const useFAStatus = () => useSyncExternalStore(onStatus, getStatus, getStatus);

/* ---------------- Describe a feature (plan.top) ---------------- */

function DraftEditor({ d, set, onRemove, depth = 0 }: { d: Draft; set: (d: Draft) => void; onRemove: () => void; depth?: number }) {
  return (
    <div className={`${P}__draft ${depth ? 'is-sub' : ''}`}>
      <div className={`${P}__row`}>
        <input className="fx-input fx-grow" value={d.title} onChange={(e) => set({ ...d, title: e.target.value })} aria-label="Title" />
        <select className={`fx-input ${P}__narrow`} value={d.kind} onChange={(e) => set({ ...d, kind: e.target.value as Draft['kind'] })} aria-label="Kind">{['epic', 'feature', 'task'].map((k) => <option key={k}>{k}</option>)}</select>
        <select className={`fx-input ${P}__narrow`} value={d.priority} onChange={(e) => set({ ...d, priority: e.target.value })} aria-label="Priority">{['P0', 'P1', 'P2', 'P3'].map((k) => <option key={k}>{k}</option>)}</select>
        <select className={`fx-input ${P}__narrow`} value={d.model} onChange={(e) => set({ ...d, model: e.target.value as Draft['model'] })} aria-label="Build with" title={d.modelReason}>{Object.entries(MODEL_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <IconButton icon="x" label="Remove" onClick={onRemove} />
      </div>
      <textarea className="fx-input" rows={2} value={d.summary} onChange={(e) => set({ ...d, summary: e.target.value })} aria-label="Summary" />
      <div className="fx-small fx-muted">
        {d.area}{d.where ? ` · ${d.where}` : ''}{d.parent ? ` · under ${d.parent}` : ''}{d.dependsOn.length ? ` · needs ${d.dependsOn.join(', ')}` : ''}
        {Object.keys(d.ports).length ? ` · ports: ${Object.entries(d.ports).map(([p, s]) => `${p} ${s}`).join(', ')}` : ''}
      </div>
      {d.acceptance.length > 0 && <ul className={`${P}__acc`}>{d.acceptance.map((a, i) => <li key={i}>{a}</li>)}</ul>}
      {d.subFeatures.map((s, i) => (
        <DraftEditor key={i} d={s} depth={depth + 1} set={(n) => set({ ...d, subFeatures: d.subFeatures.map((x, j) => (j === i ? n : x)) })} onRemove={() => set({ ...d, subFeatures: d.subFeatures.filter((_, j) => j !== i) })} />
      ))}
    </div>
  );
}

export function DescribeBox({ features }: { features?: { id: string; status: string }[] }) {
  const s = useFAStatus();
  const rt = useRuntime();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState('');
  const [res, setRes] = useState<DraftResult | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [pending, setPending] = useState(true);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState(false);
  useEffect(() => { if (features) rememberFeatures(features); }, [features]);
  useEffect(() => { if (!getStatus()) void refreshStatus(); }, []);
  if (!s?.describe) return null; // needs the AI assistant + the AXF expert; without them the planner works as before
  const draft = async () => {
    setBusy('draft'); setErr(''); setRes(null);
    try { const r = await post<DraftResult>('draft', { text }); setRes(r); setDrafts(r.features); } catch (e) { setErr((e as Error).message); } finally { setBusy(''); }
  };
  const approve = async () => {
    setBusy('approve'); setErr('');
    try {
      const r = await post<{ saved: string[]; pending: string[] }>('approve', { features: drafts, pending });
      rt.toast(`${r.saved.length} feature(s) added to the plan${r.pending.length ? `, ${r.pending.length} on the pending list` : ''}`, 'success', 'Feature assistant');
      setRes(null); setDrafts([]); setText(''); planChanged();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(''); }
  };
  return (
    <section className={P}>
      <button type="button" data-fx-row className={`${P}__head`} aria-expanded={open || !!res} onClick={() => setOpen(!open)}>
        <Icon name="sparkles" size={15} /><strong>Describe a feature</strong>
        <span className="fx-small fx-muted fx-grow">in your own words; the {s.expertName ?? 'AXF expert'} turns it into plan entries</span>
        <Icon name={open || res ? 'chevron-up' : 'chevron-down'} size={14} />
      </button>
      {(open || res) && (
        <div className="fx-stack">
          {!res && (
            <>
              <textarea className="fx-input" rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. a way to back up my phone's photos to the VPS and browse them in the console, with albums" />
              <div className={`${P}__row`}><Button tone="primary" icon="sparkles" disabled={!text.trim() || !!busy} onClick={() => void draft()}>{busy === 'draft' ? 'Thinking…' : 'Draft it'}</Button><span className="fx-small fx-muted">Nothing is saved until you approve.</span></div>
            </>
          )}
          {res && (
            <div className={`${P}__preview fx-stack`}>
              <div className={`${P}__row`}><strong className="fx-grow">Preview</strong>{res.agent && <Chip>{res.agent}</Chip>}</div>
              {res.clashes.length > 0 && <div className={`${P}__clash`}><Icon name="alert" size={14} /><ul>{res.clashes.map((c, i) => <li key={i}>{c.text}{c.featureId ? <span className="fx-mono fx-muted"> ({c.featureId})</span> : null}</li>)}</ul></div>}
              {res.notes && <p className="fx-small">{res.notes}</p>}
              {drafts.map((d, i) => <DraftEditor key={i} d={d} set={(n) => setDrafts(drafts.map((x, j) => (j === i ? n : x)))} onRemove={() => setDrafts(drafts.filter((_, j) => j !== i))} />)}
              <label className={`${P}__opt`}><input type="checkbox" checked={pending} onChange={(e) => setPending(e.target.checked)} /> Also add them to the pending build list (with the model each needs)</label>
              <div className={`${P}__row`}>
                <Button tone="primary" icon="check" disabled={!drafts.length || !!busy} onClick={() => void approve()}>{busy === 'approve' ? 'Saving…' : `Approve ${drafts.length}`}</Button>
                <Button tone="ghost" icon="x" disabled={!!busy} onClick={() => { setRes(null); setDrafts([]); }}>Reject</Button>
                <Button tone="ghost" icon="refresh" disabled={!!busy} onClick={() => void draft()}>Draft again</Button>
              </div>
            </div>
          )}
          {err && <p className={`${P}__bad`}>{err}</p>}
        </div>
      )}
    </section>
  );
}

/* ---------------- Feature detail (plan.feature) ---------------- */

export function FeatureActions({ feature }: { feature?: { id: string; status: string; title: string } }) {
  const s = useFAStatus();
  const rt = useRuntime();
  const [notes, setNotes] = useState('');
  useEffect(() => { if (!getStatus()) void refreshStatus(); }, []);
  if (!feature || !s?.build) return null;
  const building = s.building[feature.id];
  const finish = async (status: 'built' | 'partial') => {
    try { await post('build/finish', { featureId: feature.id, status, notes }); setNotes(''); await refreshStatus(); planChanged(); rt.toast(`Marked ${status}`, 'success'); }
    catch (e) { rt.toast((e as Error).message, 'danger'); }
  };
  if (building) {
    return (
      <div className={`${P}__building`}>
        <Icon name="rocket" size={14} /><span className="fx-grow">Mosses is building this on {MODEL_LABEL[building.model] ?? building.model} (since {new Date(building.at).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })}).</span>
        <input className={`fx-input ${P}__notes`} placeholder="notes (what's left)" value={notes} onChange={(e) => setNotes(e.target.value)} />
        <Button icon="check" onClick={() => void finish('built')}>Mark built</Button>
        <Button tone="ghost" onClick={() => void finish('partial')}>Mark partial</Button>
      </div>
    );
  }
  if (feature.status === 'built') return null;
  return <div><Button icon="rocket" onClick={() => rt.openDialog('feature-assist.build', { featureId: feature.id })}>Build with Mosses</Button></div>;
}

/* ---------------- Build with Mosses (dialog) ---------------- */

type Step = 'confirm' | 'planning' | 'review' | 'model' | 'starting' | 'done';

export function BuildDialog({ featureId, close }: { featureId: string; close: () => void }) {
  const rt = useRuntime();
  const s = useFAStatus();
  const [step, setStep] = useState<Step>('confirm');
  const [plan, setPlan] = useState<BuildPlan | null>(null);
  const [useOrder, setUseOrder] = useState(true);
  const [model, setModel] = useState<'fable' | 'opus' | 'sonnet'>('opus');
  const [fableLater, setFableLater] = useState(true);
  const [err, setErr] = useState('');
  const [title, setTitle] = useState(featureId);
  const [result, setResult] = useState('');
  useEffect(() => {
    if (!getStatus()) void refreshStatus();
    setTitle(featureId);
  }, [featureId]);
  const doPlan = async () => {
    setStep('planning'); setErr('');
    try { const p = await post<BuildPlan>('build/plan', { featureId }); setPlan(p); setTitle(p.feature.title); setModel(p.model.recommend); setStep('review'); }
    catch (e) { setErr((e as Error).message); setStep('confirm'); }
  };
  const start = async () => {
    if (!plan) return;
    setStep('starting'); setErr('');
    try {
      const r = await post<{ parked: boolean; pending: string[]; chat?: { agentId: string; message: string; title: string; profile: string | null; model: string | null } }>('build/start', {
        featureId, plan: plan.plan, model, fableLater: model !== 'fable' && fableLater, park: model === 'fable', order: useOrder && plan.order.changed ? plan.order.after : null,
      });
      await refreshStatus(); planChanged();
      if (r.parked) { setResult(`Parked for Fable on the pending list (${r.pending.join(', ')}). Add it to the claude.ai Pending Builds page too when you sync.`); setStep('done'); return; }
      if (r.chat) rt.dispatch(`ai.chat.start:${encodeURIComponent(JSON.stringify({ agentId: r.chat.agentId, message: r.chat.message, title: r.chat.title, profileId: r.chat.profile, model: r.chat.model }))}`);
      setResult(`Started on ${MODEL_LABEL[model]}.${r.pending.length ? ` Fable rebuild added to the pending list (${r.pending.join(', ')}).` : ''} Mosses is in the AI assistant chat; approve his cards as they come.`);
      setStep('done');
    } catch (e) { setErr((e as Error).message); setStep('model'); }
  };
  const missing = s && !s.build ? 'Needs the AI assistant and Mosses (Agent manager → Add-on agents).' : s && !s.containers ? 'Mosses can plan, but can only change files with Container access + Snapshot Manager installed.' : '';
  return (
    <div className={`${P}__dialog fx-stack`}>
      <ol className={`${P}__steps`}>
        {(['Confirm', 'Plan', 'Order', 'Model', 'Build'] as const).map((l, i) => {
          const idx = { confirm: 0, planning: 1, review: 2, model: 3, starting: 4, done: 4 }[step];
          return <li key={l} className={i < idx ? 'is-done' : i === idx ? 'is-now' : ''}>{l}</li>;
        })}
      </ol>
      {missing && <p className={`${P}__clash`}><Icon name="alert" size={14} /> {missing}</p>}
      {step === 'confirm' && (
        <>
          <p>Build <strong>{title}</strong> <span className="fx-mono fx-muted">({featureId})</span> with Mosses? He’ll plan it first; nothing changes until you approve the plan, then each change on its own card.</p>
          <div className={`${P}__row`}><Button tone="primary" icon="rocket" disabled={!s?.build} onClick={() => void doPlan()}>Plan it</Button><Button tone="ghost" onClick={close}>Cancel</Button></div>
        </>
      )}
      {step === 'planning' && <p className="fx-muted">Mosses is working out what has to change…</p>}
      {(step === 'review' || step === 'model') && plan && (
        <>
          <section className="fx-stack">
            <strong>Plan</strong>
            {plan.plan.summary && <p className="fx-small">{plan.plan.summary}</p>}
            <ol className={`${P}__list`}>{plan.plan.steps.map((x, i) => <li key={i}>{x}</li>)}</ol>
            {plan.plan.files.length > 0 && <details><summary className="fx-small">{plan.plan.files.length} files</summary><ul className={`${P}__list fx-mono fx-small`}>{plan.plan.files.map((f) => <li key={f}>{f}</li>)}</ul></details>}
            {plan.plan.prerequisites.length > 0 && <p className="fx-small">Build first: {plan.plan.prerequisites.join(', ')}</p>}
            {plan.plan.risks.length > 0 && <p className="fx-small fx-muted">Risks: {plan.plan.risks.join(' · ')}</p>}
          </section>
          <section className="fx-stack">
            <strong>Build order</strong>
            {!plan.order.target ? <p className="fx-small fx-muted">This feature isn’t a step of the build queue, so the order stays as it is.</p>
              : !plan.order.changed ? <p className="fx-small fx-muted">No change: its prerequisites already come first.</p> : (
                <>
                  <div className={`${P}__order`}>
                    <div><span className="fx-small fx-muted">Before</span><ol>{plan.order.before.slice(Math.max(0, plan.order.before.indexOf(plan.order.target) - 3), plan.order.before.indexOf(plan.order.target) + 4).map((id) => <li key={id} className={id === plan.order.target ? 'is-target' : plan.order.moved.includes(id) ? 'is-moved' : ''}>{plan.order.titles[id] ?? id}</li>)}</ol></div>
                    <div><span className="fx-small fx-muted">After</span><ol>{plan.order.after.slice(Math.max(0, plan.order.after.indexOf(plan.order.target) - 3 - plan.order.moved.length), plan.order.after.indexOf(plan.order.target) + 4).map((id) => <li key={id} className={id === plan.order.target ? 'is-target' : plan.order.moved.includes(id) ? 'is-moved' : ''}>{plan.order.titles[id] ?? id}</li>)}</ol></div>
                  </div>
                  <label className={`${P}__opt`}><input type="checkbox" checked={useOrder} onChange={(e) => setUseOrder(e.target.checked)} /> Apply the new order (moves {plan.order.moved.length} prerequisite step{plan.order.moved.length === 1 ? '' : 's'} ahead)</label>
                </>
              )}
          </section>
          {step === 'review' && <div className={`${P}__row`}><Button tone="primary" icon="check" onClick={() => setStep('model')}>Approve plan and order</Button><Button tone="ghost" icon="refresh" onClick={() => void doPlan()}>Plan again</Button><Button tone="ghost" onClick={close}>Cancel</Button></div>}
          {step === 'model' && (
            <section className="fx-stack">
              <strong>Which model?</strong>
              <p className="fx-small">Mosses recommends <strong>{MODEL_LABEL[plan.model.recommend]}</strong>{plan.model.reason ? `: ${plan.model.reason}` : ''}</p>
              {(['opus', 'fable', 'sonnet'] as const).map((m) => (
                <label key={m} className={`${P}__opt`}><input type="radio" name="fa-model" checked={model === m} onChange={() => setModel(m)} />
                  {m === 'opus' ? 'Opus now' : m === 'fable' ? 'Fable (park it until Fable is available)' : 'Sonnet (only for simple changes)'}{m === plan.model.recommend ? ' · recommended' : ''}
                </label>
              ))}
              {model !== 'fable' && <label className={`${P}__opt`}><input type="checkbox" checked={fableLater} onChange={(e) => setFableLater(e.target.checked)} /> …and Fable later (adds the Fable rebuild to the pending list; it starts by running this version’s uninstall script)</label>}
              <div className={`${P}__row`}><Button tone="primary" icon="rocket" onClick={() => void start()}>{model === 'fable' ? 'Park for Fable' : `Build on ${MODEL_LABEL[model]}`}</Button><Button tone="ghost" onClick={() => setStep('review')}>Back</Button></div>
            </section>
          )}
        </>
      )}
      {step === 'starting' && <p className="fx-muted">Starting…</p>}
      {step === 'done' && <><p>{result}</p><div className={`${P}__row`}><Button tone="primary" onClick={close}>Done</Button></div></>}
      {err && <p className={`${P}__bad`}>{err}</p>}
    </div>
  );
}

/* ---------------- settings ---------------- */

export function StatusPanel() {
  const s = useFAStatus();
  const rt = useRuntime();
  const [log, setLog] = useState<{ at: number; op: string; feature?: string; title?: string; model?: string; saved?: string[]; pending?: string[]; status?: string }[]>([]);
  useEffect(() => { void refreshStatus(); void call<{ items: typeof log }>('builds?limit=60').then((r) => setLog(r.items), () => undefined); }, []);
  if (!s) return <p className="fx-muted">Loading…</p>;
  const item = (ok: boolean, label: string, hint: string) => <li><Icon name={ok ? 'check-circle' : 'alert'} size={14} /> <strong>{label}</strong> <span className="fx-small fx-muted">{ok ? 'ready' : hint}</span></li>;
  return (
    <div className="fx-stack">
      <ul className={`${P}__list`}>
        {item(s.assistant, 'AI assistant', 'install it (Settings → Plugins) for models')}
        {item(s.expert, s.expertName ?? 'AXF expert agent', 'install the AXF expert add-on in the agent manager')}
        {item(s.mosses, s.mossesName ?? 'Mosses', 'install the Mosses (coder) add-on in the agent manager')}
        {item(s.containers && s.snapshots, 'Container access + Snapshot Manager', 'needed for Mosses to change files')}
      </ul>
      <p className="fx-small fx-muted">“Describe a feature” shows in the Plan view when the assistant and the AXF expert are ready; “Build with Mosses” is on every unbuilt feature (right-click or long-press, and in its details) when Mosses is ready.</p>
      <div className={`${P}__row`}><Button icon="layers" onClick={() => rt.navigate('plan')}>Open the Plan</Button></div>
      <strong>History</strong>
      <ul className={`${P}__list`}>
        {log.map((e, i) => <li key={i} className="fx-small">{new Date(e.at).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })} · <strong>{e.op}</strong> {e.title ?? e.feature ?? (e.saved ?? []).join(', ')}{e.model ? ` · ${MODEL_LABEL[e.model] ?? e.model}` : ''}{e.status ? ` → ${e.status}` : ''}{e.pending?.length ? ` · pending ${e.pending.join(', ')}` : ''}</li>)}
        {!log.length && <li className="fx-small fx-muted">Nothing yet.</li>}
      </ul>
    </div>
  );
}

export type { Status };
