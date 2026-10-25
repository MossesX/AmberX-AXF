/**
 * Plugins per app (patches-app-plugins@1): one grid, a row per plugin Patches knows and a column per app in its tabs,
 * a tick box in each cell = installed in that app or not. **Apply** installs or uninstalls each changed box in the app
 * itself (server/app_plugins.py: the Console through its plugin catalog + lifecycle routes, Pilot through its own
 * plugin-catalog routes, axHub's web plugins through the Console, which commits them for axhub-web; an app Patches can't
 * reach shows its column read-only, and a locked box says why). A plugin bundled with Pilot can't be uninstalled, so its
 * box is Pilot's on / off switch instead (Gizmo: "disable locked-in plugins from the matrix"). Gizmo, Oct 24–25 2026.
 */
import { Fragment, useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { Button, Checkbox, Icon, IconButton, ModelBadge, Note, Segmented, SelectField, Switch, useRuntime, type AxfWebLibrary } from './axf/react';
import { api } from './api';
import { arrange, changedFromDefault, DEFAULT_FILTER, installedCount, installedNowhere, modelsOf, readFilter, type AppRule, type PluginFilter, type Show, type SortKey } from './pluginFilter';

export const APP_PLUGINS_VIEW = 'app-plugins';
export const APP_PLUGINS_FILTER_DIALOG = 'patches.app-plugins.filter';

type Cell = { installed: boolean | null; canChange: boolean; why: string; switch?: boolean };
type Row = { id: string; folder: string; name: string; version: string; model: string; sources: string[]; banner?: boolean; cells: Record<string, Cell> };
type Col = { app: string; label: string; reachable: boolean; canInstall: boolean; reason: string };
type JobItem = { app: string; id: string; name: string; install: boolean; switch?: boolean; delete?: boolean; state: 'queued' | 'running' | 'done' | 'failed'; note: string };
type Job = { id: string; state: 'running' | 'done' | 'partial'; startedAt: string; finishedAt: string; items: JobItem[] };
type Grid = { apps: Col[]; plugins: Row[]; at: string; job: Job | null };

/** The wanted state per cell (`<app>|<plugin id>`), only where it differs from what the app has. */
export type Wanted = Record<string, boolean>;
export const cellKey = (app: string, id: string) => `${app}|${id}`;

/** Cells marked for a full uninstall (a plugin bundled with its app: its code is deleted from the app's repo). */
export type Deletes = Record<string, true>;

/** The changes Apply sends: every ticked/unticked box that differs from the app and may be changed, and every delete. */
export function changesOf(grid: Pick<Grid, 'plugins'>, wanted: Wanted, deletes: Deletes = {}): { app: string; id: string; install: boolean; delete?: true }[] {
  const out: { app: string; id: string; install: boolean; delete?: true }[] = [];
  for (const r of grid.plugins) for (const [app, c] of Object.entries(r.cells)) {
    const k = cellKey(app, r.id);
    if (deletes[k] && c.switch) { out.push({ app, id: r.id, install: false, delete: true }); continue; }
    const w = wanted[k];
    if (w !== undefined && c.canChange && c.installed !== w) out.push({ app, id: r.id, install: w });
  }
  return out;
}

/* one store for the view + the menu badge */
type View = { grid: Grid | null; error: string; loading: boolean };
let view: View = { grid: null, error: '', loading: false };
const subs = new Set<() => void>();
const set = (next: Partial<View>) => { view = { ...view, ...next }; subs.forEach((f) => f()); };
const useView = () => useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => view);

async function load(): Promise<void> {
  set({ loading: true });
  const r = await api<Grid>('/app-plugins');
  if (r.ok && r.data) set({ grid: r.data, error: '', loading: false });
  else set({ error: r.error || 'the plugin grid could not be read', loading: false });
}

