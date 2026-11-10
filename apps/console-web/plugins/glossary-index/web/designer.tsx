/**
 * Demonstration Designer: every demonstration (generated from a glossary entry or written by hand) and every clip, as
 * assets (demonstration@1, clip@1). Left: the list, searchable. Right: the editor — name, the entry it is about, app,
 * surface, voice, the steps (say, do, target, highlight, wait; reorder, play one), demonstrations chained after it; play
 * against the live UI, save, revert, regenerate, record a clip, delete. The Clips tab lists every generated clip with its
 * source, media, transcript and the auto-tagged keyword set, and registers a new one.
 */
import { useEffect, useMemo, useState } from 'react';
import type { DemoStep, DemonstrationData } from '@console/axf/core';
import { demonstrationSeconds } from '@console/axf/core';
import { Button, Chip, Icon, SelectField, Switch, TabGroup, TextField, useRuntime } from '@console/axf/react';
import { EmptyState, LoadingSkeleton } from '@console/emptyState';
import { filterEntries, type Entry } from './core';
import { APPS, CLIP_KINDS, DEMO_KEYS, SPEEDS, SURFACES, type ClipAsset, type DemoAsset, type Summary, blankDemo, clipFromDemo, deleteAsset, emptyStep, fmtSeconds, generateDemo, getAsset, loadCatalog, loadDemos, moveStep, registerClip, removeAt, replaceAt, saveAsset, useCatalog, useDemoStore } from './demos-core';
import { playAsset, playStep, playWalkthrough } from './player';

/* ---------------- selection shared with the glossary page ("Generate demonstration" lands here) ---------------- */

let wanted: { type: 'demonstration' | 'clip'; id: string } | null = null;
const wantSubs = new Set<() => void>();
export function openInDesigner(type: 'demonstration' | 'clip', id: string) { wanted = { type, id }; wantSubs.forEach((f) => f()); }

function useSetting<T extends string | boolean>(key: string, fallback: T): [T, (v: T) => void] {
  const rt = useRuntime();
  const [, tick] = useState(0);
  useEffect(() => rt.settings.onChange(key, () => tick((t) => t + 1)), [rt, key]);
  const raw = rt.settings.get(key);
  return [(raw === undefined || raw === null || raw === '' ? fallback : raw) as T, (next: T) => rt.settings.set(key, next)];
}

const demoToWalk = (a: DemoAsset) => ({ $axf: 'walkthrough@1' as const, id: a.id, title: a.name, app: a.data.app, steps: a.data.steps.map((s) => ({ say: s.say, do: s.do, target: s.target, highlight: s.highlight })) });

/* ---------------- entry picker (search the glossary) ---------------- */

