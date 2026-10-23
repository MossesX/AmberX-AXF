/** The studio's dialogs (opened through the framework dialog engine by id). */
import { useState } from 'react';
import { Button, Markdown, SelectField, Switch, TextField, useRuntime, type DialogMap } from '../axf/react';
import { COLUMNS } from './columns';
import { EXPORTS, catalog, describe, exportNow } from './commands';
import { ToolbarCustomizer } from '../axf/libs/workspace';
import { fmtDur, now, updatePiece, uid, type Cue } from './model';
import { studio, useStudio } from './store';
import { ui, useUi } from './ui';

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

/* ---------- toolbar customizer (lib-workspace) ---------- */

function Toolbars({ id, close }: { id?: string; close: () => void }) {
  const rt = useRuntime();
  return <ToolbarCustomizer ws={ui.ws} initial={id} close={close} catalog={() => catalog(rt)} describe={(spec) => describe(rt, spec)} />;
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
