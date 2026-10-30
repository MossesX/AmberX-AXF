/**
 * Voice control: say a wake phrase or tap the mic, say what you want, and AmberX runs it and answers out loud.
 * Hands-free (on by default, Oct 27 2026) keeps listening on screen and in the background without pressing Speak; on
 * Android the detection overlay shows the input level, dB, what was heard and quick settings over other apps
 * (`handsfree.ts`, `WatchService.java`, `DetectionOverlay.java`). Commands are data (`core.ts`): the built-in ones below, ones other
 * plugins add with `registerVoiceCommands`, one per page and per app action (made from the codebase at run time) and
 * the user's own; the **Voice commands** page switches and rewords them (overrides in settings, never code edits).
 * A sentence no command explains better goes to the notes intent path (local parser, then the AI when connected).
 */
import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { AxfRuntime } from '../../../axf/core';
import { Button, Container, Icon, IconButton, Note, SelectField, Switch, TextField, useRuntime, type AxfWebLibrary } from '../../../axf/react';
import { DataGrid, type GridColumn, type GridGroup } from '../../../axf/libs/datagrid';
import './voice.css';
import { isNative, native, type VoiceStatus } from '../../../native';
import { dbText, graphPoints, interpretHeard, levelOf, listens, overlayColors, pushLevel, voiceConfig, type VoiceConfig } from './handsfree';
import { flatTree, localDay, parseIntent, type Intent } from '../../notes/web/core';
import { NOTES_ID, load as loadNotes, runIntent, snapshot as notesSnapshot } from '../../notes/web/store';
import { aiReady, parseNote } from '../../ai/web/client';
import {
  GROUPS, NOTE_EXAMPLES, TASK_EXAMPLES, actionCommands, afterWake, applyOverrides, checkMine, decide, describeIntent, fillReply,
  navigationCommands, normalize, openSpec, parseMine, parseOverrides, parseUserCommands, phraseList, resetOverrides, setOverride, userCommands,
  type CommandGroup, type Effective, type ManagedCommand, type MyCommand, type VoiceCommand,
} from './core';
import { FACTORY_PHRASES, SUGGESTED_PHRASES, addPhrase, phrasesText, removePhrase } from './wake';

export const K = {
  wake: 'amberx.voice.wake',
  lang: 'amberx.voice.lang',
  speak: 'amberx.voice.speak',
  /** legacy: `phrase = action | reply` lines; still read, shown under Yours */
  commands: 'amberx.voice.commands',
  /** JSON {commandId: {on, phrases, reply}}: the person's changes to any command */
  overrides: 'amberx.voice.overrides',
  /** JSON [{id, phrases, action, reply}]: commands made on the Yours tab */
  mine: 'amberx.voice.mine',
  /** let note sentences ("note in work: …") go to the notes plugin */
  notes: 'amberx.voice.notes',
  handsFree: 'amberx.voice.handsFree',
  alwaysArmed: 'amberx.voice.alwaysArmed',
  overlay: 'amberx.voice.overlay',
  beep: 'amberx.voice.beep',
  online: 'amberx.voice.online',
  swears: 'amberx.voice.swears',
  /** 'wake' (silent offline wake listener, Google only after a trigger) | 'classic' (Google all the time) */
  mode: 'amberx.voice.mode',
  /** wake listener: 'low' | 'normal' | 'high' */
  sensitivity: 'amberx.voice.sensitivity',
  /** wake mode: let the recognizer's tone play when a wake phrase starts it (off = muted around the one utterance) */
  triggerTone: 'amberx.voice.triggerTone',
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
  { id: 'commands.open', phrases: ['voice commands', 'manage voice commands'], action: 'voice.commands' },
];

/** A plugin's command; `group` picks its tab (default Plugins), `defaultOn: false` ships it switched off. */
export type PluginVoiceCommand = VoiceCommand & { group?: CommandGroup; owner?: string; defaultOn?: boolean };

const fromPlugins = new Map<string, PluginVoiceCommand[]>();
let pluginRev = 0;
const pluginSubs = new Set<() => void>();
/** Adds commands for a plugin (replacing its earlier ones); returns a remover. */
export function registerVoiceCommands(module: string, commands: PluginVoiceCommand[]): () => void {
  fromPlugins.set(module, commands.map((c) => ({ ...c, module })));
  pluginRev += 1; pluginSubs.forEach((f) => f());
  return () => { fromPlugins.delete(module); pluginRev += 1; pluginSubs.forEach((f) => f()); };
}
/**
 * Console plugins loaded into AmberX can't import this file, so the page carries the same registry for them:
 * `globalThis.amberxVoice.register(module, commands)` (set when this module loads, before any library registers).
 */
(globalThis as { amberxVoice?: { register: typeof registerVoiceCommands } }).amberxVoice = { register: registerVoiceCommands };
const usePluginRev = () => useSyncExternalStore((f) => { pluginSubs.add(f); return () => { pluginSubs.delete(f); }; }, () => pluginRev);

/** Every page the app has right now (from the search index the React layer fills). */
function pages(rt: AxfRuntime): { id: string; title: string }[] {
  return rt.search.entries().flatMap((e) => (e.focus.kind === 'view' && typeof e.focus.view === 'string' ? [{ id: e.focus.view, title: e.label }] : []));
}

