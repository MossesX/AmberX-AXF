/**
 * Profile switcher console plugin (ai.amberx.axf.console.profile-switcher).
 *
 * Brett, Nov 3 2026: "a widget that can be attached to a toolbar or a banner or whatever, that lets you select their
 * build package. Also, select something that combines all build profiles." … "Basically make it a filter." … "it's
 * gonna act upon what's visible."
 *
 *   - the widget: a framework `status` asset (status/profile-switcher: dot + "Current · 10 open"), attached to the
 *     console toolbar by default and to the banner too when picked; every look value comes from the widget engines
 *   - tap it: a menu (the framework context menu, target `profile-switcher`): All profiles at the top, then every listed
 *     profile with its counts. Tapping a profile makes it the active one (new builds go there) and shows only it;
 *     "Show together" ticks several; All profiles = no filter (the active profile stays). Place: toolbar / banner.
 *   - right-click any toolbar or banner: "Profile switcher on this toolbar / banner" (attach anywhere)
 *   - the view filter itself is `@console/profileFilter` (profile-filter@1), which every builds table reads; this
 *     plugin keeps it in step with its server copy (the CLI / MCP default)
 *   - Settings → Plugins → Profile switcher: counts, compact/full, tones, hidden profiles and order, placements
 *   - Home: the Build profiles card (card@1 starter `build-profiles` on this plugin's profiles-list read, drawn by its
 *     own panel): every listed profile with running / queued / pending / built, the active one marked; tap a profile
 *     = show only it and open Builds; star = make it the active profile; + New profile and Manage (Brett, Nov 4 2026)
 */
import { useEffect, useSyncExternalStore } from 'react';
import type { AxfRuntime } from '@console/axf/core';
import { Button, Chip, Container, IconButton, Note, Segmented, SelectField, Switch, useRuntime } from '@console/axf/react';
import type { AxfWebLibrary } from '@console/axf/react/library';
import { pluginApi } from '@console/plugins';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import { LoadingSkeleton } from '@console/emptyState';
import { registerCardPanel } from '@console/cardPanels';
import { PROFILE_FILTER_KEY, readProfileFilter, setProfileTones, writeProfileFilter } from '@console/profileFilter';
import { filterLabel, isAll, PROFILE_TONES, type ProfileFilter } from '@console/axf/core/engines/profile-filter.mjs';
import './profile-switcher.css';

const ID = 'ai.amberx.axf.console.profile-switcher';
const FOLDER = 'profile-switcher';
const ASSET_ID = 'profile-switcher';
const TARGET = 'profile-switcher';
const COUNTER = 'profile-switcher.shown';
const on = (id: string) => `profile-switcher.on.${id}`;
const PLACED = (host: string) => `profile-switcher.placed.${host}`;
const api = pluginApi(FOLDER, 'Profile switcher', { unavailable: 'The Profile switcher is switched off or its server part is not running.' });

type Tone = typeof PROFILE_TONES[number];
interface Counts { builds: number; open: number; running: number; queued: number; pending: number; built: number; complete: number }
interface ProfileV { id: string; name: string; description: string; base: boolean; tone: Tone; counts: Counts }
interface Settings { counts: boolean; mode: 'full' | 'compact'; hidden: string[]; order: string[]; tones: Record<string, Tone>; placements: ('toolbar' | 'banner')[] }
interface ListV { ok: boolean; error?: string; active: string; effective: string; filter: ProfileFilter; label: string; hidden: number; total: Counts; listed: string[]; profiles: ProfileV[]; settings: Settings; log?: string[] }

/* ---------------- store ---------------- */

let st: { data: ListV | null; error: string } = { data: null, error: '' };
const subs = new Set<() => void>();
const set = (p: Partial<typeof st>) => { st = { ...st, ...p }; subs.forEach((f) => f()); };
const useSwitcher = () => useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => st);
let runtime: AxfRuntime | null = null;
let syncing = false;

/** Take the server's answer: profiles, counts, settings; its filter becomes the console's (CLI / MCP changes show here). */
function take(rt: AxfRuntime, r: ListV) {
  if (!r.ok) { set({ error: r.error ?? 'The profile switcher could not load.' }); return; }
  set({ data: r, error: '' });
  setProfileTones(r.settings.tones);
  syncing = true;
  try { writeProfileFilter(rt, r.filter); } finally { syncing = false; }
  paint(rt);
}

