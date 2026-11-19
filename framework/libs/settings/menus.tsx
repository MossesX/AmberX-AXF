/**
 * This app's own navigation menu and application menu (app-menus@1, core/engines/app-menus-rules.mjs; build
 * every-app-gets-own-locked-default, Nov 18 2026).
 *
 * Settings → Appearance shows one row per menu kind: the menu in use, greyed out and locked on the app's default
 * (`default-<app>-nav` / `default-<app>-appmenu`), and a checkbox "Use another navigation menu" / "Use another
 * application menu". Ticking unlocks it and opens a dialog listing ONLY the menus built for this app
 * (data.builtFor = app:<app>); shared, generic menus are never offered. Unticking puts the app back on its default.
 *
 * Actions (console-visible: REST /api/console-control, MCP console tools, CLI `axf console`, voice):
 *   menus.pick:<kind: nav or appmenu>:<menu id|default>   pick one (default = untick, back to the locked default)
 *   menus.choose:<kind: nav or appmenu>                    open the dialog
 *   menus.state                                   toast + terminal line with both menus' state (read it via REST too)
 */
import { useState } from 'react';
import { APP_MENU_KINDS, APP_MENU_LABELS, appOfDefaults, menuChoices, menuPick, menuSet, menuState, parseMenuArgs, type AssetType, type AxfRuntime, type MenuKind } from '../../core';
import { Button, Checkbox, ChoiceGrid, Icon, Note, useAxfState, useRuntime } from '../../react';

export const APP_MENUS_DIALOG = 'axf.settings.menus';
export const APP_MENUS_ACTIONS = { pick: 'menus.pick', choose: 'menus.choose', state: 'menus.state' } as const;
const TITLE: Record<MenuKind, string> = { nav: 'Navigation menu', appmenu: 'Application menu' };

/** The app this runtime is (from its manifest's default-<app>-nav), or null for an app not on app-menus@1. */
export function menuAppOf(rt: AxfRuntime): string | null {
  return appOfDefaults(rt.manifest.defaults);
}

function menuAssets(rt: AxfRuntime, kind: MenuKind) {
  return rt.registry.list(APP_MENU_KINDS[kind] as AssetType) as unknown as { id: string; type: string; name?: string; description?: string; data?: unknown }[];
}

/** The readable state of this app's menus (REST/MCP read it through `menus.state`, or the slots). */
export function appMenusState(rt: AxfRuntime) {
  const app = menuAppOf(rt);
  if (!app) return { app: null, menus: [] };
  const assets = [...menuAssets(rt, 'nav'), ...menuAssets(rt, 'appmenu')];
  return { app, menus: menuState(app, rt.getState().active, assets) };
}

/** Pick a menu (`default` / '' = back to the default). Returns an error text, or '' when done. */
export function setAppMenu(rt: AxfRuntime, kind: MenuKind, which: string): string {
  const app = menuAppOf(rt);
  if (!app) return 'This app has no menus of its own (app-menus@1).';
  const r = menuSet(app, kind, which, menuAssets(rt, kind));
  if (r.error !== undefined) return r.error;
  return rt.swap(APP_MENU_KINDS[kind] as AssetType, r.id) ? '' : `Could not switch the ${APP_MENU_LABELS[kind]}.`;
}

export function registerMenuActions(rt: AxfRuntime): void {
  rt.actions.register(APP_MENUS_ACTIONS.pick, (args) => {
    const p = parseMenuArgs(args);
    if (!p) { rt.toast('Use menus.pick:<kind: nav or appmenu>:<menu id|default>.', 'warning', 'Menus'); return; }
    const err = setAppMenu(rt, p.kind, p.which);
    if (err) rt.toast(err, 'warning', 'Menus');
  }, { label: "Pick this app's navigation or application menu (menus.pick:<kind: nav or appmenu>:<id|default>; only menus built for this app; default = back to the locked default)", params: true, effect: 'write' });
  rt.actions.register(APP_MENUS_ACTIONS.choose, (args) => {
    const p = parseMenuArgs(args);
    if (!p) return;
    rt.openDialog(APP_MENUS_DIALOG, { kind: p.kind });
  }, { label: "Choose this app's navigation or application menu (menus.choose:<kind: nav or appmenu>)", params: true });
  rt.actions.register(APP_MENUS_ACTIONS.state, () => {
    const s = appMenusState(rt);
    const line = s.app ? s.menus.map((m) => `${m.kind}: ${m.id}${m.locked ? ' (locked default)' : ''}, ${m.choices.length} built for ${s.app}`).join('; ') : 'This app has no menus of its own.';
    rt.terminal.ok('menus', line);
    rt.toast(line, 'info', 'Menus');
  }, { label: "Show this app's menus: which is in use, locked or not, and how many are built for it", effect: 'read' });
}

