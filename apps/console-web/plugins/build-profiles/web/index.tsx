/**
 * Build profiles console plugin (ai.amberx.axf.console.build-profiles).
 *
 * The manager of build profiles. A build profile (build-profiles@1) is one complete set of work data: plan (+ media),
 * build queue, pending builds, catalog status + tracker, and the Build orchestrator's builds. The profiles are framework
 * data, resolved by framework/cli/persist.mjs (dataPath) and managed by framework/cli/profiles.mjs; the console serves
 * them at GET/POST /api/profiles and the plugin's own routes (/api/plugins/build-profiles/). This plugin is the face:
 *
 *   - page `build-profiles`: a grid of every profile (on the list, archived, taken off the list) with its builds, cost
 *     and last activity; search, sort and filter; a row opens to its builds, pending, queue, plan and files
 *   - dialogs: the profile view, Create / Edit / Duplicate, Merge, Move builds, and one confirm for Archive, Take off
 *     the list, Restore and Delete data
 *   - banner chip (framework `status` widget, or a `badge` when the profile has an icon; own asset build-profile) with
 *     the profile in force, in the profile's colour; tap = the quick picker (dialog `build-profiles`)
 *   - right-click: Build profiles… everywhere, Move to profile on a build, a profile's own menu on its row
 *   - app menu (Builds, Plugins), Settings → Plugins → Build profiles
 *   - cleanup helper (cleanup.tsx, dialog `build-profiles-cleanup`): archived builds that really finished, one-tap fix
 *
 * Switching saves the pick for every device and session, then reloads the console so every view reads the new data.
 * Uninstalling removes the manager only; the profiles and their data stay.
 */
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { AxfRuntime } from '@console/axf/core';
import { Button, Checkbox, Chip, Icon, ICON_NAMES, Note, PageToolbar, SelectField, Switch, TabGroup, TextField, usePublishPageState, useRuntime, useToolbarHandlers } from '@console/axf/react';
import type { AxfWebLibrary } from '@console/axf/react/library';
import { getToken, post } from '@console/api';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import './build-profiles.css';
import { appMenu } from './menu';
import { CLEANUP_DIALOG, CleanupNotice, cleanupDialogs, registerCleanup } from './cleanup';
import { EmptyState, LoadingSkeleton } from '@console/emptyState';

const ID = 'ai.amberx.axf.console.build-profiles';
const FOLDER = 'build-profiles';
const VIEW = 'build-profiles';
const DIALOG = 'build-profiles';
const DIALOG_VIEW = 'build-profiles.view';
const DIALOG_EDIT = 'build-profiles.edit';
const DIALOG_MERGE = 'build-profiles.merge';
const DIALOG_MOVE = 'build-profiles.move';
const DIALOG_CONFIRM = 'build-profiles.confirm';
/** Context target of a profile's row (payload = the profile id) and the targets other pages give a build. */
const ROW_TARGET = 'axf-build-profile';
const BUILD_TARGETS = ['axf-build-item', 'axf-orchestrator-build', 'axf-pending-item'];
const ASSET_ID = 'build-profile';
const COUNTER = 'build.profile.known';
const SHOW_KEY = 'build-profiles.show';
const RELOAD_KEY = 'build-profiles.reload';
export const PROFILE_CHANGED = 'axf:profile-changed';

interface Counts { pending: number | null; plan: number | null; queue: number | null; orchestrator: number | null; tracked: number | null }
/** A profile's numbers from the builds store (profiles.mjs profileStats); null when the server has no store. */
interface Stats {
  builds: number; byStatus: Record<string, number>; running: number; pending: number; complete: number; archived: number; attention: number;
  pendingItems: number; queueSteps: number; steps?: { total: number; done: number; left: number };
  cost?: { spentUsd: number; leftUsd: number | null; basis?: string; perStepUsd?: number | null; budgetLeftUsd?: number | null };
  lastActivity?: string; firstCreated?: string;
}
interface Profile {
  id: string; name: string; description?: string; base?: boolean; catalog?: boolean; copiedFrom?: string; createdAt?: string; updatedAt?: string;
  /** the look: a tone name (asset colour token) and an icon name; '' or missing = the default */
  color?: string; icon?: string;
  archived?: boolean; archivedAt?: string;
  /** set on a profile taken off the list (restorable until its data is deleted) */
  removedAt?: string; removedBy?: string; mergedInto?: string;
  counts?: Counts; stats?: Stats | null; files?: Record<string, string>;
}
interface State { ok?: boolean; active: string; effective: string; dataRoot: string; profiles: Profile[]; removed?: Profile[]; error?: string }
/** One build of a profile, as the profile's `get` lists it. */
interface BuildRow { id: string; title?: string; status: string; priority?: string; steps?: number; stepsDone?: number; pct?: number; pr?: number | string | null; lastActivity?: string; costUsd?: number }
interface Detail { loading: boolean; error: string; builds: BuildRow[] | null }

/* ---------------- look: a profile's colour and icon are asset names, never literals ---------------- */

type Tone = 'accent' | 'success' | 'warning' | 'danger' | 'muted';
const TONES: { value: Tone; label: string }[] = [
  { value: 'accent', label: 'Accent' }, { value: 'success', label: 'Green (success)' }, { value: 'warning', label: 'Amber (warning)' },
  { value: 'danger', label: 'Red (danger)' }, { value: 'muted', label: 'Grey (muted)' },
];
const PROFILE_ICONS = ['layers', 'folder', 'box', 'package', 'rocket', 'star', 'zap', 'hammer', 'shield', 'branch', 'code', 'cloud', 'sparkles', 'chart', 'key', 'home'].filter((i) => ICON_NAMES.includes(i));
const toneOf = (p: Profile | null | undefined): Tone | '' => (TONES.some((t) => t.value === p?.color) ? (p!.color as Tone) : '');
const iconOf = (p: Profile | null | undefined): string => (p?.icon && ICON_NAMES.includes(p.icon) ? p.icon : '');

/** The profile's mark: its icon (default layers) in its colour. */
function Mark({ p, size = 14 }: { p: Profile; size?: number }) {
  return <span className="axp-build-profiles__mark" data-tone={toneOf(p) || undefined}><Icon name={iconOf(p) || 'layers'} size={size} /></span>;
}

/* ---------------- store ---------------- */

let st: { data: State | null; error: string } = { data: null, error: '' };
const subs = new Set<() => void>();
const set = (p: Partial<typeof st>) => { st = { ...st, ...p }; subs.forEach((f) => f()); };
const useProfiles = () => useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => st);
let runtime: AxfRuntime | null = null;

export async function loadProfiles(): Promise<void> {
  try {
    const t = getToken();
    const r = await fetch('/api/profiles', { cache: 'no-store', headers: t ? { authorization: `Bearer ${t}` } : {} });
    if (!r.ok) throw new Error(r.status === 401 ? 'Set the console token to see build profiles.' : `The console answered ${r.status}.`);
    set({ data: (await r.json()) as State, error: '' });
  } catch (e) {
    set({ error: (e as Error).message });
  }
  if (runtime) paint(runtime);
}

const current = (): Profile | null => st.data?.profiles.find((p) => p.id === st.data?.effective) ?? null;

const listed = (): Profile[] => st.data?.profiles ?? [];
const removedList = (): Profile[] => st.data?.removed ?? [];
const findProfile = (id: string): Profile | null => listed().find((p) => p.id === id) ?? removedList().find((p) => p.id === id) ?? null;
/** Profiles a build or a pick can go to: on the list and not archived. */
const pickable = (): Profile[] => listed().filter((p) => !p.archived);

/**
 * Repaint the banner chip and attach it, or take it off when hidden. The chip is a framework status widget in the
 * profile's colour; a profile with an icon shows a badge instead (the status widget has no icon), same tap.
 */