export async function load(rt: AxfRuntime) {
  try { take(rt, await api.call<ListV>('profiles')); } catch (e) { set({ error: (e as Error).message }); paint(rt); }
}

async function send(rt: AxfRuntime, path: string, body: Record<string, unknown>, done?: string) {
  try {
    const r = await api.post<ListV>(path, body);
    if (!r.ok) throw new Error(r.error);
    take(rt, r);
    if (done) rt.toast(done, 'success', 'Profiles');
    return true;
  } catch (e) { rt.toast((e as Error).message, 'danger', 'Profiles'); return false; }
}

const listed = (d: ListV) => d.listed.map((id) => d.profiles.find((p) => p.id === id)).filter((p): p is ProfileV => !!p);
const countText = (c: Counts) => `${c.open} open${c.running ? ` · ${c.running} running` : ''}`;
const widgetTone = (t: Tone) => (t === 'neutral' ? 'neutral' : t);

/** The chip's text: what the view shows (the filter), with its open count. */
function chipText(d: ListV | null): { text: string; tone: string } {
  if (!d) return { text: 'Profiles: …', tone: 'muted' };
  const f = readProfileFilter(runtime!);
  const s = d.settings;
  const shown = isAll(f) ? d.profiles : d.profiles.filter((p) => f.ids.includes(p.id));
  const open = shown.reduce((n, p) => n + p.counts.open, 0);
  const one = !isAll(f) && f.ids.length === 1 ? d.profiles.find((p) => p.id === f.ids[0]) : null;
  const label = isAll(f) ? (s.mode === 'compact' ? 'All' : 'All profiles') : s.mode === 'compact' && one ? one.name : filterLabel(f, d.profiles);
  return { text: s.counts ? `${label} · ${open}` : label, tone: one ? widgetTone(one.tone) : isAll(f) ? 'neutral' : 'accent' };
}

/** Repaint the widget (a framework status asset), its counters and where it is attached. */
function paint(rt: AxfRuntime) {
  const d = st.data;
  const { text, tone } = chipText(d);
  const f = readProfileFilter(rt);
  rt.registry.register({
    $axf: 'asset@1', type: 'status', id: ASSET_ID, name: 'Profile switcher', version: '0.1.0', author: 'Profile switcher plugin',
    description: 'Which build profiles every builds table shows (and the active profile new builds go to). Tap to switch or show several.', tags: ['builds', 'status', 'profiles'],
    data: { counter: COUNTER, onLabel: text, offLabel: text, onTone: tone, offTone: 'muted', dot: true, link: 'profile-switcher.open' },
  }, 'app', ID);
  rt.setBadge(COUNTER, d ? 1 : 0);
  rt.setBadge(on('all'), isAll(f) ? 1 : 0);
  for (const p of d?.profiles ?? []) rt.setBadge(on(p.id), !isAll(f) && f.ids.includes(p.id) ? 1 : 0);
  const places = d?.settings.placements ?? ['toolbar'];
  for (const host of ['toolbar', 'banner'] as const) {
    rt.setBadge(PLACED(host), places.includes(host) ? 1 : 0);
    if (!places.includes(host)) { rt.detachFromHost(host, `status:${ASSET_ID}`); continue; }
    if (host === 'toolbar') rt.attachToToolbar({ type: 'status', id: ASSET_ID, at: 'end', order: 5, origin: ID });
    else rt.attachToBanner({ type: 'status', id: ASSET_ID, at: 'left', order: 21, origin: ID });
  }
}

/* ---------------- the dropdown (framework context menu) ---------------- */

