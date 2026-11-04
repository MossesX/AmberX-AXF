/**
 * Voice commands (web part): the page that lists what you can say to every app (voice-command@1), a box to say or
 * type a command (the mic when the browser has speech recognition), the confirm / missing-slot questions, and the
 * bridge Molly (or any host) uses: a `voice-bridge@1` postMessage from an allowed parent origin runs the same flow
 * through this console's server and gets the answer back. Settings → Plugins → Voice commands: mic, spoken answers,
 * language, allowed host origins, the last runs.
 */
import { useEffect, useRef, useState } from 'react';
import type { AxfRuntime } from '@console/axf/core';
import { Button, Chip, Container, Note, TextField, useRuntime, type AxfWebLibrary } from '@console/axf/react';
import { helpQuestion, parseVoiceBridge, voiceBridgeMessage, type VoiceBridgeMessage } from '@console/axf/core/engines/voice-command-rules.mjs';
import { pluginFetch } from '@console/plugins';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import { appMenu } from './menu';
import './voice-commands.css';

const ID = 'ai.amberx.axf.console.voice-commands';
const FOLDER = 'voice-commands';
const K = { mic: 'voice-commands.mic', speak: 'voice-commands.speak', lang: 'voice-commands.lang', origins: 'voice-commands.origins' } as const;
const DEFAULT_ORIGINS = 'https://molly.amberxai.com';

interface RunResult { ok: boolean; code?: string; message?: string; pending?: string; question?: string; app?: string; command?: string; title?: string; slots?: Record<string, unknown>; missing?: string[]; result?: unknown; say?: string; via?: string }
interface HelpApp { app: string; header: string; commands: { id: string; line: string }[] }

const post = <T,>(path: string, body: unknown) => pluginFetch(FOLDER, path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json() as Promise<T>);
const get = <T,>(path: string) => pluginFetch(FOLDER, path).then((r) => r.json() as Promise<T>);

/** One flow for the page, the mic and the bridge: say → (question → answer) → answer text. */
export async function sayCommand(text: string, opts: { app?: string; pending?: string; answer?: string; by?: string } = {}): Promise<RunResult> {
  const q = helpQuestion(text);
  if (q !== null && !opts.pending) {
    const h = await get<{ apps: HelpApp[] }>(`help?app=${encodeURIComponent(q)}`);
    const lines = h.apps.flatMap((a) => [a.header, ...a.commands.map((c) => c.line)]);
    return { ok: true, command: 'help', say: lines.length ? lines.join('\n') : q ? `I know no app called ${q}.` : 'No voice commands yet.', result: h.apps };
  }
  return post<RunResult>('run', { text, app: opts.app ?? '', pending: opts.pending ?? '', answer: opts.answer ?? '', by: opts.by ?? 'console' });
}

/* ---------------- speech: recognition in, synthesis out (when the browser has them) ---------------- */

type Recognition = { lang: string; interimResults: boolean; maxAlternatives: number; onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null; onend: (() => void) | null; onerror: ((e: { error?: string }) => void) | null; start(): void; stop(): void };
const recognizer = (lang: string): Recognition | null => {
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  if (!Ctor) return null;
  const r = new Ctor(); r.lang = lang; r.interimResults = false; r.maxAlternatives = 1; return r;
};
export const canListen = () => !!((window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown }).SpeechRecognition ?? (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition);
function speak(rt: AxfRuntime, text: string) {
  if (rt.settings.get(K.speak) === false || !('speechSynthesis' in window) || !text) return;
  const u = new SpeechSynthesisUtterance(text.split('\n').slice(0, 6).join('. '));
  u.lang = String(rt.settings.get(K.lang) || 'en-US');
  window.speechSynthesis.cancel(); window.speechSynthesis.speak(u);
}

/* ---------------- the say box (page + dialog share it) ---------------- */