/** Every command in every tab, before the person's changes. Order = who wins a tie: yours, plugins, built-in, pages, actions. */
export function managedCommands(rt: AxfRuntime): ManagedCommand[] {
  const plugin = [...fromPlugins.values()].flat().map((c): ManagedCommand => ({ ...c, group: c.group ?? 'plugins', owner: c.owner ?? c.module, defaultOn: c.defaultOn ?? true }));
  const builtin = BUILT_IN.map((c): ManagedCommand => ({ ...c, group: 'builtin', module: ID, defaultOn: true }));
  const taken = new Set([...plugin, ...builtin].map((c) => c.action));
  return [
    ...userCommands(rt.settings.get(K.commands), parseMine(rt.settings.get(K.mine))),
    ...plugin,
    ...builtin,
    ...navigationCommands(pages(rt)).filter((c) => !taken.has(c.action)),
    ...actionCommands(rt.actions.list()).filter((c) => !taken.has(c.action)),
  ];
}

export function effectiveCommands(rt: AxfRuntime): Effective[] {
  return applyOverrides(managedCommands(rt), parseOverrides(rt.settings.get(K.overrides)));
}

/** The commands that listen (switched on). */
export function allCommands(rt: AxfRuntime): VoiceCommand[] {
  return effectiveCommands(rt).filter((c) => c.on);
}

/** Note sentences go to the notes plugin only when it's installed (and not switched off here). */
const notesOn = (rt: AxfRuntime) => rt.settings.get(K.notes) !== false && rt.libraries.some((l) => l.id === NOTES_ID);

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

export async function say(rt: AxfRuntime, text: string) {
  if (rt.settings.get(K.speak) !== false && text) await native.speak({ text, lang: str(rt.settings.get(K.lang), 'en-US') }).catch(() => undefined);
}

async function runCommand(rt: AxfRuntime, c: VoiceCommand): Promise<{ did: string; ok: boolean }> {
  const ran = c.action ? rt.dispatch(c.action) : true;
  // Let a check finish before reading the count back.
  if (c.reply?.includes('{waiting}')) await new Promise((r) => setTimeout(r, 1200));
  const reply = c.reply ? fillReply(c.reply, { waiting: rt.badge('approvals.waiting') }) : '';
  await say(rt, ran ? reply : "That isn't available here.");
  return { did: ran ? reply || `Ran ${c.action}.` : `${c.action} isn't available.`, ok: ran };
}

/** Local parse first, then the AI (when connected). */
async function notesIntent(heard: string, local: Intent | null): Promise<Intent | null> {
  if (local) return local;
  if (!aiReady()) return null;
  if (!notesSnapshot().loaded) await loadNotes();
  return parseNote(heard, { lists: flatTree(notesSnapshot().view).map((t) => t.path), today: localDay(new Date()) });
}

async function runNotes(rt: AxfRuntime, heard: string, intent: Intent): Promise<{ did: string; ok: boolean }> {
  if (!notesSnapshot().loaded) await loadNotes();
  const r = runIntent(intent, { source: 'voice', transcript: heard });
  await say(rt, r.say);
  const open = openSpec(r.open, (id) => !!rt.actions.get(id));
  if (open) rt.dispatch(open);
  return { did: r.say, ok: r.ok };
}

/* ---------------------------------------------------------------- routers (the command center, Oct 28 2026) */

/** A plugin that understands sentences itself (the command center: actions, chains, wizards). It returns null when it
 * has nothing for the sentence, and the usual order (commands, notes) carries on. Your own commands still win. */
export type VoiceRouter = (rt: AxfRuntime, heard: string) => Promise<{ did: string; ok: boolean } | null>;
const routers = new Map<string, VoiceRouter>();
export function registerVoiceRouter(module: string, fn: VoiceRouter): () => void {
  routers.set(module, fn);
  return () => { routers.delete(module); };
}

/** Says a question and returns the next thing heard ('' when nothing was): wizards and confirmations use it. */
export async function askAloud(rt: AxfRuntime, question: string): Promise<string> {
  await say(rt, question);
  set({ heard: question, heardFinal: true });
  return nextCommand(rt);
}

/** Runs what was heard: a command or a notes sentence (see `decide` in core.ts for the order), then answers. */
export async function handle(rt: AxfRuntime, heardRaw: string): Promise<Turn> {
  const heard = afterWake(heardRaw, phraseList(rt.settings.get(K.wake)));
  const at = new Date().toISOString();
  let turn: Turn;
  if (!heard) turn = { at, heard: heardRaw, did: 'Heard nothing.', ok: false };
  else {
    const notes = notesOn(rt);
    const local = notes ? parseIntent(heard) : null;
    const d = decide(heard, allCommands(rt), { localIntent: !!local, ai: notes && aiReady() });
    let done: { did: string; ok: boolean } | null = null;
    const yours = d.route === 'command' && d.match && (d.match.command as Partial<Effective>).group === 'user';
    if (!yours) for (const r of routers.values()) { done = await r(rt, heard).catch(() => null); if (done) break; }
    if (done) { /* a router ran it */ } else if (d.route === 'command' && d.match) done = await runCommand(rt, d.match.command);
    else {
      const intent = notes ? await notesIntent(heard, local) : null;
      if (intent) done = await runNotes(rt, heard, intent);
      else if (d.match) done = await runCommand(rt, d.match.command);
    }
    if (!done) {
      await say(rt, "Sorry, I don't know that one.");
      done = { did: "I didn't catch a command.", ok: false };
    }
    turn = { at, heard, ...done };
  }
  set({ turns: [turn, ...state.turns].slice(0, 30) });
  return turn;
}

