/**
 * Plugin Update (Brett, Oct 23 2026): every installed plugin with the model that built it, when it was built and its
 * version, checked against the plugin catalog on axHub (plugin-catalog@1, /projects/_shared/_data/plugin-catalog).
 *   - a newer version by the same model → Update: one click installs it
 *   - a build by another model in the catalog → Replace: a confirm card lists the removal of the old build and the
 *     installation of the new one, then the console swaps them in the same folder (POST /api/plugin-catalog/swap)
 *   - Rebuild with <model>: parks a from-scratch rebuild on the pending list (the Build manager can start it); when it is
 *     published to the catalog, its row offers Replace
 * Never two builds of one plugin: the console refuses a second instance (one id, one folder, any model), so a rebuild
 * always replaces. Web only: the routes are the console's own (plugin catalog, pending list, plugins), no data here.
 */
import { useCallback, useEffect, useState } from 'react';
import { Button, Checkbox, Icon, ModelBadge, Note, useRuntime } from '@console/axf/react';
import type { AxfWebLibrary } from '@console/axf/react/library';
import { getToken, post } from '@console/api';
import { PLUGINS_CHANGED } from '@console/plugins';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import { label, rebuildRequest, rows as toRows, summary, type CatalogItem, type Installed, type Model, type Pending, type Row } from './core';
import { appMenu } from './menu';
import { MoreMenu } from './MoreMenu';
import './plugin-update.css';
import { EmptyState } from '@console/emptyState';

const ID = 'ai.amberx.axf.console.plugin-update';
const FOLDER = 'plugin-update';
const VIEW = 'plugin-update';

async function getJson<T>(path: string): Promise<T> {
  const t = getToken();
  const r = await fetch(`/api/${path}`, { cache: 'no-store', headers: t ? { authorization: `Bearer ${t}` } : {} });
  const j = (await r.json().catch(() => ({}))) as T & { detail?: string };
  if (!r.ok) throw new Error(r.status === 401 ? 'Set the console token (Settings → Account & security) to check for updates.' : String(j.detail ?? `${path}: ${r.status}`));
  return j;
}

interface State { rows: Row[]; catalog: 'ok' | 'off' | 'error'; catalogNote: string; checkedAt: string | null; error: string | null }

function useUpdates() {
  const [s, setS] = useState<State>({ rows: [], catalog: 'ok', catalogNote: '', checkedAt: null, error: null });
  const [loading, setLoading] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const installed = (await getJson<{ items: Installed[] }>('plugins')).items ?? [];
      let items: CatalogItem[] = [];
      let catalog: State['catalog'] = 'ok';
      let catalogNote = '';
      try {
        const c = await getJson<{ reachable?: boolean; items?: CatalogItem[] }>('plugin-catalog?kind=console');
        items = c.items ?? [];
        if (c.reachable === false) { catalog = 'off'; catalogNote = 'The plugin catalog on axHub isn’t reachable from this console (no /projects mount).'; }
      } catch (e) { catalog = 'error'; catalogNote = (e as Error).message; }
      let pending: Pending[] = [];
      try { pending = (await getJson<{ items?: Pending[] }>('pending')).items ?? []; } catch { /* the list still shows without parked rebuilds */ }
      setS({ rows: toRows(installed, items, pending), catalog, catalogNote, checkedAt: new Date().toISOString(), error: null });
    } catch (e) {
      setS((x) => ({ ...x, error: (e as Error).message }));
    } finally { setLoading(false); }
  }, []);
  useEffect(() => {
    void load();
    const again = () => { if (document.visibilityState === 'visible') void load(); };
    globalThis.addEventListener(PLUGINS_CHANGED, again);
    document.addEventListener('visibilitychange', again);
    return () => { globalThis.removeEventListener(PLUGINS_CHANGED, again); document.removeEventListener('visibilitychange', again); };
  }, [load]);
  return { ...s, loading, load };
}

type Ask = { kind: 'replace'; row: Row; keepData: boolean } | { kind: 'rebuild'; row: Row; model: Model } | null;

