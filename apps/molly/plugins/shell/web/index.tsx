import { useState, useSyncExternalStore } from 'react';
import type { MenuItem } from '../../../src/axf/core/types';
import { FAVORITES_ID, RECENTS_ID, type MenuNode } from '../../../src/axf/core/engines/menu-index';
import { surfaceCounts } from '../../../src/axf/core/engines/shell-surface';
import { LAYOUT_MODES, type LayoutMode, type OpenTarget } from '../../../src/axf/core/engines/xlayout';
import { Button, SelectField, Switch, TextField, useRuntime } from '../../../src/axf/react';
import type { AxfWebLibrary } from '../../../src/axf/react/library';
import { provideMollyService } from '../../../src/molly/host';
import { GoPanel } from './GoPanel';
import { describeRef, FOLDER, K, PLUGIN_ID, SHELL_SERVICE, ShellModel, xlayout, type ShellService } from './model';
import helpPack from '../help.json';
import './shell.css';

/**
 * One shell (Molly): Molly is the one shell for every app (Brett, Nov 8 2026: "Molly becomes the single shell for every
 * app and plugin … Do NOT embed other apps"). This plugin holds the shell side of it:
 *   - one menu over every app (menu-index@1 over shell-surface@1): the Go menu in the application menu (sub menus by
 *     app and category, built on open, so a new plugin or screen appears by itself), Go to anything (search every app,
 *     sliding sub menus, favorites, recents), and Favorites / Recent right in the Go menu;
 *   - layout modes (single, tabs, split, IDE) and named layouts (save / switch / remove), through xLayout's capability;
 *   - capability `axf.shell@1`: native app mounts register their surface and opener (molly-one-shell s7/s8);
 *   - actions for every part (voice, the console API, MCP and the CLI reach them through plugin commands).
 * Settings → Plugins → One shell. Removing the folder removes all of it; Molly keeps its own menus and xLayout.
 */

const GO_DIALOG = 'shell.go';
const TAB = 'shell';
const MODE_LABEL: Record<LayoutMode, string> = { single: 'One at a time', tabs: 'Tabs', split: 'Side by side', ide: 'IDE (docked panes)' };
const MODE_HINT: Record<LayoutMode, string> = {
  single: 'One app or page on screen at a time; the menus switch between them.',
  tabs: 'Everything you open becomes a tab in one tab group.',
  split: 'Two containers side by side, each a tab group.',
  ide: 'Containers you dock, split, float and resize; any of them can be a tab group.',
};

let model: ShellModel | null = null;
const theModel = () => model!;
const useModel = () => { const m = theModel(); useSyncExternalStore((f) => m.subscribe(f), () => m.rev, () => m.rev); return m; };
let goQuery = '';

const argsOf = (args: string[], payload?: string) => (args.length ? args.join(':') : payload ?? '');
const TARGETS: readonly string[] = ['main', 'floating', 'pane'];

/** The Go menu: the index's top levels as application-menu sub menus (the deepest level opens Go to anything). */
function goMenuItems(m: ShellModel): MenuItem[] {
  const idx = m.index();
  const conv = (nodes: readonly MenuNode[], depth: number): MenuItem[] => nodes.map((n) => {
    if (n.kind === 'item') return { id: `shell.go.${n.id}`, label: n.label, icon: n.icon, action: `shell.open:${n.id}` };
    if (depth >= 3) return { id: `shell.go.${n.id}`, label: `${n.label} (${n.count})…`, icon: 'search', action: `shell.find:${n.label}` };
    return { id: `shell.go.${n.id}`, label: n.label, icon: n.icon ?? 'folder', items: conv(n.children, depth + 1) };
  });
  return [
    { id: 'shell.go.find', label: 'Go to anything…', icon: 'search', action: 'shell.go', shortcut: 'Ctrl+K' },
    { id: 'shell.go.sep', separator: true } as MenuItem,
    ...conv(idx.roots, 1),
  ];
}

