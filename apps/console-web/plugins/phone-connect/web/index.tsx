/**
 * Phone Connect (phone-connect@1), the console side: Settings → Plugins → Phone Connect and the phone.* console actions.
 * The server decides everything (server/service.py); this file shows it and calls the same routes as MCP and the CLI.
 */
import type { AxfWebLibrary } from '@console/axf/react/library';
import { addLoadedSource, type LoadedItem } from '@console/control/search';
import { registerActions } from './actions';
import { appMenu } from './menu';
import { phone, type Device } from './client';
import { panels, showInPanel } from './settings';

export const TAB = 'phone-connect';

export const plugin: AxfWebLibrary = {
  id: 'ai.amberx.axf.console.phone-connect',
  label: 'Phone Connect',
  version: '0.1.0',
  appMenu,
  register(rt) {
    const open = () => rt.dispatch(`plugin.settings.open:${TAB}`);
    registerActions(rt, open);
    // console_show / console_open row:device/<id> and Ctrl+K: every known phone is a loaded item that opens its row
    let known: Device[] = [];
    const refresh = async () => { const r = await phone<{ devices?: Device[] }>('devices'); if (r.devices) known = r.devices; };
    void refresh().catch(() => undefined);
    setInterval(() => { if (document.visibilityState === 'visible') void refresh().catch(() => undefined); }, 60000);
    addLoadedSource('phone-connect', (): LoadedItem[] => known.map((d) => ({
      address: `row:device/${d.deviceId}`, kind: 'row', label: d.name, detail: `Phone · ${d.presence}`, icon: 'smartphone', keywords: ['phone', d.deviceId],
      open: () => { open(); showInPanel('phones', d.deviceId); },
    })));
  },
  settingsTabs: [{ id: TAB, label: 'Phone Connect', icon: 'smartphone', order: 30, parent: 'plugins', description: 'Pair the Phone Connect app, see and revoke phones, switch phone features on or off, recent commands.' }],
  settingsPanels: panels,
};
