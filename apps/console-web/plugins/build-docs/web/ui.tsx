/**
 * Build docs — the dialogs (Create documentation, Create walkthrough video, Approve the script) and the Docs & videos
 * page (every job: progress, cancel, re-run with tweaks, the video, the docs PR). Framework controls only.
 */
import { useEffect, useMemo, useState } from 'react';
import { Button, Checkbox, Chip, Icon, IconButton, Markdown, Meter, Note, Section, Segmented, SelectField, Slider, Switch, TextField, useRuntime } from '@console/axf/react';
import {
  ACTIVE, FINAL, STATE_LABEL, approve, cancel, createDocs, createVideo, documentable, download, editScript, featuresFor, fileBlob, getJob, getState,
  loadIndex, loadJobs, loadOptions, parseTarget, removeJob, rerun, setFocus, targetKey, useStore, watch, VIEW,
  type BuildRef, type Job, type Script, type Target,
} from './store';

const fmtLength = (s: number) => (s < 60 ? `${s} s` : s % 60 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${s / 60} min`);
const when = (iso: string) => { const t = Date.parse(iso); return Number.isFinite(t) ? new Date(t).toLocaleString() : ''; };
const shortTitle = (b?: BuildRef) => (b ? (b.title.split(/\s*(?::|—| - |\(|;)\s*/)[0] || b.id).slice(0, 60) : '');
const errText = (e: unknown) => (e as Error)?.message ?? String(e);

/** Targets handed to a dialog: `{ targets: [...] }`, or `{ arg: 'a,b/s1' }` from an action. */
export function targetsFrom(props: Record<string, unknown>): Target[] {
  const list = Array.isArray(props.targets) ? props.targets.map(String) : typeof props.arg === 'string' ? decodeURIComponent(props.arg).split(',') : [];
  return list.map(parseTarget).filter((t): t is Target => !!t);
}

/* ---------------- the build picker (multi-select) ---------------- */

function TargetPicker({ targets, onChange }: { targets: Target[]; onChange: (t: Target[]) => void }) {
  const s = useStore();
  const [open, setOpen] = useState(targets.length === 0);
  const [q, setQ] = useState('');
  useEffect(() => { if (!s.loaded) void loadIndex(); }, [s.loaded]);
  const shown = useMemo(() => s.builds.filter((b) => documentable(b) && (!q || `${b.id} ${b.title}`.toLowerCase().includes(q.toLowerCase()))).slice(0, 60), [s.builds, q]);
  const has = (t: Target) => targets.some((x) => targetKey(x) === targetKey(t));
  const toggle = (t: Target) => onChange(has(t) ? targets.filter((x) => targetKey(x) !== targetKey(t)) : [...targets, t]);
  return (
    <Section title={`What it covers (${targets.length})`} aside={<Button size="sm" icon={open ? 'chevron-up' : 'plus'} onClick={() => setOpen(!open)}>{open ? 'Done' : 'Add builds or steps'}</Button>}>
      <div className="fx-row fx-row--wrap axp-build-docs__chips">
        {targets.map((t) => (
          <span key={targetKey(t)} className="axp-build-docs__chip">
            <Chip tone="accent">{shortTitle(s.builds.find((b) => b.id === t.build)) || t.build}{t.step ? ` · ${t.step}` : ''}</Chip>
            <IconButton icon="x" size={12} label={`Remove ${targetKey(t)}`} onClick={() => toggle(t)} />
          </span>
        ))}
        {!targets.length && <span className="fx-small fx-muted">Pick at least one build or step.</span>}
      </div>
      {open && (
        <div className="axp-build-docs__picker">
          <TextField label="Search built builds" value={q} onChange={setQ} placeholder="Name or id" />
          <ul className="axp-build-docs__pick-list">
            {shown.map((b) => (
              <li key={b.id}>
                <Checkbox label={`${shortTitle(b)} (${b.status || 'steps done'})`} checked={has({ build: b.id, step: '' })} onChange={() => toggle({ build: b.id, step: '' })} />
                {b.steps.some((x) => x.done) && (
                  <details className="axp-build-docs__steps"><summary className="fx-small">Single steps</summary>
                    {b.steps.filter((x) => x.done).map((x) => <Checkbox key={x.id} label={`${x.id} · ${x.text.slice(0, 80)}`} checked={has({ build: b.id, step: x.id })} onChange={() => toggle({ build: b.id, step: x.id })} />)}
                  </details>
                )}
              </li>
            ))}
            {!shown.length && <li className="fx-small fx-muted">{s.loaded ? 'Nothing built matches.' : 'Loading the builds…'}</li>}
          </ul>
        </div>
      )}
    </Section>
  );
}

/* ---------------- Create documentation ---------------- */

export function DocsDialog({ props, close }: { props: Record<string, unknown>; close: () => void }) {
  const rt = useRuntime();
  const s = useStore();
  const init = (props.options as Record<string, unknown>) ?? {};
  const [targets, setTargets] = useState<Target[]>(() => targetsFrom(props));
  const [audience, setAudience] = useState(String(init.audience ?? rt.settings.get('build-docs.audience') ?? 'me'));
  const [depth, setDepth] = useState(String(init.depth ?? rt.settings.get('build-docs.depth') ?? 'standard'));
  const [screenshots, setScreenshots] = useState(init.screenshots !== false);
  const [ai, setAi] = useState(init.ai !== false);
  const [notes, setNotes] = useState(String(init.notes ?? ''));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => { void loadOptions(); }, []);
  const o = s.options;
  const go = async () => {
    setBusy(true); setErr('');
    const options = { audience, depth, screenshots, ai, notes };
    try {
      const j = typeof props.rerun === 'string' ? await rerun(props.rerun, { options, targets: targets.map(targetKey) }) : await createDocs(targets, options);
      rt.toast(`Writing docs for ${j.title}. Follow it in Docs & videos.`, 'success', 'Build docs');
      close(); rt.navigate(VIEW);
    } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };
  return (
    <div className="axp-build-docs__dialog">
      <TargetPicker targets={targets} onChange={setTargets} />
      <Segmented label="Audience" value={audience} onChange={setAudience} options={(o?.audiences ?? [{ id: 'me', label: 'Me', about: '' }, { id: 'developer', label: 'Developer', about: '' }, { id: 'end-user', label: 'End user', about: '' }]).map((a) => ({ value: a.id, label: a.label, title: a.about }))} />
      <Segmented label="Depth" value={depth} onChange={setDepth} options={(o?.depths ?? [{ id: 'brief', label: 'Brief' }, { id: 'standard', label: 'Standard' }, { id: 'deep', label: 'Deep' }]).map((d) => ({ value: d.id, label: d.label }))} />
      <Switch label="Include screenshots (captured automatically)" checked={screenshots} onChange={setScreenshots} />
      <Switch label="Deep mode (AI writes it)" checked={ai} onChange={setAi} hint="Off, or no AI provider: a template filled from the brief, steps, report and diff." />
      <TextField label="Anything special to cover" value={notes} onChange={setNotes} rows={3} placeholder="e.g. the right-click menu and the voice commands" />
      <p className="fx-small fx-muted axp-build-docs__text">Writes Markdown into the plugin's or app's docs/ folder as a pull request through the merge queue, and links it in the build's plan.</p>
      {err && <Note tone="danger">{err}</Note>}
      <div className="fx-row axp-build-docs__foot">
        <Button onClick={close}>Cancel</Button>
        <Button tone="primary" icon="file" busy={busy} disabled={!targets.length} onClick={() => void go()}>Create documentation</Button>
      </div>
    </div>
  );
}

/* ---------------- Create walkthrough video ---------------- */

export function VideoDialog({ props, close }: { props: Record<string, unknown>; close: () => void }) {
  const rt = useRuntime();
  const s = useStore();
  const init = (props.options as Record<string, unknown>) ?? {};
  const setting = (k: string, d: unknown) => init[k] ?? rt.settings.get(`build-docs.${k}`) ?? d;
  const [targets, setTargets] = useState<Target[]>(() => targetsFrom(props));
  const [length, setLength] = useState(Number(setting('length', 60)) || 60);
  const [custom, setCustom] = useState(false);
  const [focus, setFocusText] = useState(String(init.focus ?? ''));
  const [features, setFeatures] = useState<string[]>(Array.isArray(init.features) ? init.features.map(String) : []);
  const [choices, setChoices] = useState<{ id: string; label: string; group: string }[]>([]);
  const [viewport, setViewport] = useState(String(setting('viewport', 'desktop')));
  const [theme, setTheme] = useState(String(init.theme ?? ''));
  const [layout, setLayout] = useState(String(init.layout ?? ''));
  const [narration, setNarration] = useState(setting('narration', true) !== false);
  const [voice, setVoice] = useState(String(setting('voice', 'en_US-kristin-medium')));
  const [captions, setCaptions] = useState(setting('captions', true) !== false);
  const [speed, setSpeed] = useState(Number(init.speed ?? 1) || 1);
  const [intro, setIntro] = useState(init.intro !== false);
  const [outro, setOutro] = useState(init.outro !== false);
  const [ai, setAi] = useState(init.ai !== false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => { void loadOptions(); }, []);
  const first = targets[0] ? targetKey(targets[0]) : '';
  useEffect(() => { let live = true; if (targets[0]) void featuresFor(targets[0]).then((f) => { if (live) setChoices(f); }); else setChoices([]); return () => { live = false; }; }, [first]);
  const o = s.options;
  const lengths = o?.lengths ?? [{ id: 30, label: '30 s' }, { id: 60, label: '1 min' }, { id: 120, label: '2 min' }, { id: 300, label: '5 min' }];
  const preset = !custom && lengths.some((l) => l.id === length) ? String(length) : 'custom';
  const go = async () => {
    setBusy(true); setErr('');
    const options = { length, focus, features, viewport, theme, layout, narration, voice, captions, speed, intro, outro, ai };
    try {
      const j = typeof props.rerun === 'string' ? await rerun(props.rerun, { options, targets: targets.map(targetKey) }) : await createVideo(targets, options);
      close();
      rt.openDialog('build-docs.script', { id: j.id });
    } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };
  const groups = [...new Set(choices.map((c) => c.group))];
  return (
    <div className="axp-build-docs__dialog">
      <TargetPicker targets={targets} onChange={setTargets} />
      <Section title="Length">
        <Segmented label="Length" value={preset} onChange={(v) => { if (v === 'custom') setCustom(true); else { setCustom(false); setLength(Number(v)); } }}
          options={[...lengths.map((l) => ({ value: String(l.id), label: l.label })), { value: 'custom', label: 'Custom' }]} />
        {preset === 'custom' && <TextField label="Seconds" type="number" value={String(length)} onChange={(v) => setLength(Math.max(o?.lengthRange.min ?? 15, Math.min(o?.lengthRange.max ?? 1800, Math.round(Number(v) || 0))))} hint={`${fmtLength(length)} (${o?.lengthRange.min ?? 15} s to ${fmtLength(o?.lengthRange.max ?? 1800)})`} />}
      </Section>
      <Section title="Focus">
        <TextField label="Special stuff to cover" value={focus} onChange={setFocusText} rows={3} placeholder="e.g. show the right-click menu, then the settings tab" />
        {groups.map((g) => (
          <div key={g} className="axp-build-docs__features" role="group" aria-label={g}>
            <span className="fx-small fx-muted">{g}</span>
            {choices.filter((c) => c.group === g).map((c) => <Checkbox key={c.id} label={c.label} checked={features.includes(c.id)} onChange={(v) => setFeatures(v ? [...features, c.id] : features.filter((x) => x !== c.id))} />)}
          </div>
        ))}
      </Section>
      <Section title="Picture">
        <Segmented label="Viewport" value={viewport} onChange={setViewport} options={[{ value: 'desktop', label: 'Desktop', icon: 'monitor' }, { value: 'phone', label: 'Phone', icon: 'smartphone' }]} />
        <SelectField label="Theme (design package)" value={theme} onChange={setTheme} options={[{ value: '', label: 'The current look' }, ...(o?.themes ?? []).map((t) => ({ value: t.id, label: t.label }))]} hint="Recorded in the recorder's browser only: the shared look on axHub doesn't change." />
        <SelectField label="Layout" value={layout} onChange={setLayout} options={[{ value: '', label: "The theme's layout" }, ...(o?.layouts ?? []).map((t) => ({ value: t.id, label: t.label }))]} />
        <Switch label="Intro card" checked={intro} onChange={setIntro} />
        <Switch label="Outro card" checked={outro} onChange={setOutro} />
      </Section>
      <Section title="Sound and captions">
        <Switch label="Narration" checked={narration} onChange={setNarration} />
        {narration && <SelectField label="Voice" value={voice} onChange={setVoice} options={(o?.voices ?? [voice]).map((v) => ({ value: v, label: v.replace(/-medium$/, '').replace(/_/g, ' ') }))} />}
        <Switch label="Captions burned in" checked={captions} onChange={setCaptions} hint="The .vtt captions file is saved either way." />
        <Slider label="Speed" value={speed} onChange={setSpeed} min={o?.speedRange.min ?? 0.75} max={o?.speedRange.max ?? 1.3} step={0.05} unit="×" />
      </Section>
      <Switch label="Deep mode (AI plans the script)" checked={ai} onChange={setAi} hint="Off, or no AI provider: the build's screens in order." />
      <p className="fx-small fx-muted axp-build-docs__text">You see the click-path script first. Approving it records a real browser session on the VPS (one veto call, then a heavy slot).</p>
      {err && <Note tone="danger">{err}</Note>}
      <div className="fx-row axp-build-docs__foot">
        <Button onClick={close}>Cancel</Button>
        <Button tone="primary" icon="play" busy={busy} disabled={!targets.length} onClick={() => void go()}>Plan the script</Button>
      </div>
    </div>
  );
}

/* ---------------- Approve the script ---------------- */

export function ScriptDialog({ props, close }: { props: Record<string, unknown>; close: () => void }) {
  const rt = useRuntime();
  const id = String(props.id ?? props.arg ?? '');
  const s = useStore();
  const job = s.jobs.find((j) => j.id === id);
  const [script, setScript] = useState<Script | null>(null);
  const [lines, setLines] = useState<Record<string, string>>({});
  const [drop, setDrop] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => watch(), []);
  useEffect(() => { void getJob(id).then((r) => setScript(r.script)).catch((e) => setErr(errText(e))); }, [id, job?.state]);
  if (!job) return <div className="axp-build-docs__dialog"><p className="fx-muted">Loading the job…</p></div>;
  const ready = job.state === 'script-ready';
  const edited = Object.keys(lines).length > 0 || drop.length > 0;
  const words = script ? script.chapters.reduce((n, c) => n + c.scenes.reduce((m, x, i) => m + (drop.includes(`${c.id}-${i}`) ? 0 : (lines[`${c.id}-${i}`] ?? x.say).split(/\s+/).length), 0), 0) : 0;
  const secs = Math.round(words / (2.5 * (Number(job.options.speed) || 1)));
  const save = async () => { setBusy(true); setErr(''); try { setScript(await editScript(id, { lines, remove: drop })); setLines({}); setDrop([]); } catch (e) { setErr(errText(e)); } finally { setBusy(false); } };
  const ok = async () => {
    setBusy(true); setErr('');
    try { if (edited) await editScript(id, { lines, remove: drop }); const m = await approve(id); rt.toast(m || 'Approved: recording on the VPS.', 'success', 'Build docs'); close(); rt.navigate(VIEW); } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };
  return (
    <div className="axp-build-docs__dialog">
      <div className="fx-row fx-row--wrap"><Chip tone={job.state === 'failed' ? 'danger' : ready ? 'accent' : undefined}>{STATE_LABEL[job.state] ?? job.state}</Chip>{job.mode && <Chip>{job.mode === 'ai' ? 'AI script' : "From the build's screens"}</Chip>}<span className="fx-small fx-muted">{job.title}</span></div>
      {!FINAL.includes(job.state) && !ready && <Meter value={job.progress} active label={job.message || 'Working'} />}
      {job.message && <p className="fx-small axp-build-docs__text">{job.message}</p>}
      {script && (
        <>
          <p className="fx-small fx-muted axp-build-docs__text">About {fmtLength(Math.max(secs, 1))} of narration, {script.chapters.length} parts. Edit any line or leave scenes out, then approve.</p>
          <ol className="axp-build-docs__script">
            {script.chapters.map((c) => (
              <li key={c.id}>
                <strong>{c.title}</strong>
                <ol>
                  {c.scenes.map((x, i) => {
                    const k = `${c.id}-${i}`;
                    return (
                      <li key={k} className={drop.includes(k) ? 'is-dropped' : ''}>
                        <TextField label={`Line ${i + 1}`} value={lines[k] ?? x.say} onChange={(v) => setLines({ ...lines, [k]: v })} rows={2} disabled={!ready} />
                        <span className="fx-small fx-muted">Shows: {x.do.map((m) => [m.op, m.label ?? m.name ?? m.title ?? m.id ?? ''].filter(Boolean).join(' ')).join(' → ') || 'the page as it is'}</span>
                        {ready && <Checkbox label="Leave this scene out" checked={drop.includes(k)} onChange={(v) => setDrop(v ? [...drop, k] : drop.filter((d) => d !== k))} />}
                      </li>
                    );
                  })}
                </ol>
              </li>
            ))}
          </ol>
        </>
      )}
      {err && <Note tone="danger">{err}</Note>}
      <div className="fx-row fx-row--wrap axp-build-docs__foot">
        <Button onClick={close}>Close</Button>
        {!FINAL.includes(job.state) && <Button tone="danger" icon="x" confirm="Cancel this video?" onClick={() => void cancel(id)}>Cancel job</Button>}
        {ready && edited && <Button icon="save" busy={busy} onClick={() => void save()}>Save edits</Button>}
        {(ready || job.state === 'failed') && <Button icon="refresh" onClick={() => { close(); rt.openDialog('build-docs.video', { targets: job.targets.map(targetKey), options: job.options, rerun: job.id }); }}>Change options</Button>}
        {ready && <Button tone="primary" icon="play" busy={busy} onClick={() => void ok()}>Approve and record</Button>}
      </div>
    </div>
  );
}

/* ---------------- Docs & videos page ---------------- */

function VideoPlayer({ job }: { job: Job }) {
  const [url, setUrl] = useState('');
  const [err, setErr] = useState('');
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  if (!job.outputs.video) return null;
  return url
    ? <video className="axp-build-docs__video" controls src={url} aria-label={`Walkthrough video: ${job.title}`} />
    : <div className="fx-row fx-row--wrap">
        <Button icon="play" onClick={() => void fileBlob(job.id, job.outputs.video).then(setUrl).catch((e) => setErr(errText(e)))}>Play the video{job.outputs.duration ? ` (${fmtLength(job.outputs.duration)})` : ''}</Button>
        <Button icon="download" onClick={() => void download(job.id, job.outputs.video, `${job.id}.mp4`)}>Download MP4</Button>
        {job.outputs.captions && <Button icon="download" onClick={() => void download(job.id, job.outputs.captions, `${job.id}.vtt`)}>Captions</Button>}
        {job.outputs.transcript && <Button icon="file" onClick={() => void download(job.id, job.outputs.transcript, `${job.id}-transcript.md`)}>Transcript</Button>}
        {err && <span className="fx-small fx-muted">{err}</span>}
      </div>;
}

function DocsPreview({ job }: { job: Job }) {
  const [docs, setDocs] = useState<{ key: string; path: string; text: string }[] | null>(null);
  if (!job.outputs.docs.length) return null;
  return (
    <div className="axp-build-docs__docs">
      {job.outputs.pr && <a className="fx-btn fx-btn--neutral axp-build-docs__link" href={job.outputs.pr.url} target="_blank" rel="noopener noreferrer"><Icon name="github" size={14} /> PR {job.outputs.pr.number}</a>}
      {job.outputs.docs.map((d) => <code key={d.path} className="fx-small">{d.path}</code>)}
      {docs ? docs.map((d) => <details key={d.key} open><summary className="fx-small">{d.path}</summary><Markdown text={d.text} compact /></details>)
        : <Button size="sm" icon="eye" onClick={() => void getJob(job.id).then((r) => setDocs(r.docs))}>Read the docs here</Button>}
    </div>
  );
}

function JobRow({ job, open, onToggle }: { job: Job; open: boolean; onToggle: () => void }) {
  const rt = useRuntime();
  const running = ACTIVE.includes(job.state);
  const tone = job.state === 'done' ? 'success' : job.state === 'failed' ? 'danger' : job.state === 'script-ready' ? 'accent' : job.state === 'cancelled' ? 'warning' : undefined;
  const again = () => rt.openDialog(job.kind === 'video' ? 'build-docs.video' : 'build-docs.docs', { targets: job.targets.map(targetKey), options: job.options, rerun: job.id });
  return (
    <li className={`axp-build-docs__job is-${job.state}`} data-fx-ctx-target="axf-build-docs-job" data-fx-ctx-payload={job.id}>
      <button type="button" data-fx-row className="axp-build-docs__head" aria-expanded={open} onClick={onToggle}>
        <Icon name={job.kind === 'video' ? 'play' : 'file'} size={14} />
        <span className="axp-build-docs__title">{job.title}</span>
        <Chip tone={tone}>{STATE_LABEL[job.state] ?? job.state}</Chip>
        <span className="fx-small fx-muted">{when(job.createdAt)}</span>
      </button>
      {running && <Meter value={job.progress} active small label={job.message || STATE_LABEL[job.state]} />}
      {job.message && <p className="fx-small axp-build-docs__text">{job.message}</p>}
      {job.state === 'done' && job.kind === 'video' && <VideoPlayer job={job} />}
      {job.state === 'done' && job.kind === 'docs' && <DocsPreview job={job} />}
      <div className="fx-row fx-row--wrap">
        {job.state === 'script-ready' && <Button size="sm" tone="primary" icon="eye" onClick={() => rt.openDialog('build-docs.script', { id: job.id })}>Review the script</Button>}
        {!FINAL.includes(job.state) && <Button size="sm" tone="danger" icon="x" confirm="Cancel this job?" onClick={() => void cancel(job.id)}>Cancel</Button>}
        {FINAL.includes(job.state) && <Button size="sm" icon="refresh" onClick={again}>Re-run with tweaks</Button>}
        {FINAL.includes(job.state) && <Button size="sm" icon="trash" confirm="Delete this job and its files?" onClick={() => void removeJob(job.id)}>Delete</Button>}
      </div>
      {open && (
        <div className="axp-build-docs__body">
          <p className="fx-small fx-muted axp-build-docs__text">
            {job.targets.map(targetKey).join(', ')} · {job.kind === 'video' ? `${fmtLength(Number(job.options.length) || 60)}, ${job.options.viewport}, ${job.options.narration ? 'narrated' : 'silent'}${job.options.captions ? ', captions' : ''}` : `${job.options.audience}, ${job.options.depth}`}
            {job.mode ? ` · ${job.mode === 'ai' ? 'AI' : 'template'}` : ''}{job.by ? ` · by ${job.by}` : ''}{job.rerunOf ? ` · re-run of ${job.rerunOf}` : ''}
            {job.outputs.plans.length ? ` · in plan ${job.outputs.plans.join(', ')}` : ''}
          </p>
          {job.options.focus || job.options.notes ? <p className="fx-small axp-build-docs__text"><strong>Covered on request:</strong> {String(job.options.focus || job.options.notes)}</p> : null}
          <ol className="axp-build-docs__log">{job.log.slice(-12).map((l, i) => <li key={i} className="fx-small"><span className="fx-muted">{when(l.at)}</span> {l.text}</li>)}</ol>
          {job.kind === 'video' && <Button size="sm" icon="terminal" onClick={() => void download(job.id, 'run.log', `${job.id}-run.log`)}>Recorder log</Button>}
        </div>
      )}
    </li>
  );
}

export function JobsPage() {
  const s = useStore();
  const rt = useRuntime();
  const [kind, setKind] = useState<'all' | 'docs' | 'video'>('all');
  const [open, setOpen] = useState(s.focus);
  useEffect(() => { void loadJobs(); void loadIndex(); return watch(); }, []);
  useEffect(() => { if (s.focus) { setOpen(s.focus); setFocus(''); } }, [s.focus]);
  const jobs = s.jobs.filter((j) => kind === 'all' || j.kind === kind);
  return (
    <div className="fx-page axp-build-docs">
      <header className="fx-pagehead">
        <div>
          <p className="fx-eyebrow">Builds · docs and walkthroughs{s.jobs.length ? ` · ${s.jobs.length}` : ''}</p>
          <h1>Docs & videos</h1>
          <p className="fx-muted">Right-click any built build or step (Build manager, Builds, Plan Studio, Codebase changes) → Create documentation or Create walkthrough video. Results attach to the build's plan.</p>
        </div>
      </header>
      <div className="fx-row fx-row--wrap axp-build-docs__bar" role="toolbar" aria-label="Docs and videos">
        <Segmented label="Show" value={kind} onChange={setKind} options={[{ value: 'all', label: 'All' }, { value: 'docs', label: 'Docs', icon: 'file' }, { value: 'video', label: 'Videos', icon: 'play' }]} />
        <Button icon="file" onClick={() => rt.openDialog('build-docs.docs', {})}>New docs</Button>
        <Button icon="play" onClick={() => rt.openDialog('build-docs.video', {})}>New video</Button>
        <Button icon="refresh" onClick={() => { void loadJobs(); void loadIndex(); }}>Refresh</Button>
      </div>
      {s.error && <Note tone="warning">{s.error}</Note>}
      {!jobs.length ? <div className="fx-empty">{s.jobs.length ? 'Nothing of that kind yet.' : 'No docs or videos yet.'}</div>
        : <ul className="axp-build-docs__jobs">{jobs.map((j) => <JobRow key={j.id} job={j} open={open === j.id} onToggle={() => setOpen(open === j.id ? '' : j.id)} />)}</ul>}
    </div>
  );
}

/** For the settings tab: what's running now. */
export function SettingsSummary() {
  const s = useStore();
  useEffect(() => { void loadJobs(); }, []);
  const running = s.jobs.filter((j) => ACTIVE.includes(j.state) || j.state === 'script-ready');
  return <p className="fx-small axp-build-docs__text">{running.length ? `${running.length} job${running.length === 1 ? '' : 's'} in progress or waiting for you.` : 'Nothing running.'} Jobs and videos are kept in {getState().options ? 'the VPS data volume' : 'the plugin data folder'}, not the repo.</p>;
}
