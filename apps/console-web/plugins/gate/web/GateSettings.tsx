/**
 * Settings → Plugins → VPS Configuration (a sub-tab: the settings library draws the tab's level toolbar above it). The plugin's own
 * settings live on the server (GET / PUT settings), so the CLI (`axf gate settings set refreshSec 60`), MCP
 * (gate_settings, gate_settings_set), voice (`gate.setting:refreshSec:60`, "set the gate refresh to 60") and this panel
 * read and write the same values. console-control@1: `setting:gate.refreshSec | gate.historySize | gate.defaultTab`.
 */
import { useEffect, useState } from 'react';
import { Button, SelectField, TextField, useRuntime } from '@console/axf/react';
import type { GateSettings as Settings } from './api';
import { loadSettings, saveSettings } from './settingsStore';

export function GateSettings() {
  const rt = useRuntime();
  const [cur, setCur] = useState<Settings | null>(null);
  const [refresh, setRefresh] = useState('');
  const [size, setSize] = useState('');
  const [tab, setTab] = useState('rules');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fill = (s: Settings) => { setCur(s); setRefresh(String(s.refreshSec)); setSize(String(s.historySize)); setTab(s.defaultTab); };
  useEffect(() => { void loadSettings().then(fill, (e: Error) => setError(e.message)); }, []);
  const changed = !!cur && (refresh !== String(cur.refreshSec) || size !== String(cur.historySize) || tab !== cur.defaultTab);
  const save = async () => {
    setBusy(true); setError('');
    try { fill(await saveSettings({ refreshSec: Number(refresh), historySize: Number(size), defaultTab: tab as Settings['defaultTab'] })); rt.toast('Gate settings saved.', 'success', 'VPS Configuration'); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  if (!cur && !error) return <p className="axp-gate__sub">Loading…</p>;
  return (
    <div className="axp-gate__fields">
      <TextField label="Refresh every (seconds)" type="number" value={refresh} onChange={setRefresh} hint="How often the open tab asks the lander again (5 to 600)." />
      <TextField label="History size (entries kept)" type="number" value={size} onChange={setSize} hint="The oldest entries go once History holds more than this (50 to 20000)." />
      <SelectField label="Tab it opens on" value={tab} onChange={setTab} options={[{ value: 'rules', label: 'Rules' }, { value: 'build-rules', label: 'Build rules' }, { value: 'auto-lander', label: 'Auto-lander' }, { value: 'build-cap', label: 'Build cap' }, { value: 'approvals', label: 'Approval rules' }, { value: 'passes', label: 'Passes' }, { value: 'history', label: 'History' }]} hint="Unless you were on another tab last time (the tab row remembers it)." />
      {error && <p className="axp-gate__err" role="alert">{error}</p>}
      <div className="axp-gate__bar"><Button id="gate-settings-save" tone="primary" icon="save" busy={busy} disabled={!changed} onClick={() => void save()}>Save</Button></div>
    </div>
  );
}



/** Links from Settings → Plugins → VPS Configuration into the VPS Configuration screen's own tabs (build rules and the auto-lander stay there). */
export function GateScreenLinks() {
  const rt = useRuntime();
  const open = (tab: string) => { rt.closeDialog(); rt.dispatch(`gate.open:${tab}`); };
  return (
    <div className="axp-gate__bar">
      <Button id="gate-link-rules" icon="shield" onClick={() => open('rules')}>Rules</Button>
      <Button id="gate-link-build-rules" icon="list" onClick={() => open('build-rules')}>Build rules</Button>
      <Button id="gate-link-auto-lander" icon="branch" onClick={() => open('auto-lander')}>Auto-lander</Button>
      <Button id="gate-link-history" icon="clock" onClick={() => open('history')}>History</Button>
    </div>
  );
}
