/**
 * One build rule's History panel, under its row in the Build rules tab: the rule's full text, its last check / fix runs
 * (build-rule-run@1, GET build-rules/runs?id=) and every change to it (build-rule-history@1, GET build-rules/history?id=).
 * Deep links: console_show view:gate/tab:gate.tabs=build-rules/panel:<id>.history (opens it), action
 * gate.build-rules.open:<id>; its Edit button is `…/panel:<id>/button:edit` (data-axf-target).
 */
import { useEffect, useState } from 'react';
import { Button, Chip } from '@console/axf/react';
import { gateCall, type BuildRule, type BuildRuleHistory as HistoryLine, type BuildRuleRun } from './api';

const tone = (r: string) => (r === 'pass' || r === 'fixed' ? 'success' : r === 'fail' ? 'danger' : undefined);
const when = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(); };

export function BuildRuleHistory({ rule, onEdit }: { rule: BuildRule; onEdit: () => void }) {
  const [runs, setRuns] = useState<BuildRuleRun[] | null>(null);
  const [lines, setLines] = useState<HistoryLine[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const id = encodeURIComponent(rule.id);
    void gateCall<{ runs: BuildRuleRun[] }>(`build-rules/runs?id=${id}&limit=20`).then((r) => setRuns(r.runs), (e: Error) => setError(e.message));
    void gateCall<{ entries: HistoryLine[] }>(`build-rules/history?id=${id}&limit=20`).then((r) => setLines(r.entries), (e: Error) => setError(e.message));
  }, [rule.id, rule.rev, rule.last?.at]);
  return (
    <div className="axp-gate__detail">
      <div className="axp-gate__fields">
        <p>{rule.text}</p>
        <p className="axp-gate__sub">{rule.doer === 'vps' ? 'The VPS does it' : `The session reads it in its brief (${rule.briefBlock})`}{rule.check ? ` · check ${rule.check}` : ''}{rule.autofix ? ` · fixer ${rule.autofix}` : ''}{rule.note ? ` · ${rule.note}` : ''}</p>
        <div className="axp-gate__bar" role="toolbar" aria-label={`${rule.title}: actions`}><span data-axf-target="button:edit"><Button icon="edit" onClick={onEdit}>Edit</Button></span></div>
      </div>
      <div className="axp-gate__fields">
        <p className="axp-gate__label">Runs</p>
        {error && <p className="axp-gate__err" role="alert">{error}</p>}
        {runs === null ? <p className="axp-gate__sub">Loading…</p> : !runs.length ? <p className="axp-gate__sub">Not run yet.</p> : (
          <ul className="axp-gate__list">{runs.map((r) => <li key={`${r.at}${r.build}${r.phase}`}><Chip tone={tone(r.result)}>{r.result}</Chip> {when(r.at)} · {r.build || 'no build'} · {r.phase}{r.dryRun ? ' (dry run)' : ''}<br /><span className="axp-gate__sub">{String(r.detail).split('\n')[0]}</span></li>)}</ul>
        )}
        <p className="axp-gate__label">Changes</p>
        {lines === null ? <p className="axp-gate__sub">Loading…</p> : !lines.length ? <p className="axp-gate__sub">No changes since the seed.</p> : (
          <ul className="axp-gate__list">{lines.map((h) => <li key={`${h.at}${h.rev}`}>{when(h.at)} · {h.by} · {h.action} (rev {h.rev}){h.reason?.title ? `: ${h.reason.title}` : ''}</li>)}</ul>
        )}
      </div>
    </div>
  );
}
