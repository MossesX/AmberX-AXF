import { useEffect, useState } from 'react';
import { Button, Note, SelectField, Switch, TextField, useRuntime } from '@console/axf/react';
import type { SplitApi } from './split-settings';

/*
 * Parallel split, inside the Split section (Brett, Nov 13 2026: "one option splits it so it runs multiple parallel
 * builds simultaneously to speed it up"). The orchestrator cuts a request into independent part builds that run at the
 * same time in their own slots; a shared contract step runs first so the parts don't clash, and an integration step at
 * the end merges and tests them together.
 *
 * Every value is a pipeline-settings@1 setting, saved as soon as it changes (POST pipeline/settings; MCP
 * pipeline-settings-set; `pipeline.mjs set k=v`):
 *   parallelSplit      auto | ask | off   auto: parts are queued at once; ask: parts wait in Pending; off: one build
 *   parallelMax        2..12 (default 4)  the most part builds one request is split into
 *   parallelContract   true | false       a shared contract / interface step runs first; the parts wait for it
 *   parallelIntegrate  true | false       an integration step at the end merges every part and tests them together
 * One build's own ask (filed with "split into N parallel", or `pipeline.mjs parallel <id> N|off|default`) beats these.
 */
export type ParallelSplitValues = { parallelSplit: 'auto' | 'ask' | 'off'; parallelMax: number; parallelContract: boolean; parallelIntegrate: boolean };
type Res = { ok: boolean; error?: string; settings: ParallelSplitValues & Record<string, unknown> };

export const PARALLEL_MODES = [
  { value: 'ask', label: 'Ask: split into parallel parts, the parts wait in Pending for you to queue them' },
  { value: 'auto', label: 'Auto: split into parallel parts and queue them at once' },
  { value: 'off', label: 'Off: every request stays one build' },
];
export const PARALLEL_MAX_RANGE = { min: 2, max: 12 } as const;

export function ParallelSplitFields({ api }: { api: SplitApi }) {
  const rt = useRuntime();
  const [s, setS] = useState<ParallelSplitValues | null>(null);
  const [max, setMax] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    api.call<Res>('pipeline/settings')
      .then((r) => { if (!live) return; if (!r.ok) throw new Error(r.error || 'could not read the parallel split settings'); setS(r.settings); setMax(String(r.settings.parallelMax)); })
      .catch((e: Error) => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [api]);
  const save = async (patch: Partial<ParallelSplitValues>, what: string) => {
    setBusy(true);
    try {
      const r = await api.post<Res>('pipeline/settings', patch);
      if (!r.ok) throw new Error(r.error || 'not saved');
      setS(r.settings); setMax(String(r.settings.parallelMax)); rt.toast(what, 'success');
    } catch (e) { rt.toast((e as Error).message, 'danger'); }
    finally { setBusy(false); }
  };
  if (error) return <Note tone="warning">{error}</Note>;
  if (!s) return null;
  const n = Number(max);
  const badMax = max === '' || !Number.isInteger(n) || n < PARALLEL_MAX_RANGE.min || n > PARALLEL_MAX_RANGE.max;
  const off = s.parallelSplit === 'off';
  return (
    <fieldset className="oc-split__parallel fx-stack" data-help="parallel-split">
      <legend>Parallel split <span className="fx-muted fx-small">· run independent parts as builds at the same time</span></legend>
      <SelectField label="Parallel split" value={s.parallelSplit} options={PARALLEL_MODES} disabled={busy}
        hint="When a request falls into independent parts that touch different files, each part becomes its own build in its own slot."
        onChange={(v) => void save({ parallelSplit: v as ParallelSplitValues['parallelSplit'] }, `Parallel split: ${v}`)} />
      <div className="oc-split__row">
        <TextField label="Max parallel parts" type="number" value={max} onChange={setMax} disabled={busy || off}
          hint="The most part builds one request is split into (default 4)." error={badMax ? `${PARALLEL_MAX_RANGE.min}–${PARALLEL_MAX_RANGE.max}` : undefined} />
        <Button size="sm" disabled={busy || off || badMax || n === s.parallelMax} onClick={() => void save({ parallelMax: n }, `Parallel split: up to ${n} parts`)}>Save</Button>
      </div>
      <Switch label="Shared contract step first" checked={s.parallelContract} disabled={busy || off}
        hint="One step writes the shared names, schemas and routes before the parts start, so they don't clash."
        onChange={(v) => void save({ parallelContract: v }, `Contract step first: ${v ? 'on' : 'off'}`)} />
      <Switch label="Integration step last" checked={s.parallelIntegrate} disabled={busy || off}
        hint="After every part is done, one step merges them, tests them together and opens the PR."
        onChange={(v) => void save({ parallelIntegrate: v }, `Integration step last: ${v ? 'on' : 'off'}`)} />
      <p className="fx-small fx-muted">One build: file it with <span className="fx-mono">--parallel N|off</span>, say “split into N parallel”, or <span className="fx-mono">pipeline.mjs parallel &lt;id&gt; N</span>.</p>
    </fieldset>
  );
}