export const plugin: AxfWebLibrary = {
  id: PLUGIN_ID,
  label: 'One shell',
  version: '0.1.0',
  provides: ['dialog:shell.go', 'settings-tab:shell'],
  builtWith: { model: 'opus', builtAt: '2026-11-08' },
  help: helpPack.data as AxfWebLibrary['help'],
  register(rt) {
    if (model) return; // one model per page (StrictMode runs this twice in development)
    model = new ShellModel(rt);
    const m = model;
    // the index follows everything that can change it: plugins and assets (runtime state), saved settings, xLayout's chrome
    rt.subscribe(() => m.changed());
    provideMollyService(PLUGIN_ID, SHELL_SERVICE, {
      register: (s, open) => m.register(s, open),
      surfaces: () => m.surfaces(),
      index: () => m.index(),
      open: (ref, target) => m.open(ref, target),
    } satisfies ShellService);
    rt.registerAppMenuProvider('shell.go', { items: () => goMenuItems(m), max: 40, module: PLUGIN_ID });

    const on = rt.actions.register.bind(rt.actions);
    on('shell.go', (args, ctx) => { goQuery = argsOf(args, ctx.payload); rt.openDialog(GO_DIALOG); }, { label: 'Go to anything…' });
    on('shell.find', (args, ctx) => { goQuery = argsOf(args, ctx.payload); rt.openDialog(GO_DIALOG); }, { label: 'Search every app' });
    on('shell.open', (args, ctx) => {
      // shell.open:<ref> or shell.open:<target>:<ref> (target main | floating | pane)
      const a = argsOf(args, ctx.payload).split(':');
      const target = TARGETS.includes(a[0] ?? '') ? (a.shift() as OpenTarget) : 'main';
      return m.open(a.join(':'), target);
    }, { label: 'Open anything (app:kind:id)' });
    on('shell.favorite', (args, ctx) => {
      const ref = argsOf(args, ctx.payload);
      if (!ref) return;
      const now = m.toggleFavorite(ref);
      rt.toast(`${describeRef(m, ref)} ${now ? 'is in Favorites' : 'left Favorites'}.`, 'info', 'Favorites');
    }, { label: 'Add to / remove from favorites' });
    on('shell.recents.clear', () => { m.clearRecents(); rt.toast('Recent is empty.', 'info', 'Recent'); }, { label: 'Clear recent' });
    on('shell.list', () => m.index(), { label: 'Every place in Molly (menu-index@1)' });
    on('shell.surfaces', () => m.surfaces(), { label: 'Every app surface in Molly (shell-surface@1)' });
    on('shell.mode', (args, ctx) => {
      const mode = argsOf(args, ctx.payload) as LayoutMode;
      if (!(LAYOUT_MODES as readonly string[]).includes(mode)) { rt.toast(`Layout modes: ${LAYOUT_MODES.join(', ')}.`, 'info', 'Layout'); return false; }
      return m.setMode(mode);
    }, { label: 'Layout mode (single | tabs | split | ide)' });
    on('shell.layout.save', (args, ctx) => {
      const name = argsOf(args, ctx.payload).trim();
      if (!name) { rt.dispatch(`settings.open:${TAB}`); return; }
      const l = m.saveLayout(name);
      if (l) rt.toast(`Saved “${l.label}”.`, 'success', 'Layouts');
    }, { label: 'Save this layout as…' });
    on('shell.layout.switch', (args, ctx) => {
      const id = argsOf(args, ctx.payload);
      if (!m.switchLayout(id)) rt.toast(`No layout called ${id}.`, 'warning', 'Layouts');
    }, { label: 'Switch to a named layout' });
    on('shell.layout.remove', (args, ctx) => { m.removeLayout(argsOf(args, ctx.payload)); }, { label: 'Remove a named layout' });
    on('shell.settings', () => rt.dispatch(`settings.open:${TAB}`), { label: 'One shell settings…' });
  },
  dialogs: { [GO_DIALOG]: { title: 'Go to anything', icon: 'search', render: (_p, close) => { const q = goQuery; goQuery = ''; return <GoPanel model={theModel()} close={close} query={q} />; } } },
  settingsTabs: [{ id: TAB, label: 'One shell', icon: 'layers', order: 30, parent: 'plugins', description: 'Every app in one menu, layout modes and named layouts.' }],
  settingsPanels: [
    { id: 'shell.layout', tab: TAB, title: 'Layout', icon: 'layout', order: 10, render: () => <LayoutPanel /> },
    { id: 'shell.layouts', tab: TAB, title: 'Named layouts', icon: 'layers', order: 20, render: () => <LayoutsPanel /> },
    { id: 'shell.menus', tab: TAB, title: 'Menus', icon: 'menu', order: 30, render: () => <MenusPanel /> },
    { id: 'shell.favorites', tab: TAB, title: 'Favorites and recent', icon: 'star', order: 40, render: () => <FavoritesPanel /> },
    { id: 'shell.apps', tab: TAB, title: 'Apps in Molly', icon: 'grid', order: 50, render: () => <AppsPanel /> },
    { id: 'shell.lifecycle', tab: TAB, title: 'Install & uninstall', icon: 'package', order: 90, render: () => <LifecyclePanel /> },
  ],
  appMenu: [
    { id: 'shell.go-menu', menu: 'go', menuLabel: 'Go', menuOrder: 25, order: 10, items: [
      { id: 'shell.everything', label: 'Everything', icon: 'layers', provider: 'shell.go' },
      { id: 'shell.go-find', label: 'Go to anything…', icon: 'search', action: 'shell.go' },
    ] },
    { id: 'shell.view', menu: 'view', menuLabel: 'View', menuOrder: 30, order: 15, items: [
      ...LAYOUT_MODES.map((mode) => ({ id: `shell.mode.${mode}`, label: `Layout: ${MODE_LABEL[mode]}`, icon: 'layout', action: `shell.mode:${mode}` })),
      { id: 'shell.layout-save', label: 'Save this layout as…', icon: 'save', action: 'shell.layout.save' },
    ] },
  ],
  contextMenu: [
    { id: 'shell.ctx.go', target: 'shell-go', items: [
      { id: 'shell.ctx.settings', label: 'One shell settings…', icon: 'settings', action: 'shell.settings' },
      { id: 'shell.ctx.recents', label: 'Clear recent', icon: 'trash', action: 'shell.recents.clear' },
    ] },
    { id: 'shell.ctx.default', target: 'default', items: [
      { id: 'shell.ctx.find', label: 'Go to anything…', icon: 'search', action: 'shell.go' },
    ] },
  ],
};

