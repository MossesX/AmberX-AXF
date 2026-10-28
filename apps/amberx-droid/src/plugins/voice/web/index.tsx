/**
 * Voice control: say a wake phrase (the Android watch service hears it with the screen off) or tap the mic, say what you
 * want, and AmberX runs it and answers out loud. Commands are data (`core.ts`): the built-in ones below, ones other
 * plugins add with `registerVoiceCommands`, one per page and per app action (made from the codebase at run time) and
 * the user's own; the **Voice commands** page switches and rewords them (overrides in settings, never code edits).
 * A sentence no command explains better goes to the notes intent path (local parser, then the AI when connected).
 */
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { AxfRuntime } from '../../../axf/core';
import { Button, Note, Section, SelectField, Switch, TextField, useRuntime, type AxfWebLibrary } from '../../../axf/react';
import { isNative, native } from '../../../native';
import { flatTree, localDay, parseIntent, type Intent } from '../../notes/web/core';
import { NOTES_ID, load as loadNotes, runIntent, snapshot as notesSnapshot } from '../../notes/web/store';
import { aiReady, parseNote } from '../../ai/web/client';
import {
  GROUPS, NOTE_EXAMPLES, TASK_EXAMPLES, actionCommands, afterWake, applyOverrides, checkMine, decide, describeIntent, fillReply,
  navigationCommands, openSpec, parseMine, parseOverrides, parseUserCommands, phraseList, resetOverrides, setOverride, userCommands,
  type CommandGroup, type Effective, type ManagedCommand, type MyCommand, type VoiceCommand,
} from './core';

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
type State = { busy: boolean; turns: Turn[] };
let state: State = { busy: false, turns: [] };
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
    if (d.route === 'command' && d.match) done = await runCommand(rt, d.match.command);
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

/* ---------------------------------------------------------------- views */

const useSetting = (rt: AxfRuntime, key: string) => useSyncExternalStore(rt.settings.subscribe, () => rt.settings.get(key));

function VoiceView() {
  const rt = useRuntime();
  const v = useVoice();
  useSetting(rt, K.overrides);
  usePluginRev();
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
      <Section title={`What you can say (${commands.length})`} aside={<Button size="sm" icon="sliders" onClick={() => rt.navigate('voice-commands')}>Voice commands</Button>}>
        <table className="fx-table"><tbody>
          {commands.slice(0, 40).map((c) => (
            <tr key={`${c.module}:${c.id}`}>
              <td>“{c.phrases[0]}”{c.phrases.length > 1 ? <span className="fx-muted"> or {c.phrases.slice(1, 3).map((p) => `“${p}”`).join(', ')}</span> : null}</td>
              <td className="fx-mono fx-muted">{c.action || 'reply'}</td>
            </tr>
          ))}
        </tbody></table>
        {commands.length > 40 && <p className="fx-muted">…and {commands.length - 40} more on the Voice commands page.</p>}
      </Section>
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
    <Section title="Try a sentence">
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
    </Section>
  );
}

function CommandRow({ c, onPatch }: { c: Effective; onPatch: (patch: { on?: boolean; phrases?: string[]; reply?: string } | null) => void }) {
  const [open, setOpen] = useState(false);
  const [phrases, setPhrases] = useState(c.phrases.join(', '));
  const [reply, setReply] = useState(c.reply ?? '');
  useEffect(() => { setPhrases(c.phrases.join(', ')); setReply(c.reply ?? ''); }, [c.phrases.join('|'), c.reply]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      <tr>
        <td><Switch label={`Listen for ${c.phrases[0]}`} hideLabel checked={c.on} onChange={(on) => onPatch({ on })} /></td>
        <td data-fx-row onClick={() => setOpen(!open)}>
          “{c.phrases[0]}”{c.phrases.length > 1 ? <span className="fx-muted"> or {c.phrases.slice(1, 3).map((p) => `“${p}”`).join(', ')}</span> : null}
          {c.edited && <span className="fx-chip">changed</span>}
          <div className="fx-mono fx-muted">{c.action || 'reply only'}</div>
        </td>
      </tr>
      {open && (
        <tr><td colSpan={2}>
          <div className="fx-stack">
            <TextField label="Phrases" hint="Comma separated. Any of them, anywhere in a sentence." value={phrases} onChange={setPhrases} />
            <TextField label="Reply" hint="What AmberX says back. {waiting} = approvals waiting." value={reply} onChange={setReply} />
            <div className="fx-row fx-row--wrap">
              <Button size="sm" tone="primary" onClick={() => { onPatch({ phrases: phraseList(phrases, 10), reply }); setOpen(false); }}>Save</Button>
              <Button size="sm" tone="quiet" disabled={!c.edited} onClick={() => { onPatch(null); setOpen(false); }}>Back to default</Button>
            </div>
          </div>
        </td></tr>
      )}
    </>
  );
}

