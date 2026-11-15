import { useEffect, useState } from 'react';
import { Button, Checkbox, Chip, Icon, Note, PriorityTag, SelectField, TextField, useRuntime } from '@console/axf/react';
import { DataGrid, type GridColumn, type GridGroup } from '@console/axf/libs/datagrid';

/*
 * Custom groups and custom tabs (Brett, Nov 13 2026: "I want to be able to add some custom groups to my board, sorted by
 * state from partials to done, running; mostly for pending; custom pending tabs, custom groups"). One view of GET groups
 * (groups.mjs, build-groups@1, saved per project). The Groups tab is the board: every group with its builds sorted by
 * state and the count per state, the Pending builds in no group underneath to drag in, the group editor (name, colour,
 * tab, sort, filter, smart rule) and the group actions (queue all, land all, archive all, priority). A group pinned as a
 * tab shows up next to its stage tab (GroupTab): a custom Pending tab is the usual one.
 */

export type GroupState = 'partial' | 'pending' | 'queued' | 'running' | 'failed' | 'done' | 'landed';
const STATES: GroupState[] = ['partial', 'pending', 'queued', 'running', 'failed', 'done', 'landed'];
const STATE_OF_TAB: Record<string, GroupState> = { incomplete: 'partial', pending: 'pending', queue: 'queued', active: 'running', errors: 'failed', complete: 'done', archive: 'landed' };
const STATE_TONE: Record<GroupState, 'accent' | 'success' | 'warning' | 'danger' | undefined> = { partial: 'warning', pending: undefined, queued: 'accent', running: 'accent', failed: 'danger', done: 'success', landed: 'success' };
const COLORS = ['neutral', 'accent', 'info', 'success', 'warning', 'danger'] as const;
const STAGES: { value: string; label: string }[] = [
  { value: '', label: 'No tab (board only)' }, { value: 'pending', label: 'Tab next to Pending' }, { value: 'queue', label: 'Tab next to Queue' },
  { value: 'active', label: 'Tab next to Active' }, { value: 'incomplete', label: 'Tab next to Incomplete' }, { value: 'complete', label: 'Tab next to Complete' },
  { value: 'errors', label: 'Tab next to Errors' }, { value: 'archive', label: 'Tab next to Archive' }, { value: 'all', label: 'Tab with every stage' },
];
const SORTS = [{ value: 'state', label: 'By state: partial → done' }, { value: 'priority', label: 'By priority' }, { value: 'updated', label: 'Newest first' }, { value: 'title', label: 'By title' }];

export type GroupRow = { id: string; title: string; status: string; tab: string; priority: string; createdAt: string; updatedAt: string; steps: { done: number; total: number }; pr: string; held?: boolean; behind?: number };
type Rule = { titleContains?: string; behindMoreThan?: number; filedWithinDays?: number; states?: GroupState[]; priorities?: string[] } | null;
export type GroupView = { id: string; name: string; color: typeof COLORS[number]; builds: string[]; rule: Rule; tab: string; sort: string; filter: GroupState[]; smart: boolean; counts: Record<GroupState, number>; total: number; auto: string[]; rows: GroupRow[]; tabRows: GroupRow[] };
type Api = { call: <T>(path: string) => Promise<T>; post: <T>(path: string, body: unknown) => Promise<T> };
type Log = (t: string, l?: 'info' | 'ok' | 'warn' | 'error') => void;
type ActionResult = { ok: boolean; error?: string; done?: string[]; refused?: { id: string; error: string }[]; skipped?: { id: string }[] };
export const stateOf = (r: { tab: string }): GroupState | '' => STATE_OF_TAB[r.tab] ?? '';
const sep = '|';

/** The count per state as chips: "2 partial · 3 pending · 1 running". */
export function StateCounts({ counts }: { counts: Record<GroupState, number> }) {
  const on = STATES.filter((s) => counts[s]);
  if (!on.length) return <span className="fx-small fx-muted">empty</span>;
  return <span className="og-counts">{on.map((s) => <Chip key={s} tone={STATE_TONE[s]}>{counts[s]} {s}</Chip>)}</span>;
}

