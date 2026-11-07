/**
 * The Notes views (build notes-views, Brett Nov 4 2026):
 *   Classic  today's layout (notes on the left, the open note on the right), every body as collapsible sections
 *   Grid     notes as sortable rows (column hiding on the header's right-click, filters, search); tapping a row expands
 *            it to the full note with the same sections and its actions; several rows can be open; cards on a phone
 * Both render bodies through the framework's FoldSections. Framework controls only, theme tokens only.
 */
import { useMemo, useState, type ReactNode } from 'react';
import { Button, FoldSections, Icon, IconButton, SelectField, Switch, TextField, sectionCount, useIsPhone } from '@console/axf/react';
import { DataGrid, type GridColumn, type GridSort } from '@console/axf/libs/datagrid';
import { day, readLocal, when, writeLocal, type Place, type Row } from './data';

export interface Fold { caps: boolean; collapsed: boolean; q: string }
export interface Acts {
  busy: boolean;
  places: Place[];
  save: (r: Row, text: string) => Promise<boolean>;
  move: (r: Row, to: string) => void;
  pin: (r: Row) => void;
  remove: (r: Row) => void;
  rename?: (r: Row) => void;
  /** Grid → Classic on this note */
  open?: (r: Row) => void;
}

/** The note body: sections, or the editor while editing. */
export function NoteBody({ r, fold, editing, draft, setDraft }: { r: Row; fold: Fold; editing: boolean; draft: string; setDraft: (v: string) => void }) {
  if (editing) return <TextField label="Note text (Markdown)" mono rows={20} value={draft} onChange={setDraft} />;
  return <FoldSections text={r.text} capsHeadings={fold.caps} startCollapsed={fold.collapsed} storageKey={`notes:${r.key}`} highlight={fold.q} label={`Sections of ${r.title}`} />;
}

/** A note's title bar: what it is, and Edit / Save / Pin / Rename / Move / Delete (+ Open from the grid). */
export function NoteBar({ r, acts, editing, setEditing, draft, setDraft, extra, titled = true }: { r: Row; acts: Acts; editing: boolean; setEditing: (v: boolean) => void; draft: string; setDraft: (v: string) => void; extra?: ReactNode; titled?: boolean }) {
  const changed = draft !== r.text;
  return (
    <div className="axp-notes-browser__bar" role="toolbar" aria-label="Note">
      <div className="axp-notes-browser__label">
        {titled && <strong>{r.title}</strong>}
        <span className="fx-small fx-muted axp-notes-browser__sub">{[r.source === 'claude' ? r.ref : r.list, when(r.updatedAt), r.updatedBy].filter(Boolean).join(' · ')}</span>
      </div>
      <div className="axp-notes-browser__acts">
        {extra}
        <Switch label="Edit" checked={editing} onChange={(v) => { if (!v && changed && !window.confirm('Drop your changes?')) return; setEditing(v); if (!v) setDraft(r.text); }} />
        {editing && <Button tone="primary" icon="save" disabled={acts.busy || !changed} onClick={() => void acts.save(r, draft).then((ok) => { if (ok) setEditing(false); })}>Save</Button>}
        {acts.open && <IconButton icon="external" label="Open in Classic" disabled={editing} onClick={() => acts.open!(r)} />}
        {r.source === 'amberx' && <IconButton icon="star" label={r.pinned ? 'Unpin' : 'Pin'} disabled={acts.busy} onClick={() => acts.pin(r)} />}
        {acts.rename && <IconButton icon="edit" label="Rename" disabled={acts.busy || editing} onClick={() => acts.rename!(r)} />}
        <SelectField label="Move to" value={r.listId} options={acts.places} onChange={(v) => acts.move(r, v)} />
        <IconButton icon="trash" label="Delete" disabled={acts.busy || editing} onClick={() => acts.remove(r)} />
      </div>
    </div>
  );
}

/** One open note with its own edit state (the Classic pane, and every expanded grid row). */
export function NotePane({ r, acts, fold, extra, titled }: { r: Row; acts: Acts; fold: Fold; extra?: ReactNode; titled?: boolean }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(r.text);
  const [seen, setSeen] = useState(r.text);
  if (r.text !== seen && !editing) { setSeen(r.text); setDraft(r.text); }
  return (
    <div className="axp-notes-browser__pane">
      <NoteBar r={r} acts={acts} editing={editing} setEditing={setEditing} draft={draft} setDraft={setDraft} extra={extra} titled={titled} />
      <div className="axp-notes-browser__doc"><NoteBody r={r} fold={fold} editing={editing} draft={draft} setDraft={setDraft} /></div>
    </div>
  );
}

/* ── Classic ─────────────────────────────────────────────────────────────────────────────────────────────────── */

