/**
 * Alerts bell console plugin (ai.amberx.axf.console.alerts-bell).
 *
 * The developer alerts bell, moved off the console's toolbar onto the banner (Brett, Oct 21 2026: banner only). Two
 * framework widgets, no new asset type: an `action-button` (bell icon, action `alerts.open`) and a `counter` bound to
 * the alerts library's runtime counter `alerts.unread` (hidden at zero, 99+ past 99, tap = alerts.open). This plugin
 * supplies both as banner data (axf.banner-data@1); the banner widgets plugin draws them and owns their show and side
 * settings (keys alerts-bell.show / alerts-bell.side, unchanged). The alerts library itself (framework/libs/alerts:
 * Alerts view, Settings → Alerts, transport, the counter) stays where it is.
 */
import { useSyncExternalStore } from 'react';
import type { AxfRuntime } from '@console/axf/core';
import { Button } from '@console/axf/react';
import type { AxfWebLibrary } from '@console/axf/react/library';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import { supplyBannerData } from '@console/bannerData';
import { ASSET_ID, COUNTER, ID, supplyBell } from './core';
import { appMenu } from './menu';

const FOLDER = 'alerts-bell';

let runtime: AxfRuntime | null = null;
const subs = new Set<() => void>();
let version = 0;
const bump = () => { version++; subs.forEach((f) => f()); };

function place() {
  supplyBell((w, s) => supplyBannerData(w, s, ID));
  bump();
}

function StatusPanel() {
  useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => version);
  const rt = runtime;
  if (!rt) return null;
  const at = rt.banner().placed;
  const side = (['left', 'center', 'right'] as const).find((s) => at[s].some((p) => p.key === `action-button:${ASSET_ID}`));
  return (
    <div className="fx-stack">
      <p style={{ margin: 0 }}>The alerts bell sits on the banner: tap it for the Alerts view; the red number is how many alerts you haven't read (hidden at zero, 99+ past 99). Where alerts go and which sources run is in Settings → Alerts.</p>
      <p className="fx-small fx-muted" style={{ margin: 0 }}>{side ? `On the banner (${side} side) · ${rt.badge(COUNTER)} unread` : 'Not on the banner.'}</p>
      <div className="fx-row fx-row--wrap">
        <Button icon="bell" onClick={() => rt.dispatch('alerts.open')}>Open alerts</Button>
        <Button icon="settings" onClick={() => rt.dispatch('settings.open:alerts')}>Alert settings</Button>
        <Button tone="ghost" icon="layout" onClick={() => rt.dispatch(`banner.widgets:action-button:${ASSET_ID}`)}>The bell on the banner…</Button>
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
  // Only a bell on the app's banner: inside a host that hides the banner it isn't loaded (embed@1 skipWhen).
  embed: { skipWhen: ['hidden:banner'] },
  register(rt) {
    runtime = rt;
    place();
  },
  settingsTabs: [{ id: 'alerts-bell', label: 'Alerts bell', icon: 'bell', parent: 'plugins', order: 48, description: 'The alerts bell on the banner.' }],
  settingsPanels: [
    { id: 'alerts-bell.status', tab: 'alerts-bell', title: 'Alerts bell', icon: 'bell', order: 10, render: () => <StatusPanel /> },
    { id: 'alerts-bell.lifecycle', tab: 'alerts-bell', title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> },
  ],
};
