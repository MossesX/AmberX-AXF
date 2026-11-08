/**
 * Book Builder: write a book from the glossary (book@1). A wizard makes the book (length, minutes per chapter, style,
 * look, narrator, the documentation to generate with it and its outputs); the books live in a collapsible tree with
 * their chapters and items; the content picker browses everything in the glossary and index and drags (or adds)
 * entries, demonstrations and clips into a chapter; items move by drag, context menu or the row buttons; every chapter
 * and item can get its own minutes; a live sandbox preview opens the real screen of an entry in a floating window;
 * Preview plays the whole book; Record video hands it to the walkthrough recorder; Generate docs writes the documentation.
 */
import { useEffect, useMemo, useState } from 'react';
import type { AxfRuntime, BookData, DocsOptions } from '@console/axf/core';
import { DOCS_DEPTH_ABOUT, PLACED_VIEW_TAB, bookMinutes, parseRef, viewOf } from '@console/axf/core';
import { Button, Checkbox, ChoiceGrid, Chip, Icon, SelectField, Switch, TabGroup, TextField, useRuntime } from '@console/axf/react';
import { TreeView, type TreeBranch } from '@console/axf/libs/tree';
import { registerZone, startDrag, type DragPayload } from '@console/axf/libs/dnd';
import { EmptyState, LoadingSkeleton } from '@console/emptyState';
import { filterEntries } from './core';
import { BOOK_TABS, DEMO_KEYS, DEPTHS, FORMATS, INTERACTIVES, STYLES, type BookAsset, type BookTab, type DemoType, type DocsAsset, api, changeBook, deleteAsset, docsFileUrl, entryOf, fmtMinutes, generateDocs, getAsset, loadCatalog, loadDemos, newBook, recordBook, refLabel, refOf, useCatalog, useDemoStore } from './demos-core';
import { playAsset } from './player';

export const WIZARD_DIALOG = 'glossary-index.book-wizard';
export const ADD_TO_BOOK_DIALOG = 'glossary-index.add-to-book';
const ZONE = 'glossary-index-book';
const ENTRY_DRAG = 'glossary-index:entry';
const ITEM_DRAG = 'glossary-index:item';

/** Open a book (and optionally a chapter / a tab) in the Book Builder: settings values the API reads and sets (ui-api@1). */
export function openBook(rt: AxfRuntime, id: string, { chapter, tab, navigate = true }: { chapter?: string; tab?: BookTab; navigate?: boolean } = {}) {
  if (id) rt.settings.set(DEMO_KEYS.booksOpen, id);
  if (chapter !== undefined) rt.settings.set(DEMO_KEYS.booksChapter, chapter);
  if (tab && (BOOK_TABS as readonly string[]).includes(tab)) rt.settings.set(DEMO_KEYS.booksTab, tab);
  if (navigate) rt.navigate('book-builder');
}

/**
 * Preview a book item or any glossary entry: a demonstration, clip or book plays; an entry with a screen opens that
 * real screen, with real data, in a floating window (the live sandbox); anything else shows the glossary.
 */
export function previewRef(rt: AxfRuntime, ref: string) {
  const r = parseRef(ref);
  if (!r) return false;
  if (r.kind === 'demonstration' || r.kind === 'clip' || r.kind === 'book') { void playAsset(r.kind, r.id); return true; }
  const e = entryOf(r.id);
  const view = e ? viewOf(e, (id) => entryOf(id)) : '';
  if (view) {
    rt.windows.openFloating([{ id: `glossary-sandbox-${view}-${Date.now()}`, title: e?.term ?? view, kind: PLACED_VIEW_TAB, payload: view, icon: 'monitor' }], e?.term ?? view, 'floating', 760, 540);
    return true;
  }
  rt.navigate('glossary-index');
  rt.toast(e ? `${e.term}: ${e.summary}` : ref, 'info', 'Glossary');
  return true;
}

function useSetting<T extends string | boolean>(key: string, fallback: T): [T, (v: T) => void] {
  const rt = useRuntime();
  const [, tick] = useState(0);
  useEffect(() => rt.settings.onChange(key, () => tick((t) => t + 1)), [rt, key]);
  const raw = rt.settings.get(key);
  return [(raw === undefined || raw === null || raw === '' ? fallback : raw) as T, (next: T) => rt.settings.set(key, next)];
}

/* ---------------- the wizard ---------------- */

