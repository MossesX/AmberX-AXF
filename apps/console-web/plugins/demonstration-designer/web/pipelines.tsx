/**
 * The Pipelines mode of the Demonstration Designer: the library of ready-made pipeline demos (one per pipeline type),
 * the open demo (its chapters and the screen each moves to, Play as a replay or Run live on the test-sandbox project,
 * speed), and the designer that makes and edits a demo (pick a pipeline type, script the narration of each chapter,
 * choose its screen, the behind-the-scenes lines and the live probes). The walkthrough bar and the behind-the-scenes
 * panel are drawn over the whole console (cover.tsx), so they stay up while the console moves from screen to screen.
 */
import { useEffect, useMemo, useState } from 'react';
import { Button, Checkbox, Icon, Note, Segmented, SelectField, TextField, useRuntime } from '@console/axf/react';
import { EmptyState, LoadingSkeleton } from '@console/emptyState';
import * as P from '../pipelines.mjs';
import type { Chapter, Mode, PipelineDemo } from '../pipelines.mjs';
import { copyPipeline, deletePipeline, getPipeline, loadPipelines, pSpeed, pMode, runPipeline, savePipeline, setOpen, usePipelines } from './pipeline-model';

const SPEED_OPTS = P.SPEEDS.map((s) => ({ value: String(s), label: `${s}×` }));
const MODE_OPTS: { value: Mode; label: string; title: string }[] = [
  { value: 'replay', label: 'Replay', title: 'Plays the recorded run (or the script): instant, works offline' },
  { value: 'live', label: 'Live', title: 'Runs the chapter probes for real on the test-sandbox project first (read-only)' },
];

/* ---------------- events as text: one "kind: text" line each, with an optional "@seconds" ---------------- */

export const eventsText = (c: Chapter) => c.events.map((e) => `@${e.at} ${e.kind}: ${e.text}`).join('\n');
export function parseEvents(text: string) {
  return text.split('\n').map((l) => l.trim()).filter(Boolean).map((l, i) => {
    const m = /^(?:@(\d+(?:\.\d+)?)\s+)?(?:([a-z]+):\s*)?(.*)$/.exec(l)!;
    return { at: m[1] ? Number(m[1]) : i * 0.8, kind: (m[2] && (P.KIND_IDS as string[]).includes(m[2]) ? m[2] : 'agent'), text: m[3] || l };
  });
}

/* ---------------- the designer: make or edit one demo ---------------- */