type Entry = { id: string; label?: string; icon?: string; action?: string; separator?: boolean; checked?: string; items?: Entry[] };
function menu(): Entry[] {
  const d = st.data;
  if (!d) return [{ id: 'psw-loading', label: st.error || 'Loading profiles…', icon: 'clock' }];
  const ps = listed(d);
  const active = d.effective;
  return [
    { id: 'psw-all', label: `All profiles · ${countText(d.total)}`, icon: 'layers', action: 'profile-switcher.show:all', checked: `counter:${on('all')}` },
    { id: 'psw-sep1', separator: true },
    ...ps.map((p) => ({ id: `psw-p-${p.id}`, label: `${p.name}${p.id === active ? ' (active)' : ''}${d.settings.counts ? ` · ${countText(p.counts)}` : ''}`, icon: p.id === active ? 'star' : 'box', action: `profile-switcher.use:${p.id}`, checked: `counter:${on(p.id)}` })),
    { id: 'psw-sep2', separator: true },
    { id: 'psw-together', label: 'Show together', icon: 'grid', items: ps.map((p) => ({ id: `psw-t-${p.id}`, label: p.name, action: `profile-switcher.toggle:${p.id}`, checked: `counter:${on(p.id)}` })) },
    { id: 'psw-place', label: 'Place', icon: 'move', items: [
      { id: 'psw-place-toolbar', label: 'On the toolbar', action: 'profile-switcher.place:toolbar', checked: `counter:${PLACED('toolbar')}` },
      { id: 'psw-place-banner', label: 'On the banner', action: 'profile-switcher.place:banner', checked: `counter:${PLACED('banner')}` },
    ] },
    { id: 'psw-manage', label: 'Manage profiles…', icon: 'settings', action: 'profile-switcher.manage' },
  ];
}

/** Where the last tap was, so the menu opens under the widget (actions carry no position). */
let lastTap = { x: 0, y: 0 };
const onTap = (e: PointerEvent) => {
  const el = (e.target as Element | null)?.closest?.('.fx-widget, .fx-status, button, a') as HTMLElement | null;
  const r = el?.getBoundingClientRect();
  lastTap = r ? { x: r.left, y: r.bottom + 4 } : { x: e.clientX, y: e.clientY };
};

/* ---------------- Home card: Build profiles ---------------- */

const CARD_ID = 'build-profiles';
const READ = 'profiles-list';
const COUNT_KINDS: { key: 'running' | 'queued' | 'pending' | 'built'; label: string; tone?: 'accent' | 'success' | 'warning' }[] = [
  { key: 'running', label: 'running', tone: 'accent' }, { key: 'queued', label: 'queued' }, { key: 'pending', label: 'pending', tone: 'warning' }, { key: 'built', label: 'built', tone: 'success' },
];

/** The starter card@1 asset: on Home by default (Home → Show all brings it back when hidden), gone with the plugin. */
function registerCard(rt: AxfRuntime) {
  rt.registry.register({
    $axf: 'asset@1', type: 'card', id: CARD_ID, name: 'Build profiles', version: '1.0.0', author: 'Profile switcher plugin',
    description: 'Every build profile with its running, queued, pending and built builds; tap one to show only it on the Builds page.', tags: ['home', 'starter', 'builds', 'profiles'],
    data: { title: 'Build profiles', icon: 'layers', source: { kind: 'command', plugin: FOLDER, command: READ }, view: 'panel', refresh: { kind: 'live' }, size: 'm' },
  }, 'app', ID);
}

function ProfileCounts({ c }: { c: Counts }) {
  const shown = COUNT_KINDS.filter((k) => c[k.key] > 0);
  if (!shown.length) return <span className="axp-profile-card__counts fx-small fx-muted">nothing open</span>;
  return <span className="axp-profile-card__counts">{shown.map((k) => <Chip key={k.key} tone={k.tone}>{c[k.key]} {k.label}</Chip>)}</span>;
}

export function BuildProfilesCard() {
  const rt = useRuntime();
  const s = useSwitcher();
  useEffect(() => { void load(rt); }, [rt]);
  const d = s.data;
  const open = (id: string) => {
    void send(rt, 'filter', { profiles: id }).then((ok) => { if (ok && !rt.dispatch('builds.open')) rt.navigate('builds'); });
  };
  const f = d?.filter;
  return (
    <Container title="Build profiles" icon="layers" className="fx-dcard axp-profile-card"
      actions={<IconButton icon="settings" label="Manage build profiles" onClick={() => rt.dispatch('profile-switcher.manage')} />}>
      {!d ? (s.error ? <p className="fx-dcard__note is-error">{s.error}</p> : <p className="fx-dcard__note">Loading…</p>) : (
        <>
          <ul className="axp-profile-card__list" aria-label="Build profiles">
            {listed(d).map((p) => {
              const active = p.id === d.effective;
              const showing = !!f && !isAll(f) && f.ids.includes(p.id);
              return (
                <li key={p.id} className="axp-profile-card__row" data-active={active || undefined} data-showing={showing || undefined}>
                  <Button tone={active ? 'primary' : 'ghost'} className="axp-profile-card__pick" title={`Show only ${p.name} on the Builds page`} onClick={() => open(p.id)}>
                    <span className="axp-profile-card__name">{p.name}{active && <span className="fx-small"> · active</span>}</span>
                  </Button>
                  <ProfileCounts c={p.counts} />
                  {!active && <IconButton icon="star" label={`Make ${p.name} the active profile (new builds go there)`} onClick={() => rt.dispatch(`profile-switcher.use:${p.id}`)} />}
                </li>
              );
            })}
          </ul>
          <div className="fx-row fx-row--wrap axp-profile-card__foot">
            <Button size="sm" icon="plus" onClick={() => { if (!rt.dispatch('build-profiles.new')) rt.dispatch('build-profiles.open'); }}>New profile</Button>
            <Button size="sm" tone="ghost" icon="settings" onClick={() => rt.dispatch('profile-switcher.manage')}>Manage</Button>
            {f && !isAll(f) && <Button size="sm" tone="ghost" icon="eye" onClick={() => rt.dispatch('profile-switcher.show:all')}>Show all</Button>}
          </div>
        </>
      )}
    </Container>
  );
}