/** Loads GET groups and keeps it fresh while on screen. */
export function useGroups(api: Api) {
  const [groups, setGroups] = useState<GroupView[] | null>(null);
  const [pending, setPending] = useState<GroupRow[]>([]);
  const [error, setError] = useState('');
  const load = async () => {
    try {
      const r = await api.call<{ ok: boolean; error?: string; groups: GroupView[]; loose?: GroupRow[] }>('groups'); if (!r.ok) throw new Error(r.error);
      setGroups(r.groups); setPending(r.loose ?? []); setError('');
    } catch (e) { setError((e as Error).message); setGroups((g) => g ?? []); }
  };
  useEffect(() => {
    void load();
    const t = window.setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 15_000);
    return () => window.clearInterval(t);
  }, []);
  return { groups, pending, error, load };
}

const columns = (opts: { sel?: Set<string>; toggle?: (k: string, on: boolean) => void }): GridColumn<GroupRow & { key: string }>[] => [
  ...(opts.sel && opts.toggle ? [{ id: 'sel', label: '', width: 'calc(var(--fx-font-size) * 2.5)', fixed: true,
    render: (r: GroupRow & { key: string }) => <span onClick={(e) => e.stopPropagation()}><Checkbox label="" title={`Select ${r.title}`} checked={opts.sel!.has(r.key)} onChange={(on) => opts.toggle!(r.key, on)} /></span> }] : []),
  { id: 'title', label: 'Build', width: 'minmax(calc(var(--fx-font-size) * 14), 4fr)', fixed: true, sortable: true, sortValue: (r) => r.title.toLowerCase(),
    render: (r) => <span className="pl-row-title" title={r.id}><strong>{r.title}</strong> <span className="fx-small fx-muted fx-mono">{r.id}</span></span> },
  { id: 'state', label: 'State', width: 'calc(var(--fx-font-size) * 6)', sortable: true, sortValue: (r) => STATES.indexOf(stateOf(r) as GroupState),
    render: (r) => { const s = stateOf(r); return s ? <Chip tone={STATE_TONE[s]}>{r.held ? 'on hold' : s}</Chip> : null; } },
  { id: 'priority', label: 'Priority', width: 'calc(var(--fx-font-size) * 8)', render: (r) => <PriorityTag build={r.id} /> },
  { id: 'steps', label: 'Steps', width: 'calc(var(--fx-font-size) * 4)', align: 'end', render: (r) => <span className="fx-small">{r.steps.done}/{r.steps.total}</span> },
  { id: 'behind', label: 'Behind', width: 'calc(var(--fx-font-size) * 4)', align: 'end', render: (r) => <span className="fx-small fx-muted">{r.behind ?? '—'}</span> },
];

