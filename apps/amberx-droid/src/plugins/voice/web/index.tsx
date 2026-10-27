/**
 * Voice control: say a wake phrase or tap the mic, say what you want, and AmberX runs it and answers out loud.
 * Hands-free (on by default, Oct 27 2026) keeps listening on screen and in the background without pressing Speak; on
 * Android the detection overlay shows the input level, dB, what was heard and quick settings over other apps
 * (`handsfree.ts`, `WatchService.java`, `DetectionOverlay.java`). Commands are data (`core.ts`): the built-in ones below, ones other
 * plugins add with `registerVoiceCommands`, and the user's own from Settings → Plugins → Voice control.
 */
import { useEffect, useSyncExternalStore } from 'react';
import type { AxfRuntime } from '../../../axf/core';
import { Button, Note, Section, Switch, useRuntime, type AxfWebLibrary } from '../../../axf/react';
import { isNative, native, type VoiceStatus } from '../../../native';
import { afterWake, fillReply, normalize, parseUserCommands, phraseList, pickCommand, type VoiceCommand } from './core';
import { dbText, graphPoints, interpretHeard, levelOf, listens, overlayColors, pushLevel, voiceConfig, type VoiceConfig } from './handsfree';

export const K = {
  wake: 'amberx.voice.wake',
  lang: 'amberx.voice.lang',
  speak: 'amberx.voice.speak',
  commands: 'amberx.voice.commands',
  handsFree: 'amberx.voice.handsFree',
  alwaysArmed: 'amberx.voice.alwaysArmed',
  overlay: 'amberx.voice.overlay',
} as const;

const ID = 'ai.amberx.amberx.voice';

/** What every build understands. Other plugins add theirs with registerVoiceCommands. */
const BUILT_IN: VoiceCommand[] = [
  { id: 'approvals.count', phrases: ['whats waiting', 'what is waiting', 'how many approvals', 'any approvals', 'anything waiting'], action: 'axhub.check', reply: 'You have {waiting} waiting.' },
  { id: 'approvals.open', phrases: ['open approvals', 'show approvals', 'approvals'], action: 'nav:home', reply: 'Here are your approvals.' },
  { id: 'approvals.review', phrases: ['review the first', 'review first approval', 'open the first approval'], action: 'amberx.review-first' },
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
type State = { busy: boolean; turns: Turn[]; levels: number[]; db: number; heard: string; heardFinal: boolean; status: VoiceStatus | null };
let state: State = { busy: false, turns: [], levels: [], db: -Infinity, heard: '', heardFinal: false, status: null };

/** Set while Speak (or "Yes?") waits for the next thing hands-free hears; it receives that text. */
let nextHeard: ((text: string) => void) | null = null;
const ASK_MS = 8000;
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

/** With hands-free listening, Speak never opens a second recognizer (that would pause hands-free): the next thing heard
 * is the command. Without it, one native utterance as before. */
async function nextCommand(rt: AxfRuntime): Promise<string> {
  if (listens(configOf(rt)) && state.status?.listening) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => { nextHeard = null; resolve(''); }, ASK_MS);
      nextHeard = (text) => { clearTimeout(timer); nextHeard = null; resolve(text); };
    });
  }
  return (await native.listen({ lang: str(rt.settings.get(K.lang), 'en-US') })).text;
}

export async function listenOnce(rt: AxfRuntime) {
  if (state.busy) return;
  set({ busy: true });
  try {
    const text = await nextCommand(rt);
    await handle(rt, text);
  } catch (e) {
    rt.toast(e instanceof Error ? e.message : String(e), 'danger', 'Voice');
  } finally {
    set({ busy: false });
  }
}

/* ---------------------------------------------------------------- hands-free */

/** The overlay's colours from the app's theme tokens (the native side can't read CSS). */
function themeColors() {
  if (typeof document === 'undefined') return overlayColors({});
  const css = getComputedStyle(document.documentElement);
  const v = (n: string) => css.getPropertyValue(`--fx-${n}`).trim();
  return overlayColors({ bg: v('surface'), fg: v('text'), accent: v('accent'), muted: v('muted'), danger: v('danger') });
}

