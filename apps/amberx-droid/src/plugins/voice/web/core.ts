/**
 * Voice control rules, pure (no DOM, no runtime): what a phrase means and which command it picks. Tested by
 * `apps/amberx-droid/test.mjs`.
 *
 * A command maps trigger phrases to an action id the runtime already knows (`nav:home`, `axhub.check`, …) and, when it
 * should answer, a reply. A reply may hold `{waiting}` (approvals waiting now). Plugins add commands with
 * `registerVoiceCommands`; the user adds their own in Settings → Plugins → Voice control as `phrase = action` lines.
 */
import { splitWake } from './speech';

export interface VoiceCommand {
  id: string;
  /** what the user may say; any of these, found anywhere in what was heard (whole words, case and punctuation ignored) */
  phrases: string[];
  /** action spec to dispatch (runtime vocabulary); empty = reply only */
  action: string;
  /** what AmberX says back; `{waiting}` = approvals waiting */
  reply?: string;
  /** who added it (a plugin id, or `user`) */
  module?: string;
}

export const MAX_COMMANDS = 200;
export const MAX_PHRASE = 80;

/** Lower case, letters/digits/spaces only, single spaces. */
export function normalize(text: unknown): string {
  return typeof text === 'string'
    ? text.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/['\u2019]/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()
    : '';
}

/** True when `phrase` appears in `heard` as whole words. */
export function contains(heard: string, phrase: string): boolean {
  const h = ` ${normalize(heard)} `;
  const p = normalize(phrase);
  return p.length > 0 && h.includes(` ${p} `);
}

export interface Match { command: VoiceCommand; phrase: string }

/** The command whose longest matching phrase is longest (the most specific one); ties go to the earlier command. */
export function pickCommand(heard: string, commands: readonly VoiceCommand[]): Match | null {
  let best: Match | null = null;
  for (const command of commands) {
    for (const phrase of command.phrases) {
      if (!contains(heard, phrase)) continue;
      if (!best || normalize(phrase).length > normalize(best.phrase).length) best = { command, phrase };
    }
  }
  return best;
}

/** Strips a wake phrase from the front of what was heard ("hey amberx open apps" → "open apps"). */
export function afterWake(heard: string, wakePhrases: readonly string[]): string {
  const h = normalize(heard);
  for (const w of [...wakePhrases].map(normalize).filter(Boolean).sort((a, b) => b.length - a.length)) {
    const i = ` ${h} `.indexOf(` ${w} `);
    if (i >= 0) return h.slice(i + w.length).trim();
  }
  // Recognizers spell the wake phrase their own way ("hey amber x", "hey ambrex"): match it loosely too.
  const loose = splitWake(heard, wakePhrases);
  return loose ? normalize(loose.rest) : h;
}

/** Phrases from a settings value: comma or new-line separated, trimmed, capped. */
export function phraseList(raw: unknown, max = 20): string[] {
  const out: string[] = [];
  for (const p of String(raw ?? '').split(/[,\n]+/)) {
    const t = normalize(p).slice(0, MAX_PHRASE);
    if (t && !out.includes(t) && out.length < max) out.push(t);
  }
  return out;
}

const ACTION = /^[a-z][a-z0-9._-]*(:[A-Za-z0-9._:-]+)?$/;

/** The user's own commands: `phrase[, phrase…] = action [| reply]`, one per line. Bad lines are listed, never used. */
export function parseUserCommands(raw: unknown): { commands: VoiceCommand[]; errors: string[] } {
  const commands: VoiceCommand[] = [];
  const errors: string[] = [];
  String(raw ?? '').split('\n').forEach((line, i) => {
    const t = line.trim();
    if (!t || t.startsWith('#')) return;
    const eq = t.indexOf('=');
    if (eq < 0) { errors.push(`Line ${i + 1}: needs "phrase = action".`); return; }
    const phrases = phraseList(t.slice(0, eq), 10);
    const [action = '', reply] = t.slice(eq + 1).split('|').map((s) => s.trim());
    if (!phrases.length) { errors.push(`Line ${i + 1}: no phrase.`); return; }
    if (action && !ACTION.test(action)) { errors.push(`Line ${i + 1}: "${action}" isn't an action id.`); return; }
    if (!action && !reply) { errors.push(`Line ${i + 1}: needs an action or a reply.`); return; }
    if (commands.length < MAX_COMMANDS) commands.push({ id: `user.${i + 1}`, phrases, action, reply: reply?.slice(0, 300), module: 'user' });
  });
  return { commands, errors };
}

/** Fills `{waiting}` in a reply. */
export function fillReply(reply: string, ctx: { waiting: number }): string {
  const n = ctx.waiting;
  return reply.replace(/\{waiting\}/g, n === 0 ? 'nothing' : n === 1 ? 'one approval' : `${n} approvals`);
}

/* ================================================================ commands manager (Voice commands page) */

/**
 * Where a command shows in the Voice commands page. Predefined commands come from the codebase at run time
 * (`navigationCommands` from every registered page, `actionCommands` from every registered argument-free action), the
 * plugins' own (`registerVoiceCommands`), the built-in ones and the user's own. Nothing edits them in code: a person's
 * changes are **overrides** (`amberx.voice.overrides`, JSON) keyed by command id: on/off, other phrases, another reply.
 */
export type CommandGroup = 'notes' | 'tasks' | 'nav' | 'actions' | 'plugins' | 'user' | 'builtin';
export const GROUPS: { id: CommandGroup; label: string; icon: string }[] = [
  { id: 'notes', label: 'Notes & lists', icon: 'file' },
  { id: 'tasks', label: 'Tasks', icon: 'check' },
  { id: 'nav', label: 'Navigation', icon: 'layout' },
  { id: 'actions', label: 'App actions', icon: 'zap' },
  { id: 'plugins', label: 'Plugins', icon: 'package' },
  { id: 'user', label: 'Yours', icon: 'user' },
  { id: 'builtin', label: 'Built-in', icon: 'mic' },
];

export interface ManagedCommand extends VoiceCommand {
  group: CommandGroup;
  /** heading inside its tab (the owner of an app action, the plugin of a plugin command) */
  owner?: string;
  /** on unless the user switched it; predefined app actions are off unless curated */
  defaultOn: boolean;
}

/** One command per page: "open <title>", "go to <title>", "show <title>" → `nav:<id>`. Duplicates and blanks dropped. */
export function navigationCommands(views: readonly { id: string; title: string }[]): ManagedCommand[] {
  const out: ManagedCommand[] = [];
  const seen = new Set<string>();
  for (const v of views) {
    const t = normalize(v.title).slice(0, MAX_PHRASE - 6);
    if (!v.id || !t || seen.has(v.id) || !/^[a-z0-9][a-z0-9._-]*$/i.test(v.id)) continue;
    seen.add(v.id);
    out.push({ id: `nav.${v.id}`, phrases: [`open ${t}`, `go to ${t}`, `show ${t}`], action: `nav:${v.id}`, reply: '', group: 'nav', defaultOn: true, module: 'voice.nav' });
  }
  return out;
}

/** Actions a person would say out loud and that are safe to have on from the start. */
export const CURATED_ACTIONS = new Set(['app.settings', 'axhub.check', 'monitor.start', 'monitor.stop', 'voice.listen', 'dictation.start', 'swap:color-theme:next', 'notes.new', 'tasks.new']);

/**
 * One command per argument-free action with a label (stubs, actions that need arguments, `nav` itself and ones kept out
 * of search are left out): the phrase is its label, grouped by who registered it. Off by default except the curated ones.
 */
export function actionCommands(actions: readonly { id: string; meta: { label?: string; params?: boolean; stub?: boolean; searchable?: boolean; module?: string } }[], curated: ReadonlySet<string> = CURATED_ACTIONS): ManagedCommand[] {
  const out: ManagedCommand[] = [];
  for (const { id, meta } of actions) {
    if (!id || meta.params || meta.stub || meta.searchable === false || id === 'nav' || id.startsWith('nav:')) continue;
    if (!ACTION.test(id)) continue;
    const label = normalize(meta.label ?? '').slice(0, MAX_PHRASE);
    if (!label) continue;
    out.push({ id: `action.${id}`, phrases: [label], action: id, group: 'actions', owner: meta.module || 'app', defaultOn: curated.has(id), module: meta.module || 'app' });
  }
  return out.sort((a, b) => (a.owner ?? '').localeCompare(b.owner ?? '') || a.phrases[0]!.localeCompare(b.phrases[0]!));
}

export interface Override { on?: boolean; phrases?: string[]; reply?: string }
export type Overrides = Record<string, Override>;
const OVERRIDE_ID = /^[a-z0-9][a-z0-9._:-]{0,120}$/i;

/** Overrides from settings (a JSON string; anything malformed is dropped, never thrown). */
export function parseOverrides(raw: unknown): Overrides {
  let v: unknown = raw;
  if (typeof raw === 'string') { try { v = raw.trim() ? JSON.parse(raw) : {}; } catch { return {}; } }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
  const out: Overrides = {};
  for (const [id, o] of Object.entries(v as Record<string, unknown>).slice(0, 2000)) {
    if (!OVERRIDE_ID.test(id) || !o || typeof o !== 'object') continue;
    const r = o as Record<string, unknown>;
    const ov: Override = {};
    if (typeof r.on === 'boolean') ov.on = r.on;
    if (Array.isArray(r.phrases)) { const p = phraseList(r.phrases.join('\n'), 10); if (p.length) ov.phrases = p; }
    if (typeof r.reply === 'string') ov.reply = r.reply.slice(0, 300);
    if (Object.keys(ov).length) out[id] = ov;
  }
  return out;
}

export interface Effective extends ManagedCommand { on: boolean; edited: boolean }

/** Commands with the user's overrides applied (phrases replaced, reply replaced, on/off). */
export function applyOverrides(commands: readonly ManagedCommand[], overrides: Overrides): Effective[] {
  return commands.map((c) => {
    const o = overrides[c.id];
    return {
      ...c,
      phrases: o?.phrases?.length ? o.phrases : c.phrases,
      ...(o?.reply !== undefined ? { reply: o.reply } : {}),
      on: o?.on ?? c.defaultOn,
      edited: !!o && Object.keys(o).length > 0,
    };
  });
}

/** Sets part of one command's override; a value equal to the command's default is dropped (so Reset = nothing stored). */
export function setOverride(overrides: Overrides, command: ManagedCommand, patch: Override): Overrides {
  const cur: Override = { ...(overrides[command.id] ?? {}), ...patch };
  if (cur.on === command.defaultOn) delete cur.on;
  if (cur.phrases && (!cur.phrases.length || JSON.stringify(cur.phrases) === JSON.stringify(command.phrases.map(normalize)))) delete cur.phrases;
  if (cur.reply !== undefined && cur.reply === (command.reply ?? '')) delete cur.reply;
  const next = { ...overrides };
  if (Object.keys(cur).length) next[command.id] = cur; else delete next[command.id];
  return next;
}

/** Drops the overrides of the given commands (one tab's Reset to defaults), or all when no ids. */
export function resetOverrides(overrides: Overrides, ids?: readonly string[]): Overrides {
  if (!ids) return {};
  const next = { ...overrides };
  for (const id of ids) delete next[id];
  return next;
}

/** The user's own commands, kept as JSON (`amberx.voice.mine`): phrases, an action from the picker, a reply. */
export interface MyCommand { id: string; phrases: string[]; action: string; reply?: string }
export function parseMine(raw: unknown): MyCommand[] {
  let v: unknown = raw;
  if (typeof raw === 'string') { try { v = raw.trim() ? JSON.parse(raw) : []; } catch { return []; } }
  if (!Array.isArray(v)) return [];
  const out: MyCommand[] = [];
  for (const o of v) {
    if (!o || typeof o !== 'object') continue;
    const r = o as Record<string, unknown>;
    const id = typeof r.id === 'string' && /^mine\.[a-z0-9-]{1,40}$/.test(r.id) ? r.id : '';
    const phrases = phraseList(Array.isArray(r.phrases) ? r.phrases.join('\n') : r.phrases, 10);
    const action = typeof r.action === 'string' && (r.action === '' || ACTION.test(r.action)) ? r.action : null;
    const reply = typeof r.reply === 'string' ? r.reply.slice(0, 300) : '';
    if (!id || !phrases.length || action === null || (!action && !reply) || out.some((x) => x.id === id) || out.length >= MAX_COMMANDS) continue;
    out.push({ id, phrases, action, ...(reply ? { reply } : {}) });
  }
  return out;
}

/** Checks a command typed in the Yours form. */
export function checkMine(input: { phrases: string; action: string; reply: string }): string | null {
  if (!phraseList(input.phrases, 10).length) return 'Say at least one phrase.';
  if (input.action && !ACTION.test(input.action.trim())) return `“${input.action}” isn't an action id.`;
  if (!input.action.trim() && !input.reply.trim()) return 'Pick an action or write a reply.';
  return null;
}

/** Legacy text commands (`amberx.voice.commands`) and the JSON ones, as managed commands in the Yours tab. */
export function userCommands(legacyText: unknown, mine: readonly MyCommand[]): ManagedCommand[] {
  return [
    ...mine.map((m): ManagedCommand => ({ ...m, group: 'user', defaultOn: true, module: 'user' })),
    ...parseUserCommands(legacyText).commands.map((c): ManagedCommand => ({ ...c, group: 'user', owner: 'Typed in settings', defaultOn: true })),
  ];
}

/* ---------------------------------------------------------------- command vs notes sentence */

export interface Decision {
  route: 'command' | 'intent';
  match: Match | null;
  /** plain words for the Try box */
  why: string;
}

/** Share of the sentence's words the matched phrase covers (1 = the phrase is the whole sentence). */
export function coverage(heard: string, phrase: string): number {
  const h = normalize(heard).split(' ').filter(Boolean).length;
  return h ? Math.min(1, normalize(phrase).split(' ').filter(Boolean).length / h) : 0;
}

/**
 * Which way a sentence goes, in this order:
 *  1. a command phrase that **is** the whole sentence → the command ("take a note", "open settings");
 *  2. the sentence is a notes sentence the local parser understands → the notes intent ("note in settings: …" even
 *     though "settings" is a command phrase, since the pattern explains every word);
 *  3. a command phrase covering at least half the words → the command ("please open approvals");
 *  4. a weaker command match → the command, unless the AI is there to read the sentence (then the notes intent);
 *  5. nothing matched → the notes intent (the AI, when connected, gets it; else "didn't catch").
 */
export function decide(heard: string, commands: readonly VoiceCommand[], opts: { localIntent?: boolean; ai?: boolean } = {}): Decision {
  const m = pickCommand(heard, commands);
  if (m && coverage(heard, m.phrase) >= 1) return { route: 'command', match: m, why: `“${m.phrase}” is the whole sentence.` };
  if (opts.localIntent) return { route: 'intent', match: m, why: m ? `It reads as a notes sentence, which explains more than “${m.phrase}”.` : 'It reads as a notes sentence.' };
  if (m && coverage(heard, m.phrase) >= 0.5) return { route: 'command', match: m, why: `“${m.phrase}” covers most of it.` };
  if (m && !opts.ai) return { route: 'command', match: m, why: `“${m.phrase}” is the closest command.` };
  if (m) return { route: 'intent', match: m, why: `“${m.phrase}” covers only a little, so the AI reads it.` };
  return { route: 'intent', match: null, why: opts.ai ? 'No command matched, so the AI reads it.' : 'No command matched.' };
}

/** What a notes intent would do, in plain words (the Try box). Takes the intent as data, so this file stays pure. */
export function describeIntent(i: { action: string; kind?: string; title?: string; text?: string; list?: string; sublist?: string; target?: string; to?: string; tasks?: { content: string }[]; due?: string; priority?: number } | null): string {
  if (!i) return 'Nothing: no notes sentence.';
  const where = i.list ? ` in ${i.list}${i.sublist ? ` › ${i.sublist}` : ''}` : '';
  const what = (i.title || i.text || '').slice(0, 80);
  const due = i.due ? `, due ${i.due.slice(0, 10)}` : '';
  const pr = i.priority ? `, ${['', 'low', 'medium', 'high'][i.priority]} priority` : '';
  switch (i.action) {
    case 'add': {
      const tasks = i.tasks?.length ? ` with ${i.tasks.length} task${i.tasks.length === 1 ? '' : 's'}` : '';
      return `Add a ${i.kind ?? 'note'}${what ? ` “${what}”` : ''}${tasks}${where || ' in Inbox'}${due}${pr}.`;
    }
    case 'create-list': return `Make the list ${i.sublist ? `${i.sublist} under ${i.list}` : i.list}.`;
    case 'move': return `Move ${i.target === 'last' || i.target === 'latest' ? `the last ${i.kind ?? 'item'}` : `“${i.target}”`} to ${i.list}.`;
    case 'rename-list': return `Rename the list ${i.target} to ${i.to}.`;
    case 'rename-item': return `Rename “${i.target}” to ${i.to}.`;
    case 'done': return `Mark ${i.target === 'last' ? 'the last one' : `“${i.target}”`} done.`;
    case 'undone': return `Reopen “${i.target}”.`;
    case 'remove': return `Remove the last ${i.kind ?? 'item'}.`;
    case 'read': return i.list ? `Read out the ${i.list} list.` : `Read out your open ${i.kind === 'note' ? 'notes' : 'tasks'}${i.due ? ' for today' : ''}.`;
    case 'search': return `Search notes for “${i.text ?? ''}”.`;
    case 'open': return `Open the ${i.list} list.`;
  }
  return `Do ${i.action}.`;
}

/** The page a notes result asks to show: the notes plugin's actions, only when they're registered. */
export function openSpec(open: { list?: string; q?: string; item?: string } | undefined, has: (id: string) => boolean): string | null {
  if (!open) return null;
  if (open.list && has('notes.open')) return `notes.open:${open.list}`;
  if (open.q && has('notes.search')) return `notes.search:${open.q.replace(/[:\s]+/g, ' ').trim().slice(0, 120)}`;
  return null;
}

/** Sentences the local notes parser understands, shown as examples (test.mjs checks each one parses). */
export const NOTE_EXAMPLES: { say: string; does: string }[] = [
  { say: 'note in work: fix the login page', does: 'A note in Work' },
  { say: 'take a note buy a new charger', does: 'A note in Inbox' },
  { say: 'create list bugs under work', does: 'Makes Work › Bugs' },
  { say: 'make a list called groceries', does: 'Makes Groceries' },
  { say: 'rename list groceries to shopping', does: 'Renames a list' },
  { say: 'move the last note to shopping', does: 'Moves your newest note' },
  { say: 'open the work list', does: 'Shows a list' },
  { say: 'read my shopping list', does: 'Reads a list out' },
  { say: 'find the router password', does: 'Searches your notes' },
];
export const TASK_EXAMPLES: { say: string; does: string }[] = [
  { say: 'add a todo call the bank to errands by friday', does: 'A todo in Errands, due Friday' },
  { say: 'add a task renew the domain tomorrow urgent', does: 'A high-priority task due tomorrow' },
  { say: 'remind me to water the plants', does: 'A todo in Inbox' },
  { say: 'mark call the bank done', does: 'Ticks it off' },
  { say: 'mark it done', does: 'Ticks off the newest one' },
  { say: 'reopen call the bank as not done', does: 'Opens it again' },
  { say: 'delete the last task', does: 'Removes your newest task' },
  { say: 'read my tasks for today', does: 'Reads out what is due today' },
];
