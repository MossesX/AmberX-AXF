/**
 * Plugins menu console plugin (ai.amberx.axf.console.plugins-menu).
 *
 * Right-click / long-press anywhere → **Plugins** ▸ Install… · Settings… · Manage · Enable ▸ · Disable ▸.
 *  - Enable lists every installed plugin that is switched off (picking one switches it on); Disable the opposite.
 *  - Settings… opens the **settings browser**: a collapsible column of every installed plugin and, beside it, the
 *    picked plugin's own settings interface (its Settings → Plugins sub-tab). A dialog by default; it can switch itself
 *    to a floating window (the framework's placement setting, `axf.placement.<id>`). Its own parameters (basic, style,
 *    switches, behaviour) are settings on its own tab, plus a placeholder for every advanced parameter type.
 *  - Install… opens the **plugin installer**: browse every archive location (axHub permanent, with its credentials;
 *    folders, https servers, other consoles), download and install from there, with its own built-in settings.
 *  - Manage opens the Plugin Manager (or Settings → Plugins without it).
 * Server part (archives, credentials, installs) in server/__init__.py; the pure part in web/core.ts.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Checkbox, Chip, IconButton, Icon, ModelBadge, Note, Segmented, SelectField, Switch, TextField, useAxfState, useRuntime } from '@console/axf/react';
import type { AxfWebLibrary } from '@console/axf/react/library';
import type { AxfRuntime } from '@console/axf/core/runtime';
import { placementKey } from '@console/axf/core/engines/placement';
import { TabContent } from '@console/axf/libs/settings';
import { post } from '@console/api';
import { bundledPlugins, fetchPluginStatus, pluginApi, PLUGINS_CHANGED, type PluginStatus } from '@console/plugins';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import { appMenu } from './menu';
import {
  FOLDER, ID, INSTALL_DIALOG, K, PARAM_GROUPS, PARAM_TYPES, SETTINGS_DIALOG, TAB,
  columnRows, initialPick, installAction, pluginsSubmenu, sortCatalog, type PluginRow, type SortKey,
} from './core';
import './plugins-menu.css';

const api = pluginApi(FOLDER, 'The Plugins menu plugin');
const LABEL = 'Plugins';

/* ------------------------------------------------------------------ installed plugins */

function toRows(status: PluginStatus[] | null): PluginRow[] {
  const tabOf = (folder: string) => bundledPlugins.find((p) => p.folder === folder)?.library?.settingsTabs?.[0]?.id;
  const meta = (folder: string) => bundledPlugins.find((p) => p.folder === folder)?.manifest;
  const list = status
    ? status.map((s) => ({ folder: s.folder, name: s.name ?? s.folder, enabled: s.enabled, problem: s.server === 'error' ? (s.error ?? 'server part failed') : null }))
    : bundledPlugins.map((p) => ({ folder: p.folder, name: p.manifest.name, enabled: p.manifest.enabledByDefault !== false, problem: p.problem ?? null }));
  return list.map((r) => {
    const m = meta(r.folder);
    return { ...r, version: m?.version, model: m?.builtWith?.model, builtAt: m?.builtWith?.builtAt, tab: tabOf(r.folder) };
  });
}

function usePluginRows(): { rows: PluginRow[] | null; offline: boolean; reload: () => void } {
  const [rows, setRows] = useState<PluginRow[] | null>(null);
  const [offline, setOffline] = useState(false);
  const reload = useCallback(() => {
    void fetchPluginStatus().then((s) => { setOffline(s === null); setRows(toRows(s)); });
  }, []);
  useEffect(() => {
    reload();
    globalThis.addEventListener(PLUGINS_CHANGED, reload);
    return () => globalThis.removeEventListener(PLUGINS_CHANGED, reload);
  }, [reload]);
  return { rows, offline, reload };
}

async function setEnabled(rt: AxfRuntime, folder: string, on: boolean): Promise<boolean> {
  const name = bundledPlugins.find((p) => p.folder === folder)?.manifest.name ?? folder;
  const r = await post(`plugins/${folder}/enabled`, { enabled: on });
  if (!r.ok) { rt.toast(String(r.error ?? 'Could not change the plugin (console token / admin needed).'), 'danger', LABEL); return false; }
  globalThis.dispatchEvent(new Event(PLUGINS_CHANGED));
  rt.toast(`${on ? 'Turned on' : 'Turned off'} ${name}.`, 'success', LABEL);
  return true;
}

