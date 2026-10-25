/**
 * Plugins per app (patches-app-plugins@1): one grid, a row per plugin Patches knows and a column per app in its tabs,
 * a tick box in each cell = installed in that app or not. **Apply** installs or uninstalls each changed box in the app
 * itself (server/app_plugins.py: the Console through its plugin catalog + lifecycle routes; apps Patches can't install
 * into yet show their column read-only, with why). Gizmo, Oct 24 2026.
 */
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { Button, Checkbox, Icon, ModelBadge, Note, useRuntime, type AxfWebLibrary } from './axf/react';
import { api } from './api';

export const APP_PLUGINS_VIEW = 'app-plugins';

type Cell = { installed: boolean | null; canChange: boolean; why: string };
type Row = { id: string; folder: string; name: string; version: string; model: string; sources: string[]; cells: Record<string, Cell> };
type Col = { app: string; label: string; reachable: boolean; canInstall: boolean; reason: string };
type JobItem = { app: string; id: string; name: string; install: boolean; state: 'queued' | 'running' | 'done' | 'failed'; note: string };
type Job = { id: string; state: 'running' | 'done' | 'partial'; startedAt: string; finishedAt: string; items: JobItem[] };
type Grid = { apps: Col[]; plugins: Row[]; at: string; job: Job | null };

/** The wanted state per cell (`<app>|<plugin id>`), only where it differs from what the app has. */
export type Wanted = Record<string, boolean>;
export const cellKey = (app: string, id: string) => `${app}|${id}`;

/** The changes Apply sends: every ticked/unticked box that differs from the app and may be changed. */
export function changesOf(grid: Pick<Grid, 'plugins'>, wanted: Wanted): { app: string; id: string; install: boolean }[] {
  const out: { app: string; id: string; install: boolean }[] = [];
  for (const r of grid.plugins) for (const [app, c] of Object.entries(r.cells)) {
    const w = wanted[cellKey(app, r.id)];
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

const stateIcon: Record<JobItem['state'], string> = { queued: 'clock', running: 'refresh', done: 'check', failed: 'alert' };

export function AppPluginsView() {
  const rt = useRuntime();
  const v = useView();
  const [wanted, setWanted] = useState<Wanted>({});
  const [armed, setArmed] = useState(false);
  const [filter, setFilter] = useState('');
  useEffect(() => { void load().then(() => { if (view.grid?.job?.state === 'running') follow(); }); }, []);
  const g = v.grid;
  const running = g?.job?.state === 'running';
  const changes = g ? changesOf(g, wanted) : [];
  const tick = useCallback((app: string, id: string, on: boolean) => { setArmed(false); setWanted((w) => ({ ...w, [cellKey(app, id)]: on })); }, []);
  const apply = async () => {
    if (!armed) { setArmed(true); return; }
    setArmed(false);
    const r = await api<{ job: Job | null; note?: string }>('/app-plugins/apply', { method: 'POST', body: JSON.stringify({ confirm: 'apply', changes }) });
    if (!r.ok) { rt.toast(r.error || 'Apply failed.', 'danger', 'Plugins per app'); return; }
    setWanted({});
    if (r.data?.note) rt.toast(r.data.note, 'info', 'Plugins per app');
    if (g && r.data) set({ grid: { ...g, job: r.data.job } });
    if (r.data?.job?.state === 'running') follow();
  };
  const rows = (g?.plugins ?? []).filter((r) => !filter || `${r.name} ${r.id}`.toLowerCase().includes(filter.toLowerCase()));
  return (
    <div className="fx-stack axp-ap">
      <p className="fx-muted" style={{ margin: 0 }}>Every plugin Patches knows, one column per app in the tabs. Tick a box to install the plugin in that app, untick it to remove it, then Apply. Each app installs from its own plugin catalog; nothing runs through Patches.</p>
      {v.error && <Note tone="danger">{v.error}</Note>}
      {g?.apps.filter((a) => !a.reachable || !a.canInstall).map((a) => <Note key={a.app} tone={a.reachable ? 'warning' : 'info'}><strong>{a.label}:</strong> {a.reason}{a.reachable ? '' : ' (its column is read-only)'}</Note>)}
      <div className="fx-row axp-ap__bar">
        <input className="fx-input axp-ap__search" placeholder="Filter plugins" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter plugins" />
        <Button size="sm" icon="refresh" disabled={v.loading || running} onClick={() => void load()}>Reload</Button>
        <Button size="sm" disabled={!changes.length || running} onClick={() => { setWanted({}); setArmed(false); }}>Undo ticks</Button>
        <Button size="sm" icon="check" tone={armed ? 'danger' : 'primary'} disabled={!changes.length || running} onClick={() => void apply()}>
          {running ? 'Applying…' : armed ? `Tap again: change ${changes.length}` : `Apply${changes.length ? ` (${changes.length})` : ''}`}
        </Button>
      </div>
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
              {rows.map((r) => (
                <tr key={r.id}>
                  <th scope="row" className="axp-ap__name">
                    <span><strong>{r.name}</strong> <ModelBadge compact model={r.model || undefined} /></span>
                    <span className="fx-muted">{[r.id, r.version].filter(Boolean).join(' · ')}</span>
                  </th>
                  {g.apps.map((a) => {
                    const c = r.cells[a.app];
                    if (!c) return <td key={a.app} />;
                    const w = wanted[cellKey(a.app, r.id)];
                    const on = w ?? c.installed === true;
                    const changed = w !== undefined && w !== c.installed;
                    return (
                      <td key={a.app} className={`axp-ap__cell ${changed ? 'is-changed' : ''}`}>
                        {c.installed === null
                          ? <span className="fx-muted" title={c.why}>?</span>
                          : <Checkbox checked={on} disabled={!c.canChange || running} title={c.why || `${on ? 'Installed in' : 'Not in'} ${a.label}`} onChange={(x) => tick(a.app, r.id, x)} label={<span className="axp-ap__sr">{r.name} in {a.label}</span>} />}
                      </td>
                    );
                  })}
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={g.apps.length + 1} className="fx-muted">{filter ? 'No plugin matches.' : 'No plugins yet.'}</td></tr>}
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
                <span className="pt-addtab__name"><strong>{it.install ? 'Install' : 'Uninstall'} {it.name} · {g.apps.find((a) => a.app === it.app)?.label ?? it.app}</strong>{it.note && <span className="fx-muted">{it.note}</span>}</span>
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
  version: '0.1.0',
  builtWith: { model: 'opus', builtAt: '2026-10-24' },
  views: { [APP_PLUGINS_VIEW]: { title: 'Plugins per app', icon: 'package', keywords: ['plugins', 'install', 'uninstall', 'apps', 'grid'], render: () => <AppPluginsView /> } },
  register(rt) {
    rt.actions.register('patches.app-plugins', () => rt.navigate(APP_PLUGINS_VIEW), { label: 'Plugins per app…' });
  },
  appMenu: [{ id: 'patches.app-plugins.menu', menu: 'patches', items: [{ id: 'app-plugins', label: 'Plugins per app…', icon: 'package', action: 'patches.app-plugins' }] }],
  contextMenu: [{ id: 'patches.app-plugins.ctx', target: 'default', order: 2, items: [{ id: 'patches.app-plugins', label: 'Plugins per app…', icon: 'package', action: 'patches.app-plugins' }] }],
};
