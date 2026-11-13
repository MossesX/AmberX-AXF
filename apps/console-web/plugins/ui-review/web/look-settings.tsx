import { useEffect, useState } from 'react';
import { Note, Switch, useRuntime } from '@console/axf/react';
import { pluginApi } from '@console/plugins';
import { GATE, GATE_LABEL, gateLine } from './review-core.mjs';
import { FOLDER } from './keys';

/*
 * Settings → Plugins → UI Review → Merge gate (Brett, Nov 13 2026: "UI Review must not be a gate. Add an on/off switch
 * in UI Review settings, 'UI Review is a merge gate', default OFF"). One framework Switch on the gate API (GET / POST
 * gate; also MCP ui_review_gate_get / ui_review_gate_set, review.mjs gate [on|off|status] and voice uireview.gate),
 * shown from the Simple level up. Its value is the Claude setting builds.uiReviewGate: anyone may turn it off, only
 * Brett's own click turns it on, so the server refuses an "on" that isn't his and the switch shows why.
 */

const api = pluginApi(FOLDER, 'UI Review', { unavailable: 'The UI Review plugin is switched off or its server part is not running.' });
type Gate = typeof GATE;

export function GatePanel() {
  const rt = useRuntime();
  const [g, setG] = useState<Gate>(GATE);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.call<Gate>('gate').then(setG, () => undefined); }, []);
  const flip = (on: boolean) => {
    setBusy(true);
    void api.post<Gate>('gate', { on }).then(
      (x) => { setG(x); rt.toast(`${GATE_LABEL}: ${x.on ? 'on' : 'off'}`, 'success'); },
      (e: Error) => rt.toast(e.message, 'danger'),
    ).finally(() => setBusy(false));
  };
  return (
    <div className="fx-stack" data-ui-review-gate={g.on ? 'on' : 'off'} id="gate">
      <Switch label={GATE_LABEL} checked={g.on} disabled={busy} hint={gateLine(g.on)} onChange={flip} />
      {g.on && g.heldPrs.length > 0 && <Note tone="warning" icon="clock">Held for UI Review: {g.heldPrs.map((n) => `#${n}`).join(', ')}.</Note>}
      <p className="fx-small fx-muted">{g.who} Also: GET or POST /api/plugins/{FOLDER}/gate · MCP ui_review_gate_get / ui_review_gate_set · review.mjs gate on|off|status · voice uireview.gate.</p>
    </div>
  );
}