function paint(rt: AxfRuntime) {
  const p = current();
  const text = p ? `Profile: ${p.name}` : 'Profile: …';
  const tone = toneOf(p) || (p && !p.base ? 'accent' : 'muted');
  const icon = iconOf(p);
  const about = 'The build profile the console works on (plan, queue, pending builds, tracking). Tap to switch.';
  const base = { $axf: 'asset@1' as const, id: ASSET_ID, name: 'Build profile', version: '0.2.0', author: 'Build profiles plugin', description: about, tags: ['builds', 'status'] };
  rt.registry.register({ ...base, type: 'status', data: { counter: COUNTER, onLabel: text, offLabel: text, onTone: tone, offTone: 'muted', dot: true, link: 'build-profiles.open' } }, 'app', ID);
  rt.registry.register({ ...base, type: 'badge', data: { icon: icon || 'layers', label: text, tone, shape: 'pill', tooltip: about, link: 'build-profiles.open' } }, 'app', ID);
  rt.setBadge(COUNTER, p ? 1 : 0);
  const type = icon ? 'badge' : 'status';
  rt.detachFromBanner(`${icon ? 'status' : 'badge'}:${ASSET_ID}`);
  if (rt.settings.get(SHOW_KEY) !== false) rt.attachToBanner({ type, id: ASSET_ID, at: 'left', order: 20, origin: ID, widget: { label: 'Build profile', size: 'compact', priority: 6, aliases: ['profile'] } });
  else rt.detachFromBanner(`${type}:${ASSET_ID}`);
}

/** One change through POST /api/<api> (framework/cli/profiles.mjs `act`); toasts the outcome. */
async function change(rt: AxfRuntime, body: Record<string, unknown>, done: string, api = 'profiles'): Promise<boolean> {
  const r = await post(api, body);
  if (!r.ok) { rt.toast(String(r.error ?? 'Could not change build profiles.'), 'danger', 'Build profiles'); return false; }
  await loadProfiles();
  rt.toast(done, 'success', 'Build profiles');
  return true;
}

/*
 * Field names. The profiles engine and the plugin's declared commands name three fields differently (engine: color,
 * ids, keep; commands: colour, builds, removeSource). Each side drops what it does not know, so a change carries both
 * spellings and reads the same on either route.
 */
const lookFields = (color: string, icon: string) => ({ color, colour: color, icon });
const buildFields = (ids: string[]) => ({ ids, builds: ids });
const mergeFields = (keepSource: boolean) => ({ keep: keepSource, removeSource: !keepSource });

/** Move builds to profile `to` (`from` set = they leave that profile only). */
async function moveBuilds(rt: AxfRuntime, ids: string[], to: string, from = ''): Promise<boolean> {
  const ok = await change(rt, { action: 'move-builds', to, ...(from ? { from } : {}), ...buildFields(ids) }, `${ids.length === 1 ? ids[0] : `${ids.length} builds`} moved to ${findProfile(to)?.name ?? to}.`);
  if (ok) for (const ev of ['axf:pending-changed', 'axf:plan-changed']) globalThis.dispatchEvent(new CustomEvent(ev, { detail: { id: to } }));
  return ok;
}

/* ---------------- words ---------------- */

