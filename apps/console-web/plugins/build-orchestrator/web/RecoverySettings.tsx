/**
 * Recovery settings (Settings → Plugins → Build orchestrator → Recovery): auto-recover on / off, max retries, stale
 * heartbeat minutes, backoff, FYI per fix. Claude settings builds.recovery.* (also in Settings → Plugins → Claude, group
 * Builds, with their levels). Basic shows the two switches; Developer and up show the numbers too, as the settings level
 * toolbar picks. Same calls without the UI: POST recovery/settings, MCP recovery-settings, `recover.mjs settings set k=v`.
 */
import { useEffect, useState } from 'react';
import { Button, Container, Switch, TextField, useRuntime } from '@console/axf/react';
import { SETTINGS_LEVEL_KEY, SETTINGS_LEVELS, type SettingsLevel } from '@console/axf/core';
import { recoveryApi, useRecovery, type RecoverySettings as Settings } from './recovery';

/** The level this panel shows at: the settings page's level toolbar (default basic). */
function useLevel(): SettingsLevel {
  const rt = useRuntime();
  const read = () => { const v = String(rt.settings.get(SETTINGS_LEVEL_KEY) ?? ''); return (SETTINGS_LEVELS as readonly string[]).includes(v) ? (v as SettingsLevel) : 'basic'; };
  const [lvl, setLvl] = useState<SettingsLevel>(read);
  useEffect(() => rt.settings.onChange(SETTINGS_LEVEL_KEY, () => setLvl(read())), [rt]); // eslint-disable-line react-hooks/exhaustive-deps
  return lvl;
}
const atLeast = (at: SettingsLevel, need: SettingsLevel) => SETTINGS_LEVELS.indexOf(at) >= SETTINGS_LEVELS.indexOf(need);

function Num({ label, hint, value, min, max, onSave }: { label: string; hint: string; value: number; min: number; max: number; onSave: (v: number) => void }) {
  const [v, setV] = useState(String(value));
  useEffect(() => { setV(String(value)); }, [value]);
  const n = Number(v);
  const bad = v === '' || !Number.isInteger(n) || n < min || n > max;
  return (
    <div className="oc-rec-row">
      <TextField label={label} type="number" value={v} onChange={setV} hint={hint} error={bad ? `${min}–${max}` : undefined} />
      <Button size="sm" disabled={bad || n === value} onClick={() => onSave(n)}>Save</Button>
    </div>
  );
}

export function RecoverySettings() {
  const rt = useRuntime();
  const level = useLevel();
  const { state, error, reload } = useRecovery(60_000);
  const [backoff, setBackoff] = useState('');
  const s = state?.settings;
  useEffect(() => { if (s) setBackoff(s.backoffMin); }, [s?.backoffMin]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = async (patch: Partial<Settings>) => {
    try { await recoveryApi.post('recovery/settings', patch); await reload(); rt.toast('Recovery settings saved', 'success'); }
    catch (e) { rt.toast((e as Error).message, 'danger'); }
  };
  if (!s) return <Container title="Recovery" icon="refresh"><p className="fx-small fx-muted">{error || 'Loading…'}</p></Container>;
  const backoffBad = !/^\s*\d{1,4}(\s*,\s*\d{1,4}){0,9}\s*$/.test(backoff);
  return (
    <Container title="Recovery" icon="refresh">
      <div className="oc-rec-settings" data-axf-settings="build-orchestrator.recovery">
        <Switch label="Auto-recover stuck builds" checked={s.enabled} onChange={(v) => void save({ enabled: v })}
          hint="Every minute the dispatcher puts stuck builds back in the Queue (no live session, killed exit 143, failed exit 1, hung), frees leaked slots and fills every free slot." />
        <Switch label="FYI per fix" checked={s.fyi} onChange={(v) => void save({ fyi: v })}
          hint="One plain line to the phone for each fix. A build parked after the retry cap is always sent." />
        {atLeast(level, 'developer') && (
          <>
            <Num label="Max retries" hint="Automatic retries per build before it is parked in Pending for you" value={s.maxRetries} min={0} max={10} onSave={(v) => void save({ maxRetries: v })} />
            <Num label="Stale heartbeat (minutes)" hint="A session whose stream has not moved this long is hung: ended and retried" value={s.staleHeartbeatMin} min={5} max={240} onSave={(v) => void save({ staleHeartbeatMin: v })} />
            <div className="oc-rec-row">
              <TextField label="Backoff (minutes)" value={backoff} onChange={setBackoff} mono hint="Wait before each retry, comma separated (the last repeats)" error={backoffBad ? 'e.g. 1,5,15' : undefined} />
              <Button size="sm" disabled={backoffBad || backoff.replace(/\s/g, '') === s.backoffMin} onClick={() => void save({ backoffMin: backoff.replace(/\s/g, '') })}>Save</Button>
            </div>
          </>
        )}
        {!atLeast(level, 'developer') && <p className="fx-small fx-muted">Retries, heartbeat and backoff show at the Developer level.</p>}
      </div>
    </Container>
  );
}
