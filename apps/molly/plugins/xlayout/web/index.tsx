import { useSyncExternalStore } from 'react';
import type { AxfRuntime } from '../../../src/axf/core';
import { TOOLBAR_LOCATIONS, type ToolbarLocation } from '../../../src/axf/core/engines/xlayout';
import { Button, SelectField, Switch, useAxfState, useRuntime } from '../../../src/axf/react';
import type { AxfWebLibrary } from '../../../src/axf/react/library';
import { appOfView, mollyService, provideMollyService, setMollyHook } from '../../../src/molly/host';
import { ChromeHost, RUN_ACTION } from './host';
import { effectiveXLayout, FOLDER, K, PLUGIN_ID, saveSlotItems, SLOTS } from './model';
import { declaredToolbars, barKey, runToolbarItem, TOOLBAR_CTX, WithToolbars } from './toolbars';

/** Apps Molly opens hidden at start because they take remote commands (the Dev Console's console-commands). */
const WARM_APPS = ['console'];
import { APP_TAB, AppMain, AppTab, applyPresetById, enterIde, keepIde, LAYOUT_DIALOG, LayoutPicker, openApp } from './workspace';
import { LAYOUT_MODE_PRESET, type LayoutMode } from '../../../src/axf/core/engines/xlayout';
import helpPack from '../help.json';
import './xlayout.css';

/**
 * xLayout (Molly): Molly as ONE app. One banner (Molly's), one application menu, one navigation and one context menu
 * across the whole page, holding AmberX's, axHub's and the Console's (they hide their own and send them as data); an
 * IDE switch that puts the apps in draggable, resizable, dockable panes, with ten preset layouts; up to three plugin
 * toolbars. Settings: Settings → Plugins → xLayout. Switched off or removed, Molly frames each app plainly again and
 * the apps draw their own chrome, exactly as they do on their own.
 */

/** The Toolbar designer's capability (its own plugin): open it for a toolbar, or say it isn't installed. */
export const DESIGNER = 'axf.toolbar-designer@1';
export interface ToolbarDesigner { open(target: { plugin: string; screen: string; slot: number }): void }

/** xLayout's own capability (`axf.xlayout@1`): what the Toolbar designer reads and saves, without knowing this folder. */
export const XLAYOUT_SERVICE = 'axf.xlayout@1';
export interface XLayoutService {
  /** the xlayout in force (apps, merge rules, IDE, the three toolbar slots) */
  layout(): import('../../../src/axf/core/engines/xlayout').XLayoutData;
  /** every app's chrome merged (menus, navigation, toolbars), for picking items */
  chrome(): import('../../../src/axf/core/engines/chrome').UnifiedChrome;
  /** save one slot's items (last save wins) */
  saveSlot(slot: number, items: import('../../../src/axf/core/engines/xlayout').XToolbarItem[]): void;
  /** run an item now (try it) */
  run(item: import('../../../src/axf/core/engines/xlayout').XToolbarItem): void;
  /** the layout mode in force (single | tabs | split | ide) and the preset it uses */
  mode(): { mode: LayoutMode; preset: string };
  /** switch the layout mode (tabs / split / ide lay the apps out on the dock with the preset; single = one at a time) */
  setMode(mode: LayoutMode, preset?: string): boolean;
  /** the dock arrangement now (dock@1 snapshot, null when nothing is docked), to keep in a named layout */
  snapshot(): unknown;
  /** bring back an arrangement taken by snapshot() */
  restore(snapshot: unknown): boolean;
}

let host: ChromeHost | null = null;
const theHost = () => host!;
const useHost = () => { const h = theHost(); useSyncExternalStore((f) => h.subscribe(f), () => h.rev, () => h.rev); return h; };

function customize(rt: AxfRuntime, payload = 'xlayout|*|1') {
  const [plugin = 'xlayout', screen = '*', slot = '1'] = payload.split('|');
  const d = mollyService<ToolbarDesigner>(DESIGNER);
  if (d) d.open({ plugin, screen, slot: Number(slot) || 1 });
  else rt.toast('Install the Toolbar designer plugin to pick what this toolbar holds.', 'info', 'Toolbar designer');
}