const n = (v: number | null | undefined) => (v === null || v === undefined ? '–' : v.toLocaleString());
const money = (v: number | null | undefined) => (v === null || v === undefined ? '–' : `$${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
/** "5 min ago", "3 h ago", "Nov 12"; '' when there is no time. */
function ago(iso: string | undefined, now = Date.now()): string {
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return '';
  const min = Math.round((now - t) / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  if (min < 60 * 24) return `${Math.round(min / 60)} h ago`;
  if (min < 60 * 24 * 14) return `${Math.round(min / 1440)} d ago`;
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(now - t > 300 * 86_400_000 ? { year: 'numeric' as const } : {}) });
}
const stamp = (iso: string | undefined) => { const t = iso ? Date.parse(iso) : NaN; return Number.isFinite(t) ? new Date(t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '–'; };
const activityOf = (p: Profile) => p.stats?.lastActivity || p.updatedAt || p.removedAt || p.createdAt || '';

/** A profile's state chips, in order. */
function StateChips({ p, state }: { p: Profile; state: State }) {
  const inForce = p.id === state.effective;
  return (
    <>
      {p.base && <Chip>base</Chip>}
      {inForce && <Chip tone="accent">in use</Chip>}
      {p.id === state.active && !inForce && <Chip tone="warning">saved pick (this session overrides)</Chip>}
      {p.archived && <Chip>archived</Chip>}
      {p.removedAt && <Chip tone="warning">{p.mergedInto ? `merged into ${p.mergedInto}` : 'off the list'}</Chip>}
      {!!p.stats?.attention && <Chip tone="danger">{p.stats.attention} need attention</Chip>}
    </>
  );
}

/** Make `p` the saved profile, tell every view, and (by default) reload so every page reads its data. */
async function use(rt: AxfRuntime, p: Profile) {
  if (!(await change(rt, { action: 'select', id: p.id }, `Now working on ${p.name}.`))) return;
  for (const ev of [PROFILE_CHANGED, 'axf:pending-changed', 'axf:plan-changed']) globalThis.dispatchEvent(new CustomEvent(ev, { detail: { id: p.id } }));
  if (rt.settings.get(RELOAD_KEY) !== false) setTimeout(() => globalThis.location?.reload(), 700);
}

/* ---------------- picker ---------------- */

function ProfileRow({ p, state }: { p: Profile; state: State }) {
  const rt = useRuntime();
  const [edit, setEdit] = useState(false);
  const [name, setName] = useState(p.name);
  const [desc, setDesc] = useState(p.description ?? '');
  const [confirm, setConfirm] = useState('');
  const inForce = p.id === state.effective;
  const saved = p.id === state.active;
  return (
    <li className={`axp-build-profiles__row ${inForce ? 'is-active' : ''}`}>
      <div className="axp-build-profiles__head">
        <span className="axp-build-profiles__name"><Mark p={p} /> {p.name}</span>
        <StateChips p={p} state={state} />
      </div>
      {p.description && <p className="fx-small fx-muted axp-build-profiles__desc">{p.description}</p>}
      <p className="fx-small axp-build-profiles__counts">
        {n(p.counts?.pending)} pending · {n(p.counts?.orchestrator)} orchestrator builds · {n(p.counts?.queue)} queue steps · {n(p.counts?.plan)} plan entries · {n(p.counts?.tracked)} tracked
      </p>
      {edit ? (
        <div className="fx-stack">
          <TextField label="Name" value={name} onChange={setName} />
          <TextField label="Description" value={desc} onChange={setDesc} rows={2} />
          <Switch label="Plan rebuilds import the framework's seed + feature catalog" checked={!!p.catalog}
            onChange={(on) => void change(rt, { action: 'update', id: p.id, catalog: on }, on ? 'Plan rebuilds import the catalog.' : 'Plan rebuilds keep only this profile\'s own entries.')} />
          <div className="fx-row fx-row--wrap">
            <Button tone="primary" icon="check" onClick={() => void change(rt, { action: 'update', id: p.id, name, description: desc }, 'Saved.').then((ok) => ok && setEdit(false))}>Save</Button>
            <Button tone="ghost" onClick={() => setEdit(false)}>Cancel</Button>
          </div>
          {!p.base && !saved && (
            <div className="fx-stack">
              <TextField label={`Take off the list: type ${p.id}`} value={confirm} onChange={setConfirm} mono hint="Its data stays; create a profile with the same id to get it back." />
              <Button tone="danger" icon="trash" disabled={confirm !== p.id} onClick={() => void change(rt, { action: 'remove', id: p.id, confirm }, `${p.name} taken off the list.`)}>Take off the list</Button>
            </div>
          )}
        </div>
      ) : (
        <div className="fx-row fx-row--wrap">
          <Button tone={inForce ? 'neutral' : 'primary'} icon="check" disabled={saved || !!p.archived} onClick={() => void use(rt, p)}>{saved ? 'Saved pick' : 'Use this one'}</Button>
          <Button tone="ghost" icon="edit" onClick={() => setEdit(true)}>Edit</Button>
        </div>
      )}
    </li>
  );
}

function NewProfile({ state }: { state: State }) {
  const rt = useRuntime();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [from, setFrom] = useState('');
  const [select, setSelect] = useState(true);
  if (!open) return <Button tone="neutral" icon="plus" onClick={() => setOpen(true)}>New profile</Button>;
  const create = async () => {
    const ok = await change(rt, { action: 'create', name, description: desc, ...(from ? { copyFrom: from } : {}), select: false }, `${name} created.`);
    if (!ok) return;
    setOpen(false); setName(''); setDesc('');
    const made = st.data?.profiles.find((p) => p.name === name.trim());
    if (select && made) await use(rt, made);
  };
  return (
    <div className="fx-stack axp-build-profiles__new">
      <TextField label="Name" value={name} onChange={setName} placeholder="e.g. Refactor" autoFocus />
      <TextField label="Description" value={desc} onChange={setDesc} rows={2} />
      <div className="fx-field">
        <span className="fx-field__label">Start with</span>
        <div className="fx-row fx-row--wrap">
          <Button tone={from === '' ? 'primary' : 'ghost'} onClick={() => setFrom('')}>Empty</Button>
          {state.profiles.filter((p) => !p.archived).map((p) => <Button key={p.id} tone={from === p.id ? 'primary' : 'ghost'} onClick={() => setFrom(p.id)}>Copy of {p.name}</Button>)}
        </div>
      </div>
      <Switch label="Use it right away" checked={select} onChange={setSelect} />
      <div className="fx-row fx-row--wrap">
        <Button tone="primary" icon="plus" disabled={!name.trim()} onClick={() => void create()}>Create</Button>
        <Button tone="ghost" onClick={() => setOpen(false)}>Cancel</Button>
      </div>
    </div>
  );
}

function Picker() {
  const rt = useRuntime();
  const s = useProfiles();
  useEffect(() => { void loadProfiles(); }, []);
  if (!s.data) return <div className="axp-build-profiles">{s.error ? <Note tone="warning">{s.error}</Note> : <LoadingSkeleton />}</div>;
  return (
    <div className="fx-stack axp-build-profiles">
      <p className="fx-small fx-muted" style={{ margin: 0 }}>
        Each profile has its own plan, build queue, pending builds, tracking and orchestrator builds. The pick is saved for every device and session.
      </p>
      {s.error && <Note tone="warning">{s.error}</Note>}
      <ul className="axp-build-profiles__list">{s.data.profiles.filter((p) => !p.archived || p.id === s.data!.effective).map((p) => <ProfileRow key={p.id} p={p} state={s.data!} />)}</ul>
      <NewProfile state={s.data} />
      <CleanupNotice />
      <div className="fx-row fx-row--wrap"><Button tone="ghost" icon="grid" onClick={() => rt.dispatch('build-profiles.manage')}>Manage profiles</Button></div>
    </div>
  );
}

function SettingsPanel() {
  const rt = useRuntime();
  const [show, setShow] = useState(rt.settings.get(SHOW_KEY) !== false);
  const [reload, setReload] = useState(rt.settings.get(RELOAD_KEY) !== false);
  const s = useProfiles();
  const p = current();
  const flip = useCallback((key: string, on: boolean, setter: (v: boolean) => void) => { rt.settings.set(key, on); setter(on); paint(rt); }, [rt]);
  return (
    <div className="fx-stack">
      <p style={{ margin: 0 }}>In use: <strong>{p?.name ?? '…'}</strong>{s.data && <span className="fx-muted"> · data in {s.data.dataRoot}</span>}</p>
      <div className="fx-row fx-row--wrap"><Button tone="primary" icon="grid" onClick={() => rt.dispatch('build-profiles.manage')}>Manage profiles</Button><Button tone="neutral" icon="layers" onClick={() => rt.openDialog(DIALOG)}>Switch profile</Button><Button tone="neutral" icon="sparkles" onClick={() => rt.openDialog(CLEANUP_DIALOG)}>Clean up builds</Button></div>
      <Switch label="Show the profile on the banner" checked={show} onChange={(on) => flip(SHOW_KEY, on, setShow)} />
      <Switch label="Reload the console after switching" hint="Every page then reads the new profile's data." checked={reload} onChange={(on) => flip(RELOAD_KEY, on, setReload)} />
      <p className="fx-small fx-muted" style={{ margin: 0 }}>
        CLI: <span className="fx-mono">node framework/cli/profiles.mjs [select &lt;id&gt; | create "&lt;name&gt;" | where]</span>. A session can work on another profile without changing the pick: <span className="fx-mono">AXF_BUILD_PROFILE=&lt;id&gt;</span>.
      </p>
    </div>
  );
}

/* ---------------- a profile's contents: builds, pending, queue, plan, files ---------------- */

async function getJson<T>(path: string): Promise<T> {
  const t = getToken();
  const r = await fetch(path, { cache: 'no-store', headers: t ? { authorization: `Bearer ${t}` } : {} });
  if (!r.ok) throw new Error(r.status === 401 ? 'Set the console token to see this.' : `The console answered ${r.status}.`);
  return (await r.json()) as T;
}

/** One profile's builds (the plugin's `get` command). `builds: null` = the server gave the profile without its builds. */
function useDetail(id: string, rev: unknown): Detail {
  const [d, setD] = useState<Detail>({ loading: true, error: '', builds: null });
  useEffect(() => {
    let live = true;
    getJson<{ builds?: unknown }>(`/api/plugins/${FOLDER}/get?id=${encodeURIComponent(id)}`)
      .then((j) => { if (live) setD({ loading: false, error: '', builds: Array.isArray(j.builds) ? (j.builds as BuildRow[]) : null }); })
      .catch((e: Error) => { if (live) setD({ loading: false, error: e.message, builds: null }); });
    return () => { live = false; };
  }, [id, rev]);
  return d;
}

type ListKind = 'pending' | 'queue' | 'plan';
interface ListLine { id: string; text: string; tag?: string }
const LIST_API: Record<ListKind, string> = { pending: 'pending', queue: 'build-queue', plan: 'plan' };
const text = (v: unknown) => (typeof v === 'string' ? v : '');
/** The lines of one of the console's own lists (they are the lists of the profile in force). */
function linesOf(kind: ListKind, j: Record<string, unknown>): ListLine[] {
  const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
  const rec = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});
  if (kind === 'pending') return arr(j.items).map(rec).filter((i) => i.status !== 'complete').map((i) => ({ id: text(i.id), text: text(i.title) || text(i.id), tag: [text(i.priority), text(i.status)].filter(Boolean).join(' · ') }));
  if (kind === 'plan') return arr(j.features).map(rec).map((f) => ({ id: text(f.id), text: text(f.title) || text(f.id), tag: text(f.status) }));
  const q = Array.isArray(j.order) ? j : rec(j.queue);
  return arr(q.order).map((x) => (typeof x === 'string' ? { id: x, text: x } : { id: text(rec(x).id), text: text(rec(x).title) || text(rec(x).id), tag: text(rec(x).status) })).filter((l) => l.id);
}
function useLines(kind: ListKind, on: boolean): { lines: ListLine[] | null; error: string } {
  const [res, setRes] = useState<{ lines: ListLine[] | null; error: string }>({ lines: null, error: '' });
  useEffect(() => {
    if (!on) return undefined;
    let live = true;
    getJson<Record<string, unknown>>(`/api/${LIST_API[kind]}`)
      .then((j) => { if (live) setRes({ lines: linesOf(kind, j), error: '' }); })
      .catch((e: Error) => { if (live) setRes({ lines: [], error: e.message }); });
    return () => { live = false; };
  }, [kind, on]);
  return res;
}

const PAGE = 40;
const STATUS_TONE: Record<string, 'accent' | 'success' | 'warning' | 'danger' | undefined> = {
  running: 'accent', building: 'accent', landing: 'accent', split: 'accent', complete: 'success', landed: 'success', built: 'success',
  failed: 'danger', blocked: 'danger', escalated: 'danger', fixing: 'warning', waiting: 'warning',
};

/** A list tab (pending, queue, plan): the count, and the lines when the profile is the one in force. */
function ListTab({ kind, p, state, count, noun }: { kind: ListKind; p: Profile; state: State; count: number | null | undefined; noun: string }) {
  const inForce = p.id === state.effective;
  const { lines, error } = useLines(kind, inForce);
  const [all, setAll] = useState(false);
  const shown = all ? lines ?? [] : (lines ?? []).slice(0, PAGE);
  return (
    <div className="fx-stack fx-stack--sm">
      <p className="axp-build-profiles__p"><strong>{n(count)}</strong> {noun}{kind === 'plan' && p.counts?.tracked != null ? ` · ${n(p.counts.tracked)} tracked` : ''}</p>
      {!inForce && <p className="fx-small fx-muted axp-build-profiles__p">The console lists the lines of the profile in use. Use this profile to open them.</p>}
      {error && <Note tone="warning">{error}</Note>}
      {inForce && !lines && !error && <LoadingSkeleton rows={3} label={`Loading the ${noun}`} />}
      {shown.length > 0 && (
        <ul className="axp-build-profiles__lines">
          {shown.map((l) => <li key={l.id} className="axp-build-profiles__bline"><span className="axp-build-profiles__btitle">{l.text}</span>{l.tag && <span className="fx-small fx-muted">{l.tag}</span>}</li>)}
        </ul>
      )}
      {!all && (lines?.length ?? 0) > PAGE && <div className="fx-row"><Button size="sm" tone="ghost" icon="chevron-down" onClick={() => setAll(true)}>Show all {lines!.length}</Button></div>}
    </div>
  );
}

function BuildsTab({ p }: { p: Profile }) {
  const rt = useRuntime();
  const d = useDetail(p.id, p.stats?.lastActivity ?? p.updatedAt);
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [limit, setLimit] = useState(PAGE);
  const st = p.stats;
  const found = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return (d.builds ?? []).filter((b) => { const hay = `${b.id} ${b.title ?? ''} ${b.status} ${b.priority ?? ''}`.toLowerCase(); return words.every((w) => hay.includes(w)); });
  }, [d.builds, q]);
  const toggle = (id: string, on: boolean) => setPicked((x) => (on ? [...x.filter((y) => y !== id), id] : x.filter((y) => y !== id)));
  const canMove = !p.removedAt && pickable().some((x) => x.id !== p.id);
  return (
    <div className="fx-stack fx-stack--sm">
      {st ? (
        <>
          <p className="axp-build-profiles__p">
            <strong>{n(st.builds)}</strong> builds · {n(st.running)} running · {n(st.pending)} pending · {n(st.complete)} complete · {n(st.archived)} archived
            {st.steps ? ` · ${n(st.steps.done)} of ${n(st.steps.total)} steps done` : ''}
          </p>
          <div className="fx-row fx-row--wrap">{Object.entries(st.byStatus ?? {}).sort((a, b) => b[1] - a[1]).map(([s, c]) => <Chip key={s} tone={STATUS_TONE[s]}>{s} {c}</Chip>)}</div>
        </>
      ) : <p className="axp-build-profiles__p"><strong>{n(p.counts?.orchestrator)}</strong> open orchestrator builds</p>}
      {d.loading && <LoadingSkeleton rows={3} label="Loading the builds" />}
      {!d.loading && d.builds === null && (
        <p className="fx-small fx-muted axp-build-profiles__p">{d.error || 'The server lists this profile without its builds.'} To move builds, name them by id.</p>
      )}
      {d.builds !== null && d.builds.length > 0 && (
        <>
          <div className="fx-row fx-row--wrap axp-build-profiles__pick">
            <label className="fx-search axp-build-profiles__search">
              <Icon name="search" size={13} />
              <input type="search" placeholder="Search these builds…" value={q} onChange={(e) => { setQ(e.target.value); setLimit(PAGE); }} aria-label={`Search the builds of ${p.name}`} />
            </label>
            {canMove && <Button size="sm" tone="ghost" onClick={() => setPicked(picked.length === found.length ? [] : found.map((b) => b.id))}>{picked.length && picked.length === found.length ? 'Pick none' : `Pick all ${found.length}`}</Button>}
          </div>
          <ul className="axp-build-profiles__lines">
            {found.slice(0, limit).map((b) => (
              <li key={b.id} className="axp-build-profiles__bline" data-fx-ctx-target="axf-build-item" data-fx-ctx-payload={b.id}>
                {canMove
                  ? <Checkbox className="axp-build-profiles__btitle" label={b.title || b.id} title={b.id} checked={picked.includes(b.id)} onChange={(on) => toggle(b.id, on)} />
                  : <span className="axp-build-profiles__btitle" title={b.id}>{b.title || b.id}</span>}
                <Chip tone={STATUS_TONE[b.status]}>{b.status}</Chip>
                <span className="fx-small fx-muted axp-build-profiles__bmeta">
                  {b.steps ? `${b.stepsDone ?? 0}/${b.steps} steps` : ''}{b.costUsd ? ` · ${money(b.costUsd)}` : ''}{b.pr ? ` · PR #${b.pr}` : ''}{b.lastActivity ? ` · ${ago(b.lastActivity)}` : ''}
                </span>
              </li>
            ))}
          </ul>
          {found.length === 0 && <p className="fx-small fx-muted axp-build-profiles__p">No build matches “{q}”.</p>}
          {found.length > limit && <div className="fx-row"><Button size="sm" tone="ghost" icon="chevron-down" onClick={() => setLimit(limit + PAGE * 5)}>Show more ({found.length - limit} left)</Button></div>}
        </>
      )}
      {d.builds !== null && d.builds.length === 0 && <p className="fx-small fx-muted axp-build-profiles__p">No builds in this profile.</p>}
      {canMove && (
        <div className="fx-row fx-row--wrap">
          <Button size="sm" tone={picked.length ? 'primary' : 'neutral'} icon="move" onClick={() => rt.openDialog(DIALOG_MOVE, { from: p.id, builds: picked })}>{picked.length ? `Move ${picked.length} to another profile…` : 'Move builds…'}</Button>
        </div>
      )}
    </div>
  );
}