let polling: ReturnType<typeof setTimeout> | null = null;
/** Follow a running Apply every 2 s, then read the grid again. */
function follow(): void {
  if (polling) return;
  const tick = async () => {
    const r = await api<{ job: Job | null }>('/app-plugins/apply');
    if (r.ok && r.data && view.grid) set({ grid: { ...view.grid, job: r.data.job } });
    if (r.ok && r.data?.job?.state === 'running') { polling = setTimeout(() => void tick(), 2000); return; }
    polling = null;
    await load();
  };
  polling = setTimeout(() => void tick(), 1000);
}

/* search, filters + sort: one store for the view and the Advanced dialog, kept per browser */
const FILTER_KEY = 'patches.app-plugins.filter';
let filter: PluginFilter = (() => { try { return readFilter(JSON.parse(localStorage.getItem(FILTER_KEY) ?? 'null')); } catch { return readFilter(null); } })();
const fsubs = new Set<() => void>();
const setFilter = (next: Partial<PluginFilter>) => {
  filter = { ...filter, ...next };
  try { localStorage.setItem(FILTER_KEY, JSON.stringify(filter)); } catch { /* private window: this visit only */ }
  fsubs.forEach((f) => f());
};
const useFilter = () => useSyncExternalStore((f) => { fsubs.add(f); return () => fsubs.delete(f); }, () => filter);
/** cells ticked but not applied yet (for Show: changed), shared with the dialog */
let pendingKeys = new Set<string>();

const SHOW: { value: Show; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'installed', label: 'Installed' },
  { value: 'nowhere', label: 'Not installed' },
  { value: 'changed', label: 'Changed' },
];
const SORTS: { value: SortKey; label: string }[] = [
  { value: 'name', label: 'Name' },
  { value: 'apps', label: 'Installed in most apps' },
  { value: 'model', label: 'Model' },
  { value: 'source', label: 'Where it comes from' },
  { value: 'id', label: 'Plugin id' },
];

/** Advanced search & filter: every filter, sort and the "not installed at the bottom" switch. */
export function AppPluginsFilterDialog() {
  const f = useFilter();
  const v = useView();
  const rows = v.grid?.plugins ?? [];
  const apps = (v.grid?.apps ?? []).filter((a) => a.app !== 'patches');
  const models = modelsOf(rows);
  const toggle = (list: string[], x: string, on: boolean) => (on ? [...new Set([...list, x])] : list.filter((y) => y !== x));
  const shown = v.grid ? arrange(rows, f, (r) => [...pendingKeys].some((k) => k.endsWith(`|${r.id}`))).length : 0;
  return (
    <div className="fx-stack axp-ap__adv">
      <input className="fx-input" placeholder="Search plugins" value={f.text} onChange={(e) => setFilter({ text: e.target.value })} aria-label="Search plugins" />
      <fieldset className="axp-ap__set">
        <legend>Search in</legend>
        {(['name', 'id', 'folder', 'version'] as const).map((k) => (
          <Checkbox key={k} checked={f.fields[k]} onChange={(x) => setFilter({ fields: { ...f.fields, [k]: x } })} label={{ name: 'Name', id: 'Plugin id', folder: 'Folder', version: 'Version' }[k]} />
        ))}
      </fieldset>
      <Segmented label="Show" value={f.show} options={SHOW} onChange={(show) => setFilter({ show })} />
      {apps.length > 0 && (
        <fieldset className="axp-ap__set">
          <legend>Per app</legend>
          {apps.map((a) => (
            <SelectField key={a.app} label={a.label} value={f.apps[a.app] ?? 'any'}
              options={[{ value: 'any', label: 'Any' }, { value: 'yes', label: 'Installed' }, { value: 'no', label: 'Not installed' }]}
              onChange={(x) => setFilter({ apps: { ...f.apps, [a.app]: x as AppRule } })} />
          ))}
        </fieldset>
      )}
      {models.length > 0 && (
        <fieldset className="axp-ap__set">
          <legend>Built with (none ticked = every model)</legend>
          {models.map((m) => <Checkbox key={m || '-'} checked={f.models.includes(m)} onChange={(x) => setFilter({ models: toggle(f.models, m, x) })} label={m ? m[0]!.toUpperCase() + m.slice(1) : 'Not recorded'} />)}
        </fieldset>
      )}
      <fieldset className="axp-ap__set">
        <legend>Comes from (none ticked = anywhere)</legend>
        {(['installed', 'catalog', 'patches'] as const).map((s) => (
          <Checkbox key={s} checked={f.sources.includes(s)} onChange={(x) => setFilter({ sources: toggle(f.sources, s, x) })} label={{ installed: 'Installed in an app', catalog: 'An app\'s plugin catalog', patches: 'Patches\' own list' }[s]} />
        ))}
      </fieldset>
      <Segmented label="Banner plugins" value={f.banners} options={[{ value: 'any', label: 'Any' }, { value: 'only', label: 'Only banners' }, { value: 'none', label: 'No banners' }]} onChange={(banners) => setFilter({ banners })} />
      <Switch label="Only plugins I can change" checked={f.changeableOnly} onChange={(changeableOnly) => setFilter({ changeableOnly })} />
      <SelectField label="Sort by" value={f.sort} options={SORTS} onChange={(x) => setFilter({ sort: x as SortKey })} />
      <Switch label="Reverse order" checked={f.desc} onChange={(desc) => setFilter({ desc })} />
      <Switch label="Plugins not installed in any app go to the bottom" checked={f.nowhereLast} onChange={(nowhereLast) => setFilter({ nowhereLast })} />
      <div className="fx-row axp-ap__bar">
        <span className="fx-muted">{shown} of {rows.length} plugins shown</span>
        <Button size="sm" icon="refresh" disabled={!changedFromDefault(f)} onClick={() => setFilter({ ...DEFAULT_FILTER, fields: { ...DEFAULT_FILTER.fields }, apps: {} })}>Reset</Button>
      </div>
    </div>
  );
}

