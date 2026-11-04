/**
 * The dock tabs MD Studio renders (tab kinds, so they work docked, split or floating):
 *   md-doc      one Markdown file: preview / edit / split, the Markdown toolbar, find & replace, references, history
 *   md-chain    the context view: a file and everything it references, tokens per part
 *   md-outline  the active doc's headings (IDE view)
 *   md-refs     the active doc's references as branches (IDE view)
 * Framework controls and theme tokens only; layout in md-studio.css.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { Button, IconButton, Icon, Markdown, Note, Segmented, Switch, TextField, Checkbox, useIsPhone } from '@console/axf/react';
import { TOOLS, findAll, findNext, forPreview, offsetOfLine, outline, replaceAll, type PaneMode, type Sel } from './model';
import {
  JUMP_EVENT, K, activeDocId, api, history, isDirty, jump, loadDoc, openDoc, restore, runtime, saveDoc, setDraft, setEditable, startMode,
  useStudio, versionText, type Version,
} from './state';

const SHORT: Record<string, string> = { h1: 'H1', h2: 'H2', h3: 'H3', bold: 'B', italic: 'I', strike: 'S' };
const when = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(); };
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const fmtTokens = (n: number) => (n >= 10000 ? `${(n / 1000).toFixed(1)}k` : String(n));

/* ------------------------------------------------------------------ md-doc */