type DetailTab = 'builds' | 'pending' | 'queue' | 'plan' | 'files';

/** What is in a profile, one tab each. Used by an open grid row and by the profile view. */
function ProfileContents({ p, state }: { p: Profile; state: State }) {
  const [tab, setTab] = useState<DetailTab>('builds');
  const st = p.stats;
  const files = Object.entries(p.files ?? {});
  return (
    <TabGroup<DetailTab> id="build-profiles.contents" label={`What is in ${p.name}`} size="sm" value={tab} onChange={setTab} tabs={[
      { value: 'builds', label: 'Builds', icon: 'layers', badge: st?.builds ?? p.counts?.orchestrator ?? undefined },
      { value: 'pending', label: 'Pending', icon: 'clock', badge: st?.pendingItems ?? p.counts?.pending ?? undefined },
      { value: 'queue', label: 'Queue', icon: 'list', badge: st?.queueSteps ?? p.counts?.queue ?? undefined },
      { value: 'plan', label: 'Plan', icon: 'chart', badge: p.counts?.plan ?? undefined },
      { value: 'files', label: 'Files', icon: 'folder', badge: files.length || undefined },
    ]}>
      <div className="axp-build-profiles__panel">
        {tab === 'builds' && <BuildsTab p={p} />}
        {tab === 'pending' && <ListTab kind="pending" p={p} state={state} count={st?.pendingItems ?? p.counts?.pending} noun="pending builds" />}
        {tab === 'queue' && <ListTab kind="queue" p={p} state={state} count={st?.queueSteps ?? p.counts?.queue} noun="queue steps" />}
        {tab === 'plan' && <ListTab kind="plan" p={p} state={state} count={p.counts?.plan} noun="plan entries" />}
        {tab === 'files' && (files.length ? (
          <dl className="axp-build-profiles__files">
            {files.map(([k, v]) => <div key={k} className="axp-build-profiles__file"><dt className="fx-small fx-muted">{k}</dt><dd className="fx-mono">{v}</dd></div>)}
          </dl>
        ) : <p className="fx-small fx-muted axp-build-profiles__p">{p.removedAt ? 'Its files stay in its folder until its data is deleted.' : 'No files on record.'}</p>)}
      </div>
    </TabGroup>
  );
}

/** Every action on one profile, as buttons (the grid row, the profile view). */
function ProfileActions({ p, state, view }: { p: Profile; state: State; view?: boolean }) {
  const rt = useRuntime();
  const go = (action: string) => () => { rt.dispatch(`build-profiles.${action}:${p.id}`); };
  if (p.removedAt) {
    return (
      <div className="fx-row fx-row--wrap">
        <Button size="sm" tone="primary" icon="undo" onClick={go('restore')}>Restore</Button>
        {view && <Button size="sm" tone="ghost" icon="eye" onClick={go('view')}>View</Button>}
        <Button size="sm" tone="danger" icon="trash" onClick={go('purge')}>Delete data…</Button>
      </div>
    );
  }
  const saved = p.id === state.active;
  const fixed = !!p.base || saved;
  const others = state.profiles.some((x) => x.id !== p.id && !x.archived);
  return (
    <div className="fx-row fx-row--wrap">
      {!p.archived && <Button size="sm" tone={saved ? 'neutral' : 'primary'} icon="check" disabled={saved} onClick={go('use')}>{saved ? 'Saved pick' : 'Use this one'}</Button>}
      {view && <Button size="sm" tone="ghost" icon="eye" onClick={go('view')}>View</Button>}
      <Button size="sm" tone="ghost" icon="edit" onClick={go('edit')}>Edit</Button>
      <Button size="sm" tone="ghost" icon="copy" onClick={go('duplicate')}>Duplicate</Button>
      <Button size="sm" tone="ghost" icon="shuffle" disabled={!!p.base || !others} title={p.base ? 'The base profile stays: merge the other profile into it.' : undefined} onClick={go('merge')}>Merge into…</Button>
      {p.archived
        ? <Button size="sm" tone="ghost" icon="box" onClick={go('unarchive')}>Unarchive</Button>
        : <Button size="sm" tone="ghost" icon="box" disabled={fixed} title={fixed ? 'The base profile and the saved pick can\'t be archived.' : undefined} onClick={go('archive')}>Archive</Button>}
      <Button size="sm" tone="ghost" icon="trash" disabled={fixed} title={fixed ? 'The base profile and the saved pick stay on the list.' : undefined} onClick={go('remove')}>Take off the list</Button>
    </div>
  );
}

