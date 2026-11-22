import { useEffect, useState } from 'react';
import { Button, Note, SelectField, Switch, TextField, useRuntime } from '@console/axf/react';
import * as core from './orchestrator-core.mjs';

/*
 * Split section (Brett, Nov 13 2026: "orchestrator settings needs a collapsible section for split, with all the
 * splitting options, and one option splits it so it runs multiple parallel builds simultaneously to speed it up").
 * One collapsible block, a panel of Settings → Plugins → Build orchestrator (Pipeline 2.0 moved the old Rules tab there).
 * Every value is a pipeline-settings@1 setting (GET / POST pipeline/settings; MCP pipeline-settings / pipeline-settings-set;
 * `pipeline.mjs settings | set k=v`), saved as soon as it changes; the deep link is build-orchestrator.split-settings.
 *   splitProvider       how a build is cut into steps: claude | rules | off
 *   parallelSplit       auto | ask | off: a request that falls into independent parts becomes sub-builds that run at the
 *                       same time in separate slots (auto queues them, ask leaves them in Pending, off never proposes)
 *   parallelMax         most parts (slots) one request is split into, 2-12, default 4
 *   parallelContract    the lead runs a shared contract / interface step first so the parts don't clash
 *   parallelIntegrate   the lead runs an integration step last: merges the parts and tests them together
 * Every other split option sits here too (s3): the largest step (orchestrator rules, maxStepMinutes: POST act
 * {action:'rules'}; `orchestrator.mjs act rules`), which model a step gets, phases, and the one-step-per-line format
 * a build's steps are written in by hand.
 */
export type SplitSettingsValues = { splitProvider: string; parallelSplit: string; parallelMax: number; parallelContract: boolean; parallelIntegrate: boolean };
type Res = { ok: boolean; error?: string; settings: SplitSettingsValues };
type StepRules = { sameSession: boolean; subAgents: boolean; approveModelSwitch: boolean; maxStepMinutes: number };
type Api = { call: <T>(path: string) => Promise<T>; post: <T>(path: string, body: unknown) => Promise<T> };
/** The element id the deep link (build-orchestrator.split-settings) scrolls to and opens. */
export const SPLIT_SECTION_ID = 'orch-split-settings';
export const PARALLEL_MAX = { min: 2, max: 12 };

const PROVIDERS = [
  { value: 'claude', label: 'Claude: a one-shot call cuts it into steps of 10 min or less (Fable only where needed)' },
  { value: 'rules', label: 'Rules: no model, one step per line of the request (review the steps)' },
  { value: 'off', label: 'Off: steps are written by hand' },
];
const MODES = [
  { value: 'auto', label: 'Auto: the parts are filed and queued by themselves' },
  { value: 'ask', label: 'Ask: the parts wait in Pending until you queue them' },
  { value: 'off', label: 'Off: one build, one session' },
];

/**
 * `rules` + `saveRules` can come from a parent that already holds the rules; without them, as
 * in Settings → Plugins, the section reads the rules from GET state and saves them through POST act.
 */