function ChapterEditor({ c, n, onChange, onRemove, onMove }: { c: Chapter; n: number; onChange: (c: Chapter) => void; onRemove: () => void; onMove: (d: -1 | 1) => void }) {
  const [events, setEvents] = useState(eventsText(c));
  useEffect(() => setEvents(eventsText(c)), [c.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const screens = [{ value: '', label: 'Stay where it is' }, ...P.SCREENS.map((s) => ({ value: s.view, label: s.label }))];
  if (c.view && !P.SCREENS.some((s) => s.view === c.view)) screens.push({ value: c.view, label: c.view });
  return (
    <li className="axp-demonstration-designer__step" data-chapter={c.id}>
      <div className="axp-demonstration-designer__step-head">
        <span className="axp-demonstration-designer__step-n">{n}</span>
        <TextField label="Chapter title" value={c.title} onChange={(title) => onChange({ ...c, title })} />
        <div role="toolbar" aria-label={`Chapter ${n} tools`} className="axp-demonstration-designer__tools">
          <Button size="sm" icon="chevron-up" aria-label="Move up" onClick={() => onMove(-1)} />
          <Button size="sm" icon="chevron-down" aria-label="Move down" onClick={() => onMove(1)} />
          <Button size="sm" icon="trash" tone="danger" aria-label="Remove chapter" onClick={onRemove} />
        </div>
      </div>
      <TextField label="Narration" rows={3} value={c.say} onChange={(say) => onChange({ ...c, say })} placeholder="What the narrator says while this chapter plays" />
      <div className="axp-demonstration-designer__grid">
        <SelectField label="Screen (focus mode moves here)" value={c.view} onChange={(view) => onChange({ ...c, view })} options={screens} />
        <TextField label="Element to show (CSS selector)" mono value={c.selector} onChange={(selector) => onChange({ ...c, selector })} placeholder="optional" />
        <TextField label="Seconds" type="number" value={String(c.seconds)} onChange={(v) => onChange({ ...c, seconds: Number(v) || c.seconds })} />
      </div>
      <TextField label="Behind the scenes (one line each: @seconds kind: text)" rows={4} mono value={events} onChange={(v) => { setEvents(v); onChange({ ...c, events: parseEvents(v) as Chapter['events'] }); }} hint={`Kinds: ${P.KIND_IDS.join(', ')}`} />
      <fieldset className="axp-demonstration-designer__probes">
        <legend className="fx-eyebrow">Live run: real output added to this chapter</legend>
        {Object.entries(P.PROBES).map(([id, p]) => (
          <Checkbox key={id} label={`${id}: ${p.about}`} checked={c.live.includes(id)} onChange={(on) => onChange({ ...c, live: on ? [...c.live, id] : c.live.filter((x) => x !== id) })} />
        ))}
      </fieldset>
    </li>
  );
}

export function PipelineDesigner({ start, onDone }: { start: PipelineDemo; onDone: (d: PipelineDemo | null) => void }) {
  const [d, setD] = useState<PipelineDemo>(start);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const errs = P.validateDemo(d);
  const setChapter = (i: number, c: Chapter) => setD({ ...d, chapters: d.chapters.map((x, j) => (j === i ? c : x)) });
  const move = (i: number, by: -1 | 1) => { const j = i + by; if (j < 0 || j >= d.chapters.length) return; const ch = [...d.chapters]; [ch[i], ch[j]] = [ch[j]!, ch[i]!]; setD({ ...d, chapters: ch }); };
  const add = () => setD({ ...d, chapters: [...d.chapters, P.normalizeChapter({ id: `c${d.chapters.length + 1}-${Date.now() % 1000}`, title: 'New chapter', say: '', view: 'builds', seconds: 8 }, d.chapters.length)] });
  const save = () => { setBusy(true); setMsg(''); savePipeline(d).then(onDone, (e: Error) => setMsg(e.message)).finally(() => setBusy(false)); };
  return (
    <section className="fx-card fx-stack axp-demonstration-designer__designer" aria-label="Pipeline demo designer">
      <div className="axp-demonstration-designer__head">
        <div><p className="fx-eyebrow">Designer · {d.builtIn ? 'a copy of a built-in' : 'your demo'}</p><h2>{d.name || 'New pipeline demo'}</h2></div>
        <div role="toolbar" aria-label="Designer tools" className="axp-demonstration-designer__tools">
          <Button size="sm" icon="x" onClick={() => onDone(null)}>Cancel</Button>
          <Button size="sm" tone="primary" icon="check" busy={busy} disabled={errs.length > 0} onClick={save}>Save</Button>
        </div>
      </div>
      <div className="axp-demonstration-designer__grid">
        <TextField label="Name" value={d.name} onChange={(name) => setD({ ...d, name })} />
        <TextField label="Id" mono value={d.id} onChange={(id) => setD({ ...d, id: id.toLowerCase() })} hint="lowercase letters, digits and dashes" />
        <SelectField label="Pipeline type" value={d.type} onChange={(type) => setD({ ...d, type })} options={P.PIPELINE_TYPES.map((t) => ({ value: t.id, label: t.label }))} />
      </div>
      <TextField label="Summary" value={d.summary} onChange={(summary) => setD({ ...d, summary })} />
      <TextField label="Voice phrases (comma separated): say “run the … demo”" value={d.voice.join(', ')} onChange={(v) => setD({ ...d, voice: v.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean) })} />
      <ol className="axp-demonstration-designer__steps" aria-label="Chapters">
        {d.chapters.map((c, i) => <ChapterEditor key={c.id} c={c} n={i + 1} onChange={(x) => setChapter(i, x)} onRemove={() => setD({ ...d, chapters: d.chapters.filter((_, j) => j !== i) })} onMove={(by) => move(i, by)} />)}
      </ol>
      <div role="toolbar" aria-label="Chapter list tools" className="axp-demonstration-designer__tools"><Button size="sm" icon="plus" onClick={add}>Add chapter</Button><span className="fx-muted">{d.chapters.length} chapters · {P.clock(P.demoSeconds(P.normalizeDemo(d)))}</span></div>
      {errs.length > 0 && <Note tone="warning">{errs.join('; ')}</Note>}
      {msg && <Note tone="danger">{msg}</Note>}
    </section>
  );
}

/* ---------------- the open demo ---------------- */

function DemoDetail({ id, onEdit }: { id: string; onEdit: (d: PipelineDemo) => void }) {
  const p = usePipelines();
  const [d, setD] = useState<PipelineDemo | null>(null);
  const [msg, setMsg] = useState('');
  useEffect(() => { setD(null); getPipeline(id).then(setD, (e: Error) => setMsg(e.message)); }, [id]);
  const s = p.demos.find((x) => x.id === id);
  if (!d) return msg ? <Note tone="danger">{msg}</Note> : <LoadingSkeleton rows={3} label="Loading the demo" />;
  const playing = p.player.status !== 'idle' && p.player.id === id;
  return (
    <section className="fx-card fx-stack axp-demonstration-designer__pipeline" aria-label={`Pipeline demo ${d.name}`} data-pipeline={d.id}>
      <div className="axp-demonstration-designer__head">
        <div>
          <p className="fx-eyebrow">{P.typeLabel(d.type)} · {d.chapters.length} chapters · {P.clock(P.demoSeconds(d))}{s?.recorded ? ' · recorded live run' : ''}</p>
          <h2>{d.name}</h2>
          <p className="fx-muted">{d.summary}</p>
        </div>
        <div role="toolbar" aria-label="Demo tools" className="axp-demonstration-designer__tools">
          <Button size="sm" icon="edit" onClick={() => { if (d.builtIn) copyPipeline(d.id).then((c) => { setOpen(c.id); onEdit(c); }, (e: Error) => setMsg(e.message)); else onEdit(d); }}>{d.builtIn ? 'Edit a copy' : 'Edit'}</Button>
          {!d.builtIn && <Button size="sm" icon="trash" tone="danger" confirm={`Delete ${d.name}?`} onClick={() => void deletePipeline(d.id).then(() => setOpen(''), (e: Error) => setMsg(e.message))}>Delete</Button>}
        </div>
      </div>
      <div className="axp-demonstration-designer__go">
        <Segmented<Mode> label="How it runs" value={p.player.mode} onChange={pMode} options={MODE_OPTS} />
        <Segmented<string> label="Speed" size="sm" value={String(p.player.speed)} onChange={(v) => pSpeed(Number(v))} options={SPEED_OPTS} />
        <Button tone="primary" icon="play" busy={p.running} disabled={playing} onClick={() => void runPipeline(d.id).catch((e: Error) => setMsg(e.message))} className="axp-demonstration-designer__generate">{p.player.mode === 'live' ? 'Run live' : 'Play'}</Button>
        <span className="fx-muted">{p.player.mode === 'live' ? 'Runs git, the sandbox builds, the model policy, tests and more for real (read-only), then walks you through it.' : 'Walks you through it; the console follows each chapter and the terminal shows what happens behind the scenes.'}</span>
      </div>
      <ol className="axp-demonstration-designer__chapters" aria-label="Chapters">
        {d.chapters.map((c, i) => (
          <li key={c.id} className="axp-demonstration-designer__chapter">
            <span className="axp-demonstration-designer__step-n">{i + 1}</span>
            <div className="axp-demonstration-designer__picked-body">
              <strong>{c.title}</strong>
              <span className="fx-muted">{c.say}</span>
              <span className="axp-demonstration-designer__meta"><Icon name="monitor" size={12} /> {c.view ? P.screenLabel(c.view) : 'stays put'} · {c.events.length} lines behind the scenes{c.live.length ? ` · live: ${c.live.join(', ')}` : ''}</span>
            </div>
          </li>
        ))}
      </ol>
      <p className="fx-muted axp-demonstration-designer__note"><Icon name="mic" size={12} /> Say “run the {d.voice[0] ?? d.name.toLowerCase()} demo”, or <span className="fx-mono">axf demonstration-designer pipeline-live --id {d.id}</span>, or open <span className="fx-mono">{P.pipelineLink('', d.id, { play: true })}</span>.</p>
      {msg && <Note tone="danger">{msg}</Note>}
    </section>
  );
}

/* ---------------- the page ---------------- */

export function PipelinesPage() {
  const rt = useRuntime();
  const p = usePipelines();
  const [editing, setEditing] = useState<PipelineDemo | null>(null);
  const [type, setType] = useState('all');
  useEffect(() => { void loadPipelines(); }, []);
  const rows = useMemo(() => p.demos.filter((d) => type === 'all' || d.type === type), [p.demos, type]);
  const open = p.open || p.demos[0]?.id || '';
  const blank = () => setEditing(P.normalizeDemo({ id: `my-demo-${Date.now() % 100000}`, name: 'My pipeline demo', type: 'custom', chapters: [{ id: 'c1', title: 'First chapter', say: '', view: 'build-orchestrator', seconds: 8 }] }));
  return (
    <div className="fx-stack fx-stack--lg axp-demonstration-designer axp-demonstration-designer--pipelines">
      <header className="fx-pagehead">
        <div>
          <p className="fx-eyebrow">Demonstrations · pipelines{p.loaded ? ` · ${p.demos.length}` : ''}</p>
          <h1>Pipeline demos</h1>
          <p className="fx-muted">Pick a pipeline and press Play: narrated chapters walk you through it, the console follows each step to its screen, and a terminal shows everything that normally happens out of sight.</p>
        </div>
      </header>
      {p.error && <Note tone="warning">{p.error}</Note>}
      {editing ? <PipelineDesigner start={editing} onDone={(d) => { setEditing(null); if (d) setOpen(d.id); }} /> : (
        <div className="axp-demonstration-designer__library">
          <section className="fx-stack" aria-label="Pipeline library">
            <div className="axp-demonstration-designer__head">
              <SelectField label="Pipeline type" value={type} onChange={setType} options={[{ value: 'all', label: 'All types' }, ...P.PIPELINE_TYPES.map((t) => ({ value: t.id, label: t.label }))]} />
              <div role="toolbar" aria-label="Library tools" className="axp-demonstration-designer__tools">
                <Button size="sm" icon="plus" onClick={blank}>New demo</Button>
                <Button size="sm" icon="refresh" aria-label="Refresh" onClick={() => void loadPipelines(true)} />
              </div>
            </div>
            {!p.loaded ? <LoadingSkeleton rows={5} label="Loading pipeline demos" /> : !rows.length ? <EmptyState compact icon="play">No demo of this type yet. Press New demo to make one.</EmptyState> : (
              <ul className="axp-demonstration-designer__rows" aria-label="Pipeline demos">
                {rows.map((s) => (
                  <li key={s.id} className={`axp-demonstration-designer__saved${open === s.id ? ' is-selected' : ''}`}>
                    <button type="button" data-fx-row data-axf-target={`demonstration-designer.pipeline.${s.id}`} className="axp-demonstration-designer__row" onClick={() => setOpen(s.id)}>
                      <span className="axp-demonstration-designer__kind" data-kind={s.builtIn ? 'plugin' : 'screen'}>{s.typeLabel}</span>
                      <strong>{s.name}</strong>
                      <span className="fx-muted axp-demonstration-designer__clamp">{s.summary}</span>
                      <span className="fx-muted">{s.chapters} chapters · {P.clock(s.seconds)} · {s.events} lines{s.recorded ? ' · recorded' : ''}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
          {open ? <DemoDetail id={open} onEdit={setEditing} /> : null}
        </div>
      )}
      <p className="fx-muted axp-demonstration-designer__note"><Icon name="info" size={12} /> The walkthrough bar and the behind-the-scenes terminal stay on top while the console moves. Dock, float or go full screen from the terminal’s toolbar. Settings: <button type="button" data-fx-row data-axf-target="demonstration-designer.pipelines.settings" className="axp-demonstration-designer__link" onClick={() => rt.dispatch('settings.open:demonstration-designer')}>Demonstration Designer</button>.</p>
    </div>
  );
}