/* ------------------------------------------------------------------ right-click submenu */

let menuListener: (() => void) | null = null;

function refreshMenu(rt: AxfRuntime): void {
  void fetchPluginStatus().then((s) => {
    const manage = bundledPlugins.some((p) => p.folder === 'plugin-manager') && (s?.find((x) => x.folder === 'plugin-manager')?.enabled ?? true) ? 'nav:plugin-manager' : 'settings.open:plugins';
    rt.addContextItems({ id: 'plugins-menu.default', module: ID, target: 'default', order: 89, items: [pluginsSubmenu(toRows(s), { manage })] });
  });
}

/* ------------------------------------------------------------------ settings browser */

const setting = <T,>(rt: AxfRuntime, key: string, d: T): T => { const v = rt.settings.get(key); return (v === undefined || v === null ? d : v) as T; };

function SettingsBrowser({ ask }: { ask?: string }) {
  const rt = useRuntime();
  useAxfState(); // hot render: any settings change re-renders the browser at once
  const { rows, offline } = usePluginRows();
  const [q, setQ] = useState('');
  const collapsed = setting(rt, K.collapsed, false);
  const o = {
    showOff: setting(rt, K.showOff, true), showBare: setting(rt, K.showBare, true), sort: setting<SortKey>(rt, K.sort, 'name'),
    remember: setting(rt, K.remember, true), onOpen: setting<string>(rt, K.onOpen, 'last'),
  };
  const list = useMemo(() => columnRows(rows ?? [], { ...o, q: setting(rt, K.search, true) ? q : '' }), [rows, o.showOff, o.showBare, o.sort, q]); // eslint-disable-line react-hooks/exhaustive-deps
  const [pick, setPick] = useState<string | null>(null);
  useEffect(() => {
    if (pick === null && rows) setPick(initialPick(list, { onOpen: o.onOpen, remember: o.remember, last: String(rt.settings.get(K.last) ?? ''), asked: ask }));
  }, [rows]); // eslint-disable-line react-hooks/exhaustive-deps
  const choose = (folder: string) => { setPick(folder); if (o.remember) rt.settings.set(K.last, folder); };
  const mode = rt.placementOf(ID) === 'window' ? 'window' : 'dialog';
  const density = setting<string>(rt, K.density, 'regular');
  const width = setting<string>(rt, K.column, 'regular');
  const side = setting<string>(rt, K.side, 'left');
  const badges = setting(rt, K.badges, true);
  const icons = setting(rt, K.icons, true);
  const row = (rows ?? []).find((r) => r.folder === pick) ?? null;

  return (
    <div className={`axp-plugins-menu axp-plugins-menu--${density} ${collapsed ? 'is-collapsed' : ''} ${side === 'right' ? 'is-right' : ''}`}>
      <div className="axp-plugins-menu__bar">
        <IconButton icon={collapsed ? 'chevron-right' : 'chevron-left'} label={collapsed ? 'Show the plugin list' : 'Hide the plugin list'} onClick={() => rt.settings.set(K.collapsed, !collapsed)} />
        <Segmented size="sm" label="Open as" value={mode} onChange={(v) => rt.settings.set(placementKey(ID), v)}
          options={[{ value: 'dialog', label: 'Dialog', icon: 'box' }, { value: 'window', label: 'Floating window', icon: 'external' }]} />
        <span className="axp-plugins-menu__grow" />
        <Button size="sm" tone="ghost" icon="settings" onClick={() => choose(FOLDER)}>This browser</Button>
      </div>
      {offline && <Note tone="warning">The console API isn't reachable: showing the bundled plugins.</Note>}
      <div className={`axp-plugins-menu__body axp-plugins-menu__body--${width}`}>
        {!collapsed && (
          <nav className="axp-plugins-menu__col" aria-label="Installed plugins">
            {setting(rt, K.search, true) && <TextField label="Find a plugin" value={q} onChange={setQ} placeholder="Name or folder" />}
            {!rows && <p className="fx-muted">Loading plugins…</p>}
            <ul className="axp-plugins-menu__list">
              {list.map((r) => (
                <li key={r.folder}>
                  <button type="button" data-fx-row className={`axp-plugins-menu__item ${r.folder === pick ? 'is-on' : ''} ${r.enabled ? '' : 'is-off'}`} onClick={() => choose(r.folder)} aria-current={r.folder === pick ? 'true' : undefined}>
                    {icons && <Icon name={r.enabled ? 'package' : 'pause'} size={13} />}
                    <span className="axp-plugins-menu__name">{r.name}</span>
                    {badges && <ModelBadge model={r.model} builtAt={r.builtAt} compact />}
                  </button>
                </li>
              ))}
              {rows && !list.length && <li className="fx-muted">No plugins match.</li>}
            </ul>
          </nav>
        )}
        <section className="axp-plugins-menu__main" aria-label="Plugin settings">
          {!pick && <p className="fx-muted">Pick a plugin to see its settings.</p>}
          {pick && row && <PluginPane row={row} />}
          {pick && !row && rows && <p className="fx-muted">{pick} isn't installed.</p>}
        </section>
      </div>
    </div>
  );
}

function PluginPane({ row }: { row: PluginRow }) {
  const rt = useRuntime();
  const [busy, setBusy] = useState(false);
  const flip = async (on: boolean) => { setBusy(true); await setEnabled(rt, row.folder, on); setBusy(false); };
  const registered = row.tab ? !!rt.settings.getTab(row.tab) : false;
  return (
    <div className="fx-stack">
      <header className="axp-plugins-menu__head">
        <h2 className="axp-plugins-menu__title">{row.name}</h2>
        <ModelBadge model={row.model} builtAt={row.builtAt} />
        {row.version && <Chip>v{row.version}</Chip>}
        <span className="axp-plugins-menu__grow" />
        {row.folder !== FOLDER && <Switch label={row.enabled ? 'On' : 'Off'} checked={row.enabled} disabled={busy} onChange={(v) => void flip(v)} />}
      </header>
      {row.problem && <Note tone="danger">{row.problem}</Note>}
      {!row.enabled && <Note tone="info">{row.name} is switched off, so its settings aren't loaded. Turn it on to change them.</Note>}
      {row.enabled && row.tab && registered && <TabContent id={row.tab} />}
      {row.enabled && (!row.tab || !registered) && <Note tone="info">{row.name} has no settings of its own.</Note>}
    </div>
  );
}

/** Every advanced parameter type, built or placeholder (Settings → Plugins → Plugins menu → Advanced). */
function AdvancedPlaceholders() {
  const groups = Object.entries(PARAM_GROUPS);
  return (
    <div className="fx-stack">
      <p className="fx-muted" style={{ margin: 0 }}>Every parameter type a plugin setting can take. Greyed-out ones are placeholders: they show here so a plugin can plan for them, and switch on once the settings library renders that type.</p>
      {groups.map(([g, label]) => (
        <div key={g} className="axp-plugins-menu__params">
          <h4 className="axp-plugins-menu__params-title">{label}</h4>
          <ul className="axp-plugins-menu__params-list">
            {PARAM_TYPES.filter((p) => p.group === g).map((p) => (
              <li key={p.id} className={`axp-plugins-menu__param ${p.built ? '' : 'is-placeholder'}`} title={p.built ? 'Built' : 'Placeholder: not built yet'}>
                <span>{p.label}</span>
                <span className="fx-muted">{p.example}</span>
                <Chip tone={p.built ? 'success' : undefined}>{p.built ? 'built' : 'placeholder'}</Chip>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ installer */

interface Archive {
  id: string; label: string; kind: string; kindLabel: string; built: boolean; location: string; enabled: boolean; permanent: boolean;
  auth: { type: string; user: string; header: string; set: boolean; fromEnv: boolean }; needsCredential: boolean;
  lastTest?: { ok: boolean; detail?: string; error?: string; at: number } | null;
}
interface ArchiveKind { id: string; label: string; built: boolean; location: string; auth: string[]; needsCredential?: boolean }
interface CatalogItem {
  kind: string; folder: string; id: string; name: string; version: string; versions?: string[]; description?: string; publishedAt?: string;
  archive: string; archiveLabel?: string; model?: string | null; installed?: string | null; installedModel?: string | null; otherModel?: boolean; clash?: string | null; readOnly?: boolean; enabled?: boolean | null;
}
interface Config { publish: boolean; keepDataOnReplace: boolean; showInstalled: boolean; showOtherKinds: boolean; checkOnOpen: boolean; confirmTyping: boolean; sort: string; pageSize: number; defaultArchive: string }

function Installer() {
  const [tab, setTab] = useState<'browse' | 'archives' | 'settings'>('browse');
  const [config, setConfig] = useState<Config | null>(null);
  useEffect(() => { void api.call('config').then((r) => setConfig((r as { config: Config }).config)).catch(() => setConfig(null)); }, []);
  return (
    <div className="axp-plugins-menu axp-plugins-menu--installer">
      <Segmented label="Installer" value={tab} onChange={setTab} options={[
        { value: 'browse', label: 'Browse', icon: 'search' }, { value: 'archives', label: 'Archives', icon: 'layers' }, { value: 'settings', label: 'Settings', icon: 'settings' },
      ]} />
      {tab === 'browse' && <Browse config={config} />}
      {tab === 'archives' && <Archives />}
      {tab === 'settings' && <InstallerSettings config={config} onSaved={setConfig} />}
    </div>
  );
}

function Browse({ config }: { config: Config | null }) {
  const rt = useRuntime();
  const [archives, setArchives] = useState<Archive[]>([]);
  const [archive, setArchive] = useState('');
  const [q, setQ] = useState('');
  const [data, setData] = useState<{ items: CatalogItem[]; archives: { id: string; label: string; ok: boolean; error?: string; count?: number }[] } | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [limit, setLimit] = useState(50);
  useEffect(() => { void api.call('archives').then((r) => setArchives((r as { archives: Archive[] }).archives)).catch(() => undefined); }, []);
  useEffect(() => { if (config && !archive) { setArchive(config.defaultArchive || 'all'); setLimit(config.pageSize); } }, [config]); // eslint-disable-line react-hooks/exhaustive-deps
  const load = useCallback(async (fresh = false) => {
    if (!archive) return;
    setLoading(true); setError('');
    try {
      const kind = config?.showOtherKinds ? 'all' : 'console';
      setData(await api.call(`browse?archive=${encodeURIComponent(archive)}&kind=${kind}&q=${encodeURIComponent(q)}${fresh ? '&fresh=true' : ''}`) as typeof data);
    } catch (e) { setError(String((e as Error).message)); }
    setLoading(false);
  }, [archive, q, config?.showOtherKinds]);
  useEffect(() => { if (archive && (config?.checkOnOpen ?? true)) void load(); }, [archive]); // eslint-disable-line react-hooks/exhaustive-deps
  const items = useMemo(() => {
    const xs = (data?.items ?? []).filter((i) => config?.showInstalled !== false || !i.installed);
    return sortCatalog(xs, config?.sort ?? 'name') as CatalogItem[];
  }, [data, config?.showInstalled, config?.sort]);
  return (
    <div className="fx-stack">
      <div className="axp-plugins-menu__filters">
        <SelectField label="Archive" value={archive} onChange={setArchive} options={[{ value: 'all', label: 'Every archive' }, ...archives.filter((a) => a.enabled).map((a) => ({ value: a.id, label: a.label }))]} />
        <TextField label="Search" value={q} onChange={setQ} placeholder="Name, folder or words" />
        <Button icon="refresh" onClick={() => void load(true)} disabled={loading}>{loading ? 'Reading…' : 'Search'}</Button>
      </div>
      {error && <Note tone="danger">{error}</Note>}
      {data?.archives.filter((a) => !a.ok).map((a) => <Note key={a.id} tone="warning">{a.label}: {a.error}</Note>)}
      {data && <p className="fx-muted" style={{ margin: 0 }}>{items.length} plugin{items.length === 1 ? '' : 's'} in {data.archives.filter((a) => a.ok).map((a) => a.label).join(', ') || 'no reachable archive'}</p>}
      <ul className="axp-plugins-menu__catalog">
        {items.slice(0, limit).map((i) => {
          const key = `${i.archive}/${i.kind}/${i.folder}`;
          return <CatalogRowView key={key} item={i} open={open === key} onToggle={() => setOpen(open === key ? null : key)} confirmTyping={config?.confirmTyping ?? true} keepData={config?.keepDataOnReplace ?? false} onDone={() => { void load(true); globalThis.dispatchEvent(new Event(PLUGINS_CHANGED)); rt.toast(`${i.name}: done. The console rebuilds with it shortly.`, 'success', LABEL); }} />;
        })}
      </ul>
      {items.length > limit && <Button tone="ghost" onClick={() => setLimit(limit + (config?.pageSize ?? 50))}>Show more ({items.length - limit} left)</Button>}
    </div>
  );
}

function CatalogRowView({ item, open, onToggle, confirmTyping, keepData, onDone }: { item: CatalogItem; open: boolean; onToggle: () => void; confirmTyping: boolean; keepData: boolean; onDone: () => void }) {
  const act = installAction(item);
  const replace = act.kind === 'replace';
  const want = replace ? `replace ${item.folder}` : item.folder;
  const [typed, setTyped] = useState('');
  const [armed, setArmed] = useState(false);
  const [keep, setKeep] = useState(keepData);
  const [version, setVersion] = useState(item.version);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const can = act.kind === 'install' || act.kind === 'update' || replace;
  const ready = confirmTyping ? typed.trim() === want : armed;
  const go = async () => {
    setBusy(true); setResult(null);
    try {
      const r = await api.post('install', { archive: item.archive, folder: item.folder, version, confirm: want, replace, keepData: keep }) as { note?: string; version?: string };
      setResult({ ok: true, text: `${item.name} ${r.version ?? version} installed. ${r.note ?? ''}` });
      onDone();
    } catch (e) { setResult({ ok: false, text: String((e as Error).message) }); }
    setBusy(false); setArmed(false); setTyped('');
  };
  return (
    <li className={`axp-plugins-menu__entry ${open ? 'is-open' : ''}`}>
      <button type="button" data-fx-row className="axp-plugins-menu__entry-head" onClick={onToggle} aria-expanded={open}>
        <Icon name={open ? 'chevron-down' : 'chevron-right'} size={12} />
        <span className="axp-plugins-menu__name">{item.name}</span>
        <ModelBadge model={item.model ?? undefined} compact />
        <Chip>v{item.version}</Chip>
        {item.installed && <Chip tone="success">installed {item.installed}</Chip>}
        <span className="axp-plugins-menu__grow" />
        <span className="fx-muted">{item.archiveLabel}</span>
      </button>
      {open && (
        <div className="axp-plugins-menu__entry-body fx-stack">
          {item.description && <p style={{ margin: 0 }}>{item.description}</p>}
          <p className="fx-muted" style={{ margin: 0 }}>{item.folder} · {item.id}{item.publishedAt ? ` · published ${item.publishedAt.slice(0, 10)}` : ''}{item.installedModel ? ` · installed build: ${item.installedModel}` : ''}</p>
          {item.clash && <Note tone="warning">{item.clash}</Note>}
          {replace && <Note tone="warning">This is the {item.model} build and the {item.installedModel} build is installed. Replacing removes the installed build (its data is backed up{keep ? ' and kept' : ' and removed'}) and installs this one in the same folder: never both.</Note>}
          {can && (item.versions?.length ?? 0) > 1 && <SelectField label="Version" value={version} onChange={setVersion} options={[...(item.versions ?? [])].reverse().map((v) => ({ value: v, label: v }))} />}
          {replace && <Checkbox label="Keep the old build's data" checked={keep} onChange={setKeep} />}
          {can && confirmTyping && <TextField label={`Type “${want}” to confirm (it runs the plugin's code on this server)`} value={typed} onChange={setTyped} mono />}
          <div className="fx-row fx-row--wrap">
            {can && !confirmTyping && !armed && <Button tone="primary" icon="download" onClick={() => setArmed(true)}>{act.label}</Button>}
            {can && (confirmTyping || armed) && <Button tone={replace ? 'danger' : 'primary'} icon="download" disabled={!ready || busy} onClick={() => void go()}>{busy ? 'Installing…' : confirmTyping ? act.label : `Tap again: ${act.label.toLowerCase()}`}</Button>}
            {!can && <Chip>{act.label}</Chip>}
          </div>
          {result && <Note tone={result.ok ? 'success' : 'danger'}>{result.text}</Note>}
        </div>
      )}
    </li>
  );
}

function Archives() {
  const rt = useRuntime();
  const [data, setData] = useState<{ archives: Archive[]; kinds: ArchiveKind[]; authTypes: { id: string; label: string }[] } | null>(null);
  const [edit, setEdit] = useState<string | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(() => { void api.call('archives').then((r) => setData(r as typeof data)).catch((e) => setError(String((e as Error).message))); }, []);
  useEffect(load, [load]);
  const test = async (a: Archive) => { try { setData(await api.post(`archives/${a.id}/test`, {}) as typeof data); } catch (e) { rt.toast(String((e as Error).message), 'danger', LABEL); } };
  const remove = async (a: Archive) => { try { setData(await api.del(`archives/${a.id}`) as typeof data); } catch (e) { rt.toast(String((e as Error).message), 'danger', LABEL); } };
  if (!data) return error ? <Note tone="danger">{error}</Note> : <p className="fx-muted">Loading archives…</p>;
  return (
    <div className="fx-stack">
      <p className="fx-muted" style={{ margin: 0 }}>Places plugins are kept. axHub is the permanent archive and needs its token. Credentials stay on the console server: this page only shows whether one is set.</p>
      <ul className="axp-plugins-menu__catalog">
        {data.archives.map((a) => (
          <li key={a.id} className="axp-plugins-menu__entry">
            <div className="axp-plugins-menu__entry-head">
              <Icon name={a.kind === 'axhub' ? 'cloud' : 'layers'} size={13} />
              <span className="axp-plugins-menu__name">{a.label}</span>
              <Chip>{a.kindLabel}</Chip>
              {a.permanent && <Chip tone="accent">permanent</Chip>}
              <Chip tone={a.auth.set ? 'success' : a.needsCredential ? 'danger' : undefined}>{a.auth.type === 'none' ? 'no credentials' : a.auth.set ? (a.auth.fromEnv ? 'credential: console env' : 'credential set') : 'needs a credential'}</Chip>
              {!a.enabled && <Chip>off</Chip>}
              <span className="axp-plugins-menu__grow" />
              <Button size="sm" icon="check" onClick={() => void test(a)}>Test</Button>
              <Button size="sm" tone="ghost" icon="edit" onClick={() => setEdit(edit === a.id ? null : a.id)}>Edit</Button>
              {!a.permanent && <Button size="sm" tone="danger" icon="trash" onClick={() => void remove(a)}>Remove</Button>}
            </div>
            <p className="fx-muted axp-plugins-menu__loc">{a.location}</p>
            {a.lastTest && <Note tone={a.lastTest.ok ? 'success' : 'danger'}>{a.lastTest.ok ? a.lastTest.detail : a.lastTest.error}</Note>}
            {edit === a.id && <ArchiveForm archive={a} kinds={data.kinds} authTypes={data.authTypes} onSaved={(d) => { setData(d); setEdit(null); }} />}
          </li>
        ))}
      </ul>
      <h3 className="axp-plugins-menu__params-title">Add an archive</h3>
      <ArchiveForm kinds={data.kinds} authTypes={data.authTypes} onSaved={(d) => setData(d)} />
    </div>
  );
}

function ArchiveForm({ archive, kinds, authTypes, onSaved }: { archive?: Archive; kinds: ArchiveKind[]; authTypes: { id: string; label: string }[]; onSaved: (d: never) => void }) {
  const [kind, setKind] = useState(archive?.kind ?? 'https');
  const spec = kinds.find((k) => k.id === kind);
  const [label, setLabel] = useState(archive?.label ?? '');
  const [location, setLocation] = useState(archive?.location ?? '');
  const [authType, setAuthType] = useState(archive?.auth.type ?? spec?.auth[0] ?? 'none');
  const [token, setToken] = useState('');
  const [user, setUser] = useState(archive?.auth.user ?? '');
  const [password, setPassword] = useState('');
  const [header, setHeader] = useState(archive?.auth.header ?? '');
  const [value, setValue] = useState('');
  const [enabled, setEnabled] = useState(archive?.enabled ?? true);
  const [error, setError] = useState('');
  const keep = archive?.auth.set ? 'Leave empty to keep the saved one' : '';
  const save = async (clear = false) => {
    setError('');
    try {
      const auth: Record<string, string> = { type: authType };
      if (token) auth.token = token; if (user) auth.user = user; if (password) auth.password = password; if (header) auth.header = header; if (value) auth.value = value;
      const r = await api.post('archives', { ...(archive ? { id: archive.id } : { kind }), label, location, enabled, auth, ...(clear ? { clearCredential: true } : {}) });
      setToken(''); setPassword(''); setValue('');
      onSaved(r as never);
    } catch (e) { setError(String((e as Error).message)); }
  };
  return (
    <div className="axp-plugins-menu__form fx-stack">
      {!archive && <SelectField label="Kind" value={kind} onChange={(k) => { setKind(k); setAuthType(kinds.find((x) => x.id === k)?.auth[0] ?? 'none'); }}
        options={kinds.filter((k) => k.id !== 'axhub').map((k) => ({ value: k.id, label: k.label, disabled: !k.built }))} />}
      <TextField label="Name" value={label} onChange={setLabel} placeholder={spec?.label} />
      <TextField label="Location" value={location} onChange={setLocation} placeholder={spec?.location} mono />
      <SelectField label="Credentials" value={authType} onChange={setAuthType} options={(spec?.auth ?? ['none']).map((t) => ({ value: t, label: authTypes.find((a) => a.id === t)?.label ?? t }))} />
      {authType === 'bearer' && <TextField label="Token" type="password" value={token} onChange={setToken} placeholder={keep || (kind === 'axhub' ? 'axHub token (or set AXHUB_TOKEN on the console)' : 'token')} />}
      {authType === 'basic' && <><TextField label="User" value={user} onChange={setUser} /><TextField label="Password" type="password" value={password} onChange={setPassword} placeholder={keep} /></>}
      {authType === 'header' && <><TextField label="Header name" value={header} onChange={setHeader} mono placeholder="X-Api-Key" /><TextField label="Header value" type="password" value={value} onChange={setValue} placeholder={keep} /></>}
      {!archive?.permanent && <Switch label="Use this archive" checked={enabled} onChange={setEnabled} />}
      {error && <Note tone="danger">{error}</Note>}
      <div className="fx-row fx-row--wrap">
        <Button tone="primary" icon="check" onClick={() => void save()}>{archive ? 'Save' : 'Add archive'}</Button>
        {archive?.auth.set && !archive.auth.fromEnv && <Button tone="ghost" icon="x" onClick={() => void save(true)}>Clear the credential</Button>}
      </div>
    </div>
  );
}

function InstallerSettings({ config, onSaved }: { config: Config | null; onSaved: (c: Config) => void }) {
  const rt = useRuntime();
  const [archives, setArchives] = useState<Archive[]>([]);
  useEffect(() => { void api.call('archives').then((r) => setArchives((r as { archives: Archive[] }).archives)).catch(() => undefined); }, []);
  if (!config) return <p className="fx-muted">Loading…</p>;
  const set = async (patch: Partial<Config>) => {
    try { onSaved(((await api.put('config', patch)) as { config: Config }).config); } catch (e) { rt.toast(String((e as Error).message), 'danger', LABEL); }
  };
  return (
    <div className="fx-stack">
      <p className="fx-muted" style={{ margin: 0 }}>The installer's own settings, kept on the console server for every browser.</p>
      <Switch label="Commit installs to GitHub" hint="So the console keeps the plugin after its 5-minute update (needs GITHUB_TOKEN)." checked={config.publish} onChange={(v) => void set({ publish: v })} />
      <Switch label="Keep the old build's data when replacing" checked={config.keepDataOnReplace} onChange={(v) => void set({ keepDataOnReplace: v })} />
      <Switch label="List plugins that are already installed" checked={config.showInstalled} onChange={(v) => void set({ showInstalled: v })} />
      <Switch label="List Build Pilot plugins too" hint="Shown read-only: they install in Build Pilot." checked={config.showOtherKinds} onChange={(v) => void set({ showOtherKinds: v })} />
      <Switch label="Read the archives when the installer opens" checked={config.checkOnOpen} onChange={(v) => void set({ checkOnOpen: v })} />
      <Switch label="Type the folder name to confirm" hint="Off: tap the button twice instead." checked={config.confirmTyping} onChange={(v) => void set({ confirmTyping: v })} />
      <SelectField label="Sort by" value={config.sort} onChange={(v) => void set({ sort: v })} options={[{ value: 'name', label: 'Name' }, { value: 'archive', label: 'Archive' }, { value: 'newest', label: 'Newest' }, { value: 'model', label: 'Model' }]} />
      <SelectField label="Plugins per page" value={String(config.pageSize)} onChange={(v) => void set({ pageSize: Number(v) })} options={['10', '25', '50', '100', '200'].map((v) => ({ value: v, label: v }))} />
      <SelectField label="Archive shown first" value={config.defaultArchive} onChange={(v) => void set({ defaultArchive: v })} options={[{ value: 'all', label: 'Every archive' }, ...archives.map((a) => ({ value: a.id, label: a.label }))]} />
    </div>
  );
}

/* ------------------------------------------------------------------ the library */

const choice = (key: string, label: string, def: string, options: [string, string][], description?: string) => ({ key, label, kind: 'choice' as const, default: def, options: options.map(([value, l]) => ({ value, label: l })), ...(description ? { description } : {}) });
const toggle = (key: string, label: string, def: boolean, description?: string) => ({ key, label, kind: 'toggle' as const, default: def, ...(description ? { description } : {}) });

export const plugin: AxfWebLibrary = {
  id: ID,
  label: 'Plugins menu',
  version: '0.1.0',
  appMenu,
  register(rt) {
    rt.actions.register('plugins-menu.settings', () => rt.openDialog(SETTINGS_DIALOG), { label: 'Plugin settings' });
    rt.actions.register('plugins-menu.install', () => rt.openDialog(INSTALL_DIALOG), { label: 'Install plugins' });
    rt.actions.register('plugins-menu.manage', () => rt.dispatch('settings.open:plugins'), { label: 'Manage plugins' });
    rt.actions.register('plugins-menu.enable', ([folder]) => { if (folder) void setEnabled(rt, folder, true); }, { label: 'Enable a plugin', searchable: false });
    rt.actions.register('plugins-menu.disable', ([folder]) => { if (folder) void setEnabled(rt, folder, false); }, { label: 'Disable a plugin', searchable: false });
    refreshMenu(rt);
    if (menuListener) globalThis.removeEventListener(PLUGINS_CHANGED, menuListener);
    menuListener = () => refreshMenu(rt);
    globalThis.addEventListener(PLUGINS_CHANGED, menuListener);
  },
  dialogs: {
    [SETTINGS_DIALOG]: { title: 'Plugin settings', icon: 'settings', render: (props) => <SettingsBrowser ask={typeof props?.plugin === 'string' ? props.plugin : undefined} /> },
    [INSTALL_DIALOG]: { title: 'Install plugins', icon: 'download', render: () => <Installer /> },
  },
  settingsTabs: [{ id: TAB, label: 'Plugins menu', icon: 'package', order: 4, parent: 'plugins' }],
  settings: [
    { id: 'plugins-menu.basic', label: 'Basic', icon: 'sliders', tab: TAB, order: 10, description: 'The settings browser (right-click → Plugins → Settings…).', settings: [
      choice(K.column, 'Plugin column width', 'regular', [['narrow', 'Narrow'], ['regular', 'Regular'], ['wide', 'Wide']]),
      toggle(K.collapsed, 'Start with the plugin column folded', false),
      choice(K.side, 'Plugin column on the', 'left', [['left', 'Left'], ['right', 'Right']]),
    ] },
    { id: 'plugins-menu.style', label: 'Style', icon: 'palette', tab: TAB, order: 20, settings: [
      choice(K.density, 'Density', 'regular', [['compact', 'Compact'], ['regular', 'Regular'], ['roomy', 'Roomy']]),
      toggle(K.badges, 'Model badges in the list', true),
      toggle(K.icons, 'Icons in the list', true),
    ] },
    { id: 'plugins-menu.switches', label: 'Switches', icon: 'check', tab: TAB, order: 30, settings: [
      toggle(K.showOff, 'List plugins that are switched off', true),
      toggle(K.showBare, 'List plugins without settings', true),
      toggle(K.search, 'Search box above the list', true),
      toggle(K.remember, 'Remember the last plugin picked', true),
    ] },
    { id: 'plugins-menu.behaviour', label: 'Behaviour', icon: 'play', tab: TAB, order: 40, settings: [
      choice(K.onOpen, 'When it opens, show', 'last', [['last', 'The last plugin picked'], ['first', 'The first plugin'], ['self', "This browser's settings"], ['none', 'Nothing picked']]),
      choice(K.sort, 'Sort the list by', 'name', [['name', 'Name'], ['model', 'Model'], ['enabled', 'On first'], ['built', 'Newest build']]),
    ] },
  ],
  settingsPanels: [
    { id: 'plugins-menu.open', tab: TAB, title: 'Open', icon: 'package', order: 5, render: () => <OpenPanel /> },
    { id: 'plugins-menu.advanced', tab: TAB, title: 'Advanced: every parameter type', icon: 'code', order: 60, render: () => <AdvancedPlaceholders /> },
    { id: 'plugins-menu.lifecycle', tab: TAB, title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> },
  ],
};

function OpenPanel() {
  const rt = useRuntime();
  return (
    <div className="fx-stack">
      <p style={{ margin: 0 }}>Right-click or long-press anywhere → <strong>Plugins</strong>: Install, Settings, Manage, Enable, Disable.</p>
      <div className="fx-row fx-row--wrap">
        <Button tone="primary" icon="settings" onClick={() => rt.openDialog(SETTINGS_DIALOG)}>Plugin settings</Button>
        <Button icon="download" onClick={() => rt.openDialog(INSTALL_DIALOG)}>Install plugins</Button>
      </div>
    </div>
  );
}
