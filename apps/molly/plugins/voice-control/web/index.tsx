import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { AxfRuntime } from '../../../src/axf/core';
import { helpQuestion, parseVoiceBridge, voiceBridgeMessage, type VoiceBridgeMessage } from '../../../src/axf/core/engines/voice-command-rules.mjs';
import { Button, Note, TextField, useRuntime } from '../../../src/axf/react';
import type { AxfWebLibrary } from '../../../src/axf/react/library';
import { mollyApp } from '../../../src/molly/apps';
import { provideMollyService } from '../../../src/molly/host';
import helpPack from '../help.json';
import './voice.css';

/**
 * Voice (Molly plugin, its own folder): control every app by voice from Molly. What you say (the mic, the text box,
 * or a listener inside a framed app that posts a voice-bridge@1 `utterance`) goes to the Dev Console's frame, whose
 * Voice commands plugin matches it against every app's voice commands (voice-command@1), asks when a slot is missing
 * or the command deletes, runs it and answers. Molly speaks the answer back when the browser can. "What can I say
 * in Expenses?" lists that app's phrases. Removed, Molly has no voice; every app keeps its own.
 */

export const PLUGIN_ID = 'ai.amberx.axf.molly.voice-control';
const TAB = 'molly-voice-control';
const DIALOG = 'molly.voice';
/** The app whose frame answers (its Voice commands plugin), an app id from molly/apps.ts. */
const SOURCE = 'console';
const K = { speak: 'molly-voice.speak', lang: 'molly-voice.lang', listenFrames: 'molly-voice.listen-frames', autoOpen: 'molly-voice.auto-open' } as const;
const REPLY_MS = 20_000;

interface Reply { ok: boolean; code?: string; message?: string; pending?: string; question?: string; app?: string; command?: string; title?: string; slots?: Record<string, unknown>; missing?: string[]; say?: string; apps?: { app: string; header: string; commands: { id: string; line: string }[] }[] }
interface Line { who: 'you' | 'molly'; text: string }

/* ---------- the bridge to the console frame ---------- */

const waiting = new Map<string, { resolve: (r: Reply) => void; timer: ReturnType<typeof setTimeout> }>();
const consoleFrame = (): HTMLIFrameElement | null => document.querySelector<HTMLIFrameElement>(`iframe.molly-frame[data-app="${SOURCE}"]`);
const consoleOrigin = () => { const a = mollyApp(SOURCE); return a ? new URL(a.url).origin : ''; };

function sendToConsole(m: VoiceBridgeMessage): Promise<Reply> {
  const f = consoleFrame();
  if (!f?.contentWindow) return Promise.resolve({ ok: false, code: 'no_console', message: 'Open the Console once (it answers voice commands).' });
  return new Promise((resolve) => {
    const timer = setTimeout(() => { waiting.delete(m.id); resolve({ ok: false, code: 'timeout', message: 'The Console did not answer. Is it signed in?' }); }, REPLY_MS);
    waiting.set(m.id, { resolve, timer });
    f.contentWindow!.postMessage(m, consoleOrigin());
  });
}

/** Opens the Console frame (hidden is fine) and waits until its Voice commands plugin answers a ping. */
async function ensureConsole(rt: AxfRuntime): Promise<boolean> {
  if (!consoleFrame() && rt.settings.get(K.autoOpen) !== false) rt.navigate(SOURCE);
  for (let i = 0; i < 40; i++) {
    if (consoleFrame()?.contentWindow) {
      const r = await Promise.race([sendToConsole(voiceBridgeMessage('ping')), new Promise<Reply>((res) => setTimeout(() => res({ ok: false, code: 'timeout' }), 1500))]);
      if (r.ok) return true;
    }
    await new Promise((res) => setTimeout(res, 500));
  }
  return false;
}

/* ---------- the conversation store (dialog + listeners share it) ---------- */

const st = { lines: [] as Line[], pending: null as { id: string; question: string; missing: boolean } | null, busy: false, rev: 0 };
const subs = new Set<() => void>();
const changed = () => { st.rev++; subs.forEach((f) => f()); };
const useVoice = () => useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => st.rev, () => st.rev);
let runtime: AxfRuntime | null = null;

function speak(text: string) {
  const rt = runtime;
  if (!rt || rt.settings.get(K.speak) === false || !('speechSynthesis' in window) || !text) return;
  const u = new SpeechSynthesisUtterance(text.split('\n').slice(0, 6).join('. '));
  u.lang = String(rt.settings.get(K.lang) || 'en-US');
  window.speechSynthesis.cancel(); window.speechSynthesis.speak(u);
}