/* ---------------- manager page ---------------- */

type SortKey = 'activity' | 'name' | 'builds' | 'spent' | 'created';
type ShowKey = 'all' | 'active' | 'archived' | 'removed';
const SORTS: { value: SortKey; label: string }[] = [
  { value: 'activity', label: 'Last activity' }, { value: 'name', label: 'Name' }, { value: 'builds', label: 'Most builds' },
  { value: 'spent', label: 'Most spent' }, { value: 'created', label: 'Newest' },
];
const SHOWS: { value: ShowKey; label: string }[] = [
  { value: 'all', label: 'Every profile' }, { value: 'active', label: 'In the pickers' }, { value: 'archived', label: 'Archived' }, { value: 'removed', label: 'Off the list' },
];
const SORT_KEY = 'build-profiles.sort';
const SHOW_FILTER_KEY = 'build-profiles.filter';
const oneOf = <T extends string>(v: unknown, list: { value: T }[], fallback: T): T => (list.some((x) => x.value === v) ? (v as T) : fallback);

function sortProfiles(list: Profile[], sort: SortKey, effective: string): Profile[] {
  const by: Record<SortKey, (a: Profile, b: Profile) => number> = {
    activity: (a, b) => activityOf(b).localeCompare(activityOf(a)),
    name: (a, b) => a.name.localeCompare(b.name),
    builds: (a, b) => (b.stats?.builds ?? b.counts?.orchestrator ?? 0) - (a.stats?.builds ?? a.counts?.orchestrator ?? 0),
    spent: (a, b) => (b.stats?.cost?.spentUsd ?? 0) - (a.stats?.cost?.spentUsd ?? 0),
    created: (a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''),
  };
  // profiles off the list sink to the bottom; the profile in force leads a tie
  return [...list].sort((a, b) => Number(!!a.removedAt) - Number(!!b.removedAt) || by[sort](a, b) || Number(b.id === effective) - Number(a.id === effective) || a.name.localeCompare(b.name));
}

function ManagerRow({ p, state, open, onToggle }: { p: Profile; state: State; open: boolean; onToggle: () => void }) {
  const st = p.stats;
  const bodyId = `axp-build-profiles-${p.id}`;
  const when = activityOf(p);
  return (
    <li className={`axp-build-profiles__item${p.id === state.effective ? ' is-active' : ''}${p.archived || p.removedAt ? ' is-off' : ''}`} data-fx-ctx-target={ROW_TARGET} data-fx-ctx-payload={p.id} data-axf-target={`row:${p.id}`}>
      <button type="button" data-fx-row className="axp-build-profiles__line" aria-expanded={open} aria-controls={bodyId} onClick={onToggle}>
        <span className="axp-build-profiles__who">
          <Icon name={open ? 'chevron-down' : 'chevron-right'} size={13} />
          <Mark p={p} />
          <span className="axp-build-profiles__name">{p.name}</span>
          <StateChips p={p} state={state} />
        </span>
        <span className="axp-build-profiles__cell" title="Builds on record">
          <span className="axp-build-profiles__k">Builds</span>
          <span><strong>{n(st?.builds ?? p.counts?.orchestrator)}</strong>{st && <span className="fx-muted"> · {n(st.running)} running · {n(st.pending)} pending · {n(st.complete)} done</span>}</span>
        </span>
        <span className="axp-build-profiles__cell" title={st?.cost?.leftUsd != null ? 'Spent so far, and an estimate of what the open steps will cost' : 'Spent so far'}>
          <span className="axp-build-profiles__k">Cost</span>
          <span><strong>{money(st?.cost?.spentUsd)}</strong>{st?.cost?.leftUsd != null && <span className="fx-muted"> · ~{money(st.cost.leftUsd)} left</span>}</span>
        </span>
        <span className="axp-build-profiles__cell" title={when ? stamp(when) : undefined}>
          <span className="axp-build-profiles__k">{p.removedAt ? 'Taken off' : 'Last activity'}</span>
          <span>{ago(p.removedAt || when) || '–'}</span>
        </span>
      </button>
      {open && (
        <div id={bodyId} className="axp-build-profiles__body">
          {p.description && <p className="fx-small fx-muted axp-build-profiles__p">{p.description}</p>}
          <ProfileActions p={p} state={state} view />
          <ProfileContents p={p} state={state} />
        </div>
      )}
    </li>
  );
}

function Manager() {
  const rt = useRuntime();
  const s = useProfiles();
  const [q, setQ] = useState('');
  const [sort, setSortState] = useState<SortKey>(() => oneOf(rt.settings.get(SORT_KEY), SORTS, 'activity'));
  const [show, setShowState] = useState<ShowKey>(() => oneOf(rt.settings.get(SHOW_FILTER_KEY), SHOWS, 'all'));
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const setSort = (v: string) => { const k = oneOf(v, SORTS, 'activity'); setSortState(k); rt.settings.set(SORT_KEY, k); };
  const setShow = (v: string) => { const k = oneOf(v, SHOWS, 'all'); setShowState(k); rt.settings.set(SHOW_FILTER_KEY, k); };
  useEffect(() => { void loadProfiles(); }, []);

  const data = s.data;
  const every = useMemo(() => [...(data?.profiles ?? []), ...(data?.removed ?? [])], [data]);
  const shown = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const pass = (p: Profile) => (show === 'all' ? true : show === 'removed' ? !!p.removedAt : show === 'archived' ? !!p.archived && !p.removedAt : !p.archived && !p.removedAt);
    const hit = (p: Profile) => { const hay = `${p.name} ${p.id} ${p.description ?? ''} ${p.copiedFrom ?? ''}`.toLowerCase(); return words.every((w) => hay.includes(w)); };
    return sortProfiles(every.filter((p) => pass(p) && hit(p)), sort, data?.effective ?? '');
  }, [every, q, show, sort, data?.effective]);
  const filtering = !!q.trim() || show !== 'all';
  const toggle = (id: string) => setOpen((x) => { const y = new Set(x); if (y.has(id)) y.delete(id); else y.add(id); return y; });

  usePublishPageState(VIEW, { profiles: shown.length, filtering, open: open.size });
  useToolbarHandlers(VIEW, {
    'build-profiles.new': () => { rt.dispatch('build-profiles.new'); return { opened: true }; },
    'build-profiles.reload': async () => { await loadProfiles(); return { profiles: listed().length }; },
    'build-profiles.expand': () => { setOpen(new Set(shown.map((p) => p.id))); return { open: shown.length }; },
    'build-profiles.collapse': () => { setOpen(new Set()); return { open: 0 }; },
    'build-profiles.clear': () => { setQ(''); setShow('all'); return { cleared: true }; },
  });

  if (!data) return <div className="fx-stack axp-build-profiles-page">{s.error ? <EmptyState icon="alert" action={{ label: 'Try again', icon: 'refresh', onClick: () => void loadProfiles() }}>{s.error}</EmptyState> : <LoadingSkeleton rows={5} label="Loading the build profiles" />}</div>;

  const on = data.profiles;
  const sum = (f: (p: Profile) => number | null | undefined) => on.reduce((t, p) => t + (f(p) ?? 0), 0);
  const hasStats = on.some((p) => p.stats);
  return (
    <div className="fx-stack axp-build-profiles-page">
      <p className="fx-small fx-muted axp-build-profiles__p">
        Each profile has its own plan, build queue, pending builds, tracking and orchestrator builds. The pick is saved for every device and session.
      </p>
      <div className="axp-build-profiles__totals">
        <span><strong>{on.length}</strong> on the list</span>
        {on.some((p) => p.archived) && <span><strong>{on.filter((p) => p.archived).length}</strong> archived</span>}
        {!!data.removed?.length && <span><strong>{data.removed.length}</strong> off the list</span>}
        {hasStats && <span><strong>{n(sum((p) => p.stats?.builds))}</strong> builds</span>}
        {hasStats && <span><strong>{money(sum((p) => p.stats?.cost?.spentUsd))}</strong> spent</span>}
        <span className="fx-muted">data in {data.dataRoot}</span>
      </div>
      <PageToolbar view={VIEW} label="Build profiles: search, sort and filter" className="axp-build-profiles__bar">
        <label className="fx-search axp-build-profiles__search">
          <Icon name="search" size={13} />
          <input type="search" placeholder="Search profiles…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search profiles" />
        </label>
        <label className="fx-search axp-build-profiles__sel" title="Sort">
          <Icon name="list" size={12} />
          <select aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value)}>{SORTS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
        </label>
        <label className="fx-search axp-build-profiles__sel" title="Show">
          <Icon name="eye" size={12} />
          <select aria-label="Show" value={show} onChange={(e) => setShow(e.target.value)}>{SHOWS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
        </label>
      </PageToolbar>
      {s.error && <Note tone="warning">{s.error}</Note>}
      {shown.length
        ? <ul className="axp-build-profiles__grid" aria-label="Build profiles">{shown.map((p) => <ManagerRow key={p.id} p={p} state={data} open={open.has(p.id)} onToggle={() => toggle(p.id)} />)}</ul>
        : <EmptyState icon="layers" action={filtering ? { label: 'Clear filters', icon: 'x', onClick: () => { setQ(''); setShow('all'); } } : { label: 'New profile', icon: 'plus', onClick: () => { rt.dispatch('build-profiles.new'); } }}>{filtering ? 'No profile matches.' : 'No build profiles yet.'}</EmptyState>}
    </div>
  );
}

