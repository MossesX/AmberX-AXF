/**
 * Walkthrough Generator (investor demos): pick any number of glossary entries (search, kind and category filters,
 * select all shown), order them, write a prompt, read the brief, and Generate: the server runs the chain (one Claude
 * call per feature through axf.llm@1, the zero-token template for any feature without a usable answer) and saves a
 * versioned walkthrough (glossary-walkthrough@1) that plays back with no live Claude, here or in the demo sandbox.
 */
import { useEffect, useMemo, useState } from 'react';
import { Button, Checkbox, IconButton, Markdown, SelectField, Switch, TextField, useRuntime } from '@console/axf/react';
import { EmptyState, LoadingSkeleton } from '@console/emptyState';
import type { Entry } from './core';
import { loadCatalog, useCatalog } from './demos-core';
import { playBundle, playWalkthroughId } from './walkthrough-player';
import {
  AUDIENCES, MAX_TERMS, PICKER_ROWS, WT_DEPTHS, WT_KEYS, WT_MODES, WT_STYLES, cancelJob, deleteWalkthrough, exportOf, followJob, getBundle,
  loadWalkthroughs, moveTerm, pickerEntries, planWalkthrough, restoreVersion, selectAll, startGenerate, toggleTerm, topCategories,
  useWalkthroughs, versionsOf, type BundleSummary, type Job, type VersionRow, type WalkRequest,
} from './walkthroughs-core';

function useSetting(key: string, fallback: string): [string, (v: string) => void] {
  const rt = useRuntime();
  const [, tick] = useState(0);
  useEffect(() => rt.settings.onChange(key, () => tick((t) => t + 1)), [rt, key]);
  const raw = rt.settings.get(key);
  return [typeof raw === 'string' && raw ? raw : fallback, (v: string) => rt.settings.set(key, v)];
}

/* ---------------- picker ---------------- */

