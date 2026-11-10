import { useState } from 'react';
import { Button, Chip, Note, Switch, TextField, useRuntime } from '../axf/react';
import type { AxfRuntime } from '../axf/core';
import type { AxfWebLibrary } from '../axf/react/library';
import { mollyApp } from './apps';
import { moduleSettingKeys, moduleStatuses, reloadNative, unloadNative, useNativeRev, loadNative, type ModuleStatus } from './native';

/**
 * Molly modules (build convert-every-app-into-a-molly-module): every app Molly holds is a module with its own manifest
 * (its MOLLY_APPS entry plus the surface it brings), its own screens, routes and settings, fenced so one broken module
 * cannot take Molly down (molly/native.tsx). This is the screen and the Settings section over them; every button runs
 * the same `molly.modules.*` action the menus, command search and remote callers run.
 *
 * Reached by: the `modules` view (deep link `#/modules`), `molly.modules.open`, Molly's application menu, and
 * Settings → Modules (`settings.open:molly-modules`).
 */

export const MODULES_VIEW = 'modules';
export const MODULES_TAB = 'molly-modules';

const STATE_LABEL: Record<ModuleStatus['state'], string> = {
  ready: 'Running', loading: 'Loading', failed: 'Stopped', off: 'Switched off', 'not-native': 'Opens on its own', 'not-loaded': 'Not loaded',
};
const STATE_TONE: Partial<Record<ModuleStatus['state'], 'success' | 'warning' | 'danger' | 'accent'>> = { ready: 'success', loading: 'accent', failed: 'danger', off: 'warning' };
const SOURCE_LABEL: Record<ModuleStatus['source'], string> = { server: "the app's own server", plugin: 'a Molly plugin', none: 'none yet' };

/** One line per module, for toasts and voice. */
export const moduleLine = (m: ModuleStatus): string =>
  `${m.label}: ${STATE_LABEL[m.state].toLowerCase()}${m.error ? ` (${m.error})` : ''}${m.screens.length ? `, ${m.screens.length} screens` : ''}`;

function useModules(): ModuleStatus[] {
  useNativeRev();
  return moduleStatuses();
}

function ModuleRow({ m, edit }: { m: ModuleStatus; edit: boolean }) {
  const rt = useRuntime();
  const [addr, setAddr] = useState<string | null>(null);
  const saved = (() => { const v = rt.settings.get(moduleSettingKeys(m.id).surface); return typeof v === 'string' ? v : ''; })();
  const run = (spec: string) => rt.dispatch(spec);
  return (
    <li className="molly-mod" data-module={m.id} data-state={m.state}>
      <div className="molly-mod__head">
        <div className="molly-mod__title">
          <strong>{m.label}</strong> <Chip tone={STATE_TONE[m.state]}>{STATE_LABEL[m.state]}</Chip>
          <p className="fx-small fx-muted">{m.description}</p>
        </div>
        <Switch label={`${m.label} in Molly`} hideLabel checked={m.enabled} onChange={(on) => run(`molly.modules.${on ? 'enable' : 'disable'}:${m.id}`)} />
      </div>
      {m.error && <Note tone="warning">{m.label} stopped: {m.error}. The rest of Molly keeps running.</Note>}
      <ul className="molly-mod__facts">
        <li className="fx-small"><strong>Module from</strong> {SOURCE_LABEL[m.source]}{m.surface && <> <span className="fx-mono">{m.surface}</span></>}{m.surfaceOverridden && <> <Chip tone="accent">changed</Chip></>}</li>
        <li className="fx-small"><strong>Signs in by</strong> <span className="fx-mono">{m.auth}</span></li>
        {m.screens.length > 0 && <li className="fx-small"><strong>Screens</strong> {m.screens.map((s) => s.title).join(', ')}</li>}
      </ul>
      {edit && m.source !== 'plugin' && (
        <form className="molly-mod__inline" onSubmit={(e) => { e.preventDefault(); run(`molly.modules.surface:${m.id}:${(addr ?? saved).trim() || 'default'}`); setAddr(null); }}>
          <TextField label="Module address" mono value={addr ?? saved} onChange={setAddr} placeholder="Default (the app's own server)" hint="An ES module (shell-surface@1); https or localhost only. Empty = the default." />
          <Button type="submit" icon="save" disabled={addr === null}>Save</Button>
        </form>
      )}
      <div className="fx-row fx-row--wrap" role="toolbar" aria-label={`${m.label} module`}>
        {m.enabled && m.source !== 'none' && <Button icon="refresh" onClick={() => run(`molly.modules.reload:${m.id}`)}>{m.state === 'failed' ? 'Try again' : 'Reload'}</Button>}
        {m.state === 'ready' && <Button icon="arrow-right" onClick={() => rt.navigate(m.id)}>Open</Button>}
        <Button icon="external" onClick={() => window.open(m.url, '_blank', 'noopener')}>Open on its own</Button>
      </div>
    </li>
  );
}

function ModuleList({ edit }: { edit: boolean }) {
  const ms = useModules();
  return <ul className="molly-mod-list">{ms.map((m) => <ModuleRow key={m.id} m={m} edit={edit} />)}</ul>;
}

