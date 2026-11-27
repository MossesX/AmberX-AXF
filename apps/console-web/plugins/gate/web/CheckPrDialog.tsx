/**
 * "Check a PR" (dialog gate.check-pr, props { pr }): can this PR land? The gate verdict (gate-verdict@1) from GET check?pr=,
 * the same answer as `axf gate check <pr>`, MCP gate_check_pr and the voice line "can 705 land". It changes nothing.
 */
import { useEffect, useState } from 'react';
import { Chip } from '@console/axf/react';
import { gateCall, type Verdict } from './api';

export const CHECK_PR_DIALOG = 'gate.check-pr';
const tone = (v: string) => (v === 'pass' ? 'success' : v === 'fail' ? 'danger' : v === 'hold' ? 'warning' : undefined);

export function CheckPrDialog({ pr }: { pr: string }) {
  const [v, setV] = useState<Verdict | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { void gateCall<Verdict>(`check?pr=${encodeURIComponent(pr)}`).then(setV, (e: Error) => setError(e.message)); }, [pr]);
  if (error) return <p className="axp-gate__err" role="alert">{error}</p>;
  if (!v) return <p className="axp-gate__sub">Checking #{pr}…</p>;
  return (
    <div className="axp-gate__panel">
      <p><strong>#{v.pr} {v.pass ? 'can land: every rule passes.' : v.held ? 'waits.' : 'needs a fix.'}</strong>{v.known === false && <span className="axp-gate__sub"> The lander doesn't know this PR yet, so its checks count as not run.</span>}</p>
      {!!v.reasons.length && <ul className="axp-gate__list">{v.reasons.map((r) => <li key={r}>{r}</li>)}</ul>}
      {!!v.warnings.length && <ul className="axp-gate__list">{v.warnings.map((r) => <li key={r}>{r}</li>)}</ul>}
      <ul className="axp-gate__list">{v.results.map((r) => <li key={r.id}><Chip tone={tone(r.verdict)}>{r.verdict}</Chip> {r.id}: {r.reason}</li>)}</ul>
    </div>
  );
}
