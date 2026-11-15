import { useEffect, useRef, useState } from 'react';
import { Button, ControlScope, Note, flashWhenReady, useRuntime } from '@console/axf/react';
import { PendingRow, type PendingSummary } from './PendingRow';
import { buildRowSelector, settleFocus, useFocusedBuild } from './focus';

/*
 * The Pending tab (build pending-tab-one-collapsed-row-per-2, Brett, Nov 15 2026: "Why are pending builds not 1
 * expandable row"): one PendingRow per build, collapsed by default. Which rows are open is remembered per viewer on the
 * server (GET pending/rows, POST pending/rows/<id>/toggle, POST pending/rows/collapse-all): the same state the MCP
 * commands pending-rows / pending-expand / pending-collapse / pending-toggle / pending-collapse-all, the CLI
 * (`orchestrator.mjs pending …`) and voice read and change. Queue, Edit and Archive are the existing calls
 * (pipeline/queue, act update, pipeline/action archive).
 */

type Api = { call: <T>(path: string) => Promise<T>; post: <T>(path: string, body: unknown) => Promise<T> };
type RowsAnswer = { ok: boolean; error?: string; viewer: string; expanded: string[]; count: number; rows: PendingSummary[] };
const ROW_EVENT = 'axf:orchestrator-pending-row';

/** Expand, collapse or toggle a pending row from outside the tab (control targets, deep links). */
export function pendingRowCommand(id: string, op: 'expand' | 'collapse' | 'toggle'): void {
  window.dispatchEvent(new CustomEvent(ROW_EVENT, { detail: { id, op } }));
}

export function PendingTab({ api, log, tick, onChanged }: { api: Api; log: (t: string, l?: 'info' | 'ok' | 'warn' | 'error') => void; tick: string; onChanged: () => void }) {
  const rt = useRuntime();
  const [ans, setAns] = useState<RowsAnswer | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const seq = useRef(0);
  const load = async () => {
    const n = ++seq.current;
    try { const r = await api.call<RowsAnswer>('pending/rows'); if (!r.ok) throw new Error(r.error); if (n === seq.current) { setAns(r); setError(''); } }
    catch (e) { setError((e as Error).message); }
  };
  useEffect(() => { void load(); }, [tick]);

  /** expand / collapse / toggle: the row flips at once, the server's answer then settles it. */
  const rowOp = async (id: string, op: 'expand' | 'collapse' | 'toggle') => {
    const n = ++seq.current;
    setAns((a) => a && { ...a, rows: a.rows.map((r) => (r.id === id ? { ...r, expanded: op === 'toggle' ? !r.expanded : op === 'expand' } : r)) });
    try { const r = await api.post<RowsAnswer>(`pending/rows/${encodeURIComponent(id)}/${op}`, {}); if (!r.ok) throw new Error(r.error); if (n === seq.current) setAns(r); }
    catch (e) { log((e as Error).message, 'warn'); void load(); }
  };
  const collapseAll = async () => {
    const n = ++seq.current;
    setAns((a) => a && { ...a, rows: a.rows.map((r) => ({ ...r, expanded: false })) });
    try { const r = await api.post<RowsAnswer>('pending/rows/collapse-all', {}); if (!r.ok) throw new Error(r.error); if (n === seq.current) setAns(r); }
    catch (e) { log((e as Error).message, 'warn'); void load(); }
  };
  const run = async (id: string, path: string, body: Record<string, unknown>, what: string) => {
    setBusy(id);
    try {
      const r = await api.post<{ ok: boolean; error?: string; refused?: { error: string }[] }>(path, body);
      if (!r.ok) throw new Error(r.error);
      if (r.refused?.length) throw new Error(r.refused.map((x) => x.error).join('; '));
      log(what, 'ok'); rt.toast(what, 'success'); onChanged(); await load(); return true;
    } catch (e) { log((e as Error).message, 'error'); rt.toast((e as Error).message, 'danger'); return false; }
    finally { setBusy(''); }
  };

  // outside asks (control targets row:<build>, ?axf-target=row:<build>) arrive as events
  useEffect(() => {
    const on = (e: Event) => { const d = (e as CustomEvent<{ id: string; op: 'expand' | 'collapse' | 'toggle' }>).detail; if (d?.id) void rowOp(d.id, d.op); };
    window.addEventListener(ROW_EVENT, on);
    return () => window.removeEventListener(ROW_EVENT, on);
  }, []);
  // a build asked for (console_show row:<build>, search, menu): its row opens, scrolls into view and stays highlighted
  const focusId = useFocusedBuild();
  const listed = !!focusId && !!ans?.rows.some((r) => r.id === focusId);
  useEffect(() => {
    if (!listed) return;
    if (!ans?.rows.find((r) => r.id === focusId)?.expanded) void rowOp(focusId, 'expand');
    flashWhenReady(() => document.querySelector(buildRowSelector(focusId)), 5000);
    settleFocus(focusId);
  }, [listed, focusId]);

  if (!ans) return <div className="fx-empty">{error ? `Pending: ${error}` : 'Loading Pending…'}</div>;
  const open = ans.rows.filter((r) => r.expanded).length;
  return (
    <section className="oc-prows" aria-label="Pending">
      {error && <Note tone="warning">{error}</Note>}
      <div className="oc-prows__bar">
        <h2 className="pd-card__title">Pending <span className="oc-count">{ans.count}</span>
          <span className="fx-muted fx-small"> · one row per build · tap a row for its steps and actions</span></h2>
        <div className="oc-prows__bar" role="toolbar" aria-label="Pending rows" data-axf-toolbar="build-orchestrator.pending">
          <Button size="sm" icon="chevron-up" id="pending-collapse-all" disabled={!open} title="Close every open row (remembered for you)" onClick={() => void collapseAll()}>Collapse all</Button>
        </div>
      </div>
      {ans.rows.length === 0 ? <div className="fx-empty">Nothing pending.</div> : (
        <ControlScope address="grid:pending"><div className="oc-prows" role="list">
          {ans.rows.map((r) => (
            <PendingRow key={r.id} row={r} expanded={r.expanded} focused={r.id === focusId} busy={busy === r.id}
              onToggle={(id) => void rowOp(id, 'toggle')} onCommand={(id, op) => void rowOp(id, op)}
              onQueue={(id) => void run(id, 'pipeline/queue', { id }, `${id} → Queue`)}
              onEdit={(id, title) => run(id, 'act', { action: 'update', id, title }, `${id}: renamed`)}
              onArchive={(id) => void run(id, 'pipeline/action', { action: 'archive', ids: [id] }, `${id}: archived`)}
              onRoute={(id, route) => void run(id, 'pipeline/route', { id, route }, `${id}: runs on ${route}`)}
              onSplit={(id) => void run(id, 'pipeline/split', { id }, `${id}: split on the next tick`)} />
          ))}
        </div></ControlScope>
      )}
    </section>
  );
}
