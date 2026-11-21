/**
 * Limits tab, also drawn in Settings → Plugins → Gate: the lander's limits (deploy/lander/config.json on the VPS, the
 * data folder's config.json on top), grouped: landing, size, retries, timeouts. Read and written through GET / POST
 * auto-lander/settings, the same call as MCP (gate_auto_lander_settings, gate_auto_lander_settings_set), the CLI
 * (`axf gate auto-lander set sizeCapLines 3000`) and voice (`gate.auto-lander.set:sizeCapLines:3000`).
 * console-control@1: `setting:gate.autoLander.<key>` (settingsStore.ts). Values go as typed; the lander checks them.
 */
import { useEffect, useState } from 'react';
import { Button, SelectField, Switch, TextField, useRuntime } from '@console/axf/react';
import type { AutoLanderSettings as Settings } from './autoLanderState';
import { loadAutoLanderSettings, saveAutoLanderSettings } from './settingsStore';
import { Bar, Err, Fold } from './ui';

type Key = keyof Settings;
interface FieldDef { key: Key; label: string; hint: string; kind?: 'number' | 'text' | 'method' }
const GROUPS: { id: string; title: string; icon: string; fields: FieldDef[] }[] = [
  { id: 'size', title: 'Build size', icon: 'layers', fields: [
    { key: 'sizeCapLines', label: 'Lines one PR may carry', hint: 'A build whose steps change more than this lands as 2, 3 or more PRs, one at a time, in order.' },
  ] },
  { id: 'retries', title: 'Retries', icon: 'refresh', fields: [
    { key: 'flakyReruns', label: 'Re-runs of a red CI', hint: 'The failed jobs are re-run this many times on the same head before a red CI counts (flaky checks). 0 to 5.' },
    { key: 'backoffBaseMin', label: 'First wait (minutes)', hint: 'How long it waits before the next attempt after a failure.' },
    { key: 'backoffFactor', label: 'Wait grows by', hint: 'Each further wait is the last one times this.' },
    { key: 'backoffMaxMin', label: 'Longest wait (minutes)', hint: 'The wait never grows past this; attempts never stop.' },
    { key: 'notifyAfterAttempts', label: 'Post every attempt from', hint: 'From this attempt on, each new attempt is posted in the crew chat and on the systems check.' },
  ] },
  { id: 'timeouts', title: 'Timeouts', icon: 'clock', fields: [
    { key: 'ciNoneKickMin', label: 'Start CI again after (minutes)', hint: 'A PR whose CI never started is pushed again after this long.' },
    { key: 'ciTimeoutMin', label: 'CI times out after (minutes)', hint: 'CI still running after this counts as a failure and is re-run.' },
    { key: 'fixTimeoutMin', label: 'A fix session times out after (minutes)', hint: 'A fix session that pushed nothing in this time is a failed attempt; another starts.' },
  ] },
  { id: 'merge', title: 'How it merges', icon: 'branch', fields: [
    { key: 'mergeMethod', label: 'Merge method', kind: 'method', hint: 'How a green PR goes into main: a merge commit, one squashed commit, or a rebase.' },
    { key: 'workflow', label: 'CI workflow', kind: 'text', hint: 'The workflow file whose run decides green or red.' },
  ] },
];
const METHODS = [{ value: 'merge', label: 'Merge commit' }, { value: 'squash', label: 'Squash' }, { value: 'rebase', label: 'Rebase' }];

export function LimitsTab({ flat = false }: { flat?: boolean }) {
  const rt = useRuntime();
  const [cur, setCur] = useState<Settings | null>(null);
  const [draft, setDraft] = useState<Record<string, string | boolean>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fill = (s: Settings) => { setCur(s); setDraft(Object.fromEntries(Object.entries(s).map(([k, v]) => [k, typeof v === 'boolean' ? v : String(v ?? '')]))); };
  useEffect(() => { void loadAutoLanderSettings().then(fill, (e: Error) => setError(e.message)); }, []);
  const changed = cur ? Object.keys(draft).filter((k) => String(draft[k]) !== String(cur[k as Key] ?? '')) : [];
  const save = async () => {
    setBusy(true); setError('');
    try { fill(await saveAutoLanderSettings(Object.fromEntries(changed.map((k) => [k, draft[k]])))); rt.toast('Limits saved.', 'success', 'Gate & rules'); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  if (!cur) return error ? <Err text={error} /> : <p className="axp-gate__sub">Loading the limits…</p>;
  const set = (k: string) => (v: string | boolean) => setDraft((d) => ({ ...d, [k]: v }));
  const field = (f: FieldDef) => (f.kind === 'method'
    ? <SelectField key={f.key} label={f.label} value={String(draft[f.key] ?? '')} onChange={set(f.key)} options={METHODS} hint={f.hint} />
    : <TextField key={f.key} label={f.label} type={f.kind === 'text' ? 'text' : 'number'} mono={f.kind === 'text'} value={String(draft[f.key] ?? '')} onChange={set(f.key)} hint={f.hint} />);
  return (
    <div className="axp-gate__panel">
      <Switch label="Land by itself" checked={draft.enabled === true} onChange={set('enabled')} hint="Off: the lander still reads every build but opens, merges and fixes nothing." />
      {GROUPS.map((g, i) => (flat
        ? <div key={g.id} className="axp-gate__fields">{g.fields.map(field)}</div>
        : <Fold key={g.id} title={g.title} icon={g.icon} open={i < 2}><div className="axp-gate__fields">{g.fields.map(field)}</div></Fold>))}
      <Err text={error} />
      <Bar id="gate.limits" label="Limits"><Button id="gate-al-settings-save" tone="primary" icon="save" busy={busy} disabled={!changed.length} onClick={() => void save()}>Save limits</Button></Bar>
    </div>
  );
}