export function DocPane({ id }: { id: string }) {
  const ds = useStudio((s) => s.docs[id]);
  const editable = useStudio((s) => !!s.editable[id]);
  const phone = useIsPhone();
  const [mode, setMode] = useState<PaneMode>(() => startMode(id));
  const [phoneSide, setPhoneSide] = useState<'edit' | 'preview'>('edit');
  const [find, setFind] = useState(false);
  const [q, setQ] = useState('');
  const [r, setR] = useState('');
  const [caseSensitive, setCase] = useState(false);
  const [showRefs, setShowRefs] = useState(false);
  const [hist, setHist] = useState<Version[] | null>(null);
  const [peek, setPeek] = useState<{ v: Version; text: string } | null>(null);
  const [msg, setMsg] = useState('');
  const ta = useRef<HTMLTextAreaElement>(null);
  const pv = useRef<HTMLDivElement>(null);

  useEffect(() => { void loadDoc(id); }, [id]);
  useEffect(() => { if (!editable && mode !== 'preview') setMode('preview'); }, [editable, mode]);

  const doc = ds?.doc ?? null;
  const draft = ds?.draft ?? '';
  const dirty = isDirty(ds);
  const showEditor = editable && mode !== 'preview' && (!phone || mode === 'edit' || phoneSide === 'edit');
  const showPreview = mode === 'preview' || (mode === 'split' && (!phone || phoneSide === 'preview'));

  // edits from the toolbar keep the selection where the transform put it
  const apply = useCallback((fn: (s: Sel) => Sel) => {
    const el = ta.current; if (!el) return;
    const n = fn({ text: el.value, start: el.selectionStart, end: el.selectionEnd });
    setDraft(id, n.text);
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(n.start, n.end); });
  }, [id]);

  const select = (a: number, b: number) => {
    const el = ta.current; if (!el) return;
    el.focus(); el.setSelectionRange(a, b);
    const line = el.value.slice(0, a).split('\n').length;
    const lh = parseFloat(getComputedStyle(el).lineHeight) || 16;
    el.scrollTop = Math.max(0, (line - 3) * lh);
  };

  // outline clicks and other jumps
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<{ id: string; line: number }>).detail; if (d.id !== id) return;
      if (ta.current && showEditor) { const at = offsetOfLine(ta.current.value, d.line); select(at, at); return; }
      const h = outline(draft).find((x) => x.line === d.line);
      const el = h && [...(pv.current?.querySelectorAll('h1,h2,h3,h4,h5,h6') ?? [])].find((x) => x.textContent?.trim() === h.text.replace(/[*_`]/g, '').trim());
      el?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    };
    window.addEventListener(JUMP_EVENT, on); return () => window.removeEventListener(JUMP_EVENT, on);
  }, [id, draft, showEditor]);

  const matches = useMemo(() => (find && q ? findAll(draft, q, { caseSensitive }) : []), [find, q, draft, caseSensitive]);
  const findNextHit = () => { const el = ta.current; const hit = findNext(draft, q, el ? el.selectionEnd : 0, { caseSensitive }); if (hit) select(hit[0], hit[1]); };
  const replaceOne = () => {
    const el = ta.current; if (!el || !q) return;
    const sel = draft.slice(el.selectionStart, el.selectionEnd);
    if ((caseSensitive ? sel : sel.toLowerCase()) === (caseSensitive ? q : q.toLowerCase())) apply((s) => ({ text: s.text.slice(0, s.start) + r + s.text.slice(s.end), start: s.start + r.length, end: s.start + r.length }));
    requestAnimationFrame(findNextHit);
  };
  const replaceEvery = () => { const n = replaceAll(draft, q, r, { caseSensitive }); setDraft(id, n.text); setMsg(`Replaced ${n.count}.`); };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    const k = e.key.toLowerCase();
    if (k === 's') { e.preventDefault(); void saveDoc(id); return; }
    if (k === 'f') { e.preventDefault(); setFind(true); return; }
    const t = TOOLS.find((x) => x.key === k);
    if (t) { e.preventDefault(); apply(t.run); }
  };

  // a click on a .md link in the preview opens it beside this one (the reference chain)
  const onPreviewClick = (e: MouseEvent<HTMLDivElement>) => {
    const a = (e.target as HTMLElement).closest('a');
    const href = a?.getAttribute('href') ?? '';
    const ref = doc?.refs.find((x) => x.id && (href === x.ref || href.split('#')[0] === x.ref));
    if (ref?.id) { e.preventDefault(); openDoc(ref.id, 'split'); }
  };

  const openHistory = async () => {
    if (hist) { setHist(null); setPeek(null); return; }
    try { setHist(await history(id)); } catch (e) { setMsg(errText(e)); }
  };
  const doRestore = async (v: Version) => {
    if (dirty && !window.confirm('Restoring replaces your unsaved changes. Go on?')) return;
    try { await restore(id, v.version); setPeek(null); setHist(await history(id)); setMsg(`Restored the version from ${when(v.savedAt)}.`); } catch (e) { setMsg(errText(e)); }
  };

  if (!ds || (ds.loading && !doc)) return <div className="fx-empty">Opening {id}…</div>;
  if (!doc) return <div className="axp-md-studio__pane"><Note tone="danger">{ds.error || 'This file could not be opened.'}</Note><Button icon="refresh" onClick={() => void loadDoc(id, true)}>Try again</Button></div>;

  return (
    <div className="axp-md-studio__pane" data-mode={mode}>
      <div className="axp-md-studio__docbar">
        <div className="axp-md-studio__label">
          <strong>{dirty ? '● ' : ''}{doc.title}</strong>
          <span className="fx-small fx-muted axp-md-studio__sub" title={doc.id}>{doc.id} · {fmtTokens(doc.tokens)} tokens · {when(doc.updatedAt)}{doc.updatedBy ? ` · ${doc.updatedBy}` : ''}{ds.saving ? ' · saving…' : ds.savedAt && !dirty ? ' · saved' : ''}</span>
        </div>
        <div className="axp-md-studio__acts">
          <Switch label="Edit" checked={editable} onChange={(v) => { if (!v && dirty && !window.confirm('Stop editing? Unsaved changes stay in the tab until you close it.')) return; setEditable(id, v); if (v && mode === 'preview') setMode('split'); }} />
          <Segmented label="Show" size="sm" value={mode} onChange={(v) => setMode(v as PaneMode)} options={[{ value: 'preview', label: 'Preview', icon: 'eye' }, { value: 'split', label: 'Split', icon: 'layout', disabled: !editable }, { value: 'edit', label: 'Edit', icon: 'edit', disabled: !editable }]} />
          {editable && <Button tone="primary" size="sm" icon="save" disabled={!dirty || ds.saving || ds.conflict} onClick={() => void saveDoc(id)}>Save</Button>}
          {editable && <IconButton icon="search" label="Find and replace" onClick={() => setFind(!find)} />}
          <IconButton icon="layers" label={`References (${doc.refs.length})`} onClick={() => setShowRefs(!showRefs)} />
          <IconButton icon="clock" label="Version history" onClick={() => void openHistory()} />
          <IconButton icon="chart" label="Context view (tokens per part)" onClick={() => openDoc(id, 'split', 'md-chain')} />
          <IconButton icon="refresh" label="Reload from disk" onClick={() => { if (dirty && !window.confirm('Reload and drop your unsaved changes?')) return; void loadDoc(id, true); }} />
        </div>
      </div>

      {ds.conflict && <Note tone="warning">{ds.error} <Button size="sm" icon="refresh" onClick={() => void loadDoc(id, true)}>Reload (drops your changes)</Button> <Button size="sm" icon="copy" onClick={() => void navigator.clipboard?.writeText(draft)}>Copy my text</Button></Note>}
      {!ds.conflict && ds.error && <Note tone="danger">{ds.error}</Note>}
      {msg && <Note tone="info">{msg} <IconButton icon="x" label="Dismiss" onClick={() => setMsg('')} /></Note>}

      {showRefs && (
        <div className="axp-md-studio__refs" aria-label="References">
          {!doc.refs.length && <span className="fx-small fx-muted">This file references no other .md files.</span>}
          {doc.refs.map((x) => (
            <button key={x.ref} type="button" className="fx-chip" disabled={!x.id} title={x.id ? `Open ${x.id} beside this file (line ${x.line})` : `${x.ref} isn't here`} onClick={() => x.id && openDoc(x.id, 'split')}>
              <Icon name={x.kind === 'import' ? 'download' : 'external'} size={12} /> {x.ref}
            </button>
          ))}
        </div>
      )}

      {hist && (
        <div className="axp-md-studio__history">
          <div className="axp-md-studio__acts"><strong className="fx-small">Version history</strong><span className="fx-small fx-muted">{hist.length ? `${hist.length} kept, newest first` : 'No older versions yet: every save keeps the text it replaces.'}</span></div>
          {hist.map((v) => (
            <div key={`${v.version}-${v.savedAt}`} className="axp-md-studio__ver">
              <span className="fx-small axp-md-studio__sub">{when(v.savedAt)} · {v.reason} · {v.savedBy ?? ''} · {v.size} B</span>
              <Button size="sm" tone="ghost" icon="eye" onClick={async () => { try { setPeek({ v, text: await versionText(id, v.version) }); } catch (e) { setMsg(errText(e)); } }}>View</Button>
              <Button size="sm" icon="undo" onClick={() => void doRestore(v)}>Restore</Button>
            </div>
          ))}
          {peek && <div className="axp-md-studio__peek"><p className="fx-small fx-muted">Version of {when(peek.v.savedAt)}</p><Markdown text={forPreview(peek.text)} /></div>}
        </div>
      )}

      {showEditor && (
        <div className="axp-md-studio__tools" role="toolbar" aria-label="Markdown">
          {TOOLS.map((t) => SHORT[t.id]
            ? <button key={t.id} type="button" className="fx-iconbtn" title={t.label} aria-label={t.label} onMouseDown={(e) => e.preventDefault()} onClick={() => apply(t.run)}><strong>{SHORT[t.id]}</strong></button>
            : <IconButton key={t.id} icon={t.icon} label={t.label} onMouseDown={(e) => e.preventDefault()} onClick={() => apply(t.run)} />)}
        </div>
      )}

      {find && showEditor && (
        <div className="axp-md-studio__find">
          <TextField label="Find" value={q} onChange={setQ} autoFocus />
          <TextField label="Replace with" value={r} onChange={setR} />
          <Checkbox label="Match case" checked={caseSensitive} onChange={setCase} />
          <span className="fx-small fx-muted">{q ? `${matches.length} found` : ''}</span>
          <Button size="sm" icon="arrow-right" disabled={!matches.length} onClick={findNextHit}>Next</Button>
          <Button size="sm" disabled={!matches.length} onClick={replaceOne}>Replace</Button>
          <Button size="sm" disabled={!matches.length} onClick={replaceEvery}>Replace all</Button>
          <IconButton icon="x" label="Close find" onClick={() => setFind(false)} />
        </div>
      )}

      {phone && mode === 'split' && editable && (
        <Segmented label="Phone view" size="sm" value={phoneSide} onChange={(v) => setPhoneSide(v as 'edit' | 'preview')} options={[{ value: 'edit', label: 'Write', icon: 'edit' }, { value: 'preview', label: 'Preview', icon: 'eye' }]} />
      )}

      <div className={`axp-md-studio__body${showEditor && showPreview ? ' is-split' : ''}`}>
        {showEditor && (
          <textarea ref={ta} className="fx-input fx-mono axp-md-studio__editor" aria-label={`Text of ${doc.name}`} spellCheck={false} value={draft}
            onChange={(e) => setDraft(id, e.target.value)} onKeyDown={onKey} />
        )}
        {showPreview && <div ref={pv} className="axp-md-studio__preview" onClick={onPreviewClick}><Markdown text={forPreview(draft)} /></div>}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ md-chain (context view) */

