import { Fragment, useState } from 'react';
import { DetailTableRow, RowToggle, registerRowKind, registerRowRefTarget, useExpandedRows } from '../axf/libs/datagrid';
import * as api from '../api';
import { Button, Chip, Container, useRuntime } from '../axf/react';
import { useStore } from '../store';
import { STATUSES, statusTone, type Status } from '../api';
registerRowRefTarget('tracker-item', (id) => (id ? { kind: 'tracker-item', id } : null));

/** grid-row@1: a tracker item expands into every field and sets its status from the menu (API: POST status). */
registerRowKind({
  kind: 'tracker-item', label: 'Tracker item', icon: 'layers', owner: 'console',
  title: (r) => String((r as { title?: string }).title ?? ''),
  commands: STATUSES.map((x, i) => ({
    id: `status-${x}`, label: `Mark ${x}`, icon: x === 'built' ? 'check' : 'edit', multi: true, order: i + 1, control: `POST /api/status {"id":"{id}","status":"${x}"}`,
    run: async ({ ids }: { ids: string[] }) => { for (const id of ids) { const r = await api.post('status', { id, status: x }); if (!r.ok) throw new Error(`${id}: status not saved`); } },
  })),
});

/** Built / not built, per catalog tab → group; status chips edit status.json through the backend (or locally). */
export function Tracker() {
  const rt = useRuntime();
  const s = useStore();
  const [tab, setTab] = useState('foundations');
  const [q, setQ] = useState('');
  const [only, setOnly] = useState<Status | 'all'>('all');
  const ex = useExpandedRows();
  const tabs = s.catalog.tabs;
  const cur = tabs.find((t) => t.id === tab) ?? tabs[0];
  const needle = q.trim().toLowerCase();
  return (
    <div className="fx-stack fx-stack--lg">
      <header className="fx-pagehead">
        <div><p className="fx-eyebrow">{s.tracker.items.length} items · generated {s.tracker.generatedAt.slice(0, 16).replace('T', ' ') || '—'}</p><h1>Tracker</h1><p className="fx-muted">What's built, partial, placeholder or planned. Click a status to change it; the backend writes <code>framework/catalog/status.json</code> and regenerates <code>tracker.json</code>.</p></div>
        <div className="fx-row fx-row--wrap"><Button icon="copy" onClick={() => rt.dispatch('console.exportStatus')}>Export status.json</Button><Button icon="refresh" onClick={() => s.refresh()}>Reload</Button></div>
      </header>
      <div className="fx-row fx-row--wrap">
        {tabs.map((t) => <button key={t.id} className={`fx-chip ${t.id === tab ? 'is-selected' : ''}`} onClick={() => setTab(t.id)}>{t.label} <span className="fx-badge">{s.coverage(t.id).built}/{Object.values(s.coverage(t.id)).reduce((a, b) => a + b, 0)}</span></button>)}
        <span className="fx-grow" />
        <input className="fx-input" placeholder="filter…" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 220 }} />
        <select className="fx-input" value={only} onChange={(e) => setOnly(e.target.value as Status | 'all')} style={{ maxWidth: 160 }}><option value="all">all statuses</option>{STATUSES.map((x) => <option key={x} value={x}>{x}</option>)}</select>
      </div>
      {cur?.groups.map((g) => {
        const rows = g.items.filter((i) => (!needle || i.title.toLowerCase().includes(needle) || i.id.includes(needle)) && (only === 'all' || s.status(i.id) === only));
        if (!rows.length) return null;
        return (
          <Container key={g.id} title={g.label} icon="layers" actions={<Chip>{rows.filter((i) => s.status(i.id) === 'built').length}/{rows.length} built</Chip>}>
            <table className="fx-table cx-tracker">
              <tbody>{rows.map((i) => { const st = s.status(i.id); const tr = s.tracker.items.find((x) => x.id === i.id); return (
                <Fragment key={i.id}>
                <tr data-fx-ctx-target="tracker-item" data-fx-ctx-payload={i.id}>
                  <td><RowToggle open={ex.isOpen(i.id)} onToggle={() => ex.toggle(i.id)} rowRef={{ kind: 'tracker-item', id: i.id }} record={{ ...i, status: st, ...(tr ?? {}) }} dataset="tracker" /></td>
                  <td><div>{i.title}</div><div className="fx-muted fx-small fx-mono">{i.id}{tr?.module ? ` · ${tr.module}` : ''}{tr ? ` · wave ${tr.wave}` : ''}{i.note ? ` · ${i.note}` : ''}</div></td>
                  <td className="cx-status">{STATUSES.map((x) => <button key={x} className={`fx-chip ${x === st ? 'is-selected' : ''} ${x === st ? `cx-${statusTone(x) ?? 'neutral'}` : ''}`} onClick={() => s.setStatus(i.id, x)}>{x}</button>)}</td>
                </tr>
                {ex.isOpen(i.id) && <DetailTableRow colSpan={3} rowRef={{ kind: 'tracker-item', id: i.id }} record={{ ...i, status: st, ...(tr ?? {}) }} dataset="tracker" />}
                </Fragment>); })}</tbody>
            </table>
          </Container>
        );
      })}
    </div>
  );
}