/** Say something (from the mic, the box or a listener): the whole flow, with the pending question when there is one. */
export async function say(text: string, by = 'molly'): Promise<Reply> {
  const rt = runtime;
  if (!rt || !text.trim()) return { ok: false, code: 'invalid' };
  st.lines.push({ who: 'you', text }); st.busy = true; changed();
  let r: Reply;
  if (!(await ensureConsole(rt))) r = { ok: false, code: 'no_console', message: 'The Console is not answering (open it once, signed in).' };
  else if (st.pending) r = await sendToConsole(voiceBridgeMessage('answer', { text, pending: st.pending.id, by }));
  else if (helpQuestion(text) !== null) r = await sendToConsole(voiceBridgeMessage('help', { app: helpQuestion(text) ?? '' }));
  else r = await sendToConsole(voiceBridgeMessage('say', { text, by }));
  st.busy = false;
  if (r.code === 'confirmation_required' && r.pending) { st.pending = { id: r.pending, question: r.question ?? '', missing: !!r.missing?.length }; st.lines.push({ who: 'molly', text: r.question ?? '' }); speak(r.question ?? ''); }
  else {
    st.pending = null;
    const answer = r.apps ? (r.apps.flatMap((a) => [a.header, ...a.commands.map((c) => c.line)]).join('\n') || 'No voice commands yet.') : (r.say ?? r.message ?? (r.ok ? 'Done.' : 'That did not run.'));
    st.lines.push({ who: 'molly', text: answer }); speak(answer);
  }
  st.lines = st.lines.slice(-40); changed();
  return r;
}

/* ---------- speech recognition ---------- */

type Recognition = { lang: string; interimResults: boolean; maxAlternatives: number; onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null; onend: (() => void) | null; onerror: ((e: { error?: string }) => void) | null; start(): void; stop(): void };
const recognizer = (lang: string): Recognition | null => {
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  if (!Ctor) return null;
  const r = new Ctor(); r.lang = lang; r.interimResults = false; r.maxAlternatives = 1; return r;
};
const canListen = () => { const w = window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown }; return !!(w.SpeechRecognition ?? w.webkitSpeechRecognition); };

/* ---------- the dialog ---------- */

function VoiceDialog() {
  const rt = useRuntime();
  useVoice();
  const [text, setText] = useState('');
  const [listening, setListening] = useState(false);
  const rec = useRef<Recognition | null>(null);
  const end = useRef<HTMLLIElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [st.rev]);
  const submit = () => { const t = text.trim(); if (!t) return; setText(''); void say(t); };
  const listen = () => {
    if (listening) { rec.current?.stop(); return; }
    const r = recognizer(String(rt.settings.get(K.lang) || 'en-US'));
    if (!r) { rt.toast('This browser has no speech recognition; type the command.', 'info', 'Voice'); return; }
    rec.current = r;
    r.onresult = (e) => { const t = e.results[0]?.[0]?.transcript ?? ''; if (t) void say(t); };
    r.onend = () => setListening(false);
    r.onerror = (e) => { setListening(false); if (e.error !== 'no-speech') rt.toast(`Could not listen: ${e.error ?? 'error'}`, 'danger', 'Voice'); };
    setListening(true); r.start();
  };
  const apps = ['expenses', 'console', 'amberx', 'axhub', 'molly'];
  return (
    <div className="molly-voice" data-help="molly-voice">
      <form className="molly-voice__say" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <TextField label={st.pending ? st.pending.question : 'Say a command'} value={text} onChange={setText} placeholder={st.pending ? (st.pending.missing ? 'the value' : 'yes or no') : 'add 12.50 dunkin food · list expenses · what can I say in expenses?'} autoFocus />
        <Button type="submit" tone="primary" icon="send" busy={st.busy} data-help="molly-voice-send">{st.pending ? 'Answer' : 'Say it'}</Button>
        {canListen() && <Button type="button" icon="mic" tone={listening ? 'primary' : 'neutral'} className={listening ? 'molly-voice__listening' : ''} onClick={listen} data-help="molly-voice-mic">{listening ? 'Listening…' : 'Speak'}</Button>}
      </form>
      {st.pending && !st.pending.missing && (
        <div className="molly-voice__question">
          <Button size="sm" tone="success" icon="check" onClick={() => void say('yes')} data-help="molly-voice-yes">Yes</Button>
          <Button size="sm" tone="danger" icon="x" onClick={() => void say('no')} data-help="molly-voice-no">No</Button>
        </div>
      )}
      <ul className="molly-voice__log" aria-live="polite">
        {st.lines.map((l, i) => <li key={i} className={l.who === 'you' ? 'molly-voice__you' : 'molly-voice__answer'}>{l.who === 'you' ? `You: ${l.text}` : l.text}</li>)}
        <li ref={end} />
      </ul>
      {!st.lines.length && <Note tone="info">Reads and opening screens run at once. Adding or changing something asks only for what is missing. Deleting always asks first.</Note>}
      <div className="molly-voice__apps" data-help="molly-voice-apps">
        {apps.map((a) => <Button key={a} size="sm" onClick={() => void say(`what can I say in ${a}?`)}>What can I say in {a}?</Button>)}
      </div>
    </div>
  );
}

