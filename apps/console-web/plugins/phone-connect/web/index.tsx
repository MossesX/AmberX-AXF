/**
 * Phone Connect (console plugin). Views: phone-connect (the phone and its settings), phone-recorder, phone-rules.
 * Settings → Plugins → Phone Connect is a sub-tab with the same panels plus Install & uninstall.
 */
import type { AxfWebLibrary } from '@console/axf/react/library';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import { FOLDER } from './api';
import { appMenu } from './menu';
import { PhoneConnectSettings } from './PhoneConnectSettings';
import { RecorderPanel } from './RecorderView';
import { RulesPanel } from './RulesView';

function Page({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="fx-stack fx-stack--lg">
      <header className="fx-pagehead"><div><p className="fx-eyebrow">Phone Connect</p><h1>{title}</h1></div></header>
      {children}
    </div>
  );
}

export const plugin: AxfWebLibrary = {
  id: 'ai.amberx.axf.console.phone-connect',
  label: 'Phone Connect',
  version: '0.1.0',
  appMenu,
  views: {
    'phone-connect': { title: 'Phone Connect', icon: 'smartphone', render: () => <Page title="Phone"><PhoneConnectSettings /></Page> },
    'phone-recorder': { title: 'Phone recorder', icon: 'mic', render: () => <Page title="Recorder"><RecorderPanel /></Page> },
    'phone-rules': { title: 'Auto-approval rules', icon: 'check', render: () => <Page title="Auto-approval rules"><RulesPanel /></Page> },
  },
  nav: { label: 'Plugins', items: [{ id: 'phone-connect', label: 'Phone Connect', icon: 'smartphone', view: 'phone-connect' }] },
  settingsTabs: [{ id: 'phone-connect', label: 'Phone Connect', icon: 'smartphone', order: 30, parent: 'plugins', description: 'Your paired phone, what reaches it, the recorder, auto-approval rules and the overlay.' }],
  settingsPanels: [
    { id: 'phone-connect.panel', tab: 'phone-connect', title: 'Phone Connect', icon: 'smartphone', order: 1, render: () => <PhoneConnectSettings /> },
    { id: 'phone-connect.lifecycle', tab: 'phone-connect', title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> },
  ],
};