/** What an app's view (or one of its pages) shows: the frame, or the IDE dock, inside the toolbars. */
function Main({ app }: { app: string }) {
  const h = useHost();
  return <WithToolbars host={h}><AppMain app={app} /></WithToolbars>;
}

/* ---------- Settings → Plugins → xLayout ---------- */

function useSetting(key: string) {
  const rt = useRuntime();
  return useSyncExternalStore((f) => rt.settings.onChange(key, f), () => rt.settings.get(key), () => rt.settings.get(key));
}

function IdePanel() {
  const rt = useRuntime();
  useSetting(K.ideOn); useSetting(K.preset); useSetting(K.paneLimit);
  const l = effectiveXLayout(rt);
  const presets = rt.registry.list('dock-layout' as never) as unknown as { id: string; name: string }[];
  return (
    <div className="fx-stack">
      <Switch label="IDE mode" hint="Apps open as tabs in panes you drag, resize and dock, instead of one app at a time. Other layout modes: Settings → Plugins → One shell." checked={l.ide.on} onChange={(on) => { rt.settings.set(K.ideOn, on); rt.settings.set(K.mode, on ? 'ide' : 'single'); if (on) enterIde(rt); else keepIde(rt); }} />
      <SelectField label="Pane layout" hint="The layout IDE mode starts with. Pick one with a preview: Choose layout." value={l.ide.preset} options={l.ide.presets.filter((p) => presets.some((x) => x.id === p)).map((p) => ({ value: p, label: presets.find((x) => x.id === p)?.name ?? p }))} onChange={(v) => rt.settings.set(K.preset, v)} />
      <SelectField label="Pane limit" hint="The most panes at once; a tab dropped past it joins a pane as a tab." value={String(l.ide.paneLimit)} options={Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: String(i + 1) }))} onChange={(v) => { rt.settings.set(K.paneLimit, Number(v)); rt.windows.setDockRules({ paneLimit: Number(v) }); }} />
      <div className="fx-form__actions"><Button icon="layout" onClick={() => rt.openDialog(LAYOUT_DIALOG)}>Choose layout…</Button></div>
    </div>
  );
}

const LOCATION_OPTIONS = TOOLBAR_LOCATIONS.map((l) => ({ value: l, label: l[0]!.toUpperCase() + l.slice(1) }));

function ToolbarsPanel() {
  const rt = useRuntime();
  useAxfState();
  for (const s of SLOTS) { useSetting(K.visible(s)); useSetting(K.location(s)); useSetting(K.items(s)); }
  const l = effectiveXLayout(rt);
  return (
    <div className="fx-stack">
      {l.toolbars.map((t) => (
        <div key={t.slot} className="axp-xlayout-slot">
          <Switch label={`${t.label} (toolbar ${t.slot})`} hint={`${t.items.length} item${t.items.length === 1 ? '' : 's'}${t.slot === 1 ? ', plus the toolbars of the app on screen' : ''}`} checked={t.visible} onChange={(on) => rt.settings.set(K.visible(t.slot), on)} />
          <SelectField label="Where" value={t.location} options={LOCATION_OPTIONS} onChange={(v) => rt.settings.set(K.location(t.slot), v as ToolbarLocation)} />
          <Button icon="edit" onClick={() => customize(rt, `xlayout|*|${t.slot}`)}>Customize…</Button>
        </div>
      ))}
      {declaredToolbars().filter((d) => d.plugin !== PLUGIN_ID).map((d) => d.bars.map((b) => {
        const vk = barKey(d.plugin, d.screen, b.slot, 'visible'), lk = barKey(d.plugin, d.screen, b.slot, 'location');
        const v = rt.settings.get(vk), loc = rt.settings.get(lk);
        return (
          <div key={vk} className="axp-xlayout-slot">
            <Switch label={`${d.label} · ${b.label}`} hint={d.screen === '*' ? 'Every screen' : `On ${d.screen}`} checked={typeof v === 'boolean' ? v : b.visible} onChange={(on) => rt.settings.set(vk, on)} />
            <SelectField label="Where" value={typeof loc === 'string' ? loc : b.location} options={LOCATION_OPTIONS} onChange={(x) => rt.settings.set(lk, x)} />
          </div>
        );
      }))}
    </div>
  );
}