/* ---------------- dialogs ---------------- */

const str = (v: unknown) => (typeof v === 'string' ? v : '');
const SLUG = /^[a-z0-9][a-z0-9-]{0,39}$/;
/** A dialog body that needs the profiles: the skeleton until they are in. */
function WithProfiles({ children }: { children: (state: State) => React.ReactNode }) {
  const s = useProfiles();
  useEffect(() => { if (!st.data) void loadProfiles(); }, []);
  if (!s.data) return <div className="axp-build-profiles">{s.error ? <Note tone="warning">{s.error}</Note> : <LoadingSkeleton />}</div>;
  return <>{children(s.data)}</>;
}
const Missing = ({ id }: { id: string }) => <Note tone="warning">No build profile “{id}”.</Note>;
const profileOptions = (list: Profile[]) => list.map((p) => ({ value: p.id, label: p.archived ? `${p.name} (archived)` : p.name }));

/** The profile view: who it is, its numbers, what is in it, and every action. */
function ProfileView({ id, state }: { id: string; state: State }) {
  const p = findProfile(id);
  if (!p) return <Missing id={id} />;
  const st = p.stats;
  const facts: [string, React.ReactNode][] = [
    ['Id', <span className="fx-mono">{p.id}</span>],
    ['Created', stamp(p.createdAt)],
    ['Changed', stamp(p.updatedAt)],
    ...(p.copiedFrom ? [['Copied from', findProfile(p.copiedFrom)?.name ?? p.copiedFrom] as [string, React.ReactNode]] : []),
    ...(p.archivedAt ? [['Archived', stamp(p.archivedAt)] as [string, React.ReactNode]] : []),
    ...(p.removedAt ? [['Taken off the list', `${stamp(p.removedAt)}${p.removedBy ? ` by ${p.removedBy}` : ''}`] as [string, React.ReactNode]] : []),
    ['Plan rebuilds', p.catalog ? 'import the framework seed and feature catalog' : 'keep only this profile\'s own entries'],
    ...(st ? [
      ['Last activity', st.lastActivity ? `${stamp(st.lastActivity)} (${ago(st.lastActivity)})` : '–'] as [string, React.ReactNode],
      ['Spent', money(st.cost?.spentUsd)] as [string, React.ReactNode],
      ['Left (estimate)', st.cost?.leftUsd == null ? '–' : `${money(st.cost.leftUsd)}${st.cost.perStepUsd ? ` · ${n(st.steps?.left)} open steps at ${money(st.cost.perStepUsd)}` : ''}`] as [string, React.ReactNode],
      ...(st.cost?.budgetLeftUsd != null ? [['Budget left', money(st.cost.budgetLeftUsd)] as [string, React.ReactNode]] : []),
    ] : []),
  ];
  return (
    <div className="fx-stack axp-build-profiles axp-build-profiles--view">
      <div className="axp-build-profiles__head">
        <span className="axp-build-profiles__name"><Mark p={p} size={18} /> {p.name}</span>
        <StateChips p={p} state={state} />
      </div>
      {p.description && <p className="axp-build-profiles__p">{p.description}</p>}
      <dl className="axp-build-profiles__facts">
        {facts.map(([k, v]) => <div key={k} className="axp-build-profiles__fact"><dt className="fx-small fx-muted">{k}</dt><dd>{v}</dd></div>)}
      </dl>
      <ProfileActions p={p} state={state} />
      <ProfileContents p={p} state={state} />
    </div>
  );
}

type EditMode = 'create' | 'edit' | 'duplicate';