/** With hands-free listening, Speak never opens a second recognizer (that would pause hands-free): the next thing heard
 * is the command. Without it, one native utterance as before. */
async function nextCommand(rt: AxfRuntime): Promise<string> {
  // Silent wake mode: the idle listener only knows the wake phrases, so one Google utterance (it pauses the idle one).
  if (listens(configOf(rt)) && state.status?.listening && state.status.engine !== 'wake') {
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
    beep: rt.settings.get(K.beep), online: rt.settings.get(K.online), swears: rt.settings.get(K.swears),
    mode: rt.settings.get(K.mode), sensitivity: rt.settings.get(K.sensitivity), triggerTone: rt.settings.get(K.triggerTone),
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
    <div className="axp-voice-level">
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`Input level ${dbText(db)}`}>
        <line x1={0} y1={h - 1} x2={w} y2={h - 1} stroke="var(--fx-border)" strokeWidth={1} />
        <polyline points={graphPoints(levels, w, h - 2)} fill="none" stroke="var(--fx-accent)" strokeWidth={2} strokeLinejoin="round" />
      </svg>
      <strong className="fx-mono">{dbText(db)}</strong>
    </div>
  );
}

/** The wake engine's phase as the chip in the Hands-free card says it (the overlay says the same). */
function phaseLabel(phase: string, detail = ''): string {
  switch (phase) {
    case 'wake': return 'Idle (wake)';
    case 'armed': return 'Armed';
    case 'listening': return 'Listening';
    case 'downloading': return `Getting the wake model ${detail}`.trim();
    case 'loading': return 'Loading the wake model';
    case 'no-model': return 'Wake model not ready';
    case 'paused': return 'Paused (Speak)';
    default: return 'Starting…';
  }
}

