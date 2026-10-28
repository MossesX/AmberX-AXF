/**
 * Dictation: tap the big button (or say "take a note", also right after the wake phrase) and talk in turns; it stops at
 * a stop phrase ("stop note", "end note", "that's it"), after two quiet turns or at the time limit. Then a review card
 * shows the text, a title, the list (the one passed to `dictation.start:<listId>`, else what the sentence or the AI
 * names, else Inbox), the kind and the checkboxes and tasks it found; Save writes it to the notes store.
 *
 * Actions: `dictation.start` and `dictation.start:<listId>` (other plugins call these), `dictation.stop`.
 */
import { useEffect, useSyncExternalStore } from 'react';
import type { AxfRuntime } from '../../../axf/core';
import { Button, Checkbox, Note, Section, Segmented, SelectField, TextField, useRuntime, type AxfWebLibrary } from '../../../axf/react';
import { isNative, native } from '../../../native';
import { addItem, findList, flatTree, localDay, parseIntent, type ItemKind } from '../../notes/web/core';
import { NOTES_ID, deviceName, load as loadNotes, mutate, snapshot as notesSnapshot, useNotes } from '../../notes/web/store';
import { aiReady, parseNote } from '../../ai/web/client';
import { registerVoiceCommands } from '../../voice/web/index';
import {
  DEFAULT_START, DEFAULT_STOP, clampMinutes, draftFromIntent, draftFromText, draftToItems, joinParts, newSession, phrases, turn,
  type Draft, type EndReason, type Session,
} from './core';
import './dictation.css';

const ID = 'ai.amberx.amberx.dictation';
export const K = {
  stop: 'amberx.dictation.stop',
  start: 'amberx.dictation.start',
  max: 'amberx.dictation.maxMinutes',
  autoSave: 'amberx.dictation.autoSave',
  beep: 'amberx.dictation.beep',
  /** shared with Voice control */
  lang: 'amberx.voice.lang',
} as const;

/* ---------------------------------------------------------------- state */

type Phase = 'idle' | 'listening' | 'thinking' | 'review';
interface State { stopping: boolean; phase: Phase; live: string; draft: Draft | null; transcript: string; preferred: string; note: string; ended: EndReason | null }
let st: State = { stopping: false, phase: 'idle', live: '', draft: null, transcript: '', preferred: '', note: '', ended: null };
const subs = new Set<() => void>();
const set = (p: Partial<State>) => { st = { ...st, ...p }; subs.forEach((f) => f()); };
const useDictation = () => useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => st);
let stopAsked = false;
const askStop = () => { stopAsked = true; set({ stopping: true }); };

const lang = (rt: AxfRuntime) => { const v = rt.settings.get(K.lang); return typeof v === 'string' && v.trim() ? v.trim() : 'en-US'; };

