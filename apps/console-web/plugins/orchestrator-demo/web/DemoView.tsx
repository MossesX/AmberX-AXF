/**
 * The Orchestrator demo page (view `orchestrator-demo`): the run's check-list with every act crossed off as it goes
 * (✓ pass, ✗ fail with what failed, – skipped, ▶ now), and Start / Summary on a toolbar. The live caption bar does the
 * guiding; this page is where the whole list is.
 */
import { Button, useRuntime } from '@console/axf/react';
import { DIALOG_START, DIALOG_SUMMARY, isLive, useDemoState } from './api';
import './orchestrator-demo.css';

export function DemoView() {
  const rt = useRuntime();
  const { state, error } = useDemoState(1000, 5000);
  const run = state?.run ?? null;
  const sum = state?.summary ?? null;
  return (
    <div className="axp-orchestrator-demo__page" data-axf-target="view:orchestrator-demo">
      <header className="fx-pagehead">
        <div>
          <p className="fx-eyebrow">Build orchestrator · Guided demo</p>
          <h1>Orchestrator demo</h1>
          <p className="fx-muted">Watch the orchestrator queue, launch, crash, retry, fix, land and fail on throwaway demo builds, one act at a time.</p>
        </div>
      </header>
      <div className="axp-orchestrator-demo__toolbar is-head" role="toolbar" aria-label="Orchestrator demo">
        <Button tone="primary" icon="play" disabled={isLive(state) && run?.state !== 'overlay'} onClick={() => rt.openDialog(DIALOG_START)}>Start the demo</Button>
        <Button icon="list" disabled={!run} onClick={() => rt.openDialog(DIALOG_SUMMARY)}>Summary</Button>
        <span className="axp-orchestrator-demo__spacer" />
        {sum && run && <span className="axp-orchestrator-demo__muted">{run.state} · {sum.pass} passed · {sum.fail} failed · {sum.skipped} skipped · {sum.remaining} to go</span>}
      </div>
      {error && <p className="axp-orchestrator-demo__error" role="alert">{error}</p>}
      {!run && !error && <p className="axp-orchestrator-demo__muted">No demo run yet. Start the demo to watch the orchestrator queue, launch, crash, retry, fix, land and fail on throwaway demo builds.</p>}
      {run && (
        <ol className="axp-orchestrator-demo__checklist" aria-label="Demo acts">
          {(state?.checklist ?? []).map((c) => (
            <li key={c.actId} className={`axp-orchestrator-demo__check${c.result ? ` is-${c.result}` : ''}${c.mark === '▶' ? ' is-active' : ''}`} data-axf-target={`row:orchestrator-demo/act:${c.actId}`}>
              <span className="axp-orchestrator-demo__mark" aria-hidden="true">{c.mark}</span>
              <span className="axp-orchestrator-demo__check-title">{c.title}</span>
              {c.result === 'fail' && <span className="axp-orchestrator-demo__error">{c.error || c.observed}</span>}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