interface ChainNode { id: string; title?: string; path?: string; tokens: number; subtotal?: number; repeat?: boolean; missing?: boolean; error?: string; unresolved?: string[]; via?: { ref: string; kind: string; line: number }; children: ChainNode[] }

export function ChainPane({ id }: { id: string }) {
  const [data, setData] = useState<{ root: ChainNode; files: number; tokens: number; depth: number } | null>(null);
  const [err, setErr] = useState('');
  const [depth, setDepth] = useState(() => Number(runtime()?.settings.get(K.depth) ?? 3) || 3);
  const [follow, setFollow] = useState<'import' | 'all'>('import');
  const load = useCallback(async () => {
    try { setData(await api.call(`chain?id=${encodeURIComponent(id)}&depth=${depth}&follow=${follow}`)); setErr(''); } catch (e) { setErr(errText(e)); }
  }, [id, depth, follow]);
  useEffect(() => { void load(); }, [load]);
  return (
    <div className="axp-md-studio__pane">
      <div className="axp-md-studio__docbar">
        <div className="axp-md-studio__label"><strong>Context: {id}</strong>
          <span className="fx-small fx-muted">{data ? `${data.files} files · about ${fmtTokens(data.tokens)} tokens in all (each file counted once)` : 'Reading the chain…'}</span></div>
        <div className="axp-md-studio__acts">
          <Segmented label="Follow" size="sm" value={follow} onChange={(v) => setFollow(v as 'import' | 'all')} options={[{ value: 'import', label: 'What Claude loads' }, { value: 'all', label: 'Every reference' }]} />
          <Segmented label="Depth" size="sm" value={String(depth)} onChange={(v) => setDepth(Number(v))} options={['1', '2', '3', '4', '6'].map((d) => ({ value: d, label: d }))} />
          <IconButton icon="refresh" label="Reload" onClick={() => void load()} />
        </div>
      </div>
      {err && <Note tone="danger">{err}</Note>}
      {data && <ul className="axp-md-studio__chain" role="tree"><ChainItem n={data.root} total={data.tokens} /></ul>}
    </div>
  );
}

