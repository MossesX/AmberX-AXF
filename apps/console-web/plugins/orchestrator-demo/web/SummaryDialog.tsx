/**
 * Summary dialog (`orchestrator-demo.summary`): the last run as a DataGrid of acts with pass / fail / skipped, what
 * failed, and evidence links (a console address focuses that row, step or alert; a URL opens it, e.g. the PR), plus Run
 * again (back to the start overlay). Reads GET /summary, the same read MCP, the CLI and voice use.
 */
import { useEffect, useState } from 'react';
import { Button, Chip, useRuntime } from '@console/axf/react';
import { DataGrid, type GridColumn } from '@console/axf/libs/datagrid';
import { executeControl } from '@console/control/executor';
import { DIALOG_START, demo, type ActSummary, type Evidence, type Summary } from './api';
import './orchestrator-demo.css';

const TONE = { pass: 'success', fail: 'danger', skipped: 'warning', 'not-run': 'muted' } as const;
const LABEL = { pass: 'Passed', fail: 'Failed', skipped: 'Skipped', 'not-run': 'Not run' } as const;
const isUrl = (s: string) => /^https?:\/\//.test(s);

function EvidenceLink({ e }: { e: Evidence }) {
  const rt = useRuntime();
  if (!e.ref) return <span className="axp-orchestrator-demo__muted">{e.text}</span>;
  const open = () => (isUrl(e.ref) ? void globalThis.open(e.ref, '_blank', 'noopener') : void executeControl(rt, { verb: 'focus', address: e.ref, options: { highlightMs: 4000, expand: true } }));
  return <Button size="sm" tone="quiet" icon={isUrl(e.ref) ? 'external' : e.kind === 'alert' ? 'bell' : 'arrow-right'} title={e.ref} onClick={open}>{e.text || e.ref}</Button>;
}

export function SummaryDialog({ close }: { close: () => void }) {
  const rt = useRuntime();
  const [sum, setSum] = useState<Summary | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { demo.summary().then((r) => setSum(r.summary)).catch((e: unknown) => setError(e instanceof Error ? e.message : String(e))); }, []);
  const acts = sum?.acts ?? [];

  const columns: GridColumn<ActSummary>[] = [
    { id: 'n', label: '#', width: 'calc(var(--fx-space) * 7)', render: (a) => acts.indexOf(a) + 1, sortValue: (a) => acts.indexOf(a) },
    { id: 'title', label: 'Act', width: 'minmax(calc(var(--fx-space) * 14), 2fr)', fixed: true, render: (a) => <span className={`axp-orchestrator-demo__act is-${a.result}`}>{a.title}</span> },
    { id: 'result', label: 'Result', width: 'calc(var(--fx-space) * 18)', sortable: true, sortValue: (a) => a.result, render: (a) => <Chip tone={a.result === 'not-run' ? undefined : TONE[a.result]}>{LABEL[a.result]}</Chip> },
    { id: 'what', label: 'What happened', width: 'minmax(calc(var(--fx-space) * 14), 3fr)', render: (a) => <span className={a.error ? 'axp-orchestrator-demo__error' : 'axp-orchestrator-demo__muted'}>{a.error || a.observed}</span> },
    { id: 'evidence', label: 'Evidence', width: 'minmax(calc(var(--fx-space) * 12), 2fr)', render: (a) => <span className="axp-orchestrator-demo__evidence">{a.evidence.filter((e) => e.ref).slice(0, 3).map((e, i) => <EvidenceLink key={i} e={e} />)}</span> },
  ];

  return (
    <div className="axp-orchestrator-demo__summary" data-axf-target="dialog:orchestrator-demo.summary">
      {error && <p className="axp-orchestrator-demo__error" role="alert">{error}</p>}
      {sum && (
        <p className="axp-orchestrator-demo__lead">
          {sum.state === 'stopped' ? 'Stopped. ' : ''}{sum.pass} passed · {sum.fail} failed · {sum.skipped} skipped{sum.remaining ? ` · ${sum.remaining} not run` : ''} of {sum.total}
          {sum.durationMs ? ` in ${Math.round(sum.durationMs / 60000)} min` : ''}.
        </p>
      )}
      {!sum && !error && <p className="axp-orchestrator-demo__muted">No demo has run yet.</p>}
      {acts.length > 0 && (
        <DataGrid<ActSummary> id="orchestrator-demo.summary" label="Demo acts" columns={columns} hidden={[]} rowId={(a) => a.actId} rowLabel={(a) => a.title}
          rowTone={(a) => TONE[a.result]} groups={[{ id: 'acts', title: 'Acts', rows: acts, groups: [], fixed: true }]} />
      )}
      <div className="axp-orchestrator-demo__toolbar" role="toolbar" aria-label="Demo summary">
        <Button tone="primary" icon="refresh" onClick={() => { close(); rt.openDialog(DIALOG_START); }}>Run again</Button>
        <span className="axp-orchestrator-demo__spacer" />
        <Button onClick={close}>Close</Button>
      </div>
    </div>
  );
}