export function DocsOptionsFields({ value, onChange }: { value: Partial<DocsOptions>; onChange: (v: Partial<DocsOptions>) => void }) {
  const on = value.enabled === true;
  return (
    <div className="fx-stack">
      <Checkbox label="Also generate documentation" checked={on} onChange={(v) => onChange({ ...value, enabled: v })} />
      <p className="fx-muted axp-glossary-index__note">Written from the same glossary, index and registry sources as the book, kept in sync, saved as a docs asset.</p>
      {on && (
        <div className="axp-glossary-index__step-grid">
          <SelectField label="How deep" value={value.depth ?? 'standard'} onChange={(v) => onChange({ ...value, depth: v as DocsOptions['depth'] })} options={DEPTHS} hint={DOCS_DEPTH_ABOUT[(value.depth ?? 'standard') as keyof typeof DOCS_DEPTH_ABOUT]} />
          <SelectField label="Format" value={value.format ?? 'html'} onChange={(v) => onChange({ ...value, format: v as DocsOptions['format'], interactive: v === 'markdown' ? 'none' : value.interactive })} options={FORMATS} />
          <SelectField label="How interactive" value={value.interactive ?? 'none'} onChange={(v) => onChange({ ...value, interactive: v as DocsOptions['interactive'], format: v === 'live' ? 'interactive-html-ts' : value.format === 'markdown' && v === 'examples' ? 'html' : value.format })} options={INTERACTIVES} hint="Live components need the interactive HTML + TypeScript format" />
          <div className="fx-stack">
            <Checkbox label="Include every item's API (REST, MCP, CLI)" checked={value.includeApi !== false} onChange={(v) => onChange({ ...value, includeApi: v })} />
            <Checkbox label="Include the screens (live frames in interactive docs)" checked={value.includeScreens !== false} onChange={(v) => onChange({ ...value, includeScreens: v })} />
          </div>
        </div>
      )}
    </div>
  );
}

export function BookWizard({ close }: { close: () => void }) {
  const [title, setTitle] = useState('');
  const [about, setAbout] = useState('');
  const [total, setTotal] = useState('15');
  const [per, setPer] = useState('5');
  const [count, setCount] = useState('');
  const [style, setStyle] = useState('tutorial');
  const [theme, setTheme] = useState('');
  const [narrator, setNarrator] = useState('');
  const [speed, setSpeed] = useState('1');
  const [docs, setDocs] = useState<Partial<DocsOptions>>({ enabled: false, depth: 'standard', format: 'html', interactive: 'none', includeApi: true, includeScreens: true });
  const [video, setVideo] = useState(true);
  const [clips, setClips] = useState(true);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const rt = useRuntime();
  const n = Number(count) || (Number(total) ? Math.max(1, Math.ceil(Number(total) / Math.max(1, Number(per) || 5))) : 3);
  return (
    <div className="fx-stack fx-stack--lg axp-glossary-index__wizard">
      <TextField label="Title" value={title} onChange={setTitle} required autoFocus placeholder="Getting started with AmberX AXF" />
      <TextField label="What it is about" value={about} onChange={setAbout} rows={2} />
      <div className="axp-glossary-index__step-grid">
        <TextField label="Rough total length (minutes)" type="number" value={total} onChange={setTotal} hint="0 = no limit" />
        <TextField label="Minutes per chapter" type="number" value={per} onChange={setPer} />
        <TextField label="Chapters" type="number" value={count} onChange={setCount} placeholder={String(n)} hint={`${n} chapter${n === 1 ? '' : 's'} to start; add more any time`} />
        <TextField label="Narrator voice" value={narrator} onChange={setNarrator} placeholder="Browser voice, or a Piper voice id" />
        <SelectField label="Narration speed" value={speed} onChange={setSpeed} options={[{ value: '0.75', label: 'Slow' }, { value: '1', label: 'Normal' }, { value: '1.25', label: 'Brisk' }]} />
        <TextField label="Look while recording" value={theme} onChange={setTheme} mono placeholder="The current look" hint="A design package id (Settings → Appearance)" />
      </div>
      <div className="fx-stack">
        <h3 className="axp-glossary-index__h3">Style</h3>
        <ChoiceGrid choices={STYLES} selected={[style]} onToggle={setStyle} label="Book style" />
      </div>
      <DocsOptionsFields value={docs} onChange={setDocs} />
      <div className="fx-stack">
        <h3 className="axp-glossary-index__h3">Outputs</h3>
        <Checkbox label="Narrated walkthrough video" checked={video} onChange={setVideo} />
        <Checkbox label="One clip per chapter" checked={clips} onChange={setClips} />
      </div>
      {msg && <p className="fx-muted" role="status">{msg}</p>}
      <div className="fx-row fx-row--end">
        <Button onClick={close}>Cancel</Button>
        <Button tone="primary" icon="plus" busy={busy} disabled={title.trim().length < 2} onClick={() => { setBusy(true); setMsg(''); newBook({ title, about, totalMinutes: Number(total) || 0, chapterMinutes: Number(per) || 5, count: Number(count) || 0, style, theme, narrator, speed: Number(speed) || 1, docs, outputs: { video, chapterClips: clips } }).then((b) => { close(); openBook(rt, b.id, { chapter: b.data.chapters[0]?.id ?? '', tab: 'chapters' }); }, (e: Error) => setMsg(e.message)).finally(() => setBusy(false)); }}>Create book</Button>
      </div>
    </div>
  );
}

