/**
 * The Demonstration Designer page. Main flow = three picks and one button: what to show (any plugin, screen or UI
 * element from the live registry), how long (minutes), which narrator voice; Generate writes the pitch script and
 * plays it on the real console. Then: tweak the words, play again, export the video, copy the share link, chain
 * demos into a tour. Advanced work (the step timeline, record by doing) is folded away at the bottom.
 */
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Button, Chip, Container, Icon, Note, Segmented, SelectField, TextField, useRuntime } from '@console/axf/react';
import { EmptyState, LoadingSkeleton } from '@console/emptyState';
import * as E from '../engine.mjs';
import type { PitchStep, Topic } from '../engine.mjs';
import stacked from '../assets/settings/demonstration-designer-page-stacked.json';
import threeUp from '../assets/settings/demonstration-designer-page-three-up.json';
import wide from '../assets/settings/demonstration-designer-page-wide.json';
import { type DemoRecord, type Summary, PAGE_VIEW_KEY, applyScript, deleteDemo, deviceVoices, fmtSeconds, generate, getDemo, loadDemos, loadSettings, loadTopics, saveDemo, setChain, shareOf, startRecording, stopRecording, takeWanted, uploadMedia, useModel, clearRecording } from './model';
import { play, stop, useStage } from './stage';

/** The page layout (a `settings` asset picked in UI Review): stacked, three-up or wide. */
export const PAGE_ASSETS = [stacked, threeUp, wide] as const;
function usePageView(): 'stacked' | 'three-up' | 'wide' {
  const rt = useRuntime();
  const id = useSyncExternalStore((fn) => rt.settings.subscribe(fn), () => String(rt.settings.get(PAGE_VIEW_KEY) ?? ''), () => '');
  return (PAGE_ASSETS.find((a) => a.id === id) ?? stacked).data.view as 'stacked' | 'three-up' | 'wide';
}

const KINDS = [{ value: 'all', label: 'All' }, { value: 'plugin', label: 'Plugins' }, { value: 'screen', label: 'Screens' }, { value: 'element', label: 'Elements' }] as const;
type KindPick = (typeof KINDS)[number]['value'];
const SPEEDS = [{ value: '0.9', label: 'Calm' }, { value: '1', label: 'Normal' }, { value: '1.15', label: 'Brisk' }] as const;

const toPlayable = (d: DemoRecord) => ({ id: d.id, title: d.name, steps: d.data.steps, cta: d.pitch?.cta, product: d.pitch?.product, narrator: d.data.voice.narrator, speed: d.data.voice.speed });

/* ---------------- pick 1: the topic ---------------- */