export function configOf(rt: AxfRuntime): VoiceConfig {
  return voiceConfig({
    handsFree: rt.settings.get(K.handsFree), alwaysArmed: rt.settings.get(K.alwaysArmed), overlay: rt.settings.get(K.overlay),
    wake: phraseList(rt.settings.get(K.wake)), lang: rt.settings.get(K.lang),
  }, themeColors());
}

async function syncNative(rt: AxfRuntime, cfg: VoiceConfig) {
  try { set({ status: await native.voiceSet(cfg) }); } catch (e) { rt.toast(e instanceof Error ? e.message : String(e), 'warning', 'Hands-free'); }
}

async function allowOverlay(rt: AxfRuntime) {
  const { allowed } = await native.overlayPermission().catch(() => ({ allowed: false }));
  if (!allowed) rt.toast('Allow “Display over other apps” for AmberX to see the detection overlay.', 'info', 'Overlay');
  void native.voiceStatus().then((st) => set({ status: st })).catch(() => undefined);
}

/** The moving input-level line + dB, drawn with theme tokens only. */
function LevelGraph({ levels, db }: { levels: number[]; db: number }) {
  const w = 240, h = 48;
  return (
    <div className="fx-row" style={{ alignItems: 'center', gap: 'var(--fx-space)' }}>
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`Input level ${dbText(db)}`}>
        <line x1={0} y1={h - 1} x2={w} y2={h - 1} stroke="var(--fx-border)" strokeWidth={1} />
        <polyline points={graphPoints(levels, w, h - 2)} fill="none" stroke="var(--fx-accent)" strokeWidth={2} strokeLinejoin="round" />
      </svg>
      <strong className="fx-mono">{dbText(db)}</strong>
    </div>
  );
}

