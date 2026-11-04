import { useEffect, useMemo, useState } from 'react';
import { Button, Checkbox, Icon, Segmented, SelectField, Slider, Switch, TextField, useRuntime } from '@console/axf/react';
import { pluginApi } from '@console/plugins';
import * as O from './optimizer-core.mjs';
import * as P from './packager-core.mjs';
import { reloadEverywhere } from './step-drag';

/*
 * Optimize builds (build-optimize@1, Brett Nov 4 2026). The button (Build manager and orchestrator toolbars, right-click
 * on the build lists, voice/MCP build-orchestrator optimize) opens this dialog: pick the mode (Deep with AI when it's
 * connected, else Basic), the scope (filters) and a preset, make the plan, then see the new package of builds, each
 * with all of its steps in order and where each came from. Rename builds, drag steps between them (or into a new one),
 * untick steps to leave them where they are, read why (Deep mode's reasoning per build and step), then Apply (one
 * transaction, one undo) or Cancel. All the rules are in optimizer-core.mjs; every edit here goes back through it.
 */

const api = pluginApi('build-orchestrator', 'Build orchestrator', { unavailable: 'The build orchestrator is switched off or its server part is not running.' });
type Config = { settings: O.Settings; filter: O.Filter; presets: Record<string, { label: string; settings?: Partial<O.Settings>; filter?: Partial<O.Filter> }>; last: { at: string; mode: string; fellBack: boolean; why: string; line: string } | null };
type Run = { id: string; kind: string; at: string; by: string; mode: string; created: string[]; emptied: string[]; sources: string[]; undone: string };
type State = { ok: boolean; role: string; config: Config; runs: Run[]; ai: { ok: boolean; why: string } };
type PlanRes = { ok: boolean; plan: O.Plan; items: O.Item[]; facets: Record<string, { value: string; n: number }[]>; ai: { ok: boolean; why: string }; notified: boolean; estimate?: number; budget?: number };
type ApplyRes = { created: string[]; emptied: string[]; run: { id: string }; log: string[] };