function SayBox({ app = '' }: { app?: string }) {
  const rt = useRuntime();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [last, setLast] = useState<RunResult | null>(null);
  const [pending, setPending] = useState<{ id: string; question: string; missing: boolean } | null>(null);
  const rec = useRef<Recognition | null>(null);

  const send = async (t: string, answer = false) => {
    if (!t.trim()) return;
    setBusy(true);
    try {
      const r = answer && pending ? await sayCommand(t, { pending: pending.id, answer: t, app }) : await sayCommand(t, { app });
      setLast(r);
      if (r.code === 'confirmation_required' && r.pending) { setPending({ id: r.pending, question: r.question ?? '', missing: !!r.missing?.length }); speak(rt, r.question ?? ''); }
      else { setPending(null); speak(rt, r.say ?? r.message ?? ''); }
      setText('');
    } catch (e) { setLast({ ok: false, message: e instanceof Error ? e.message : String(e) }); }
    finally { setBusy(false); }
  };
  const listen = () => {
    if (listening) { rec.current?.stop(); return; }
    const r = recognizer(String(rt.settings.get(K.lang) || 'en-US'));
    if (!r) { rt.toast('This browser has no speech recognition; type the command instead.', 'info', 'Voice commands'); return; }
    rec.current = r;
    r.onresult = (e) => { const t = e.results[0]?.[0]?.transcript ?? ''; setText(t); void send(t, !!pending); };
    r.onend = () => setListening(false);
    r.onerror = (e) => { setListening(false); if (e.error !== 'no-speech') rt.toast(`Could not listen: ${e.error ?? 'error'}`, 'danger', 'Voice commands'); };
    setListening(true); r.start();
  };
  const micOn = rt.settings.get(K.mic) !== false;
  return (
    <div className="axp-voice__answer">
      <form className="axp-voice__say" onSubmit={(e) => { e.preventDefault(); void send(text, !!pending); }}>
        <TextField label={pending ? pending.question : app ? `Say something to ${app}` : 'Say a command'} value={text} onChange={setText} placeholder={pending ? (pending.missing ? 'the value' : 'yes or no') : 'add 12.50 dunkin food · list expenses · open builds · what can I say in expenses?'} />
        <Button type="submit" tone="primary" icon="send" busy={busy} data-help="voice-send">{pending ? 'Answer' : 'Say it'}</Button>
        {micOn && canListen() && <Button type="button" icon="mic" tone={listening ? 'primary' : 'neutral'} onClick={listen} data-help="voice-mic" className={listening ? 'axp-voice__listening' : ''}>{listening ? 'Listening…' : 'Speak'}</Button>}
      </form>
      {pending && !pending.missing && (
        <div className="axp-voice__question">
          <span>{pending.question}</span>
          <Button size="sm" tone="success" icon="check" onClick={() => void send('yes', true)} data-help="voice-yes">Yes</Button>
          <Button size="sm" tone="danger" icon="x" onClick={() => void send('no', true)} data-help="voice-no">No</Button>
        </div>
      )}
      {last && !(last.code === 'confirmation_required') && (
        <Note tone={last.ok ? 'success' : 'warning'} icon={last.ok ? 'check' : 'alert'}>
          <div>{last.say ?? last.message ?? (last.ok ? 'Done.' : 'That did not run.')}</div>
          {last.command && last.command !== 'help' && <div className="axp-voice__muted">{last.app} · {last.command}{last.via ? ` · ${last.via}` : ''}{last.slots && Object.keys(last.slots).length ? ` · ${Object.entries(last.slots).map(([k, v]) => `${k} ${String(v)}`).join(', ')}` : ''}</div>}
          {last.ok && last.result !== undefined && last.command !== 'help' && <pre className="axp-voice__result">{JSON.stringify(last.result, null, 1).slice(0, 4000)}</pre>}
        </Note>
      )}
    </div>
  );
}

/* ---------------- the page ---------------- */

