/**
 * Chapters (Nov 2 2026, Brett: "break down each chapter into its own video so 1 chapter can be re recorded individually
 * and add a view that lists all the chapters, length, and version of its video segment", plus the design package): every
 * chapter's own video from segments.json (walkthrough-segments@1) with its length, version, design package and dates.
 * Expand a row to play that chapter alone; Re-record sends just that chapter to the console as one veto call on axHub
 * (rebuild.sh ONLY=<chapter>), the other chapters' videos are kept and the full video is joined again.
 */
import { useEffect, useState } from 'react';
import { Button, Chip, Note } from '../../../axf/react';
import { DataGrid, type GridColumn } from '../../../axf/libs/datagrid';
import { WALKTHROUGH_BASE, clock, lookLabel, parseSegments, sizeLabel, type ChapterVideo } from './core';

type Load = { phase: 'loading' } | { phase: 'ready'; list: ChapterVideo[] } | { phase: 'error'; message: string };
const when = (iso: string) => (iso ? new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');

export function ChaptersView({ id, base }: { id: string; base: string }) {
  const [s, set] = useState<Load>({ phase: 'loading' });
  const [open, setOpen] = useState<string[]>([]);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  useEffect(() => {
    let live = true;
    fetch(`${WALKTHROUGH_BASE}${base}segments.json`, { credentials: 'include', cache: 'no-cache' })
      .then(async (r) => { if (!live) return; set(r.ok ? { phase: 'ready', list: parseSegments(await r.json().catch(() => null)) } : { phase: 'ready', list: [] }); })
      .catch((e) => live && set({ phase: 'error', message: (e as Error).message }));
    return () => { live = false; };
  }, [base]);

  const rerecord = async (c: ChapterVideo) => {
    setBusy(c.id); setMsg(null);
    try {
      const r = await fetch(`${WALKTHROUGH_BASE}${id}/render`, {
        method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chapter: c.id, voiceOnly: false }),
      });
      const j = await r.json().catch(() => ({})) as { detail?: string; message?: string };
      if (!r.ok) throw new Error(j.detail || `The server answered ${r.status}.`);
      setMsg({ tone: 'success', text: j.message || `“${c.title}” sent to axHub as a veto call. It runs when the countdown ends unless you deny it; version ${c.version + 1} shows up here a few minutes later.` });
    } catch (e) { setMsg({ tone: 'danger', text: (e as Error).message }); } finally { setBusy(''); }
  };

  if (s.phase === 'loading') return <div className="axp-walkthrough__skeleton" aria-busy="true" aria-label="Loading the chapters" />;
  if (s.phase === 'error') return <p className="fx-muted" role="alert">{s.message}</p>;
  if (!s.list.length) return <Note tone="info">The chapters get their own videos the next time this walkthrough is cut (a Re-voice or Re-record).</Note>;

  const columns: GridColumn<ChapterVideo>[] = [
    { id: 'title', label: 'Chapter', width: 'minmax(calc(var(--fx-space) * 18), 3fr)', fixed: true,
      render: (c) => <span>{s.list.indexOf(c) + 1}. {c.title}</span> },
    { id: 'length', label: 'Length', width: 'calc(var(--fx-space) * 8)', align: 'end', sortable: true, sortValue: (c) => c.duration, render: (c) => <span className="fx-small">{clock(c.duration)}</span> },
    { id: 'version', label: 'Version', width: 'calc(var(--fx-space) * 8)', sortable: true, sortValue: (c) => c.version, render: (c) => <Chip tone={c.version > 1 ? 'accent' : undefined}>v{c.version}</Chip> },
    { id: 'look', label: 'Design package', width: 'minmax(calc(var(--fx-space) * 12), 2fr)', sortable: true, sortValue: (c) => c.look,
      render: (c) => <span className="fx-small">{lookLabel(c.look) || <span className="fx-muted">none</span>}</span> },
    { id: 'recorded', label: 'Recorded', width: 'minmax(calc(var(--fx-space) * 12), 2fr)', sortable: true, sortValue: (c) => c.recordedAt, render: (c) => <span className="fx-small fx-muted">{when(c.recordedAt)}</span> },
    { id: 'act', label: '', width: 'calc(var(--fx-space) * 16)', fixed: true,
      render: (c) => (
        <span onClick={(e) => e.stopPropagation()}>
          <Button size="sm" icon="refresh" busy={busy === c.id} disabled={!!busy} confirm={`Re-record “${c.title}” on the server? The other chapters stay as they are.`}
            onClick={() => void rerecord(c)}>Re-record</Button>
        </span>) },
  ];
  const total = s.list.reduce((n, c) => n + c.duration, 0);
  return (
    <div className="fx-stack">
      {msg && <Note tone={msg.tone}>{msg.text}</Note>}
      <DataGrid<ChapterVideo> id="amberx-walkthrough-chapters" label="Chapter videos"
        groups={[{ id: 'chapters', title: `${s.list.length} chapters · ${clock(total)}`, rows: s.list, groups: [], fixed: true }]}
        columns={columns} rowId={(c) => c.id} rowLabel={(c) => c.title} hidden={[]}
        onRowClick={(c) => setOpen(open.includes(c.id) ? open.filter((x) => x !== c.id) : [...open, c.id])}
        expanded={open} onToggleExpand={(cid) => setOpen(open.includes(cid) ? open.filter((x) => x !== cid) : [...open, cid])}
        renderDetail={(c) => (
          <div className="fx-stack axp-walkthrough__chapter-video">
            <video className="axp-walkthrough__video" controls preload="metadata" src={`${WALKTHROUGH_BASE}${id}/${c.file}?v=${c.version}`} />
            <div className="fx-row fx-row--wrap">
              <a className="fx-btn" href={`${WALKTHROUGH_BASE}${id}/${c.file}?download=1`} download>Download v{c.version} ({sizeLabel(c.bytes)})</a>
              <span className="fx-small fx-muted">Cut {when(c.cutAt)}</span>
            </div>
          </div>
        )}
        empty={<p className="fx-muted">No chapters.</p>} />
    </div>
  );
}