/* ---------------- settings ---------------- */

function SettingsPanel() {
  const rt = useRuntime();
  const s = useSwitcher();
  useEffect(() => { void load(rt); }, [rt]);
  if (!s.data) return s.error ? <Note tone="warning">{s.error}</Note> : <LoadingSkeleton />;
  const d = s.data;
  const save = (patch: Partial<Settings>) => void send(rt, 'settings', patch).then(() => load(rt));
  const order = listed(d).map((p) => p.id);
  const move = (id: string, dir: -1 | 1) => { const i = order.indexOf(id); const j = i + dir; if (j < 0 || j >= order.length) return; const o = [...order]; [o[i], o[j]] = [o[j]!, o[i]!]; save({ order: o }); };
  return (
    <div className="fx-stack axp-profile-switcher">
      <p className="fx-small fx-muted axp-profile-switcher__p">
        Active profile (new builds go here): <strong>{d.profiles.find((p) => p.id === d.effective)?.name ?? d.effective}</strong> · showing: <strong>{d.label}</strong>{d.hidden ? ` · ${d.hidden} hidden` : ''}
      </p>
      <Switch label="Show open / running counts" checked={d.settings.counts} onChange={(v) => save({ counts: v })} />
      <Segmented label="Widget" value={d.settings.mode} onChange={(v) => save({ mode: v })} options={[{ value: 'full', label: 'Full' }, { value: 'compact', label: 'Compact' }]} />
      <div className="fx-row fx-row--wrap">
        <Switch label="On the toolbar" checked={d.settings.placements.includes('toolbar')} onChange={(v) => save({ placements: v ? [...new Set([...d.settings.placements, 'toolbar' as const])] : d.settings.placements.filter((x) => x !== 'toolbar') })} />
        <Switch label="On the banner" checked={d.settings.placements.includes('banner')} onChange={(v) => save({ placements: v ? [...new Set([...d.settings.placements, 'banner' as const])] : d.settings.placements.filter((x) => x !== 'banner') })} />
      </div>
      <ul className="axp-profile-switcher__list">
        {[...listed(d), ...d.profiles.filter((p) => d.settings.hidden.includes(p.id))].map((p) => {
          const hidden = d.settings.hidden.includes(p.id);
          return (
            <li key={p.id} className="axp-profile-switcher__row">
              <span className="axp-profile-switcher__name"><Chip tone={p.tone === 'neutral' ? undefined : p.tone}>{p.name}</Chip><span className="fx-small fx-muted">{countText(p.counts)}</span></span>
              <SelectField label="Colour" value={d.settings.tones[p.id] ?? ''} empty="Automatic" options={PROFILE_TONES.map((t) => ({ value: t, label: t }))}
                onChange={(v) => { const tones = { ...d.settings.tones }; if (v) tones[p.id] = v as Tone; else delete tones[p.id]; save({ tones }); }} />
              <Switch label="Listed" checked={!hidden} onChange={(v) => save({ hidden: v ? d.settings.hidden.filter((x) => x !== p.id) : [...d.settings.hidden, p.id] })} />
              {!hidden && <><IconButton icon="chevron-up" label={`Move ${p.name} up`} onClick={() => move(p.id, -1)} /><IconButton icon="chevron-down" label={`Move ${p.name} down`} onClick={() => move(p.id, 1)} /></>}
            </li>
          );
        })}
      </ul>
      <div className="fx-row fx-row--wrap">
        <Button tone="ghost" icon="layers" onClick={() => rt.dispatch('profile-switcher.manage')}>Manage profiles</Button>
        <Button tone="ghost" icon="eye" disabled={isAll(d.filter)} onClick={() => rt.dispatch('profile-switcher.show:all')}>Show all profiles</Button>
      </div>
      <p className="fx-small fx-muted axp-profile-switcher__p">
        CLI: <span className="fx-mono">node apps/console-web/plugins/profile-switcher/switcher.mjs list | current | select &lt;id|all&gt; | filter &lt;all|a,b&gt; | visible</span>; MCP and REST: profiles-list, profile-current, profile-select, profile-filter, profile-visible. Bulk commands act on what the filter shows unless given <span className="fx-mono">profiles</span>.
      </p>
    </div>
  );
}