export const NOTIFY_LABEL: Record<string, string> = { 'no-ai': 'Only when AI isn\'t available', every: 'Every run', off: 'Off' };
const MODE_LABEL: Record<string, string> = { auto: 'Auto', deep: 'Deep (AI)', basic: 'Basic' };
const FILTER_KEYS: { key: keyof O.Filter; label: string; facet: string }[] = [
  { key: 'profiles', label: 'Build profile', facet: 'profiles' }, { key: 'categories', label: 'Category', facet: 'categories' }, { key: 'models', label: 'Model', facet: 'models' },
  { key: 'thinking', label: 'Thinking', facet: 'thinking' }, { key: 'statuses', label: 'Status', facet: 'statuses' }, { key: 'agents', label: 'Agent', facet: 'agents' },
  { key: 'areas', label: 'Area', facet: 'areas' }, { key: 'tags', label: 'Tags', facet: 'tags' },
];
const ago = (iso: string) => { const m = Math.round((Date.now() - Date.parse(iso)) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };

export function OptimizerDialog({ close, preset: preset0, mode: mode0, filter: filter0 }: { close: () => void; preset?: string; mode?: string; filter?: Partial<O.Filter> }) {
  const rt = useRuntime();
  const [st, setSt] = useState<State | null>(null);
  const [error, setError] = useState('');
  const [mode, setMode] = useState<O.Mode>((O.MODES.includes(mode0 as O.Mode) ? mode0 : '') as O.Mode || 'auto');
  const [preset, setPreset] = useState(preset0 ?? '');
  const [filter, setFilter] = useState<O.Filter>({ ...O.DEFAULT_FILTER, ...(filter0 ?? {}) });
  const [showFilters, setShowFilters] = useState(false);
  const [busy, setBusy] = useState('');
  const [estimate, setEstimate] = useState<{ tokens: number; budget: number } | null>(null);
  const [res, setRes] = useState<PlanRes | null>(null);
  const [plan, setPlan] = useState<O.Plan | null>(null);
  const [applied, setApplied] = useState<ApplyRes | null>(null);
  const [drag, setDrag] = useState<string[]>([]);
  const [sel, setSel] = useState<string[]>([]);
  const [why, setWhy] = useState<Record<string, boolean>>({});

  const load = async () => { try { const r = await api.call<State>('optimize/state'); setSt(r); setError(''); if (!filter0 && r.config?.filter) setFilter((f) => ({ ...r.config.filter, ...f, ...Object.fromEntries(Object.entries(f).filter(([, v]) => (Array.isArray(v) ? v.length : !!v))) })); return r; } catch (e) { setError((e as Error).message); return null; } };
  useEffect(() => { void load(); }, []);
  useEffect(() => { try { localStorage.setItem('axp-build-optimizer:seen', new Date().toISOString()); rt.setBadge('build.optimizer.notice', 0); } catch { /* private window */ } }, []);

  const items = res?.items ?? [];
  const byKey = useMemo(() => new Map(items.map((c) => [c.key, c])), [items]);
  const deep = mode === 'deep' || (mode === 'auto' && !!st?.ai.ok);

  if (error) return <div className="pl-note is-warn"><Icon name="alert" size={14} />{error}</div>;
  if (!st) return <div className="fx-empty">Reading the optimizer settings…</div>;
  if (st.role !== 'primary') return <div className="fx-empty">Optimizing builds is the primary session's job (Brett's sessions own the orchestrator).</div>;

  const run = async (go = false) => {
    setBusy('plan'); setApplied(null);
    try {
      const body = { mode, preset: preset || undefined, filter };
      if (deep && !go) { // Deep shows its token cost before it runs
        const e = await api.post<PlanRes>('optimize/plan', { ...body, estimateOnly: true });
        if (e.estimate) { setEstimate({ tokens: e.estimate, budget: e.budget ?? 0 }); return; }
      }
      setEstimate(null);
      const r = await api.post<PlanRes>('optimize/plan', body);
      setRes(r); setPlan(r.plan); setSel([]);
      rt.terminal.log('orchestrator', `optimizer: ${O.notice(r.plan, { fellBack: r.plan.run?.fellBack, why: r.plan.run?.why })}`, r.plan.run?.fellBack ? 'warn' : 'ok');
    } catch (e) { rt.toast((e as Error).message, 'danger'); }
    finally { setBusy(''); }
  };
  const apply = async () => {
    if (!plan) return;
    setBusy('apply');
    try {
      const req = O.applyRequest(plan);
      const r = await api.post<ApplyRes>('optimize/apply', { ...req, confirmed: true, filter: plan.filter, settings: plan.settings });
      setApplied(r); setPlan(null); setRes(null); reloadEverywhere(); void load();
      rt.toast(r.log[r.log.length - 1] ?? 'Applied', 'success');
    } catch (e) { rt.toast((e as Error).message, 'danger'); }
    finally { setBusy(''); }
  };
  const undo = async (id?: string) => {
    setBusy('undo');
    try { const r = await api.post<{ log: string[] }>('optimize/undo', id ? { run: id } : {}); rt.toast(r.log.join('; '), 'success'); setApplied(null); reloadEverywhere(); void load(); }
    catch (e) { rt.toast((e as Error).message, 'danger'); }
    finally { setBusy(''); }
  };
  const setNotify = async (v: string) => { try { await api.post('optimize/settings', { settings: { notify: v } }); void load(); } catch (e) { rt.toast((e as Error).message, 'danger'); } };
  const edit = (p: O.Plan) => setPlan(p); // every edit already went back through optimizer-core finish()
  const dropOn = (to: string, index: number | null) => { const ks = drag.length ? drag : []; if (!plan || !ks.length) return; setPlan(O.moveKeys(plan, ks, to, index, { items, settings: plan.settings })); setDrag([]); setSel([]); };
  const flt = (k: keyof O.Filter, v: string) => setFilter((f) => { const cur = f[k] as string[]; return { ...f, [k]: cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v] }; });
  const facets = res?.facets ?? {};
  const undoable = st.runs.filter((r) => !r.undone);
  const last = st.config.last;

  return (
    <div className="fx-stack oc-opt">
      <div className="oc-opt__head">
        <Segmented label="Mode" value={mode} onChange={(v) => { setMode(v); setEstimate(null); }} options={O.MODES.map((m) => ({ value: m, label: MODE_LABEL[m]!, icon: m === 'basic' ? 'cpu' : 'zap' }))} />
        <SelectField label="Preset" value={preset} empty="Saved settings" options={Object.entries(st.config.presets).map(([id, p]) => ({ value: id, label: p.label || id }))} onChange={setPreset} />
        <SelectField label="Optimizer notifications" value={st.config.settings.notify} options={O.NOTIFY.map((n) => ({ value: n, label: NOTIFY_LABEL[n]! }))} onChange={(v) => void setNotify(v)} />
      </div>
      <p className="fx-small fx-muted">
        {deep ? <><Icon name="zap" size={12} /> Deep mode reads every waiting build's brief and steps, checks the code they touch and the merged PRs, then repacks. </> : <><Icon name="cpu" size={12} /> Basic mode: plain code, no AI, zero tokens. </>}
        {!st.ai.ok && mode !== 'basic' && <span>AI isn't available ({st.ai.why}), so Basic runs. </span>}
        {last && <span>Last run {ago(last.at)}: {last.mode === 'deep' ? 'Deep' : last.fellBack ? 'Basic (AI wasn\'t available)' : 'Basic'} · {last.line}.</span>}
      </p>

      <div className="oc-bar" role="toolbar" aria-label="Optimizer scope">
        <Button size="sm" icon="sliders" aria-pressed={showFilters} onClick={() => setShowFilters(!showFilters)}>Filters{Object.values(filter).some((v) => (Array.isArray(v) ? v.length : v)) ? ' (on)' : ''}</Button>
        <Button size="sm" icon="zap" onClick={() => setFilter((f) => ({ ...f, fableCandidates: !f.fableCandidates }))} aria-pressed={filter.fableCandidates}>Fable candidates</Button>
        <Button size="sm" icon="x" onClick={() => setFilter({ ...O.DEFAULT_FILTER })}>Clear filters</Button>
        <Button tone="primary" size="sm" icon={deep ? 'zap' : 'cpu'} busy={busy === 'plan'} disabled={!!busy} onClick={() => void run()}>{res ? 'Plan again' : 'Make the plan'}</Button>
        {undoable[0] && <Button size="sm" icon="undo" disabled={!!busy} confirm={`Undo ${undoable[0].kind === 'move' ? 'the step move' : 'the optimizer run'} ${undoable[0].id}? The builds it made go and every build it changed comes back.`} onClick={() => void undo(undoable[0]!.id)}>Undo last</Button>}
      </div>
      {showFilters && (
        <div className="oc-opt__filters">
          {FILTER_KEYS.map((f) => (facets[f.facet] ?? []).length > 0 && (
            <div key={f.key} className="oc-opt__frow"><span className="fx-small fx-muted">{f.label}</span>
              {(facets[f.facet] ?? []).slice(0, 24).map((x) => <button key={x.value} type="button" className={`fx-chip ${(filter[f.key] as string[]).includes(x.value) ? 'fx-chip--accent' : ''}`} aria-pressed={(filter[f.key] as string[]).includes(x.value)} onClick={() => flt(f.key, x.value)}>{x.value} · {x.n}</button>)}
            </div>
          ))}
          <TextField label="Search" value={filter.q} onChange={(v) => setFilter((f) => ({ ...f, q: v }))} placeholder="step, build, category" />
          <div className="oc-opt__frow"><Slider label="Older than (days)" value={filter.minAgeDays} min={0} max={60} onChange={(v) => setFilter((f) => ({ ...f, minAgeDays: v }))} /><Slider label="Newer than (days, 0 = any)" value={filter.maxAgeDays} min={0} max={120} onChange={(v) => setFilter((f) => ({ ...f, maxAgeDays: v }))} /></div>
          {(facets.builds ?? []).length > 0 && (
            <details className="oc-opt__builds"><summary className="fx-small">Include / exclude builds ({(facets.builds ?? []).length})</summary>
              {(facets.builds ?? []).map((b) => <Checkbox key={b.value} label={<span className="fx-mono fx-small">{b.value} · {b.n}</span>} checked={!filter.exclude.includes(b.value)} onChange={(on) => setFilter((f) => ({ ...f, exclude: on ? f.exclude.filter((x) => x !== b.value) : [...f.exclude, b.value] }))} />)}
            </details>
          )}
          {!res && <p className="fx-small fx-muted">Make the plan once to see the choices with counts.</p>}
        </div>
      )}

      {estimate && (
        <div className="pl-note oc-opt__confirm">
          <p><Icon name="zap" size={14} /> Deep mode will read ~{estimate.tokens.toLocaleString()} tokens of briefs, steps and code (booked to {st.config.settings.agent}){estimate.budget && estimate.tokens > estimate.budget ? `, over the ${estimate.budget.toLocaleString()}-token budget, so Basic will run instead` : ''}.</p>
          <div className="fx-row fx-row--wrap"><Button tone="primary" icon="zap" busy={busy === 'plan'} onClick={() => void run(true)}>Run Deep</Button><Button icon="cpu" onClick={() => { setMode('basic'); setEstimate(null); }}>Use Basic</Button><Button onClick={() => setEstimate(null)}>Cancel</Button></div>
        </div>
      )}

      {applied && (
        <div className="pl-note is-ok">
          <p><Icon name="check-circle" size={14} /> {applied.log.join(' · ')}</p>
          <div className="fx-row fx-row--wrap"><Button icon="undo" busy={busy === 'undo'} onClick={() => void undo(applied.run.id)}>Undo</Button><Button tone="primary" icon="check" onClick={close}>Done</Button></div>
        </div>
      )}

      {plan && (
        <>
          <div className={`pl-note ${plan.run?.fellBack ? 'is-warn' : 'is-ok'}`}>
            <p><Icon name={plan.mode === 'deep' ? 'zap' : 'cpu'} size={14} /> <b>{O.notice(plan, { fellBack: plan.run?.fellBack, why: plan.run?.why })}</b></p>
            <p className="fx-small">{plan.summary.steps} steps · ~{P.fmtMinutes(plan.summary.minutes) || '?'} of work · saves ~{P.fmtMinutes(plan.summary.saved.minutes) || '0 min'} of build overhead{plan.summary.saved.usd ? ` (~$${plan.summary.saved.usd})` : ''}{plan.summary.emptied.length ? ` · ${plan.summary.emptied.length} emptied build(s) ${plan.settings.safety.emptied === 'delete' ? 'deleted' : 'archived'}` : ''}{plan.inProgress?.length ? ` · ${plan.inProgress.length} running step(s) left alone` : ''}{(plan.stays ?? []).length ? ` · ${(plan.stays ?? []).length} build(s) stay as they are` : ''}</p>
          </div>
          {plan.warnings.length > 0 && <div className="pl-note is-warn"><ul className="fx-small">{plan.warnings.slice(0, 12).map((w) => <li key={w}>{w}</li>)}</ul></div>}
          {(plan.rejected ?? []).length > 0 && <details className="fx-small fx-muted"><summary>{plan.rejected!.length} AI suggestion(s) didn't check out and were left out</summary><ul>{plan.rejected!.map((r) => <li key={r}>{r}</li>)}</ul></details>}
          {plan.packs.length === 0 && <div className="fx-empty">Nothing to combine: every waiting build is already as small as the rules allow.</div>}
          <div className="oc-opt__packs" role="list" aria-label="Proposed builds">
            {plan.packs.map((p) => (
              <section key={p.id} className="oc-opt__pack pd-card" role="listitem" onDragOver={(e) => e.preventDefault()} onDrop={() => dropOn(p.id, null)}>
                <div className="oc-opt__phead">
                  <TextField label={`Build ${p.id.replace('pack-', '')}`} value={p.name} onChange={(v) => edit(O.rename(plan, p.id, v, items))} />
                  <span className="oc-opt__pmeta">
                    <span className={`oc-model is-${p.model.toLowerCase()}`}>{p.model}</span>
                    <span className="oc-flag">{p.thinking}</span><span className="oc-flag">~{P.fmtMinutes(p.minutes) || '?'}</span><span className="oc-flag">{p.category}</span>
                    <span className="oc-flag">{p.keys.length} steps from {p.sources.length} builds</span>
                    {p.after.map((a) => <span key={a.id} className="oc-flag" title={a.why}>after {a.id.replace('pack-', 'build ')}</span>)}
                  </span>
                </div>
                {p.ai?.name && p.ai.name !== p.name && <p className="fx-small"><Icon name="zap" size={12} /> Suggested name: <b>{p.ai.name}</b> <Button size="sm" onClick={() => edit(O.rename(plan, p.id, p.ai!.name, items))}>Use it</Button></p>}
                <p className="fx-small fx-muted">{p.why}</p>
                <ol className="oc-opt__steps">
                  {p.keys.map((k, i) => {
                    const c = byKey.get(k); if (!c) return null;
                    const fl = plan.flags[k]; const rs = plan.reasons?.[k]; const nt = plan.notes?.[k];
                    const on = !plan.unticked.includes(k);
                    return (
                      <li key={k} className={`oc-opt__step ${sel.includes(k) ? 'is-sel' : ''} ${on ? '' : 'is-off'}`} draggable
                        onDragStart={(e) => { e.stopPropagation(); setDrag(sel.includes(k) ? sel : [k]); }} onDragEnd={() => setDrag([])}
                        onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.stopPropagation(); dropOn(p.id, i); }}>
                        <button type="button" className="fx-iconbtn" title="Drag to another build (click to pick several)" aria-pressed={sel.includes(k)} onClick={() => setSel((s) => (s.includes(k) ? s.filter((x) => x !== k) : [...s, k]))}><Icon name="grip" size={13} /></button>
                        <Checkbox title={on ? 'Untick to leave this step where it is' : 'Tick to move this step'} label={<span className="oc-pack__text" title={c.fullText ?? c.text}>{c.text}</span>} checked={on} onChange={(v) => edit(O.tick(plan, k, v, items))} />
                        <span className="oc-pack__meta">
                          <span className={`oc-model is-${c.model.toLowerCase()}`}>{c.model}</span>
                          {c.estimate && <span className="oc-flag">~{c.estimate}</span>}
                          <span className="oc-flag fx-mono" title={c.buildTitle}>from {c.build} {c.step}</span>
                          {fl && <span className="oc-flag oc-opt__flag" title={fl.why}>⚑ {fl.kind === 'built' ? 'already built?' : 'duplicate?'}</span>}
                          {nt?.model && <span className="oc-flag" title={nt.upgrade ? 'An upgrade: only Brett can approve it, in the orchestrator' : ''}>→ {nt.model}{nt.upgrade ? ' (needs your approval)' : ''}</span>}
                          {nt?.split && <span className="oc-flag">split?</span>}
                          {(rs || nt?.why || fl) && <button type="button" className="fx-iconbtn" aria-expanded={!!why[k]} title="Why" onClick={() => setWhy((w) => ({ ...w, [k]: !w[k] }))}><Icon name="info" size={12} /></button>}
                        </span>
                        {why[k] && <p className="fx-small fx-muted oc-opt__why">{[rs?.why, nt?.why, fl?.why].filter(Boolean).join(' · ')}</p>}
                      </li>
                    );
                  })}
                </ol>
              </section>
            ))}
            {plan.packs.length > 0 && <div className="oc-opt__new" onDragOver={(e) => e.preventDefault()} onDrop={() => dropOn('+', null)}><Icon name="plus" size={13} /> Drop steps here for a new build</div>}
          </div>
          {sel.length > 0 && <p className="fx-small">{sel.length} picked: drag any of them to move them together. <Button size="sm" onClick={() => setSel([])}>Clear</Button></p>}
          <div className="fx-row fx-row--wrap oc-opt__foot">
            <Button tone="primary" icon="check" busy={busy === 'apply'} disabled={!!busy || plan.packs.length === 0} onClick={() => void apply()}>Apply: make {plan.packs.length} build{plan.packs.length === 1 ? '' : 's'}</Button>
            <Button onClick={() => { setPlan(null); setRes(null); }}>Cancel</Button>
          </div>
        </>
      )}

      {!plan && undoable.length > 0 && (
        <details className="pd-thread"><summary className="fx-small">Runs you can undo ({undoable.length})</summary>
          {undoable.slice(0, 8).map((r) => <div key={r.id} className="pd-entry"><time dateTime={r.at}>{ago(r.at)}</time><p className="fx-small">{r.kind === 'move' ? 'Step move' : `Optimize (${r.mode || 'basic'})`}: {r.created.length ? `made ${r.created.join(', ')}` : ''}{r.sources.length ? ` · changed ${r.sources.slice(0, 6).join(', ')}${r.sources.length > 6 ? '…' : ''}` : ''}</p><Button size="sm" icon="undo" disabled={!!busy} onClick={() => void undo(r.id)}>Undo</Button></div>)}
        </details>
      )}
    </div>
  );
}

