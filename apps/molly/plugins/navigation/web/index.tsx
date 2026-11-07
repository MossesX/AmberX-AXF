import type { AxfRuntime } from '../../../src/axf/core';
import type { NavItem } from '../../../src/axf/core/types';
import { CONTROL_TOKEN_SLOTS } from '../../../src/axf/core/engines/control-tokens.mjs';
import { NAV_COLLAPSED_KEY } from '../../../src/axf/core/runtime';
import { NAV_STYLE_GROUP_ICONS, NAV_STYLE_GROUP_IDS, NAV_STYLE_GROUP_TITLES, NavStyleGroup, NavStyleSettings, setNavStyleField, useAxfState, useRuntime, type NavStyleItem } from '../../../src/axf/react';
import type { AxfWebLibrary } from '../../../src/axf/react/library';
import { mollyApp } from '../../../src/molly/apps';
import helpPack from '../help.json';

/**
 * Navigation (Molly): the navigation menu with sub menus that slide open, and its own settings interface. Molly's
 * nav-menu asset opts in (`navStyle: true`), so the framework nav draws items with children as sub menus; xLayout hangs
 * each app's own pages under that app's entry. This plugin is the nav's settings (Settings → Plugins → Navigation, one
 * panel per group; right-click the nav → Navigation settings) and its commands. The look is the nav-style@1 asset in
 * force with control@1 `tokens.nav` overrides on top, so every change rides the axHub look.
 */

const PLUGIN_ID = 'ai.amberx.axf.molly.navigation';
const TAB = 'navigation';
const DIALOG = 'navigation.settings';
const TYPE = 'nav-style' as never;

/** The nav's top-level items (what the Items panel pins, hides, reorders and colours): the asset's and plugins'. */
function topItems(rt: AxfRuntime): NavStyleItem[] {
  const seen = new Set<string>();
  const out: NavStyleItem[] = [];
  const add = (it: NavItem) => { if (seen.has(it.id)) return; seen.add(it.id); out.push({ id: it.id, label: it.label, icon: it.icon }); };
  for (const s of rt.asset('nav-menu').data.sections) s.items.forEach(add);
  for (const s of rt.navExtras) s.items.forEach((it) => { if (!out.some((x) => x.id === it.view || x.id === it.id)) add(it); });
  return out;
}

const argsOf = (args: string[], payload?: string) => (args.length ? args.join(':') : payload ?? '');

export const plugin: AxfWebLibrary = {
  id: PLUGIN_ID,
  label: 'Navigation',
  version: '0.1.0',
  provides: ['settings-tab:navigation', 'dialog:navigation.settings'],
  builtWith: { model: 'opus', builtAt: '2026-11-03' },
  help: helpPack.data as AxfWebLibrary['help'],
  register(rt) {
    const on = rt.actions.register.bind(rt.actions);
    on('navigation.settings', () => rt.dispatch(`settings.open:${TAB}`), { label: 'Navigation settings…' });
    on('navigation.dialog', () => rt.openDialog(DIALOG), { label: 'Navigation settings (dialog)…' });
    on('navigation.collapse', () => { if (rt.settings.get(NAV_COLLAPSED_KEY) === true) rt.settings.clear(NAV_COLLAPSED_KEY); else rt.settings.set(NAV_COLLAPSED_KEY, true); }, { label: 'Collapse navigation to icons' });
    on('navigation.reset', () => { rt.settings.clear(CONTROL_TOKEN_SLOTS['tokens.nav'].key); rt.toast('Navigation is back to its preset.', 'info', 'Navigation'); }, { label: 'Reset navigation settings' });
    on('navigation.get', () => {
      const d = rt.navStyleData();
      rt.toast(d ? `${rt.assetOrNull(TYPE)?.name ?? 'nav-style'}: ${d.animation.kind}, ${d.animation.durationMs || 'theme'} ms, ${d.behavior.single ? 'one' : 'many'} open` : 'Sub menus are off in this app.', 'info', 'Navigation');
      return d;
    }, { label: 'Read the navigation settings' });
    on('navigation.set', (args, ctx) => {
      const [path = '', ...rest] = argsOf(args, ctx.payload).split(':');
      const raw = rest.join(':');
      const value = raw === 'true' ? true : raw === 'false' ? false : raw !== '' && !Number.isNaN(Number(raw)) ? Number(raw) : raw;
      try { setNavStyleField(rt, path, value); } catch (e) { rt.toast(String((e as Error).message), 'danger', 'Navigation'); }
    }, { label: 'Change one navigation setting (path:value)' });
    on('navigation.preset', (args, ctx) => { const id = argsOf(args, ctx.payload); if (id) rt.swap(TYPE, id); }, { label: 'Pick a navigation preset' });
    on('navigation.open', (args, ctx) => {
      const view = argsOf(args, ctx.payload);
      if (!view) return;
      // an app's page (`console/nav:builds`) is a view xLayout registers once the app has sent its navigation
      if (mollyApp(view.split('/')[0]) || rt.getState().view !== view) rt.navigate(view);
    }, { label: 'Open a navigation item' });
  },
  dialogs: { [DIALOG]: { title: 'Navigation settings', icon: 'menu', render: () => <NavSettingsDialog /> } },
  // Settings → Plugins → Navigation (a sub-tab of Plugins, like every plugin's), one panel per group
  settingsTabs: [{ id: TAB, label: 'Navigation', icon: 'menu', order: 35, parent: 'plugins', description: 'The navigation menu: sub menus, look, animation and behaviour.' }],
  settingsPanels: NAV_STYLE_GROUP_IDS.map((g, i) => ({ id: `navigation.${g}`, section: 'look', tab: TAB, title: NAV_STYLE_GROUP_TITLES[g], icon: NAV_STYLE_GROUP_ICONS[g], order: 10 + i * 10, render: () => <GroupPanel group={g} /> })),
  appMenu: [
    { id: 'navigation.view', menu: 'view', menuLabel: 'View', menuOrder: 30, order: 25, items: [
      { id: 'navigation.collapse', label: 'Collapse navigation', icon: 'menu', action: 'navigation.collapse', checked: `setting:${NAV_COLLAPSED_KEY}` },
      { id: 'navigation.settings', label: 'Navigation settings…', icon: 'settings', action: 'navigation.settings' },
    ] },
  ],
  contextMenu: [
    { id: 'navigation.ctx', target: 'nav', items: [
      { id: 'navigation.ctx.settings', label: 'Navigation settings…', icon: 'settings', action: 'navigation.settings' },
      { id: 'navigation.ctx.collapse', label: 'Collapse to icons', icon: 'menu', action: 'navigation.collapse', checked: `setting:${NAV_COLLAPSED_KEY}` },
      { id: 'navigation.ctx.reset', label: 'Reset navigation', icon: 'undo', action: 'navigation.reset' },
    ] },
    { id: 'navigation.ctx.item', target: 'nav-item', items: [
      { id: 'navigation.ctx.item.settings', label: 'Navigation settings…', icon: 'settings', action: 'navigation.settings' },
    ] },
  ],
};

function GroupPanel({ group }: { group: (typeof NAV_STYLE_GROUP_IDS)[number] }) {
  return <NavStyleGroup group={group} items={useTopItems()} />;
}

function NavSettingsDialog() {
  return <NavStyleSettings items={useTopItems()} />;
}

/** The top-level items, re-read whenever the runtime changes (a plugin added a section, an app sent its nav). */
function useTopItems(): NavStyleItem[] {
  useAxfState();
  return topItems(useRuntime());
}