function VoicePage() {
  const [apps, setApps] = useState<HelpApp[]>([]);
  const [pick, setPick] = useState('');
  const [q, setQ] = useState('');
  const [error, setError] = useState('');
  useEffect(() => { get<{ apps: HelpApp[] }>('help').then((h) => setApps(h.apps ?? [])).catch((e) => setError(e instanceof Error ? e.message : String(e))); }, []);
  const shown = apps.filter((a) => !pick || a.app === pick);
  const needle = q.trim().toLowerCase();
  return (
    <div className="axp-voice" data-help="voice-page">
      <header className="fx-pagehead"><div><p className="fx-eyebrow">Plugin · voice-command@1</p><h1>Voice commands</h1><p className="fx-muted">Say or type a command to any app; every app lists what it understands.</p></div></header>
      <Container title="Say a command" icon="mic">
        <SayBox app={pick} />
      </Container>
      <Container title="What can I say" icon="list" actions={<TextField label="Find" value={q} onChange={setQ} placeholder="filter" />}>
        {error && <Note tone="warning">{error}</Note>}
        <div className="axp-voice__apps" data-help="voice-apps">
          <Button size="sm" tone={pick ? 'neutral' : 'primary'} onClick={() => setPick('')}>Every app</Button>
          {apps.map((a) => <Button key={a.app} size="sm" tone={pick === a.app ? 'primary' : 'neutral'} onClick={() => setPick(a.app)}>{a.app} <Chip>{a.commands.length}</Chip></Button>)}
        </div>
        {shown.map((a) => (
          <Container key={a.app} title={a.header} collapsible defaultOpen={!!pick || apps.length === 1}>
            <ul className="axp-voice__list">
              {a.commands.filter((c) => !needle || c.line.toLowerCase().includes(needle) || c.id.includes(needle)).slice(0, 400).map((c) => (
                <li key={c.id} className="axp-voice__row"><span className="axp-voice__example">{c.line.split(' — ')[0]}</span><span className="axp-voice__muted">{c.line.split(' — ').slice(1).join(' — ')} · {c.id}</span></li>
              ))}
            </ul>
          </Container>
        ))}
        {!apps.length && !error && <p className="axp-voice__muted">No voice commands yet: run <code>node framework/cli/voice-commands.mjs generate &lt;app&gt; --write</code> for a forFramework app.</p>}
      </Container>
    </div>
  );
}

function RecentPanel() {
  const [runs, setRuns] = useState<{ at: string; by: string; text: string; app: string; command: string; ok: boolean; say: string }[]>([]);
  useEffect(() => { get<{ runs: typeof runs }>('recent?limit=30').then((r) => setRuns(r.runs ?? [])).catch(() => setRuns([])); }, []);
  return runs.length ? (
    <ul className="axp-voice__list" data-help="voice-recent">
      {runs.map((r, i) => <li key={i} className="axp-voice__row"><span className="axp-voice__example">{r.text}</span><span className="axp-voice__muted">{r.app} · {r.command} · {r.by} · {r.at}{r.ok ? '' : ' · failed'}</span></li>)}
    </ul>
  ) : <p className="axp-voice__muted">Nothing run yet.</p>;
}

/* ---------------- the bridge: Molly (a host) talks to this console frame ---------------- */

function allowedOrigin(rt: AxfRuntime, origin: string): boolean {
  if (origin === window.location.origin) return true;
  const list = String(rt.settings.get(K.origins) ?? DEFAULT_ORIGINS).split(/[,\s]+/).map((s) => s.trim().replace(/\/$/, '')).filter(Boolean);
  return list.includes(origin);
}

