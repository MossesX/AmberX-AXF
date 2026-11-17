import { useEffect, useState, type ReactNode } from 'react';
import { Button, Chip, Note, Switch, TextField, useControlTargets, useRuntime } from '@console/axf/react';
import { DataGrid, type GridColumn } from '@console/axf/libs/datagrid';
import { CONSOLE_CONTROL_KINDS } from '@console/axf/core/engines/console-control-rules.mjs';
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

// ------------------------------------------------------------------ the Groups panel (a split build's expanded card)

/** One group as pipeline.mjs status rows carry it (pipeline-core groupRow). */
export type GroupRow = {
  id: string; state: string; shown: string; label: string; waitingOn: string[]; steps: { done: number; total: number; ids: string[] }; nextModel: string;
  slot: string; account: string; session: string; branch: string; worktree: string; mergeOrder: number; dependsOn: string[]; startedAt: string; endedAt: string; mergedAt: string; note: string;
};

const TONE: Record<string, 'accent' | 'success' | 'warning' | 'danger' | undefined> = { running: 'accent', merging: 'warning', 'ready-to-merge': 'success', merged: 'success', conflict: 'danger', failed: 'danger' };
/** The address a group answers to (console-control@1): `row:<build>/group:<gid>`. */
export const groupAddress = (build: string, gid: string) => `row:${build}/group:${gid}`;
/** Registered with the control registry once the address grammar has the `group` kind (build step s21); the DOM carries it already. */
const GRAMMAR_HAS_GROUP = (CONSOLE_CONTROL_KINDS as readonly string[]).includes('group');

export function GroupsPanel({ build, groups, actions }: { build: string; groups: GroupRow[]; actions?: (g: GroupRow) => ReactNode }) {
  const rt = useRuntime();
  useControlTargets(GRAMMAR_HAS_GROUP ? groups.map((g) => ({
    address: groupAddress(build, g.id), kind: 'row' as const, label: `${build} group ${g.id}`, detail: `Step group · ${g.label}`, keywords: [g.id, g.state, g.account, g.branch].filter(Boolean),
    element: () => document.querySelector(`[data-axf-target="${groupAddress(build, g.id)}"]`), get: () => g,
    open: () => rt.dispatch(`build-orchestrator.focus:${encodeURIComponent(build)}`),
  })) : [], `groups|${build}|${groups.map((g) => `${g.id}:${g.state}`).join(',')}`);
  const cols: GridColumn<GroupRow>[] = [
    { id: 'id', label: 'Group', width: 'calc(var(--fx-font-size) * 4)', render: (g) => <span className="fx-mono fx-small" data-axf-target={groupAddress(build, g.id)}>{g.id}</span> },
    { id: 'state', label: 'State', width: 'calc(var(--fx-font-size) * 8)', render: (g) => <Chip tone={TONE[g.shown]}>{g.label}</Chip> },
    { id: 'steps', label: 'Steps', width: 'calc(var(--fx-font-size) * 4)', align: 'end', render: (g) => <span className="fx-small" title={g.steps.ids.join(', ')}>{g.steps.done}/{g.steps.total}</span> },
    { id: 'merge', label: 'Merge', width: 'calc(var(--fx-font-size) * 4)', align: 'end', render: (g) => <span className="fx-small">#{g.mergeOrder + 1}</span> },
    { id: 'run', label: 'Slot · account', width: 'minmax(calc(var(--fx-font-size) * 8), 1fr)', render: (g) => <span className="fx-small" title={g.session}>{g.account ? `${g.slot || 'queued'} · ${g.account}` : <span className="fx-muted">—</span>}</span> },
    { id: 'branch', label: 'Branch', width: 'minmax(calc(var(--fx-font-size) * 10), 1.4fr)', render: (g) => <span className="fx-mono fx-small fx-muted">{g.branch || '—'}</span> },
    { id: 'waits', label: 'Waiting on', width: 'calc(var(--fx-font-size) * 6)', render: (g) => <span className="fx-small">{g.waitingOn.join(', ') || <span className="fx-muted">—</span>}</span> },
    ...(actions ? [{ id: 'act', label: '', width: 'minmax(calc(var(--fx-font-size) * 10), auto)', render: (g: GroupRow) => <div className="fx-row fx-row--wrap">{actions(g)}</div> }] : []),
  ];
  const merged = groups.filter((g) => g.state === 'merged').length;
  const notes = groups.filter((g) => g.note && (g.state === 'conflict' || g.state === 'failed'));
  return (
    <section className="fx-stack" aria-label={`${build} step groups`}>
      <DataGrid<GroupRow> id={`build-orchestrator.groups.${build}`} label={`${build} step groups`}
        groups={[{ id: `${build}-groups`, title: `${groups.length} step groups · ${merged} merged`, rows: groups, groups: [], fixed: true }]}
        columns={cols} rowId={(g) => g.id} rowLabel={(g) => `group ${g.id}`} hidden={[]} />
      {notes.map((g) => <Note key={g.id} tone="danger">{g.id}: {g.note}</Note>)}
    </section>
  );
}
