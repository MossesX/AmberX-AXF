/**
 * Sandbox plugin (web part): the Sandbox view, a link under Settings → Account & security → Your account,
 * nav + app-menu entries, and Sandbox management as a sub-tab of Settings → Plugins (admins).
 */
import { useEffect, useState } from 'react';
import { Button, Note, useRuntime } from '@console/axf/react';
import type { AxfWebLibrary } from '@console/axf/react/library';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import { AdminPanel } from './Admin';
import { appMenu } from './menu';
import { FOLDER, api, fmtBytes, type Me } from './api';
import { SandboxView } from './SandboxView';
import './sandbox.css';

const ID = 'ai.amberx.axf.console.sandbox';
const VIEW = 'sandbox';

/** Under "Your account": where every signed-in person finds the sandbox. */
function AccountLink() {
  const rt = useRuntime();
  const [me, setMe] = useState<Me | null>(null);
  useEffect(() => { api.call<Me>('me').then(setMe, () => setMe(null)); }, []);
  if (!me) return null;
  return (
    <div className="fx-stack">
      <p className="fx-small axp-sandbox__lede">
        A safe place to try GitHub and Build Pilot: read-only, nothing real changes. Your sandbox files stay until an admin clears them.
      </p>
      {!me.allowed && <Note tone="warning">{me.reason}</Note>}
      <div className="fx-row fx-row--wrap">
        <Button tone="primary" icon="box" disabled={!me.allowed} onClick={() => rt.navigate(VIEW)}>Open the sandbox</Button>
        {me.allowed && <span className="fx-small fx-muted">{me.usage.files} files · {fmtBytes(me.usage.bytes)}</span>}
        {me.admin && <Button tone="ghost" icon="settings" onClick={() => rt.dispatch('settings.open:sandbox')}>Sandbox management</Button>}
      </div>
    </div>
  );
}

export const plugin: AxfWebLibrary = {
  id: ID, // = plugin.json "id"
  label: 'Sandbox',
  version: '0.1.0',
  register(rt) {
    rt.actions.register('sandbox.open', () => rt.navigate(VIEW), { label: 'Open the sandbox' });
    rt.actions.register('sandbox.manage', () => rt.dispatch('settings.open:sandbox'), { label: 'Sandbox management' });
  },
  views: { [VIEW]: { title: 'Sandbox', icon: 'box', keywords: ['sandbox', 'try', 'safe', 'github', 'pilot', 'read-only'], render: () => <SandboxView /> } },
  nav: { label: 'Plugins', items: [{ id: VIEW, label: 'Sandbox', icon: 'box', view: VIEW }] },
  appMenu, // web/menu.ts: its entries in the console's application menu
  contextMenu: [{ id: 'sandbox.ctx', target: 'default', order: 80, items: [{ id: 'sandbox.ctx.open', label: 'Open the sandbox', icon: 'box', action: 'sandbox.open' }] }],
  settingsTabs: [{ id: 'sandbox', label: 'Sandbox', icon: 'box', order: 90, parent: 'plugins' }],
  settingsPanels: [
    { id: 'sandbox.account', tab: 'account', title: 'Sandbox', icon: 'box', order: 1.5, render: () => <AccountLink /> },
    { id: 'sandbox.manage', tab: 'sandbox', title: 'Sandbox management', icon: 'shield', order: 10, render: () => <AdminPanel /> },
    { id: 'sandbox.lifecycle', tab: 'sandbox', title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> },
  ],
};