/** The toolbar button (Build manager and orchestrator, slot builds.toolbar). */
export function OptimizeButton() {
  const rt = useRuntime();
  return <Button icon="zap" onClick={() => rt.openDialog('build-orchestrator.optimize')} title="Repack every waiting step into the fewest builds (you confirm the new builds first)">Optimize builds…</Button>;
}

// ---------------------------------------------------------------- settings (Settings → Plugins → Build optimizer)

export function OptimizerSettings() {
  const rt = useRuntime();
  const [cfg, setCfg] = useState<Config | null>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const load = async () => { try { const r = await api.call<State>('optimize/state'); setCfg(r.config); setError(''); } catch (e) { setError((e as Error).message); } };
  useEffect(() => { void load(); }, []);
  if (error) return <div className="pl-note is-warn"><Icon name="alert" size={14} />{error}</div>;
  if (!cfg) return <div className="fx-empty">Reading the optimizer settings…</div>;
  const s = cfg.settings;
  const save = async (patch: Partial<O.Settings> | { rules?: unknown; safety?: unknown }) => { try { const r = await api.post<{ config: Config }>('optimize/settings', { settings: patch }); setCfg(r.config); } catch (e) { rt.toast((e as Error).message, 'danger'); } };
  const preset = async (op: 'save' | 'delete', id: string) => { try { const r = await api.post<{ config: Config }>('optimize/settings', { preset: id, op }); setCfg(r.config); setName(''); rt.toast(op === 'save' ? `Preset "${id}" saved` : `Preset "${id}" deleted`, 'success'); } catch (e) { rt.toast((e as Error).message, 'danger'); } };
  return (
    <div className="fx-stack oc-opt">
      <h3>Mode</h3>
      <Segmented label="Mode" value={s.mode} onChange={(v) => void save({ mode: v })} options={O.MODES.map((m) => ({ value: m, label: m === 'auto' ? 'Auto (Deep when AI is there)' : MODE_LABEL[m]! }))} />
      <div className="oc-pack__filters">
        <SelectField label="Deep mode model" value={s.aiModel} options={P.MODELS.map((m) => ({ value: m, label: m }))} onChange={(v) => void save({ aiModel: v as O.Settings['aiModel'] })} />
        <SelectField label="Deep mode thinking" value={s.aiThinking} options={P.THINKING.map((t) => ({ value: t, label: t }))} onChange={(v) => void save({ aiThinking: v })} />
        <TextField label="Token budget per run (0 = no cap)" value={String(s.tokenBudget)} onChange={(v) => void save({ tokenBudget: Number(v) || 0 })} />
        <TextField label="Book Deep runs to agent" value={s.agent} onChange={(v) => void save({ agent: v })} />
      </div>
      <h3>Packing</h3>
      <Slider label="Max steps per build" value={s.maxSteps} min={1} max={20} onChange={(v) => void save({ maxSteps: v })} />
      <Slider label="Max hours per build" value={Math.round(s.maxMinutes / 60)} min={1} max={16} onChange={(v) => void save({ maxMinutes: v * 60 })} />
      <Slider label="Max builds in the result (0 = no cap)" value={s.maxBuilds} min={0} max={50} onChange={(v) => void save({ maxBuilds: v })} />
      <Segmented label="Aim for" value={s.target} onChange={(v) => void save({ target: v })} options={[{ value: 'fewest', label: 'Fewest builds' }, { value: 'balanced', label: 'Balanced across slots' }, { value: 'fastest', label: 'Fastest finish' }]} />
      {s.target === 'balanced' && <Slider label="Slots (builds running at once)" value={s.slots} min={1} max={10} onChange={(v) => void save({ slots: v })} />}
      <Slider label="Overhead saved per build fewer (min)" value={s.overheadMin} min={0} max={90} onChange={(v) => void save({ overheadMin: v })} />
      <h3>Grouping rules</h3>
      {O.RULES.map((r) => (
        <div key={r} className="oc-opt__frow">
          <Switch label={O.RULE_LABEL[r]} checked={s.rules[r].on} onChange={(on) => void save({ rules: { [r]: { ...s.rules[r], on } } })} />
          {!['modelSplit', 'urgentApart'].includes(r) && s.rules[r].on && <Slider label="Weight" value={s.rules[r].weight} min={0} max={10} onChange={(v) => void save({ rules: { [r]: { ...s.rules[r], weight: v } } })} />}
        </div>
      ))}
      <h3>Safety</h3>
      <Switch label="Never touch running builds' current step" hint="Locked on" checked disabled onChange={() => undefined} />
      <Switch label="Respect pins" hint="Pinned builds are never repacked" checked={s.safety.respectPins} onChange={(v) => void save({ safety: { respectPins: v } })} />
      <Switch label="Pull unstarted steps out of running builds" hint="Off = running builds stay whole" checked={s.safety.pullFromRunning} onChange={(v) => void save({ safety: { pullFromRunning: v } })} />
      <Segmented label="Emptied builds" value={s.safety.emptied} onChange={(v) => void save({ safety: { emptied: v } })} options={[{ value: 'archive', label: 'Archive' }, { value: 'delete', label: 'Delete' }]} />
      <Switch label="Always confirm before applying" hint="Locked on (Deep and Basic)" checked disabled onChange={() => undefined} />
      <TextField label="Pinned builds (ids, comma separated)" value={s.pins.join(', ')} onChange={(v) => void save({ pins: v.split(',').map((x) => x.trim()).filter(Boolean) })} />
      <h3>Drops and naming</h3>
      <Segmented label="Already built / duplicate steps" value={s.drops} onChange={(v) => void save({ drops: v })} options={[{ value: 'flag', label: 'Flag only' }, { value: 'untick', label: 'Untick in the dialog' }]} />
      <TextField label="Name template ({area} {category} {model} {n} {steps} {builds})" value={s.naming} onChange={(v) => void save({ naming: v })} />
      <Segmented label="Category" value={s.categoryRule} onChange={(v) => void save({ categoryRule: v })} options={[{ value: 'common', label: 'Most common' }, { value: 'first', label: 'First step\'s' }, { value: 'fixed', label: 'Fixed' }]} />
      {s.categoryRule === 'fixed' && <TextField label="Fixed category" value={s.fixedCategory} onChange={(v) => void save({ fixedCategory: v })} />}
      <h3>Schedule and notifications</h3>
      <Segmented label="Run" value={s.schedule} onChange={(v) => void save({ schedule: v })} options={[{ value: 'manual', label: 'Manual only' }, { value: 'after-new', label: 'After every new build' }, { value: 'nightly', label: 'Nightly' }]} />
      <p className="fx-small fx-muted">A scheduled run only makes the plan and notifies you; nothing changes until you confirm it.</p>
      <SelectField label="Optimizer notifications" value={s.notify} options={O.NOTIFY.map((n) => ({ value: n, label: NOTIFY_LABEL[n]! }))} onChange={(v) => void save({ notify: v as O.Settings['notify'] })} />
      <h3>Presets</h3>
      <div className="fx-row fx-row--wrap">
        {Object.entries(cfg.presets).map(([id, p]) => <span key={id} className="fx-chip">{p.label || id}{!(id in O.PRESETS) && <button type="button" className="fx-iconbtn" title={`Delete ${id}`} onClick={() => void preset('delete', id)}><Icon name="x" size={11} /></button>}</span>)}
      </div>
      <div className="fx-row fx-row--wrap"><TextField label="Save these settings as" value={name} onChange={setName} placeholder="e.g. Nightly safe" /><Button icon="plus" disabled={!name.trim()} onClick={() => void preset('save', name.trim())}>Save preset</Button></div>
    </div>
  );
}
