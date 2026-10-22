/** The studio's dialogs (opened through the framework dialog engine by id). */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Button, Icon, IconButton, Markdown, SelectField, Switch, TextField, useRuntime, type DialogMap } from '../axf/react';
import { COLUMNS } from './columns';
import { EXPORTS, catalog, describe, exportNow, type SpecInfo } from './commands';
import { registerZone, startDrag } from './dnd';
import { fmtDur, now, updatePiece, uid, type Cue } from './model';
import { studio, useStudio } from './store';
import { ui, useUi, type Dock } from './ui';

function NewProject({ close }: { close: () => void }) {
  const [name, setName] = useState('My walkthrough');
  const [from, setFrom] = useState<'blank' | 'seed'>('seed');
  return (
    <form className="fx-stack" onSubmit={(e) => { e.preventDefault(); void studio().create(name.trim() || 'Untitled walkthrough', from); close(); }}>
      <TextField label="Name" value={name} onChange={setName} autoFocus />
      <SelectField label="Start from" value={from} onChange={(v) => setFrom(v as 'blank' | 'seed')} options={[{ value: 'seed', label: 'The complete framework walkthrough (every engine, setting, plugin, flow)' }, { value: 'blank', label: 'An empty project' }]} />
      <div className="fx-row fx-row--end"><Button onClick={close}>Cancel</Button><Button tone="primary" icon="plus" type="submit">Create</Button></div>
    </form>
  );
}

function RenameProject({ id, close }: { id: string; close: () => void }) {
  const p = useStudio((s) => s.projects.find((x) => x.id === id));
  const [name, setName] = useState(p?.name ?? '');
  return (
    <form className="fx-stack" onSubmit={(e) => { e.preventDefault(); void studio().rename(id, name.trim() || p?.name || 'Walkthrough'); close(); }}>
      <TextField label="Name" value={name} onChange={setName} autoFocus />
      <div className="fx-row fx-row--end"><Button onClick={close}>Cancel</Button><Button tone="primary" type="submit">Rename</Button></div>
    </form>
  );
}

function DeleteProject({ id, close }: { id: string; close: () => void }) {
  const p = useStudio((s) => s.projects.find((x) => x.id === id));
  const [typed, setTyped] = useState('');
  return (
    <div className="fx-stack">
      <p>Delete <strong>{p?.name}</strong> from this device{p?.where !== 'device' ? ' and the axHub index' : ''}? Export it first if you may want it back.</p>
      <TextField label="Type delete to confirm" value={typed} onChange={setTyped} autoFocus />
      <div className="fx-row fx-row--end"><Button onClick={close}>Keep it</Button><Button tone="danger" icon="trash" disabled={typed.trim().toLowerCase() !== 'delete'} onClick={() => { void studio().remove(id); close(); }}>Delete</Button></div>
    </div>
  );
}

function Import({ close }: { close: () => void }) {
  const rt = useRuntime();
  const [text, setText] = useState('');
  const go = (t: string) => { void studio().importJson(t).then(close).catch((e: Error) => rt.toast(e.message, 'danger', 'Import failed')); };
  return (
    <div className="fx-stack">
      <Button icon="upload" onClick={() => { const i = document.createElement('input'); i.type = 'file'; i.accept = '.json,application/json'; i.onchange = () => void i.files?.[0]?.text().then(go); i.click(); }}>Pick a .walkthrough.json file</Button>
      <TextField label="…or paste the project JSON" rows={8} mono value={text} onChange={setText} />
      <div className="fx-row fx-row--end"><Button onClick={close}>Cancel</Button><Button tone="primary" disabled={!text.trim()} onClick={() => go(text)}>Import</Button></div>
    </div>
  );
}

function Export({ close }: { close: () => void }) {
  return (
    <div className="fx-stack">
      {EXPORTS.map((e) => <div key={e.id} className="ws-row"><span className="ws-grow">{e.label}</span><Button size="sm" icon="download" onClick={() => exportNow(e.id)}>Save</Button></div>)}
      <div className="fx-row fx-row--end"><Button onClick={close}>Done</Button></div>
    </div>
  );
}

