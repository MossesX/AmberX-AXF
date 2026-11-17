/**
 * Build watchdog (build-watchdog@1) in the console. Brett, Nov 13 2026: "if anything stops working, the server/orchestrator
 * fixes it automatically with no one asking … Never wait for Brett to notice."
 *
 * - WatchdogSettingsPanel: Settings → Plugins → Build orchestrator → Watchdog (a settings panel, so the settings level
 *   toolbar shows or hides it like any other). On/off, interval, stale heartbeat minutes, max retries, retry on another
 *   account, FYI per fix or batched. Saved server-side (PUT watchdog/settings → build-watchdog-settings.json in the shared
 *   pipeline folder), so the host's cron pass reads the same values; the same keys are on the CLI (`watchdog.mjs set`),
 *   MCP and voice.
 */
import { useEffect, useState } from 'react';
import { Button, Note, SelectField, Switch, TextField } from '@console/axf/react';
import { pluginApi } from '@console/plugins';
import { FOLDER } from './ui';

export interface WatchdogSettings { enabled: boolean; intervalMin: number; staleMin: number; graceMin: number; maxRetries: number; retryOtherAccount: boolean; fyi: 'batch' | 'each'; cooldownMin: number }

export const watchdogApi = pluginApi(FOLDER, 'Build watchdog', { unavailable: 'The build orchestrator is switched off or its server part is not running.' });

const NUMBERS: { key: 'intervalMin' | 'staleMin' | 'maxRetries'; label: string; hint: string; min: number; max: number }[] = [
  { key: 'intervalMin', label: 'Interval (minutes)', hint: 'How often a pass runs (the cron ticks every minute and skips until this is due).', min: 1, max: 60 },
  { key: 'staleMin', label: 'Stale heartbeat (minutes)', hint: 'No log or meter output for this long while marked running = hung or dead.', min: 1, max: 240 },
  { key: 'maxRetries', label: 'Max retries', hint: 'Crashes and kills retried this many times since the last ticked step; then Pending with a banner item.', min: 0, max: 10 },
];

function NumberRow({ label, hint, value, min, max, onSave }: { label: string; hint: string; value: number; min: number; max: number; onSave: (v: number) => void }) {
  const [v, setV] = useState(String(value));
  useEffect(() => { setV(String(value)); }, [value]);
  const n = Number(v);
  const bad = v === '' || !Number.isInteger(n) || n < min || n > max;
  return (
    <div className="oc-wd-num">
      <TextField label={label} type="number" value={v} onChange={setV} hint={hint} error={bad ? `${min}–${max}` : undefined} />
      <Button size="sm" disabled={bad || n === value} onClick={() => onSave(n)}>Save</Button>
    </div>
  );
}

export function WatchdogSettingsPanel() {
  const [s, setS] = useState<WatchdogSettings | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => { void watchdogApi.call<{ settings: WatchdogSettings }>('watchdog/settings').then((r) => setS(r.settings)).catch((e: Error) => setErr(e.message)); }, []);
  const save = async (patch: Partial<WatchdogSettings>) => {
    setErr('');
    try { setS((await watchdogApi.put<{ settings: WatchdogSettings }>('watchdog/settings', patch)).settings); } catch (e) { setErr((e as Error).message); }
  };
  if (!s) return err ? <Note tone="danger">{err}</Note> : <p className="fx-small fx-muted">Loading…</p>;
  return (
    <div className="fx-stack oc-wd-settings">
      <Switch label="Watchdog on" checked={s.enabled} onChange={(v) => void save({ enabled: v })}
        hint="Builds marked running with no live session (killed, failed, hung, tmux gone) are reset, requeued and retried, idle slots filled, and the phone gets an FYI per fix." />
      {NUMBERS.map((f) => <NumberRow key={f.key} label={f.label} hint={f.hint} value={s[f.key]} min={f.min} max={f.max} onSave={(v) => void save({ [f.key]: v })} />)}
      <Switch label="Retry on another account" checked={s.retryOtherAccount} onChange={(v) => void save({ retryOtherAccount: v })}
        hint="A usage limit or a dead login moves the retry to the next worker account; off = retry on whichever account the dispatcher picks." />
      <SelectField label="Phone FYI" value={s.fyi} onChange={(v) => void save({ fyi: v === 'each' ? 'each' : 'batch' })}
        options={[{ value: 'batch', label: 'Batched: one push per pass' }, { value: 'each', label: 'One push per fix' }]}
        hint="A give-up is always its own alert." />
      {err && <Note tone="danger">{err}</Note>}
    </div>
  );
}