/** Two short tones (up = start, down = stop) through Web Audio; silent where it isn't there. */
function beep(rt: AxfRuntime, up: boolean) {
  if (rt.settings.get(K.beep) === false) return;
  try {
    const Ctx = (globalThis as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext ?? (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.frequency.setValueAtTime(up ? 660 : 880, ctx.currentTime);
    o.frequency.setValueAtTime(up ? 880 : 520, ctx.currentTime + 0.09);
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.2);
    o.start(); o.stop(ctx.currentTime + 0.22);
    o.onended = () => void ctx.close();
  } catch { /* no audio: carry on */ }
}

/** Writable lists only (the shared Voice notes are read-only). */
const writable = () => flatTree(notesSnapshot().view).filter((t) => !t.list.id.startsWith('vn-'));
const resolve = (spoken: string): string | null => {
  const l = findList(notesSnapshot().view, spoken);
  return l && !l.id.startsWith('vn-') ? l.id : null;
};

/** Starts a dictation (`list` = a list id to save into). */
export async function start(rt: AxfRuntime, list = '') {
  if (st.phase === 'listening' || st.phase === 'thinking') return;
  stopAsked = false;
  set({ stopping: false });
  rt.navigate('dictation');
  if (!notesSnapshot().loaded) void loadNotes();
  set({ phase: 'listening', live: '', draft: null, transcript: '', preferred: list && /^[A-Za-z0-9._-]{1,120}$/.test(list) ? list : '', note: '', ended: null });
  await new Promise((r) => setTimeout(r, 350)); // let a spoken reply or the tap sound finish
  beep(rt, true);
  const cfg = { stops: phrases(rt.settings.get(K.stop), DEFAULT_STOP), maxMinutes: clampMinutes(rt.settings.get(K.max)) };
  let s: Session = newSession(Date.now());
  let end: EndReason | null = null;
  try {
    while (!stopAsked) {
      const { text } = await native.listen({ lang: lang(rt), prompt: 'Dictating… say “stop note” to finish' });
      const r = turn(s, text ?? '', cfg, Date.now());
      s = r.session;
      set({ live: joinParts(s.parts) });
      if (r.end) { end = r.end; break; }
    }
  } catch (e) {
    set({ note: e instanceof Error ? e.message : String(e) });
  }
  beep(rt, false);
  await finish(rt, joinParts(s.parts), end);
}

async function finish(rt: AxfRuntime, text: string, ended: EndReason | null) {
  if (!text.trim()) { set({ phase: 'idle', live: '', ended, note: st.note || 'Heard nothing, so nothing was kept.' }); return; }
  set({ phase: 'thinking', transcript: text, ended });
  if (!notesSnapshot().loaded) await loadNotes();
  let draft = draftFromText(text, (x) => parseIntent(x), resolve, st.preferred);
  if (aiReady()) {
    const intent = await parseNote(text, { lists: writable().map((t) => t.path), today: localDay(new Date()) });
    if (intent?.action === 'add') draft = draftFromIntent(intent, draft.text || text, resolve, st.preferred);
  }
  if (rt.settings.get(K.autoSave) === true) { save(rt, draft); return; }
  set({ phase: 'review', draft });
}

export function save(rt: AxfRuntime, draft: Draft, again = false) {
  const items = draftToItems(draft, { fallback: 'inbox', transcript: st.transcript, device: deviceName() });
  if (!items.length) { rt.toast('Nothing to save.', 'warning', 'Dictation'); return; }
  try {
    mutate((s) => { for (const i of items) addItem(s, i); });
  } catch (e) { rt.toast(e instanceof Error ? e.message : String(e), 'danger', 'Dictation'); return; }
  const where = notesSnapshot().view.lists[draft.list || 'inbox']?.name ?? 'Inbox';
  const msg = `${items.length === 1 ? 'Saved' : `Saved ${items.length} items`} to ${where}.`;
  rt.toast(msg, 'success', 'Dictation');
  void native.speak({ text: msg, lang: lang(rt) }).catch(() => undefined);
  const keep = st.preferred;
  set({ phase: 'idle', draft: null, live: '', transcript: '', note: msg });
  if (again) void start(rt, keep);
}

/* ---------------------------------------------------------------- views */

const REASON: Record<EndReason, string> = { stop: 'Stopped at your stop phrase.', silence: 'Stopped after two quiet turns.', max: 'Stopped at the time limit.', full: 'Stopped: it was getting too long.' };

function Review({ rt, draft }: { rt: AxfRuntime; draft: Draft }) {
  useNotes();
  const edit = (p: Partial<Draft>) => set({ draft: { ...draft, ...p } });
  const lists = writable();
  return (
    <Section title="Check it, then save">
      <div className="fx-stack">
        {st.ended && <p className="fx-muted">{REASON[st.ended]}</p>}
        <TextField label="Title" value={draft.title} onChange={(title) => edit({ title })} />
        <TextField label="Text" rows={6} value={draft.text} onChange={(text) => edit({ text })} />
        <SelectField
          label="List"
          value={draft.list}
          hint={draft.listWhy || undefined}
          options={[{ value: '', label: 'Inbox' }, ...lists.filter((t) => t.list.id !== 'inbox').map((t) => ({ value: t.list.id, label: `${'  '.repeat(t.depth)}${t.path}` }))]}
          onChange={(list) => edit({ list, listWhy: '' })}
        />
        <Segmented<ItemKind> label="Kind" value={draft.kind} onChange={(kind) => edit({ kind })}
          options={[{ value: 'note', label: 'Note', icon: 'file' }, { value: 'todo', label: 'Todo', icon: 'check' }, { value: 'task', label: 'Task', icon: 'list' }]} />
        {draft.checklist.length > 0 && (
          <div className="fx-stack">
            <p className="fx-eyebrow">Checkboxes</p>
            {draft.checklist.map((c, i) => (
              <div className="axp-dictation-line" key={i}>
                <Checkbox label="" checked={c.done} onChange={(done) => edit({ checklist: draft.checklist.map((x, j) => (j === i ? { ...x, done } : x)) })} />
                <TextField label={`Checkbox ${i + 1}`} value={c.text} onChange={(text) => edit({ checklist: draft.checklist.map((x, j) => (j === i ? { ...x, text } : x)) })} />
                <Button size="sm" tone="quiet" icon="x" aria-label="Remove" onClick={() => edit({ checklist: draft.checklist.filter((_, j) => j !== i) })} />
              </div>
            ))}
          </div>
        )}
        {draft.tasks.length > 0 && (
          <div className="fx-stack">
            <p className="fx-eyebrow">Tasks it heard ({draft.tasks.length})</p>
            {draft.tasks.map((t, i) => (
              <div className="axp-dictation-line" key={i}>
                <span className="fx-chip">{t.due ? t.due.slice(0, 10) : 'task'}</span>
                <TextField label={`Task ${i + 1}`} value={t.content} onChange={(content) => edit({ tasks: draft.tasks.map((x, j) => (j === i ? { ...x, content } : x)) })} />
                <Button size="sm" tone="quiet" icon="x" aria-label="Remove" onClick={() => edit({ tasks: draft.tasks.filter((_, j) => j !== i) })} />
              </div>
            ))}
          </div>
        )}
        <div className="fx-row fx-row--wrap">
          <Button tone="primary" icon="save" onClick={() => save(rt, draft)}>Save</Button>
          <Button icon="mic" onClick={() => save(rt, draft, true)}>Save and dictate another</Button>
          <Button tone="quiet" icon="trash" onClick={() => set({ phase: 'idle', draft: null, live: '', note: 'Discarded.' })}>Discard</Button>
        </div>
        <details>
          <summary className="fx-muted">What was heard</summary>
          <p className="fx-muted">{st.transcript}</p>
        </details>
      </div>
    </Section>
  );
}

function DictationView() {
  const rt = useRuntime();
  const d = useDictation();
  const stops = phrases(rt.settings.get(K.stop), DEFAULT_STOP);
  const notes = rt.libraries.some((l) => l.id === NOTES_ID);
  useEffect(() => { void native.permissions().catch(() => undefined); if (!notesSnapshot().loaded) void loadNotes(); }, []);
  const listening = d.phase === 'listening';
  return (
    <div className="fx-stack fx-stack--lg">
      <header className="fx-pagehead">
        <div>
          <p className="fx-eyebrow">Dictation</p>
          <h1>{listening ? 'Listening…' : d.phase === 'thinking' ? 'Reading it…' : d.phase === 'review' ? 'Your note' : 'Dictate a note'}</h1>
          <p className="fx-muted">Talk as long as you like. Say “{stops[0]}” when you're done.</p>
        </div>
      </header>
      {!notes && <Note tone="warning">The Notes plugin isn't installed here, so saved notes won't show anywhere yet.</Note>}
      {!isNative() && <Note tone="info">In a browser, each pause ends a turn and it starts listening again by itself.</Note>}
      {d.phase !== 'review' && (
        <Button
          tone={listening ? 'danger' : 'primary'}
          icon={listening ? 'x' : 'mic'}
          className="axp-dictation-record"
          disabled={d.phase === 'thinking'}
          onClick={() => { if (listening) askStop(); else void start(rt, d.preferred); }}
        >
          {listening ? (d.stopping ? 'Stopping after this turn…' : 'Stop') : d.phase === 'thinking' ? 'Reading it…' : 'Start dictating'}
        </Button>
      )}
      {(listening || d.phase === 'thinking') && (
        <Section title="So far">
          <p className="axp-dictation-live">{d.live || <span className="fx-muted">Say something…</span>}</p>
        </Section>
      )}
      {d.phase === 'review' && d.draft && <Review rt={rt} draft={d.draft} />}
      {d.phase === 'idle' && d.note && <p className="fx-muted">{d.note}</p>}
    </div>
  );
}

/* ---------------------------------------------------------------- library */

let dropVoice: (() => void) | null = null;
function registerVoice(rt: AxfRuntime) {
  dropVoice?.();
  dropVoice = registerVoiceCommands(ID, [
    { id: 'dictation.start', phrases: phrases(rt.settings.get(K.start), DEFAULT_START), action: 'dictation.start', group: 'notes', owner: 'Dictation' },
    { id: 'dictation.open', phrases: ['open dictation', 'dictation page'], action: 'nav:dictation', group: 'notes', owner: 'Dictation' },
  ]);
}

export const library: AxfWebLibrary = {
  id: ID,
  label: 'Dictation',
  version: '0.1.0',
  builtWith: { model: 'opus', builtAt: '2026-10-27' },
  provides: ['amberx.dictation'],
  views: { dictation: { title: 'Dictate', icon: 'mic', keywords: ['dictation', 'dictate', 'note', 'record', 'speak'], render: () => <DictationView /> } },
  nav: { label: 'Dictation', items: [{ id: 'dictation', label: 'Dictate', icon: 'mic', view: 'dictation' }] },
  settingsTabs: [{ id: 'dictation', label: 'Dictation', icon: 'mic', order: 22, parent: 'plugins' }],
  settings: [
    {
      id: 'amberx.dictation', label: 'Dictation', icon: 'mic', tab: 'dictation', settings: [
        { key: K.stop, label: 'Stop phrases', kind: 'text', default: DEFAULT_STOP.join(', '), description: 'Comma separated. Saying one ends the dictation; it and anything after it are cut out.' },
        { key: K.start, label: 'Start phrases', kind: 'text', default: DEFAULT_START.join(', '), description: 'Comma separated. Said to Voice control (also right after the wake phrase), they start a dictation. The language is Voice control’s.' },
        { key: K.max, label: 'Longest dictation (minutes)', kind: 'number', default: 5, min: 0.5, max: 30, step: 0.5 },
        { key: K.autoSave, label: 'Save without asking', kind: 'toggle', default: false, description: 'Skip the review card and save straight to the suggested list.' },
        { key: K.beep, label: 'Beep on start and stop', kind: 'toggle', default: true },
      ],
    },
  ],
  contextMenu: [{ id: 'amberx.dictation', items: [{ id: 'dictation.start', label: 'Dictate a note', icon: 'mic', action: 'dictation.start' }] }],
  appMenu: [{ id: 'amberx.dictation', menu: 'axhub', items: [{ id: 'dictation.start', label: 'Dictate a note', icon: 'mic', action: 'dictation.start' }] }],
  register(rt) {
    rt.actions.register('dictation.start', ([list]) => void start(rt, list ?? ''), { label: 'Dictate a note' });
    rt.actions.register('dictation.stop', () => askStop(), { label: 'Stop dictating' });
    registerVoice(rt);
    rt.settings.onChange(K.start, () => registerVoice(rt));
  },
};