function Columns({ close }: { close: () => void }) {
  const hidden = useUi((s) => s.grid.hidden);
  return (
    <div className="fx-stack">
      {COLUMNS.map((c) => <Switch key={c.id} label={c.label} checked={c.fixed || !hidden.includes(c.id)} disabled={c.fixed} onChange={(v) => ui.toggleColumn(c.id, v)} hint={c.fixed ? 'Always shown' : undefined} />)}
      <div className="fx-row fx-row--end"><Button onClick={() => ui.patchGrid({ hidden: [] })}>Show all</Button><Button tone="primary" onClick={close}>Done</Button></div>
    </div>
  );
}

/* ---------- toolbar customizer ---------- */

interface Node { name: string; path: string; children: Map<string, Node>; items: SpecInfo[] }
function treeOf(list: SpecInfo[]): Node {
  const root: Node = { name: '', path: '', children: new Map(), items: [] };
  for (const it of list) {
    let n = root;
    for (const seg of it.path) { const p = `${n.path}/${seg}`; if (!n.children.has(seg)) n.children.set(seg, { name: seg, path: p, children: new Map(), items: [] }); n = n.children.get(seg)!; }
    n.items.push(it);
  }
  return root;
}
const countOf = (n: Node): number => n.items.length + [...n.children.values()].reduce((a, c) => a + countOf(c), 0);

