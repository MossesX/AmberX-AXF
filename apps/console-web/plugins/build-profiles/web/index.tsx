/**
 * Build profiles console plugin (ai.amberx.axf.console.build-profiles).
 *
 * Pick and save the build profile the console works on. A build profile (build-profiles@1) is one complete set of
 * work data: plan (+ media), build queue, pending builds, catalog status + tracker, and the Build orchestrator's
 * builds. The profiles are framework data, resolved by framework/cli/persist.mjs (dataPath) and managed by
 * framework/cli/profiles.mjs; the console serves them at GET/POST /api/profiles. This plugin is only the face:
 *
 *   - banner chip (framework `status` widget, own asset status/build-profile) with the profile in force; tap = picker
 *   - dialog `build-profiles` (action `build-profiles.open`): every profile with its counts, Use this one, New
 *     profile (empty or a copy), rename / describe, take off the list (its data stays)
 *   - app menu (Builds → Build profile…, Plugins), right-click menu, Settings → Plugins → Build profiles
 *
 * Switching saves the pick for every device and session, then reloads the console so every view reads the new data.
 * Uninstalling removes the picker only; the profiles and their data stay.
 */
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import type { AxfRuntime } from '@console/axf/core';
import { Button, Chip, Icon, Note, Switch, TextField, useRuntime } from '@console/axf/react';
import type { AxfWebLibrary } from '@console/axf/react/library';
import { getToken, post } from '@console/api';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import './build-profiles.css';
import { appMenu } from './menu';

const ID = 'ai.amberx.axf.console.build-profiles';
const FOLDER = 'build-profiles';
const DIALOG = 'build-profiles';
const ASSET_ID = 'build-profile';
const COUNTER = 'build.profile.known';
const SHOW_KEY = 'build-profiles.show';
const RELOAD_KEY = 'build-profiles.reload';
export const PROFILE_CHANGED = 'axf:profile-changed';

interface Counts { pending: number | null; plan: number | null; queue: number | null; orchestrator: number | null; tracked: number | null }
interface Profile { id: string; name: string; description?: string; base: boolean; catalog: boolean; copiedFrom?: string; createdAt?: string; counts: Counts; files: Record<string, string> }
interface State { ok?: boolean; active: string; effective: string; dataRoot: string; profiles: Profile[]; error?: string }

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

/** Repaint the banner chip (a framework status widget) and attach it, or take it off when hidden. */
function paint(rt: AxfRuntime) {
  const p = current();
  const text = p ? `Profile: ${p.name}` : 'Profile: …';
  rt.registry.register({
    $axf: 'asset@1', type: 'status', id: ASSET_ID, name: 'Build profile', version: '0.1.0', author: 'Build profiles plugin',
    description: 'The build profile the console works on (plan, queue, pending builds, tracking). Tap to switch.', tags: ['builds', 'status'],
    data: { counter: COUNTER, onLabel: text, offLabel: text, onTone: p && !p.base ? 'accent' : 'muted', offTone: 'muted', dot: true, link: 'build-profiles.open' },
  }, 'app', ID);
  rt.setBadge(COUNTER, p ? 1 : 0);
  if (rt.settings.get(SHOW_KEY) !== false) rt.attachToBanner({ type: 'status', id: ASSET_ID, at: 'left', order: 20, origin: ID });
  else rt.detachFromBanner(`status:${ASSET_ID}`);
}

async function change(rt: AxfRuntime, body: Record<string, unknown>, done: string): Promise<boolean> {
  const r = await post('profiles', body);
  if (!r.ok) { rt.toast(String(r.error ?? 'Could not change build profiles.'), 'danger', 'Build profiles'); return false; }
  await loadProfiles();
  rt.toast(done, 'success', 'Build profiles');
  return true;
}

/** Make `p` the saved profile, tell every view, and (by default) reload so every page reads its data. */
async function use(rt: AxfRuntime, p: Profile) {
  if (!(await change(rt, { action: 'select', id: p.id }, `Now working on ${p.name}.`))) return;
  for (const ev of [PROFILE_CHANGED, 'axf:pending-changed', 'axf:plan-changed']) globalThis.dispatchEvent(new CustomEvent(ev, { detail: { id: p.id } }));
  if (rt.settings.get(RELOAD_KEY) !== false) setTimeout(() => globalThis.location?.reload(), 700);
}

