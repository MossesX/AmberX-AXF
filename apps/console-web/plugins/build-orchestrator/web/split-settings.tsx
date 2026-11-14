import { useEffect, useState } from 'react';
import { Button, Note, SelectField, Switch, TextField, useRuntime } from '@console/axf/react';

/*
 * Split section (Brett, Nov 13 2026: "orchestrator settings needs a collapsible section for split, with all the
 * splitting options, and one option splits it so it runs multiple parallel builds simultaneously to speed it up").
 * One collapsible block, shown on the orchestrator's Rules tab and as a panel of Settings → Plugins → Build orchestrator.
 * Every value is a pipeline-settings@1 setting (GET / POST pipeline/settings; MCP pipeline-settings / pipeline-settings-set;
 * `pipeline.mjs settings | set k=v`), saved as soon as it changes; the deep link is build-orchestrator.split-settings.
 *   splitProvider       how a build is cut into steps: claude | rules | off
 *   parallelSplit       auto | ask | off: a request that falls into independent parts becomes sub-builds that run at the
 *                       same time in separate slots (auto queues them, ask leaves them in Pending, off never proposes)
 *   parallelMax         most parts (slots) one request is split into, 2-12, default 4
 *   parallelContract    the lead runs a shared contract / interface step first so the parts don't clash
 *   parallelIntegrate   the lead runs an integration step last: merges the parts and tests them together
 */
export type SplitSettingsValues = { splitProvider: string; parallelSplit: string; parallelMax: number; parallelContract: boolean; parallelIntegrate: boolean };
type Res = { ok: boolean; error?: string; settings: SplitSettingsValues };
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

export function SplitSettings({ api, open }: { api: Api; open?: boolean }) {
  const rt = useRuntime();
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
          <SelectField label="How a build is split" value={s.splitProvider} options={PROVIDERS} disabled={busy} hint="Every build is split as soon as it is filed. The largest step size is a token rule (Save rules above)." onChange={(v) => save({ splitProvider: v }, `Split: ${v}`)} />
          <h3 className="pd-card__title">Parallel split</h3>
          <p className="fx-small fx-muted">A request that falls into independent parts is cut into sub-builds that run at the same time in separate slots, to speed it up. The lead build keeps the shared contract step first, so the parts don't clash, and the integration step last, which merges and tests them together.</p>
          <SelectField label="Parallel split" value={s.parallelSplit} options={MODES} disabled={busy} onChange={(v) => save({ parallelSplit: v }, `Parallel split: ${v}`)} />
          <div className="oc-split__row">
            <TextField label="Max parallel slots" type="number" value={max} disabled={busy || off} hint={`${PARALLEL_MAX.min} to ${PARALLEL_MAX.max}, default 4: the most parts one request is split into`} error={max && !maxOk ? `${PARALLEL_MAX.min} to ${PARALLEL_MAX.max}` : undefined} onChange={setMax} />
            <Button size="sm" tone="primary" icon="save" disabled={busy || off || !maxOk || maxN === s.parallelMax} onClick={() => save({ parallelMax: maxN }, `Max parallel slots: ${maxN}`)}>Apply slots</Button>
          </div>
          <Switch label="Shared contract step first" text="The lead writes and pushes the names, schemas, routes and interfaces first; the dispatcher starts the parts once that step is done" checked={s.parallelContract} disabled={busy || off} onChange={(on) => save({ parallelContract: on }, `Contract step ${on ? 'on' : 'off'}`)} />
          <Switch label="Integration step last" text="The lead's last step merges every part's branch, runs the tests together and fixes what clashes; the dispatcher holds it until every part is finished" checked={s.parallelIntegrate} disabled={busy || off} onChange={(on) => save({ parallelIntegrate: on }, `Integration step ${on ? 'on' : 'off'}`)} />
          <p className="fx-small fx-muted">Same settings anywhere: <span className="fx-mono">pipeline.mjs set parallelSplit=auto parallelMax=4</span>, REST / MCP <span className="fx-mono">pipeline-settings-set</span>, voice "set parallel split to auto".</p>
        </div>
      )}
    </details>
  );
}
