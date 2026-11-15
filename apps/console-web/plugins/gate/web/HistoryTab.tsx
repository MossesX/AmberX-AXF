/**
 * History tab: every rule change and lander action, newest first (`grid:gate.history`, one or two lines a row), filtered
 * by kind (All / Rules / Lander: `setting:gate.history.kind`), and the row's detail with what it was before and after.
 * Same records as GET history, `axf gate history` and MCP gate_history.
 */
import { useMemo, useState } from 'react';
import { Chip, Segmented, useControlTargets, type ControlTargetDef } from '@console/axf/react';
import type { GridColumn } from '@console/axf/libs/datagrid';
import { GateList } from './GateList';
import type { HistoryEntry } from './api';
import { useGridRows } from './rows';
import { usePoll } from './usePoll';

type Kind = '' | 'rule' | 'lander';
const KINDS: { value: Kind; label: string }[] = [{ value: '', label: 'All' }, { value: 'rule', label: 'Rules' }, { value: 'lander', label: 'Lander' }];
const when = (iso: string) => new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const reasonText = (r: HistoryEntry['reason']) => (typeof r === 'string' ? r : [r.title, r.description].filter(Boolean).join(': '));
const keyOf = (e: HistoryEntry) => `${e.at}|${e.kind}|${e.action}|${e.id ?? ''}|${e.pr ?? ''}`;
const what = (e: HistoryEntry) => (e.kind === 'lander' ? `${e.action}${e.pr ? ` #${e.pr}` : ''}` : `${e.action} ${e.id ?? 'every rule'}`);
const show = (v: unknown) => (v === undefined || v === null ? 'nothing' : JSON.stringify(v, null, 1));

export function HistoryTab({ refreshSec }: { refreshSec: number }) {
  const rows = useGridRows();
  const [kind, setKind] = useState<Kind>('');
  const [open, setOpen] = useState<string[]>([]);
  const { data, error } = usePoll<{ items: HistoryEntry[] }>(`history?limit=300${kind ? `&kind=${kind}` : ''}`, refreshSec);
  const items = data?.items ?? [];

  const targets = useMemo<ControlTargetDef[]>(() => [
    { address: 'setting:gate.history.kind', kind: 'setting', label: 'History: show', keywords: ['gate', 'history', 'filter'], get: () => kind || 'all', set: (v: unknown) => setKind(v === 'rule' || v === 'lander' ? v : '') },
  ], [kind]);
  useControlTargets(targets, kind);

  const columns: GridColumn<HistoryEntry>[] = [
    { id: 'at', label: 'When', width: 'calc(var(--fx-space) * 36)', fixed: true, sortable: true, sortValue: (e) => e.at, render: (e) => <span>{when(e.at)}</span> },
    { id: 'kind', label: 'Kind', width: 'calc(var(--fx-space) * 20)', render: (e) => <Chip tone={e.kind === 'lander' ? 'accent' : undefined}>{e.kind}</Chip> },
    { id: 'what', label: 'What', width: 'calc(var(--fx-space) * 112)', render: (e) => <span className="axp-gate__cell"><strong>{what(e)}</strong>{rows === 2 && reasonText(e.reason) && <span className="axp-gate__sub">{reasonText(e.reason)}</span>}</span> },
    { id: 'by', label: 'Who', width: 'calc(var(--fx-space) * 40)', sortable: true, sortValue: (e) => e.by, render: (e) => <span className="axp-gate__sub">{e.by}</span> },
  ];

  return (
    <>
      <div className="axp-gate__bar" role="toolbar" aria-label="History filter" data-axf-toolbar="gate.history">
        <Segmented<Kind> label="Show" value={kind} options={KINDS} onChange={setKind} />
      </div>
      {error && <p className="axp-gate__err" role="alert">{error}</p>}
      <GateList<HistoryEntry>
        id="gate.history" label="Gate history" title={`History (${items.length})`} rows={items} columns={columns}
        rowId={keyOf} rowLabel={what}
        expanded={open} onToggleExpand={(id) => setOpen((o) => (o.includes(id) ? o.filter((x) => x !== id) : [...o, id]))}
        onRowClick={(e) => { const id = keyOf(e); setOpen((o) => (o.includes(id) ? o.filter((x) => x !== id) : [...o, id])); }}
        rowTone={(e) => (e.kind === 'lander' ? 'accent' : 'info')}
        renderDetail={(e) => (
          <div className="axp-gate__detail">
            <div className="axp-gate__stat"><span className="axp-gate__label">Before</span><pre className="axp-gate__pre">{show(e.before)}</pre></div>
            <div className="axp-gate__stat"><span className="axp-gate__label">After</span><pre className="axp-gate__pre">{show(e.after)}</pre></div>
            {reasonText(e.reason) && <div className="axp-gate__stat"><span className="axp-gate__label">Why</span><span>{reasonText(e.reason)}</span></div>}
          </div>
        )}
        empty={<p className="axp-gate__sub">{data ? 'Nothing changed yet.' : 'Loading the history…'}</p>}
      />
    </>
  );
}
