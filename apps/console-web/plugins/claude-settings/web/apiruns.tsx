/**
 * API runs (api-run@1): a run on an API key waits for Brett's yes here, with its estimated cost, and shows the final cost
 * after. A confirm, never a veto: nothing here counts down, and only his signed-in session is accepted by the server.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Icon, Note, useRuntime } from '@console/axf/react';
import { DataGrid, type GridColumn } from '@console/axf/libs/datagrid';
import { pluginFetch } from '@console/plugins';
import { usd } from './tokenlog';

const FOLDER = 'claude-settings';
const POLL_MS = 15000;
interface Run { id: string; name: string; title: string; build: string; model: string; status: string; minutes: number; estimateUsd: number | null; finalUsd: number | null; requestedAt: string; decidedBy: string; acknowledgedAt: string }
interface Runs { ok: boolean; message?: string; runs: Run[]; owed: string[] }
const W = (n: number) => `calc(var(--fx-space) * ${n * 3})`;

async function readRuns(): Promise<Runs> {
  const r = await pluginFetch(FOLDER, 'api-runs');
  const j = (await r.json()) as Runs;
  if (!r.ok || !j.ok) throw new Error(j.message || `HTTP ${r.status}`);
  return j;
}
async function post(path: string, body?: unknown): Promise<void> {
  const r = await pluginFetch(FOLDER, path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });
  const j = (await r.json().catch(() => ({}))) as { ok?: boolean; message?: string };
  if (!r.ok || !j.ok) throw new Error(j.message || `HTTP ${r.status}`);
}

function useRuns() {
  const [data, setData] = useState<Runs | null>(null);
  const [error, setError] = useState('');
  const refresh = useCallback(() => { readRuns().then((d) => { setData(d); setError(''); }, (e: Error) => setError(e.message)); }, []);
  useEffect(() => {
    refresh();
    const t = setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, POLL_MS);
    return () => clearInterval(t);
  }, [refresh]);
  return { data, error, refresh };
}

/** The estimate before, the final cost after. */
export function ApiRunDialog({ id, close }: { id: string; close: () => void }) {
  const { data, error } = useRuns();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState('');
  const run = data?.runs.find((r) => r.id === id);
  const act = (p: Promise<void>) => { setBusy(true); setFailed(''); p.then(close, (e: Error) => setFailed(e.message)).finally(() => setBusy(false)); };
  if (error) return <Note tone="danger">{error}</Note>;
  if (!run) return <p className="axp-cs-group__desc">Loading…</p>;
  return (
    <div className="fx-stack" data-testid="api-run-dialog">
      <p><b>{run.title || run.name}</b></p>
      {run.status === 'waiting' ? (
        <>
          <p>This run bills an API key, not a subscription. Estimate: <b>{usd(run.estimateUsd)}</b> for about {run.minutes} min on {run.model}.</p>
          <Note tone="warning">It stays waiting until you decide. Nothing runs by itself.</Note>
          <div className="axp-cs-rb__row">
            <Button tone="primary" icon="check" disabled={busy} onClick={() => act(post(`api-runs/${id}/decide`, { decision: 'approve' }))}>Approve {usd(run.estimateUsd)}</Button>
            <Button tone="ghost" icon="x" disabled={busy} onClick={() => act(post(`api-runs/${id}/decide`, { decision: 'deny' }))}>Deny</Button>
          </div>
        </>
      ) : (
        <>
          <p>Final cost: <b>{usd(run.finalUsd)}</b> (estimated {usd(run.estimateUsd)}), status {run.status}.</p>
          <div><Button tone="primary" icon="check" disabled={busy} onClick={() => act(post(`api-runs/${id}/ack`))}>OK</Button></div>
        </>
      )}
      {failed && <Note tone="danger">{failed}</Note>}
    </div>
  );
}

/** Chip while anything is owed; each new item opens its dialog once. */
export function ApiRunsBanner() {
  const rt = useRuntime();
  const { data } = useRuns();
  const shown = useRef(new Set<string>());
  const owed = data?.owed ?? [];
  useEffect(() => {
    const next = owed.find((id) => !shown.current.has(id));
    if (next) { shown.current.add(next); rt.openDialog('claude-settings.api-run', { id: next }); }
  }, [owed, rt]);
  if (!owed.length) return null;
  return <Button size="sm" tone="ghost" icon="key" onClick={() => rt.openDialog('claude-settings.api-run', { id: owed[0] })}>{owed.length} API {owed.length === 1 ? 'run' : 'runs'}</Button>;
}

export function ApiRunsPanel() {
  const rt = useRuntime();
  const { data, error } = useRuns();
  const columns: GridColumn<Run>[] = [
    { id: 'what', label: 'Run', width: `minmax(${W(12)}, 3fr)`, fixed: true, render: (r) => r.title || r.name },
    { id: 'status', label: 'Status', width: W(5), render: (r) => r.status },
    { id: 'est', label: 'Estimate', width: W(5), align: 'end', render: (r) => usd(r.estimateUsd) },
    { id: 'final', label: 'Final', width: W(5), align: 'end', render: (r) => usd(r.finalUsd) },
    { id: 'by', label: 'Decided by', width: W(7), render: (r) => r.decidedBy || '—' },
  ];
  return (
    <div className="fx-stack">
      <p className="axp-cs-group__desc"><Icon name="key" size={14} /> Every run on an API key waits for your approval here, with its estimated cost, and shows the final cost after. A confirm, never a veto.</p>
      {error && <Note tone="danger">{error}</Note>}
      <div className="axp-cs-tl__scroll">
        <DataGrid<Run> id="claude-api-runs" label="API runs" compact dataset={false} hidden={[]} groups={[{ id: 'all', title: 'API runs', icon: 'key', rows: data?.runs ?? [], groups: [], fixed: true }]} columns={columns} rowId={(r) => r.id} rowLabel={(r) => r.title || r.name}
          onRowClick={(r) => rt.openDialog('claude-settings.api-run', { id: r.id })} empty="No API runs yet." />
      </div>
    </div>
  );
}