/* ---------- Settings → Plugins → One shell ---------- */

function LayoutPanel() {
  const m = useModel();
  const rt = useRuntime();
  const x = xlayout();
  const cur = x?.mode().mode ?? 'single';
  if (!x) return <p className="fx-muted">Layout modes come from the xLayout plugin, which isn't installed.</p>;
  return (
    <div className="fx-stack">
      <SelectField label="Layout mode" hint={MODE_HINT[cur]} value={cur} options={LAYOUT_MODES.map((v) => ({ value: v, label: MODE_LABEL[v] }))} onChange={(v) => m.setMode(v as LayoutMode)} />
      {cur === 'ide' && <div className="fx-form__actions"><Button icon="layout" onClick={() => rt.dispatch('xlayout.layout')}>Pane layout…</Button></div>}
    </div>
  );
}

function LayoutsPanel() {
  const m = useModel();
  const [name, setName] = useState('');
  const layouts = m.layouts();
  const active = m.activeLayout();
  return (
    <div className="fx-stack">
      <p className="fx-muted">A named layout keeps the mode, the pane layout and where everything is. Switch with a tap, or say “switch to my review layout”.</p>
      <ul className="fx-menu axp-shell-list" aria-label="Named layouts">
        {layouts.map((l) => (
          <li key={l.id} className="fx-menu__li axp-shell-go__row">
            <button type="button" className={`fx-menu__item ${l.id === active ? 'is-checked' : ''}`.trim()} aria-pressed={l.id === active} onClick={() => m.switchLayout(l.id)}>
              <span className="fx-menu__label">{l.label}</span><span className="fx-muted">{MODE_LABEL[l.mode]}</span>
            </button>
            <Button size="sm" icon="trash" confirm={`Remove the layout “${l.label}”?`} onClick={() => m.removeLayout(l.id)}>Remove</Button>
          </li>
        ))}
        {!layouts.length && <li className="fx-empty">No named layouts yet.</li>}
      </ul>
      <div className="axp-shell-row">
        <TextField label="Save what's on screen as" placeholder="Review, Coding, Phone…" value={name} onChange={setName} />
        <Button icon="save" disabled={!name.trim()} onClick={() => { m.saveLayout(name.trim()); setName(''); }}>Save layout</Button>
      </div>
    </div>
  );
}

