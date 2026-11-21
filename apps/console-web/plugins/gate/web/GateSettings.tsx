/**
 * Settings → Plugins → Gate (a sub-tab: the settings library draws the tab's level toolbar above it). The plugin's own
 * settings live on the server (GET / PUT settings), so the CLI (`axf gate settings set refreshSec 60`), MCP
 * (gate_settings, gate_settings_set), voice (`gate.setting:refreshSec:60`) and this panel read and write the same
 * values. console-control@1: `setting:gate.refreshSec | gate.historySize | gate.defaultTab`. Values go as typed; the
 * server checks them.
 */
import { useEffect, useState } from 'react';
import { Button, SelectField, TextField, useRuntime } from '@console/axf/react';
import { TAB_LABEL, TABS, type GateSettings as Settings } from './api';
import { loadSettings, saveSettings } from './settingsStore';
import { Bar, Err } from './ui';

const TAB_OPTIONS = TABS.map((t) => ({ value: t, label: TAB_LABEL[t] }));

export function GateSettings() {
  const rt = useRuntime();
  const [cur, setCur] = useState<Settings | null>(null);
  const [refresh, setRefresh] = useState('');
  const [size, setSize] = useState('');
  const [tab, setTab] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fill = (s: Settings) => { setCur(s); setRefresh(String(s.refreshSec)); setSize(String(s.historySize)); setTab(s.defaultTab); };
  useEffect(() => { void loadSettings().then(fill, (e: Error) => setError(e.message)); }, []);
  const changed = !!cur && (refresh !== String(cur.refreshSec) || size !== String(cur.historySize) || tab !== cur.defaultTab);
  const save = async () => {
    setBusy(true); setError('');
    try { fill(await saveSettings({ refreshSec: refresh, historySize: size, defaultTab: tab })); rt.toast('Gate settings saved.', 'success', 'Gate & rules'); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  if (!cur) return error ? <Err text={error} /> : <p className="axp-gate__sub">Loading…</p>;
  return (
    <div className="axp-gate__fields">
      <TextField label="Refresh every (seconds)" type="number" value={refresh} onChange={setRefresh} hint="How often the open tab asks the server again (5 to 600)." />
      <TextField label="History size (entries kept)" type="number" value={size} onChange={setSize} hint="The oldest entries go once History holds more than this (50 to 20000)." />
      <SelectField label="Tab it opens on" value={tab} onChange={setTab} options={TAB_OPTIONS} hint="The tab Gate & rules shows first." />
      <Err text={error} />
      <Bar id="gate.settings" label="Gate settings"><Button id="gate-settings-save" tone="primary" icon="save" busy={busy} disabled={!changed} onClick={() => void save()}>Save</Button></Bar>
    </div>
  );
}

/** From Settings → Plugins → Gate straight into a tab of the Gate screen (the gates, rules and lander are edited there). */
export function GateScreenLinks() {
  const rt = useRuntime();
  const [tab, setTab] = useState<string>(TABS[0]);
  return (
    <Bar id="gate.screen-links" label="Open the Gate screen">
      <SelectField label="Tab" value={tab} onChange={setTab} options={TAB_OPTIONS} hint="Gates, build rules, the merge line, the lander and History are on the Gate screen." />
      <Button id="gate-link-open" icon="external" onClick={() => { rt.closeDialog(); rt.dispatch(`gate.open:${tab}`); }}>Open tab</Button>
    </Bar>
  );
}