function AppsPanel() {
  const h = useHost();
  const rt = useRuntime();
  const l = effectiveXLayout(rt);
  const on = new Set(h.connected());
  return (
    <div className="fx-stack">
      <p className="fx-muted">Molly shows one banner, one application menu, one navigation and one context menu. These apps hide their own and send theirs here; on their own they stay exactly as they are.</p>
      <ul className="axp-xlayout-apps">
        {l.apps.map((a) => <li key={a.id}><strong>{a.label}</strong> <span className="fx-muted">{on.has(a.id) ? 'joined: its menus, navigation, context menu and toolbars are in Molly’s' : 'not open yet, or not sending its chrome (an older build of it draws its own)'}</span></li>)}
      </ul>
      {h.chrome().notes.length > 0 && <p className="fx-muted">{h.chrome().notes.join(' · ')}</p>}
    </div>
  );
}

function LifecyclePanel() {
  return (
    <div className="fx-stack">
      <p className="fx-muted">xLayout's code is all in apps/molly/plugins/{FOLDER}. Install or remove it (Molly then frames each app plainly):</p>
      <pre className="axp-xlayout-code">{`node apps/molly/plugins/${FOLDER}/install.mjs\nnode apps/molly/plugins/${FOLDER}/uninstall.mjs --all`}</pre>
    </div>
  );
}

/* ---------- the library ---------- */