function PluginUpdate() {
  const rt = useRuntime();
  const u = useUpdates();
  const [busy, setBusy] = useState('');
  const [ask, setAsk] = useState<Ask>(null);
  const [note, setNote] = useState<{ tone: 'success' | 'danger' | 'info'; text: string } | null>(null);
  const changed = () => { globalThis.dispatchEvent(new Event(PLUGINS_CHANGED)); void u.load(); };

  const update = async (r: Row) => {
    setBusy(r.folder); setNote(null);
    const res = await post('plugin-catalog/install', { folder: r.folder, update: true, version: r.update, confirm: r.folder });
    setBusy('');
    if (!res.ok) { setNote({ tone: 'danger', text: `${r.name}: ${res.error}` }); return; }
    setNote({ tone: 'success', text: `${r.name} updated to ${r.update}. ${(res as { note?: string }).note ?? ''}` });
    rt.toast(`${r.name} updated to ${r.update}.`, 'success', 'Plugin Update');
    changed();
  };

  const replace = async (r: Row, keepData: boolean) => {
    if (!r.replace) return;
    setBusy(r.folder); setNote(null); setAsk(null);
    const res = await post('plugin-catalog/swap', { folder: r.folder, version: r.replace.version, keepData, confirm: `replace ${r.folder}` });
    setBusy('');
    if (!res.ok) { setNote({ tone: 'danger', text: `${r.name}: ${res.error}` }); return; }
    const x = res as unknown as { from?: { model?: string; version?: string }; to?: { model?: string; version?: string }; removed?: { backup?: string | null } | null };
    setNote({ tone: 'success', text: `${r.name}: removed the ${label(x.from?.model)} build ${x.from?.version}${x.removed?.backup ? ` (its data is backed up: ${x.removed.backup})` : keepData ? ' (its data kept)' : ''} and installed the ${label(x.to?.model)} build ${x.to?.version}. The console rebuilds with it within about 5 minutes.` });
    rt.toast(`${r.name} is now the ${label(x.to?.model)} build.`, 'success', 'Plugin Update');
    changed();
  };

  const rebuild = async (r: Row, model: Model) => {
    setBusy(r.folder); setNote(null); setAsk(null);
    const res = await post('pending', rebuildRequest(r, model));
    setBusy('');
    if (!res.ok) { setNote({ tone: 'danger', text: `${r.name}: ${res.error}` }); return; }
    const id = (res as { item?: { id?: string } }).item?.id ?? '';
    const canStart = Boolean(rt.actions.get('build-manager.start'));
    setNote({ tone: 'success', text: `A ${label(model)} rebuild of ${r.name} is on the pending list (${id}).${canStart ? ' Start it from the Build manager.' : ''} When it is published to the catalog, this row offers Replace.` });
    if (canStart && id) rt.dispatch(`build-manager.start:${encodeURIComponent(`pending:${id}`)}`);
    void u.load();
  };

  const list = u.rows;
  return (
    <div className="fx-stack axp-plugin-update">
      <header className="fx-pagehead">
        <div>
          <p className="fx-eyebrow">Plugins · updates</p>
          <h1>Plugin Update</h1>
          <p className="fx-muted" title="Every installed plugin, the model that built it, when, and its version, checked against the plugin catalog on axHub. One copy of each plugin, always: a build by another model replaces the installed one.">Installed plugins checked against axHub’s catalog. One copy each.</p>
        </div>
        <Button size="sm" icon="refresh" disabled={u.loading} onClick={() => void u.load()}>{u.loading ? 'Checking…' : 'Check now'}</Button>
      </header>
      {u.error && <Note tone="danger">{u.error}</Note>}
      {u.catalog !== 'ok' && <Note tone="warning"><span title={u.catalogNote}>Can’t reach axHub’s catalog: showing what’s installed, no update check.</span></Note>}
      {note && <Note tone={note.tone}>{note.text}</Note>}
      {list.length > 0 && <p className="fx-muted axp-plugin-update__summary">{summary(list)}{u.checkedAt ? ` · checked ${new Date(u.checkedAt).toLocaleTimeString()}` : ''}</p>}

      {ask && (
        <div className="fx-card axp-plugin-update__confirm" role="alertdialog" aria-label={ask.kind === 'replace' ? `Replace ${ask.row.name}?` : `Rebuild ${ask.row.name}?`}>
          {ask.kind === 'replace' && ask.row.replace ? (
            <>
              <strong>Replace {ask.row.name}?</strong>
              <ol className="axp-plugin-update__steps">
                <li><Icon name="trash" size={14} /> Remove the installed <ModelBadge compact model={ask.row.model} /> build {ask.row.version}: its uninstall hook runs{ask.keepData ? '; its data folder stays' : ' and its data folder is deleted (backed up first)'}.</li>
                <li><Icon name="download" size={14} /> Install the <ModelBadge compact model={ask.row.replace.model} /> build {ask.row.replace.version} from axHub in the same folder; its code runs on this console’s server. It’s committed to GitHub and the console rebuilds with it.</li>
              </ol>
              <Checkbox checked={ask.keepData} onChange={(on) => setAsk({ ...ask, keepData: on })} label="Keep its data (settings, history) for the new build" />
              <div className="fx-row fx-row--wrap">
                <Button size="sm" tone="danger" icon="check" onClick={() => void replace(ask.row, ask.keepData)}>Remove the old build and install the new one</Button>
                <Button size="sm" tone="ghost" onClick={() => setAsk(null)}>Cancel</Button>
              </div>
            </>
          ) : ask.kind === 'rebuild' ? (
            <>
              <strong>Rebuild {ask.row.name} with {label(ask.model)}?</strong>
              <p className="fx-muted" style={{ margin: 0 }}>A brand-new build, written from scratch on {label(ask.model)}, goes on the pending list (with its steps and an estimate) for the Build manager to run. It keeps this plugin’s folder and id, so it can only replace the {label(ask.row.model)} build, never sit next to it. When it’s published to the catalog, Replace here removes the old build and installs the new one, after you confirm.</p>
              <div className="fx-row fx-row--wrap">
                <Button size="sm" tone="primary" icon="sparkles" onClick={() => void rebuild(ask.row, ask.model)}>Park the {label(ask.model)} rebuild</Button>
                <Button size="sm" tone="ghost" onClick={() => setAsk(null)}>Cancel</Button>
              </div>
            </>
          ) : null}
        </div>
      )}

      {/* one line per plugin: name, model, version; its main action on the right, rebuilds behind ⋯ (compact pages, Oct 30 2026) */}
      <ul className="axp-plugin-update__list">
        {list.map((r) => {
          const parked = r.rebuildWith.map((m) => ({ m, p: r.parked.find((x) => x.model === m) }));
          return (
            <li key={r.folder} className={`axp-plugin-update__row ${r.enabled ? '' : 'is-off'}`}>
              <div className="axp-plugin-update__head">
                <strong className="axp-plugin-update__name">{r.name}</strong>
                <ModelBadge compact model={r.model} builtAt={r.builtAt} />
                <span className="fx-muted fx-small axp-plugin-update__meta" title={`v${r.version}${r.builtAt ? ` · built ${r.builtAt}` : ''} · ${r.folder}${r.enabled ? '' : ' · off'}`}>
                  v{r.version}{r.enabled ? '' : ' · off'}
                  {parked.filter((x) => x.p).map((x) => ` · ${label(x.m)} rebuild ${x.p!.status === 'complete' ? 'built' : 'parked'} (${x.p!.id})`).join('')}
                </span>
              </div>
              <div className="axp-plugin-update__acts">
                {r.update
                  ? <Button size="sm" tone="primary" icon="download" disabled={!!busy} onClick={() => void update(r)}>{busy === r.folder ? 'Updating…' : `Update to ${r.update}`}</Button>
                  : r.replace ? null : u.catalog === 'ok' && <span className="fx-muted fx-small">{r.inCatalog ? 'Up to date' : 'Not in catalog'}</span>}
                {r.replace && <Button size="sm" tone="success" icon="shuffle" disabled={!!busy} onClick={() => setAsk({ kind: 'replace', row: r, keepData: false })}>Replace ({label(r.replace.model)} {r.replace.version})</Button>}
                <MoreMenu label={`More for ${r.name}`} items={parked.filter((x) => !x.p).map((x) => ({ id: x.m, label: `Rebuild with ${label(x.m)}…`, icon: 'sparkles', disabled: !!busy, onSelect: () => setAsk({ kind: 'rebuild', row: r, model: x.m }) }))} />
              </div>
              {r.error && <Note tone="danger">{r.error}</Note>}
            </li>
          );
        })}
      </ul>
      {!list.length && !u.loading && !u.error && <EmptyState icon="package" compact>No plugins installed.</EmptyState>}
    </div>
  );
}

