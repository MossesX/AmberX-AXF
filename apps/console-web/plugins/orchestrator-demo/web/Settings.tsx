/**
 * Settings → Plugins → Orchestrator demo: the default for Pause between steps (PUT /pause-between-steps, which also
 * applies to a run in progress) and the minimum gap between acts, shown read-only: it is 30 s and can't go lower.
 */
import { useEffect, useState } from 'react';
import { Button, Switch, useRuntime } from '@console/axf/react';
import { DIALOG_START, MIN_GAP_S, demo, type Settings } from './api';
import './orchestrator-demo.css';

export function SettingsPanel() {
  const rt = useRuntime();
  const [s, setS] = useState<Settings | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { demo.settings().then((r) => setS(r.settings)).catch((e: unknown) => setError(e instanceof Error ? e.message : String(e))); }, []);
  const set = async (pause: boolean) => {
    try { const r = await demo.setPause(pause); setS(r.settings); setError(''); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  const gap = Math.max(MIN_GAP_S, Math.round((s?.minGapMs ?? MIN_GAP_S * 1000) / 1000));
  return (
    <div className="axp-orchestrator-demo__settings">
      <Switch
        label="Pause between steps (default)"
        checked={s?.pauseBetweenSteps ?? true}
        disabled={!s}
        onChange={(v) => void set(v)}
        hint="On: after each act the demo waits on what to watch until you press Next, then the gap, then the next act. Changes a run in progress too."
      />
      <p className="axp-orchestrator-demo__lead">Minimum gap between acts: <b>{gap} s</b> <span className="axp-orchestrator-demo__muted">(fixed; it can't go below {MIN_GAP_S} s)</span></p>
      {error && <p className="axp-orchestrator-demo__error" role="alert">{error}</p>}
      <div className="axp-orchestrator-demo__toolbar" role="toolbar" aria-label="Orchestrator demo settings">
        <Button tone="primary" icon="play" onClick={() => rt.openDialog(DIALOG_START)}>Open the start overlay</Button>
      </div>
    </div>
  );
}