function Toolbars({ id, close }: { id?: string; close: () => void }) {
  const rt = useRuntime();
  const toolbars = useUi((s) => s.toolbars);
  const [cur, setCur] = useState(id && toolbars.some((t) => t.id === id) ? id : toolbars[0]?.id);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [sort, setSort] = useState<'tree' | 'az' | 'za'>('tree');
  const [open, setOpen] = useState<string[]>(['/Studio', '/Studio/Project', '/Studio/Edit']);
  const all = useMemo(() => catalog(rt), [rt, toolbars.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const tb = toolbars.find((t) => t.id === cur);
  useEffect(() => registerZone('cust', {
    accepts: (p) => p.kind === 'command' || p.kind === 'cust-item', positions: () => ['before', 'after'],
    drop: (p, target, pos) => {
      const t = ui.toolbar(cur!); if (!t) return;
      const items = [...t.items]; let at = Number(target) + (pos === 'after' ? 1 : 0); let spec = p.id;
      if (p.kind === 'cust-item') { const from = Number(p.id); spec = items[from]!; items.splice(from, 1); if (from < at) at--; }
      items.splice(at, 0, spec); ui.patchToolbar(t.id, { items });
    },
  }), [cur]);
  useEffect(() => registerZone('cust-end', { accepts: (p) => p.kind === 'command', positions: () => ['inside'], drop: (p) => { const t = ui.toolbar(cur!); if (t) ui.patchToolbar(t.id, { items: [...t.items, p.id] }); } }), [cur]);

  const cats = [...new Set(all.map((x) => x.path.join(' › ')))].sort();
  const filtered = all.filter((x) => (!cat || x.path.join(' › ').startsWith(cat)) && (!q || `${x.label} ${x.spec} ${x.path.join(' ')}`.toLowerCase().includes(q.toLowerCase())));
  const add = (spec: string) => tb && ui.patchToolbar(tb.id, { items: [...tb.items, spec] });
  const row = (it: SpecInfo, showPath = false) => (
    <li key={it.spec}>
      <div className="ws-cmd" onPointerDown={(e) => startDrag(e, { kind: 'command', id: it.spec, label: it.label, icon: it.icon })} onDoubleClick={() => add(it.spec)}>
        <span className="ws-grip"><Icon name={it.icon} size={14} /></span>
        <span className="ws-grow ws-col"><span className="ws-ellipsis">{it.label}</span><span className="fx-small fx-muted fx-mono ws-ellipsis">{showPath ? `${it.path.join(' › ')} · ` : ''}{it.spec}</span></span>
        {tb?.items.includes(it.spec) && <Icon name="check" size={12} />}
        <IconButton icon="plus" label={`Add ${it.label}`} onClick={() => add(it.spec)} />
      </div>
    </li>
  );
  const renderNode = (n: Node, depth: number): ReactNode => {
    const kids = [...n.children.values()].sort((a, b) => a.name.localeCompare(b.name));
    return (
      <>
        {kids.map((k) => {
          const o = open.includes(k.path) || !!q;
          return (
            <li key={k.path}>
              <button type="button" data-fx-row className="ws-tree__row ws-tree__row--section" style={{ paddingInlineStart: `calc(var(--fx-space) * ${depth * 1.4 + 0.4})` }} onClick={() => setOpen((x) => (o ? x.filter((y) => y !== k.path) : [...x, k.path]))} aria-expanded={o}>
                <Icon name={o ? 'chevron-down' : 'chevron-right'} size={12} /> <strong>{k.name}</strong> <span className="fx-small fx-muted">{countOf(k)}</span>
              </button>
              {o && <ul className="ws-cmdtree__group">{renderNode(k, depth + 1)}</ul>}
            </li>
          );
        })}
        {[...n.items].sort((a, b) => a.label.localeCompare(b.label)).map((it) => row(it))}
      </>
    );
  };
  const sorted = sort === 'tree' ? null : [...filtered].sort((a, b) => a.label.localeCompare(b.label) * (sort === 'az' ? 1 : -1));
  return (
    <div className="ws-cust">
      <section className="ws-cust__col">
        <h3 className="ws-h">Toolbars</h3>
        {toolbars.map((t) => (
          <button key={t.id} type="button" data-fx-row className={`ws-row ${t.id === cur ? 'is-active' : ''}`} onClick={() => setCur(t.id)}>
            <Icon name={t.dock === 'float' ? 'layers' : 'layout'} size={14} /><span className="ws-grow ws-ellipsis">{t.name}</span><span className="fx-small fx-muted">{t.dock} · {t.items.length}</span>
          </button>
        ))}
        <div className="fx-row fx-row--wrap">
          <Button size="sm" icon="plus" onClick={() => setCur(ui.addToolbar())}>Add toolbar</Button>
          <Button size="sm" tone="quiet" icon="refresh" onClick={() => { ui.resetToolbars(); setCur(ui.s.toolbars[0]?.id); }}>Two defaults</Button>
        </div>
        {tb && (
          <div className="fx-stack">
            <TextField label="Name" value={tb.name} onChange={(v) => ui.patchToolbar(tb.id, { name: v })} />
            <SelectField label="Place" value={tb.dock} onChange={(v) => ui.patchToolbar(tb.id, { dock: v as Dock })} options={[{ value: 'top', label: 'Docked top' }, { value: 'bottom', label: 'Docked bottom' }, { value: 'left', label: 'Docked left' }, { value: 'right', label: 'Docked right' }, { value: 'float', label: 'Floating' }]} />
            <Switch label="Show labels" checked={tb.labels} onChange={(v) => ui.patchToolbar(tb.id, { labels: v })} />
            <Switch label="Shown" checked={tb.visible} onChange={(v) => ui.patchToolbar(tb.id, { visible: v })} />
            <Button size="sm" tone="danger" icon="trash" onClick={() => { ui.removeToolbar(tb.id); setCur(ui.s.toolbars[0]?.id); }}>Remove this toolbar</Button>
          </div>
        )}
      </section>
      <section className="ws-cust__col">
        <h3 className="ws-h">On “{tb?.name}” <span className="fx-small fx-muted">drag to reorder</span></h3>
        <ol className="ws-cust__items">
          {tb?.items.map((spec, i) => {
            const d = spec === '|' ? { label: 'Separator', icon: 'minus', spec } : describe(rt, spec);
            return (
              <li key={`${spec}-${i}`} className="ws-cmd" data-ws-drop="cust" data-ws-drop-id={String(i)} onPointerDown={(e) => startDrag(e, { kind: 'cust-item', id: String(i), label: d.label, icon: d.icon })}>
                <span className="ws-grip"><Icon name={d.icon} size={14} /></span><span className="ws-grow ws-ellipsis">{d.label}</span>
                <IconButton icon="chevron-up" label="Earlier" onClick={() => { const it = [...tb.items]; if (i > 0) { [it[i - 1], it[i]] = [it[i]!, it[i - 1]!]; ui.patchToolbar(tb.id, { items: it }); } }} />
                <IconButton icon="chevron-down" label="Later" onClick={() => { const it = [...tb.items]; if (i < it.length - 1) { [it[i + 1], it[i]] = [it[i]!, it[i + 1]!]; ui.patchToolbar(tb.id, { items: it }); } }} />
                <IconButton icon="x" label="Remove" onClick={() => ui.patchToolbar(tb.id, { items: tb.items.filter((_, k) => k !== i) })} />
              </li>
            );
          })}
          <li className="ws-cust__drop fx-small fx-muted" data-ws-drop="cust-end" data-ws-drop-id="end">Drop a command here, or tap + in the list</li>
        </ol>
        {tb && <Button size="sm" tone="quiet" icon="minus" onClick={() => add('|')}>Add a separator</Button>}
      </section>
      <section className="ws-cust__col ws-cust__col--wide">
        <h3 className="ws-h">Every command, action, view and setting <span className="fx-small fx-muted">{filtered.length}</span></h3>
        <div className="fx-search"><Icon name="search" size={14} /><input className="fx-input" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search commands" autoFocus /></div>
        <div className="fx-row">
          <select className="fx-input ws-grow" value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Category"><option value="">Every category</option>{cats.map((c) => <option key={c}>{c}</option>)}</select>
          <select className="fx-input" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label="Sort"><option value="tree">Tree</option><option value="az">A → Z</option><option value="za">Z → A</option></select>
        </div>
        <ul className="ws-cmdtree">{sorted ? sorted.map((it) => row(it, true)) : renderNode(treeOf(filtered), 0)}</ul>
      </section>
      <div className="fx-row fx-row--end ws-cust__foot"><Button tone="primary" onClick={close}>Done</Button></div>
    </div>
  );
}

/* ---------- process a recording with Claude ---------- */

function Process({ id, close }: { id?: string; close: () => void }) {
  const rt = useRuntime();
  const prj = useStudio((s) => s.project)!;
  const rec = prj.recordings.find((r) => r.id === id) ?? prj.recordings[0];
  const piece = rec?.pieceId ? prj.pieces[rec.pieceId] : undefined;
  const [reply, setReply] = useState('');
  if (!rec) return <p>Record something first.</p>;
  const summary = rec.events.filter((e) => e.type !== 'move').slice(0, 300).map((e) => ({ t: +e.t.toFixed(2), type: e.type, x: e.x != null ? +e.x.toFixed(3) : undefined, y: e.y != null ? +e.y.toFixed(3) : undefined, key: e.key, text: e.text, target: e.target }));
  const prompt = [
    'You are turning a screen recording of the AmberX AXF framework into one narrated piece of a walkthrough video.',
    `Piece: ${piece?.title ?? '(not attached)'} · page ${rec.url} · recording ${fmtDur(rec.duration)}.`,
    piece?.narration ? `Draft narration: ${piece.narration}` : '',
    piece?.effect ? `The effect to show: ${piece.effect}` : '',
    `Speaking speed ${prj.settings.wpm} wpm. Write narration that fits the recording's length, explains what each click does and why, and names every setting changed and its effect.`,
    'Answer with JSON only: {"narration": "…", "cues": [{"kind": "move|click|type|key|scroll|wait|highlight|navigate|say", "target": "…", "text": "…", "x": 0..1, "y": 0..1, "dur": seconds}]}',
    '', 'Events (pointer moves left out):', JSON.stringify(summary),
  ].filter(Boolean).join('\n');
  const apply = () => {
    try {
      const j = JSON.parse(reply.replace(/^```(json)?|```$/gm, '').trim()) as { narration?: string; cues?: Partial<Cue>[] };
      const cues = (j.cues ?? []).map((c) => ({ id: uid('c'), kind: (c.kind ?? 'say') as Cue['kind'], target: c.target, text: c.text, x: c.x, y: c.y, dur: Number(c.dur) || 1 }));
      studio().edit('Claude processed', (q) => {
        let n = { ...q, recordings: q.recordings.map((r) => (r.id === rec.id ? { ...r, processed: { at: now(), narration: j.narration, cues } } : r)) };
        if (piece) n = updatePiece(n, piece.id, { ...(j.narration ? { narration: j.narration } : {}), ...(cues.length ? { cues } : {}), status: 'review' });
        return n;
      });
      rt.toast(piece ? `“${piece.title}” updated; it now needs review.` : 'Saved on the recording.', 'success', 'Applied');
      close();
    } catch (e) { rt.toast(`That isn't the JSON asked for: ${(e as Error).message}`, 'danger'); }
  };
  return (
    <div className="fx-stack">
      <p className="fx-small">1. Copy the prompt and give it to Claude (any session). 2. Paste Claude's JSON answer below. 3. Apply: the piece gets the narration and the cue track, and is marked Needs review.</p>
      <pre className="fx-code ws-pre ws-pre--short">{prompt.slice(0, 4000)}{prompt.length > 4000 ? '\n…' : ''}</pre>
      <div className="fx-row fx-row--wrap">
        <Button icon="copy" onClick={() => void navigator.clipboard?.writeText(prompt).then(() => rt.toast('Prompt copied.', 'success'))}>Copy prompt</Button>
        <Button tone="quiet" icon="external" onClick={() => window.open('https://claude.ai/new', '_blank', 'noopener,noreferrer')}>Open Claude</Button>
      </div>
      <TextField label="Claude's answer (JSON)" rows={6} mono value={reply} onChange={setReply} />
      <div className="fx-row fx-row--end"><Button onClick={close}>Cancel</Button><Button tone="primary" icon="sparkles" disabled={!reply.trim()} onClick={apply}>Apply</Button></div>
    </div>
  );
}

const GUIDE = `**Walkthrough Studio** plans a narrated video of the framework, piece by piece, then compiles it.

- **Projects** (left column): every project you saved. Pick one and the whole studio shows it. New, duplicate, compile and export from its toolbar or right-click.
- **Index**: the outline as a tree of sections and pieces. Search, filter by status / kind / recorded, and drag anything to rearrange (into a section: drop on its middle).
- **Status grid**: every piece by category, with status, progress, clip length and the estimate while it isn't recorded. Right-click the header to hide columns; drag rows to arrange — or onto the trash can that pops up at the bottom.
- **Script**: what the narrator says and the cue track the cursor acts out. *Speak it* reads it with the narrator's voice.
- **Live browser**: open a page, press **Record**, act it out. The recording attaches to the selected piece and sets its clip length; *Make cues* turns it into a cue track; *Process with Claude* writes the narration.
- **Compile** lays every piece end to end with chapter cards and timed captions; unchanged pieces are reused, so swapping pieces and recompiling is instant. **Preview** plays it with voice, captions and cursor; **Export** saves the timeline, SRT/VTT, script, shot list, EDL and a Claude brief.
- **Toolbars**: two by default; add as many as you want, dock them on any edge or float them (drag the grip). *Customize toolbars* lists every command, pane, layout, framework action, view, setting and look.
- **Layouts**: IDE, Grid, Record, Write, Review, Compile, Focus. Show or hide any pane, drag a pane's tab to another area, or float it.`;

export const studioDialogs: DialogMap = {
  'ws.new-project': { title: 'New project', icon: 'plus', render: (_p, close) => <NewProject close={close} /> },
  'ws.rename-project': { title: 'Rename project', icon: 'edit', searchable: false, render: (p, close) => <RenameProject id={String(p.id)} close={close} /> },
  'ws.delete-project': { title: 'Delete project', icon: 'trash', searchable: false, render: (p, close) => <DeleteProject id={String(p.id)} close={close} /> },
  'ws.import': { title: 'Import a project', icon: 'upload', render: (_p, close) => <Import close={close} /> },
  'ws.export': { title: 'Export', icon: 'download', render: (_p, close) => <Export close={close} /> },
  'ws.columns': { title: 'Grid columns', icon: 'sliders', render: (_p, close) => <Columns close={close} /> },
  'ws.toolbars': { title: 'Customize toolbars', icon: 'sliders', render: (p, close) => <Toolbars id={p.id as string | undefined} close={close} /> },
  'ws.process': { title: 'Process with Claude', icon: 'sparkles', searchable: false, render: (p, close) => <Process id={p.id as string | undefined} close={close} /> },
  'ws.guide': { title: 'How the studio works', icon: 'help', render: () => <Markdown text={GUIDE} /> },
  'ws.about': { title: 'About Walkthrough Studio', icon: 'info', render: () => <Markdown text={'**Walkthrough Studio** 0.1.0 — a video walkthrough assembly suite on AmberX AXF.\n\nProjects are `walkthrough-project@1`; the compiler writes `walkthrough-timeline@1`. Projects live on this device and, when switched on, on axHub\'s data server.'} /> },
};
