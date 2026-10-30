/**
 * Voice notes console plugin (ai.amberx.axf.console.voice-notes): its settings interface plus the Voice notes page.
 *
 * Configures a voice-activated notes pusher: a start trigger, a beep, the note, a stop trigger (cut from the text and
 * the recording), then "where should I store it?" — say a list, or "give me the list of lists" and it reads them with
 * their numbers; say a number. Each list can ask its own questions, opened by a number or a recorded trigger, and can
 * file notes into subcategories. Everything (settings and lists) lives on axHub's data server through the framework's
 * lib-hubstore, never on this device. The listener that does the talking is Voice Vault on Android.
 *
 * Settings → Plugins → Voice notes. The page (view `voice-notes`, tabable, so Patches can add it as a tab) fetches the
 * notes the listener saved to table `notes` on axHub: newest first, by list and subcategory, search, copy, delete.
 */
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Button, Chip, IconButton, Note, Section, SelectField, Switch, TextField, useRuntime } from '@console/axf/react';
import type { AxfWebLibrary } from '@console/axf/react/library';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import {
  FOLDER, ID, MAX_LISTS, MAX_PHRASES, conversationPreview, newId, newList, pickList, problems, spokenNumber, stripStopTrigger, asksForLists,
  filterNotes, noteCounts, noteWhere, notesMarkdown,
  type NoteList, type QuestionSet, type SavedNote, type Subcategory, type VoiceNotesSettings,
} from './core';
import * as store from './store';
import { appMenu } from './menu';
import './voice-notes.css';

const useSnap = () => useSyncExternalStore(store.subscribe, store.snapshot);

/** Load once when a panel first shows, and again whenever the console comes back into focus. */
function useLoaded() {
  useEffect(() => {
    if (!store.snapshot().loaded) void store.load();
    const again = () => { if (document.visibilityState === 'visible') void store.load(); };
    window.addEventListener('focus', again);
    document.addEventListener('visibilitychange', again);
    return () => { window.removeEventListener('focus', again); document.removeEventListener('visibilitychange', again); };
  }, []);
  return useSnap();
}

/** Save a text/number field after typing stops. */
function useDebounced<K extends keyof VoiceNotesSettings>(key: K, value: VoiceNotesSettings[K]) {
  const [draft, setDraft] = useState(value);
  const t = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => { setDraft(value); }, [JSON.stringify(value)]); // eslint-disable-line react-hooks/exhaustive-deps
  const change = (v: VoiceNotesSettings[K]) => { setDraft(v); if (t.current) clearTimeout(t.current); t.current = setTimeout(() => void store.saveSetting(key, v), 600); };
  return [draft, change] as const;
}

/* ---------- speech: record a trigger (browser speech recognition, when it has one) ---------- */
type Recognizer = { lang: string; interimResults: boolean; maxAlternatives: number; start(): void; abort(): void; onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null; onerror: ((e: { error: string }) => void) | null; onend: (() => void) | null };
const Speech = (): (new () => Recognizer) | null => { const w = globalThis as unknown as Record<string, unknown>; return (w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null) as (new () => Recognizer) | null; };

function useRecorder(lang: string) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const rec = useRef<Recognizer | null>(null);
  const supported = !!Speech();
  const record = (done: (text: string) => void) => {
    const S = Speech();
    if (!S) { setErr('This browser has no speech recognition; type the phrase instead.'); return; }
    try {
      const r = new S(); rec.current = r;
      r.lang = lang; r.interimResults = false; r.maxAlternatives = 1;
      r.onresult = (e) => { const t = e.results[0]?.[0]?.transcript?.trim(); if (t) done(t); };
      r.onerror = (e) => setErr(e.error === 'not-allowed' ? 'The microphone is blocked for this site.' : `Didn't catch that (${e.error}).`);
      r.onend = () => { setBusy(false); rec.current = null; };
      setErr(null); setBusy(true); r.start();
    } catch (e) { setBusy(false); setErr((e as Error).message); }
  };
  useEffect(() => () => rec.current?.abort(), []);
  return { busy, err, supported, record };
}