function ChainItem({ n, total }: { n: ChainNode; total: number }) {
  const [open, setOpen] = useState(true);
  const share = total ? Math.round(((n.repeat ? 0 : n.tokens) / total) * 100) : 0;
  return (
    <li role="treeitem" aria-expanded={n.children.length ? open : undefined}>
      <div className="axp-md-studio__chainrow">
        {n.children.length ? <IconButton icon={open ? 'chevron-down' : 'chevron-right'} label={open ? 'Fold' : 'Unfold'} onClick={() => setOpen(!open)} /> : <span className="axp-md-studio__gap" />}
        <button type="button" className="fx-nav__item axp-md-studio__chainname" disabled={n.missing} title={n.error ?? n.id} onClick={() => openDoc(n.id, 'split')}>
          <Icon name={n.missing ? 'alert' : 'file'} size={13} />
          <span className="axp-md-studio__sub">{n.title ?? n.id}{n.via ? <span className="fx-muted"> · {n.via.kind} line {n.via.line}</span> : null}</span>
        </button>
        <span className="fx-small fx-muted">{n.repeat ? 'already counted' : `${fmtTokens(n.tokens)} tok · ${share}%`}{n.children.length ? ` · branch ${fmtTokens(n.subtotal ?? 0)}` : ''}</span>
      </div>
      {n.unresolved?.length ? <p className="fx-small fx-muted axp-md-studio__indent">Not found: {n.unresolved.join(', ')}</p> : null}
      {open && n.children.length > 0 && <ul role="group">{n.children.map((c, i) => <ChainItem key={`${c.id}-${i}`} n={c} total={total} />)}</ul>}
    </li>
  );
}