const stateIcon: Record<JobItem['state'], string> = { queued: 'clock', running: 'refresh', done: 'check', failed: 'alert' };

export function AppPluginsView() {
  const rt = useRuntime();
  const v = useView();
  const [wanted, setWanted] = useState<Wanted>({});
  const [deletes, setDeletes] = useState<Deletes>({});
  const [delArmed, setDelArmed] = useState('');
  const [armed, setArmed] = useState(false);
  const f = useFilter();
  useEffect(() => { void load().then(() => { if (view.grid?.job?.state === 'running') follow(); }); }, []);
  const g = v.grid;
  const running = g?.job?.state === 'running';
  const changes = g ? changesOf(g, wanted, deletes) : [];
  const tick = useCallback((app: string, id: string, on: boolean) => { setArmed(false); setWanted((w) => ({ ...w, [cellKey(app, id)]: on })); }, []);
  const apply = async () => {
    if (!armed) { setArmed(true); return; }
    setArmed(false);
    const r = await api<{ job: Job | null; note?: string }>('/app-plugins/apply', { method: 'POST', body: JSON.stringify({ confirm: 'apply', changes }) });
    if (!r.ok) { rt.toast(r.error || 'Apply failed.', 'danger', 'Plugins per app'); return; }
    setWanted({});
    setDeletes({});
    if (r.data?.note) rt.toast(r.data.note, 'info', 'Plugins per app');
    if (g && r.data) set({ grid: { ...g, job: r.data.job } });
    if (r.data?.job?.state === 'running') follow();
  };
  pendingKeys = new Set([...Object.keys(wanted).filter((k) => { const [a, id] = k.split('|'); return g?.plugins.find((r) => r.id === id)?.cells[a!]?.installed !== wanted[k]; }), ...Object.keys(deletes)]);
  const isChanged = (r: Row) => [...pendingKeys].some((k) => k.endsWith(`|${r.id}`));
  const all = g?.plugins ?? [];
  const rows = arrange(all, f, (r) => isChanged(r as Row));
  const firstNowhere = f.nowhereLast ? rows.findIndex(installedNowhere) : -1;
  const badge = changedFromDefault({ ...f, text: '', show: 'all', sort: 'name', desc: false });
  return (
    <div className="fx-stack axp-ap">
      <p className="fx-muted" style={{ margin: 0 }}>Every plugin Patches knows, one column per app in the tabs. Tick a box to install the plugin in that app, untick it to remove it, then Apply. For a plugin built into the app (marked with the sliders icon) the box switches it on or off instead; its bin (tap twice) uninstalls it completely by deleting its code from the app's repo. Each app installs from its own plugin catalog; nothing runs through Patches.</p>
      {v.error && <Note tone="danger">{v.error}</Note>}
      {g?.apps.filter((a) => !a.reachable || !a.canInstall).map((a) => <Note key={a.app} tone={a.reachable ? 'warning' : 'info'}><strong>{a.label}:</strong> {a.reason}{a.reachable ? '' : ' (its column is read-only)'}</Note>)}
      <div className="fx-row axp-ap__bar">
        <input className="fx-input axp-ap__search" placeholder="Search plugins" value={f.text} onChange={(e) => setFilter({ text: e.target.value })} aria-label="Search plugins" />
        <Segmented size="sm" label="Show" value={f.show} options={SHOW} onChange={(show) => setFilter({ show })} />
        <select className="fx-input axp-ap__sort" aria-label="Sort by" value={f.sort} onChange={(e) => setFilter({ sort: e.target.value as SortKey })}>
          {SORTS.map((s) => <option key={s.value} value={s.value}>Sort: {s.label}</option>)}
        </select>
        <IconButton icon={f.desc ? 'chevron-up' : 'chevron-down'} label={f.desc ? 'Reverse order (on)' : 'Reverse order'} onClick={() => setFilter({ desc: !f.desc })} />
        <Button size="sm" icon="sliders" onClick={() => rt.openDialog(APP_PLUGINS_FILTER_DIALOG)}>Advanced{badge ? ` (${badge})` : ''}</Button>
        <Button size="sm" icon="refresh" disabled={v.loading || running} onClick={() => void load()}>Reload</Button>
        <Button size="sm" disabled={!changes.length || running} onClick={() => { setWanted({}); setDeletes({}); setArmed(false); }}>Undo ticks</Button>
        <Button size="sm" icon="check" tone={armed ? 'danger' : 'primary'} disabled={!changes.length || running} onClick={() => void apply()}>
          {running ? 'Applying…' : armed ? `Tap again: change ${changes.length}${changes.some((c) => c.delete) ? ' (deletes code)' : ''}` : `Apply${changes.length ? ` (${changes.length})` : ''}`}
        </Button>
      </div>
      {g && <p className="fx-muted axp-ap__count">{rows.length} of {all.length} plugins{rows.length < all.length ? ' (filtered)' : ''}</p>}
      {!g && !v.error && <p className="fx-muted">Loading…</p>}
      {g && (
        <div className="axp-ap__wrap">
          <table className="fx-table axp-ap__grid">
            <thead>
              <tr>
                <th scope="col">Plugin</th>
                {g.apps.map((a) => <th key={a.app} scope="col" title={a.reason || undefined}>{a.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <Fragment key={r.id}>
                {i === firstNowhere && (
                  <tr className="axp-ap__divider"><td colSpan={g.apps.length + 1} className="fx-muted"><Icon name="package" size={12} /> Not installed in any app in the tabs ({rows.length - firstNowhere})</td></tr>
                )}
                <tr>
                  <th scope="row" className="axp-ap__name">
                    <span><strong>{r.name}</strong> <ModelBadge compact model={r.model || undefined} /></span>
                    <span className="fx-muted">{[r.id, r.version, installedCount(r) ? `in ${installedCount(r)} app${installedCount(r) === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · ')}</span>
                  </th>
                  {g.apps.map((a) => {
                    const c = r.cells[a.app];
                    if (!c) return <td key={a.app} />;
                    const k = cellKey(a.app, r.id);
                    const w = wanted[k];
                    const on = w ?? c.installed === true;
                    const changed = (w !== undefined && w !== c.installed) || !!deletes[k];
                    return (
                      <td key={a.app} className={`axp-ap__cell ${changed ? 'is-changed' : ''}`}>
                        {c.switch && <Icon name="sliders" size={12} />}
                        {c.installed === null
                          ? <span className="fx-muted" title={c.why}>?</span>
                          : deletes[k]
                            ? <Button size="sm" tone="danger" icon="trash" disabled={running} title="Marked: Apply deletes this plugin's code from the app's repo. Tap to unmark." onClick={() => { setArmed(false); setDeletes(({ [k]: _, ...rest }) => rest); }}>Delete</Button>
                            : <Checkbox checked={on} disabled={!c.canChange || running} title={c.why || `${on ? 'Installed in' : 'Not in'} ${a.label}`} onChange={(x) => tick(a.app, r.id, x)} label={<span className="axp-ap__sr">{r.name} in {a.label}</span>} />}
                        {c.switch && !deletes[k] && (
                          <IconButton icon="trash" label={delArmed === k ? `Tap again to mark ${r.name} for deletion` : `Uninstall completely: delete ${r.name}'s code from ${a.label}`} className={delArmed === k ? 'is-armed' : ''} disabled={running}
                            onClick={() => { if (delArmed !== k) { setDelArmed(k); return; } setDelArmed(''); setArmed(false); setDeletes((d) => ({ ...d, [k]: true })); }} />
                        )}
                      </td>
                    );
                  })}
                </tr>
                </Fragment>
              ))}
              {!rows.length && <tr><td colSpan={g.apps.length + 1} className="fx-muted">{all.length ? 'No plugin matches.' : 'No plugins yet.'}</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      {g?.job && (
        <section className="fx-stack">
          <h3 className="pt-plugins__head"><Icon name="list" size={14} /> Last Apply · {g.job.state === 'running' ? 'running' : g.job.state === 'done' ? 'done' : 'finished, some failed'}</h3>
          <ul className="pt-addtab__list">
            {g.job.items.map((it) => (
              <li key={`${it.app}|${it.id}`} className="pt-addtab__row">
                <Icon name={stateIcon[it.state]} size={16} />
                <span className="pt-addtab__name"><strong>{it.delete ? 'Delete the code of' : it.switch ? (it.install ? 'Switch on' : 'Switch off') : it.install ? 'Install' : 'Uninstall'} {it.name} · {g.apps.find((a) => a.app === it.app)?.label ?? it.app}</strong>{it.note && <span className="fx-muted">{it.note}</span>}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

export const appPluginsLibrary: AxfWebLibrary = {
  id: 'ai.amberx.axf.patches.app-plugins',
  label: 'Plugins per app',
  version: '0.2.0',
  builtWith: { model: 'opus', builtAt: '2026-10-24' },
  dialogs: { [APP_PLUGINS_FILTER_DIALOG]: { title: 'Search & filter plugins', icon: 'sliders', render: () => <AppPluginsFilterDialog /> } },
  views: { [APP_PLUGINS_VIEW]: { title: 'Plugins per app', icon: 'package', keywords: ['plugins', 'install', 'uninstall', 'apps', 'grid'], render: () => <AppPluginsView /> } },
  register(rt) {
    rt.actions.register('patches.app-plugins', () => rt.navigate(APP_PLUGINS_VIEW), { label: 'Plugins per app…' });
  },
  appMenu: [{ id: 'patches.app-plugins.menu', menu: 'patches', items: [{ id: 'app-plugins', label: 'Plugins per app…', icon: 'package', action: 'patches.app-plugins' }] }],
  contextMenu: [{ id: 'patches.app-plugins.ctx', target: 'default', order: 2, items: [{ id: 'patches.app-plugins', label: 'Plugins per app…', icon: 'package', action: 'patches.app-plugins' }] }],
};