export const plugin: AxfWebLibrary = {
  id: ID, // equals plugin.json "id"
  label: 'Profile switcher',
  version: '0.1.0',
  register(rt) {
    runtime = rt;
    const a = rt.actions;
    a.register('profile-switcher.open', () => { void load(rt); rt.openContext(lastTap.x, lastTap.y, TARGET); }, { label: 'Profile switcher' });
    a.register('profile-switcher.use', ([id = '']) => { if (id) void send(rt, 'select', { id }, `Working on ${st.data?.profiles.find((p) => p.id === id)?.name ?? id}: new builds go there, the view shows only it.`); }, { label: 'Work on a build profile', params: true });
    a.register('profile-switcher.show', ([id = 'all']) => void send(rt, 'filter', { profiles: id }), { label: 'Show build profiles', params: true });
    a.register('profile-switcher.toggle', ([id = '']) => { if (id) void send(rt, 'filter', { toggle: id }); }, { label: 'Show or hide one build profile', params: true });
    a.register('profile-switcher.place', ([host = 'toolbar']) => {
      const cur = st.data?.settings.placements ?? ['toolbar'];
      const next = cur.includes(host as 'toolbar') ? cur.filter((x) => x !== host) : [...cur, host];
      void send(rt, 'settings', { placements: next }).then(() => load(rt));
    }, { label: 'Place the profile switcher', params: true });
    a.register('profile-switcher.manage', () => { if (!rt.dispatch('build-profiles.open')) rt.dispatch('settings.open:profile-switcher'); }, { label: 'Manage build profiles' });
    rt.contextExtras.set(TARGET, () => menu() as never);
    // attach anywhere: right-click a toolbar or the banner
    rt.contextExtras.set('*:profile-switcher', (target) => (target === 'toolbar' || target === 'banner')
      ? [{ id: `psw-here-${target}`, label: `Profile switcher on this ${target}`, icon: 'layers', action: `profile-switcher.place:${target}`, checked: `counter:${PLACED(target)}` }] : []);
    addEventListener('pointerdown', onTap, true);
    // Home: the Build profiles card (starter asset + its own panel for this plugin's read)
    registerCard(rt);
    registerCardPanel(FOLDER, READ, () => <BuildProfilesCard />);
    // the filter changes in a table (Show all) or another tab: tell the server (CLI / MCP default) and repaint
    rt.settings.onChange(PROFILE_FILTER_KEY, () => {
      paint(rt);
      if (syncing) return;
      const f = readProfileFilter(rt);
      void api.post<ListV>('filter', { profiles: isAll(f) ? 'all' : f.ids.join(',') }).then((r) => { if (r.ok) set({ data: r }); });
    });
    for (const ev of ['axf:profile-changed', 'axf:pending-changed']) addEventListener(ev, () => void load(rt));
    paint(rt);
    void load(rt);
    setInterval(() => { if (document.visibilityState === 'visible') void load(rt); }, 30_000);
  },
  contextMenu: [
    { id: 'profile-switcher.default', target: 'default', order: 93, items: [{ id: 'profile-switcher', label: 'Show build profiles…', icon: 'layers', action: 'profile-switcher.open' }] },
  ],
  settingsTabs: [{ id: 'profile-switcher', label: 'Profile switcher', icon: 'layers', order: 8, parent: 'plugins' }],
  settingsPanels: [
    { id: 'profile-switcher.main', tab: 'profile-switcher', title: 'Profile switcher', icon: 'layers', order: 5, render: () => <SettingsPanel /> },
    { id: 'profile-switcher.lifecycle', tab: 'profile-switcher', title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> },
  ],
};