function MenusPanel() {
  const m = useModel();
  const rt = useRuntime();
  const hidden = m.hiddenApps();
  const apps = m.surfaces().map((s) => s.app);
  return (
    <div className="fx-stack">
      <SelectField label="Most entries on one menu level" hint="Longer levels fold into A–F style sub menus, so every list stays short on a phone." value={String(m.maxPerLevel())} options={[6, 8, 10, 12, 16, 20, 30].map((n) => ({ value: String(n), label: String(n) }))} onChange={(v) => { rt.settings.set(K.maxPerLevel, Number(v)); m.changed(); }} />
      {apps.map((a) => (
        <Switch key={a.id} label={`Show ${a.label} in the menus`} checked={!hidden.includes(a.id)} onChange={(on) => { rt.settings.set(K.hiddenApps, JSON.stringify(on ? hidden.filter((h) => h !== a.id) : [...hidden, a.id])); m.changed(); }} />
      ))}
    </div>
  );
}

function FavoritesPanel() {
  const m = useModel();
  const favs = m.favorites();
  return (
    <div className="fx-stack">
      <ul className="fx-menu axp-shell-list" aria-label="Favorites">
        {favs.map((r) => (
          <li key={r} className="fx-menu__li axp-shell-go__row">
            <button type="button" className="fx-menu__item" onClick={() => m.open(r)}><span className="fx-menu__label">{describeRef(m, r)}</span></button>
            <Button size="sm" icon="x" onClick={() => m.toggleFavorite(r)}>Remove</Button>
          </li>
        ))}
        {!favs.length && <li className="fx-empty">No favorites yet: tap the star next to anything in Go to anything.</li>}
      </ul>
      <div className="fx-form__actions">
        <Button icon="trash" onClick={() => m.clearRecents()}>Clear recent ({m.recents().length})</Button>
        <Button icon="refresh" onClick={() => m.pruneSaved()}>Drop places that are gone</Button>
      </div>
    </div>
  );
}

function AppsPanel() {
  const m = useModel();
  const idx = m.index();
  const surfaces = m.surfaces();
  return (
    <div className="fx-stack">
      <p className="fx-muted">Every app Molly holds and what it brings into the one menu. “Native” apps mount in Molly itself; “through xLayout” apps still show in their own frame until their native mount lands.</p>
      <ul className="fx-menu axp-shell-list" aria-label="Apps">
        {surfaces.map((s) => {
          const c = surfaceCounts(s);
          return (
            <li key={s.app.id} className="fx-menu__li">
              <div className="fx-menu__item">
                <span className="fx-menu__label">{s.app.label}</span>
                <span className="fx-muted">{Object.entries(c).map(([k, n]) => `${n} ${k}`).join(' · ') || 'nothing yet'}</span>
                <span className="fx-chip">{s.app.id === 'molly' || !m.isStopgap(s.app.id) ? 'native' : 'through xLayout'}</span>
              </div>
            </li>
          );
        })}
      </ul>
      <p className="fx-muted">{idx.total} places in all; {idx.roots.filter((r) => r.id === FAVORITES_ID || r.id === RECENTS_ID).length ? 'favorites and recent first.' : 'no favorites or recent yet.'}</p>
    </div>
  );
}

function LifecyclePanel() {
  return (
    <div className="fx-stack">
      <p className="fx-muted">One shell's code is all in apps/molly/plugins/{FOLDER}. Install or remove it (Molly keeps its own menus and xLayout):</p>
      <pre className="axp-shell-code">{`node apps/molly/plugins/${FOLDER}/install.mjs\nnode apps/molly/plugins/${FOLDER}/uninstall.mjs --all`}</pre>
    </div>
  );
}