export const plugin: AxfWebLibrary = {
  id: PLUGIN_ID,
  label: 'xLayout',
  version: '0.1.0',
  provides: ['view:xlayout', 'dialog:xlayout.layout', 'settings-tab:xlayout'],
  builtWith: { model: 'opus', builtAt: '2026-11-03' },
  help: helpPack.data as AxfWebLibrary['help'],
  register(rt) {
    if (host) return; // one host per page (StrictMode runs this twice in development)
    host = new ChromeHost(rt, () => effectiveXLayout(rt));
    host.start();
    const h = host;
    setMollyHook(PLUGIN_ID, 'frameUrl', (a, start) => h.frameUrl(a, start));
    setMollyHook(PLUGIN_ID, 'onFrame', (app, el) => h.frame(app, el));
    setMollyHook(PLUGIN_ID, 'main', (app) => <Main app={app} />);
    // the apps that take remote commands (console-commands) open hidden at once, so "Amber, open Plan Studio" finds a
    // console inside Molly and Molly brings it to the front (embed@1 `show`)
    setMollyHook(PLUGIN_ID, 'warm', WARM_APPS);
    // each app's pages become Molly views (`<app>/<item>`), so the one navigation can hold them
    const views = () => setMollyHook(PLUGIN_ID, 'views', Object.fromEntries(Object.entries(h.navViews).map(([id, v]) => [id, { title: v.title, icon: v.icon, render: () => <Main app={id.split('/')[0]!} /> }])));
    let lastViews = '';
    h.subscribe(() => { const k = Object.keys(h.navViews).join(','); if (k !== lastViews) { lastViews = k; views(); } });
    const on = rt.actions.register.bind(rt.actions);
    on(RUN_ACTION, (args) => { h.run(args.join(':')); }, { label: 'Run an app’s menu item' });
    on('xlayout.ide', () => { const now = !effectiveXLayout(rt).ide.on; rt.settings.set(K.ideOn, now); rt.settings.set(K.mode, now ? 'ide' : 'single'); if (now) enterIde(rt); else keepIde(rt); rt.toast(now ? 'Apps open in panes now.' : 'One app at a time again.', 'info', now ? 'IDE mode on' : 'IDE mode off'); }, { label: 'IDE mode on / off' });
    on('xlayout.layout', () => rt.openDialog(LAYOUT_DIALOG), { label: 'Pane layout…' });
    on('xlayout.open', (args, ctx) => {
      const [target = 'main', ...rest] = args;
      const app = appOfView(rest.join(':') || ctx.payload || rt.getState().view)?.id;
      if (!app) { rt.toast('Open an app first.', 'info', 'Open in'); return; }
      openApp(rt, app, target === 'pane' || target === 'floating' ? target : 'main');
    }, { label: 'Open an app in the main area, a floating window or a pane' });
    on('xlayout.customize', (_args, ctx) => customize(rt, ctx.payload), { label: 'Customize toolbar…' });
    provideMollyService(PLUGIN_ID, XLAYOUT_SERVICE, {
      layout: () => effectiveXLayout(rt),
      chrome: () => h.chrome(),
      saveSlot: (slot, items) => saveSlotItems(rt, slot, items),
      run: (item) => runToolbarItem(rt, h, item),
      mode: () => { const l = effectiveXLayout(rt); return { mode: l.mode, preset: l.mode === 'ide' ? l.ide.preset : LAYOUT_MODE_PRESET[l.mode] }; },
      setMode: (mode, preset) => applyPresetById(rt, preset ?? (mode === 'ide' ? effectiveXLayout(rt).ide.preset : LAYOUT_MODE_PRESET[mode]), mode),
      snapshot: () => rt.windows.snapshot(),
      restore: (snap) => { try { const ok = rt.windows.restoreLayout(snap); if (ok) keepIde(rt); return ok; } catch { return false; } },
    } satisfies XLayoutService);
    rt.settings.onChange(K.paneLimit, () => rt.windows.setDockRules({ paneLimit: effectiveXLayout(rt).ide.paneLimit }));
  },
  tabs: { [APP_TAB]: (t) => <AppTab app={t.payload ?? ''} /> },
  dialogs: { [LAYOUT_DIALOG]: { title: 'Pane layout', icon: 'layout', render: (_p, close) => <LayoutPicker close={close} /> } },
  // Settings → Plugins → xLayout (a sub-tab of Plugins, like every plugin's)
  settingsTabs: [{ id: 'xlayout', label: 'xLayout', icon: 'layout', order: 40, parent: 'plugins', description: 'Molly as one app: merged menus, IDE panes, toolbars.' }],
  settingsPanels: [
    { id: 'xlayout.ide', tab: 'xlayout', title: 'IDE mode', icon: 'layout', order: 10, render: () => <IdePanel /> },
    { id: 'xlayout.toolbars', tab: 'xlayout', title: 'Toolbars', icon: 'hammer', order: 20, render: () => <ToolbarsPanel /> },
    { id: 'xlayout.apps', tab: 'xlayout', title: 'One app', icon: 'external', order: 30, render: () => <AppsPanel /> },
    { id: 'xlayout.lifecycle', tab: 'xlayout', title: 'Install & uninstall', icon: 'package', order: 90, render: () => <LifecyclePanel /> },
  ],
  appMenu: [
    { id: 'xlayout.view', menu: 'view', menuLabel: 'View', menuOrder: 30, order: 20, items: [
      { id: 'xlayout.ide', label: 'IDE mode', icon: 'layout', action: 'xlayout.ide', checked: 'setting:xlayout.ide.on' },
      { id: 'xlayout.layout', label: 'Pane layout…', icon: 'layout', action: 'xlayout.layout' },
      { id: 'xlayout.open-pane', label: 'Open this app in a pane', icon: 'grid', action: 'xlayout.open:pane' },
      { id: 'xlayout.open-floating', label: 'Open this app in a floating window', icon: 'monitor', action: 'xlayout.open:floating' },
      { id: 'xlayout.settings', label: 'xLayout settings…', icon: 'settings', action: 'settings.open:xlayout' },
    ] },
  ],
  contextMenu: [
    { id: 'xlayout.toolbar', target: TOOLBAR_CTX, items: [
      { id: 'xlayout.customize', label: 'Customize toolbar…', icon: 'edit', action: 'xlayout.customize' },
      { id: 'xlayout.toolbar-settings', label: 'Toolbar settings…', icon: 'settings', action: 'settings.open:xlayout' },
    ] },
    { id: 'xlayout.nav', target: 'nav-item', items: [
      { id: 'xlayout.nav-pane', label: 'Open in a pane', icon: 'grid', action: 'xlayout.open:pane:{payload}' },
      { id: 'xlayout.nav-floating', label: 'Open in a floating window', icon: 'monitor', action: 'xlayout.open:floating:{payload}' },
    ] },
  ],
};

