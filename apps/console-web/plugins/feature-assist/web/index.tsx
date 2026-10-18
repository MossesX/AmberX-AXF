import type { AxfWebLibrary } from '@console/axf/react/library';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import { FOLDER, ID, featureBuilt, getStatus, knownFeature, refreshStatus } from './api';
import { BuildDialog, DescribeBox, FeatureActions, StatusPanel } from './ui';
import './feature-assist.css';

/*
 * Feature assistant (web part), all through the Plan view's extension points:
 *  - slot plan.top      “Describe a feature” (hidden unless the AI assistant + the AXF expert are ready)
 *  - slot plan.feature  “Build with Mosses” / Mark built or partial (hidden on built features)
 *  - every context menu on a plan feature (target axf-plan-feature) that isn't built: Build with Mosses
 *  - dialog feature-assist.build, Settings → Plugins → Feature assistant
 */
export const plugin: AxfWebLibrary = {
  id: ID,
  label: 'Feature assistant',
  version: '0.1.0',
  provides: ['axf.feature-assist'],
  register(rt) {
    void refreshStatus();
    rt.actions.register('feature-assist.build', ([id]) => rt.openDialog('feature-assist.build', { featureId: decodeURIComponent(id ?? '') }), { label: 'Build a feature with Mosses', params: true, searchable: false });
    rt.contextExtras.set('*:feature-assist', (target, payload) =>
      target === 'axf-plan-feature' && payload && getStatus()?.build && knownFeature(payload) && !featureBuilt(payload)
        ? [{ id: 'feature-assist.build', label: 'Build with Mosses', icon: 'rocket', action: `feature-assist.build:${encodeURIComponent(payload)}` }]
        : []);
  },
  slots: {
    'plan.top': [{ id: 'feature-assist.describe', order: 10, render: (p) => <DescribeBox features={p.features as { id: string; status: string }[] | undefined} /> }],
    'plan.feature': [{ id: 'feature-assist.build', order: 10, render: (p) => <FeatureActions feature={p.feature as { id: string; status: string; title: string } | undefined} /> }],
  },
  dialogs: {
    'feature-assist.build': { title: 'Build with Mosses', icon: 'rocket', render: (props, close) => <BuildDialog featureId={String(props.featureId ?? '')} close={close} /> },
  },
  settingsTabs: [{ id: 'feature-assist', label: 'Feature assistant', icon: 'sparkles', parent: 'plugins', order: 43, description: 'Plain-English features for the Plan (AXF expert) and Build with Mosses.' }],
  settingsPanels: [
    { id: 'feature-assist.status', tab: 'feature-assist', title: 'Feature assistant', icon: 'sparkles', order: 10, render: () => <div className="axp-feature-assist-settings"><StatusPanel /></div> },
    { id: 'feature-assist.lifecycle', tab: 'feature-assist', title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> },
  ],
};
