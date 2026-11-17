/**
 * Builds → Gate & rules (`view:gate`): the gate a PR must pass before it lands, the build rules and the auto-lander, in four tabs
 * (framework TabGroup, settings id `gate.tabs`, so the row is the tab-group asset and remembers the last tab).
 * console-control@1: the view is `view:gate`, the row `tab:gate.tabs`, each tab `tab:gate.tabs=rules | build-rules |
 * auto-lander | history` (Auto-lander holds its own row `tab:gate.auto-lander.tabs=server | line`, AutoLanderTab); deep links `console_show view:gate/tab:gate.tabs=history`, `console_open gate`, action `gate.open:<tab>`.
 */
import { useEffect, useState } from 'react';
import { SkinScope, TabGroup } from '@console/axf/react';
import { gateCall, isTab, onShowTab, takeWantedTab, type GateSettings, type GateTab } from './api';
import { AutoLanderTab } from './AutoLanderTab';
import { BuildRulesTab } from './BuildRulesTab';
import { HistoryTab } from './HistoryTab';
import { RulesTab } from './RulesTab';
import './gate.css';

export const PLUGIN_ID = 'ai.amberx.axf.console.gate';
export const TABS_ID = 'gate.tabs';
const DEFAULTS: GateSettings = { refreshSec: 30, historySize: 2000, defaultTab: 'rules' };

export function GateView() {
  const [settings, setSettings] = useState<GateSettings>(DEFAULTS);
  const [tab, setTab] = useState<GateTab>(() => takeWantedTab() ?? DEFAULTS.defaultTab);
  useEffect(() => onShowTab(setTab), []);
  useEffect(() => {
    let live = true;
    void gateCall<{ settings: GateSettings }>('settings').then((r) => {
      if (!live) return;
      setSettings(r.settings);
      // the plugin's default tab, unless a deep link or the remembered tab already chose one
      setTab((cur) => (cur === DEFAULTS.defaultTab && isTab(r.settings.defaultTab) ? r.settings.defaultTab : cur));
    }, () => { /* defaults stand */ });
    return () => { live = false; };
  }, []);
  return (
    <SkinScope kind="plugin" id={PLUGIN_ID} className="axp-gate">
      <header className="fx-pagehead"><div><p className="fx-eyebrow">Builds</p><h1>Gate &amp; rules</h1><p className="fx-muted">The checks a build must pass before it lands, the build rules, the auto-lander and what it did.</p></div></header>
      <TabGroup<GateTab> id="gate.tabs" label="Gate & rules" value={tab} onChange={setTab}
        tabs={[{ value: 'rules', label: 'Rules', icon: 'shield' }, { value: 'build-rules', label: 'Build rules', icon: 'list' }, { value: 'auto-lander', label: 'Auto-lander', icon: 'branch' }, { value: 'history', label: 'History', icon: 'clock' }]}>
        <div className="axp-gate__panel">
          {tab === 'rules' && <RulesTab refreshSec={settings.refreshSec} />}
          {tab === 'build-rules' && <BuildRulesTab refreshSec={settings.refreshSec} />}
          {tab === 'auto-lander' && <AutoLanderTab refreshSec={settings.refreshSec} />}
          {tab === 'history' && <HistoryTab refreshSec={settings.refreshSec} />}
        </div>
      </TabGroup>
    </SkinScope>
  );
}