/** "Add to book…" from a glossary entry (or a demonstration / clip): pick the book and the chapter. */
export function AddToBook({ props, close }: { props: Record<string, unknown>; close: () => void }) {
  const { items } = useDemoStore();
  const { cat } = useCatalog();
  const ref = String(props.ref ?? '');
  const [book, setBook] = useState('');
  const [chapter, setChapter] = useState('');
  const [chapters, setChapters] = useState<{ id: string; title: string }[]>([]);
  const [msg, setMsg] = useState('');
  const rt = useRuntime();
  useEffect(() => { void loadDemos(); }, []);
  useEffect(() => { if (!book) { setChapters([]); return; } getAsset<BookData>('book', book).then((a) => { setChapters(a.data.chapters.map((c) => ({ id: c.id, title: c.title }))); setChapter(a.data.chapters[0]?.id ?? ''); }, () => setChapters([])); }, [book]);
  const label = refLabel(ref, cat, items);
  return (
    <div className="fx-stack">
      <p>Add <strong>{label.label}</strong> to a book.</p>
      <SelectField label="Book" value={book} onChange={setBook} empty={items.book.length ? 'Pick a book' : 'No books yet'} options={items.book.map((b) => ({ value: b.id, label: b.name }))} />
      {!!chapters.length && <SelectField label="Chapter" value={chapter} onChange={setChapter} options={chapters.map((c) => ({ value: c.id, label: c.title }))} />}
      {msg && <p className="fx-muted" role="status">{msg}</p>}
      <div className="fx-row fx-row--end">
        <Button icon="plus" onClick={() => { close(); rt.openDialog(WIZARD_DIALOG); }}>New book…</Button>
        <Button onClick={close}>Cancel</Button>
        <Button tone="primary" icon="check" disabled={!book || !chapter} onClick={() => changeBook(book, { op: 'add-item', chapter, ref }).then(() => { close(); openBook(rt, book, { chapter, tab: 'chapters' }); }, (e: Error) => setMsg(e.message))}>Add</Button>
      </div>
    </div>
  );
}

/* ---------------- content picker ---------------- */

const PICKER_KINDS = [{ value: '', label: 'Everything' }, { value: 'demonstration', label: 'Demonstrations' }, { value: 'clip', label: 'Clips' }, { value: 'plugin', label: 'Plugins' }, { value: 'screen', label: 'Screens' }, { value: 'control', label: 'Controls' }, { value: 'setting', label: 'Settings' }, { value: 'command', label: 'Commands' }, { value: 'concept', label: 'Concepts' }, { value: 'feature', label: 'Features' }, { value: 'asset-type', label: 'Asset types' }, { value: 'asset', label: 'Assets' }, { value: 'cli', label: 'CLI tools' }];

function Picker({ onAdd, onPreview, chapterLabel }: { onAdd: (ref: string) => void; onPreview: (ref: string) => void; chapterLabel: string }) {
  const { cat } = useCatalog();
  const { items } = useDemoStore();
  const [q, setQ] = useState('');
  const [kind, setKind] = useSetting<string>(DEMO_KEYS.booksPicker, '');
  const [limit, setLimit] = useState(60);
  const rows = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const own = (['demonstration', 'clip'] as DemoType[]).filter((t) => !kind || kind === t).flatMap((t) => items[t].filter((s) => words.every((w) => `${s.name} ${s.description} ${s.id}`.toLowerCase().includes(w))).map((s) => ({ ref: refOf(t, s.id), label: s.name, kind: t, summary: s.description || (t === 'clip' ? `${s.kind} clip` : `${s.steps} steps`), icon: t === 'clip' ? 'monitor' : 'play' })));
    const glossary = cat && kind !== 'demonstration' && kind !== 'clip' ? filterEntries(cat.entries, { q, kind, drafts: false }).filter((e) => !['demonstration', 'book', 'clip', 'docs'].includes(e.kind)).map((e) => ({ ref: e.id, label: e.term, kind: e.kind, summary: e.summary, icon: 'list' })) : [];
    return [...own, ...glossary];
  }, [cat, items, q, kind]);
  const dragStart = (e: React.PointerEvent, r: { ref: string; label: string; icon: string }) => startDrag(e, { kind: ENTRY_DRAG, id: r.ref, label: r.label, icon: r.icon });
  return (
    <aside className="axp-glossary-index__picker-pane fx-stack" aria-label="Content picker">
      <h3 className="axp-glossary-index__h3">Content</h3>
      <p className="fx-muted">Everything in the glossary and index. Drag a row into a chapter, or tap Add to put it in {chapterLabel}.</p>
      <TextField label="Search" value={q} onChange={(v) => { setQ(v); setLimit(60); }} placeholder="Search everything" />
      <SelectField label="Kind" value={kind} onChange={(v) => { setKind(v); setLimit(60); }} options={PICKER_KINDS} />
      {!rows.length ? <EmptyState compact icon="search">Nothing matches.</EmptyState> : (
        <ul className="axp-glossary-index__rows" aria-label="Content">
          {rows.slice(0, limit).map((r) => (
            <li key={r.ref} className="axp-glossary-index__row axp-glossary-index__row--pick">
              <span className="axf-dnd-grip axp-glossary-index__grip" onPointerDown={(e) => dragStart(e, r)} title="Drag into a chapter"><Icon name="grip" size={13} /></span>
              <button type="button" data-fx-row className="axp-glossary-index__row-btn" onPointerDown={(e) => dragStart(e, r)} onClick={() => onPreview(r.ref)}>
                <span><span className="axp-glossary-index__kind" data-kind={r.kind}>{cat?.kinds[r.kind] ?? r.kind}</span> <strong>{r.label}</strong></span>
                <span className="fx-muted">{r.summary}</span>
              </button>
              <Button size="sm" icon="plus" onClick={() => onAdd(r.ref)}>Add</Button>
            </li>
          ))}
        </ul>
      )}
      {rows.length > limit && <div><Button size="sm" icon="plus" onClick={() => setLimit((l) => l + 60)}>Show more ({(rows.length - limit).toLocaleString()} left)</Button></div>}
    </aside>
  );
}