function HandsFree() {
  const rt = useRuntime();
  const v = useVoice();
  const cfg = configOf(rt);
  const on = listens(cfg);
  const chip = !cfg.handsFree ? 'Off' : !on ? 'Nothing to listen for' : v.status?.listening ? (cfg.alwaysArmed ? 'Armed' : 'Listening') : 'Starting…';
  return (
    <Section title={`Hands-free · ${chip}`}>
      <p className="fx-muted">
        {cfg.alwaysArmed ? 'Always armed: everything AmberX hears is taken as a command.' : cfg.wakePhrases.length ? <>Say “{cfg.wakePhrases[0]}” and then what you want. No need to press Speak.</> : 'Add a wake phrase in settings, or switch on Always armed.'}
      </p>
      <LevelGraph levels={v.levels} db={v.db} />
      <p className={v.heardFinal ? '' : 'fx-muted'}>{v.heard ? (v.heardFinal ? `“${v.heard}”` : `${v.heard}…`) : 'Heard nothing yet.'}</p>
      <div className="fx-stack">
        <Switch label="Listen hands-free" checked={cfg.handsFree} onChange={(x) => rt.settings.set(K.handsFree, x)} hint="On screen and in the background (Android shows a notification while it listens)." />
        <Switch label="Always armed" checked={cfg.alwaysArmed} onChange={(x) => rt.settings.set(K.alwaysArmed, x)} hint="Act on everything heard, no wake phrase." />
        {isNative() && <Switch label="Detection overlay" checked={cfg.overlay} onChange={(x) => rt.settings.set(K.overlay, x)} hint="Level, dB, what was heard and quick settings, floating over other apps." />}
      </div>
      {isNative() && cfg.overlay && v.status && !v.status.overlayAllowed && (
        <Note tone="info">The overlay needs “Display over other apps”. <Button icon="settings" onClick={() => void allowOverlay(rt)}>Allow</Button></Note>
      )}
      {v.status && !v.status.microphone && cfg.handsFree && <Note tone="warning">The microphone isn't allowed, so hands-free can't listen.</Note>}
    </Section>
  );
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
            Say “{wake[0] ?? 'hey amberx'}” and what you want, or tap Speak.
          </p>
        </div>
        <Button tone="primary" icon="mic" disabled={v.busy} onClick={() => void listenOnce(rt)}>{v.busy ? 'Listening…' : 'Speak'}</Button>
      </header>
      {!isNative() && <Note tone="info">In a browser AmberX listens while this page is open. The Android app also listens with the screen off and shows the detection overlay.</Note>}
      <HandsFree />
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
  version: '0.2.0',
  builtWith: { model: 'opus', builtAt: '2026-10-25' },
  provides: ['amberx.voice'],
  views: { voice: { title: 'Voice', icon: 'mic', keywords: ['voice', 'speak', 'talk', 'command', 'wake'], render: () => <VoiceView /> } },
  nav: { label: 'Voice', items: [{ id: 'voice', label: 'Voice', icon: 'mic', view: 'voice' }] },
  settingsTabs: [{ id: 'voice', label: 'Voice control', icon: 'mic', order: 20, parent: 'plugins' }],
  settings: [
    {
      id: 'amberx.voice', label: 'Voice control', icon: 'mic', tab: 'voice', settings: [
        { key: K.handsFree, label: 'Listen hands-free', kind: 'toggle', default: true, description: 'Keep listening for the wake phrase on screen and in the background, without pressing Speak.' },
        { key: K.wake, label: 'Wake phrases', kind: 'text', default: 'hey amberx, okay amberx', description: 'Comma separated. Say one, then the command.' },
        { key: K.alwaysArmed, label: 'Always armed', kind: 'toggle', default: false, description: 'Act on everything heard, with no wake phrase. Background talk can trigger commands.' },
        { key: K.overlay, label: 'Detection overlay', kind: 'toggle', default: true, description: 'Android: a floating window with the input level, dB, what was heard and quick settings.' },
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
    // A wake phrase was heard (hands-free, on screen or with the app closed): the rest of the sentence may already be the
    // command. An empty phrase = no wake phrase in it (always armed on Android, or any final result in a browser).
    void native.addListener('wake', ({ phrase, text }) => {
      if (nextHeard) { nextHeard(afterWake(text ?? '', phraseList(rt.settings.get(K.wake)))); return; }
      if (state.busy) return;
      const wake = phraseList(rt.settings.get(K.wake));
      if (phrase) {
        const rest = afterWake(text ?? '', wake);
        if (rest) void handle(rt, rest);
        else void say(rt, 'Yes?').then(() => listenOnce(rt));
        return;
      }
      const h = interpretHeard(text ?? '', wake, rt.settings.get(K.alwaysArmed) === true, normalize);
      if (h.kind === 'command') void handle(rt, h.text);
      else if (h.kind === 'wake') void say(rt, 'Yes?').then(() => listenOnce(rt));
    }).catch(() => undefined);
    void native.addListener('heard', ({ text, final }) => {
      set({ heard: text, heardFinal: final });
      // Speak / "Yes?" is waiting: the next final utterance is the command (whether or not it held a wake phrase).
      if (final && nextHeard) nextHeard(afterWake(text, phraseList(rt.settings.get(K.wake))));
    }).catch(() => undefined);
    void native.addListener('level', ({ db, source }) => set({ db, levels: pushLevel(state.levels, levelOf(db, source ?? 'android')) })).catch(() => undefined);
    // A quick setting changed on the overlay: save it so Settings and this page show the same.
    void native.addListener('voiceSettings', (c) => {
      if (typeof c.handsFree === 'boolean') rt.settings.set(K.handsFree, c.handsFree);
      if (typeof c.alwaysArmed === 'boolean') rt.settings.set(K.alwaysArmed, c.alwaysArmed);
      if (typeof c.overlay === 'boolean') rt.settings.set(K.overlay, c.overlay);
    }).catch(() => undefined);
    // Settings (or the theme) changed: send the native side the new config. Same config = no call.
    let last = '';
    const sync = () => {
      const cfg = configOf(rt);
      const next = JSON.stringify(cfg);
      if (next === last) return;
      last = next;
      void syncNative(rt, cfg);
    };
    rt.subscribe(sync);
    sync();
  },
};
