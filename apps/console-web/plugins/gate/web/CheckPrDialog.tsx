/**
 * "Check a PR" (dialog gate.check-pr, props { pr }): can this PR land? The gate verdict (gate-verdict@1) from GET check?pr=,
 * the same answer as `axf gate check <pr>`, MCP gate_check_pr and the voice line "can 705 land". It changes nothing; the
 * verdict and its one-line summary are the server's.
 */
import { useEffect, useState } from 'react';
import { Chip } from '@console/axf/react';
import { gateCall, type Verdict } from './api';
import { Err, type Tone } from './ui';

export const CHECK_PR_DIALOG = 'gate.check-pr';
const tone = (v: string): Tone => (v === 'pass' ? 'success' : v === 'fail' ? 'danger' : v === 'hold' ? 'warning' : undefined);

export function CheckPrDialog({ pr }: { pr: string }) {
  const [v, setV] = useState<Verdict | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { void gateCall<Verdict>(`check?pr=${encodeURIComponent(pr)}`).then(setV, (e: Error) => setError(e.message)); }, [pr]);
  if (error) return <Err text={error} />;
  if (!v) return <p className="axp-gate__sub">Checking {pr}…</p>;
  return (
    <div className="axp-gate__panel">
      <p><strong>{v.summary}</strong></p>
      {!!v.reasons.length && <ul className="axp-gate__list">{v.reasons.map((r) => <li key={r}>{r}</li>)}</ul>}
      {!!v.warnings.length && <ul className="axp-gate__list">{v.warnings.map((r) => <li key={r}>{r}</li>)}</ul>}
      <ul className="axp-gate__checks">{v.results.map((r) => <li key={r.id}><Chip tone={tone(r.verdict)}>{r.verdict}</Chip><span><strong>{r.id}</strong> <span className="axp-gate__sub">{r.reason}</span></span></li>)}</ul>
    </div>
  );
}
