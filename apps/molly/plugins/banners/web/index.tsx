import { useSyncExternalStore } from 'react';
import { FRAME_BANNERS_SLOT, Switch, useRuntime } from '../../../src/axf/react';
import type { AxfWebLibrary } from '../../../src/axf/react/library';
import { mollyApp } from '../../../src/molly/apps';
import { NativeView, isNative } from '../../../src/molly/native';
import helpPack from '../help.json';
import './banners.css';

/**
 * Banners (Molly plugin, its own folder): Molly's one banner region. The Dev Console's live banners (every banner
 * plugin it has, with its Banner settings and colours) mount natively here: the console's surface (shell-surface@1)
 * shows them through its reserved part `axf-banners`, in Molly's page, no frame (molly-one-shell s11). A banner item
 * that opens a console screen tells Molly, which shows it (`<app>/<screen>`).
 * Settings → Plugins → Banners. Removed, Molly shows no banners.
 */

export const PLUGIN_ID = 'ai.amberx.axf.molly.banners';
const FOLDER = 'banners';
const TAB = 'molly-banners';
const K = { show: 'molly-banners.show' } as const;
/** The app whose banners Molly shows (an app id from molly/apps.ts). */
const SOURCE = 'console';

function useSetting<T>(key: string, fallback: T): T {
  const rt = useRuntime();
  const v = useSyncExternalStore((f) => rt.settings.onChange(key, f), () => rt.settings.get(key), () => rt.settings.get(key));
  return (v ?? fallback) as T;
}

/* ---------- the strip ---------- */

function Strip() {
  const show = useSetting<boolean>(K.show, true);
  if (!show || !isNative(SOURCE)) return null;
  return <div className="axp-banners-strip" data-axf-help-id="molly-banners-strip"><NativeView app={SOURCE} view="axf-banners" quiet /></div>;
}

/* ---------- Settings → Plugins → Banners ---------- */

function ShowPanel() {
  const rt = useRuntime();
  const show = useSetting<boolean>(K.show, true);
  return (
    <div className="fx-stack" data-axf-help-id="molly-banners-show">
      <Switch label="Show the banners" hint={`The ${mollyApp(SOURCE)?.label ?? SOURCE}'s live banners at the top of Molly. Their look, colours and order come from each banner's own Banner settings (right-click a banner).`} checked={show} onChange={(v) => rt.settings.set(K.show, v)} />
    </div>
  );
}

function EachPanel() {
  return (
    <div className="fx-stack" data-axf-help-id="molly-banners-each">
      <p className="fx-muted">Each banner keeps its own settings: right-click (or long-press) a banner → Banner settings, to hide it, recolour it or move it. They are the {mollyApp(SOURCE)?.label ?? SOURCE}'s own, so a change shows the same in Molly and on its own.</p>
    </div>
  );
}

function LifecyclePanel() {
  return (
    <div className="fx-stack">
      <p className="fx-muted">This plugin's code is all in apps/molly/plugins/{FOLDER}. Install or remove it (Molly then shows no banners):</p>
      <pre className="axp-banners-code">{`node apps/molly/plugins/${FOLDER}/install.mjs\nnode apps/molly/plugins/${FOLDER}/uninstall.mjs --all`}</pre>
    </div>
  );
}

/* ---------- the library ---------- */

let started = false;

export const plugin: AxfWebLibrary = {
  id: PLUGIN_ID,
  label: 'Banners',
  version: '0.1.0',
  provides: ['slot:app.frame.banners', 'settings-tab:molly-banners'],
  builtWith: { model: 'opus', builtAt: '2026-11-03' },
  help: helpPack.data as AxfWebLibrary['help'],
  register(rt) {
    if (started) return; // StrictMode runs this twice in development
    started = true;
    rt.actions.register('molly-banners.toggle', () => rt.settings.set(K.show, rt.settings.get(K.show) === false), { label: 'Banners on / off' });
  },
  slots: { [FRAME_BANNERS_SLOT]: [{ id: 'molly-banners.strip', order: 0, render: () => <Strip /> }] },
  settingsTabs: [{ id: TAB, label: 'Banners', icon: 'bell', order: 30, parent: 'plugins', description: 'The Dev Console’s live banners at the top of Molly: show them, and pick which.' }],
  settingsPanels: [
    { id: 'molly-banners.show', tab: TAB, title: 'Banner strip', icon: 'bell', order: 10, render: () => <ShowPanel /> },
    { id: 'molly-banners.each', tab: TAB, title: 'Each banner', icon: 'eye', order: 20, render: () => <EachPanel /> },
    { id: 'molly-banners.lifecycle', tab: TAB, title: 'Install & uninstall', icon: 'package', order: 90, render: () => <LifecyclePanel /> },
  ],
  appMenu: [
    { id: 'molly-banners.view', menu: 'view', menuLabel: 'View', menuOrder: 30, order: 30, items: [
      { id: 'molly-banners.toggle', label: 'Banners', icon: 'bell', action: 'molly-banners.toggle', checked: `setting:${K.show}` },
      { id: 'molly-banners.settings', label: 'Banner settings…', icon: 'settings', action: `settings.open:${TAB}` },
    ] },
  ],
};