/** One locked row (Settings → Appearance): the menu in use, greyed out, and the checkbox that unlocks the picker. */
export function AppMenuRow({ kind, locked: disabled = false }: { kind: MenuKind; locked?: boolean }) {
  const rt = useRuntime();
  const st = useAxfState();
  const app = menuAppOf(rt);
  const [ticked, setTicked] = useState(false);
  if (!app) return null;
  const type = APP_MENU_KINDS[kind] as AssetType;
  const pick = menuPick((st.active as Record<string, string | undefined>)[type], app, kind, menuAssets(rt, kind));
  const unlocked = ticked || !pick.locked;
  const name = (pick.id && rt.registry.get(type, pick.id)?.name) || pick.id || 'None';
  const what = APP_MENU_LABELS[kind];
  const open = () => rt.dispatch(`${APP_MENUS_ACTIONS.choose}:${kind}`);
  const toggle = (on: boolean) => {
    setTicked(on);
    if (on) open();
    else rt.dispatch(`${APP_MENUS_ACTIONS.pick}:${kind}:default`);
  };
  return (
    <div className={`axf-settings-iface ${unlocked ? '' : 'is-locked'}`} data-axf-app-menu={kind} data-axf-target={`setting:menus.${kind}`}>
      <div className="axf-settings-iface__head">
        <span className="axf-settings-iface__label fx-eyebrow">{TITLE[kind]}</span>
        {unlocked
          ? <Button tone="quiet" size="sm" icon={kind === 'nav' ? 'grid' : 'menu'} disabled={disabled} onClick={open} aria-label={`Choose the ${what}`} title={`Choose another ${what} built for this app`}>{name}</Button>
          : <span className="axf-settings-iface__name" aria-disabled="true" title="Locked on this app's default. Tick the box to choose another."><Icon name="lock" size={14} /> {name}</span>}
      </div>
      <Checkbox label={`Use another ${what}`} checked={unlocked} disabled={disabled} onChange={toggle} title={unlocked ? "Untick to go back to this app's default" : `Tick to choose another ${what} built for this app`} />
    </div>
  );
}

/** The dialog: only the menus built for this app. */
export function AppMenuDialog({ kind }: { kind: string }) {
  const rt = useRuntime();
  const st = useAxfState();
  const app = menuAppOf(rt);
  const p = parseMenuArgs([kind]);
  if (!app || !p) return <Note tone="warning">No menu kind "{kind}" in this app.</Note>;
  const assets = menuAssets(rt, p.kind);
  const choices = menuChoices(app, p.kind, assets);
  const pick = menuPick((st.active as Record<string, string | undefined>)[p.type], app, p.kind, assets);
  const choose = (id: string) => { rt.dispatch(`${APP_MENUS_ACTIONS.pick}:${p.kind}:${id}`); rt.closeDialog(); };
  return (
    <div className="fx-stack axf-settings-iface__dialog" data-axf-app-menu-dialog={p.kind}>
      <p className="fx-muted">{TITLE[p.kind]}s built for this app ({app}). Every app has its own; menus are not shared between apps.</p>
      <ChoiceGrid label={TITLE[p.kind]} selected={pick.id ? [pick.id] : []} onToggle={choose}
        choices={choices.map((c) => ({ id: c.id, title: c.name, text: c.description, icon: c.isDefault ? 'lock' : (p.kind === 'nav' ? 'grid' : 'menu'), ...(c.isDefault ? { tag: 'Default' } : {}) }))} />
      {choices.length < 2 && <Note tone="info">Only the default is built for this app so far. A {p.type} asset with data.builtFor = "app:{app}" shows up here.</Note>}
      <div className="fx-row"><Button tone="quiet" onClick={() => rt.closeDialog()}>Close</Button></div>
    </div>
  );
}