function CommandTable({ list, onPatch }: { list: Effective[]; onPatch: (c: Effective, patch: { on?: boolean; phrases?: string[]; reply?: string } | null) => void }) {
  const byOwner = new Map<string, Effective[]>();
  for (const c of list) byOwner.set(c.owner ?? '', [...(byOwner.get(c.owner ?? '') ?? []), c]);
  if (!list.length) return <p className="fx-muted">None here yet.</p>;
  return (
    <div className="fx-stack">
      {[...byOwner.entries()].map(([owner, cs]) => (
        <div key={owner || '-'}>
          {byOwner.size > 1 && <p className="fx-eyebrow">{owner || 'Other'} ({cs.filter((c) => c.on).length}/{cs.length} on)</p>}
          <table className="fx-table"><tbody>
            {cs.map((c) => <CommandRow key={c.id} c={c} onPatch={(p) => onPatch(c, p)} />)}
          </tbody></table>
        </div>
      ))}
    </div>
  );
}

function Examples({ items, onTry }: { items: { say: string; does: string }[]; onTry: (s: string) => void }) {
  return (
    <Section title="Sentences it understands">
      <p className="fx-muted">Built into the notes plugin: no setup. Swap in your own words and list names. Tap one to try it.</p>
      <table className="fx-table"><tbody>
        {items.map((e) => (
          <tr key={e.say} data-fx-row onClick={() => onTry(e.say)}>
            <td>“{e.say}”</td>
            <td className="fx-muted">{e.does}</td>
          </tr>
        ))}
      </tbody></table>
    </Section>
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
  return (
    <Section title="Add your own">
      <div className="fx-stack">
        <TextField label="Phrases" hint="Comma separated." value={form.phrases} onChange={(phrases) => setForm({ ...form, phrases })} placeholder="good morning, morning" />
        <SelectField label="Does" value={form.action} options={options} onChange={(action) => setForm({ ...form, action })} />
        <TextField label="Reply" value={form.reply} onChange={(reply) => setForm({ ...form, reply })} placeholder="Morning! You have {waiting} waiting." />
        {err && <Note tone="warning">{err}</Note>}
        <div><Button tone="primary" icon="plus" onClick={add}>Add command</Button></div>
        {mine.length > 0 && (
          <table className="fx-table"><tbody>
            {mine.map((m) => (
              <tr key={m.id}>
                <td>“{m.phrases.join('”, “')}”<div className="fx-mono fx-muted">{m.action || 'reply only'}</div></td>
                <td><Button size="sm" tone="quiet" icon="trash" onClick={() => save(mine.filter((x) => x.id !== m.id))}>Remove</Button></td>
              </tr>
            ))}
          </tbody></table>
        )}
        {errors.length > 0 && <Note tone="warning">Typed commands in settings: {errors.join(' ')}</Note>}
      </div>
    </Section>
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
  const patch = (c: Effective, p: { on?: boolean; phrases?: string[]; reply?: string } | null) => {
    const base = managedCommands(rt).find((m) => m.id === c.id) ?? c;
    rt.settings.set(K.overrides, JSON.stringify(p ? setOverride(overrides, base, p) : resetOverrides(overrides, [c.id])));
  };
  return (
    <div className="fx-stack fx-stack--lg">
      <header className="fx-pagehead">
        <div>
          <p className="fx-eyebrow">Voice control</p>
          <h1>Voice commands</h1>
          <p className="fx-muted">{all.filter((c) => c.on).length} of {all.length} on. Pages and actions are read from the app, so new ones show up by themselves.</p>
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
      <Section
        title={GROUPS.find((g) => g.id === tab)!.label}
        aside={<Button size="sm" tone="quiet" icon="undo" disabled={!inTab.some((c) => c.edited)} confirm="Put this tab's commands back to their defaults?" undoable={false}
          onClick={() => rt.settings.set(K.overrides, JSON.stringify(resetOverrides(overrides, inTab.map((c) => c.id))))}>Reset to defaults</Button>}
      >
        <CommandTable list={inTab} onPatch={patch} />
      </Section>
    </div>
  );
}

/* ---------------------------------------------------------------- library */

export const library: AxfWebLibrary = {
  id: ID,
  label: 'Voice control',
  version: '0.2.0',
  builtWith: { model: 'opus', builtAt: '2026-10-27' },
  provides: ['amberx.voice'],
  views: { voice: { title: 'Voice', icon: 'mic', keywords: ['voice', 'speak', 'talk', 'command', 'wake'], render: () => <VoiceView /> },
    'voice-commands': { title: 'Voice commands', icon: 'sliders', keywords: ['voice', 'commands', 'phrases', 'say'], render: () => <VoiceCommandsView /> },
  },
  nav: { label: 'Voice', items: [{ id: 'voice', label: 'Voice', icon: 'mic', view: 'voice' }, { id: 'voice-commands', label: 'Voice commands', icon: 'sliders', view: 'voice-commands' }] },
  settingsTabs: [{ id: 'voice', label: 'Voice control', icon: 'mic', order: 20, parent: 'plugins' }],
  settings: [
    {
      id: 'amberx.voice', label: 'Voice control', icon: 'mic', tab: 'voice', settings: [
        { key: K.wake, label: 'Wake phrases', kind: 'text', default: 'hey amberx, okay amberx', description: 'Comma separated. Heard by the Android app with the screen off (Monitoring → Listen in the background).' },
        { key: K.lang, label: 'Language', kind: 'text', default: 'en-US', description: 'For recognition and spoken replies, e.g. en-US, en-GB.' },
        { key: K.speak, label: 'Answer out loud', kind: 'toggle', default: true },
        { key: K.notes, label: 'Notes sentences', kind: 'toggle', default: true, description: 'Let sentences like “note in work: …” or “add a todo … by friday” go to the Notes plugin.' },
        { key: 'amberx.voice.manage', label: 'Voice commands', kind: 'link', target: 'voice-commands', description: 'Switch commands on or off, change their phrases, add your own.' },
        { key: K.commands, label: 'Your own commands (typed)', kind: 'text', default: '', description: 'One per line: phrase, other phrase = action | reply. Example: open alerts = nav:monitor | Here you go. The Voice commands page has a form for these.' },
      ],
    },
  ],
  contextMenu: [{ id: 'amberx.voice', items: [{ id: 'voice.listen', label: 'Speak a command', icon: 'mic', action: 'voice.listen' }] }],
  appMenu: [{ id: 'amberx.voice', menu: 'axhub', items: [{ id: 'voice.listen', label: 'Speak a command', icon: 'mic', action: 'voice.listen' }, { id: 'voice.commands', label: 'Voice commands', icon: 'sliders', action: 'voice.commands' }] }],
  register(rt) {
    rt.actions.register('voice.listen', () => void listenOnce(rt), { label: 'Speak a command' });
    rt.actions.register('voice.commands', () => rt.navigate('voice-commands'), { label: 'Voice commands' });
    // The watch service heard the wake phrase with the app closed: the rest of the sentence may already be the command.
    void native.addListener('wake', ({ text }) => {
      const rest = afterWake(text ?? '', phraseList(rt.settings.get(K.wake)));
      if (rest) void handle(rt, rest);
      else void say(rt, 'Yes?').then(() => listenOnce(rt));
    }).catch(() => undefined);
  },
};