/* ---------------- picker ---------------- */

const n = (v: number | null) => (v === null ? '–' : String(v));

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
        <span className="axp-build-profiles__name"><Icon name="layers" size={14} /> {p.name}</span>
        {p.base && <Chip>base</Chip>}
        {inForce && <Chip tone="accent">in use</Chip>}
        {saved && !inForce && <Chip tone="warning">saved pick (this session overrides)</Chip>}
      </div>
      {p.description && <p className="fx-small fx-muted axp-build-profiles__desc">{p.description}</p>}
      <p className="fx-small axp-build-profiles__counts">
        {n(p.counts.pending)} pending · {n(p.counts.orchestrator)} orchestrator builds · {n(p.counts.queue)} queue steps · {n(p.counts.plan)} plan entries · {n(p.counts.tracked)} tracked
      </p>
      {edit ? (
        <div className="fx-stack">
          <TextField label="Name" value={name} onChange={setName} />
          <TextField label="Description" value={desc} onChange={setDesc} rows={2} />
          <Switch label="Plan rebuilds import the framework's seed + feature catalog" checked={p.catalog}
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
          <Button tone={inForce ? 'neutral' : 'primary'} icon="check" disabled={saved} onClick={() => void use(rt, p)}>{saved ? 'Saved pick' : 'Use this one'}</Button>
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
          {state.profiles.map((p) => <Button key={p.id} tone={from === p.id ? 'primary' : 'ghost'} onClick={() => setFrom(p.id)}>Copy of {p.name}</Button>)}
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
  const s = useProfiles();
  useEffect(() => { void loadProfiles(); }, []);
  if (!s.data) return <div className="axp-build-profiles">{s.error ? <Note tone="warning">{s.error}</Note> : <p className="fx-muted">Loading build profiles…</p>}</div>;
  return (
    <div className="fx-stack axp-build-profiles">
      <p className="fx-small fx-muted" style={{ margin: 0 }}>
        Each profile has its own plan, build queue, pending builds, tracking and orchestrator builds. The pick is saved for every device and session.
      </p>
      {s.error && <Note tone="warning">{s.error}</Note>}
      <ul className="axp-build-profiles__list">{s.data.profiles.map((p) => <ProfileRow key={p.id} p={p} state={s.data!} />)}</ul>
      <NewProfile state={s.data} />
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
      <div className="fx-row fx-row--wrap"><Button tone="primary" icon="layers" onClick={() => rt.openDialog(DIALOG)}>Switch or manage profiles</Button></div>
      <Switch label="Show the profile on the banner" checked={show} onChange={(on) => flip(SHOW_KEY, on, setShow)} />
      <Switch label="Reload the console after switching" hint="Every page then reads the new profile's data." checked={reload} onChange={(on) => flip(RELOAD_KEY, on, setReload)} />
      <p className="fx-small fx-muted" style={{ margin: 0 }}>
        CLI: <span className="fx-mono">node framework/cli/profiles.mjs [select &lt;id&gt; | create "&lt;name&gt;" | where]</span>. A session can work on another profile without changing the pick: <span className="fx-mono">AXF_BUILD_PROFILE=&lt;id&gt;</span>.
      </p>
    </div>
  );
}

export const plugin: AxfWebLibrary = {
  id: ID, // equals plugin.json "id"
  label: 'Build profiles',
  version: '0.1.0',
  appMenu,
  register(rt) {
    runtime = rt;
    rt.actions.register('build-profiles.open', () => rt.openDialog(DIALOG), { label: 'Build profiles' });
    paint(rt);
    void loadProfiles();
  },
  dialogs: {
    [DIALOG]: { title: 'Build profiles', icon: 'layers', render: () => <Picker /> },
  },
  contextMenu: [
    { id: 'build-profiles.default', target: 'default', order: 92, items: [{ id: 'build-profiles', label: 'Build profile…', icon: 'layers', action: 'build-profiles.open' }] },
  ],
  settingsTabs: [{ id: 'build-profiles', label: 'Build profiles', icon: 'layers', order: 7, parent: 'plugins' }],
  settingsPanels: [
    { id: 'build-profiles.main', tab: 'build-profiles', title: 'Build profiles', icon: 'layers', order: 5, render: () => <SettingsPanel /> },
    { id: 'build-profiles.lifecycle', tab: 'build-profiles', title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> },
  ],
};