export function ModulesView() {
  const rt = useRuntime();
  const ms = useModules();
  const running = ms.filter((m) => m.state === 'ready').length;
  const stopped = ms.filter((m) => m.state === 'failed').length;
  return (
    <div className="fx-stack fx-stack--lg molly-mods" data-axf-help-id="molly-modules">
      <header className="fx-pagehead">
        <div>
          <p className="fx-eyebrow">Molly</p>
          <h1>Modules</h1>
          <p className="fx-muted">Each app runs inside Molly as its own module: its own screens, routes and settings. One that breaks stops on its own; Molly keeps going.</p>
        </div>
      </header>
      <div className="fx-row fx-row--wrap" role="toolbar" aria-label="Modules">
        <Chip tone="success">{running} running</Chip>
        {stopped > 0 && <Chip tone="danger">{stopped} stopped</Chip>}
        <Button icon="refresh" onClick={() => rt.dispatch('molly.modules.reload')}>Reload all</Button>
        <Button icon="settings" onClick={() => rt.dispatch(`settings.open:${MODULES_TAB}`)}>Settings</Button>
      </div>
      <ModuleList edit={false} />
    </div>
  );
}

/* ---------- actions: every module setting and step callable without the screen ---------- */

const argsOf = (args: string[], payload?: string): { app: string; rest: string } => {
  const all = args.length ? args : (payload ?? '').split(':');
  return { app: (all[0] ?? '').trim(), rest: all.slice(1).join(':').trim() };
};

let registered = false;
export function registerModuleActions(rt: AxfRuntime): void {
  if (registered) return; // StrictMode runs register twice in development
  registered = true;
  const on = rt.actions.register.bind(rt.actions);
  const title = 'Modules';
  const need = (app: string) => {
    const a = mollyApp(app);
    if (!a) rt.toast(app ? `Molly doesn't hold an app "${app}".` : 'Say which module: console, axhub, amberx or expenses.', 'warning', title);
    return a;
  };

  on('molly.modules.open', () => { rt.navigate(MODULES_VIEW); }, { label: 'Modules: open', effect: 'navigate' });
  on('molly.modules.list', () => {
    const ms = moduleStatuses();
    rt.toast(ms.map(moduleLine).join('\n'), ms.some((m) => m.state === 'failed') ? 'warning' : 'info', title);
    return ms;
  }, { label: 'Modules: list (state, screens, source)', effect: 'read' });
  on('molly.modules.status', (args, ctx) => {
    const { app } = argsOf(args, ctx.payload);
    if (!need(app)) return;
    return moduleStatuses().find((m) => m.id === app);
  }, { label: 'Modules: status (app)', params: true, effect: 'read' });
  on('molly.modules.enable', (args, ctx) => {
    const { app } = argsOf(args, ctx.payload);
    const a = need(app);
    if (!a) return;
    rt.settings.set(moduleSettingKeys(app).enabled, true);
    loadNative(rt, a);
    rt.toast(`${a.label} is on in Molly.`, 'success', title);
  }, { label: 'Modules: switch on (app)', params: true });
  on('molly.modules.disable', (args, ctx) => {
    const { app } = argsOf(args, ctx.payload);
    const a = need(app);
    if (!a) return;
    rt.settings.set(moduleSettingKeys(app).enabled, false);
    unloadNative(app);
    rt.toast(`${a.label} is off in Molly; it still opens on its own.`, 'info', title);
  }, { label: 'Modules: switch off (app)', params: true });
  on('molly.modules.reload', (args, ctx) => {
    const { app } = argsOf(args, ctx.payload);
    if (!app) { for (const m of moduleStatuses()) if (m.enabled && m.source !== 'none') reloadNative(rt, m.id); return; }
    if (need(app)) reloadNative(rt, app);
  }, { label: 'Modules: reload (app, or all)', params: true });
  on('molly.modules.surface', (args, ctx) => {
    const { app, rest } = argsOf(args, ctx.payload);
    const a = need(app);
    if (!a) return;
    const v = rest === 'default' ? '' : rest;
    if (v) {
      let ok = false;
      try { const u = new URL(v); ok = u.protocol === 'https:' || u.hostname === 'localhost' || u.hostname === '127.0.0.1'; } catch { ok = false; }
      if (!ok) { rt.toast('A module address is an https (or localhost) URL of an ES module.', 'warning', title); return; }
    }
    rt.settings.set(moduleSettingKeys(app).surface, v);
    reloadNative(rt, app);
    rt.toast(v ? `${a.label} loads from ${v}.` : `${a.label} loads from its own server.`, 'info', title);
  }, { label: 'Modules: module address (app:url | app:default)', params: true });
}

export const modulesLibrary: AxfWebLibrary = {
  id: 'ai.amberx.axf.molly.modules',
  label: 'Modules',
  version: '0.1.0',
  provides: [`view:${MODULES_VIEW}`, `settings-tab:${MODULES_TAB}`],
  builtWith: { model: 'opus', builtAt: '2026-11-10' },
  register: registerModuleActions,
  views: { [MODULES_VIEW]: { title: 'Modules', icon: 'box', render: () => <ModulesView /> } },
  settingsTabs: [{ id: MODULES_TAB, label: 'Modules', icon: 'box', order: 21, description: 'Each app as a module inside Molly: switch it on or off, reload it, or load it from another address.' }],
  settingsPanels: [
    { id: 'molly-modules.each', tab: MODULES_TAB, title: 'Modules', icon: 'box', order: 10, render: () => <ModuleList edit /> },
  ],
  appMenu: [
    { id: 'molly-modules.view', menu: 'view', menuLabel: 'View', menuOrder: 30, order: 25, items: [
      { id: 'molly-modules.open', label: 'Modules', icon: 'box', action: 'molly.modules.open' },
    ] },
  ],
};