function EntryPicker({ onPick, label = 'Glossary entry', hint }: { onPick: (e: Entry) => void; label?: string; hint?: string }) {
  const { cat } = useCatalog();
  const [q, setQ] = useState('');
  const hits = useMemo(() => (cat && q.trim() ? filterEntries(cat.entries, { q, kind: '', drafts: true }).slice(0, 12) : []), [cat, q]);
  return (
    <div className="fx-stack axp-glossary-index__picker">
      <TextField label={label} value={q} onChange={setQ} placeholder="Search the glossary and index" hint={hint} />
      {!!hits.length && (
        <ul className="axp-glossary-index__picker-list" aria-label="Matches">
          {hits.map((e) => (
            <li key={e.id}>
              <button type="button" data-fx-row className="axp-glossary-index__picker-row" onClick={() => { onPick(e); setQ(''); }}>
                <span className="axp-glossary-index__kind" data-kind={e.kind}>{cat!.kinds[e.kind] ?? e.kind}</span> <strong>{e.term}</strong> <span className="fx-muted">{e.summary}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ---------------- step editor ---------------- */

function StepEditor({ step, i, count, onChange, onMove, onRemove, onPlay }: { step: DemoStep; i: number; count: number; onChange: (s: DemoStep) => void; onMove: (d: -1 | 1) => void; onRemove: () => void; onPlay: () => void }) {
  return (
    <li className="axp-glossary-index__step">
      <div className="axp-glossary-index__step-head">
        <span className="axp-glossary-index__step-n">{i + 1}</span>
        <TextField label="Title" value={step.title ?? ''} onChange={(v) => onChange({ ...step, title: v })} placeholder="Shown above the words (optional)" />
        <div role="toolbar" aria-label={`Step ${i + 1}`} className="axp-glossary-index__step-tools">
          <Button size="sm" icon="play" onClick={onPlay}>Play</Button>
          <Button size="sm" icon="chevron-up" disabled={i === 0} onClick={() => onMove(-1)}>Up</Button>
          <Button size="sm" icon="chevron-down" disabled={i === count - 1} onClick={() => onMove(1)}>Down</Button>
          <Button size="sm" tone="danger" icon="trash" disabled={count === 1} onClick={onRemove}>Remove</Button>
        </div>
      </div>
      <TextField label="Say" value={step.say} onChange={(v) => onChange({ ...step, say: v })} rows={2} placeholder="What the narrator says" required />
      <div className="axp-glossary-index__step-grid">
        <TextField label="Do" value={step.do} onChange={(v) => onChange({ ...step, do: v })} mono placeholder="nav:builds · settings.open:plugins" hint="A console action, never a URL" />
        <TextField label="Target" value={step.target} onChange={(v) => onChange({ ...step, target: v })} mono placeholder="data-axf-id, view id or selector" hint="What to highlight" />
        <TextField label="Highlight label" value={step.highlight ?? ''} onChange={(v) => onChange({ ...step, highlight: v })} placeholder="Shown on the highlight" />
        <TextField label="Wait (ms)" type="number" value={String(step.wait ?? 0)} onChange={(v) => onChange({ ...step, wait: Math.max(0, Math.min(30000, Number(v) || 0)) })} hint="Pause before the words" />
      </div>
    </li>
  );
}

/* ---------------- demonstration editor ---------------- */

function DemoEditor({ asset, onSaved, onDeleted }: { asset: DemoAsset; onSaved: (a: DemoAsset) => void; onDeleted: () => void }) {
  const { items } = useDemoStore();
  const { cat } = useCatalog();
  const [draft, setDraft] = useState<DemoAsset>(asset);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [chainPick, setChainPick] = useState('');
  const [clipVideo, setClipVideo] = useState('');
  const [clipSeconds, setClipSeconds] = useState('');
  const [showClip, setShowClip] = useState(false);
  useEffect(() => { setDraft(asset); setMsg(''); }, [asset]);
  const d = draft.data;
  const setData = (p: Partial<DemonstrationData>) => setDraft((a) => ({ ...a, data: { ...a.data, ...p } }));
  const dirty = JSON.stringify(draft) !== JSON.stringify(asset);
  const about = d.about ? cat?.entries.find((e) => e.id === d.about) : undefined;
  const run = async (what: string, fn: () => Promise<unknown>) => { setBusy(true); setMsg(''); try { await fn(); } catch (e) { setMsg(`${what}: ${(e as Error).message}`); } finally { setBusy(false); } };
  const others = items.demonstration.filter((s) => s.id !== draft.id && !d.chain.includes(s.id));
  return (
    <article className="fx-stack fx-stack--lg axp-glossary-index__editor" aria-label={`Edit ${draft.name}`}>
      <header className="axp-glossary-index__editor-head">
        <div>
          <p className="fx-eyebrow">Demonstration · {d.steps.length} steps · about {fmtSeconds(demonstrationSeconds(d))}{d.generated?.from === 'glossary' ? ' · generated from the glossary' : ''}{dirty ? ' · unsaved' : ''}</p>
          <h2>{draft.name}</h2>
        </div>
        <div role="toolbar" aria-label="Demonstration actions" className="axp-glossary-index__toolbar">
          <Button tone="primary" icon="play" onClick={() => playWalkthrough(demoToWalk(draft))}>Play</Button>
          <Button icon="save" disabled={!dirty} busy={busy} onClick={() => void run('Save', async () => { const a = await saveAsset<DemonstrationData>('demonstration', draft); onSaved(a); setMsg('Saved.'); })}>Save</Button>
          <Button icon="undo" disabled={!dirty} onClick={() => setDraft(asset)}>Revert</Button>
          {d.about && <Button icon="refresh" busy={busy} confirm="Regenerate this demonstration from its glossary entry? Your edits to the steps are replaced." onClick={() => void run('Regenerate', async () => { const a = await generateDemo(d.about, true); onSaved(a); setMsg('Regenerated from the glossary.'); })}>Regenerate</Button>}
          <Button icon="monitor" onClick={() => setShowClip((v) => !v)}>Record clip…</Button>
          <Button tone="danger" icon="trash" confirm={`Delete the demonstration "${draft.name}"?`} onClick={() => void run('Delete', async () => { await deleteAsset('demonstration', draft.id); onDeleted(); })}>Delete</Button>
        </div>
      </header>
      {msg && <p className="fx-muted" role="status">{msg}</p>}
      {showClip && (
        <section className="fx-card axp-glossary-index__clipform" aria-label="Record a clip">
          <p className="fx-muted">A clip is what the recorder films. Give it the video it made (a path in the data folder or an https URL) and its length; the clip is registered as an asset, auto-tagged with everything this demonstration shows, and dropped into the glossary.</p>
          <div className="axp-glossary-index__step-grid">
            <TextField label="Video" value={clipVideo} onChange={setClipVideo} mono placeholder="clips/my-demo.mp4 or https://…" />
            <TextField label="Seconds" type="number" value={clipSeconds} onChange={setClipSeconds} placeholder={String(Math.round(demonstrationSeconds(d)))} />
          </div>
          <div className="fx-row"><Button tone="primary" icon="monitor" busy={busy} disabled={dirty} onClick={() => void run('Register clip', async () => { const c = await clipFromDemo(draft.id, { video: clipVideo, seconds: Number(clipSeconds) || 0 }); setMsg(`Clip registered: ${c.name} (${c.data.keywords.length} keywords).`); setShowClip(false); })}>Register clip</Button>{dirty && <span className="fx-muted">Save first.</span>}</div>
        </section>
      )}
      <div className="axp-glossary-index__step-grid">
        <TextField label="Name" value={draft.name} onChange={(v) => setDraft((a) => ({ ...a, name: v }))} required />
        <TextField label="Id" value={draft.id} onChange={(v) => setDraft((a) => ({ ...a, id: v.toLowerCase().replace(/[^a-z0-9-]+/g, '-') }))} mono hint="Lowercase, digits and dashes" />
        <SelectField label="App" value={d.app} onChange={(v) => setData({ app: v })} options={APPS} />
        <SelectField label="Runs on" value={d.surface} onChange={(v) => setData({ surface: v as DemonstrationData['surface'] })} options={SURFACES} />
        <SelectField label="Voice speed" value={String(d.voice.speed)} onChange={(v) => setData({ voice: { ...d.voice, speed: Number(v) } })} options={SPEEDS} />
        <TextField label="Narrator voice" value={d.voice.narrator} onChange={(v) => setData({ voice: { ...d.voice, narrator: v } })} placeholder="Browser voice (blank) or a Piper voice id" />
      </div>
      <TextField label="Description" value={draft.description ?? ''} onChange={(v) => setDraft((a) => ({ ...a, description: v }))} rows={2} />
      <section className="fx-stack">
        <h3 className="axp-glossary-index__h3">About</h3>
        {about ? <p className="fx-muted"><span className="axp-glossary-index__kind" data-kind={about.kind}>{cat?.kinds[about.kind]}</span> <strong>{about.term}</strong> — {about.summary} <Button size="sm" icon="x" onClick={() => setData({ about: '' })}>Clear</Button></p> : <EntryPicker label="The glossary entry this demonstrates" onPick={(e) => setData({ about: e.id, entries: [...new Set([e.id, ...d.entries])] })} />}
      </section>
      <section className="fx-stack">
        <div className="axp-glossary-index__editor-head"><h3 className="axp-glossary-index__h3">Steps ({d.steps.length})</h3><Button size="sm" icon="plus" onClick={() => setData({ steps: [...d.steps, emptyStep()] })}>Add step</Button></div>
        <ol className="axp-glossary-index__steps">
          {d.steps.map((s, i) => (
            <StepEditor key={i} step={s} i={i} count={d.steps.length}
              onChange={(n) => setData({ steps: replaceAt(d.steps, i, n) })} onMove={(dir) => setData({ steps: moveStep(d.steps, i, dir) })} onRemove={() => setData({ steps: removeAt(d.steps, i) })}
              onPlay={() => playStep(demoToWalk(draft), i)} />
          ))}
        </ol>
      </section>
      <section className="fx-stack">
        <h3 className="axp-glossary-index__h3">Chained after this one</h3>
        <p className="fx-muted">Demonstrations that play next make this one the start of a tour.</p>
        <div className="fx-row fx-row--wrap">
          {d.chain.map((id) => <Chip key={id}>{items.demonstration.find((s) => s.id === id)?.name ?? id} <button type="button" data-fx-row className="axp-glossary-index__chip-x" aria-label={`Remove ${id} from the chain`} onClick={() => setData({ chain: d.chain.filter((x) => x !== id) })}><Icon name="x" size={10} /></button></Chip>)}
          {!d.chain.length && <span className="fx-muted">None yet.</span>}
        </div>
        <div className="fx-row">
          <SelectField label="Add to the chain" value={chainPick} onChange={setChainPick} empty="Pick a demonstration" options={others.map((s) => ({ value: s.id, label: s.name }))} />
          <Button size="sm" icon="plus" disabled={!chainPick} onClick={() => { setData({ chain: [...d.chain, chainPick] }); setChainPick(''); }}>Add</Button>
        </div>
      </section>
      {!!d.keywords.length && <section className="fx-stack"><h3 className="axp-glossary-index__h3">Keywords ({d.keywords.length})</h3><p className="axp-glossary-index__keywords">{d.keywords.map((k) => <Chip key={k}>{k}</Chip>)}</p></section>}
    </article>
  );
}

/* ---------------- clips ---------------- */

function ClipDetail({ clip, onDeleted }: { clip: ClipAsset; onDeleted: () => void }) {
  const { cat } = useCatalog();
  const d = clip.data;
  return (
    <article className="fx-stack fx-stack--lg axp-glossary-index__editor" aria-label={`About ${clip.name}`}>
      <header className="axp-glossary-index__editor-head">
        <div>
          <p className="fx-eyebrow">Clip · {d.kind} · {fmtSeconds(d.media.seconds)}{d.recorded.at ? ` · recorded ${new Date(d.recorded.at).toLocaleString()}` : ''}</p>
          <h2>{clip.name}</h2>
        </div>
        <div role="toolbar" aria-label="Clip actions" className="axp-glossary-index__toolbar">
          <Button tone="primary" icon="play" disabled={!d.transcript.length} onClick={() => void playAsset('clip', clip.id)}>Play transcript</Button>
          {d.media.video && /^https:/.test(d.media.video) && <Button icon="external" onClick={() => window.open(d.media.video, '_blank', 'noopener')}>Open video</Button>}
          <Button tone="danger" icon="trash" confirm={`Delete the clip "${clip.name}"?`} onClick={() => void deleteAsset('clip', clip.id).then(onDeleted)}>Delete</Button>
        </div>
      </header>
      {clip.description && <p>{clip.description}</p>}
      <dl className="axp-glossary-index__facts">
        <dt>Source</dt><dd>{d.source.kind}{d.source.id ? ` ${d.source.id}` : ''}{d.source.chapter ? ` › ${d.source.chapter}` : ''}</dd>
        {d.media.video && <><dt>Video</dt><dd className="fx-mono">{d.media.video}</dd></>}
        {d.media.poster && <><dt>Poster</dt><dd className="fx-mono">{d.media.poster}</dd></>}
        {d.media.captions && <><dt>Captions</dt><dd className="fx-mono">{d.media.captions}</dd></>}
        {(d.media.width || d.recorded.viewport.width) ? <><dt>Size</dt><dd>{d.media.width || d.recorded.viewport.width} × {d.media.height || d.recorded.viewport.height}</dd></> : null}
        {d.recorded.app && <><dt>Recorded in</dt><dd>{d.recorded.app}{d.recorded.designPackage ? `, look ${d.recorded.designPackage}` : ''}{d.recorded.voice ? `, voice ${d.recorded.voice}` : ''}</dd></>}
        <dt>Id</dt><dd className="fx-mono">clip/{clip.id}</dd>
      </dl>
      {!!d.entries.length && <section><h3 className="axp-glossary-index__h3">Shows</h3><ul className="axp-glossary-index__links">{d.entries.map((id) => { const e = cat?.entries.find((x) => x.id === id); return <li key={id}>{e ? <><strong>{e.term}</strong> <span className="axp-glossary-index__kind" data-kind={e.kind}>{cat?.kinds[e.kind]}</span></> : <span className="fx-mono">{id}</span>}</li>; })}</ul></section>}
      {!!d.transcript.length && <section><h3 className="axp-glossary-index__h3">Transcript</h3><ol className="axp-glossary-index__transcript">{d.transcript.map((t, i) => <li key={i}><span className="fx-mono fx-muted">{fmtSeconds(t.at)}</span> {t.say}</li>)}</ol></section>}
      {!!d.chain.length && <p className="fx-muted">Chained after it: {d.chain.join(', ')}</p>}
      <section><h3 className="axp-glossary-index__h3">Keywords ({d.keywords.length})</h3><p className="axp-glossary-index__keywords">{d.keywords.map((k) => <Chip key={k}>{k}</Chip>)}</p></section>
    </article>
  );
}

function RegisterClipForm({ onDone }: { onDone: (c: ClipAsset) => void }) {
  const { items } = useDemoStore();
  const [kind, setKind] = useState('demo');
  const [sourceKind, setSourceKind] = useState('demonstration');
  const [sourceId, setSourceId] = useState('');
  const [name, setName] = useState('');
  const [video, setVideo] = useState('');
  const [seconds, setSeconds] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const sources = sourceKind === 'demonstration' ? items.demonstration : sourceKind === 'book' ? items.book : [];
  return (
    <section className="fx-card fx-stack" aria-label="Register a clip">
      <p className="fx-muted">Register a clip the recorder (or anything else) made. It becomes a clip asset, auto-tagged from its source and the entries it shows.</p>
      <div className="axp-glossary-index__step-grid">
        <SelectField label="Kind" value={kind} onChange={setKind} options={CLIP_KINDS.map((k) => ({ value: k, label: k }))} />
        <SelectField label="Source" value={sourceKind} onChange={(v) => { setSourceKind(v); setSourceId(''); }} options={[{ value: 'demonstration', label: 'A demonstration' }, { value: 'book', label: 'A book' }, { value: 'manual', label: 'Made by hand' }]} />
        {sourceKind !== 'manual' && <SelectField label="Which one" value={sourceId} onChange={setSourceId} empty="Pick one" options={sources.map((s) => ({ value: s.id, label: s.name }))} />}
        <TextField label="Name" value={name} onChange={setName} placeholder="Shown in the glossary" />
        <TextField label="Video" value={video} onChange={setVideo} mono placeholder="clips/x.mp4 or https://…" />
        <TextField label="Seconds" type="number" value={seconds} onChange={setSeconds} />
      </div>
      <div className="fx-row">
        <Button tone="primary" icon="plus" busy={busy} disabled={sourceKind !== 'manual' && !sourceId} onClick={() => { setBusy(true); setMsg(''); registerClip({ name, data: { kind, source: { kind: sourceKind, id: sourceId }, media: { video, seconds: Number(seconds) || 0 }, recorded: { at: new Date().toISOString(), app: 'console' } } }).then((c) => { setMsg(`Registered ${c.name} with ${c.data.keywords.length} keywords.`); onDone(c); }, (e: Error) => setMsg(e.message)).finally(() => setBusy(false)); }}>Register</Button>
        {msg && <span className="fx-muted" role="status">{msg}</span>}
      </div>
    </section>
  );
}

/* ---------------- the page ---------------- */

export function DesignerPage() {
  const { items, loaded, loading, error } = useDemoStore();
  const rt = useRuntime();
  const [tab, setTab] = useSetting<'demonstration' | 'clip'>(DEMO_KEYS.designerTab, 'demonstration');
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<{ type: 'demonstration' | 'clip'; id: string } | null>(null);
  const [asset, setAsset] = useState<DemoAsset | ClipAsset | null>(null);
  const [mode, setMode] = useState<'edit' | 'generate' | 'register'>('edit');
  const [msg, setMsg] = useState('');
  const [onlyGenerated, setOnlyGenerated] = useState(false);
  useEffect(() => { void loadDemos(); void loadCatalog(); }, []);
  useEffect(() => {
    const take = () => { if (wanted) { setTab(wanted.type); setSelected(wanted); setMode('edit'); wanted = null; } };
    take(); wantSubs.add(take); return () => { wantSubs.delete(take); };
  }, [setTab]);
  useEffect(() => {
    if (!selected) { setAsset(null); return; }
    let live = true;
    getAsset<DemonstrationData>(selected.type, selected.id).then((a) => { if (live) setAsset(a as DemoAsset | ClipAsset); }, (e: Error) => { if (live) { setMsg(e.message); setAsset(null); } });
    return () => { live = false; };
  }, [selected]);
  const list: Summary[] = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return items[tab].filter((s) => (!onlyGenerated || s.generated === 'glossary') && words.every((w) => `${s.name} ${s.description} ${s.about ?? ''} ${s.id} ${(s.entries ?? []).join(' ')}`.toLowerCase().includes(w)));
  }, [items, tab, q, onlyGenerated]);
  const pick = (type: 'demonstration' | 'clip', id: string) => { setSelected({ type, id }); setMode('edit'); setMsg(''); };
  const newBlank = () => { const a = blankDemo(`New demonstration ${items.demonstration.length + 1}`); setSelected(null); setAsset(a); setMode('edit'); };

  return (
    <div className="fx-stack fx-stack--lg axp-glossary-index">
      <header className="fx-pagehead">
        <div>
          <p className="fx-eyebrow">Help · demonstrations{loaded ? ` · ${items.demonstration.length} demonstrations · ${items.clip.length} clips` : ''}</p>
          <h1>Demonstration Designer</h1>
          <p className="fx-muted">Generate a demonstration from any glossary entry, edit its steps, narration, highlights and actions, play it against the live UI or the preview, chain demonstrations into tours, and keep every recorded clip as a tagged asset.</p>
        </div>
      </header>
      <TabGroup<'demonstration' | 'clip'> id="glossary.designer" label="Designer views" value={tab} onChange={(v) => { setTab(v); setSelected(null); setAsset(null); setMode('edit'); }}
        tabs={[{ value: 'demonstration', label: 'Demonstrations', icon: 'play' }, { value: 'clip', label: 'Clips', icon: 'monitor' }]}
        extra={<span className="fx-muted axp-glossary-index__found">{list.length.toLocaleString()} shown</span>}>
        {error ? <EmptyState icon="alert" action={{ label: 'Try again', icon: 'refresh', onClick: () => void loadDemos(true) }}>{error}</EmptyState>
          : !loaded && loading ? <LoadingSkeleton rows={6} label="Loading demonstrations" />
          : (
            <div className="axp-glossary-index__designer">
              <aside className="axp-glossary-index__list" aria-label={tab === 'clip' ? 'Clips' : 'Demonstrations'}>
                <div role="toolbar" aria-label={tab === 'clip' ? 'Clip list tools' : 'Demonstration list tools'} className="axp-glossary-index__toolbar">
                  {tab === 'demonstration' ? <><Button size="sm" tone="primary" icon="sparkles" onClick={() => { setMode('generate'); setSelected(null); setAsset(null); }}>Generate from an entry</Button><Button size="sm" icon="plus" onClick={newBlank}>Blank</Button></>
                    : <Button size="sm" tone="primary" icon="plus" onClick={() => { setMode('register'); setSelected(null); setAsset(null); }}>Register a clip</Button>}
                  <Button size="sm" icon="refresh" onClick={() => void loadDemos(true)}>Refresh</Button>
                </div>
                <TextField label="Search" value={q} onChange={setQ} placeholder={tab === 'clip' ? 'Name, source, entries' : 'Name, entry, id'} />
                {tab === 'demonstration' && <Switch label="Only generated" checked={onlyGenerated} onChange={setOnlyGenerated} />}
                {!list.length ? <EmptyState compact icon="search">{items[tab].length ? 'Nothing matches.' : tab === 'clip' ? 'No clips yet. Record a demonstration, or register one here.' : 'No demonstrations yet. Generate one from any glossary entry.'}</EmptyState>
                  : (
                    <ul className="axp-glossary-index__rows" aria-label={tab === 'clip' ? 'Clips' : 'Demonstrations'}>
                      {list.map((s) => (
                        <li key={s.id} className={`axp-glossary-index__row${selected?.id === s.id && selected.type === tab ? ' is-selected' : ''}`}>
                          <button type="button" data-fx-row className="axp-glossary-index__row-btn" onClick={() => pick(tab, s.id)}>
                            <strong>{s.name}</strong>
                            <span className="fx-muted">{tab === 'clip' ? `${s.kind} · ${fmtSeconds(s.seconds ?? 0)} · ${s.keywords} keywords` : `${s.steps} steps · ${fmtSeconds(s.seconds ?? 0)}${s.generated === 'glossary' ? ' · generated' : ''}${s.chain?.length ? ` · +${s.chain.length} chained` : ''}`}</span>
                          </button>
                          <Button size="sm" icon="play" onClick={() => void playAsset(tab, s.id)}>Play</Button>
                        </li>
                      ))}
                    </ul>
                  )}
              </aside>
              <section className="axp-glossary-index__main">
                {msg && <p className="fx-muted" role="status">{msg}</p>}
                {mode === 'generate' ? (
                  <div className="fx-card fx-stack">
                    <h2 className="axp-glossary-index__h3">Generate a demonstration</h2>
                    <p className="fx-muted">Pick any glossary or index entry. Its demonstration is written from the entry's own words, where it appears, its API and its links — no model, no tokens — and saved as an asset you can edit and play.</p>
                    <EntryPicker onPick={(e) => { generateDemo(e.id, true).then((a) => { setSelected({ type: 'demonstration', id: a.id }); setMode('edit'); setMsg(`Generated ${a.name}.`); }, (err: Error) => setMsg(err.message)); }} />
                  </div>
                ) : mode === 'register' ? <RegisterClipForm onDone={(c) => { setSelected({ type: 'clip', id: c.id }); setMode('edit'); }} />
                : !asset ? <EmptyState icon={tab === 'clip' ? 'monitor' : 'play'}>{tab === 'clip' ? 'Pick a clip to see its source, media, transcript and keywords.' : 'Pick a demonstration to edit it, or generate one from any glossary entry.'}</EmptyState>
                : asset.type === 'clip' ? <ClipDetail clip={asset as ClipAsset} onDeleted={() => { setSelected(null); setAsset(null); }} />
                : <DemoEditor asset={asset as DemoAsset} onSaved={(a) => { setAsset(a); setSelected({ type: 'demonstration', id: a.id }); }} onDeleted={() => { setSelected(null); setAsset(null); }} />}
              </section>
            </div>
          )}
      </TabGroup>
      <p className="fx-muted axp-glossary-index__note"><Icon name="info" size={12} /> Voice: say "play the demonstration of …" to AmberX, or use the console actions demo.play, demo.next, demo.prev and demo.stop. Settings: <button type="button" data-fx-row className="axp-glossary-index__link" onClick={() => rt.dispatch('settings.open:glossary-index')}>Glossary &amp; Index</button>.</p>
    </div>
  );
}
