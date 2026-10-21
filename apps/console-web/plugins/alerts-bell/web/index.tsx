/**
 * Alerts bell console plugin (ai.amberx.axf.console.alerts-bell).
 *
 * The developer alerts bell, moved off the console's toolbar onto the banner (Brett, Oct 21 2026: banner only). Two
 * framework widgets, no new asset type: an `action-button` (bell icon, action `alerts.open`) and a `counter` bound to
 * the alerts library's runtime counter `alerts.unread` (hidden at zero, 99+ past 99, tap = alerts.open). Both are this
 * plugin's own assets, attached to the banner on load (right side by default, after the clock) with origin = the
 * plugin id, so the console takes them off when the plugin is switched off. The alerts library itself
 * (framework/libs/alerts: Alerts view, Settings → Alerts, transport, the counter) stays where it is.
 *
 * Settings → Plugins → Alerts bell: show/hide, side (this browser).
 */
import { useSyncExternalStore } from 'react';
import type { AxfRuntime } from '@console/axf/core';
import { Button } from '@console/axf/react';
import type { AxfWebLibrary } from '@console/axf/react/library';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import { COUNTER, ID, placeBell, showOf, sideOf } from './core';
import { appMenu } from './menu';

const FOLDER = 'alerts-bell';
const SHOW_KEY = 'alerts-bell.show';
const SIDE_KEY = 'alerts-bell.side';

let runtime: AxfRuntime | null = null;
let watching = false;
const subs = new Set<() => void>();
let version = 0;
const bump = () => { version++; subs.forEach((f) => f()); };

function place(rt: AxfRuntime) {
  placeBell(rt, showOf(rt.settings.get(SHOW_KEY)), sideOf(rt.settings.get(SIDE_KEY)));
  bump();
}

function StatusPanel() {
  useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => version);
  const rt = runtime;
  if (!rt) return null;
  const on = rt.hostAttachments('banner').some((a) => a.origin === ID);
  return (
    <div className="fx-stack">
      <p style={{ margin: 0 }}>The alerts bell sits on the banner: tap it for the Alerts view; the red number is how many alerts you haven't read (hidden at zero, 99+ past 99). Where alerts go and which sources run is in Settings → Alerts.</p>
      <p className="fx-small fx-muted" style={{ margin: 0 }}>{on ? `On the banner (${sideOf(rt.settings.get(SIDE_KEY))} side) · ${rt.badge(COUNTER)} unread` : 'Hidden from the banner.'}</p>
      <div className="fx-row fx-row--wrap">
        <Button icon="bell" onClick={() => rt.dispatch('alerts.open')}>Open alerts</Button>
        <Button icon="settings" onClick={() => rt.dispatch('settings.open:alerts')}>Alert settings</Button>
      </div>
    </div>
  );
}

export const plugin: AxfWebLibrary = {
  appMenu,
  id: ID,
  label: 'Alerts bell',
  version: '0.1.0',
  dependsOn: ['ai.amberx.axf.alerts'],
  provides: ['banner.alerts-bell'],
  register(rt) {
    runtime = rt;
    if (!watching) {
      watching = true;
      for (const k of [SHOW_KEY, SIDE_KEY]) rt.settings.onChange(k, () => { if (runtime) place(runtime); });
    }
    place(rt);
  },
  settingsTabs: [{ id: 'alerts-bell', label: 'Alerts bell', icon: 'bell', parent: 'plugins', order: 48, description: 'The alerts bell on the banner.' }],
  settings: [{
    id: 'alerts-bell.look', label: 'On the banner', icon: 'eye', tab: 'alerts-bell', order: 5,
    settings: [
      { key: SHOW_KEY, label: 'Show the alerts bell on the banner', kind: 'toggle', default: true, scope: 'device' },
      { key: SIDE_KEY, label: 'Side', kind: 'choice', default: 'right', scope: 'device', options: [{ value: 'right', label: 'Right' }, { value: 'left', label: 'Left' }] },
    ],
  }],
  settingsPanels: [
    { id: 'alerts-bell.status', tab: 'alerts-bell', title: 'Alerts bell', icon: 'bell', order: 10, render: () => <StatusPanel /> },
    { id: 'alerts-bell.lifecycle', tab: 'alerts-bell', title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> },
  ],
};