function beep(b: VoiceNotesSettings['beep']) {
  try {
    const C = (globalThis as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext ?? (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!C) return;
    const ctx = new C(); const o = ctx.createOscillator(); const g = ctx.createGain();
    o.frequency.value = b.hz; g.gain.value = b.volume; o.connect(g); g.connect(ctx.destination);
    o.start(); o.stop(ctx.currentTime + b.ms / 1000); o.onended = () => void ctx.close();
  } catch { /* no audio */ }
}

/* ---------- small pieces ---------- */

function PhraseEditor({ label, hint, value, onChange, lang, disabled }: { label: string; hint?: string; value: string[]; onChange: (v: string[]) => void; lang: string; disabled?: boolean }) {
  const [typed, setTyped] = useState('');
  const mic = useRecorder(lang);
  const add = (p: string) => { const t = p.trim(); if (!t || value.some((x) => x.toLowerCase() === t.toLowerCase()) || value.length >= MAX_PHRASES) return; onChange([...value, t]); setTyped(''); };
  return (
    <div className="fx-stack axp-voice-notes-phrases">
      <div className="fx-row fx-row--wrap">
        {value.map((p) => (
          <span key={p} className="fx-row axp-voice-notes-phrase"><Chip tone="accent">{p}</Chip><IconButton icon="x" label={`Remove "${p}"`} disabled={disabled} onClick={() => onChange(value.filter((x) => x !== p))} /></span>
        ))}
        {!value.length && <span className="fx-small fx-muted">None yet.</span>}
      </div>
      <div className="fx-row fx-row--wrap axp-voice-notes-add">
        <TextField label={label} hint={hint} value={typed} onChange={setTyped} placeholder="Type a phrase" disabled={disabled} />
        <Button size="sm" icon="plus" disabled={disabled || !typed.trim()} onClick={() => add(typed)}>Add</Button>
        <Button size="sm" icon="mic" disabled={disabled || mic.busy || !mic.supported} title={mic.supported ? 'Say the phrase' : 'No speech recognition in this browser'} onClick={() => mic.record(add)}>{mic.busy ? 'Listening…' : 'Record'}</Button>
      </div>
      {mic.err && <Note tone="warning">{mic.err}</Note>}
    </div>
  );
}

function Num({ label, value, min, max, step = 1, onChange, hint, disabled }: { label: string; value: number; min: number; max: number; step?: number; onChange: (n: number) => void; hint?: string; disabled?: boolean }) {
  return <TextField type="number" label={label} hint={hint} value={String(value)} disabled={disabled} onChange={(t) => { const n = Number(t); if (Number.isFinite(n)) onChange(Math.min(max, Math.max(min, step < 1 ? n : Math.round(n)))); }} />;
}

function HubGate({ children }: { children: (ready: boolean) => ReactNode }) {
  const s = useLoaded();
  const ready = s.loaded && s.state.status === 'ready';
  return (
    <>
      {s.state.status === 'unauthorized' && <Note tone="warning">Sign in to axHub to change voice notes: {s.state.reason}</Note>}
      {s.state.status === 'unreachable' && <Note tone="danger">axHub can't be reached, so voice notes can't be read or saved (they're kept only on axHub): {s.state.reason}</Note>}
      {s.error && s.state.status === 'ready' && <Note tone="warning">{s.error}</Note>}
      {!s.loaded && s.state.status !== 'unreachable' && s.state.status !== 'unauthorized' && <p className="fx-small fx-muted">Reading from axHub…</p>}
      {children(ready)}
    </>
  );
}

/* ---------- panels ---------- */

function WherePanel() {
  const s = useLoaded();
  const w = store.where();
  const issues = s.loaded ? problems(s.settings, s.lists) : [];
  return (
    <div className="fx-stack">
      <p className="fx-small fx-muted axp-voice-notes-lede" style={{ margin: 0 }} title="Voice notes keep their settings and lists on axHub's data server (lib-hubstore), not on this device, so every device and the listener see the same setup.">Kept on axHub, so every device and the listener share one setup.</p>
      <div className="fx-row fx-row--wrap">
        <Chip tone={s.state.status === 'ready' ? 'success' : s.state.status === 'loading' || s.state.status === 'idle' ? undefined : 'danger'}>{s.state.status === 'ready' ? 'axHub connected' : s.state.status}</Chip>
        <span className="fx-small fx-muted">{s.lists.length} list{s.lists.length === 1 ? '' : 's'}</span>
        <Button size="sm" icon="refresh" onClick={() => void store.load()}>Read again</Button>
      </div>
      {w.settings && <p className="fx-small fx-muted" style={{ margin: 0 }}>Settings: <code>{w.settings}</code><br />Lists: <code>{w.lists}</code></p>}
      {s.state.status === 'unauthorized' && <Note tone="warning">{s.state.reason}</Note>}
      {s.state.status === 'unreachable' && <Note tone="danger">{s.state.reason}</Note>}
      {issues.length > 0 && <Note tone="warning">{issues.map((x) => <div key={x}>{x}</div>)}</Note>}
      {s.loaded && !issues.length && s.state.status === 'ready' && <Note tone="success">Everything the listener needs is set.</Note>}
      <p className="fx-small fx-muted" style={{ margin: 0 }}>Voice Vault on Android is the listener: it hears these triggers (in the background too) and saves notes here.</p>
    </div>
  );
}

function TriggersPanel() {
  return (
    <HubGate>{(ready) => {
      const s = store.snapshot().settings;
      const set = <K extends keyof VoiceNotesSettings>(k: K) => (v: VoiceNotesSettings[K]) => void store.saveSetting(k, v);
      return (
        <div className="fx-stack fx-stack--lg">
          <Switch label="Listen for voice notes" hint="Off = the listener ignores the start trigger." checked={s.enabled} disabled={!ready} onChange={set('enabled')} />
          <Section title="Start trigger"><PhraseEditor label="Starts a note" hint="Say one of these; then the beep." value={s.startTriggers} onChange={set('startTriggers')} lang={s.language} disabled={!ready} /></Section>
          <Section title="Stop trigger"><PhraseEditor label="Ends the note" hint="Cut from the text and the recording." value={s.stopTriggers} onChange={set('stopTriggers')} lang={s.language} disabled={!ready} /></Section>
          <Section title="List of lists"><PhraseEditor label="Asks for the lists" hint="It reads every list with its number." value={s.listTriggers} onChange={set('listTriggers')} lang={s.language} disabled={!ready} /></Section>
          <Section title="Cancel"><PhraseEditor label="Backs out at any step" value={s.cancelTriggers} onChange={set('cancelTriggers')} lang={s.language} disabled={!ready} /></Section>
        </div>
      );
    }}</HubGate>
  );
}

function RecordingPanel() {
  const snap = useSnap();
  const s = snap.settings;
  const [hz, setHz] = useDebounced('beep', s.beep);
  const [maxS, setMaxS] = useDebounced('maxSeconds', s.maxSeconds);
  const [sil, setSil] = useDebounced('silenceSeconds', s.silenceSeconds);
  const [lang, setLang] = useDebounced('language', s.language);
  return (
    <HubGate>{(ready) => (
      <div className="fx-stack fx-stack--lg">
        <Section title="Beep" aside={<Button size="sm" icon="play" onClick={() => beep(hz)}>Test beep</Button>}>
          <div className="fx-stack">
            <Switch label="Beep before recording" checked={s.beep.on} disabled={!ready} onChange={(on) => void store.saveSetting('beep', { ...s.beep, on })} />
            <div className="fx-row fx-row--wrap">
              <Num label="Pitch (Hz)" value={hz.hz} min={200} max={4000} disabled={!ready || !s.beep.on} onChange={(n) => setHz({ ...hz, hz: n })} />
              <Num label="Length (ms)" value={hz.ms} min={40} max={2000} disabled={!ready || !s.beep.on} onChange={(n) => setHz({ ...hz, ms: n })} />
              <Num label="Volume (0–1)" value={hz.volume} min={0} max={1} step={0.05} disabled={!ready || !s.beep.on} onChange={(n) => setHz({ ...hz, volume: n })} />
            </div>
            <Switch label="Beep again when the stop trigger is heard" checked={s.endBeep} disabled={!ready || !s.beep.on} onChange={(v) => void store.saveSetting('endBeep', v)} />
          </div>
        </Section>
        <Section title="Recording">
          <div className="fx-stack">
            <div className="fx-row fx-row--wrap">
              <Num label="Longest note (seconds)" value={maxS} min={5} max={900} disabled={!ready} onChange={setMaxS} />
              <Num label="Stop after silence (seconds, 0 = never)" value={sil} min={0} max={60} disabled={!ready} onChange={setSil} />
              <TextField label="Language" hint="For example en-US, en-GB, es-ES." value={lang} disabled={!ready} onChange={setLang} mono />
            </div>
            <Switch label="Cut the stop trigger out of the recording too" hint="It's always cut out of the text." checked={s.stripAudio} disabled={!ready} onChange={(v) => void store.saveSetting('stripAudio', v)} />
            <Switch label="Keep the audio with the note" hint="Off = only the text is stored." checked={s.keepAudio} disabled={!ready} onChange={(v) => void store.saveSetting('keepAudio', v)} />
          </div>
        </Section>
      </div>
    )}</HubGate>
  );
}

function AskingPanel() {
  const snap = useSnap();
  const s = snap.settings;
  const [ask, setAsk] = useDebounced('askPrompt', s.askPrompt);
  const [fmt, setFmt] = useDebounced('listFormat', s.listFormat);
  const [conf, setConf] = useDebounced('confirmText', s.confirmText);
  const [tries, setTries] = useDebounced('retries', s.retries);
  return (
    <HubGate>{(ready) => (
      <div className="fx-stack">
        <TextField label="Where to store it (spoken after the note)" rows={2} value={ask} disabled={!ready} onChange={setAsk} />
        <Switch label="Read the lists right away" hint="Off = it waits for the list-of-lists trigger or a list's name or number." checked={s.readListsFirst} disabled={!ready} onChange={(v) => void store.saveSetting('readListsFirst', v)} />
        <TextField label="How each list is read" hint="{number} and {name}" value={fmt} disabled={!ready} onChange={setFmt} mono />
        <Switch label="Say where it was saved" checked={s.confirm} disabled={!ready} onChange={(v) => void store.saveSetting('confirm', v)} />
        <TextField label="Saved message" hint="{list} and {sub}" value={conf} disabled={!ready || !s.confirm} onChange={setConf} />
        <div className="fx-row fx-row--wrap">
          <Num label="Asks again when nothing matches" value={tries} min={0} max={5} disabled={!ready} onChange={setTries} />
          <SelectField label="Then store it in" empty="Nowhere (drop it)" value={s.fallbackList} disabled={!ready} options={snap.lists.map((l) => ({ value: l.id, label: `${l.number}: ${l.name}` }))} onChange={(v) => void store.saveSetting('fallbackList', v)} />
        </div>
      </div>
    )}</HubGate>
  );
}

/* ---------- lists ---------- */

function SubcategoryRows({ list, onChange, disabled }: { list: NoteList; onChange: (l: NoteList) => void; disabled: boolean }) {
  const put = (i: number, sc: Subcategory) => onChange({ ...list, subcategories: list.subcategories.map((x, k) => (k === i ? sc : x)) });
  const add = () => { const used = new Set(list.subcategories.map((x) => x.number)); let n = 1; while (used.has(n)) n++; onChange({ ...list, subcategories: [...list.subcategories, { id: newId('sub'), number: n, name: '', aliases: [] }] }); };
  return (
    <Section title="Subcategories" aside={<Button size="sm" icon="plus" disabled={disabled} onClick={add}>Add</Button>}>
      <div className="fx-stack">
        <Switch label="Ask which subcategory after picking this list" checked={list.askSubcategory} disabled={disabled || !list.subcategories.length} onChange={(v) => onChange({ ...list, askSubcategory: v })} />
        {list.askSubcategory && <TextField label="Subcategory question" hint="{list}" value={list.subcategoryPrompt} disabled={disabled} onChange={(v) => onChange({ ...list, subcategoryPrompt: v })} />}
        {list.subcategories.map((sc, i) => (
          <div key={sc.id} className="fx-row fx-row--wrap axp-voice-notes-sub">
            <Num label="No." value={sc.number} min={1} max={MAX_LISTS} disabled={disabled} onChange={(n) => put(i, { ...sc, number: n })} />
            <TextField label="Name" value={sc.name} disabled={disabled} onChange={(v) => put(i, { ...sc, name: v })} />
            <TextField label="Also called" hint="comma separated" value={sc.aliases.join(', ')} disabled={disabled} onChange={(v) => put(i, { ...sc, aliases: v.split(',').map((x) => x.trim()).filter(Boolean) })} />
            <IconButton icon="trash" label="Remove subcategory" disabled={disabled} onClick={() => onChange({ ...list, subcategories: list.subcategories.filter((_, k) => k !== i), questionSets: list.questionSets.map((q) => (q.subcategory === sc.id ? { ...q, subcategory: '' } : q)) })} />
          </div>
        ))}
      </div>
    </Section>
  );
}

function QuestionSetEditor({ list, set, onChange, onRemove, disabled, lang }: { list: NoteList; set: QuestionSet; onChange: (q: QuestionSet) => void; onRemove: () => void; disabled: boolean; lang: string }) {
  const mic = useRecorder(lang);
  return (
    <div className="fx-stack axp-voice-notes-set">
      <div className="fx-row fx-row--wrap">
        <TextField label="Name" value={set.label} disabled={disabled} onChange={(v) => onChange({ ...set, label: v })} placeholder="e.g. Shopping details" />
        <SelectField label="Asked when" value={set.trigger.kind} disabled={disabled} options={[{ value: 'always', label: 'Always (after picking this list)' }, { value: 'number', label: 'You say a number' }, { value: 'phrase', label: 'You say a trigger' }]}
          onChange={(k) => onChange({ ...set, trigger: k === 'number' ? { kind: 'number', number: set.trigger.number ?? 1 } : k === 'phrase' ? { kind: 'phrase', phrase: set.trigger.phrase ?? '' } : { kind: 'always' } })} />
        {set.trigger.kind === 'number' && <Num label="Number" value={set.trigger.number ?? 1} min={1} max={MAX_LISTS} disabled={disabled} onChange={(n) => onChange({ ...set, trigger: { kind: 'number', number: n } })} />}
        {set.trigger.kind === 'phrase' && (
          <>
            <TextField label="Trigger" value={set.trigger.phrase ?? ''} disabled={disabled} onChange={(v) => onChange({ ...set, trigger: { kind: 'phrase', phrase: v } })} />
            <Button size="sm" icon="mic" disabled={disabled || mic.busy || !mic.supported} onClick={() => mic.record((t) => onChange({ ...set, trigger: { kind: 'phrase', phrase: t } }))}>{mic.busy ? 'Listening…' : 'Record'}</Button>
          </>
        )}
        <SelectField label="File into" empty="The list itself" value={set.subcategory} disabled={disabled || !list.subcategories.length} options={list.subcategories.map((x) => ({ value: x.id, label: `${x.number}: ${x.name || '(no name)'}` }))} onChange={(v) => onChange({ ...set, subcategory: v })} />
        <IconButton icon="trash" label="Remove question set" disabled={disabled} onClick={onRemove} />
      </div>
      {mic.err && <Note tone="warning">{mic.err}</Note>}
      {set.questions.map((q, i) => (
        <div key={q.id} className="fx-row fx-row--wrap axp-voice-notes-q">
          <TextField label={`Question ${i + 1}`} value={q.ask} disabled={disabled} onChange={(v) => onChange({ ...set, questions: set.questions.map((x, k) => (k === i ? { ...x, ask: v } : x)) })} placeholder="e.g. Which store?" />
          <TextField label="Save the answer as" value={q.field} disabled={disabled} mono onChange={(v) => onChange({ ...set, questions: set.questions.map((x, k) => (k === i ? { ...x, field: v.replace(/[^a-z0-9_-]/gi, '').slice(0, 40) } : x)) })} placeholder="store" />
          <IconButton icon="x" label="Remove question" disabled={disabled} onClick={() => onChange({ ...set, questions: set.questions.filter((_, k) => k !== i) })} />
        </div>
      ))}
      <div><Button size="sm" icon="plus" disabled={disabled || set.questions.length >= 20} onClick={() => onChange({ ...set, questions: [...set.questions, { id: newId('q'), ask: '', field: '' }] })}>Add question</Button></div>
    </div>
  );
}

function ListEditor({ initial, ready, lang, onDone }: { initial: NoteList; ready: boolean; lang: string; onDone: () => void }) {
  const [l, setL] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [sure, setSure] = useState(false);
  const dirty = JSON.stringify(l) !== JSON.stringify(initial);
  const disabled = !ready || busy;
  return (
    <div className="fx-stack fx-stack--lg axp-voice-notes-editor">
      <div className="fx-row fx-row--wrap">
        <Num label="Number" hint="What you say to pick it" value={l.number} min={1} max={MAX_LISTS} disabled={disabled} onChange={(n) => setL({ ...l, number: n })} />
        <TextField label="Name" value={l.name} disabled={disabled} onChange={(v) => setL({ ...l, name: v })} />
        <TextField label="Also called" hint="comma separated" value={l.aliases.join(', ')} disabled={disabled} onChange={(v) => setL({ ...l, aliases: v.split(',').map((x) => x.trim()).filter(Boolean) })} />
      </div>
      <SubcategoryRows list={l} onChange={setL} disabled={disabled} />
      <Section title="Questions" aside={<Button size="sm" icon="plus" disabled={disabled} onClick={() => setL({ ...l, questionSets: [...l.questionSets, { id: newId('set'), label: '', trigger: { kind: l.questionSets.some((q) => q.trigger.kind === 'always') ? 'number' : 'always', number: 1 }, subcategory: '', questions: [] }] })}>Add question set</Button>}>
        <div className="fx-stack">
          <p className="fx-small fx-muted" style={{ margin: 0 }}>Each set is asked after the note is filed here: always, or when you say its number or its trigger.</p>
          {l.questionSets.some((q) => q.trigger.kind !== 'always') && <TextField label="How it asks for a number or trigger" value={l.questionPrompt} disabled={disabled} onChange={(v) => setL({ ...l, questionPrompt: v })} />}
          {l.questionSets.map((q, i) => (
            <QuestionSetEditor key={q.id} list={l} set={q} lang={lang} disabled={disabled} onChange={(n) => setL({ ...l, questionSets: l.questionSets.map((x, k) => (k === i ? n : x)) })} onRemove={() => setL({ ...l, questionSets: l.questionSets.filter((_, k) => k !== i) })} />
          ))}
        </div>
      </Section>
      <div className="fx-row fx-row--wrap">
        <Button tone="primary" icon="save" disabled={disabled || !dirty || !l.name.trim()} onClick={async () => { setBusy(true); const ok = await store.saveList(l); setBusy(false); if (ok) onDone(); }}>Save list</Button>
        <Button icon="x" disabled={busy} onClick={onDone}>{dirty ? 'Discard changes' : 'Close'}</Button>
        <Button tone="danger" icon="trash" disabled={disabled} onClick={async () => { if (!sure) { setSure(true); return; } setBusy(true); await store.removeList(l.id); setBusy(false); onDone(); }}>{sure ? 'Tap again to delete' : 'Delete list'}</Button>
      </div>
    </div>
  );
}

function ListsPanel() {
  const snap = useSnap();
  const [open, setOpen] = useState<string | null>(null);
  const [draft, setDraft] = useState<NoteList | null>(null);
  return (
    <HubGate>{(ready) => (
      <div className="fx-stack">
        <div className="fx-row fx-row--wrap">
          <Button icon="plus" disabled={!ready || snap.lists.length >= MAX_LISTS} onClick={() => { const n = newList(snap.lists); setDraft(n); setOpen(n.id); }}>New list</Button>
          <span className="fx-small fx-muted">Say a list's number (or name) to store a note in it.</span>
        </div>
        {draft && open === draft.id && <ListEditor initial={draft} ready={ready} lang={snap.settings.language} onDone={() => { setDraft(null); setOpen(null); }} />}
        {snap.lists.map((l) => (
          <div key={l.id} className="fx-stack axp-voice-notes-list">
            <button type="button" data-fx-row className="fx-row axp-voice-notes-listrow" aria-expanded={open === l.id} onClick={() => { setDraft(null); setOpen(open === l.id ? null : l.id); }}>
              <Chip tone="accent">{l.number}</Chip>
              <strong>{l.name || '(no name)'}</strong>
              <span className="fx-small fx-muted">{l.subcategories.length} subcategor{l.subcategories.length === 1 ? 'y' : 'ies'} · {l.questionSets.length} question set{l.questionSets.length === 1 ? '' : 's'}</span>
            </button>
            {open === l.id && <ListEditor key={JSON.stringify(l)} initial={l} ready={ready} lang={snap.settings.language} onDone={() => setOpen(null)} />}
          </div>
        ))}
        {snap.loaded && !snap.lists.length && !draft && <p className="fx-small fx-muted">No lists yet.</p>}
      </div>
    )}</HubGate>
  );
}

function PreviewPanel() {
  const snap = useSnap();
  const [said, setSaid] = useState('');
  const lines = conversationPreview(snap.settings, snap.lists);
  const cut = stripStopTrigger(said, snap.settings.stopTriggers);
  const list = pickList(said, snap.lists);
  const n = spokenNumber(said);
  return (
    <HubGate>{() => (
      <div className="fx-stack">
        <ol className="axp-voice-notes-script">
          {lines.map((x, i) => <li key={i} className={`axp-voice-notes-line is-${x.who}`}><span className="fx-small fx-muted">{x.who === 'you' ? 'You' : 'App'}</span> {x.text}</li>)}
        </ol>
        <TextField label="Try something you'd say" value={said} onChange={setSaid} placeholder="e.g. call the dentist end note, or number two" />
        {said.trim() && (
          <p className="fx-small" style={{ margin: 0 }}>
            Note text: “{cut.text}”{cut.cut ? ` (cut “${cut.cut}”)` : ''} · {asksForLists(said, snap.settings) ? 'reads the list of lists' : list ? `goes to ${list.number}: ${list.name}` : n !== null ? `number ${n} (no list has it)` : 'no list matched'}
          </p>
        )}
      </div>
    )}</HubGate>
  );
}

/* ---------- the notes page (view `voice-notes`) ---------- */

/** How often the page fetches again while it's on screen. */
const NOTES_EVERY_MS = 30_000;

const when = (iso: string) => { const t = Date.parse(iso); return Number.isFinite(t) ? new Date(t).toLocaleString() : 'no date'; };

/** Fetch the notes when the page shows, every 30 s while it's visible, and on focus. */
function useNotes() {
  useEffect(() => {
    void store.loadNotes();
    const visible = () => document.visibilityState === 'visible';
    const again = () => { if (visible()) void store.loadNotes(); };
    const timer = window.setInterval(again, NOTES_EVERY_MS);
    window.addEventListener('focus', again);
    document.addEventListener('visibilitychange', again);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', again); document.removeEventListener('visibilitychange', again); };
  }, []);
  return useSnap();
}

function NoteCard({ n, lists }: { n: SavedNote; lists: NoteList[] }) {
  const [sure, setSure] = useState(false);
  useEffect(() => { if (!sure) return; const t = window.setTimeout(() => setSure(false), 4000); return () => window.clearTimeout(t); }, [sure]);
  const answers = Object.entries(n.answers);
  return (
    <article className="axp-voice-notes-note">
      <div className="fx-row fx-row--wrap axp-voice-notes-notehead">
        <Chip tone="accent">{noteWhere(n, lists)}</Chip>
        <span className="fx-small fx-muted">{when(n.at)}{n.device ? ` · ${n.device}` : ''}</span>
        <span className="axp-voice-notes-grow" />
        <IconButton icon="copy" label="Copy the note" onClick={() => void navigator.clipboard?.writeText(n.text)} />
        {sure ? <Button size="sm" tone="danger" icon="trash" onClick={() => void store.removeNote(n.id)}>Tap again to delete</Button> : <IconButton icon="trash" label="Delete the note" onClick={() => setSure(true)} />}
      </div>
      <p className="axp-voice-notes-text">{n.text}</p>
      {answers.length > 0 && (
        <dl className="axp-voice-notes-answers fx-small">
          {answers.map(([k, v]) => <div key={k}><dt className="fx-muted">{k}</dt><dd>{v}</dd></div>)}
        </dl>
      )}
    </article>
  );
}

function NotesPage() {
  const rt = useRuntime();
  const snap = useNotes();
  const [q, setQ] = useState('');
  const [list, setList] = useState('');
  const [sub, setSub] = useState('');
  const counts = noteCounts(snap.notes, snap.lists);
  const shown = filterNotes(snap.notes, snap.lists, { q, list, sub });
  const picked = snap.lists.find((l) => l.id === list);
  const listOptions = [
    ...snap.lists.map((l) => ({ value: l.id, label: `${l.number}: ${l.name} (${counts[l.id] ?? 0})` })),
    ...(counts.none ? [{ value: 'none', label: `No list / list removed (${counts.none})` }] : []),
  ];
  return (
    <div className="fx-stack">
      {!rt.embedded?.page && (
        <header className="fx-pagehead">
          <div>
            <p className="fx-eyebrow">Voice notes</p>
            <h1>Voice notes</h1>
            <p className="fx-muted axp-voice-notes-lede" title="The notes Voice Vault heard and saved to axHub, newest first. It fetches them again every 30 seconds while this page is open.">{snap.notes.length} saved{snap.notesAt ? ` · fetched ${new Date(snap.notesAt).toLocaleTimeString()}` : ''} · from Voice Vault, newest first</p>
          </div>
          <div className="fx-row axp-voice-notes-acts">
            <IconButton icon="refresh" label={snap.notesBusy ? 'Fetching…' : 'Fetch now'} disabled={snap.notesBusy} onClick={() => void store.loadNotes()} />
            <IconButton icon="settings" label="Set up" onClick={() => rt.dispatch('settings.open:voice-notes')} />
          </div>
        </header>
      )}
      <HubGate>{() => (
        <div className="fx-stack">
          {rt.embedded?.page && (
            <div className="fx-row fx-row--wrap">
              <span className="fx-small fx-muted">{snap.notes.length} saved{snap.notesAt ? ` · fetched ${new Date(snap.notesAt).toLocaleTimeString()}` : ''}</span>
              <Button size="sm" icon="refresh" disabled={snap.notesBusy} onClick={() => void store.loadNotes()}>{snap.notesBusy ? 'Fetching…' : 'Fetch now'}</Button>
            </div>
          )}
          <div className="fx-row fx-row--wrap axp-voice-notes-filters">
            <TextField label="Search" value={q} onChange={setQ} placeholder="Words in the note, its list or answers" />
            <SelectField label="List" value={list} empty={`All lists (${snap.notes.length})`} options={listOptions} onChange={(v) => { setList(v); setSub(''); }} />
            {picked && picked.subcategories.length > 0 && (
              <SelectField label="Subcategory" value={sub} empty="All" options={picked.subcategories.map((x) => ({ value: x.id, label: `${x.number}: ${x.name}` }))} onChange={setSub} />
            )}
          </div>
          {shown.length > 0 && (
            <div className="fx-row fx-row--wrap">
              <span className="fx-small fx-muted">{shown.length === snap.notes.length ? `${shown.length} notes` : `${shown.length} of ${snap.notes.length} notes`}</span>
              <Button size="sm" icon="copy" onClick={() => void navigator.clipboard?.writeText(notesMarkdown(shown, snap.lists))}>Copy as Markdown</Button>
            </div>
          )}
          {shown.map((n) => <NoteCard key={n.id} n={n} lists={snap.lists} />)}
          {snap.notesLoaded && !snap.notes.length && <Note>No notes yet. Say your start trigger near Voice Vault, then the note and the stop trigger, and it shows up here.</Note>}
          {snap.notesLoaded && snap.notes.length > 0 && !shown.length && <p className="fx-small fx-muted">No note matches.</p>}
          {!snap.notesLoaded && snap.state.status === 'ready' && <p className="fx-small fx-muted">Fetching notes…</p>}
        </div>
      )}</HubGate>
    </div>
  );
}

export const plugin: AxfWebLibrary = {
  appMenu,
  id: ID,
  label: 'Voice notes',
  version: '0.2.0',
  provides: ['voice-notes.settings', 'voice-notes.page'],
  views: { 'voice-notes': { title: 'Voice notes', icon: 'mic', keywords: ['voice', 'notes', 'dictation', 'voice vault', 'lists'], render: () => <NotesPage /> } },
  nav: { label: 'Plugins', items: [{ id: 'voice-notes', label: 'Voice notes', icon: 'mic', view: 'voice-notes' }] },
  settingsTabs: [{ id: 'voice-notes', label: 'Voice notes', icon: 'mic', parent: 'plugins', order: 60, description: 'Set up the voice-activated notes pusher (kept on axHub).' }],
  settingsPanels: [
    { id: 'voice-notes.where', tab: 'voice-notes', title: 'Where it lives', icon: 'cloud', order: 5, render: () => <WherePanel /> },
    { id: 'voice-notes.triggers', tab: 'voice-notes', title: 'Triggers', icon: 'mic', order: 10, render: () => <TriggersPanel /> },
    { id: 'voice-notes.recording', tab: 'voice-notes', title: 'Beep and recording', icon: 'bell', order: 20, render: () => <RecordingPanel /> },
    { id: 'voice-notes.asking', tab: 'voice-notes', title: 'Asking where to store it', icon: 'help', order: 30, render: () => <AskingPanel /> },
    { id: 'voice-notes.lists', tab: 'voice-notes', title: 'Lists', icon: 'list', order: 40, render: () => <ListsPanel /> },
    { id: 'voice-notes.preview', tab: 'voice-notes', title: 'Try the conversation', icon: 'play', order: 50, render: () => <PreviewPanel /> },
    { id: 'voice-notes.lifecycle', tab: 'voice-notes', title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> },
  ],
};
