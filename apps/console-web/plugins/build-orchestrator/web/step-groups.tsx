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

/**
 * The panel's three views, offered in UI Review as ui-choices@1 options (layout assets in assets/layout/): grid = every
 * column; compact = group, state, steps, merge order and actions (phones); cards = one card per group in merge order.
 * The pick is kept per browser until Brett chooses one for good.
 */
export const GROUP_VIEWS = ['grid', 'compact', 'cards'] as const;
export type GroupView = typeof GROUP_VIEWS[number];
const VIEW_KEY = 'axf.build-orchestrator.groupsView';
export const groupView = (): GroupView => { try { const v = localStorage.getItem(VIEW_KEY) as GroupView | null; return v && GROUP_VIEWS.includes(v) ? v : 'grid'; } catch { return 'grid'; } };

function GroupCard({ build, g, actions }: { build: string; g: GroupRow; actions?: (g: GroupRow) => ReactNode }) {
  return (
    <article className="pd-card sg-card" data-axf-target={groupAddress(build, g.id)} aria-label={`group ${g.id}`}>
      <div className="pd-card__top">
        <h3 className="pd-card__title">{g.id}<span className="fx-muted fx-small"> · merge #{g.mergeOrder + 1}</span></h3>
        <Chip tone={TONE[g.shown]}>{g.label}</Chip>
      </div>
      <div className="pd-meta">
        <span title={g.steps.ids.join(', ')}>{g.steps.done}/{g.steps.total} steps</span>
        {g.account && <span>{g.slot || 'queued'} · {g.account}</span>}
        {g.branch && <span className="fx-mono fx-muted">{g.branch}</span>}
      </div>
      {actions && <div className="fx-row fx-row--wrap">{actions(g)}</div>}
    </article>
  );
}

export function GroupsPanel({ build, groups, actions, view = groupView() }: { build: string; groups: GroupRow[]; actions?: (g: GroupRow) => ReactNode; view?: GroupView }) {
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
      {view === 'cards'
        ? <><p className="fx-small fx-muted">{groups.length} step groups · {merged} merged</p><div className="fx-stack">{groups.map((g) => <GroupCard key={g.id} build={build} g={g} actions={actions} />)}</div></>
        : <DataGrid<GroupRow> id={`build-orchestrator.groups.${build}`} label={`${build} step groups`}
          groups={[{ id: `${build}-groups`, title: `${groups.length} step groups · ${merged} merged`, rows: groups, groups: [], fixed: true }]}
          columns={cols} rowId={(g) => g.id} rowLabel={(g) => `group ${g.id}`} hidden={view === 'compact' ? ['run', 'branch', 'waits'] : []} />}
      {notes.map((g) => <Note key={g.id} tone="danger">{g.id}: {g.note}</Note>)}
    </section>
  );
}

// ------------------------------------------------------------------ group actions (the same calls as REST, MCP, CLI and voice)

/** POST step-groups/<build>/<group>/<action> (or step-groups/<build>/<action> for plan / ungroup), with a toast. */
export function useGroupActions(after?: () => void) {
  const rt = useRuntime();
  const [busy, setBusy] = useState('');
  const call = (path: string, body: Record<string, unknown>, done: string) => {
    setBusy(path);
    return groupsApi.post<{ ok: boolean; error?: string }>(`step-groups/${path}`, body)
      .then((r) => { if (!r.ok) throw new Error(r.error); rt.toast(done, 'success'); after?.(); })
      .catch((e: Error) => rt.toast(e.message, 'danger')).finally(() => setBusy(''));
  };
  return { busy, call };
}

/** The buttons of one group row: what its state allows. Merge now and Ungroup ask first. */
export function GroupButtons({ build, g, count, busy, call }: { build: string; g: GroupRow; count: number; busy: string; call: (path: string, body: Record<string, unknown>, done: string) => Promise<void> }) {
  const at = `${encodeURIComponent(build)}/${g.id}`;
  const off = !!busy;
  const open = g.steps.done < g.steps.total;
  const fixed = g.state === 'merged' || g.state === 'merging';
  return (
    <>
      {(g.state === 'planned' || g.state === 'ready') && !g.waitingOn.length && open && <Button size="sm" tone="primary" icon="play" disabled={off} title="Start this group's next session now instead of on the next tick" onClick={() => void call(`${at}/start`, {}, `${build} ${g.id} started`)}>Start now</Button>}
      {g.state === 'failed' && open && <Button size="sm" icon="refresh" disabled={off} title="Back in the queue with its crash count cleared" onClick={() => void call(`${at}/rerun`, {}, `${build} ${g.id} back in the queue`)}>Re-run</Button>}
      {g.state === 'ready-to-merge' && <Button size="sm" tone="success" icon="check-circle" disabled={off} confirm={`Merge ${g.id} onto the build branch now, out of its turn?`} title="Merge it onto the build branch now" onClick={() => void call(`${at}/merge`, {}, `${build} ${g.id} merged`)}>Merge now</Button>}
      {g.state === 'conflict' && !g.session && <Button size="sm" tone="danger" icon="zap" disabled={off} title="A session merges the build branch into this group's branch, resolves it and the next tick merges again" onClick={() => void call(`${at}/fix`, {}, `Fix with Claude started on ${build} ${g.id}`)}>Fix with Claude</Button>}
      {!fixed && count > 1 && <Button size="sm" tone="quiet" icon="chevron-up" disabled={off || g.mergeOrder === 0} title="Merge earlier" onClick={() => void call(`${at}/reorder`, { to: 'up' }, `${g.id} moved up`)}>Up</Button>}
      {!fixed && count > 1 && <Button size="sm" tone="quiet" icon="chevron-down" disabled={off || g.mergeOrder === count - 1} title="Merge later" onClick={() => void call(`${at}/reorder`, { to: 'down' }, `${g.id} moved down`)}>Down</Button>}
    </>
  );
}

/** The Groups panel with its actions, and Ungroup for the whole build. */
export function GroupsWithActions({ build, groups, reload }: { build: string; groups: GroupRow[]; reload?: () => void }) {
  const { busy, call } = useGroupActions(reload);
  const canUngroup = groups.every((g) => g.state === 'planned' || g.state === 'ready' || g.state === 'failed');
  return (
    <div className="fx-stack">
      <GroupsPanel build={build} groups={groups} actions={(g) => <GroupButtons build={build} g={g} count={groups.length} busy={busy} call={call} />} />
      <div className="fx-row fx-row--wrap">
        <Button size="sm" icon="layers" disabled={!!busy || !canUngroup} title="Work the groups out again from the steps' files" onClick={() => void call(`${encodeURIComponent(build)}/plan`, {}, `${build}: groups planned again`)}>Plan again</Button>
        <Button size="sm" tone="danger" icon="list" disabled={!!busy || !canUngroup} confirm={`Run ${build} as one sequential session? Its step groups are removed.`} title={canUngroup ? 'Run it as one sequential session' : 'A group has run or merged: its work lives on its own branch'} onClick={() => void call(`${encodeURIComponent(build)}/ungroup`, {}, `${build} runs as one sequential session`)}>Ungroup (run sequential)</Button>
      </div>
    </div>
  );
}