export function ClassicView({ rows, openKey, setOpenKey, acts, fold, sort, side, loading, available }: {
  rows: Row[]; openKey: string; setOpenKey: (k: string) => void; acts: Acts; fold: Fold; sort: 'date' | 'name'; side: ReactNode; loading: boolean; available: boolean;
}) {
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  const groups = useMemo(() => {
    const sorted = [...rows].sort((a, b) => (sort === 'date' ? b.updatedAt.localeCompare(a.updatedAt) : a.title.localeCompare(b.title)));
    const by = new Map<string, Row[]>();
    for (const r of sorted) by.set(r.list, [...(by.get(r.list) ?? []), r]);
    return [...by.entries()].sort(([a], [b]) => (a === 'Top level' ? -1 : b === 'Top level' ? 1 : a.localeCompare(b)));
  }, [rows, sort]);
  const open = rows.find((r) => r.key === openKey) ?? null;
  return (
    <div className="axp-notes-browser__cols">
      <aside className="axp-notes-browser__side">
        {side}
        <nav className="axp-notes-browser__tree" aria-label="Notes">
          {loading && <p className="fx-muted">Loading…</p>}
          {!loading && available && !groups.length && <p className="fx-muted">{fold.q ? 'No note matches.' : 'No notes yet.'}</p>}
          {groups.map(([list, notes]) => (
            <div key={list} className="axp-notes-browser__group">
              <button type="button" className="fx-nav__item axp-notes-browser__folder" aria-expanded={!closed[list]} onClick={() => setClosed({ ...closed, [list]: !closed[list] })}>
                <Icon name={closed[list] ? 'chevron-right' : 'chevron-down'} size={12} /><Icon name="folder" size={14} /><span className="axp-notes-browser__label">{list}</span><span className="fx-small fx-muted">{notes.length}</span>
              </button>
              {!closed[list] && notes.map((n) => (
                <button key={n.key} type="button" title={n.source === 'claude' ? n.ref : n.title} className={`fx-nav__item axp-notes-browser__note is-nested${openKey === n.key ? ' is-active' : ''}`} onClick={() => setOpenKey(n.key)}>
                  <Icon name={n.pinned ? 'star' : 'file'} size={13} />
                  <span className="axp-notes-browser__label"><span className="axp-notes-browser__sub">{n.title}</span><span className="fx-small fx-muted axp-notes-browser__sub">{n.snippet ?? day(n.updatedAt)}</span></span>
                </button>
              ))}
            </div>
          ))}
        </nav>
      </aside>
      <section className="axp-notes-browser__main" aria-live="polite">
        {!open && <p className="fx-muted">Pick a note on the left.</p>}
        {open && <NotePane key={open.key} r={open} acts={acts} fold={fold} />}
      </section>
    </div>
  );
}

/* ── Grid ────────────────────────────────────────────────────────────────────────────────────────────────────── */

const W = (n: number) => `calc(var(--fx-space) * ${n})`;
interface GridRow { r: Row; sections: number; length: number }

