/**
 * The Orchestrator demo page (view `orchestrator-demo`): the run's check-list with every act crossed off as it goes
 * (✓ pass, ✗ fail with what failed, – skipped, ▶ now), under the page toolbar (asset `toolbar:orchestrator-demo`:
 * Start, Summary, Next, Pause, Resume, Skip, Stop). The live caption bar does the guiding; this page is where the whole
 * list is.
 */
import { PageToolbar } from '@console/axf/react';
import { useDemoState } from './api';
import './orchestrator-demo.css';

export function DemoView() {
  const { state, error } = useDemoState(1000, 5000);
  const run = state?.run ?? null;
  const sum = state?.summary ?? null;
  return (
    <div className="axp-orchestrator-demo__page" data-axf-target="view:orchestrator-demo">
      <header className="fx-pagehead">
        <div>
          <p className="fx-eyebrow">Builds{sum && run ? ` · ${run.state} · ${sum.pass} passed · ${sum.fail} failed · ${sum.skipped} skipped · ${sum.remaining} to go` : ''}</p>
          <h1>Orchestrator demo</h1>
          <p className="fx-muted">A guided live run of the build orchestrator on throwaway demo builds, every act crossed off as it goes.</p>
        </div>
      </header>
      <PageToolbar view="orchestrator-demo" />
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
