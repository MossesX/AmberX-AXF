/**
 * Settings → Plugins → Plugin Manager → Lazy loader (plugin-lazy@1; Brett, Nov 3 2026: "Put in the plugin manager plugin
 * all the ways to configure the lazy loader"). The loader itself is the console's (src/pluginLoader.tsx); this panel
 * edits its config through this plugin's server part (`/lazy`, also REST / MCP / CLI) and shows its live table.
 */
import { useState, type DragEvent } from 'react';
import { Button, Chip, IconButton, Note, Segmented, Slider, Switch, useRuntime } from '@console/axf/react';
import { bundledPlugins, pluginApi } from '@console/plugins';
import { CORE_PLUGINS, LAZY_DEFAULTS, loader, normalizeLazyConfig, useLoaderVersion, type LazyConfig, type LazyMode, type PluginLoadRow, type StartReason } from '@console/pluginLoader';
import { FOLDER } from './model';

const api = pluginApi(FOLDER, 'The Plugin Manager');

const nameOf = (folder: string) => bundledPlugins.find((p) => p.folder === folder)?.manifest.name ?? folder;
const kb = (n: number | null) => (n == null ? '—' : n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(2)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const ago = (t: number | null) => {
  if (!t) return 'never';
  const m = Math.round((Date.now() - t) / 60000);
  return m < 1 ? 'now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};

const STATE: Record<PluginLoadRow['state'], { label: string; tone?: 'accent' | 'success' | 'warning' | 'danger' }> = {
  loaded: { label: 'Loaded', tone: 'success' },
  cached: { label: 'Cached', tone: 'accent' },
  loading: { label: 'Loading', tone: 'warning' },
  'not-loaded': { label: 'Not loaded' },
  error: { label: 'Error', tone: 'danger' },
  disabled: { label: 'Disabled' },
};
const WHY: Record<StartReason, string> = { banner: 'Banner', core: 'Core', pin: 'Pinned', start: 'Load on start', used: 'Most used', learn: 'First load' };
const MODES: { value: LazyMode; label: string; title: string }[] = [
  { value: 'start', label: 'Start', title: 'Load on start' },
  { value: 'open', label: 'Open', title: 'Load when opened' },
  { value: 'off', label: 'Off', title: "Disabled: don't load at all (hidden from menus, its commands say it's off)" },
];

export function LazyLoaderPanel() {
  useLoaderVersion();
  const rt = useRuntime();
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState<string | null>(null);
  const cfg = loader.config;

  const save = async (next: LazyConfig) => {
    loader.setConfig(next);
    try { await api.put('lazy', { config: loader.config }); } catch (e) { rt.toast(`${(e as Error).message} The change applies in this browser only.`, 'warning', 'Lazy loader'); }
  };
  const patch = (p: Partial<LazyConfig>) => void save(normalizeLazyConfig({ ...cfg, ...p }));
  const reset = async () => {
    setBusy(true);
    loader.setConfig(LAZY_DEFAULTS);
    try { await api.post('lazy/reset', {}); rt.toast('Lazy loader back to its defaults.', 'success', 'Lazy loader'); } catch (e) { rt.toast((e as Error).message, 'warning', 'Lazy loader'); }
    setBusy(false);
  };

  const start = loader.startupPreview();
  const order = start.map((x) => x.folder);
  const move = (folder: string, to: number) => {
    const list = order.filter((f) => f !== folder);
    list.splice(Math.max(0, Math.min(list.length, to)), 0, folder);
    patch({ order: list });
  };
  const onDrop = (e: DragEvent, i: number) => { e.preventDefault(); if (drag) move(drag, i); setDrag(null); };
  const togglePin = (folder: string, on: boolean) => patch({ pins: on ? [...cfg.pins, folder] : cfg.pins.filter((f) => f !== folder) });
  const setMode = (folder: string, mode: LazyMode) => patch({ modes: { ...cfg.modes, [folder]: mode } });

  const rows = loader.rows(loader.enabledNow).sort((a, b) => order.indexOf(a.folder) - order.indexOf(b.folder) || (a.state === b.state ? 0 : a.state === 'loaded' ? -1 : 1) || nameOf(a.folder).localeCompare(nameOf(b.folder)));
  const loaded = rows.filter((r) => r.state === 'loaded').length;
  const boot = loader.readyAt && loader.bootedAt ? Math.round(loader.readyAt - loader.bootedAt) : null;

  return (
    <div className="axp-plugin-manager-lazy fx-stack">
      <p className="axp-plugin-manager-lazy__lead">
        Each plugin is its own download, loaded the first time you open it. Its menus, pages, settings and commands are there from the start and load it when used.
      </p>
      <div className="axp-plugin-manager-lazy__stats">
        <Chip tone="success">{loaded} of {rows.filter((r) => r.state !== 'disabled').length} loaded</Chip>
        {loader.startup && <Chip>Startup bundle {kb(loader.startup.bytes)}</Chip>}
        {boot != null && <Chip>Startup plugins ready in {boot} ms</Chip>}
      </div>

      <h4 className="axp-plugin-manager-h">At startup</h4>
      <Switch label="Banners load first" hint="Every banner plugin loads before anything else, in parallel, so banners show at first paint." checked={cfg.bannersFirst} onChange={(v) => patch({ bannersFirst: v })} />
      <Slider label="Most-used plugins to preload" value={cfg.preloadCount} min={0} max={20} onChange={(v) => patch({ preloadCount: v })} />
      <p className="fx-muted axp-plugin-manager-lazy__hint">Drag to change the order (or use the arrows). Pinned plugins always preload.</p>
      <ol className="axp-plugin-manager-lazy__order">
        {start.map((x, i) => (
          <li key={x.folder} className={`axp-plugin-manager-lazy__item${drag === x.folder ? ' is-dragging' : ''}`} draggable
            onDragStart={() => setDrag(x.folder)} onDragEnd={() => setDrag(null)} onDragOver={(e) => e.preventDefault()} onDrop={(e) => onDrop(e, i)}>
            <span className="axp-plugin-manager-count">{i + 1}</span>
            <span className="axp-plugin-manager-lazy__name">{nameOf(x.folder)}</span>
            <Chip tone={x.reason === 'banner' ? 'accent' : undefined}>{WHY[x.reason]}</Chip>
            <span className="axp-plugin-manager-iconbtns">
              <IconButton icon="chevron-up" label={`Move ${nameOf(x.folder)} up`} disabled={i === 0} onClick={() => move(x.folder, i - 1)} />
              <IconButton icon="chevron-down" label={`Move ${nameOf(x.folder)} down`} disabled={i === start.length - 1} onClick={() => move(x.folder, i + 1)} />
            </span>
          </li>
        ))}
        {!start.length && <li className="fx-muted">Nothing preloads: every plugin loads when opened.</li>}
      </ol>

      <h4 className="axp-plugin-manager-h">When the app is quiet</h4>
      <Switch label="Idle preload" hint="Load the next most-used plugins in the background once the console is idle." checked={cfg.idle.on} onChange={(v) => patch({ idle: { ...cfg.idle, on: v } })} />
      {cfg.idle.on && <Slider label="Plugins to load when idle" value={cfg.idle.count} min={0} max={30} onChange={(v) => patch({ idle: { ...cfg.idle, count: v } })} />}

      <h4 className="axp-plugin-manager-h">Cache</h4>
      <Slider label="Plugins kept loaded (least recently used goes first)" value={cfg.cache.size} min={1} max={60} onChange={(v) => patch({ cache: { ...cfg.cache, size: v } })} />
      <Switch label="Keep plugin chunks for offline use" hint="Loaded plugins' files are kept in the browser's cache storage, up to the size below." checked={cfg.cache.offline}
        onChange={(v) => { patch({ cache: { ...cfg.cache, offline: v } }); if (!v) void loader.clearOffline(); }} />
      {cfg.cache.offline && <Slider label="Offline cache size" unit=" MB" value={cfg.cache.offlineMb} min={5} max={200} step={5} onChange={(v) => patch({ cache: { ...cfg.cache, offlineMb: v } })} />}

      <h4 className="axp-plugin-manager-h">Every plugin</h4>
      <div className="fx-tablewrap">
        <table className="fx-table axp-plugin-manager-lazy__table">
          <thead><tr><th>Plugin</th><th>State</th><th>Loads</th><th>Pin</th><th>Size</th><th>Load time</th><th>Last used</th><th>Uses</th></tr></thead>
          <tbody>
            {rows.map((r) => {
              const pinned = cfg.pins.includes(r.folder);
              return (
                <tr key={r.folder} title={r.error ?? r.eager ?? undefined}>
                  <td>
                    <span className="axp-plugin-manager-lazy__name">{nameOf(r.folder)}</span>
                    {r.banner && <Chip tone="accent">Banner</Chip>}
                    {r.core && <Chip>Core</Chip>}
                  </td>
                  <td><Chip tone={STATE[r.state].tone}>{STATE[r.state].label}</Chip></td>
                  <td>
                    <Segmented size="sm" label={`How ${nameOf(r.folder)} loads`} value={r.mode} onChange={(m) => setMode(r.folder, m)}
                      options={MODES.map((m) => ({ ...m, disabled: m.value === 'off' && !!CORE_PLUGINS[r.folder] }))} />
                  </td>
                  <td><Switch label={`Always preload ${nameOf(r.folder)}`} hideLabel checked={pinned} disabled={r.mode === 'off'} onChange={(v) => togglePin(r.folder, v)} /></td>
                  <td className="axp-plugin-manager-lazy__num">{kb(r.bytes)}</td>
                  <td className="axp-plugin-manager-lazy__num">{r.loadMs == null ? '—' : `${r.loadMs} ms`}</td>
                  <td>{ago(r.lastUsed)}</td>
                  <td className="axp-plugin-manager-lazy__num">{r.uses}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {rows.some((r) => r.eager) && <Note tone="info">Plugins marked in their row tooltip load at startup: their library has something the loader can't stand in for.</Note>}

      <div className="fx-row fx-row--wrap">
        <Button icon="refresh" busy={busy} onClick={() => void reset()}>Reset to defaults</Button>
        <Button icon="trash" onClick={() => { loader.forget(); rt.toast('Usage and learned plugin shapes cleared; the next start learns them again.', 'info', 'Lazy loader'); }}>Forget usage</Button>
      </div>
    </div>
  );
}