/** The Groups tab: the board, the group editor and the group actions. */
export function GroupsBoard({ api, log }: { api: Api; log: Log }) {
  const rt = useRuntime();
  const { groups, pending, error, load } = useGroups(api);
  const [busy, setBusy] = useState('');
  const [name, setName] = useState('');
  const [edit, setEdit] = useState('');
  const [sel, setSel] = useState<Set<string>>(() => new Set());
  const [target, setTarget] = useState('');
  const post = async <T extends { ok: boolean; error?: string }>(path: string, body: unknown, what: string, key = path): Promise<T | null> => {
    setBusy(key);
    try { const r = await api.post<T>(path, body); if (!r.ok) throw new Error(r.error); log(what, 'ok'); rt.toast(what, 'success'); await load(); return r; }
    catch (e) { log((e as Error).message, 'error'); rt.toast((e as Error).message, 'danger'); return null; }
    finally { setBusy(''); }
  };
  const change = (op: Record<string, unknown>, what: string) => post<{ ok: boolean; error?: string; group?: GroupView }>('groups', op, what, 'groups');
  if (!groups) return <div className="fx-empty">{error ? `Groups: ${error}` : 'Loading the groups…'}</div>;
  const loose = pending;
  const keyed = (gid: string, rows: GroupRow[]) => rows.map((r) => ({ ...r, key: `${gid}${sep}${r.id}` }));
  const gridGroups: GridGroup<GroupRow & { key: string }>[] = [
    ...groups.map((g) => ({ id: g.id, title: `${g.name}${g.smart ? ' (smart)' : ''}`, icon: g.smart ? 'zap' : 'folder', rows: keyed(g.id, g.rows), groups: [],
      counts: <span className={`og-dot is-${g.color}`}><StateCounts counts={g.counts} /></span>, ctx: { target: 'axf-orchestrator-group', payload: g.id } })),
    { id: '_loose', title: 'Pending, in no group', icon: 'clock', rows: keyed('_loose', loose), groups: [], fixed: true, counts: <span className="fx-small fx-muted">{loose.length} · drag into a group</span> },
  ];
  const toggle = (k: string, on: boolean) => setSel((cur) => { const n = new Set(cur); if (on) n.add(k); else n.delete(k); return n; });
  const chosen = [...sel].map((k) => k.split(sep) as [string, string]);
  const builds = [...new Set(chosen.map(([, id]) => id))];
  const onMove = (item: { kind: 'row' | 'group'; id: string }, to: { kind: 'row' | 'group'; id: string }) => {
    if (item.kind === 'group') { // drag a group over another: it takes that group's place
      const at = groups.findIndex((g) => g.id === (to.kind === 'group' ? to.id : to.id.split(sep)[0]));
      if (at >= 0 && item.id !== '_loose') void change({ op: 'move', group: item.id, to: at }, `${item.id}: moved`);
      return;
    }
    const [from, id] = item.id.split(sep) as [string, string];
    const dest = to.kind === 'group' ? to.id : (to.id.split(sep)[0] ?? '');
    if (!dest || dest === from) return;
    if (dest === '_loose') { if (from !== '_loose') void change({ op: 'assign', groups: [from], builds: [id], mode: 'remove' }, `${id}: out of ${from}`); return; }
    void change({ op: 'assign', groups: [dest], builds: [id], mode: 'add' }, `${id} → ${dest}`);
  };
  const g = groups.find((x) => x.id === edit) ?? null;
  return (
    <div className="fx-stack fx-stack--lg">
      {error && <Note tone="warning">{error}</Note>}
      <div className="og-bar" role="toolbar" aria-label="Groups: new group">
        <TextField label="New group" value={name} onChange={setName} placeholder="Console app, UI, Urgent…" />
        <Button tone="primary" icon="plus" disabled={!name.trim() || busy === 'groups'} onClick={() => void change({ op: 'create', name: name.trim(), tab: 'pending' }, `Group "${name.trim()}" made, with its own Pending tab`).then((r) => { if (r) { setName(''); setEdit(r.group?.id ?? ''); } })}>Add group</Button>
        <SelectField label="Edit group" value={edit} empty="Choose a group…" options={groups.map((x) => ({ value: x.id, label: x.name }))} onChange={setEdit} />
      </div>
      {builds.length > 0 && (
        <div className="pl-bulk" role="toolbar" aria-label="Groups: selected builds">
          <span className="fx-small">{builds.length} selected</span>
          <SelectField label="Group" value={target} empty="Choose a group…" options={groups.map((x) => ({ value: x.id, label: x.name }))} onChange={setTarget} />
          <Button size="sm" tone="primary" icon="plus" disabled={!target || busy === 'groups'} onClick={() => void change({ op: 'assign', groups: [target], builds, mode: 'add' }, `${builds.length} build(s) → ${target}`).then((r) => r && setSel(new Set()))}>Add to group</Button>
          <Button size="sm" tone="neutral" icon="minus" disabled={busy === 'groups' || !chosen.some(([gid]) => gid !== '_loose')} onClick={() => void Promise.all(chosen.filter(([gid]) => gid !== '_loose').map(([gid, id]) => api.post('groups', { op: 'assign', groups: [gid], builds: [id], mode: 'remove' }))).then(() => { setSel(new Set()); rt.toast('Taken out of their groups', 'success'); void load(); })}>Take out of its group</Button>
          <Button size="sm" tone="neutral" icon="x" onClick={() => setSel(new Set())}>Clear</Button>
        </div>
      )}
      {g && <GroupEditor key={g.id} g={g} index={groups.indexOf(g)} count={groups.length} busy={busy} change={change} act={(action, extra) => post<ActionResult>(`groups/${encodeURIComponent(g.id)}/action`, { action, ...extra }, `${g.name}: ${action} asked for`, 'action')} onDeleted={() => setEdit('')} />}
      {groups.length === 0 && <Note tone="info">No groups yet. Add one above (Console app, UI, Urgent…), then drag Pending builds into it or pick them and tap Add to group. A group can be its own tab next to Pending.</Note>}
      <DataGrid<GroupRow & { key: string }> id="build-orchestrator.groups" label="Groups" groups={gridGroups} columns={columns({ sel, toggle })} rowId={(r) => r.key} rowLabel={(r) => r.title} hidden={[]}
        onMove={onMove} rowTone={(r) => (stateOf(r) === 'running' ? 'accent' : stateOf(r) === 'failed' ? 'danger' : 'muted')} rowRef={(r) => ({ kind: 'build', id: r.id })}
        empty={<p className="fx-muted">No builds yet.</p>} />
    </div>
  );
}