/* ---------------- chapter editor ---------------- */

function ChapterEditor({ book, chapterId, onChange, onPreview, busy }: { book: BookAsset; chapterId: string; onChange: (change: Record<string, unknown>) => void; onPreview: (ref: string) => void; busy: boolean }) {
  const { cat } = useCatalog();
  const { items } = useDemoStore();
  const d = book.data;
  const c = d.chapters.find((x) => x.id === chapterId);
  const minutes = useMemo(() => bookMinutes(d), [d]);
  const [title, setTitle] = useState(c?.title ?? '');
  const [intro, setIntro] = useState(c?.intro ?? '');
  useEffect(() => { setTitle(c?.title ?? ''); setIntro(c?.intro ?? ''); }, [c?.id, c?.title, c?.intro]);
  useEffect(() => registerZone(ZONE, {
    accepts: (p: DragPayload) => p.kind === ENTRY_DRAG || p.kind === ITEM_DRAG,
    positions: (_p, target) => (target.startsWith('chapter:') ? ['inside'] : ['before', 'after']),
    drop: (p, target, pos) => {
      const [kind, ch, idx] = target.split(':');
      const index = kind === 'item' ? Number(idx) + (pos === 'after' ? 1 : 0) : undefined;
      if (p.kind === ENTRY_DRAG) onChange({ op: 'add-item', chapter: ch, ref: p.id, index });
      else { const from = p.data as { chapter: string; index: number }; onChange({ op: 'move-item', from, to: { chapter: ch, index } }); }
    },
  }), [onChange]);
  if (!c) return <EmptyState compact icon="list">Pick a chapter in the tree, or add one.</EmptyState>;
  const ci = d.chapters.indexOf(c);
  const m = minutes.chapters[ci]!;
  return (
    <section className="fx-stack axp-glossary-index__chapter" aria-label={`Chapter ${c.title}`}>
      <div className="axp-glossary-index__editor-head">
        <h3 className="axp-glossary-index__h3">Chapter {ci + 1} · {fmtMinutes(m.minutes)} · {c.items.length} item{c.items.length === 1 ? '' : 's'}</h3>
        <div role="toolbar" aria-label="Chapter actions" className="axp-glossary-index__toolbar">
          <Button size="sm" icon="chevron-up" disabled={ci === 0 || busy} onClick={() => onChange({ op: 'move-chapter', from: ci, to: ci - 1 })}>Up</Button>
          <Button size="sm" icon="chevron-down" disabled={ci === d.chapters.length - 1 || busy} onClick={() => onChange({ op: 'move-chapter', from: ci, to: ci + 1 })}>Down</Button>
          <Button size="sm" icon={c.collapsed ? 'maximize' : 'minimize'} onClick={() => onChange({ op: 'set-chapter', chapter: c.id, collapsed: !c.collapsed })}>{c.collapsed ? 'Expand' : 'Collapse'}</Button>
          <Button size="sm" tone="danger" icon="trash" confirm={`Remove chapter "${c.title}" and its ${c.items.length} items?`} disabled={busy} onClick={() => onChange({ op: 'remove-chapter', chapter: c.id })}>Remove</Button>
        </div>
      </div>
      <div className="axp-glossary-index__step-grid">
        <TextField label="Title" value={title} onChange={setTitle} required />
        <TextField label="Minutes" type="number" value={String(c.minutes || '')} onChange={(v) => onChange({ op: 'set-chapter', chapter: c.id, minutes: Math.max(0, Number(v) || 0) })} placeholder={`${Math.round(m.minutes * 10) / 10} (its share)`} hint="Blank = its share of the book" />
      </div>
      <TextField label="Intro (what the narrator says first)" value={intro} onChange={setIntro} rows={2} placeholder={`Chapter: ${c.title}.`} />
      {(title !== c.title || intro !== c.intro) && <div className="fx-row"><Button size="sm" tone="primary" icon="save" busy={busy} onClick={() => { if (title !== c.title) onChange({ op: 'rename-chapter', chapter: c.id, title }); if (intro !== c.intro) onChange({ op: 'set-chapter', chapter: c.id, intro }); }}>Save chapter text</Button></div>}
      <ol className="axp-glossary-index__items" aria-label="Items" data-axf-drop={ZONE} data-axf-drop-id={`chapter:${c.id}`}>
        {!c.items.length && <li className="fx-muted axp-glossary-index__drop-hint">Drop entries, demonstrations or clips here, or tap Add in the content picker.</li>}
        {c.items.map((it, j) => {
          const l = refLabel(it.ref, cat, items);
          const r = parseRef(it.ref);
          return (
            <li key={`${it.ref}-${j}`} className="axp-glossary-index__item" data-axf-drop={ZONE} data-axf-drop-id={`item:${c.id}:${j}`}>
              <span className="axf-dnd-grip axp-glossary-index__grip" onPointerDown={(e) => startDrag(e, { kind: ITEM_DRAG, id: `${c.id}/${j}`, label: l.label, icon: l.icon, data: { chapter: c.id, index: j } })} title="Drag to move"><Icon name="grip" size={13} /></span>
              <div className="axp-glossary-index__item-body">
                <button type="button" data-fx-row className="axp-glossary-index__row-btn" onClick={() => onPreview(it.ref)}><span><span className="axp-glossary-index__kind" data-kind={l.kind}>{cat?.kinds[l.kind] ?? l.kind}</span> <strong>{l.label}</strong></span>{it.note && <span className="fx-muted">{it.note}</span>}</button>
                <div className="axp-glossary-index__item-fields">
                  <TextField label="Minutes" type="number" value={String(it.minutes ?? '')} onChange={(v) => onChange({ op: 'set-item', chapter: c.id, index: j, minutes: Number(v) || 0 })} placeholder={String(m.items[j]?.minutes ?? '')} />
                  <TextField label="Note" value={it.note ?? ''} onChange={(v) => onChange({ op: 'set-item', chapter: c.id, index: j, note: v })} placeholder="What to stress here" />
                </div>
              </div>
              <div role="toolbar" aria-label={`Item ${j + 1}`} className="axp-glossary-index__step-tools">
                <Button size="sm" icon="eye" onClick={() => onPreview(it.ref)}>Preview</Button>
                {r?.kind === 'demonstration' && <Button size="sm" icon="play" onClick={() => void playAsset('demonstration', r.id)}>Play</Button>}
                <Button size="sm" icon="chevron-up" disabled={j === 0 || busy} onClick={() => onChange({ op: 'move-item', from: { chapter: c.id, index: j }, to: { chapter: c.id, index: j - 1 } })}>Up</Button>
                <Button size="sm" icon="chevron-down" disabled={j === c.items.length - 1 || busy} onClick={() => onChange({ op: 'move-item', from: { chapter: c.id, index: j }, to: { chapter: c.id, index: j + 2 } })}>Down</Button>
                <Button size="sm" tone="danger" icon="x" disabled={busy} onClick={() => onChange({ op: 'remove-item', chapter: c.id, index: j })}>Remove</Button>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/* ---------------- docs panel ---------------- */

function DocsPanel({ book, docs, onChange, onGenerated }: { book: BookAsset; docs: DocsAsset | null; onChange: (change: Record<string, unknown>) => void; onGenerated: (d: DocsAsset) => void }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const open = async (path: string) => {
    if (!docs) return;
    try { const b = await api.blob(docsFileUrl(docs.id, path)); const url = URL.createObjectURL(b); window.open(url, '_blank', 'noopener'); setTimeout(() => URL.revokeObjectURL(url), 60000); } catch (e) { setMsg((e as Error).message); }
  };
  return (
    <section className="fx-stack axp-glossary-index__docs" aria-label="Documentation">
      <DocsOptionsFields value={book.data.docs} onChange={(v) => onChange({ op: 'set-docs', docs: v })} />
      <div className="fx-row fx-row--wrap">
        <Button tone="primary" icon="code" busy={busy} disabled={!book.data.docs.enabled} onClick={() => { setBusy(true); setMsg(''); generateDocs({ kind: 'book', id: book.id }, book.data.docs as unknown as Record<string, unknown>).then((d) => { onGenerated(d); setMsg(`Generated ${d.data.files.length} files.`); }, (e: Error) => setMsg(e.message)).finally(() => setBusy(false)); }}>Generate documentation</Button>
        {docs && <Button icon="external" onClick={() => void open(docs.data.files.find((f) => f.kind === 'index')?.path ?? 'index.html')}>Open</Button>}
        {msg && <span className="fx-muted" role="status">{msg}</span>}
      </div>
      {docs && (
        <div className="fx-stack">
          <p className="fx-muted">{docs.name}: {docs.data.depth} · {docs.data.format} · {docs.data.interactive} · {docs.data.files.length} files · generated {docs.data.generatedAt ? new Date(docs.data.generatedAt).toLocaleString() : ''}</p>
          <ul className="axp-glossary-index__files">{docs.data.files.slice(0, 80).map((f) => <li key={f.path}><button type="button" data-fx-row className="axp-glossary-index__link fx-mono" onClick={() => void open(f.path)}>{f.path}</button> <span className="fx-muted">{f.kind}{f.title ? ` · ${f.title}` : ''}</span></li>)}</ul>
          {docs.data.files.length > 80 && <p className="fx-muted">…and {docs.data.files.length - 80} more.</p>}
        </div>
      )}
    </section>
  );
}

/* ---------------- the page ---------------- */

export function BooksPage() {
  const { items, loaded, loading, error } = useDemoStore();
  const { cat } = useCatalog();
  const rt = useRuntime();
  // the open book, chapter and tab are settings values: console.values reads and sets them (ui-api@1)
  const [bookId, setBookId] = useSetting<string>(DEMO_KEYS.booksOpen, '');
  const [book, setBook] = useState<BookAsset | null>(null);
  const [chapterId, setChapterIdRaw] = useSetting<string>(DEMO_KEYS.booksChapter, '');
  const setChapterId = (v: string | ((c: string) => string)) => setChapterIdRaw(typeof v === 'function' ? v(chapterId) : v);
  const [tabRaw, setTab] = useSetting<string>(DEMO_KEYS.booksTab, 'chapters');
  const tab: BookTab = (BOOK_TABS as readonly string[]).includes(tabRaw) ? tabRaw as BookTab : 'chapters';
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [docs, setDocs] = useState<DocsAsset | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  useEffect(() => { void loadDemos(); void loadCatalog(); }, []);
  useEffect(() => { if (loaded && (!bookId || !items.book.some((b) => b.id === bookId)) && items.book[0]) setBookId(items.book[0].id); }, [items.book, bookId, loaded]);
  useEffect(() => {
    if (!bookId) { setBook(null); return; }
    let live = true;
    getAsset<BookData>('book', bookId).then((a) => { if (!live) return; setBook(a); setChapterId((c) => (a.data.chapters.some((x) => x.id === c) ? c : a.data.chapters[0]?.id ?? '')); }, (e: Error) => { if (live) { setMsg(e.message); setBook(null); } });
    const dref = items.docs.find((d) => d.source?.kind === 'book' && d.source.id === bookId);
    if (dref) getAsset<DocsAsset['data']>('docs', dref.id).then((d) => { if (live) setDocs(d); }, () => setDocs(null)); else setDocs(null);
    return () => { live = false; };
  }, [bookId, items.docs]);

  const change = async (c: Record<string, unknown>) => { if (!book) return; setBusy(true); setMsg(''); try { const a = await changeBook(book.id, c); setBook(a); if (c.op === 'add-chapter') setChapterId(a.data.chapters.at(-1)?.id ?? ''); } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); } };
  const preview = (ref: string) => { previewRef(rt, ref); };
  const tree: TreeBranch[] = useMemo(() => items.book.map((b) => {
    const full = book && book.id === b.id ? book : null;
    return {
      id: `book:${b.id}`, label: b.name, icon: 'file', meta: `${fmtMinutes(b.minutes ?? 0)}`, collapsed: collapsed.has(`book:${b.id}`) || (!!book && book.id !== b.id && !collapsed.has(`open:${b.id}`)),
      leaves: [], branches: full ? full.data.chapters.map((c, i) => ({ id: `chapter:${c.id}`, label: c.title, icon: 'list', meta: `${c.items.length}`, collapsed: collapsed.has(`chapter:${c.id}`) || c.collapsed, branches: [], leaves: c.items.map((it, j) => { const l = refLabel(it.ref, cat, items); return { id: `item:${c.id}:${j}`, label: l.label, icon: l.icon, meta: it.minutes ? `${it.minutes} min` : undefined }; }), ctx: { target: 'glossary-chapter', payload: `${b.id}#${c.id}#${i}` } })) : [],
    };
  }), [items, book, collapsed, cat]);
  const onMove = (item: { kind: 'leaf' | 'branch'; id: string }, target: { kind: 'leaf' | 'branch'; id: string }, pos: 'before' | 'after' | 'inside') => {
    if (!book) return;
    const ch = (id: string) => id.replace(/^chapter:/, '');
    if (item.kind === 'leaf' && item.id.startsWith('item:')) {
      const [, fc, fi] = item.id.split(':');
      if (target.id.startsWith('item:')) { const [, tc, ti] = target.id.split(':'); void change({ op: 'move-item', from: { chapter: fc, index: Number(fi) }, to: { chapter: tc, index: Number(ti) + (pos === 'after' ? 1 : 0) } }); }
      else if (target.id.startsWith('chapter:')) void change({ op: 'move-item', from: { chapter: fc, index: Number(fi) }, to: { chapter: ch(target.id) } });
    } else if (item.kind === 'branch' && item.id.startsWith('chapter:') && target.id.startsWith('chapter:')) {
      const from = book.data.chapters.findIndex((c) => c.id === ch(item.id)); let to = book.data.chapters.findIndex((c) => c.id === ch(target.id));
      if (from < 0 || to < 0) return;
      if (pos === 'after') to += 1;
      if (from < to) to -= 1;
      void change({ op: 'move-chapter', from, to });
    }
  };
  const minutes = book ? bookMinutes(book.data) : null;

  return (
    <div className="fx-stack fx-stack--lg axp-glossary-index">
      <header className="fx-pagehead">
        <div>
          <p className="fx-eyebrow">Help · books{loaded ? ` · ${items.book.length} book${items.book.length === 1 ? '' : 's'}` : ''}</p>
          <h1>Book Builder</h1>
          <p className="fx-muted">Write a book from the glossary: chapters of entries, demonstrations and clips, each with its minutes; preview any item live, play the whole book, generate the walkthrough video and its documentation.</p>
        </div>
        <div role="toolbar" aria-label="Book Builder" className="axp-glossary-index__toolbar">
          <Button tone="primary" icon="plus" onClick={() => rt.openDialog(WIZARD_DIALOG)}>New book…</Button>
          <Button icon="refresh" onClick={() => void loadDemos(true)}>Refresh</Button>
        </div>
      </header>
      {error ? <EmptyState icon="alert" action={{ label: 'Try again', icon: 'refresh', onClick: () => void loadDemos(true) }}>{error}</EmptyState>
        : !loaded && loading ? <LoadingSkeleton rows={6} label="Loading books" />
        : !items.book.length ? <EmptyState icon="file" action={{ label: 'New book…', icon: 'plus', onClick: () => rt.openDialog(WIZARD_DIALOG) }}>No books yet. The wizard asks for the length, the chapters, the style and the documentation to make with it.</EmptyState>
        : (
          <div className="axp-glossary-index__books">
            <aside className="axp-glossary-index__tree fx-stack" aria-label="Books">
              <TreeView branches={tree} label="Books" zone="glossary-index-tree" selected={{ branch: chapterId ? `chapter:${chapterId}` : bookId ? `book:${bookId}` : null }}
                onToggle={(id) => { if (id.startsWith('book:')) { const b = id.slice(5); if (b !== bookId) { setBookId(b); setCollapsed((s) => { const n = new Set(s); n.add(`open:${b}`); return n; }); return; } } setCollapsed((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; }); }}
                onSelectBranch={(id) => { if (id.startsWith('book:')) { setBookId(id.slice(5)); setTab('plan'); } else if (id.startsWith('chapter:')) { setChapterId(id.slice(8)); setTab('chapters'); } }}
                onSelectLeaf={(id) => { const [, c, j] = id.split(':'); const it = book?.data.chapters.find((x) => x.id === c)?.items[Number(j)]; setChapterId(c!); setTab('chapters'); if (it) preview(it.ref); }}
                onMove={onMove} />
            </aside>
            <section className="axp-glossary-index__main">
              {msg && <p className="fx-muted" role="status">{msg}</p>}
              {!book ? <LoadingSkeleton rows={4} label="Loading the book" /> : (
                <article className="fx-stack fx-stack--lg axp-glossary-index__editor" aria-label={`Book ${book.name}`}>
                  <header className="axp-glossary-index__editor-head">
                    <div>
                      <p className="fx-eyebrow">Book · {book.data.plan.style} · {book.data.chapters.length} chapters · {fmtMinutes(minutes?.total ?? 0)}{book.data.docs.enabled ? ` · docs ${book.data.docs.depth} ${book.data.docs.format}` : ''}</p>
                      <h2>{book.name}</h2>
                      {book.description && <p className="fx-muted">{book.description}</p>}
                    </div>
                    <div role="toolbar" aria-label="Book actions" className="axp-glossary-index__toolbar">
                      <Button tone="primary" icon="play" onClick={() => void playAsset('book', book.id)}>Preview book</Button>
                      <Button icon="plus" busy={busy} onClick={() => void change({ op: 'add-chapter' })}>Add chapter</Button>
                      <Button icon="monitor" busy={busy} onClick={() => { setBusy(true); setMsg(''); recordBook(book.id).then((r) => setMsg(r.job && (r.job as { ok?: boolean }).ok !== false ? `Handed to the walkthrough recorder (${r.file}).` : `Recorder: ${JSON.stringify(r.job ?? {}).slice(0, 200)}`), (e: Error) => setMsg(e.message)).finally(() => setBusy(false)); }}>Record video</Button>
                      <Button tone="danger" icon="trash" confirm={`Delete the book "${book.name}"?`} onClick={() => void deleteAsset('book', book.id).then(() => { setBookId(''); setChapterId(''); setBook(null); })}>Delete</Button>
                    </div>
                  </header>
                  <TabGroup<BookTab> id="glossary.book" label="Book parts" value={tab} onChange={setTab}
                    tabs={[{ value: 'chapters', label: 'Chapters', icon: 'list' }, { value: 'plan', label: 'Plan', icon: 'sliders' }, { value: 'docs', label: 'Documentation', icon: 'code' }, { value: 'outputs', label: 'Outputs', icon: 'monitor' }]}>
                    {tab === 'chapters' && (
                      <div className="axp-glossary-index__chapters">
                        <ChapterEditor book={book} chapterId={chapterId} onChange={(c) => void change(c)} onPreview={preview} busy={busy} />
                        <Picker onAdd={(ref) => void change({ op: 'add-item', chapter: chapterId || book.data.chapters[0]?.id, ref })} onPreview={preview} chapterLabel={book.data.chapters.find((c) => c.id === chapterId)?.title ?? 'the chapter'} />
                      </div>
                    )}
                    {tab === 'plan' && (
                      <div className="fx-stack">
                        <div className="axp-glossary-index__step-grid">
                          <TextField label="Title" value={book.name} onChange={(v) => void change({ op: 'set-plan', name: v })} />
                          <TextField label="Total minutes" type="number" value={String(book.data.plan.totalMinutes)} onChange={(v) => void change({ op: 'set-plan', plan: { totalMinutes: Math.max(0, Number(v) || 0) } })} hint="0 = no limit" />
                          <TextField label="Minutes per chapter" type="number" value={String(book.data.plan.chapterMinutes)} onChange={(v) => void change({ op: 'set-plan', plan: { chapterMinutes: Math.max(1, Number(v) || 1) } })} />
                          <TextField label="Narrator voice" value={book.data.plan.narrator} onChange={(v) => void change({ op: 'set-plan', plan: { narrator: v } })} />
                          <SelectField label="Narration speed" value={String(book.data.plan.speed)} onChange={(v) => void change({ op: 'set-plan', plan: { speed: Number(v) || 1 } })} options={[{ value: '0.75', label: 'Slow' }, { value: '1', label: 'Normal' }, { value: '1.25', label: 'Brisk' }, { value: '1.5', label: 'Fast' }]} />
                          <TextField label="Look while recording" value={book.data.plan.theme} onChange={(v) => void change({ op: 'set-plan', plan: { theme: v } })} mono placeholder="a design package id" />
                        </div>
                        <TextField label="What it is about" value={book.description ?? ''} onChange={(v) => void change({ op: 'set-plan', description: v })} rows={2} />
                        <h3 className="axp-glossary-index__h3">Style</h3>
                        <ChoiceGrid choices={STYLES} selected={[book.data.plan.style]} onToggle={(id) => void change({ op: 'set-plan', plan: { style: id } })} label="Book style" />
                        <h3 className="axp-glossary-index__h3">Time</h3>
                        <ul className="axp-glossary-index__minutes">{minutes?.chapters.map((c) => <li key={c.id}><strong>{c.title}</strong> <span className="fx-muted">{fmtMinutes(c.minutes)} · {c.items.length} items</span></li>)}</ul>
                        <p className="fx-muted">Total {fmtMinutes(minutes?.total ?? 0)}. A chapter or item without minutes takes its share of what is left.</p>
                        {!!book.data.keywords.length && <p className="axp-glossary-index__keywords">{book.data.keywords.map((k) => <Chip key={k}>{k}</Chip>)}</p>}
                      </div>
                    )}
                    {tab === 'docs' && <DocsPanel book={book} docs={docs} onChange={(c) => void change(c)} onGenerated={setDocs} />}
                    {tab === 'outputs' && (
                      <div className="fx-stack">
                        <Switch label="Narrated walkthrough video" checked={book.data.outputs.video} onChange={(v) => void change({ op: 'set-outputs', outputs: { video: v } })} hint="Record video hands the book to the walkthrough recorder job (the Walkthrough producer)." />
                        <Switch label="One clip per chapter" checked={book.data.outputs.chapterClips} onChange={(v) => void change({ op: 'set-outputs', outputs: { chapterClips: v } })} hint="Every chapter comes back as its own clip asset, auto-tagged, droppable into other books." />
                        <p className="fx-muted">Clips made from this book: {items.clip.filter((c) => c.source?.kind === 'book' && c.source.id === book.id).length}. Documentation: {docs ? `${docs.data.files.length} files` : 'not generated yet'}.</p>
                        <div className="fx-row"><Button icon="list" onClick={() => rt.navigate('demo-designer')}>Open the clips</Button></div>
                      </div>
                    )}
                  </TabGroup>
                </article>
              )}
            </section>
          </div>
        )}
    </div>
  );
}
