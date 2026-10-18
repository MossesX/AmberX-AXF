import type { AxfWebLibrary } from '@console/axf/react/library';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import { FOLDER, ID } from './api';
import { AuditPanel, BatchesPanel, ContainersPanel, ProtectionPanel, StatusPanel } from './panels';
import './container-access.css';

/*
 * Container access plugin (web part): Settings → Plugins → Container access.
 * The server part provides axf.containers@1; other plugins reach containers only through it.
 */
export const plugin: AxfWebLibrary = {
  id: ID,
  label: 'Container access',
  version: '0.1.0',
  provides: ['axf.container-access'],
  settingsTabs: [{ id: 'container-access', label: 'Container access', icon: 'box', parent: 'plugins', order: 40, description: 'Which containers on the VPS the console can reach, the protected list, change batches waiting for approval and the audit log.' }],
  settingsPanels: [
    { id: 'container-access.status', tab: 'container-access', title: 'Connection', icon: 'zap', order: 10, render: () => <div className="axp-container-access"><StatusPanel /></div> },
    { id: 'container-access.batches', tab: 'container-access', title: 'Changes waiting for approval', icon: 'shield', order: 20, render: () => <div className="axp-container-access"><BatchesPanel /></div> },
    { id: 'container-access.containers', tab: 'container-access', title: 'Containers', icon: 'box', order: 30, render: () => <div className="axp-container-access"><ContainersPanel /></div> },
    { id: 'container-access.protection', tab: 'container-access', title: 'Protected list & reach', icon: 'lock', order: 40, render: () => <div className="axp-container-access"><ProtectionPanel /></div> },
    { id: 'container-access.audit', tab: 'container-access', title: 'Audit log', icon: 'list', order: 50, render: () => <div className="axp-container-access"><AuditPanel /></div> },
    { id: 'container-access.lifecycle', tab: 'container-access', title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> },
  ],
};