function GroupEditor({ g, index, count, busy, change, act, onDeleted }: { g: GroupView; index: number; count: number; busy: string; change: (op: Record<string, unknown>, what: string) => Promise<unknown>; act: (action: string, extra?: Record<string, unknown>) => Promise<ActionResult | null>; onDeleted: () => void }) {
  const [name, setName] = useState(g.name);
  const [title, setTitle] = useState(g.rule?.titleContains ?? '');
  const [behind, setBehind] = useState(g.rule?.behindMoreThan != null ? String(g.rule.behindMoreThan) : '');
  const [days, setDays] = useState(g.rule?.filedWithinDays != null ? String(g.rule.filedWithinDays) : '');
  const [prio, setPrio] = useState('');
  const upd = (patch: Record<string, unknown>, what: string) => change({ op: 'update', group: g.id, ...patch }, `${g.name}: ${what}`);
  const saving = busy === 'groups';
  const ruleNow = { titleContains: title.trim() || undefined, behindMoreThan: behind.trim() ? Number(behind) : undefined, filedWithinDays: days.trim() ? Number(days) : undefined, states: g.rule?.states, priorities: g.rule?.priorities };
  const report = (r: ActionResult | null) => r; // the toast and the log carry it
  return (
    <article className="pd-card og-editor" aria-label={`Group ${g.name}`}>
      <div className="pd-card__top">
        <h3 className="pd-card__title"><span className={`og-dot is-${g.color}`} aria-hidden="true" />{g.name}<span className="fx-muted fx-small"> · {g.total} build(s){g.smart ? ` · ${g.auto.length} by its rule` : ''}</span></h3>
        <StateCounts counts={g.counts} />
      </div>
      <div className="og-bar" role="toolbar" aria-label={`${g.name}: settings`}>
        <TextField label="Name" value={name} onChange={setName} />
        <Button size="sm" tone="neutral" icon="check" disabled={saving || !name.trim() || name.trim() === g.name} onClick={() => void upd({ name: name.trim() }, `renamed to ${name.trim()}`)}>Rename</Button>
        <SelectField label="Colour" value={g.color} options={COLORS.map((c) => ({ value: c, label: c[0]!.toUpperCase() + c.slice(1) }))} onChange={(v) => void upd({ color: v }, `colour ${v}`)} disabled={saving} />
        <SelectField label="Tab" value={g.tab} options={STAGES} onChange={(v) => void upd({ tab: v || 'none' }, v ? `tab next to ${v}` : 'no tab')} disabled={saving} />
        <SelectField label="Sort" value={g.sort} options={SORTS} onChange={(v) => void upd({ sort: v }, `sorted ${v}`)} disabled={saving} />
        <Button size="sm" tone="neutral" icon="chevron-up" disabled={saving || index === 0} onClick={() => void change({ op: 'move', group: g.id, to: 'up' }, `${g.name}: up`)}>Up</Button>
        <Button size="sm" tone="neutral" icon="chevron-down" disabled={saving || index >= count - 1} onClick={() => void change({ op: 'move', group: g.id, to: 'down' }, `${g.name}: down`)}>Down</Button>
        <Button size="sm" tone="danger" icon="trash" disabled={saving} title="Delete the group: its builds stay where they are" onClick={() => void change({ op: 'delete', group: g.id }, `${g.name}: deleted (its builds stay)`).then(onDeleted)}>Delete group</Button>
      </div>
      <div className="og-bar" role="toolbar" aria-label={`${g.name}: show states`}>
        <span className="fx-small">Show</span>
        {STATES.map((s) => <Checkbox key={s} label={s} checked={!g.filter.length || g.filter.includes(s)} disabled={saving}
          onChange={(on) => { const cur = g.filter.length ? g.filter : STATES; const next = on ? [...cur, s] : cur.filter((x) => x !== s); void upd({ filter: next.length === STATES.length ? [] : next }, `shows ${next.length === STATES.length ? 'every state' : next.join(', ')}`); }} />)}
      </div>
      <div className="og-bar" role="toolbar" aria-label={`${g.name}: smart rule`}>
        <TextField label="Title contains" value={title} onChange={setTitle} placeholder="console app" />
        <TextField label="More than N behind main" type="number" value={behind} onChange={setBehind} placeholder="500" />
        <TextField label="Filed in the last N days (0 = today)" type="number" value={days} onChange={setDays} placeholder="0" />
        <Button size="sm" tone="neutral" icon="zap" disabled={saving} onClick={() => void upd({ rule: ruleNow }, 'rule saved')}>Save rule</Button>
        {g.rule && <Button size="sm" tone="neutral" icon="x" disabled={saving} onClick={() => { setTitle(''); setBehind(''); setDays(''); void upd({ rule: null }, 'rule cleared'); }}>Clear rule</Button>}
      </div>
      <div className="og-bar" role="toolbar" aria-label={`${g.name}: group actions`}>
        <Button size="sm" tone="primary" icon="arrow-right" disabled={busy === 'action' || !g.counts.pending} title="Every Pending build of the group → the Queue" onClick={() => void act('queue').then(report)}>Queue all ({g.counts.pending})</Button>
        <Button size="sm" tone="neutral" icon="check-circle" disabled={busy === 'action' || !g.counts.done} title="Every Done build of the group goes first in the merge queue (tagged Urgent)" onClick={() => void act('land').then(report)}>Land all ({g.counts.done})</Button>
        <Button size="sm" tone="neutral" icon="package" disabled={busy === 'action' || !g.total} title="Every build of the group without a live session → the Archive" onClick={() => void act('archive').then(report)}>Archive all</Button>
        <SelectField label="Priority" value={prio} empty="Change priority…" options={[{ value: 'P0', label: 'Urgent' }, { value: 'P1', label: 'High' }, { value: 'P2', label: 'Normal' }, { value: 'P3', label: 'Low' }]} onChange={setPrio} />
        <Button size="sm" tone="neutral" icon="star" disabled={busy === 'action' || !prio || !g.total} onClick={() => void act('priority', { priority: prio }).then(report)}>Set for all</Button>
      </div>
    </article>
  );
}