function SettingsPanel() {
  return (
    <div className="fx-stack">
      <p>Molly talks to the apps through the Dev Console's Voice commands plugin: every app's phrases live in its own <code>voice-command</code> asset, generated from its API, MCP tools, CLI and actions.</p>
      <Button icon="mic" onClick={() => runtime?.openDialog(DIALOG, {})} data-help="molly-voice-open">Say a command…</Button>
    </div>
  );
}

/* ---------- messages: the console's replies, and listeners inside framed apps ---------- */

function installMessages(rt: AxfRuntime) {
  window.addEventListener('message', (e: MessageEvent) => {
    const m = parseVoiceBridge(e.data);
    if (!m) return;
    if ((m.type === 'result' || m.type === 'pong') && e.origin === consoleOrigin()) {
      const w = waiting.get(m.id);
      if (w) { clearTimeout(w.timer); waiting.delete(m.id); w.resolve(m.type === 'pong' ? { ok: true } : (m as unknown as Reply)); }
      return;
    }
    // a listener inside a framed app (AmberX's listener, Gizmo) heard something: Molly runs it like a tap on the mic
    if (m.type === 'utterance' && rt.settings.get(K.listenFrames) !== false) {
      const frames = [...document.querySelectorAll<HTMLIFrameElement>('iframe.molly-frame')];
      if (!frames.some((f) => f.contentWindow === e.source)) return;
      const app = frames.find((f) => f.contentWindow === e.source)?.dataset.app ?? 'app';
      rt.openDialog(DIALOG, {});
      void say(m.text, `listener:${app}`);
    }
  });
}

export const plugin: AxfWebLibrary = {
  id: PLUGIN_ID,
  label: 'Voice control',
  version: '0.1.0',
  builtWith: { model: 'fable', builtAt: '2026-11-04' },
  help: helpPack.data as AxfWebLibrary['help'],
  appMenu: [{ id: 'molly-voice.menu', menu: 'molly', menuLabel: 'Molly', menuOrder: 10, order: 30, items: [{ id: 'molly-voice', label: 'Say a command…', icon: 'mic', action: 'molly.voice' }] }],
  register(rt) {
    runtime = rt;
    rt.actions.register('molly.voice', () => rt.openDialog(DIALOG, {}), { label: 'Say a command (voice)' });
    installMessages(rt);
    const stop = provideMollyService(PLUGIN_ID, 'axf.voice@1', { say: (text: string, by?: string) => say(text, by), open: () => rt.openDialog(DIALOG, {}) });
    return () => { stop(); };
  },
  dialogs: { [DIALOG]: { title: 'Say a command', icon: 'mic', render: () => <VoiceDialog /> } },
  settingsTabs: [{ id: TAB, label: 'Voice control', icon: 'mic', order: 64, parent: 'plugins', description: 'Control every app by voice from Molly' }],
  settings: [{
    id: 'molly-voice.prefs', label: 'Voice control', icon: 'mic', tab: TAB, order: 10,
    description: 'How Molly listens and answers.',
    settings: [
      { key: K.speak, label: 'Speak the answers', kind: 'toggle', default: true, scope: 'device', description: 'Read answers and questions aloud.' },
      { key: K.lang, label: 'Language', kind: 'text', default: 'en-US', scope: 'device', description: 'The language the mic listens in and answers are spoken in (a BCP 47 tag).' },
      { key: K.listenFrames, label: 'Take what a framed app heard', kind: 'toggle', default: true, scope: 'device', description: 'A listener inside AmberX or Gizmo may hand Molly what it heard (a voice-bridge@1 utterance); off = only the mic and the box here.' },
      { key: K.autoOpen, label: 'Open the Console when needed', kind: 'toggle', default: true, scope: 'device', description: 'The Console frame answers voice commands; open it by itself when it is not loaded yet.' },
    ],
  }],
  settingsPanels: [{ id: 'molly-voice.panel', tab: TAB, title: 'Voice', icon: 'mic', order: 5, render: () => <SettingsPanel /> }],
};
