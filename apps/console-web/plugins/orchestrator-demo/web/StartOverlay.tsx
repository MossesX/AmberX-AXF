/**
 * Start overlay (dialog `orchestrator-demo.start`): what the demo will do, a "Pause between steps" switch, and the
 * Continue / Pause / Stop toolbar. Continue plays the run (POST /start {pause}); Pause opens the run and holds it in
 * the overlay until Continue; Stop ends an open run and cleans up its demo-* builds. Everything here is one REST call
 * each, the same ones the MCP tools, the CLI and voice use.
 */
import { useEffect, useState } from 'react';
import { Button, Switch, useRuntime } from '@console/axf/react';
import { MIN_GAP_S, act, demo, isLive, useDemoState } from './api';
import './orchestrator-demo.css';

export function StartOverlay({ close }: { close: () => void }) {
  const rt = useRuntime();
  const { state, settings, error, setState } = useDemoState(1500);
  const [pause, setPause] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const pauseOn = pause ?? state?.run?.pause ?? settings?.pauseBetweenSteps ?? true;
  const run = state?.run ?? null;
  const inOverlay = run?.state === 'overlay';
  const playing = isLive(state) && !inOverlay;

  // a run that is already playing has nothing to start: show where it is instead
  useEffect(() => { if (playing) setMsg(`The demo is already running (${run?.state}). Use the caption bar to pause, skip or stop it.`); }, [playing, run?.state]);

  const go = async (fn: () => Promise<string>) => { setBusy(true); const e = await fn(); setBusy(false); setMsg(e); return e; };
  const onContinue = () => go(async () => {
    const e = await act(() => demo.start(pauseOn), setState);
    if (!e) { close(); rt.navigate('builds'); }
    return e;
  });
  const onPause = () => go(async () => {
    const e = inOverlay ? '' : await act(() => demo.open(pauseOn), setState);
    return e || act(() => demo.pause(), setState);
  });
  const onStop = () => go(async () => { const e = run && isLive(state) ? await act(() => demo.stop(), setState) : ''; if (!e) close(); return e; });
  const onSwitch = (v: boolean) => { setPause(v); if (inOverlay) void act(() => demo.setPause(v).then((r) => ({ state: r.state })), setState); };

  const parts = state?.outline ?? [];
  const total = parts.reduce((n, p) => n + p.acts.length, 0);
  const minutes = Math.ceil((total * MIN_GAP_S) / 60);

  return (
    <div className="axp-orchestrator-demo__overlay" data-axf-target="dialog:orchestrator-demo.start">
      <p className="axp-orchestrator-demo__lead">
        A guided tour of the Build orchestrator on throwaway <code>demo-*</code> builds. Before each act the console is
        brought to what to watch, with a caption. At least {MIN_GAP_S} s between acts{total ? ` (${total} acts, about ${minutes} min or more)` : ''}.
        Real builds are never touched and no Claude account is spent.
      </p>
      {parts.length > 0 && (
        <ol className="axp-orchestrator-demo__parts">
          {parts.map((p) => (
            <li key={p.part} className="axp-orchestrator-demo__part">
              <span className="axp-orchestrator-demo__part-title">{p.title}</span>
              <span className="axp-orchestrator-demo__muted">{p.acts.map((a) => a.title).join(' · ')}</span>
            </li>
          ))}
        </ol>
      )}
      <Switch
        label="Pause between steps"
        checked={pauseOn}
        onChange={onSwitch}
        disabled={busy || playing}
        hint={pauseOn ? 'After each act it waits on what to watch until you press Next, then 30 s, then focuses the next.' : `It plays on by itself, ${MIN_GAP_S} s between acts.`}
      />
      {state?.held && inOverlay && <p className="axp-orchestrator-demo__note" role="status">Paused before the first act. Continue when you are ready.</p>}
      {(msg || error) && <p className="axp-orchestrator-demo__error" role="alert">{msg || error}</p>}
      <div className="axp-orchestrator-demo__toolbar" role="toolbar" aria-label="Start the orchestrator demo">
        <Button tone="primary" icon="play" disabled={busy || playing} onClick={() => void onContinue()}>Continue</Button>
        <Button icon="pause" disabled={busy || playing || (inOverlay && state?.held)} onClick={() => void onPause()}>Pause</Button>
        <span className="axp-orchestrator-demo__spacer" />
        <Button tone="danger" icon="x-circle" disabled={busy} onClick={() => void onStop()}>{run && isLive(state) ? 'Stop' : 'Close'}</Button>
      </div>
    </div>
  );
}
