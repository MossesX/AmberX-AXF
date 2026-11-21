/**
 * Builds → Gate & rules (`view:gate`): the gates a build must pass, the build rules, the merge line, the lander, its
 * limits and the audit trail, in one framework TabGroup (settings id `gate.tabs`: the row is the tab-group asset and
 * remembers the last tab). console-control@1: the view is `view:gate`, the row `tab:gate.tabs`, each tab
 * `tab:gate.tabs=overview | rules | build-rules | line | auto-lander | limits | triage | history`; deep links
 * `console_show view:gate/tab:gate.tabs=history`, `console_open gate`, action `gate.open:<tab>`.
 * The console is display only here: every tab shows what the VPS answered and sends taps back to it.
 */
import { useEffect, useState } from 'react';
import { PageToolbar, SkinScope, TabGroup, usePublishPageState, useToolbarHandlers } from '@console/axf/react';
import { gateCall, isTab, onShowTab, TAB_ICON, TAB_LABEL, TABS, takeWantedTab, type GateSettings, type GateTab } from './api';
import { BuildRulesTab } from './BuildRulesTab';
import { GatesTab } from './GatesTab';
import { HistoryTab } from './HistoryTab';
import { LanderTab } from './LanderTab';
import { LimitsTab } from './LimitsTab';
import { LineTab } from './LineTab';
import { OverviewTab } from './OverviewTab';
import { TriageTab } from './TriageTab';
import './gate.css';

export const PLUGIN_ID = 'ai.amberx.axf.console.gate';
export const TABS_ID = 'gate.tabs';
const FIRST: GateTab = 'overview';
const REFRESH_SEC = 30;

export function GateView() {
  const [refreshSec, setRefreshSec] = useState(REFRESH_SEC);
  const [tab, setTab] = useState<GateTab>(() => takeWantedTab() ?? FIRST);
  useEffect(() => onShowTab(setTab), []);
  useEffect(() => {
    let live = true;
    void gateCall<{ settings: GateSettings }>('settings').then((r) => {
      if (!live) return;
      setRefreshSec(r.settings.refreshSec);
      // the tab the settings name, unless a deep link or a tap already chose one
      setTab((cur) => (cur === FIRST && isTab(r.settings.defaultTab) ? r.settings.defaultTab : cur));
    }, () => { /* the first tab stands */ });
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
      <header className="fx-pagehead"><div><p className="fx-eyebrow">Builds</p><h1>Gate &amp; rules</h1><p className="fx-muted">What a build must pass before it lands, who lands it, and everything that changed.</p></div></header>
      <PageToolbar view="gate" />
      <TabGroup<GateTab> id={TABS_ID} label="Gate & rules" value={tab} onChange={setTab} tabs={TABS.map((t) => ({ value: t, label: TAB_LABEL[t], icon: TAB_ICON[t] }))}>
        <div className="axp-gate__panel">
          {tab === 'overview' && <OverviewTab refreshSec={refreshSec} onOpen={setTab} />}
          {tab === 'rules' && <GatesTab refreshSec={refreshSec} />}
          {tab === 'build-rules' && <BuildRulesTab refreshSec={refreshSec} />}
          {tab === 'line' && <LineTab refreshSec={refreshSec} />}
          {tab === 'auto-lander' && <LanderTab refreshSec={refreshSec} />}
          {tab === 'limits' && <LimitsTab />}
          {tab === 'triage' && <TriageTab />}
          {tab === 'history' && <HistoryTab refreshSec={refreshSec} />}
        </div>
      </TabGroup>
    </SkinScope>
  );
}