function HandsFree() {
  const rt = useRuntime();
  const v = useVoice();
  const cfg = configOf(rt);
  const on = listens(cfg);
  const chip = !cfg.handsFree ? 'Off' : !on ? 'Nothing to listen for' : v.status?.engine === 'wake' && v.status.phase ? phaseLabel(v.status.phase, v.status.phaseDetail) : v.status?.listening ? (cfg.alwaysArmed ? 'Armed' : 'Listening') : 'Starting…';
  return (
    <Container title={`Hands-free · ${chip}`} icon="mic">
      <p className="fx-muted">
        {cfg.alwaysArmed ? 'Always armed: everything AmberX hears is taken as a command.' : cfg.wakePhrases.length ? <>Say “{cfg.wakePhrases[0]}” and then what you want. No need to press Speak.</> : 'Add a wake phrase in settings, or switch on Always armed.'}
      </p>
      <LevelGraph levels={v.levels} db={v.db} />
      <p className={v.heardFinal ? '' : 'fx-muted'}>{v.heard ? (v.heardFinal ? `“${v.heard}”` : `${v.heard}…`) : 'Heard nothing yet.'}</p>
      <div className="fx-stack">
        <Switch label="Listen hands-free" checked={cfg.handsFree} onChange={(x) => rt.settings.set(K.handsFree, x)} hint="On screen and in the background (Android shows a notification while it listens)." />
        <Switch label="Always armed" checked={cfg.alwaysArmed} onChange={(x) => rt.settings.set(K.alwaysArmed, x)} hint="Act on everything heard, no wake phrase." />
        {isNative() && <Switch label="Detection overlay" checked={cfg.overlay} onChange={(x) => rt.settings.set(K.overlay, x)} hint="Level, dB, what was heard and quick settings, floating over other apps." />}
        {isNative() && <SelectField label="Hands-free mode" value={cfg.mode} onChange={(x) => rt.settings.set(K.mode, x)} options={[{ value: 'wake', label: 'Silent wake (offline, no tone)' }, { value: 'classic', label: 'Classic (Google all the time)' }]} hint="Silent wake listens offline for the wake phrase, then Google hears the command once." />}
        {isNative() && cfg.mode === 'wake' && <SelectField label="Wake sensitivity" value={cfg.sensitivity} onChange={(x) => rt.settings.set(K.sensitivity, x)} options={[{ value: 'low', label: 'Low' }, { value: 'normal', label: 'Normal' }, { value: 'high', label: 'High' }]} />}
        {isNative() && cfg.mode === 'wake' && <Switch label="Play tone on trigger" checked={cfg.triggerTone} onChange={(x) => rt.settings.set(K.triggerTone, x)} hint="Off: muted while it hears the command." />}
        {isNative() && <SelectField label="Listening tone" value={cfg.beep} onChange={(x) => rt.settings.set(K.beep, x)} options={[{ value: 'silence', label: 'Silenced' }, { value: 'silence-all', label: 'Silenced (also media)' }, { value: 'on', label: 'Leave it on' }]} hint="Still hear a tone? Pick “also media”." />}
        {isNative() && <Switch label="Best recognition (online)" checked={cfg.online} onChange={(x) => rt.settings.set(K.online, x)} hint="Google's online model hears far better; off = on-device, works offline." />}
        <Switch label="Show swear words" checked={cfg.swears} onChange={(x) => rt.settings.set(K.swears, x)} hint="Write words as you say them, no f***." />
      </div>
      {isNative() && cfg.overlay && v.status && !v.status.overlayAllowed && (
        <Note tone="info">The overlay needs “Display over other apps”. <Button icon="settings" onClick={() => void allowOverlay(rt)}>Allow</Button></Note>
      )}
      {v.status && !v.status.microphone && cfg.handsFree && <Note tone="warning">The microphone isn't allowed, so hands-free can't listen.</Note>}
      {isNative() && cfg.handsFree && cfg.mode === 'wake' && v.status?.phase === 'downloading' && <Note tone="info">Getting the offline wake model once (about 40 MB) {v.status.phaseDetail}. Hands-free starts by itself when it's done.</Note>}
      {isNative() && cfg.handsFree && cfg.mode === 'wake' && v.status?.phase === 'no-model' && <Note tone="warning">The offline wake model isn't ready{v.status.phaseDetail ? ` (${v.status.phaseDetail})` : ''}. AmberX tries again in a few minutes; switch Hands-free mode to Classic to listen without it (with the tone).</Note>}
    </Container>
  );
}

/**
 * The trigger phrase list (Oct 29 2026, "like ActiveX"): one dense column, a remove button per phrase, add one,
 * suggested phrases one tap away, and Factory phrases to put the defaults back. Saved as the wake setting's text.
 */
function PhraseListPanel() {
  const rt = useRuntime();
  const raw = useSetting(rt, K.wake);
  const list = phraseList(raw);
  const [draft, setDraft] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const save = (next: string[]) => rt.settings.set(K.wake, phrasesText(next));
  const add = (p: string) => {
    const r = addPhrase(list, p);
    setErr(r.error);
    if (!r.error) { save(r.list); setDraft(''); }
  };
  const factory = list.join('|') === FACTORY_PHRASES.join('|');
  const offered = SUGGESTED_PHRASES.filter((p) => !list.includes(p));
  return (
    <div className="fx-stack">
      <p className="fx-muted">Say one of these, then the command. The silent wake listener hears only these phrases, so short or common words trigger by mistake.</p>
      {list.length === 0
        ? <Empty icon="mic" text="No trigger phrases: hands-free listens only when Always armed is on." />
        : (
          <ul className="axp-voice-phrases" aria-label="Trigger phrases">
            {list.map((p) => (
              <li key={p}>
                <span>“{p}”</span>
                <IconButton icon="trash" label={`Remove ${p}`} onClick={() => { setErr(null); save(removePhrase(list, p)); }} />
              </li>
            ))}
          </ul>
        )}
      <div className="fx-row fx-row--wrap axp-voice-add">
        <TextField label="Add a phrase" value={draft} onChange={setDraft} placeholder="hey amberx" />
        <Button icon="plus" onClick={() => add(draft)}>Add</Button>
      </div>
      {err && <Note tone="warning">{err}</Note>}
      {offered.length > 0 && (
        <div className="fx-row fx-row--wrap">
          {offered.map((p) => <Button key={p} size="sm" tone="quiet" icon="plus" onClick={() => add(p)}>{p}</Button>)}
        </div>
      )}
      <div>
        <Button size="sm" tone="quiet" icon="undo" disabled={factory} onClick={() => { setErr(null); save(FACTORY_PHRASES); }}>Factory phrases</Button>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- view */

/* ---------------------------------------------------------------- views */

const useSetting = (rt: AxfRuntime, key: string) => useSyncExternalStore(rt.settings.subscribe, () => rt.settings.get(key));

/** Empty state (design language §11): an icon, one sentence, one action. */
function Empty({ icon, text, action }: { icon: string; text: string; action?: ReactNode }) {
  return (
    <div className="fx-empty axp-voice-empty">
      <Icon name={icon} size={24} />
      <p className="fx-muted">{text}</p>
      {action}
    </div>
  );
}

/** “first” or “second”, “third” — the phrases of a command as one line. */
function Phrases({ list }: { list: string[] }) {
  return <span>“{list[0]}”{list.length > 1 ? <span className="fx-muted"> or {list.slice(1, 3).map((p) => `“${p}”`).join(', ')}</span> : null}</span>;
}

const W = { wide: 'minmax(calc(var(--fx-space) * 16), 3fr)', mid: 'minmax(calc(var(--fx-space) * 10), 2fr)', narrow: 'calc(var(--fx-space) * 9)' } as const;
const oneGroup = <R,>(id: string, title: string, rows: R[]): GridGroup<R>[] => [{ id, title, rows, groups: [], fixed: true }];

const TURN_COLUMNS: GridColumn<Turn>[] = [
  { id: 'heard', label: 'Heard', width: W.wide, fixed: true, render: (t) => <span>“{t.heard}”</span> },
  { id: 'did', label: 'What it did', width: W.mid, render: (t) => <span className="fx-muted">{t.ok ? '' : '✗ '}{t.did}</span> },
];

const SAY_COLUMNS: GridColumn<VoiceCommand>[] = [
  { id: 'say', label: 'Say', width: W.wide, fixed: true, render: (c) => <Phrases list={c.phrases} /> },
  { id: 'does', label: 'Does', width: W.mid, render: (c) => <span className="fx-mono fx-muted">{c.action || 'reply'}</span> },
];

function VoiceView() {
  const rt = useRuntime();
  const v = useVoice();
  useSetting(rt, K.overrides);
  usePluginRev();
  const wake = phraseList(rt.settings.get(K.wake));
  const { errors } = parseUserCommands(rt.settings.get(K.commands));
  const commands = allCommands(rt);
  const shown = commands.slice(0, 40);
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
      {!isNative() && <Note tone="info">In a browser AmberX listens while this page is open. The Android app also listens with the screen off and shows the detection overlay.</Note>}
      <HandsFree />
      {errors.length > 0 && <Note tone="warning">{errors.join(' ')}</Note>}
      <Container title="Just now" icon="clock">
        {v.turns.length === 0
          ? <Empty icon="mic" text="Nothing said yet." action={<Button icon="mic" disabled={v.busy} onClick={() => void listenOnce(rt)}>Speak</Button>} />
          : (
            <DataGrid<Turn> id="amberx-voice-turns" label="What was said" groups={oneGroup('turns', `${v.turns.length} this session`, v.turns)}
              columns={TURN_COLUMNS} rowId={(t) => t.at} rowLabel={(t) => t.heard} hidden={[]} rowTone={(t) => (t.ok ? 'muted' : 'danger')} />
          )}
      </Container>
      <Container title={`What you can say (${commands.length})`} icon="list"
        actions={<Button size="sm" icon="sliders" onClick={() => rt.navigate('voice-commands')}>Voice commands</Button>}>
        <DataGrid<VoiceCommand> id="amberx-voice-say" label="What you can say" groups={oneGroup('say', `${shown.length} of ${commands.length}`, shown)}
          columns={SAY_COLUMNS} rowId={(c) => `${c.module}:${c.id}`} rowLabel={(c) => c.phrases[0] ?? c.id} hidden={[]}
          empty={<Empty icon="mic" text="No commands are switched on." action={<Button icon="sliders" onClick={() => rt.navigate('voice-commands')}>Voice commands</Button>} />} />
        {commands.length > 40 && <p className="fx-muted">…and {commands.length - 40} more on the Voice commands page.</p>}
      </Container>
    </div>
  );
}

/** The Try box: what a sentence would do, without running anything. */
function TryBox({ rt, commands, value, onChange }: { rt: AxfRuntime; commands: VoiceCommand[]; value: string; onChange: (v: string) => void }) {
  const heard = afterWake(value, phraseList(rt.settings.get(K.wake)));
  const notes = notesOn(rt);
  const local = heard && notes ? parseIntent(heard) : null;
  const d = heard ? decide(heard, commands, { localIntent: !!local, ai: notes && aiReady() }) : null;
  return (
    <Container title="Try a sentence" icon="search">
      <TextField label="Say or type" value={value} onChange={onChange} placeholder="note in work: fix the login page" type="search" />
      {d && (
        <p className={d.route === 'command' || local ? '' : 'fx-muted'}>
          {d.route === 'command' && d.match
            ? <>Runs <span className="fx-mono">{d.match.command.action || 'a reply'}</span>{d.match.command.reply ? <> and says “{d.match.command.reply}”</> : null}.</>
            : local ? describeIntent(local)
              : notes && aiReady() ? 'The AI would read it as a notes sentence.'
                : !notes ? (d.match ? <>Runs <span className="fx-mono">{d.match.command.action}</span>.</> : 'Nothing: no command matches, and the Notes plugin isn’t installed.')
                  : d.match ? <>Runs <span className="fx-mono">{d.match.command.action}</span>.</> : 'Nothing: no command or notes sentence matches.'}
          {' '}<span className="fx-muted">({d.why})</span>
        </p>
      )}
    </Container>
  );
}

type Patch = { on?: boolean; phrases?: string[]; reply?: string } | null;

/** The opened row of a command: its phrases and reply. */
function CommandEditor({ c, onPatch, done }: { c: Effective; onPatch: (patch: Patch) => void; done: () => void }) {
  const [phrases, setPhrases] = useState(c.phrases.join(', '));
  const [reply, setReply] = useState(c.reply ?? '');
  useEffect(() => { setPhrases(c.phrases.join(', ')); setReply(c.reply ?? ''); }, [c.phrases.join('|'), c.reply]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="fx-stack axp-voice-detail">
      <TextField label="Phrases" hint="Comma separated. Any of them, anywhere in a sentence." value={phrases} onChange={setPhrases} />
      <TextField label="Reply" hint="What AmberX says back. {waiting} = approvals waiting." value={reply} onChange={setReply} />
      <div className="fx-row fx-row--wrap">
        <Button size="sm" tone="quiet" disabled={!c.edited} onClick={() => { onPatch(null); done(); }}>Back to default</Button>
        <Button size="sm" tone="primary" onClick={() => { onPatch({ phrases: phraseList(phrases, 10), reply }); done(); }}>Save</Button>
      </div>
    </div>
  );
}

const rowKey = (c: { module?: string; id: string }) => `${c.module ?? ''}:${c.id}`;

function CommandTable({ list, onPatch }: { list: Effective[]; onPatch: (c: Effective, patch: Patch) => void }) {
  const [open, setOpen] = useState<string[]>([]);
  const toggle = (id: string) => setOpen((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  const byOwner = new Map<string, Effective[]>();
  for (const c of list) byOwner.set(c.owner ?? '', [...(byOwner.get(c.owner ?? '') ?? []), c]);
  if (!list.length) return <Empty icon="mic" text="No commands here yet." />;
  const columns: GridColumn<Effective>[] = [
    {
      id: 'on', label: 'On', width: W.narrow, fixed: true,
      render: (c) => <span onClick={(e) => e.stopPropagation()}><Switch label={`Listen for ${c.phrases[0]}`} hideLabel checked={c.on} onChange={(on) => onPatch(c, { on })} /></span>,
    },
    { id: 'say', label: 'Say', width: W.wide, fixed: true, render: (c) => <span><Phrases list={c.phrases} />{c.edited && <> <span className="fx-chip">changed</span></>}</span> },
    { id: 'does', label: 'Does', width: W.mid, render: (c) => <span className="fx-mono fx-muted">{c.action || 'reply only'}</span> },
  ];
  const groups: GridGroup<Effective>[] = [...byOwner.entries()].map(([owner, cs]) => ({
    id: owner || '-', title: `${owner || (byOwner.size > 1 ? 'Other' : 'Commands')} (${cs.filter((c) => c.on).length}/${cs.length} on)`, rows: cs, groups: [], fixed: true,
  }));
  return (
    <DataGrid<Effective> id="amberx-voice-commands" label="Voice commands" groups={groups} columns={columns} rowId={rowKey} rowLabel={(c) => c.phrases[0] ?? c.id} hidden={[]}
      rowTone={(c) => (c.on ? 'accent' : 'muted')} expanded={open} onToggleExpand={toggle} onRowClick={(c) => toggle(rowKey(c))}
      renderDetail={(c) => <CommandEditor c={c} onPatch={(p) => onPatch(c, p)} done={() => toggle(rowKey(c))} />} />
  );
}

type Example = { say: string; does: string };
const EXAMPLE_COLUMNS: GridColumn<Example>[] = [
  { id: 'say', label: 'Say', width: W.wide, fixed: true, render: (e) => <span>“{e.say}”</span> },
  { id: 'does', label: 'Does', width: W.mid, render: (e) => <span className="fx-muted">{e.does}</span> },
];

function Examples({ items, onTry }: { items: Example[]; onTry: (s: string) => void }) {
  return (
    <Container title="Sentences it understands" icon="sparkles">
      <p className="fx-muted">Built into the notes plugin, no setup: swap in your own words and list names, and tap one to try it.</p>
      <DataGrid<Example> id="amberx-voice-examples" label="Example sentences" groups={oneGroup('examples', `${items.length} examples`, items)}
        columns={EXAMPLE_COLUMNS} rowId={(e) => e.say} rowLabel={(e) => e.say} hidden={[]} onRowClick={(e) => onTry(e.say)} />
    </Container>
  );
}

function Yours({ rt }: { rt: AxfRuntime }) {
  const mine = parseMine(rt.settings.get(K.mine));
  const { errors } = parseUserCommands(rt.settings.get(K.commands));
  const [form, setForm] = useState({ phrases: '', action: '', reply: '' });
  const [err, setErr] = useState<string | null>(null);
  const options = useMemo(() => [
    { value: '', label: 'Nothing (reply only)' },
    ...navigationCommands(pages(rt)).map((c) => ({ value: c.action, label: `Open ${c.phrases[0]!.replace(/^open /, '')}` })),
    ...rt.actions.list().filter((a) => !a.meta.params && !a.meta.stub && a.id !== 'nav').map((a) => ({ value: a.id, label: `${a.meta.label} (${a.id})` }))
      .sort((a, b) => a.label.localeCompare(b.label)),
  ], [rt]);
  const save = (list: MyCommand[]) => rt.settings.set(K.mine, JSON.stringify(list));
  const add = () => {
    const why = checkMine(form);
    if (why) { setErr(why); return; }
    save([...mine, { id: `mine.${Date.now().toString(36)}`, phrases: phraseList(form.phrases, 10), action: form.action.trim(), ...(form.reply.trim() ? { reply: form.reply.trim() } : {}) }]);
    setForm({ phrases: '', action: '', reply: '' }); setErr(null);
  };
  const columns: GridColumn<MyCommand>[] = [
    { id: 'say', label: 'Say', width: W.wide, fixed: true, render: (m) => <span>“{m.phrases.join('”, “')}”</span> },
    { id: 'does', label: 'Does', width: W.mid, render: (m) => <span className="fx-mono fx-muted">{m.action || 'reply only'}</span> },
    { id: 'remove', label: 'Remove', width: W.narrow, align: 'end', render: (m) => <IconButton icon="trash" label={`Remove ${m.phrases[0] ?? ''}`} onClick={() => save(mine.filter((x) => x.id !== m.id))} /> },
  ];
  return (
    <Container title="Add your own" icon="plus">
      <div className="fx-stack">
        <TextField label="Phrases" hint="Comma separated." value={form.phrases} onChange={(phrases) => setForm({ ...form, phrases })} placeholder="good morning, morning" />
        <SelectField label="Does" value={form.action} options={options} onChange={(action) => setForm({ ...form, action })} />
        <TextField label="Reply" value={form.reply} onChange={(reply) => setForm({ ...form, reply })} placeholder="Morning! You have {waiting} waiting." />
        {err && <Note tone="warning">{err}</Note>}
        <div><Button tone="primary" icon="plus" onClick={add}>Add command</Button></div>
        {mine.length > 0 && (
          <DataGrid<MyCommand> id="amberx-voice-mine" label="Your commands" groups={oneGroup('mine', `${mine.length} of yours`, mine)}
            columns={columns} rowId={(m) => m.id} rowLabel={(m) => m.phrases[0] ?? m.id} hidden={[]} />
        )}
        {errors.length > 0 && <Note tone="warning">Typed commands in settings: {errors.join(' ')}</Note>}
      </div>
    </Container>
  );
}

function VoiceCommandsView() {
  const rt = useRuntime();
  useSetting(rt, K.overrides);
  useSetting(rt, K.mine);
  useSetting(rt, K.commands);
  usePluginRev();
  const [tab, setTab] = useState<CommandGroup>('notes');
  const [trying, setTrying] = useState('');
  const all = effectiveCommands(rt);
  const overrides = parseOverrides(rt.settings.get(K.overrides));
  const inTab = all.filter((c) => c.group === tab);
  const patch = (c: Effective, p: Patch) => {
    const base = managedCommands(rt).find((m) => m.id === c.id) ?? c;
    rt.settings.set(K.overrides, JSON.stringify(p ? setOverride(overrides, base, p) : resetOverrides(overrides, [c.id])));
  };
  return (
    <div className="fx-stack fx-stack--lg">
      <header className="fx-pagehead">
        <div>
          <p className="fx-eyebrow">Voice control</p>
          <h1>Voice commands</h1>
          <p className="fx-muted">{all.filter((c) => c.on).length} of {all.length} on, with pages and actions read from the app so new ones show up by themselves.</p>
        </div>
        <Button icon="mic" onClick={() => void listenOnce(rt)}>Speak</Button>
      </header>
      <div className="fx-tabs" role="tablist">
        {GROUPS.map((g) => (
          <button key={g.id} type="button" role="tab" className={`fx-tab${tab === g.id ? ' is-active' : ''}`} aria-selected={tab === g.id} onClick={() => setTab(g.id)}>
            {g.label} <span className="fx-muted">{all.filter((c) => c.group === g.id).length || ''}</span>
          </button>
        ))}
      </div>
      <TryBox rt={rt} commands={all.filter((c) => c.on)} value={trying} onChange={setTrying} />
      {tab === 'notes' && <Examples items={NOTE_EXAMPLES} onTry={setTrying} />}
      {tab === 'tasks' && <Examples items={TASK_EXAMPLES} onTry={setTrying} />}
      {(tab === 'notes' || tab === 'tasks') && !notesOn(rt) && <Note tone="info">Install the Notes plugin to use these sentences.</Note>}
      {tab === 'user' && <Yours rt={rt} />}
      {tab === 'actions' && <Note tone="info">Every action the app can run without extra details. Most start off: switch on the ones you want to say.</Note>}
      <Container
        title={GROUPS.find((g) => g.id === tab)!.label}
        icon="mic"
        actions={<Button size="sm" tone="quiet" icon="undo" disabled={!inTab.some((c) => c.edited)} confirm="Put this tab's commands back to their defaults?" undoable={false}
          onClick={() => rt.settings.set(K.overrides, JSON.stringify(resetOverrides(overrides, inTab.map((c) => c.id))))}>Reset to defaults</Button>}
      >
        <CommandTable list={inTab} onPatch={patch} />
      </Container>
    </div>
  );
}

/* ---------------------------------------------------------------- library */

export const library: AxfWebLibrary = {
  id: ID,
  label: 'Voice control',
  version: '0.3.0',
  builtWith: { model: 'opus', builtAt: '2026-10-29' },
  provides: ['amberx.voice'],
  views: { voice: { title: 'Voice', icon: 'mic', keywords: ['voice', 'speak', 'talk', 'command', 'wake'], render: () => <VoiceView /> },
    'voice-commands': { title: 'Voice commands', icon: 'sliders', keywords: ['voice', 'commands', 'phrases', 'say'], render: () => <VoiceCommandsView /> },
  },
  nav: { label: 'Voice', items: [{ id: 'voice', label: 'Voice', icon: 'mic', view: 'voice' }, { id: 'voice-commands', label: 'Voice commands', icon: 'sliders', view: 'voice-commands' }] },
  settingsTabs: [{ id: 'voice', label: 'Voice control', icon: 'mic', order: 20, parent: 'plugins' }],
  settings: [
    {
      id: 'amberx.voice', label: 'Voice control', icon: 'mic', tab: 'voice', settings: [
        { key: K.handsFree, label: 'Listen hands-free', kind: 'toggle', default: true, description: 'Keep listening for the wake phrase on screen and in the background, without pressing Speak.' },
        { key: K.wake, label: 'Wake phrases (typed)', kind: 'text', default: 'hey amberx, okay amberx', description: 'Comma separated, the same list as Trigger phrases above. Say one, then the command.' },
        { key: K.mode, label: 'Hands-free mode', kind: 'choice', default: 'wake', options: [{ value: 'wake', label: 'Silent wake (offline, no tone)' }, { value: 'classic', label: 'Classic (Google all the time)' }], description: 'Android. Silent wake listens offline for the wake phrase (like ActiveX, no tone) and only then lets Google hear the command. Classic keeps Google listening the whole time (restarts every few seconds, which can beep).' },
        { key: K.sensitivity, label: 'Wake sensitivity', kind: 'choice', default: 'normal', options: [{ value: 'low', label: 'Low (whole phrase, said clearly)' }, { value: 'normal', label: 'Normal' }, { value: 'high', label: 'High (first hint of the phrase)' }], description: 'Silent wake mode. Low waits for the whole phrase, loud enough: fewer false triggers. High triggers as soon as it starts hearing it, even quietly.' },
        { key: K.triggerTone, label: 'Play tone on trigger', kind: 'toggle', default: false, description: 'Silent wake mode: let Android\'s listening tone play when a wake phrase starts the command recognizer. Off = notification and system sounds are muted only while it hears the command, then put back.' },
        { key: K.alwaysArmed, label: 'Always armed', kind: 'toggle', default: false, description: 'Act on everything heard, with no wake phrase. Background talk can trigger commands.' },
        { key: K.overlay, label: 'Detection overlay', kind: 'toggle', default: true, description: 'Android: a floating window with the input level, dB, what was heard and quick settings.' },
        { key: K.beep, label: 'Listening tone', kind: 'choice', default: 'silence', options: [{ value: 'silence', label: 'Silenced' }, { value: 'silence-all', label: 'Silenced (also media)' }, { value: 'on', label: 'Leave it on' }], description: 'Android plays a tone each time it starts listening. Silenced mutes notification and system sounds while hands-free listens (approval alerts still get through). Still hear it? Pick "also media": music is muted too while AmberX listens, and comes back when it speaks.' },
        { key: K.online, label: 'Best recognition (online)', kind: 'toggle', default: true, description: "Google's online speech model hears far better. Off = the phone's on-device model (works offline, misses more)." },
        { key: K.swears, label: 'Show swear words', kind: 'toggle', default: true, description: 'Write words as you say them instead of f***.' },
        { key: K.lang, label: 'Language', kind: 'text', default: 'en-US', description: 'For recognition and spoken replies, e.g. en-US, en-GB.' },
        { key: K.speak, label: 'Answer out loud', kind: 'toggle', default: true },
        { key: K.notes, label: 'Notes sentences', kind: 'toggle', default: true, description: 'Let sentences like “note in work: …” or “add a todo … by friday” go to the Notes plugin.' },
        { key: 'amberx.voice.manage', label: 'Voice commands', kind: 'link', target: 'voice-commands', description: 'Switch commands on or off, change their phrases, add your own.' },
        { key: K.commands, label: 'Your own commands (typed)', kind: 'text', default: '', description: 'One per line: phrase, other phrase = action | reply. Example: open alerts = nav:monitor | Here you go. The Voice commands page has a form for these.' },
      ],
    },
  ],
  settingsPanels: [
    { id: 'amberx.voice.phrases', tab: 'voice', title: 'Trigger phrases', icon: 'mic', order: 0, render: () => <PhraseListPanel /> },
  ],
  contextMenu: [{ id: 'amberx.voice', items: [{ id: 'voice.listen', label: 'Speak a command', icon: 'mic', action: 'voice.listen' }] }],
  appMenu: [{ id: 'amberx.voice', menu: 'axhub', items: [{ id: 'voice.listen', label: 'Speak a command', icon: 'mic', action: 'voice.listen' }, { id: 'voice.commands', label: 'Voice commands', icon: 'sliders', action: 'voice.commands' }] }],
  register(rt) {
    rt.actions.register('voice.listen', () => void listenOnce(rt), { label: 'Speak a command' });
    rt.actions.register('voice.commands', () => rt.navigate('voice-commands'), { label: 'Voice commands' });
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
    // The watch service's status carries the wake engine's phase (downloading %, idle, listening): keep the card live.
    void native.addListener('monitor', (m) => {
      const x = m as unknown as Partial<VoiceStatus>;
      if (state.status && (x.phase !== undefined || x.listening !== undefined)) {
        set({ status: { ...state.status, listening: x.listening ?? state.status.listening, engine: x.engine ?? state.status.engine, phase: x.phase ?? state.status.phase, phaseDetail: x.phaseDetail ?? state.status.phaseDetail } });
      }
    }).catch(() => undefined);
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
