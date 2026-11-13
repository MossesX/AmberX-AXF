import { useEffect, useState } from 'react';
import { Button, Note, useRuntime } from '@console/axf/react';
import { pluginApi } from '@console/plugins';
import { GATE } from './review-core.mjs';
import { FOLDER } from './keys';

/*
 * Settings → Plugins → UI Review → Not a gate. UI Review stopped being a gate on Nov 13 2026 (build
 * remove-ui-review-as-a-gate-…): no PR waits for it, no build has to submit screenshots and the launcher never waits for
 * a predicted look. This read-only line shows that, read from the gate API (GET gate; also MCP ui_review_gate,
 * review.mjs gate and the console action ui-review.gate). The old "Wait for my look approval before UI builds start"
 * switch is retired with it: predicted looks are still made, as feedback.
 */

const api = pluginApi(FOLDER, 'UI Review', { unavailable: 'The UI Review plugin is switched off or its server part is not running.' });
type Gate = typeof GATE;

export function GatePanel() {
  const rt = useRuntime();
  const [g, setG] = useState<Gate>(GATE);
  useEffect(() => { api.call<Gate>('gate').then(setG, () => undefined); }, []);
  const read = () => { void api.call<Gate>('gate').then((x) => { setG(x); rt.terminal.log('ui-review', `GET /api/plugins/${FOLDER}/gate → ${JSON.stringify(x)}`, 'ok'); }, (e: Error) => rt.toast(e.message, 'danger')); };
  return (
    <div className="fx-stack" data-ui-review-gate={g.gate ? 'on' : 'off'}>
      <Note tone="info" icon="info">
        Not a gate (since {g.since}). Approve, Ask changes, Reject and Choices are optional feedback: no PR waits for them, no build has to send screenshots, and predicted looks never hold a build.
      </Note>
      <p className="fx-small fx-muted">Read it anywhere: GET /api/plugins/{FOLDER}/gate · MCP ui_review_gate · review.mjs gate · voice / console action ui-review.gate.</p>
      <div className="fx-row" role="toolbar" aria-label="UI Review gate">
        <Button size="sm" icon="external" onClick={read}>Read the gate API</Button>
      </div>
    </div>
  );
}
