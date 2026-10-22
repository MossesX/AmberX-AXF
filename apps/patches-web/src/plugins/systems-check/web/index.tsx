import type { AxfWebLibrary } from '@console/axf/react/library';
import * as api from '@console/api';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import { SystemBanner, SystemCheckDialog, loadSystemCheck } from './SystemCheck';
import { KeysBanner, KeysDialog } from './KeysBanner';
import { WhatsNewBanner, loadWhatsNew } from './WhatsNew';
import { AiPanel, BannersPanel, RoutinePanel } from './panels';
import { appMenu } from './menu';

/*
 * Systems check plugin (web part): the banners at the top of every view (keys needed, systems check, What's new), the
 * `system-check` dialog, and Settings → Plugins → Systems check (AI switches, the saved AI routine, banners).
 * Both run once when the console loads and again when the console token changes.
 */
const FOLDER = 'systems-check';
let started = false;

function startOnce() {
  if (started) return;
  started = true;
  let tries = 0;
  const go = () => { // after the backend health check answers (up to ~15 s)
    if (api.isBackendUp() || tries++ > 30) { void loadSystemCheck(true); void loadWhatsNew(); return; }
    setTimeout(go, 500);
  };
  setTimeout(go, 400);
  globalThis.addEventListener(api.TOKEN_CHANGED, () => { void loadSystemCheck(true); void loadWhatsNew(); });
}

export const plugin: AxfWebLibrary = {
  id: 'ai.amberx.axf.console.systems-check',
  label: 'Systems check',
  version: '0.2.0',
  appMenu,
  provides: ['axf.systems-check'],
  register(rt) {
    startOnce();
    rt.actions.register('system-check.open', () => rt.openDialog('system-check', {}), { label: 'Open the systems check' });
    rt.actions.register('keys-needed.open', () => rt.openDialog('keys-needed', {}), { label: 'Add the keys the console needs' });
  },
  banners: [
    { id: 'keys-needed', label: 'Keys needed', icon: 'key', settingsTab: 'systems-check', order: 8, render: () => <KeysBanner /> },
    { id: 'systems-check', label: 'Systems check', icon: 'shield', settingsTab: 'systems-check', order: 10, render: () => <SystemBanner /> },
    { id: 'whats-new', label: 'What’s new', icon: 'sparkles', settingsTab: 'systems-check', order: 20, render: () => <WhatsNewBanner /> },
  ],
  dialogs: {
    'keys-needed': { title: 'Keys needed', icon: 'key', render: () => <KeysDialog /> },
    'system-check': { title: 'Systems check', icon: 'shield', render: (p) => <SystemCheckDialog focus={typeof p.focus === 'string' ? p.focus : undefined} /> },
  },
  settingsTabs: [{ id: 'systems-check', label: 'Systems check', icon: 'shield', parent: 'plugins', order: 5, description: 'The systems check and What’s new banners, their AI switches, and the routine Mosses saved for running without AI.' }],
  settingsPanels: [
    { id: 'systems-check.ai', tab: 'systems-check', title: 'AI', icon: 'sparkles', order: 10, render: () => <AiPanel /> },
    { id: 'systems-check.routine', tab: 'systems-check', title: 'Saved AI routine', icon: 'list', order: 20, render: () => <RoutinePanel /> },
    { id: 'systems-check.banners', tab: 'systems-check', title: 'Banners', icon: 'bell', order: 30, render: () => <BannersPanel /> },
    { id: 'systems-check.lifecycle', tab: 'systems-check', title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> },
  ],
};