function installBridge(rt: AxfRuntime) {
  if (window.parent === window) return;
  window.addEventListener('message', (e: MessageEvent) => {
    const m = parseVoiceBridge(e.data);
    if (!m || !allowedOrigin(rt, e.origin) || !e.source) return;
    const reply = (fields: Record<string, unknown>) => (e.source as Window).postMessage(voiceBridgeMessage('result', { id: m.id, ...fields }), e.origin);
    if (m.type === 'ping') { (e.source as Window).postMessage(voiceBridgeMessage('pong', { id: m.id }), e.origin); return; }
    if (m.type === 'help') { get<{ apps: HelpApp[] }>(`help?app=${encodeURIComponent(m.app)}`).then((h) => reply({ ok: true, apps: h.apps })).catch((err) => reply({ ok: false, message: String(err) })); return; }
    if (m.type === 'say' || m.type === 'utterance') { sayCommand(m.text, { app: m.app, by: String(m.by ?? 'molly') }).then((r) => reply(r as unknown as Record<string, unknown>)).catch((err) => reply({ ok: false, message: String(err) })); return; }
    if (m.type === 'answer') { sayCommand(m.text, { pending: String(m.pending ?? ''), answer: m.text, by: String(m.by ?? 'molly') }).then((r) => reply(r as unknown as Record<string, unknown>)).catch((err) => reply({ ok: false, message: String(err) })); }
  });
}

/* ---------------- settings panel ---------------- */

function SettingsPanel() {
  return (
    <div className="fx-stack">
      <p className="axp-voice__muted">Every app's commands come from its <code>src/assets/voice-command/&lt;app&gt;.json</code>, generated from its API, MCP tools, CLI and actions (<code>node framework/cli/voice-commands.mjs generate &lt;app&gt; --write</code>). Reads and navigation run at once; a write asks only for what is missing; anything that deletes asks first.</p>
      <SayBox />
    </div>
  );
}

export const plugin: AxfWebLibrary = {
  id: ID,
  label: 'Voice commands',
  version: '0.1.0',
  builtWith: { model: 'fable', builtAt: '2026-11-04' },
  appMenu,
  register(rt) {
    rt.actions.register('voice-commands.open', () => rt.navigate('voice-commands'), { label: 'Voice commands' });
    rt.actions.register('voice-commands.listen', () => rt.openDialog('voice-commands.say', {}), { label: 'Say a command…' });
    installBridge(rt);
  },
  views: { [FOLDER]: { title: 'Voice commands', icon: 'mic', keywords: ['voice', 'say', 'speak', 'mic', 'commands', 'molly'], render: () => <VoicePage /> } },
  nav: { label: 'Plugins', items: [{ id: FOLDER, label: 'Voice commands', icon: 'mic', view: FOLDER }] },
  dialogs: { 'voice-commands.say': { title: 'Say a command', icon: 'mic', render: () => <SayBox /> } },
  settingsTabs: [{ id: FOLDER, label: 'Voice commands', icon: 'mic', order: 93, parent: 'plugins', description: 'Mic, spoken answers, hosts allowed to talk to this console' }],
  settings: [{
    id: 'voice-commands.prefs', label: 'Voice commands', icon: 'mic', tab: FOLDER, order: 10,
    description: 'How you talk to the apps from this console.',
    settings: [
      { key: K.mic, label: 'Microphone button', kind: 'toggle', default: true, scope: 'device', description: 'Show the Speak button where the browser can listen (speech recognition).' },
      { key: K.speak, label: 'Speak the answers', kind: 'toggle', default: true, scope: 'device', description: 'Read answers and questions aloud (speech synthesis).' },
      { key: K.lang, label: 'Language', kind: 'text', default: 'en-US', scope: 'device', description: 'The language the mic listens in and answers are spoken in (a BCP 47 tag).' },
      { key: K.origins, label: 'Hosts allowed to talk to this console', kind: 'text', default: DEFAULT_ORIGINS, scope: 'device', description: 'Origins (comma-separated) whose page may frame this console and send voice commands through it: Molly by default.' },
    ],
  }],
  settingsPanels: [
    { id: 'voice-commands.try', tab: FOLDER, title: 'Try it', icon: 'mic', order: 5, render: () => <SettingsPanel /> },
    { id: 'voice-commands.recent', tab: FOLDER, title: 'Last commands', icon: 'history', order: 20, render: () => <RecentPanel /> },
    { id: 'voice-commands.lifecycle', tab: FOLDER, title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> },
  ],
};

export type { VoiceBridgeMessage };
