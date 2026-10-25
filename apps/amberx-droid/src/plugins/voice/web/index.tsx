/**
 * Voice control: say a wake phrase (the Android watch service hears it with the screen off) or tap the mic, say what you
 * want, and AmberX runs it and answers out loud. Commands are data (`core.ts`): the built-in ones below, ones other
 * plugins add with `registerVoiceCommands`, and the user's own from Settings → Plugins → Voice control.
 */
import { useEffect, useSyncExternalStore } from 'react';
import type { AxfRuntime } from '../../../axf/core';
import { Button, Note, Section, useRuntime, type AxfWebLibrary } from '../../../axf/react';
import { isNative, native } from '../../../native';
import { afterWake, fillReply, parseUserCommands, phraseList, pickCommand, type VoiceCommand } from './core';

export const K = {
  wake: 'amberx.voice.wake',
  lang: 'amberx.voice.lang',
  speak: 'amberx.voice.speak',
  commands: 'amberx.voice.commands',
} as const;

const ID = 'ai.amberx.amberx.voice';

/** What every build understands. Other plugins add theirs with registerVoiceCommands. */
const BUILT_IN: VoiceCommand[] = [
  { id: 'approvals.count', phrases: ['whats waiting', 'what is waiting', 'how many approvals', 'any approvals', 'anything waiting'], action: 'axhub.check', reply: 'You have {waiting} waiting.' },
  { id: 'approvals.open', phrases: ['open approvals', 'show approvals', 'approvals'], action: 'nav:home', reply: 'Here are your approvals.' },
  { id: 'approvals.review', phrases: ['review the first', 'review first approval', 'open the first approval'], action: 'amberx.review-first' },
  { id: 'hub.open', phrases: ['open the hub', 'show the hub', 'hub'], action: 'nav:hub' },
  { id: 'apps.open', phrases: ['open apps', 'show apps', 'downloads'], action: 'nav:apps', reply: 'Here are the apps.' },
  { id: 'monitor.open', phrases: ['open monitor', 'monitoring', 'show monitor'], action: 'nav:monitor' },
  { id: 'monitor.start', phrases: ['start monitoring', 'start watching', 'watch the hub'], action: 'monitor.start', reply: 'Watching the hub.' },
  { id: 'monitor.stop', phrases: ['stop monitoring', 'stop watching'], action: 'monitor.stop', reply: 'Stopped watching.' },
  { id: 'settings.open', phrases: ['open settings', 'settings'], action: 'app.settings' },
  { id: 'look.next', phrases: ['next theme', 'change colors', 'change the colors'], action: 'swap:color-theme:next' },
  { id: 'help', phrases: ['what can you do', 'help'], action: 'nav:voice', reply: 'Here is everything I understand.' },
];

const fromPlugins = new Map<string, VoiceCommand[]>();
/** Adds commands for a plugin (replacing its earlier ones); returns a remover. */
export function registerVoiceCommands(module: string, commands: VoiceCommand[]): () => void {
  fromPlugins.set(module, commands.map((c) => ({ ...c, module })));
  return () => { fromPlugins.delete(module); };
}

export function allCommands(rt: AxfRuntime): VoiceCommand[] {
  return [...parseUserCommands(rt.settings.get(K.commands)).commands, ...[...fromPlugins.values()].flat(), ...BUILT_IN.map((c) => ({ ...c, module: ID }))];
}

/* ---------------------------------------------------------------- the conversation log (this session only) */

type Turn = { at: string; heard: string; did: string; ok: boolean };
type State = { busy: boolean; turns: Turn[] };
let state: State = { busy: false, turns: [] };
const subs = new Set<() => void>();
const set = (patch: Partial<State>) => { state = { ...state, ...patch }; subs.forEach((f) => f()); };
const useVoice = () => useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => state);

const str = (v: unknown, d: string) => (typeof v === 'string' && v.trim() ? v.trim() : d);

async function say(rt: AxfRuntime, text: string) {
  if (rt.settings.get(K.speak) !== false && text) await native.speak({ text, lang: str(rt.settings.get(K.lang), 'en-US') }).catch(() => undefined);
}

/** Runs what was heard: picks a command, dispatches it, answers. Exported for the wake event and tests of the flow. */
export async function handle(rt: AxfRuntime, heardRaw: string): Promise<Turn> {
  const heard = afterWake(heardRaw, phraseList(rt.settings.get(K.wake)));
  const at = new Date().toISOString();
  let turn: Turn;
  if (!heard) turn = { at, heard: heardRaw, did: 'Heard nothing.', ok: false };
  else {
    const m = pickCommand(heard, allCommands(rt));
    if (!m) {
      turn = { at, heard, did: "I didn't catch a command.", ok: false };
      await say(rt, "Sorry, I don't know that one.");
    } else {
      const ran = m.command.action ? rt.dispatch(m.command.action) : true;
      // Let a check finish before reading the count back.
      if (m.command.reply?.includes('{waiting}')) await new Promise((r) => setTimeout(r, 1200));
      const reply = m.command.reply ? fillReply(m.command.reply, { waiting: rt.badge('approvals.waiting') }) : '';
      turn = { at, heard, did: ran ? reply || `Ran ${m.command.action}.` : `${m.command.action} isn't available.`, ok: ran };
      await say(rt, ran ? reply : "That isn't available here.");
    }
  }
  set({ turns: [turn, ...state.turns].slice(0, 30) });
  return turn;
}