/** Create, Edit and Duplicate: one form. */
function EditProfile({ mode, source, state, close }: { mode: EditMode; source: Profile | null; state: State; close: () => void }) {
  const rt = useRuntime();
  const [name, setName] = useState(mode === 'edit' ? source!.name : mode === 'duplicate' ? `${source!.name} copy` : '');
  const [newId, setNewId] = useState('');
  const [desc, setDesc] = useState(mode === 'create' ? '' : source!.description ?? '');
  const [color, setColor] = useState<string>(toneOf(source));
  const [icon, setIcon] = useState(iconOf(source));
  const [catalog, setCatalog] = useState(mode === 'edit' ? !!source!.catalog : false);
  const [from, setFrom] = useState('');
  const [withBuilds, setWithBuilds] = useState(true);
  const [select, setSelect] = useState(mode === 'create');
  const [busy, setBusy] = useState(false);
  const idError = newId && !SLUG.test(newId) ? 'Lowercase letters, digits and dashes, up to 40.' : [...state.profiles, ...(state.removed ?? [])].some((p) => p.id === newId) ? 'That id is taken.' : '';
  const ready = !!name.trim() && !idError && !busy;
  const save = async () => {
    setBusy(true);
    const made = await (mode === 'edit'
      ? change(rt, { action: 'update', id: source!.id, name, description: desc, catalog, ...lookFields(color, icon) }, 'Saved.')
      : mode === 'duplicate'
        ? change(rt, { action: 'duplicate', id: source!.id, name, description: desc, builds: withBuilds, ...(newId ? { newId } : {}), select: false }, `${name.trim()} created from ${source!.name}.`)
        : change(rt, { action: 'create', name, description: desc, catalog, ...(newId ? { id: newId } : {}), ...(from ? { copyFrom: from } : {}), ...lookFields(color, icon), select: false }, `${name.trim()} created.`));
    setBusy(false);
    if (!made) return;
    close();
    if (mode !== 'edit' && select) {
      const p = (newId && findProfile(newId)) || listed().find((x) => x.name === name.trim() && x.id !== source?.id);
      if (p) await use(rt, p);
    }
  };
  return (
    <div className="fx-stack axp-build-profiles">
      {mode === 'duplicate' && <p className="fx-small fx-muted axp-build-profiles__p">A second profile with copies of {source!.name}'s plan, queue and tracking files. Its builds are the same records, shown in both.</p>}
      <TextField label="Name" value={name} onChange={setName} placeholder="e.g. Refactor" required autoFocus />
      {mode !== 'edit' && <TextField label="Id" value={newId} onChange={(v) => setNewId(v.trim().toLowerCase())} mono placeholder="made from the name" error={idError || undefined} hint="Optional. It names the profile's folder and can't change later." />}
      <TextField label="Description" value={desc} onChange={setDesc} rows={2} />
      {mode !== 'duplicate' && (
        <div className="axp-build-profiles__look">
          <SelectField label="Colour" value={color} onChange={setColor} empty="Default" options={TONES} hint="Shown on the banner chip and in the grid." />
          <SelectField label="Icon" value={icon} onChange={setIcon} empty="Default" options={PROFILE_ICONS.map((i) => ({ value: i, label: i }))} />
          <span className="axp-build-profiles__preview"><Mark p={{ id: '', name: '', color, icon }} size={18} /> <span>{name.trim() || 'Profile'}</span></span>
        </div>
      )}
      {mode === 'create' && <SelectField label="Start with" value={from} onChange={setFrom} empty="Empty" options={pickable().map((p) => ({ value: p.id, label: `Copy of ${p.name}` }))} />}
      {mode === 'duplicate' && <Switch label="Show its builds in the copy too" checked={withBuilds} onChange={setWithBuilds} hint="Off: the copy starts with the files and no builds." />}
      {mode !== 'duplicate' && <Switch label="Plan rebuilds import the framework's seed + feature catalog" checked={catalog} onChange={setCatalog} />}
      {mode !== 'edit' && <Switch label="Use it right away" checked={select} onChange={setSelect} />}
      <div className="fx-row fx-row--wrap">
        <Button tone="primary" icon={mode === 'edit' ? 'check' : mode === 'duplicate' ? 'copy' : 'plus'} disabled={!ready} busy={busy} onClick={() => void save()}>{mode === 'edit' ? 'Save' : mode === 'duplicate' ? 'Duplicate' : 'Create'}</Button>
        <Button tone="ghost" onClick={close}>Cancel</Button>
      </div>
    </div>
  );
}

function MergeProfiles({ initial, state, close }: { initial: string; state: State; close: () => void }) {
  const rt = useRuntime();
  const sources = state.profiles.filter((p) => !p.base);
  const [from, setFrom] = useState(sources.some((p) => p.id === initial) ? initial : '');
  const targets = state.profiles.filter((p) => p.id !== from && !p.archived);
  const [into, setInto] = useState('');
  const [keep, setKeep] = useState(false);
  const [busy, setBusy] = useState(false);
  const a = findProfile(from); const b = into !== from ? findProfile(into) : null;
  const merge = async () => {
    setBusy(true);
    const ok = await change(rt, { action: 'merge', from, into, ...mergeFields(keep) }, `${a!.name} merged into ${b!.name}.`);
    setBusy(false);
    if (!ok) return;
    for (const ev of [PROFILE_CHANGED, 'axf:pending-changed', 'axf:plan-changed']) globalThis.dispatchEvent(new CustomEvent(ev, { detail: { id: into } }));
    close();
  };
  if (!sources.length) return <Note>There is only the base profile: nothing to merge.</Note>;
  return (
    <div className="fx-stack axp-build-profiles">
      <SelectField label="Merge" value={from} onChange={setFrom} empty="Pick a profile" options={profileOptions(sources)} required />
      <SelectField label="Into" value={b ? into : ''} onChange={setInto} empty="Pick a profile" options={profileOptions(targets)} required />
      <Switch label={`Keep ${a?.name ?? 'it'} on the list, empty`} checked={keep} onChange={setKeep} hint="Off: it comes off the list and can be restored." />
      {a && b && (
        <Note tone={from === state.active ? 'warning' : 'info'}>
          {a.stats ? `${n(a.stats.builds)} builds` : 'Every build'} of {a.name} move to {b.name}; a build in both stays once. {keep ? `${a.name} stays on the list, empty.` : `${a.name} comes off the list (Restore brings it back).`} Its plan and catalog files stay in its folder.
          {from === state.active ? ` ${a.name} is the saved pick: ${b.name} becomes the pick.` : ''}
        </Note>
      )}
      <div className="fx-row fx-row--wrap">
        <Button tone="primary" icon="shuffle" disabled={!a || !b || busy} busy={busy} onClick={() => void merge()}>Merge</Button>
        <Button tone="ghost" onClick={close}>Cancel</Button>
      </div>
    </div>
  );
}

const BUILD_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;

function MoveBuilds({ initialFrom, initialBuilds, state, close }: { initialFrom: string; initialBuilds: string[]; state: State; close: () => void }) {
  const rt = useRuntime();
  const [typed, setTyped] = useState(initialBuilds.join('\n'));
  const [from, setFrom] = useState(state.profiles.some((p) => p.id === initialFrom) ? initialFrom : '');
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState(false);
  const ids = useMemo(() => [...new Set(typed.split(/[\s,]+/).filter(Boolean))], [typed]);
  const bad = ids.filter((x) => !BUILD_ID.test(x));
  const targets = pickable().filter((p) => p.id !== from);
  const ready = ids.length > 0 && !bad.length && targets.some((p) => p.id === to) && !busy;
  const move = async () => { setBusy(true); const ok = await moveBuilds(rt, ids, to, from); setBusy(false); if (ok) close(); };
  return (
    <div className="fx-stack axp-build-profiles">
      <TextField label={`Builds${ids.length ? ` (${ids.length})` : ''}`} value={typed} onChange={setTyped} rows={Math.min(8, Math.max(2, ids.length))} mono required
        error={bad.length ? `Not a build id: ${bad.slice(0, 3).join(', ')}` : undefined} hint="Build ids, one per line or separated by commas. Each keeps its id, status and steps." />
      <SelectField label="From" value={from} onChange={setFrom} empty="Every profile they are in" options={profileOptions(state.profiles)} hint="Pick one and a build shared with another profile stays there too." />
      <SelectField label="To" value={targets.some((p) => p.id === to) ? to : ''} onChange={setTo} empty="Pick a profile" options={profileOptions(targets)} required />
      <div className="fx-row fx-row--wrap">
        <Button tone="primary" icon="move" disabled={!ready} busy={busy} onClick={() => void move()}>Move {ids.length || ''} {ids.length === 1 ? 'build' : 'builds'}</Button>
        <Button tone="ghost" onClick={close}>Cancel</Button>
      </div>
    </div>
  );
}

type ConfirmKind = 'archive' | 'remove' | 'restore' | 'purge';
const CONFIRM_KINDS: ConfirmKind[] = ['archive', 'remove', 'restore', 'purge'];

/** Archive, Take off the list, Restore and Delete data: what it does, then the one button. */
function ConfirmChange({ kind, p, close }: { kind: ConfirmKind; p: Profile; close: () => void }) {
  const rt = useRuntime();
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const builds = p.stats ? `${n(p.stats.builds)} builds` : 'its builds';
  const run = async () => {
    setBusy(true);
    const ok = await (kind === 'archive' ? change(rt, { action: 'archive', id: p.id }, `${p.name} archived.`)
      : kind === 'remove' ? change(rt, { action: 'remove', id: p.id, confirm: p.id }, `${p.name} taken off the list.`)
        : kind === 'restore' ? change(rt, { action: 'restore', id: p.id }, `${p.name} is back on the list.`)
          // deleting data is owner only and has its own route: the confirm is the profile id, typed
          : change(rt, { id: p.id, confirm: typed }, `${p.name} and its data deleted.`, `plugins/${FOLDER}/purge`));
    setBusy(false);
    if (ok) close();
  };
  return (
    <div className="fx-stack axp-build-profiles">
      <div className="axp-build-profiles__head"><span className="axp-build-profiles__name"><Mark p={p} /> {p.name}</span><span className="fx-mono fx-muted">{p.id}</span></div>
      {kind === 'archive' && <Note>Archiving hides {p.name} from the pickers. It stays in this grid with {builds} and all its files; Unarchive brings it back. Nothing is deleted.</Note>}
      {kind === 'remove' && <Note tone="warning">{p.name} comes off the list. Its data stays ({builds}, plan, queue and tracking files), and Restore puts it back as it was.</Note>}
      {kind === 'restore' && <Note>{p.name} goes back on the list with its data{p.mergedInto ? `. Its builds were merged into ${p.mergedInto} and stay there` : ''}.</Note>}
      {kind === 'purge' && (
        <>
          <Note tone="danger">This deletes {p.name}'s data for good: its plan, queue and tracking files, and the builds that live only in this profile{p.stats ? ` (${n(p.stats.builds)} on record)` : ''}. A build that is also in another profile stays there. It can't be undone. Owner only.</Note>
          <TextField label={`Type ${p.id} to confirm`} value={typed} onChange={setTyped} mono autoFocus />
        </>
      )}
      <div className="fx-row fx-row--wrap">
        {kind === 'archive' && <Button tone="primary" icon="box" disabled={busy} busy={busy} onClick={() => void run()}>Archive</Button>}
        {kind === 'remove' && <Button tone="danger" icon="trash" disabled={busy} busy={busy} onClick={() => void run()}>Take off the list</Button>}
        {kind === 'restore' && <Button tone="primary" icon="undo" disabled={busy} busy={busy} onClick={() => void run()}>Restore</Button>}
        {kind === 'purge' && <Button tone="danger" icon="trash" disabled={busy || typed !== p.id} busy={busy} onClick={() => void run()}>Delete its data</Button>}
        <Button tone="ghost" onClick={close}>Cancel</Button>
      </div>
    </div>
  );
}

/* ---------------- right-click ---------------- */

type Entry = NonNullable<NonNullable<AxfWebLibrary['contextMenu']>[number]['items']>[number];

/** A profile row's own menu: the same actions as its buttons. */
function rowMenu(id: string | undefined): Entry[] {
  const p = id ? findProfile(id) : null;
  const s = st.data;
  if (!p || !s) return [];
  const item = (action: string, label: string, icon: string): Entry => ({ id: `build-profiles.row.${action}`, label, icon, action: `build-profiles.${action}:${p.id}` });
  if (p.removedAt) return [item('view', 'View', 'eye'), item('restore', 'Restore', 'undo'), item('purge', 'Delete data…', 'trash')];
  const fixed = !!p.base || p.id === s.active;
  return [
    ...(!p.archived && p.id !== s.active ? [item('use', 'Use this one', 'check')] : []),
    item('view', 'View', 'eye'), item('edit', 'Edit…', 'edit'), item('duplicate', 'Duplicate…', 'copy'),
    ...(!p.base ? [item('merge', 'Merge into…', 'shuffle')] : []),
    item('move', 'Move builds…', 'move'),
    ...(p.archived ? [item('unarchive', 'Unarchive', 'box')] : fixed ? [] : [item('archive', 'Archive…', 'box')]),
    ...(fixed ? [] : [item('remove', 'Take off the list…', 'trash')]),
  ];
}

/** On a build (any page that names one): Move to profile, with every profile it can go to. */
function buildMenu(target: string | undefined, payload: string | undefined): Entry[] {
  if (!payload || !BUILD_TARGETS.includes(target ?? '')) return [];
  const build = String(payload).replace(/^pending:/, '');
  if (!BUILD_ID.test(build)) return [];
  const enc = encodeURIComponent(build);
  const to = pickable().slice(0, 12);
  return [{
    id: 'build-profiles.move-to', label: 'Move to profile', icon: 'move',
    items: [
      ...to.map((p) => ({ id: `build-profiles.move-to.${p.id}`, label: p.name, icon: iconOf(p) || 'layers', action: `build-profiles.move-build:${p.id}:${enc}` })),
      ...(to.length ? [{ id: 'build-profiles.move-to.sep', separator: true }] : []),
      { id: 'build-profiles.move-to.choose', label: 'Choose…', icon: 'more', action: `build-profiles.move-pick:${enc}` },
    ],
  }];
}

export const plugin: AxfWebLibrary = {
  id: ID, // equals plugin.json "id"
  label: 'Build profiles',
  version: '0.2.0',
  appMenu,
  register(rt) {
    runtime = rt;
    const reg = (id: string, label: string, fn: (args: string[]) => void, params = true) => rt.actions.register(`build-profiles.${id}`, (args) => fn(args), { label, ...(params ? { params: true } : {}) });
    /** Run `fn` with the profile an action names, once the profiles are in. */
    const withProfile = (fn: (p: Profile) => void) => ([id = '']: string[]) => {
      const go = () => { const p = findProfile(id); if (p) fn(p); else rt.toast(`No build profile "${id}".`, 'danger', 'Build profiles'); };
      if (st.data) go(); else void loadProfiles().then(go);
    };
    reg('open', 'Build profiles', () => rt.openDialog(DIALOG), false);
    reg('manage', 'Build profiles: manager', () => { rt.closeDialog(); rt.dispatch(`nav:${VIEW}`); }, false);
    reg('new', 'New build profile', () => rt.openDialog(DIALOG_EDIT, { mode: 'create' }), false);
    reg('view', 'View a build profile', ([id = '']) => rt.openDialog(DIALOG_VIEW, { id }));
    reg('edit', 'Edit a build profile', ([id = '']) => rt.openDialog(DIALOG_EDIT, { mode: 'edit', id }));
    reg('duplicate', 'Duplicate a build profile', ([id = '']) => rt.openDialog(DIALOG_EDIT, { mode: 'duplicate', id }));
    reg('merge', 'Merge build profiles', ([id = '']) => rt.openDialog(DIALOG_MERGE, { from: id }), false);
    reg('move', 'Move builds to another profile', ([id = '']) => rt.openDialog(DIALOG_MOVE, { from: id, builds: [] }), false);
    reg('move-pick', 'Move a build: choose the profile', ([build = '']) => rt.openDialog(DIALOG_MOVE, { from: '', builds: [decodeURIComponent(build)] }));
    reg('move-build', 'Move a build to a profile', ([to = '', build = '']) => { if (to && build) void moveBuilds(rt, [decodeURIComponent(build)], to); });
    reg('use', 'Use a build profile', withProfile((p) => void use(rt, p)));
    reg('unarchive', 'Unarchive a build profile', withProfile((p) => void change(rt, { action: 'unarchive', id: p.id }, `${p.name} is back in the pickers.`)));
    for (const kind of CONFIRM_KINDS) reg(kind, { archive: 'Archive a build profile', remove: 'Take a build profile off the list', restore: 'Restore a build profile', purge: 'Delete a build profile\'s data' }[kind], ([id = '']) => rt.openDialog(DIALOG_CONFIRM, { kind, id }));
    rt.contextExtras.set(ROW_TARGET, (_t, payload) => rowMenu(payload));
    rt.contextExtras.set(`*:${FOLDER}`, buildMenu);
    registerCleanup(rt);
    paint(rt);
    void loadProfiles();
  },
  views: {
    [VIEW]: { title: 'Build profiles', icon: 'layers', keywords: ['profile', 'profiles', 'build profile', 'switch', 'merge', 'duplicate', 'archive', 'restore', 'move builds', 'cost'], render: () => <Manager /> },
  },
  nav: { label: 'Builds', items: [{ id: VIEW, label: 'Build profiles', icon: 'layers', view: VIEW }] },
  dialogs: {
    [DIALOG]: { title: 'Build profiles', icon: 'layers', render: () => <Picker /> },
    ...cleanupDialogs,
    [DIALOG_VIEW]: { title: 'Build profile', icon: 'layers', size: 'wide', searchable: false, render: (props) => <WithProfiles>{(state) => <ProfileView id={str(props.id) || state.effective} state={state} />}</WithProfiles> },
    [DIALOG_EDIT]: {
      title: 'Build profile: new, edit or duplicate', icon: 'edit', searchable: false,
      render: (props, close) => (
        <WithProfiles>{(state) => {
          const mode: EditMode = props.mode === 'edit' || props.mode === 'duplicate' ? props.mode : 'create';
          const source = mode === 'create' ? null : state.profiles.find((p) => p.id === str(props.id)) ?? null;
          return mode !== 'create' && !source ? <Missing id={str(props.id)} /> : <EditProfile key={`${mode}:${source?.id ?? ''}`} mode={mode} source={source} state={state} close={close} />;
        }}</WithProfiles>
      ),
    },
    [DIALOG_MERGE]: { title: 'Merge build profiles', icon: 'shuffle', render: (props, close) => <WithProfiles>{(state) => <MergeProfiles initial={str(props.from)} state={state} close={close} />}</WithProfiles> },
    [DIALOG_MOVE]: {
      title: 'Move builds to another profile', icon: 'move',
      render: (props, close) => <WithProfiles>{(state) => <MoveBuilds initialFrom={str(props.from)} initialBuilds={Array.isArray(props.builds) ? props.builds.filter((x): x is string => typeof x === 'string') : []} state={state} close={close} />}</WithProfiles>,
    },
    [DIALOG_CONFIRM]: {
      title: 'Build profile', icon: 'layers', searchable: false,
      render: (props, close) => (
        <WithProfiles>{() => {
          const p = findProfile(str(props.id));
          const kind = CONFIRM_KINDS.find((k) => k === props.kind);
          return p && kind ? <ConfirmChange key={`${kind}:${p.id}`} kind={kind} p={p} close={close} /> : <Missing id={str(props.id)} />;
        }}</WithProfiles>
      ),
    },
  },
  contextMenu: [
    { id: 'build-profiles.default', target: 'default', order: 92, items: [{ id: 'build-profiles', label: 'Build profiles…', icon: 'layers', action: 'build-profiles.manage' }] },
  ],
  settingsTabs: [{ id: 'build-profiles', label: 'Build profiles', icon: 'layers', order: 7, parent: 'plugins' }],
  settingsPanels: [
    { id: 'build-profiles.main', tab: 'build-profiles', title: 'Build profiles', icon: 'layers', order: 5, render: () => <SettingsPanel /> },
    { id: 'build-profiles.lifecycle', tab: 'build-profiles', title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> },
  ],
};