/* ------------------------------------------------------------------ IDE side panes */

function useActiveDoc() {
  const [, tick] = useState(0);
  useEffect(() => { const wm = runtime()?.windows; return wm?.subscribe(() => tick((x) => x + 1)); }, []);
  const id = activeDocId();
  const ds = useStudio((s) => (id ? s.docs[id] : undefined));
  return { id, ds };
}

export function OutlinePane() {
  const { id, ds } = useActiveDoc();
  const heads = useMemo(() => outline(ds?.draft ?? ''), [ds?.draft]);
  if (!id || !ds?.doc) return <div className="fx-empty">Open a file to see its outline.</div>;
  return (
    <nav className="axp-md-studio__outline" aria-label="Outline">
      <p className="fx-small fx-muted">{ds.doc.name}</p>
      {!heads.length && <p className="fx-small fx-muted">No headings.</p>}
      {heads.map((h) => (
        <button key={`${h.line}`} type="button" className="fx-nav__item axp-md-studio__hd" data-level={h.level} onClick={() => jump(id, h.line)}>
          <span className="axp-md-studio__sub">{h.text}</span>
        </button>
      ))}
    </nav>
  );
}

export function RefsPane() {
  const { id, ds } = useActiveDoc();
  if (!id || !ds?.doc) return <div className="fx-empty">Open a file to see what it references.</div>;
  return (
    <nav className="axp-md-studio__outline" aria-label="References">
      <p className="fx-small fx-muted">{ds.doc.name} references</p>
      {!ds.doc.refs.length && <p className="fx-small fx-muted">Nothing.</p>}
      {ds.doc.refs.map((x) => (
        <button key={x.ref} type="button" className="fx-nav__item" disabled={!x.id} title={x.id ?? 'not found'} onClick={() => x.id && openDoc(x.id, 'split')}>
          <Icon name={x.id ? 'file' : 'alert'} size={13} /><span className="axp-md-studio__sub">{x.ref}</span>
        </button>
      ))}
      <Button size="sm" tone="ghost" icon="chart" onClick={() => openDoc(id, 'split', 'md-chain')}>Context view</Button>
    </nav>
  );
}