export async function listenOnce(rt: AxfRuntime) {
  if (state.busy) return;
  set({ busy: true });
  try {
    const { text } = await native.listen({ lang: str(rt.settings.get(K.lang), 'en-US') });
    await handle(rt, text);
  } catch (e) {
    rt.toast(e instanceof Error ? e.message : String(e), 'danger', 'Voice');
  } finally {
    set({ busy: false });
  }
}

/* ---------------------------------------------------------------- view */

function VoiceView() {
  const rt = useRuntime();
  const v = useVoice();
  const wake = phraseList(rt.settings.get(K.wake));
  const { errors } = parseUserCommands(rt.settings.get(K.commands));
  const commands = allCommands(rt);
  useEffect(() => { void native.permissions().catch(() => undefined); }, []);
  return (
    <div className="fx-stack fx-stack--lg">
      <header className="fx-pagehead">
        <div>
          <p className="fx-eyebrow">Voice control</p>
          <h1>{v.busy ? 'Listening…' : 'Talk to AmberX'}</h1>
          <p className="fx-muted">
            Tap the mic and say what you want{wake.length ? <>, or say “{wake[0]}” with the app closed</> : null}.
          </p>
        </div>
        <Button tone="primary" icon="mic" disabled={v.busy} onClick={() => void listenOnce(rt)}>{v.busy ? 'Listening…' : 'Speak'}</Button>
      </header>
      {!isNative() && <Note tone="info">In a browser the mic works while this page is open. The Android app also listens with the screen off.</Note>}
      {errors.length > 0 && <Note tone="warning">{errors.join(' ')}</Note>}
      <Section title="Just now">
        {v.turns.length === 0 ? <p className="fx-muted">Nothing said yet.</p> : (
          <table className="fx-table"><tbody>
            {v.turns.map((t) => (
              <tr key={t.at}>
                <td>“{t.heard}”</td>
                <td className="fx-muted">{t.ok ? '' : '✗ '}{t.did}</td>
              </tr>
            ))}
          </tbody></table>
        )}
      </Section>
      <Section title={`What you can say (${commands.length})`}>
        <table className="fx-table"><tbody>
          {commands.map((c) => (
            <tr key={`${c.module}:${c.id}`}>
              <td>“{c.phrases[0]}”{c.phrases.length > 1 ? <span className="fx-muted"> or {c.phrases.slice(1, 3).map((p) => `“${p}”`).join(', ')}</span> : null}</td>
              <td className="fx-mono fx-muted">{c.action || 'reply'}</td>
            </tr>
          ))}
        </tbody></table>
      </Section>
    </div>
  );
}

/* ---------------------------------------------------------------- library */

export const library: AxfWebLibrary = {
  id: ID,
  label: 'Voice control',
  version: '0.1.0',
  builtWith: { model: 'opus', builtAt: '2026-10-25' },
  provides: ['amberx.voice'],
  views: { voice: { title: 'Voice', icon: 'mic', keywords: ['voice', 'speak', 'talk', 'command', 'wake'], render: () => <VoiceView /> } },
  nav: { label: 'Voice', items: [{ id: 'voice', label: 'Voice', icon: 'mic', view: 'voice' }] },
  settingsTabs: [{ id: 'voice', label: 'Voice control', icon: 'mic', order: 20, parent: 'plugins' }],
  settings: [
    {
      id: 'amberx.voice', label: 'Voice control', icon: 'mic', tab: 'voice', settings: [
        { key: K.wake, label: 'Wake phrases', kind: 'text', default: 'hey amberx, okay amberx', description: 'Comma separated. Heard by the Android app with the screen off (Monitoring → Listen in the background).' },
        { key: K.lang, label: 'Language', kind: 'text', default: 'en-US', description: 'For recognition and spoken replies, e.g. en-US, en-GB.' },
        { key: K.speak, label: 'Answer out loud', kind: 'toggle', default: true },
        { key: K.commands, label: 'Your own commands', kind: 'text', default: '', description: 'One per line: phrase, other phrase = action | reply. Example: open alerts = nav:monitor | Here you go.' },
      ],
    },
  ],
  contextMenu: [{ id: 'amberx.voice', items: [{ id: 'voice.listen', label: 'Speak a command', icon: 'mic', action: 'voice.listen' }] }],
  appMenu: [{ id: 'amberx.voice', menu: 'axhub', items: [{ id: 'voice.listen', label: 'Speak a command', icon: 'mic', action: 'voice.listen' }] }],
  register(rt) {
    rt.actions.register('voice.listen', () => void listenOnce(rt), { label: 'Speak a command' });
    // The watch service heard the wake phrase with the app closed: the rest of the sentence may already be the command.
    void native.addListener('wake', ({ text }) => {
      const rest = afterWake(text ?? '', phraseList(rt.settings.get(K.wake)));
      if (rest) void handle(rt, rest);
      else void say(rt, 'Yes?').then(() => listenOnce(rt));
    }).catch(() => undefined);
  },
};