function SettingsPanel() {
  const rt = useRuntime();
  return (
    <div className="fx-stack">
      <p className="fx-muted" style={{ margin: 0 }} title="Lists every installed plugin with the model that built it, checks axHub’s plugin catalog for new versions and for builds by another model, and parks rebuilds with another model.">Updates, model swaps and rebuilds for installed plugins.</p>
      <div className="fx-row"><Button size="sm" tone="primary" icon="refresh" onClick={() => rt.navigate(VIEW)}>Open Plugin Update</Button></div>
    </div>
  );
}

export const plugin: AxfWebLibrary = {
  id: ID, // equals plugin.json "id"
  label: 'Plugin Update',
  version: '0.1.0',
  appMenu,
  register(rt) {
    rt.actions.register('plugin-update.open', () => rt.navigate(VIEW), { label: 'Plugin Update: check for plugin updates' });
  },
  views: { [VIEW]: { title: 'Plugin Update', icon: 'refresh', keywords: ['update', 'plugins', 'versions', 'rebuild', 'model', 'fable', 'opus'], render: () => <PluginUpdate /> } },
  nav: { label: 'Plugins', items: [{ id: VIEW, label: 'Plugin Update', icon: 'refresh', view: VIEW }] },
  contextMenu: [
    { id: 'plugin-update.default', target: 'default', order: 92, items: [{ id: 'plugin-update', label: 'Plugin Update', icon: 'refresh', action: 'plugin-update.open' }] },
  ],
  settingsTabs: [{ id: 'plugin-update', label: 'Plugin Update', icon: 'refresh', order: 7, parent: 'plugins' }],
  settingsPanels: [
    { id: 'plugin-update.about', tab: 'plugin-update', title: 'Plugin Update', icon: 'refresh', order: 5, render: () => <SettingsPanel /> },
    { id: 'plugin-update.lifecycle', tab: 'plugin-update', title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> },
  ],
};
