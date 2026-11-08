/**
 * The left column of Memory Manager: Files (scopes → categories → files, each with its edit switch and its reference
 * branches), Snippets (categorized, drag into an editor or tap to insert) and Wizards (new Claude md files by purpose
 * and scope). Right-click / long-press a file: open, open in a vertical or horizontal split, context view (the
 * context-menu contribution in index.tsx, target `memory-manager-file`).
 */
import { useEffect, useMemo, useState, type DragEvent } from 'react';
import { Button, Icon, IconButton, Note, Segmented, SelectField, Switch, TextField } from '@console/axf/react';
import { SNIPPETS, WIZARDS, WIZARD_PURPOSES, viewOf, wizardId, type Wizard, type WizardScope } from './model';
import { api, createDoc, loadListing, openDoc, setEditable, useStudio, type FileEntry, type Ref } from './state';

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
type Panel = 'files' | 'snippets' | 'wizards';

export function Column() {
  const [panel, setPanel] = useState<Panel>('files');
  return (
    <aside className="axp-memory-manager__col">
      <Segmented label="Column" size="sm" value={panel} onChange={(v) => setPanel(v as Panel)} options={[{ value: 'files', label: 'Files', icon: 'folder' }, { value: 'snippets', label: 'Snippets', icon: 'copy' }, { value: 'wizards', label: 'Wizards', icon: 'sparkles' }]} />
      {panel === 'files' && <Files />}
      {panel === 'snippets' && <Snippets />}
      {panel === 'wizards' && <Wizards />}
    </aside>
  );
}

/* ------------------------------------------------------------------ files */

function Files() {
  const listing = useStudio((s) => s.listing);
  const listError = useStudio((s) => s.listError);
  const view = useStudio((s) => s.view);
  const [q, setQ] = useState('');
  const [deep, setDeep] = useState(false);
  const [closed, setClosed] = useState<Record<string, boolean>>({ repo: true });
  const searching = !!q.trim();

  useEffect(() => { const t = setTimeout(() => void loadListing(q.trim(), deep), q ? 300 : 0); return () => clearTimeout(t); }, [q, deep]);

  // categories start folded (scopes open) unless searching; a click flips whatever is shown
  const isClosed = (k: string) => (k in closed ? closed[k]! : !searching && k.includes('/'));
  const toggle = (k: string) => setClosed((c) => ({ ...c, [k]: !isClosed(k) }));

  return (
    <div className="axp-memory-manager__files" data-column={viewOf(view).column}>
      <div className="axp-memory-manager__search">
        <TextField label="Find files" type="search" value={q} onChange={setQ} placeholder="Name or path" />
        <Switch label="Search inside files" checked={deep} onChange={setDeep} />
      </div>
      {listError && <Note tone="danger">{listError}</Note>}
      {!listing && !listError && <p className="fx-muted">Loading…</p>}
      <nav className="axp-memory-manager__tree" aria-label="Markdown files">
        {listing?.scopes.filter((s) => s.available).map((s) => {
          const count = s.groups.reduce((n, g) => n + g.files.length, 0);
          if (searching && !count) return null;
          return (
            <div key={s.id} className="axp-memory-manager__scope">
              <button type="button" className="fx-nav__item axp-memory-manager__row" aria-expanded={!isClosed(s.id)} onClick={() => toggle(s.id)}>
                <Icon name={isClosed(s.id) ? 'chevron-right' : 'chevron-down'} size={12} /><Icon name={s.id === 'claude' ? 'sparkles' : s.id === 'notes' ? 'edit' : s.id === 'project' ? 'box' : 'folder'} size={14} />
                <strong className="axp-memory-manager__sub">{s.label}</strong><span className="fx-small fx-muted">{count}</span>
              </button>
              {s.id === 'claude' && s.hub === false && !isClosed(s.id) && <p className="fx-small fx-muted axp-memory-manager__indent">The hub isn't mounted here: these are the repo's synced copies.</p>}
              {!isClosed(s.id) && s.groups.map((g) => {
                const key = `${s.id}/${g.id}`;
                const proj = g.id.split('/')[0] === '_shared' ? 'shared' : g.id.split('/')[0];
                const label = s.id === 'claude' && proj !== 'repo' ? (g.category === 'top' ? proj : `${proj}/${g.category}`) : s.id === 'claude' ? g.category : g.label;
                return (
                  <div key={key} className="axp-memory-manager__group">
                    <button type="button" className="fx-nav__item axp-memory-manager__row is-nested" aria-expanded={!isClosed(key)} onClick={() => toggle(key)}>
                      <Icon name={isClosed(key) ? 'chevron-right' : 'chevron-down'} size={12} /><span className="axp-memory-manager__sub">{label}</span><span className="fx-small fx-muted">{g.files.length}</span>
                    </button>
                    {!isClosed(key) && g.files.map((f) => <FileRow key={f.id} f={f} scope={s.id} />)}
                  </div>
                );
              })}
            </div>
          );
        })}
      </nav>
    </div>
  );
}