function TopicPicker({ topics, value, onPick }: { topics: Topic[]; value: Topic | null; onPick: (t: Topic | null) => void }) {
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<KindPick>('all');
  const hits = useMemo(() => {
    const pool = topics.filter((t) => kind === 'all' || (kind === 'element' ? !['plugin', 'screen'].includes(t.kind) : t.kind === kind));
    if (q.trim()) return E.searchTopics(pool, q, 10);
    return kind === 'element' ? pool.slice(0, 8) : E.featuredTopics(pool, 8);
  }, [topics, q, kind]);
  if (value) {
    return (
      <div className="axp-demonstration-designer__picked" data-fx-row>
        <div className="axp-demonstration-designer__picked-body">
          <p className="fx-eyebrow">{value.kind.replace('-', ' ')}{value.screens.length ? ` · ${value.screens.length} screen${value.screens.length === 1 ? '' : 's'}` : ''}</p>
          <strong>{value.label}</strong>
          {value.description && <p className="fx-muted axp-demonstration-designer__clamp">{E.whatItIs(value.description) || value.description}</p>}
        </div>
        <Button size="sm" icon="x" onClick={() => onPick(null)}>Change</Button>
      </div>
    );
  }
  return (
    <div className="fx-stack">
      <div className="axp-demonstration-designer__pickbar">
        <TextField label="What to show" value={q} onChange={setQ} placeholder="Type a plugin, screen or element name" className="axp-demonstration-designer__search" />
        <Segmented<KindPick> label="Kind of thing to show" size="sm" value={kind} onChange={setKind} options={KINDS.map((k) => ({ value: k.value, label: k.label }))} />
      </div>
      {!topics.length ? <LoadingSkeleton rows={4} label="Loading what can be shown" /> : !hits.length ? <EmptyState compact icon="search">Nothing matches. Try another word, or another kind.</EmptyState> : (
        <ul className="axp-demonstration-designer__rows" aria-label="Things to show">
          {hits.map((t) => (
            <li key={t.id}>
              <button type="button" data-fx-row className="axp-demonstration-designer__row" onClick={() => onPick(t)}>
                <span className="axp-demonstration-designer__kind" data-kind={t.kind}>{t.kind.replace('-', ' ')}</span>
                <strong>{t.label}</strong>
                <span className="fx-muted axp-demonstration-designer__clamp">{E.whatItIs(t.description) || (t.screens[0]?.view ? `The ${t.label} screen.` : '')}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ---------------- the result: play, tweak, export, share, tour ---------------- */

function Result({ demo, onChanged, onDeleted }: { demo: DemoRecord; onChanged: (d: DemoRecord) => void; onDeleted: () => void }) {
  const { settings, demos } = useModel();
  const stage = useStage();
  const [script, setScript] = useState(E.scriptText(demo.data.steps));
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [chainPick, setChainPick] = useState('');
  const [download, setDownload] = useState<{ url: string; name: string } | null>(null);
  useEffect(() => { setScript(E.scriptText(demo.data.steps)); setMsg(null); setDownload(null); }, [demo]);
  const seconds = E.pitchSeconds(demo.data.steps, { ...demo.pitch, speed: demo.data.voice.speed });
  const plan = demo.pitch?.plan;
  const short = plan && plan.targetSeconds - seconds > 20;
  const dirty = script.trim() !== E.scriptText(demo.data.steps).trim();
  const playing = stage.status !== 'idle' && stage.id === demo.id;
  const run = async (what: string, fn: () => Promise<unknown>) => { setBusy(true); setMsg(null); try { await fn(); } catch (e) { setMsg({ text: `${what}: ${(e as Error).message}`, bad: true }); } finally { setBusy(false); } };

  const preview = () => void play(toPlayable(demo), { settings });
  const exportVideo = () => {
    setMsg({ text: 'Pick this tab in the browser’s share dialog; the demo records as it plays and the file is kept when it ends.' });
    void play(toPlayable(demo), {
      settings, record: true,
      onRecordError: (why) => setMsg({ text: `Recording did not start: ${why}. The demo plays without recording.`, bad: true }),
      onDone: (rec) => {
        if (!rec) return;
        const ext = rec.mime.includes('mp4') ? 'mp4' : 'webm';
        setDownload({ url: URL.createObjectURL(rec.blob), name: `${demo.id}.${ext}` });
        void run('Keep the recording', async () => {
          const r = await uploadMedia(demo.id, rec.blob, rec.seconds);
          setMsg({ text: r.mp4 ? `Recording kept as clip ${r.clip} and exported as MP4 (${r.mp4}).` : `Recording kept as clip ${r.clip} (${ext.toUpperCase()}, ${Math.round(r.bytes / 1024)} KB).${r.note ? ` ${r.note}` : ''}` });
        });
      },
    });
  };
  const share = () => void run('Share link', async () => { const s = await shareOf(demo.id); const url = s.url || `${location.origin}${s.path}`; await navigator.clipboard?.writeText(url); setMsg({ text: `Share link copied: ${url}` }); });
  const others = demos.filter((d) => d.id !== demo.id && !demo.data.chain.includes(d.id));
  return (
    <section className="fx-card fx-stack axp-demonstration-designer__result" aria-label={`Pitch: ${demo.name}`}>
      <header className="axp-demonstration-designer__head">
        <div>
          <p className="fx-eyebrow">Your pitch · {demo.data.steps.length} steps · about {fmtSeconds(seconds)}{plan?.screens.length ? ` · ${plan.screens.join(', ')}` : ''}</p>
          <h2>{demo.name}</h2>
        </div>
        <div role="toolbar" aria-label="Pitch actions" className="axp-demonstration-designer__tools">
          {playing ? <Button tone="danger" icon="x" onClick={() => void stop()}>Stop</Button> : <Button tone="primary" icon="play" onClick={preview}>Play</Button>}
          <Button icon="monitor" disabled={playing} onClick={exportVideo}>Export video</Button>
          <Button icon="link" busy={busy} onClick={share}>Copy share link</Button>
          <Button tone="danger" icon="trash" confirm={`Delete the pitch "${demo.name}"?`} onClick={() => void run('Delete', async () => { await deleteDemo(demo.id); onDeleted(); })}>Delete</Button>
        </div>
      </header>
      {playing && <p className="fx-muted" role="status"><Icon name="play" size={12} /> {stage.status === 'intro' ? 'Logo intro' : stage.status === 'outro' ? 'Logo outro' : stage.status === 'paused' ? 'Paused' : `Step ${stage.at + 1} of ${stage.total}`}{stage.recording ? ' · recording' : ''}{stage.caption ? ` · ${stage.caption}` : ''}</p>}
      {short && <Note tone="info">There is about {fmtSeconds(seconds)} of material for a {demo.pitch?.minutes}-minute pitch: pick a bigger topic, chain another demo after it, or add words below.</Note>}
      {msg && <Note tone={msg.bad ? 'danger' : 'info'}>{msg.text}</Note>}
      {download && <p className="fx-muted"><a className="axp-demonstration-designer__link" href={download.url} download={download.name}>Download {download.name}</a></p>}
      <TextField label="Script" value={script} onChange={setScript} rows={10} hint="One block per step: a # Title line, then what the narrator says. Blank line between steps. Actions and highlights stay with their step." />
      <div className="fx-row">
        <Button tone="primary" icon="check" disabled={!dirty} busy={busy} onClick={() => void run('Apply script', async () => { onChanged(await applyScript(demo.id, script)); setMsg({ text: 'Script applied.' }); })}>Apply script</Button>
        <Button icon="undo" disabled={!dirty} onClick={() => setScript(E.scriptText(demo.data.steps))}>Reset words</Button>
      </div>
      <div className="fx-stack">
        <p className="fx-eyebrow">Tour: demos that play after this one</p>
        <div className="fx-row fx-row--wrap">
          {demo.data.chain.map((id) => <Chip key={id}>{demos.find((d) => d.id === id)?.name ?? id} <button type="button" data-fx-row className="axp-demonstration-designer__chip-x" aria-label={`Remove ${id} from the tour`} onClick={() => void run('Tour', async () => { await setChain(demo.id, demo.data.chain.filter((x) => x !== id)); onChanged(await getDemo(demo.id)); })}><Icon name="x" size={10} /></button></Chip>)}
          {!demo.data.chain.length && <span className="fx-muted">None: this pitch stands alone.</span>}
        </div>
        {!!others.length && (
          <div className="fx-row">
            <SelectField label="Add to the tour" value={chainPick} onChange={setChainPick} empty="Pick a saved pitch" options={others.map((d) => ({ value: d.id, label: `${d.name} (${fmtSeconds(d.seconds)})` }))} />
            <Button size="sm" icon="plus" disabled={!chainPick} busy={busy} onClick={() => void run('Tour', async () => { await setChain(demo.id, [...demo.data.chain, chainPick]); setChainPick(''); onChanged(await getDemo(demo.id)); })}>Add to tour</Button>
          </div>
        )}
      </div>
    </section>
  );
}

/* ---------------- advanced: timeline + record by doing ---------------- */

function StepRow({ step, i, count, onChange, onMove, onRemove, onPlay }: { step: PitchStep; i: number; count: number; onChange: (s: PitchStep) => void; onMove: (d: -1 | 1) => void; onRemove: () => void; onPlay: () => void }) {
  return (
    <li className="axp-demonstration-designer__step">
      <div className="axp-demonstration-designer__step-head">
        <span className="axp-demonstration-designer__step-n">{i + 1}</span>
        <TextField label="Title" value={step.title ?? ''} onChange={(v) => onChange({ ...step, title: v })} placeholder="Hook, a screen, a control, the call to action" />
        <div role="toolbar" aria-label={`Step ${i + 1}`} className="axp-demonstration-designer__tools">
          <Button size="sm" icon="play" onClick={onPlay}>Play this step</Button>
          <Button size="sm" icon="chevron-up" disabled={i === 0} onClick={() => onMove(-1)}>Up</Button>
          <Button size="sm" icon="chevron-down" disabled={i === count - 1} onClick={() => onMove(1)}>Down</Button>
          <Button size="sm" tone="danger" icon="trash" disabled={count === 1} onClick={onRemove}>Remove</Button>
        </div>
      </div>
      <TextField label="Say" value={step.say} onChange={(v) => onChange({ ...step, say: v })} rows={2} required />
      <div className="axp-demonstration-designer__grid">
        <TextField label="Do" value={step.do} onChange={(v) => onChange({ ...step, do: v })} mono placeholder="nav:builds · settings.open:plugins" hint="A console action, never a URL" />
        <TextField label="Target" value={step.target} onChange={(v) => onChange({ ...step, target: v })} mono placeholder="text=Generate · a CSS selector" hint="What the spotlight lands on" />
        <TextField label="Highlight label" value={step.highlight ?? ''} onChange={(v) => onChange({ ...step, highlight: v })} />
        <TextField label="Dwell (ms)" type="number" value={String(step.wait ?? 0)} onChange={(v) => onChange({ ...step, wait: Math.max(0, Math.min(30000, Number(v) || 0)) })} hint="Time on the screen before the words" />
      </div>
    </li>
  );
}

function Advanced({ demo, onChanged, onCreated }: { demo: DemoRecord | null; onChanged: (d: DemoRecord) => void; onCreated: (d: DemoRecord) => void }) {
  const rt = useRuntime();
  const { settings, recording, events } = useModel();
  const [draft, setDraft] = useState<PitchStep[]>(demo?.data.steps ?? []);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  useEffect(() => { setDraft(demo?.data.steps ?? []); }, [demo]);
  const dirty = !!demo && JSON.stringify(draft) !== JSON.stringify(demo.data.steps);
  const replaceAt = (i: number, s: PitchStep) => setDraft((l) => l.map((x, k) => (k === i ? s : x)));
  const move = (i: number, d: -1 | 1) => setDraft((l) => { const j = i + d; if (j < 0 || j >= l.length) return l; const out = [...l]; [out[i], out[j]] = [out[j]!, out[i]!]; return out; });
  const save = () => { if (!demo) return; setBusy(true); saveDemo({ ...demo, data: { ...demo.data, steps: draft } }).then((d) => { onChanged(d); setMsg('Timeline saved.'); }, (e: Error) => setMsg(e.message)).finally(() => setBusy(false)); };
  const makeSteps = () => {
    const steps = E.stepsFromRecording(events, { product: settings.script.product });
    if (!steps.length) { setMsg('Nothing was recorded yet: start, then move around the console and tap what you want shown.'); return; }
    setBusy(true);
    const record: DemoRecord = demo
      ? { ...demo, data: { ...demo.data, steps: [...demo.data.steps, ...steps].slice(0, 60) } }
      : { $axf: 'asset@1', type: 'demonstration', id: E.slugify(`recorded-${new Date().toISOString().slice(0, 16)}`, 'recorded'), name: `Recorded walk ${new Date().toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`, version: '1.0.0', description: 'Recorded by doing it in the console.', tags: ['pitch', 'recorded'], data: { about: '', entries: [], app: 'console', surface: 'live', steps, voice: { narrator: settings.narration.voice, speed: settings.narration.speed }, chain: [], keywords: [], generated: { from: 'recorder', at: new Date().toISOString(), build: '' }, editable: true }, pitch: { minutes: Math.max(1, Math.round(E.stepsSeconds(steps) / 60)), wpm: settings.script.wpm, speed: settings.narration.speed, logoIntro: settings.stage.logoIntro, logoOutro: settings.stage.logoOutro, logoSeconds: settings.stage.logoSeconds, product: settings.script.product, cta: settings.script.cta, topic: 'recorded', topicLabel: 'Recorded walk', kind: 'screen' } };
    saveDemo(record).then((d) => { clearRecording(); (demo ? onChanged : onCreated)(d); setMsg(`${steps.length} steps added from the recording.`); }, (e: Error) => setMsg(e.message)).finally(() => setBusy(false));
  };
  return (
    <Container title="Advanced" icon="settings" collapsible defaultOpen={false} className="axp-demonstration-designer__advanced">
      <div className="fx-stack fx-stack--lg">
        <section className="fx-stack" aria-label="Record by doing">
          <p className="fx-eyebrow">Record by doing</p>
          <p className="fx-muted">Start, then use the console as you would show it: every screen you open and every control you tap becomes a step with draft words. Stop and make the steps; tweak the words above.</p>
          <div role="toolbar" aria-label="Record by doing" className="axp-demonstration-designer__tools">
            {recording ? <Button tone="danger" icon="x" onClick={() => stopRecording()}>Stop recording</Button> : <Button tone="primary" icon="monitor" onClick={() => startRecording(rt)}>Start recording</Button>}
            <Button icon="plus" disabled={recording || !events.length} busy={busy} onClick={makeSteps}>{demo ? 'Add steps to this pitch' : 'Make a pitch from it'}</Button>
            <span className="fx-muted">{recording ? `Recording: ${events.length} moves so far.` : events.length ? `${events.length} moves recorded.` : ''}</span>
          </div>
        </section>
        <section className="fx-stack" aria-label="Timeline">
          <div className="axp-demonstration-designer__head">
            <p className="fx-eyebrow">Timeline{demo ? ` · ${draft.length} steps` : ''}</p>
            {demo && (
              <div role="toolbar" aria-label="Timeline actions" className="axp-demonstration-designer__tools">
                <Button size="sm" icon="plus" onClick={() => setDraft((l) => [...l, { say: 'Say what this step shows.', do: '', target: '' }])}>Add step</Button>
                <Button size="sm" tone="primary" icon="save" disabled={!dirty} busy={busy} onClick={save}>Save timeline</Button>
                <Button size="sm" icon="undo" disabled={!dirty} onClick={() => setDraft(demo.data.steps)}>Revert</Button>
              </div>
            )}
          </div>
          {!demo ? <p className="fx-muted">Generate or open a pitch to edit its steps one by one.</p> : (
            <ol className="axp-demonstration-designer__steps">
              {draft.map((s, i) => <StepRow key={i} step={s} i={i} count={draft.length} onChange={(n) => replaceAt(i, n)} onMove={(d) => move(i, d)} onRemove={() => setDraft((l) => l.filter((_, k) => k !== i))} onPlay={() => void play({ ...toPlayable({ ...demo, data: { ...demo.data, steps: draft } }) }, { settings: { ...settings, stage: { ...settings.stage, logoIntro: false, logoOutro: false } }, from: i })} />)}
            </ol>
          )}
        </section>
        {msg && <p className="fx-muted" role="status">{msg}</p>}
      </div>
    </Container>
  );
}

/* ---------------- the page ---------------- */

export function DesignerPage() {
  const rt = useRuntime();
  const m = useModel();
  const stage = useStage();
  const [topic, setTopic] = useState<Topic | null>(null);
  const [minutes, setMinutes] = useState('');
  const [narrator, setNarrator] = useState<string | null>(null);
  const [speed, setSpeed] = useState<string | null>(null);
  const [voices, setVoices] = useState(deviceVoices());
  const [demo, setDemo] = useState<DemoRecord | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  useEffect(() => { void loadTopics(rt); void loadDemos(); void loadSettings(); }, [rt]);
  useEffect(() => {
    const synth = globalThis.speechSynthesis;
    if (!synth) return;
    const refresh = () => setVoices(deviceVoices());
    synth.addEventListener?.('voiceschanged', refresh);
    return () => synth.removeEventListener?.('voiceschanged', refresh);
  }, []);
  const openDemo = (id: string, autoplay = false) => getDemo(id).then((d) => { setDemo(d); setTopic(null); if (autoplay) void play(toPlayable(d), { settings: m.settings }); }, (e: Error) => setMsg(e.message));
  useEffect(() => {
    const take = () => { const w = takeWanted(); if (w) void openDemo(w.id, w.play); };
    take();
    const t = setInterval(take, 500);
    return () => clearInterval(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [m.settingsLoaded]);

  const mins = minutes || String(m.settings.script.minutes);
  const voice = narrator ?? m.settings.narration.voice;
  const spd = speed ?? String(m.settings.narration.speed);
  const narrators = useMemo(() => { const base = E.NARRATORS.map((n) => ({ value: n.value, label: n.label })); const seen = new Set(base.map((b) => b.value)); for (const v of voices) if (!seen.has(v.value)) { seen.add(v.value); base.push(v); } if (voice && !seen.has(voice)) base.push({ value: voice, label: `${voice} (not on this device)` }); return base; }, [voices, voice]);
  const go = () => {
    if (!topic) return;
    setBusy(true); setMsg('');
    generate(topic.id, { minutes: Number(mins), voice, speed: Number(spd), save: true })
      .then((d) => { setDemo(d); void play(toPlayable(d), { settings: m.settings }); }, (e: Error) => setMsg(e.message))
      .finally(() => setBusy(false));
  };
  const rows: Summary[] = m.demos;
  const view = usePageView();
  return (
    <div className={`fx-stack fx-stack--lg axp-demonstration-designer axp-demonstration-designer--${view}`} data-view={view}>
      <header className="fx-pagehead">
        <div>
          <p className="fx-eyebrow">Pitch · demonstrations{m.demosLoaded ? ` · ${rows.length} saved` : ''}</p>
          <h1>Demonstration Designer</h1>
          <p className="fx-muted">Pick what to show, how long, and a voice; Generate writes the pitch and plays it on your real data.</p>
        </div>
      </header>
      {m.error && <Note tone="warning">{m.error}</Note>}
      <section className="fx-card axp-demonstration-designer__flow" aria-label="Make a pitch">
        <div className="fx-stack axp-demonstration-designer__pick" data-pick="1">
          <p className="fx-eyebrow">1 · What to show</p>
          <TopicPicker topics={m.topics} value={topic} onPick={(t) => { setTopic(t); if (t) setDemo(null); }} />
        </div>
        <div className="fx-stack axp-demonstration-designer__pick" data-pick="2">
          <p className="fx-eyebrow">2 · How long</p>
          <Segmented<string> label="Length in minutes" value={E.LENGTHS.map(String).includes(mins) ? mins : String(E.LENGTHS[1])} onChange={setMinutes} options={E.LENGTHS.map((n) => ({ value: String(n), label: `${n} min` }))} />
        </div>
        <div className="fx-stack axp-demonstration-designer__pick" data-pick="3">
          <p className="fx-eyebrow">3 · Narrator voice</p>
          <div className="axp-demonstration-designer__voice">
            <SelectField label="Voice" value={voice} onChange={setNarrator} options={narrators} />
            <Segmented<string> label="Pace" size="sm" value={SPEEDS.some((s) => s.value === spd) ? spd : '1'} onChange={setSpeed} options={SPEEDS.map((s) => ({ value: s.value, label: s.label }))} />
          </div>
        </div>
        <div className="axp-demonstration-designer__go">
          <Button tone="primary" icon="sparkles" busy={busy} disabled={!topic || stage.status !== 'idle'} onClick={go} className="axp-demonstration-designer__generate">Generate</Button>
          <span className="fx-muted">{topic ? `Writes a ${mins}-minute pitch of ${topic.label} and plays it. No model, no tokens.` : 'Pick something to show first.'}</span>
        </div>
        {msg && <Note tone="danger" className="axp-demonstration-designer__flow-note">{msg}</Note>}
      </section>
      {demo && <Result demo={demo} onChanged={setDemo} onDeleted={() => setDemo(null)} />}
      <section className="fx-stack" aria-label="Saved pitches">
        <div className="axp-demonstration-designer__head">
          <p className="fx-eyebrow">Saved pitches</p>
          <div role="toolbar" aria-label="Saved pitches tools" className="axp-demonstration-designer__tools"><Button size="sm" icon="refresh" onClick={() => void loadDemos(true)}>Refresh</Button></div>
        </div>
        {!m.demosLoaded ? <LoadingSkeleton rows={3} label="Loading pitches" /> : !rows.length ? <EmptyState compact icon="play">No pitches yet. Pick something above and press Generate.</EmptyState> : (
          <ul className="axp-demonstration-designer__rows" aria-label="Saved pitches">
            {rows.map((s) => (
              <li key={s.id} className={`axp-demonstration-designer__saved${demo?.id === s.id ? ' is-selected' : ''}`}>
                <button type="button" data-fx-row className="axp-demonstration-designer__row" onClick={() => void openDemo(s.id)}>
                  <strong>{s.name}</strong>
                  <span className="fx-muted">{s.steps} steps · {fmtSeconds(s.seconds)}{s.chain.length ? ` · +${s.chain.length} in the tour` : ''}{s.clips ? ` · ${s.clips} recording${s.clips === 1 ? '' : 's'}` : ''}</span>
                </button>
                <Button size="sm" icon="play" disabled={stage.status !== 'idle'} onClick={() => void openDemo(s.id, true)}>Play</Button>
              </li>
            ))}
          </ul>
        )}
      </section>
      {m.settings.advanced.show && <Advanced demo={demo} onChanged={setDemo} onCreated={setDemo} />}
      <p className="fx-muted axp-demonstration-designer__note"><Icon name="info" size={12} /> Voice and API: say "play the pitch of …" to AmberX (actions pitch.play, pitch.pause, pitch.next, pitch.stop), or use <span className="fx-mono">axf demonstration-designer generate</span>. Settings: <button type="button" data-fx-row className="axp-demonstration-designer__link" onClick={() => rt.dispatch('settings.open:demonstration-designer')}>Demonstration Designer</button>.</p>
    </div>
  );
}
