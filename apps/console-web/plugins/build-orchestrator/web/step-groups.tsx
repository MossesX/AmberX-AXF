import { useEffect, useState } from 'react';
import { Button, Note, Switch, TextField, useRuntime } from '@console/axf/react';
import { pluginApi } from '@console/plugins';
import { FOLDER } from './ui';

/*
 * Step groups (step-groups@1, framework/spec/BUILD-GROUPS.md): one long build over several slots. Brett, Nov 16 2026:
 * "Any build that's over 30 minutes, split the steps up for multiple slots."
 * Settings → Plugins → Build orchestrator → Step groups: the three settings of settings.json (pipeline-settings@1 keys
 * splitOverMin, maxParallelGroups, parallelGroups), read and written through GET / PUT step-groups/settings, the same
 * call as MCP orchestrator-groups-settings(-set), `pipeline.mjs groups settings` and voice groups.setting:<key>:<value>.
 */
export const groupsApi = pluginApi(FOLDER, 'Build orchestrator', { unavailable: 'The build orchestrator is switched off or its server part is not running.' });

export type GroupSettings = { splitOverMin: number; maxParallelGroups: number; parallelGroups: boolean };

/** A whole number with a Save button once it differs (empty while typing). */
function WholeNumber({ label, value, hint, min, max, onSave, anchor }: { label: string; value: number; hint: string; min: number; max: number; onSave: (n: number) => void; anchor: string }) {
  const [v, setV] = useState(String(value));
  useEffect(() => setV(String(value)), [value]);
  const n = Number(v);
  const bad = v === '' || !Number.isInteger(n) || n < min || n > max;
  return (
    <div className="fx-row fx-row--wrap sg-field" data-axf-anchor={anchor}>
      <TextField label={label} value={v} onChange={(x) => setV(x.replace(/[^0-9]/g, ''))} hint={hint} error={v !== '' && bad ? `A whole number from ${min} to ${max}` : undefined} />
      {!bad && n !== value && <Button tone="primary" icon="save" onClick={() => onSave(n)}>Save</Button>}
    </div>
  );
}

export function StepGroupsSettings() {
  const rt = useRuntime();
  const [s, setS] = useState<GroupSettings | null>(null);
  const [err, setErr] = useState('');
  const load = () => groupsApi.call<{ ok: boolean; settings: GroupSettings }>('step-groups/settings').then((r) => { setS(r.settings); setErr(''); }).catch((e: Error) => setErr(e.message));
  useEffect(() => { void load(); }, []);
  const save = (patch: Partial<GroupSettings>, done: string) => groupsApi.put<{ ok: boolean; settings: GroupSettings; error?: string }>('step-groups/settings', patch)
    .then((r) => { if (!r.ok) throw new Error(r.error); setS(r.settings); rt.toast(done, 'success'); }).catch((e: Error) => rt.toast(e.message, 'danger'));
  if (err) return <Note tone="warning">{err}</Note>;
  if (!s) return <Note>Loading the step-group settings…</Note>;
  return (
    <div className="fx-stack" data-axf-target="settings:build-orchestrator/step-groups">
      <Note>A build whose open steps add up to more than the threshold runs as step groups: steps that share no files run at the same time in separate slots, then merge back onto the build branch in order and land as one PR.</Note>
      <div data-axf-anchor="setting:build-orchestrator.parallelGroups">
        <Switch label="Parallel groups" text="Off: every build runs as one sequential session (a build already split runs one group at a time)." checked={s.parallelGroups} onChange={(on) => void save({ parallelGroups: on }, `Parallel groups ${on ? 'on' : 'off'}`)} />
      </div>
      <WholeNumber anchor="setting:build-orchestrator.splitOverMin" label="Split builds over (min)" value={s.splitOverMin} min={0} max={1440} hint="0 = never split. Default 30 (Brett, Nov 16 2026)." onSave={(n) => void save({ splitOverMin: n }, `Builds over ${n} min are split`)} />
      <WholeNumber anchor="setting:build-orchestrator.maxParallelGroups" label="Max parallel groups per build" value={s.maxParallelGroups} min={1} max={12} hint="Each group takes one agent slot, so the agent cap still holds. Default 3." onSave={(n) => void save({ maxParallelGroups: n }, `At most ${n} groups of a build at once`)} />
    </div>
  );
}