function Picker({ selected, onChange }: { selected: string[]; onChange: (s: string[]) => void }) {
  const { cat, loading, error } = useCatalog();
  const [q, setQ] = useState('');
  const [kind, setKind] = useState('');
  const [category, setCategory] = useState('');
  const [selectedOnly, setSelectedOnly] = useState(false);
  const [note, setNote] = useState('');
  const all = useMemo(() => (cat ? pickerEntries(cat.entries, { q, kind, category, selectedOnly }, selected) : []), [cat, q, kind, category, selectedOnly, selected]);
  const cats = useMemo(() => (cat ? topCategories(cat.entries) : []), [cat]);
  if (!cat) return loading || !error ? <LoadingSkeleton rows={6} /> : <EmptyState compact icon="info">{error}</EmptyState>;
  const shown = all.slice(0, PICKER_ROWS);
  const sel = new Set(selected);
  return (
    <section className="fx-stack axp-glossary-index__wt-picker" aria-label="Pick glossary entries">
      <div className="axp-glossary-index__bar">
        <TextField className="axp-glossary-index__search" label="Search the glossary" value={q} onChange={setQ} placeholder="merge queue, hot-swap, build orchestrator…" />
        <SelectField label="Kind" value={kind} onChange={setKind} options={[{ value: '', label: 'Every kind' }, ...Object.entries(cat.kinds).filter(([k]) => !['demonstration', 'book', 'clip', 'docs'].includes(k)).map(([value, label]) => ({ value, label: `${label} (${(cat.counts[value] ?? 0).toLocaleString()})` }))]} />
        <SelectField label="Category" value={category} onChange={setCategory} options={[{ value: '', label: 'Every category' }, ...cats.map((c) => ({ value: c.value, label: `${c.value} (${c.count.toLocaleString()})` }))]} />
      </div>
      <div className="axp-glossary-index__wt-tools" role="toolbar" aria-label="Glossary picker">
        <span className="fx-muted axp-glossary-index__found">{all.length.toLocaleString()} found{all.length > PICKER_ROWS ? `, first ${PICKER_ROWS} shown` : ''} · {selected.length}/{MAX_TERMS} picked</span>
        <Switch label="Picked only" checked={selectedOnly} onChange={setSelectedOnly} />
        <Button size="sm" icon="check" disabled={!shown.length} onClick={() => { const r = selectAll(selected, shown.map((e) => e.id)); onChange(r.selected); setNote(r.skipped ? `${r.skipped} not added: at most ${MAX_TERMS} per walkthrough.` : ''); }}>Pick all shown</Button>
        <Button size="sm" icon="x" disabled={!selected.length} onClick={() => { onChange([]); setNote(''); }}>Clear</Button>
      </div>
      {note && <p className="fx-muted" role="status">{note}</p>}
      {!shown.length ? <EmptyState compact icon="search">Nothing matches. Try fewer words or another kind.</EmptyState> : (
        <ul className="axp-glossary-index__wt-list" aria-label="Glossary entries">
          {shown.map((e: Entry) => (
            <li key={e.id} className={sel.has(e.id) ? 'is-selected' : ''}>
              <Checkbox checked={sel.has(e.id)} onChange={(on) => onChange(toggleTerm(selected, e.id, on))} disabled={!sel.has(e.id) && selected.length >= MAX_TERMS}
                label={<span><span className="axp-glossary-index__kind" data-kind={e.kind}>{cat.kinds[e.kind] ?? e.kind}</span> <strong>{e.term}</strong> <span className="fx-muted">{e.summary}</span></span>} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function PickedOrder({ selected, onChange }: { selected: string[]; onChange: (s: string[]) => void }) {
  const { cat } = useCatalog();
  const byId = useMemo(() => new Map((cat?.entries ?? []).map((e) => [e.id, e])), [cat]);
  if (!selected.length) return <EmptyState compact icon="list">Pick glossary entries on the left: each one becomes a part of the walkthrough, in this order.</EmptyState>;
  return (
    <ol className="axp-glossary-index__wt-order" aria-label="Walkthrough order">
      {selected.map((id, i) => (
        <li key={id}>
          <span className="axp-glossary-index__wt-order-term">{byId.get(id)?.term ?? id}</span>
          <span className="axp-glossary-index__wt-order-tools" role="toolbar" aria-label={`Order of ${byId.get(id)?.term ?? id}`}>
            <IconButton icon="arrow-up" label="Move up" disabled={i === 0} onClick={() => onChange(moveTerm(selected, i, -1))} />
            <IconButton icon="arrow-down" label="Move down" disabled={i === selected.length - 1} onClick={() => onChange(moveTerm(selected, i, 1))} />
            <IconButton icon="x" label="Remove" onClick={() => onChange(selected.filter((x) => x !== id))} />
          </span>
        </li>
      ))}
    </ol>
  );
}

/* ---------------- request + generate ---------------- */

function RequestForm({ selected }: { selected: string[] }) {
  const { ai } = useWalkthroughs();
  const [title, setTitle] = useState('');
  const [prompt, setPrompt] = useState('Run a chain to demonstrate and explain these features.');
  const [audience, setAudience] = useSetting(WT_KEYS.audience, 'investors');
  const [depth, setDepth] = useSetting(WT_KEYS.depth, 'standard');
  const [mode, setMode] = useSetting(WT_KEYS.mode, 'claude');
  const [style, setStyle] = useState('showcase');
  const [tryIt, setTryIt] = useState(true);
  const [brief, setBrief] = useState('');
  const [job, setJob] = useState<Job | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const request = (): Partial<WalkRequest> => ({ terms: selected, title, prompt, audience: audience as WalkRequest['audience'], depth: depth as WalkRequest['depth'], style: style as WalkRequest['style'], mode: mode as WalkRequest['mode'], tryIt });
  const preview = () => { setErr(''); setBusy(true); planWalkthrough(request()).then((p) => setBrief(p.brief), (e: Error) => setErr(e.message)).finally(() => setBusy(false)); };
  const generate = async () => {
    setErr(''); setBusy(true);
    try {
      const j = await startGenerate(request());
      setJob(j);
      const end = await followJob(j.job, setJob);
      if (end.state === 'failed') setErr(end.error ?? 'The chain failed.');
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const running = job?.state === 'running';
  return (
    <section className="fx-stack axp-glossary-index__wt-request" aria-label="Walkthrough request">
      <TextField label="Title" value={title} onChange={setTitle} placeholder="Leave empty to name it after the features" />
      <TextField label="Prompt" rows={4} value={prompt} onChange={setPrompt} hint="What the walkthrough should do with these features. Saved word for word with it." />
      <div className="axp-glossary-index__bar">
        <SelectField label="Audience" value={audience} onChange={setAudience} options={AUDIENCES} />
        <SelectField label="Style" value={style} onChange={setStyle} options={WT_STYLES} />
        <SelectField label="Depth" value={depth} onChange={setDepth} options={WT_DEPTHS} />
      </div>
      <SelectField label="Writer" value={mode} onChange={setMode} options={WT_MODES} hint={mode === 'claude' && !ai ? 'No AI provider is set up (AI assistant): the template writes every part.' : 'Generated now, played later with no model.'} />
      <Switch label="Try it: end every part with a step the viewer does" checked={tryIt} onChange={setTryIt} />
      <div className="axp-glossary-index__wt-tools" role="toolbar" aria-label="Generate walkthrough">
        <Button icon="file" disabled={!selected.length || busy} onClick={preview}>Show brief</Button>
        <Button tone="primary" icon="zap" busy={running} disabled={!selected.length || busy} onClick={() => void generate()}>Generate walkthrough</Button>
        {running && job && <Button size="sm" icon="x" onClick={() => void cancelJob(job.job)}>Cancel</Button>}
      </div>
      {job && (
        <div className="fx-stack axp-glossary-index__wt-job" role="status">
          <p className="fx-muted">
            {job.state === 'running' ? `Writing part ${Math.max(1, job.step)} of ${job.total}${job.doing ? `: ${job.doing}` : ''}…` : job.state === 'done' ? `Saved ${job.result?.name} v${job.result?.version}: ${job.result?.features} parts, ${job.result?.claude} written by Claude.` : `Failed: ${job.error}`}
          </p>
          {job.state === 'done' && job.result && <div className="fx-row"><Button size="sm" tone="primary" icon="play" onClick={() => void playWalkthroughId(job.result!.id)}>Play it</Button></div>}
          {!!job.log.length && <ul className="fx-muted axp-glossary-index__wt-log">{job.log.map((l, i) => <li key={i}>{l}</li>)}</ul>}
        </div>
      )}
      {err && <p className="fx-muted" role="alert">{err}</p>}
      {brief && <details className="axp-glossary-index__wt-brief" open><summary>Brief</summary><Markdown text={brief} compact /></details>}
    </section>
  );
}

/* ---------------- saved walkthroughs ---------------- */

function Versions({ w }: { w: BundleSummary }) {
  const [rows, setRows] = useState<VersionRow[] | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => { versionsOf(w.id).then(setRows, (e: Error) => setErr(e.message)); }, [w.id, w.version]);
  if (err) return <p className="fx-muted">{err}</p>;
  if (!rows) return <LoadingSkeleton rows={2} />;
  return (
    <ul className="axp-glossary-index__wt-versions" aria-label={`Versions of ${w.name}`}>
      {rows.map((v) => (
        <li key={v.version}>
          <strong>v{v.version}</strong> <span className="fx-muted">{new Date(v.at).toLocaleString()} · {v.mode}{v.model ? ` (${v.model})` : ''} · {v.features} parts · {v.note}</span>
          {v.diff && (v.diff.added.length || v.diff.removed.length || v.diff.changed.length) ? <span className="fx-muted"> · {[v.diff.added.length && `+${v.diff.added.join(', ')}`, v.diff.removed.length && `−${v.diff.removed.join(', ')}`, v.diff.changed.length && `${v.diff.changed.length} rewritten`].filter(Boolean).join(' · ')}</span> : null}
          <span className="axp-glossary-index__wt-order-tools" role="toolbar" aria-label={`Version ${v.version}`}>
            <Button size="sm" icon="play" onClick={() => void getBundle(w.id, v.version).then((b) => playBundle(b))}>Play</Button>
            {v.version !== w.version && <Button size="sm" icon="refresh" onClick={() => void restoreVersion(w.id, v.version)}>Restore</Button>}
          </span>
        </li>
      ))}
    </ul>
  );
}

function download(name: string, value: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 1)], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function SavedList({ onReuse }: { onReuse: (terms: string[]) => void }) {
  const { items, loaded, loading, error } = useWalkthroughs();
  const [open, setOpen] = useState('');
  if (!loaded) return loading || !error ? <LoadingSkeleton rows={3} /> : <EmptyState compact icon="info">{error}</EmptyState>;
  if (!items.length) return <EmptyState compact icon="play">No walkthroughs yet. Pick some glossary entries above and Generate one.</EmptyState>;
  return (
    <ul className="axp-glossary-index__wt-saved" aria-label="Saved walkthroughs">
      {items.map((w) => (
        <li key={w.id} className="fx-stack">
          <div className="axp-glossary-index__wt-saved-head">
            <strong>{w.name}</strong> <span className="fx-muted">v{w.version} · {w.features} parts · {w.steps} steps · {w.claude ? `${w.claude} by Claude` : 'template'} · {w.audience} · {new Date(w.updatedAt).toLocaleString()}</span>
          </div>
          {w.prompt && <p className="fx-muted axp-glossary-index__player-meta">“{w.prompt}”</p>}
          <div className="axp-glossary-index__wt-tools" role="toolbar" aria-label={`Walkthrough ${w.name}`}>
            <Button size="sm" tone="primary" icon="play" onClick={() => void playWalkthroughId(w.id)}>Play</Button>
            <Button size="sm" icon="list" onClick={() => setOpen(open === w.id ? '' : w.id)}>Versions ({w.versions})</Button>
            <Button size="sm" icon="edit" onClick={() => void getBundle(w.id).then((b) => onReuse(b.request.terms))}>Pick these again</Button>
            <Button size="sm" icon="download" onClick={() => void exportOf(w.id).then((x) => download(`${w.id}.walkthrough.json`, x))}>Export</Button>
            <Button size="sm" tone="danger" icon="trash" confirm={`Delete ${w.name} and every version of it?`} onClick={() => void deleteWalkthrough(w.id)}>Delete</Button>
          </div>
          {open === w.id && <Versions w={w} />}
        </li>
      ))}
    </ul>
  );
}

/* ---------------- page ---------------- */

export function WalkthroughGeneratorPage() {
  const [selected, setSelected] = useState<string[]>([]);
  useEffect(() => { void loadCatalog(); void loadWalkthroughs(); }, []);
  return (
    <div className="fx-stack axp-glossary-index axp-glossary-index__wt" data-axf-help="view:walkthrough-generator">
      <header className="fx-pagehead">
        <div>
          <p className="fx-eyebrow">Help · investor demos</p>
          <h1>Walkthrough Generator</h1>
          <p className="fx-muted">Pick features from the glossary, say what the walkthrough should do, and Claude writes a guided demo with built-in docs and a try-it step for each. It is saved and versioned, and plays back with no live Claude, here or in the demo sandbox.</p>
        </div>
      </header>
      <div className="axp-glossary-index__wt-grid">
        <Picker selected={selected} onChange={setSelected} />
        <div className="fx-stack">
          <h2 className="axp-glossary-index__h3">Parts, in order</h2>
          <PickedOrder selected={selected} onChange={setSelected} />
          <h2 className="axp-glossary-index__h3">Request</h2>
          <RequestForm selected={selected} />
        </div>
      </div>
      <h2 className="axp-glossary-index__h3">Saved walkthroughs</h2>
      <SavedList onReuse={setSelected} />
    </div>
  );
}