/** A group pinned as a tab: its builds in that stage (or every stage), sorted the group's way, with its counts. */
export function GroupTab({ api, log, group }: { api: Api; log: Log; group: string }) {
  const { groups, error } = useGroups(api);
  void log;
  if (!groups) return <div className="fx-empty">{error ? `Groups: ${error}` : 'Loading the group…'}</div>;
  const g = groups.find((x) => x.id === group);
  if (!g) return <Note tone="warning">The group "{group}" is gone: open the Groups tab to pin another one.</Note>;
  const rows = g.tabRows.map((r) => ({ ...r, key: r.id }));
  return (
    <section className="fx-stack" aria-label={g.name}>
      <h2 className="pd-card__title"><span className={`og-dot is-${g.color}`} aria-hidden="true" />{g.name} <span className="oc-count">{rows.length}</span>
        <span className="fx-muted fx-small"> · {g.tab === 'all' ? 'every stage' : `its ${g.tab} builds`} · the whole group: </span><StateCounts counts={g.counts} /></h2>
      {rows.length === 0 ? <div className="fx-empty"><Icon name="folder" size={14} /> Nothing of {g.name} in {g.tab === 'all' ? 'any stage' : g.tab}.</div>
        : <DataGrid<GroupRow & { key: string }> id={`build-orchestrator.group.${g.id}`} label={g.name} groups={[{ id: g.id, title: `${rows.length} build(s)`, rows, groups: [], fixed: true }]} columns={columns({})} rowId={(r) => r.key} rowLabel={(r) => r.title} hidden={[]} rowRef={(r) => ({ kind: 'build', id: r.id })} />}
    </section>
  );
}