export function SplitSettings({ api, open, rules, saveRules }: { api: Api; open?: boolean; rules?: StepRules; saveRules?: (r: StepRules) => Promise<boolean> }) {
  const rt = useRuntime();
  const [ownRules, setOwnRules] = useState<StepRules | null>(null);
  const r = rules ?? ownRules;
  const [step, setStep] = useState('');
  useEffect(() => { if (r) setStep(String(core.maxStep(r))); }, [r?.maxStepMinutes]);
  useEffect(() => {
    if (rules) return;
    void api.call<{ ok: boolean; state?: { rules: StepRules } }>('state').then((x) => { if (x.ok && x.state) setOwnRules(x.state.rules); }).catch(() => {});
  }, [!!rules]);
  const putRules = async (next: StepRules, what: string) => {
    if (saveRules) { if (await saveRules(next)) rt.toast(what, 'success'); return; }
    try { const x = await api.post<{ ok: boolean; error?: string; state?: { rules: StepRules } }>('act', { action: 'rules', rules: next }); if (!x.ok) throw new Error(x.error); if (x.state) setOwnRules(x.state.rules); rt.toast(what, 'success'); }
    catch (e) { rt.toast((e as Error).message, 'danger'); }
  };
  const stepN = Number(step);
  const stepOk = Number.isInteger(stepN) && stepN >= 1 && stepN <= core.STEP_MINUTES;
  const [s, setS] = useState<SplitSettingsValues | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [max, setMax] = useState('');
  const load = async () => {
    try { const r = await api.call<Res>('pipeline/settings'); if (!r.ok) throw new Error(r.error); setS(r.settings); setMax(String(r.settings.parallelMax)); setError(''); }
    catch (e) { setError((e as Error).message); }
  };
  useEffect(() => { void load(); }, []);
  const save = async (patch: Partial<SplitSettingsValues>, what: string) => {
    setBusy(true);
    try { const r = await api.post<Res>('pipeline/settings', patch); if (!r.ok) throw new Error(r.error); setS(r.settings); setMax(String(r.settings.parallelMax)); rt.toast(what, 'success'); }
    catch (e) { rt.toast((e as Error).message, 'danger'); }
    finally { setBusy(false); }
  };
  const maxN = Number(max);
  const maxOk = Number.isInteger(maxN) && maxN >= PARALLEL_MAX.min && maxN <= PARALLEL_MAX.max;
  const off = !s || s.parallelSplit === 'off';
  return (
    <details className="pd-add oc-split" id={SPLIT_SECTION_ID} open={open} data-help="split-section">
      <summary>Split <span className="fx-muted fx-small">· how a build is cut into steps, and when it is cut into parallel builds</span></summary>
      {error && <Note tone="warning">{error}</Note>}
      {!s ? <p className="fx-small fx-muted">Loading the split settings…</p> : (
        <div className="fx-stack">
          <SelectField label="How a build is split" value={s.splitProvider} options={PROVIDERS} disabled={busy} hint="Every build is split as soon as it is filed." onChange={(v) => save({ splitProvider: v }, `Split: ${v}`)} />
          <div className="oc-split__row">
            <TextField label="Largest step (minutes)" type="number" value={step} disabled={!r} hint={`1 to ${core.STEP_MINUTES}: a longer step is cut in two; every step is a checkpoint (commit, push, tick) inside one session`} error={step && !stepOk ? `1 to ${core.STEP_MINUTES}` : undefined} onChange={setStep} />
            <Button size="sm" tone="primary" icon="save" disabled={!r || !stepOk || stepN === core.maxStep(r)} onClick={() => r && putRules({ ...r, maxStepMinutes: stepN }, `Largest step: ${stepN} min`)}>Apply step size</Button>
          </div>
          <h3 className="pd-card__title">Model per step and phases</h3>
          {core.MODELS.map((m) => <p key={m} className="fx-small"><span className={`oc-model is-${m.toLowerCase()}`}>{m}</span> {(core.MODEL_GUIDE as Record<string, string>)[m]}</p>)}
          <p className="fx-small fx-muted">Steps in a row on the same model form a phase: one session runs one phase and stops. A switch to Fable is an upgrade, a switch to Opus a downgrade (it goes on by itself).</p>
          <h3 className="pd-card__title">Writing steps by hand</h3>
          <p className="fx-small fx-muted">One step per line: <span className="fx-mono">Fable: design the contract (10 min)</span> or <span className="fx-mono">Opus: wire the route (10 min)</span> (no prefix = Opus). A <span className="fx-mono"># Phase name</span> line starts a phase, a <span className="fx-mono">## Group name</span> line groups the steps below it. Same format in Add a build, <span className="fx-mono">orchestrator.mjs act add</span> and the API.</p>
          <h3 className="pd-card__title">Parallel split</h3>
          <p className="fx-small fx-muted">A request that falls into independent parts is cut into sub-builds that run at the same time in separate slots, to speed it up. The lead build keeps the shared contract step first, so the parts don't clash, and the integration step last, which merges and tests them together.</p>
          <SelectField label="Parallel split" value={s.parallelSplit} options={MODES} disabled={busy} onChange={(v) => save({ parallelSplit: v }, `Parallel split: ${v}`)} />
          <div className="oc-split__row">
            <TextField label="Max parallel slots" type="number" value={max} disabled={busy || off} hint={`${PARALLEL_MAX.min} to ${PARALLEL_MAX.max}, default 4: the most parts one request is split into`} error={max && !maxOk ? `${PARALLEL_MAX.min} to ${PARALLEL_MAX.max}` : undefined} onChange={setMax} />
            <Button size="sm" tone="primary" icon="save" disabled={busy || off || !maxOk || maxN === s.parallelMax} onClick={() => save({ parallelMax: maxN }, `Max parallel slots: ${maxN}`)}>Apply slots</Button>
          </div>
          <Switch label="Shared contract step first" text="The lead writes and pushes the names, schemas, routes and interfaces first; the dispatcher starts the parts once that step is done" checked={s.parallelContract} disabled={busy || off} onChange={(on) => save({ parallelContract: on }, `Contract step ${on ? 'on' : 'off'}`)} />
          <Switch label="Integration step last" text="The lead's last step merges every part's branch, runs the tests together and fixes what clashes; the dispatcher holds it until every part is finished" checked={s.parallelIntegrate} disabled={busy || off} onChange={(on) => save({ parallelIntegrate: on }, `Integration step ${on ? 'on' : 'off'}`)} />
          <p className="fx-small fx-muted">Per build: “Parallel builds” when you add one, <span className="fx-mono">pipeline.mjs parallel &lt;id&gt; 3</span> (or <span className="fx-mono">off</span>, <span className="fx-mono">default</span>), or “split into 3 parallel” in the request itself. A build's own ask beats these settings: asked for N parts, it is cut into N even when Parallel split is off (the parts then wait in Pending).</p>
          <p className="fx-small fx-muted">Same settings anywhere: <span className="fx-mono">pipeline.mjs set parallelSplit=auto parallelMax=4</span>, REST / MCP <span className="fx-mono">pipeline-settings-set</span>, voice "set parallel split to auto".</p>
        </div>
      )}
    </details>
  );
}
