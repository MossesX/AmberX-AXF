/**
 * Settings → Plugins → Gate → Server auto-lander (a panel in the Gate sub-tab: the settings library draws the tab's
 * level toolbar above it). The values live with the VPS lander (deploy/lander/config.json, the data folder's
 * config.json on top) and are read and written through GET / POST /api/plugins/gate/auto-lander/settings, the same call
 * as MCP (gate_auto_lander_settings, gate_auto_lander_settings_set), the CLI (`axf gate auto-lander set sizeCapLines
 * 3000`) and voice (`gate.auto-lander.set:sizeCapLines:3000`). console-control@1: `setting:gate.autoLander.<key>` (settingsStore.ts).
 */
import { useEffect, useState } from 'react';
import { Button, Switch, TextField, useRuntime } from '@console/axf/react';
import type { AutoLanderSettings as Settings } from './autoLanderState';
import { loadAutoLanderSettings, saveAutoLanderSettings } from './settingsStore';

type Num = 'sizeCapLines' | 'flakyReruns' | 'backoffBaseMin' | 'backoffFactor' | 'backoffMaxMin' | 'ciTimeoutMin' | 'fixTimeoutMin' | 'notifyAfterAttempts';
const NUMS: { key: Num; label: string; hint: string }[] = [
  { key: 'sizeCapLines', label: 'Lines one PR may carry', hint: 'A build whose steps change more than this lands as 2, 3 or more PRs, one at a time, in order.' },
  { key: 'flakyReruns', label: 'Re-runs of a red CI', hint: 'The failed jobs are re-run this many times on the same head before a red CI counts (flaky checks).' },
  { key: 'backoffBaseMin', label: 'First wait (minutes)', hint: 'How long it waits before the next attempt after a failure.' },
  { key: 'backoffFactor', label: 'Wait grows by', hint: 'Each further wait is the last one times this.' },
  { key: 'backoffMaxMin', label: 'Longest wait (minutes)', hint: 'The wait never grows past this; attempts never stop.' },
  { key: 'ciTimeoutMin', label: 'CI times out after (minutes)', hint: 'CI still running after this counts as a failure and is re-run.' },
  { key: 'fixTimeoutMin', label: 'A fix session times out after (minutes)', hint: 'A fix session that pushed nothing in this time is a failed attempt; another starts.' },
  { key: 'notifyAfterAttempts', label: 'Post every attempt from', hint: 'From this attempt on, each new attempt is posted in the crew chat and on the systems check (never silent).' },
];

export function AutoLanderSettings() {
  const rt = useRuntime();
  const [cur, setCur] = useState<Settings | null>(null);
  const [draft, setDraft] = useState<Record<string, string | boolean>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fill = (s: Settings) => { setCur(s); setDraft({ ...Object.fromEntries(NUMS.map((n) => [n.key, String(s[n.key])])), enabled: s.enabled }); };
  useEffect(() => { void loadAutoLanderSettings().then(fill, (e: Error) => setError(e.message)); }, []);
  const patch = cur ? Object.fromEntries(Object.entries(draft).filter(([k, v]) => String(v) !== String(cur[k as keyof Settings]))) : {};
  const changed = Object.keys(patch).length > 0;
  const save = async () => {
    setBusy(true); setError('');
    try { fill(await saveAutoLanderSettings(Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, typeof v === 'boolean' ? v : Number(v)])))); rt.toast('Lander settings saved.', 'success', 'Gate'); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  if (!cur && !error) return <p className="axp-gate__sub">Loading…</p>;
  return (
    <div className="axp-gate__fields">
      <Switch label="Land by itself" checked={draft.enabled === true} onChange={(v) => setDraft((d) => ({ ...d, enabled: v }))} hint="Off: the lander still reads every build but opens, merges and fixes nothing." />
      {NUMS.map((n) => <TextField key={n.key} label={n.label} type="number" value={String(draft[n.key] ?? '')} onChange={(v) => setDraft((d) => ({ ...d, [n.key]: v }))} hint={n.hint} />)}
      {error && <p className="axp-gate__err" role="alert">{error}</p>}
      <div className="axp-gate__bar"><Button id="gate-al-settings-save" tone="primary" icon="save" busy={busy} disabled={!changed} onClick={() => void save()}>Save</Button></div>
    </div>
  );
}