function FileRow({ f, scope }: { f: FileEntry; scope: string }) {
  const editable = useStudio((s) => !!s.editable[f.id]);
  const active = useStudio((s) => !!s.docs[f.id]?.doc);
  const [refs, setRefs] = useState<Ref[] | null>(null);
  const [open, setOpen] = useState(false);
  const branch = async () => {
    if (open) { setOpen(false); return; }
    setOpen(true);
    if (!refs) { try { setRefs((await api.call<{ refs: Ref[] }>(`refs?id=${encodeURIComponent(f.id)}`)).refs); } catch { setRefs([]); } }
  };
  const sub = scope === 'repo' || scope === 'project' ? f.path : f.title && f.title !== f.name ? f.title : f.path;
  return (
    <div className="axp-memory-manager__file" data-fx-ctx-target="memory-manager-file" data-fx-ctx-payload={f.id}>
      <div className="axp-memory-manager__filerow">
        <button type="button" className="fx-iconbtn axp-memory-manager__twisty" aria-label={open ? 'Hide references' : 'Show references'} title="References" onClick={() => void branch()}><Icon name={open ? 'chevron-down' : 'chevron-right'} size={11} /></button>
        <button type="button" className={`fx-nav__item axp-memory-manager__fname${active ? ' is-active' : ''}`} title={`${f.id}\nRight-click or long-press: open in a split`} onClick={() => openDoc(f.id)}>
          <Icon name="file" size={13} />
          <span className="axp-memory-manager__label"><span className="axp-memory-manager__sub">{f.name}</span><span className="fx-small fx-muted axp-memory-manager__sub">{f.snippet ?? sub}</span></span>
        </button>
        <button type="button" className={`fx-iconbtn axp-memory-manager__lock${editable ? ' is-on' : ''}`} aria-pressed={editable} aria-label={editable ? `${f.name} is editable` : `Make ${f.name} editable`} title={editable ? 'Editable (tap to lock)' : 'Read only (tap to edit)'} onClick={() => setEditable(f.id, !editable)}>
          <Icon name={editable ? 'edit' : 'lock'} size={12} />
        </button>
      </div>
      {open && (
        <div className="axp-memory-manager__branches" role="group" aria-label={`${f.name} references`}>
          {!refs && <span className="fx-small fx-muted">Reading…</span>}
          {refs && !refs.length && <span className="fx-small fx-muted">No references.</span>}
          {refs?.map((r) => (
            <button key={r.ref} type="button" className="fx-nav__item axp-memory-manager__branch" disabled={!r.id} title={r.id ? `Open beside (${r.kind}, line ${r.line})` : 'not found'} onClick={() => r.id && openDoc(r.id, 'split')}>
              <Icon name={r.id ? 'arrow-right' : 'alert'} size={11} /><span className="axp-memory-manager__sub">{r.ref}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ snippets */

function Snippets() {
  const cats = useMemo(() => [...new Set(SNIPPETS.map((s) => s.category))], []);
  const insert = (body: string) => {
    const el = document.activeElement instanceof HTMLTextAreaElement && document.activeElement.classList.contains('axp-memory-manager__editor') ? document.activeElement : lastEditor;
    if (!el) return false;
    el.focus();
    // execCommand keeps the editor's undo history and fires React's onChange
    if (!document.execCommand?.('insertText', false, body)) el.setRangeText(body, el.selectionStart, el.selectionEnd, 'end');
    return true;
  };
  const [msg, setMsg] = useState('');
  return (
    <div className="axp-memory-manager__snips">
      <p className="fx-small fx-muted">Drag a snippet into an editor, or tap it to insert at the cursor of the last editor you used.</p>
      {msg && <Note tone="info">{msg}</Note>}
      {cats.map((c) => (
        <div key={c} className="axp-memory-manager__group">
          <p className="fx-eyebrow">{c}</p>
          {SNIPPETS.filter((s) => s.category === c).map((s) => (
            <button key={s.id} type="button" className="fx-chip axp-memory-manager__snip" draggable title={s.body}
              onDragStart={(e: DragEvent) => { e.dataTransfer.setData('text/plain', s.body); e.dataTransfer.effectAllowed = 'copy'; }}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setMsg(insert(s.body) ? '' : 'Open a file in Edit or Split first, then tap a snippet.')}>
              <Icon name="copy" size={12} /> {s.label}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

/** The editor that last had focus, so a tap on a snippet (which moves focus on a phone) still knows where to go. */
let lastEditor: HTMLTextAreaElement | null = null;
if (typeof document !== 'undefined') {
  document.addEventListener('focusin', (e) => { const t = e.target; if (t instanceof HTMLTextAreaElement && t.classList.contains('axp-memory-manager__editor')) lastEditor = t; });
}

/* ------------------------------------------------------------------ wizards */

function Wizards() {
  const listing = useStudio((s) => s.listing);
  const [purpose, setPurpose] = useState<string>('all');
  const [w, setW] = useState<Wizard | null>(null);
  const [scope, setScope] = useState<WizardScope>('claude');
  const [hubProject, setHubProject] = useState('amberx-axf');
  const [v, setV] = useState<Record<string, string>>({});
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const hubProjects = useMemo(() => {
    const c = listing?.scopes.find((s) => s.id === 'claude');
    const names = [...new Set((c?.groups ?? []).map((g) => g.id.split('/')[0]!).filter((x) => x && x !== 'repo'))];
    return names.length ? names : ['amberx-axf'];
  }, [listing]);

  const pick = (x: Wizard) => { setW(x); setScope(x.scopes[0]!); setV({}); setErr(''); };
  const id = w ? wizardId(w, scope, v, hubProject) : '';
  const create = async () => {
    if (!w) return;
    setBusy(true);
    try { await createDoc(id, w.render(v)); setW(null); setErr(''); } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };

  if (!w) {
    return (
      <div className="axp-memory-manager__snips">
        <Segmented label="What for" size="sm" value={purpose} onChange={setPurpose} options={[{ value: 'all', label: 'All' }, ...WIZARD_PURPOSES.map((p) => ({ value: p, label: p }))]} />
        {WIZARDS.filter((x) => purpose === 'all' || x.purpose === purpose).map((x) => (
          <button key={x.id} type="button" className="fx-nav__item axp-memory-manager__row" onClick={() => pick(x)}>
            <Icon name={x.icon} size={14} />
            <span className="axp-memory-manager__label"><span className="axp-memory-manager__sub">{x.label}</span><span className="fx-small fx-muted axp-memory-manager__sub">{x.purpose} · {x.scopes.map((s) => ({ project: 'Project', claude: 'Claude', repo: 'Repo' })[s]).join(', ')}</span></span>
          </button>
        ))}
      </div>
    );
  }
  return (
    <div className="axp-memory-manager__wizard">
      <div className="axp-memory-manager__acts"><IconButton icon="arrow-left" label="All wizards" onClick={() => setW(null)} /><strong>New {w.label}</strong></div>
      <SelectField label="Scope" value={scope} onChange={(x) => setScope(x as WizardScope)} options={w.scopes.map((s) => ({ value: s, label: { project: 'Project (an app folder)', claude: 'Claude (hub files)', repo: 'Repo' }[s] }))} />
      {scope === 'claude' && <SelectField label="Hub project" value={hubProject} onChange={setHubProject} options={hubProjects.map((p) => ({ value: p, label: p === '_shared' ? 'Shared (every project)' : p }))} />}
      {w.fields.map((f) => <TextField key={f.id} label={f.label} rows={f.rows} placeholder={f.placeholder} value={v[f.id] ?? ''} onChange={(x) => setV({ ...v, [f.id]: x })} />)}
      <p className="fx-small fx-muted">Creates <code>{id}</code> (never over an existing file) and opens it to edit.</p>
      {err && <Note tone="danger">{err}</Note>}
      <Button tone="primary" icon="plus" disabled={busy} onClick={() => void create()}>Create</Button>
    </div>
  );
}
