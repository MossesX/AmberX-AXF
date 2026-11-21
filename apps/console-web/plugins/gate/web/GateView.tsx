/**
 * Builds → VPS Configuration (`view:gate`): the gate a PR must pass before it lands, the build rules and the auto-lander, in four tabs
 * (framework TabGroup, settings id `gate.tabs`, so the row is the tab-group asset and remembers the last tab).
 * console-control@1: the view is `view:gate`, the row `tab:gate.tabs`, each tab `tab:gate.tabs=rules | build-rules |
 * auto-lander | build-cap | passes | history` (Auto-lander holds its own row `tab:gate.auto-lander.tabs=server | line`, AutoLanderTab); deep links `console_show view:gate/tab:gate.tabs=history`, `console_open gate`, action `gate.open:<tab>`.
 * Named Gate & rules until Nov 21 2026: `view:vps-configuration`, `console_open vps-configuration` and `vps.open:<tab>` reach the same screen.
 */
import { useEffect, useState } from 'react';
import { PageToolbar, SkinScope, TabGroup, usePublishPageState, useRuntime, useToolbarHandlers } from '@console/axf/react';
import { gateCall, isTab, onShowTab, showTab, takeWantedTab, type GateSettings, type GateTab } from './api';
import { AutoLanderTab } from './AutoLanderTab';
import { BuildCapTab } from './BuildCapTab';
import { BuildRulesTab } from './BuildRulesTab';
import { HistoryTab } from './HistoryTab';
import { PassesTab } from './PassesTab';
import { showPassTab, type PassTab } from './passesState';
import { RulesTab } from './RulesTab';
import './gate.css';

export const PLUGIN_ID = 'ai.amberx.axf.console.gate';
export const TABS_ID = 'gate.tabs';
/** The screen's address under its new name: `view:vps-configuration` opens `view:gate` (the old address stays the screen). */
export const VIEW_ALIAS = 'vps-configuration';

export function GateAlias({ tab, passTab }: { tab?: GateTab; passTab?: PassTab }) {
  const rt = useRuntime();
  useEffect(() => { rt.navigate('gate'); if (tab) showTab(tab); if (passTab) showPassTab(passTab); }, [rt, tab, passTab]);
  return null;
}
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
  // the Gate toolbar (page-toolbar@1, assets/toolbar/gate.json)
  usePublishPageState('gate', { tab, onBuildRules: tab === 'build-rules', onHistory: tab === 'history' });
  useToolbarHandlers('gate', {
    'gate.show-build-rules': () => { setTab('build-rules'); return { tab: 'build-rules' }; },
    'gate.show-history': () => { setTab('history'); return { tab: 'history' }; },
  });
  return (
    <SkinScope kind="plugin" id={PLUGIN_ID} className="axp-gate">
      <header className="fx-pagehead"><div><p className="fx-eyebrow">Builds</p><h1>VPS Configuration</h1><p className="fx-muted">How the VPS runs builds: the checks a build must pass before it lands, the build rules, the auto-lander, the build cap and the veto passes.</p></div></header>
      <PageToolbar view="gate" />
      <TabGroup<GateTab> id="gate.tabs" label="VPS Configuration" value={tab} onChange={setTab}
        tabs={[{ value: 'rules', label: 'Rules', icon: 'shield' }, { value: 'build-rules', label: 'Build rules', icon: 'list' }, { value: 'auto-lander', label: 'Auto-lander', icon: 'branch' }, { value: 'build-cap', label: 'Build cap', icon: 'layers' }, { value: 'passes', label: 'Passes', icon: 'key' }, { value: 'history', label: 'History', icon: 'clock' }]}>
        <div className="axp-gate__panel">
          {tab === 'rules' && <RulesTab refreshSec={settings.refreshSec} />}
          {tab === 'build-rules' && <BuildRulesTab refreshSec={settings.refreshSec} />}
          {tab === 'auto-lander' && <AutoLanderTab refreshSec={settings.refreshSec} />}
          {tab === 'build-cap' && <BuildCapTab refreshSec={settings.refreshSec} />}
          {tab === 'passes' && <PassesTab />}
          {tab === 'history' && <HistoryTab refreshSec={settings.refreshSec} />}
        </div>
      </TabGroup>
    </SkinScope>
  );
}
