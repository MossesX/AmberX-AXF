/**
 * Settings → Plugins → Gate → Server auto-lander (a panel in the Gate sub-tab: the settings library draws the tab's
 * level toolbar above it). The values live with the VPS service (deploy/auto-lander, control.json in its data folder)
 * and are read and written through GET / POST /api/plugins/gate/auto-lander/settings, the same call as MCP
 * (gate_auto_lander_settings, gate_auto_lander_settings_set), the CLI (`axf gate auto-lander set maxAttempts 5`) and voice
 * (`gate.auto-lander.set:maxAttempts:5`). console-control@1: `setting:gate.autoLander.<key>` (settingsStore.ts).
 */
import { useEffect, useState } from 'react';
import { Button, Switch, TextField, useRuntime } from '@console/axf/react';
import type { AutoLanderSettings as Settings } from './autoLanderState';
import { loadAutoLanderSettings, saveAutoLanderSettings } from './settingsStore';

type Num = 'maxAttempts' | 'backoffBaseMin' | 'backoffFactor' | 'backoffMaxMin' | 'attemptTimeoutMin';
const NUMS: { key: Num; label: string; hint: string }[] = [
  { key: 'maxAttempts', label: 'Tries before it asks for a hand', hint: 'Failed tries of one kind (merge main, fix red CI, land) before the build goes to the systems check banner (1 to 10).' },
  { key: 'backoffBaseMin', label: 'First wait (minutes)', hint: 'How long it waits after the first failed try.' },
  { key: 'backoffFactor', label: 'Wait grows by', hint: 'Each further wait is the last one times this.' },
  { key: 'backoffMaxMin', label: 'Longest wait (minutes)', hint: 'The wait never grows past this.' },
  { key: 'attemptTimeoutMin', label: 'A try times out after (minutes)', hint: 'A merge, fix session or land with no result after this counts as failed.' },
];

export function AutoLanderSettings() {
  const rt = useRuntime();
  const [cur, setCur] = useState<Settings | null>(null);
  const [draft, setDraft] = useState<Record<string, string | boolean>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fill = (s: Settings) => { setCur(s); setDraft({ ...Object.fromEntries(NUMS.map((n) => [n.key, String(s[n.key])])), enabled: s.enabled, pushOnEscalation: s.pushOnEscalation }); };
  useEffect(() => { void loadAutoLanderSettings().then(fill, (e: Error) => setError(e.message)); }, []);
  const patch = cur ? Object.fromEntries(Object.entries(draft).filter(([k, v]) => String(v) !== String(cur[k as keyof Settings]))) : {};
  const changed = Object.keys(patch).length > 0;
  const save = async () => {
    setBusy(true); setError('');
    try { fill(await saveAutoLanderSettings(Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, typeof v === 'boolean' ? v : Number(v)])))); rt.toast('Auto-lander settings saved.', 'success', 'Gate'); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  if (!cur && !error) return <p className="axp-gate__sub">Loading…</p>;
  return (
    <div className="axp-gate__fields">
      <Switch label="Fix and land by itself" checked={draft.enabled === true} onChange={(v) => setDraft((d) => ({ ...d, enabled: v }))} hint="Off: the server auto-lander still reads every build but merges, fixes and lands nothing." />
      {NUMS.map((n) => <TextField key={n.key} label={n.label} type="number" value={String(draft[n.key] ?? '')} onChange={(v) => setDraft((d) => ({ ...d, [n.key]: v }))} hint={n.hint} />)}
      <Switch label="Push to my phone when it gives up" checked={draft.pushOnEscalation === true} onChange={(v) => setDraft((d) => ({ ...d, pushOnEscalation: v }))} hint="One push per build it gives up on; the banner item shows either way." />
      {error && <p className="axp-gate__err" role="alert">{error}</p>}
      <div className="axp-gate__bar"><Button id="gate-al-settings-save" tone="primary" icon="save" busy={busy} disabled={!changed} onClick={() => void save()}>Save</Button></div>
    </div>
  );
}