export function GridView({ rows, acts, fold, loading }: { rows: Row[]; acts: Acts; fold: Fold; loading: boolean }) {
  const phone = useIsPhone();
  const [hidden, setHidden] = useState<string[]>(() => readLocal('grid.hidden', ['created', 'priority', 'due']));
  const [sort, setSort] = useState<GridSort>(() => readLocal<GridSort>('grid.sort', { col: 'updated', dir: -1 }));
  const [expanded, setExpanded] = useState<string[]>([]);
  const [kind, setKind] = useState('');
  const [list, setList] = useState('');
  const [tag, setTag] = useState('');
  const keepHidden = (h: string[]) => { setHidden(h); writeLocal('grid.hidden', h); };
  const keepSort = (s: GridSort) => { setSort(s); writeLocal('grid.sort', s); };
  const toggle = (k: string) => setExpanded((x) => (x.includes(k) ? x.filter((y) => y !== k) : [...x, k]));

  const all = useMemo<GridRow[]>(() => rows.map((r) => ({ r, sections: sectionCount(r.text, { capsHeadings: fold.caps }), length: r.text.length })), [rows, fold.caps]);
  const opts = (vals: string[], none: string) => [{ value: '', label: none }, ...[...new Set(vals.filter(Boolean))].sort().map((v) => ({ value: v, label: v }))];
  const kinds = opts(rows.map((r) => r.kind), 'Every kind');
  const lists = opts(rows.map((r) => r.list), 'Every list');
  const tags = opts(rows.flatMap((r) => r.tags), 'Every tag');
  const columns: GridColumn<GridRow>[] = [
    { id: 'title', label: 'Title', width: 'minmax(0, 4fr)', fixed: true, sortable: true, sortValue: (g) => g.r.title.toLowerCase(), render: (g) => <span className="axp-notes-browser__cell"><Icon name={g.r.pinned ? 'star' : 'file'} size={13} /><span className="axp-notes-browser__sub">{g.r.title}</span></span> },
    { id: 'kind', label: 'Kind', width: W(12), sortable: true, sortValue: (g) => g.r.kind, render: (g) => g.r.kind },
    { id: 'list', label: 'List', width: 'minmax(0, 2fr)', sortable: true, sortValue: (g) => g.r.list, render: (g) => <span className="axp-notes-browser__fit axp-notes-browser__fit--md">{g.r.list}</span> },
    { id: 'tags', label: 'Tags', width: 'minmax(0, 2fr)', sortable: true, sortValue: (g) => g.r.tags.join(' '), render: (g) => <span className="axp-notes-browser__fit axp-notes-browser__fit--md">{g.r.tags.join(', ')}</span> },
    { id: 'priority', label: 'Priority', width: W(15), align: 'end', sortable: true, sortValue: (g) => g.r.priority, render: (g) => (g.r.priority ? String(g.r.priority) : '') },
    { id: 'due', label: 'Due', width: W(28), sortable: true, sortValue: (g) => g.r.due || '~', render: (g) => <span className="axp-notes-browser__fit">{day(g.r.due)}</span> },
    { id: 'updated', label: 'Updated', width: W(28), sortable: true, sortValue: (g) => g.r.updatedAt, render: (g) => <span className="axp-notes-browser__fit">{day(g.r.updatedAt)}</span> },
    { id: 'created', label: 'Created', width: W(28), sortable: true, sortValue: (g) => g.r.createdAt, render: (g) => <span className="axp-notes-browser__fit">{day(g.r.createdAt)}</span> },
    { id: 'sections', label: 'Sections', width: W(16), align: 'end', sortable: true, sortValue: (g) => g.sections, render: (g) => String(g.sections) },
    { id: 'length', label: 'Length', width: W(14), align: 'end', sortable: true, sortValue: (g) => g.length, render: (g) => g.length.toLocaleString() },
  ];

  const shown = useMemo(() => {
    const f = all.filter((g) => (!kind || g.r.kind === kind) && (!list || g.r.list === list) && (!tag || g.r.tags.includes(tag)));
    const col = columns.find((c) => c.id === sort?.col);
    if (!phone || !sort || !col?.sortValue) return f; // the grid sorts its own rows; the phone cards sort here
    return [...f].sort((a, b) => { const x = col.sortValue!(a); const y = col.sortValue!(b); return (x < y ? -1 : x > y ? 1 : 0) * sort.dir; });
  }, [all, kind, list, tag, sort, phone]); // eslint-disable-line react-hooks/exhaustive-deps

  const detail = (g: GridRow) => <NotePane r={g.r} acts={acts} fold={fold} titled={false} />;
  const filters = (
    <div className="axp-notes-browser__filters">
      {kinds.length > 2 && <SelectField label="Kind" value={kind} options={kinds} onChange={setKind} />}
      <SelectField label="List" value={list} options={lists} onChange={setList} />
      {tags.length > 1 && <SelectField label="Tag" value={tag} options={tags} onChange={setTag} />}
      <span className="fx-small fx-muted">{shown.length} of {rows.length}</span>
      {expanded.length > 0 && <Button size="sm" tone="ghost" icon="chevron-right" onClick={() => setExpanded([])}>Close all rows</Button>}
    </div>
  );
  const empty = loading ? 'Loading…' : fold.q || kind || list || tag ? 'No note matches.' : 'No notes yet.';

  if (phone) {
    return (
      <div className="axp-notes-browser__cards">
        {filters}
        {!shown.length && <p className="fx-muted">{empty}</p>}
        {shown.map((g) => {
          const open = expanded.includes(g.r.key);
          return (
            <div key={g.r.key} className={`axp-notes-browser__card${open ? ' is-open' : ''}`}>
              <button type="button" data-fx-row className="axp-notes-browser__cardhead" aria-expanded={open} onClick={() => toggle(g.r.key)}>
                <Icon name={open ? 'chevron-down' : 'chevron-right'} size={12} />
                <span className="axp-notes-browser__label">
                  <strong className="axp-notes-browser__sub">{g.r.title}</strong>
                  <span className="fx-small fx-muted axp-notes-browser__sub">{[g.r.kind, g.r.list, day(g.r.updatedAt), `${g.sections} sections`, g.r.tags.join(', ')].filter(Boolean).join(' · ')}</span>
                </span>
              </button>
              {open && detail(g)}
            </div>
          );
        })}
      </div>
    );
  }
  return (
    <div className="axp-notes-browser__grid">
      {filters}
      <DataGrid<GridRow>
        id="notes-browser" label="Notes"
        groups={[{ id: 'notes', title: `${shown.length} notes`, rows: shown, groups: [], fixed: true }]}
        columns={columns}
        rowId={(g) => g.r.key} rowLabel={(g) => `${g.r.title} ${g.r.text}`}
        hidden={hidden}
        onToggleColumn={(c, show) => keepHidden((show ?? hidden.includes(c)) ? hidden.filter((x) => x !== c) : [...hidden, c])}
        onShowAll={() => keepHidden([])}
        sort={sort}
        onSort={(c) => keepSort(c === null ? null : { col: c, dir: sort?.col === c ? (sort.dir === 1 ? -1 : 1) : 1 })}
        expanded={expanded} onToggleExpand={toggle} renderDetail={detail}
        onRowClick={(g) => toggle(g.r.key)}
        rowTone={(g) => (g.r.pinned ? 'accent' : g.r.status === 'done' ? 'success' : 'muted')}
        empty={empty}
      />
    </div>
  );
}
