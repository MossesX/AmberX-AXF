/**
 * AmberX voice command center (voice-command@1), pure: no DOM, no runtime. Tested by `apps/amberx-droid/test.mjs`.
 *
 * Brett (Oct 28 2026): "a whole shit load of voice commands for the notes and todo parts … separate categories in a tab
 * group … each section has a tab and a trigger so the app knows if it's a note or task manager command … chains and
 * wizards to complete complex tasks … a developer tab … a tab for running snippets through the AI".
 *
 * - **Category** = a tab (notes, tasks, developer, snippets) with its own trigger words ("note …", "task …", "dev …",
 *   "ask …"). A sentence that starts with a category trigger only looks at that category's commands; otherwise every
 *   category is tried and the category of the page on screen wins ties.
 * - **Command** = an action, a chain (steps run in order) or a wizard (questions asked out loud, answers fill slots,
 *   then steps run). Phrases are patterns: `{text}` / `{list}` / `{due}` … are slots filled from what was said.
 * - Everything a person changes (on/off, phrases, recordings, settings, their own chains) is an **override**, saved per
 *   command; the library itself is code and can grow without breaking anyone's changes.
 */

export const FORMAT = 'voice-command@1';

export type CategoryId = 'notes' | 'tasks' | 'developer' | 'snippets';
export interface Category {
  id: CategoryId;
  label: string;
  icon: string;
  /** words that, said first, pick this category ("note add …", "task list today") */
  triggers: string[];
  /** the page that counts as "this category is on screen" */
  view: string;
  description: string;
}

export const CATEGORIES: Category[] = [
  { id: 'notes', label: 'Notes', icon: 'file', triggers: ['note', 'notes', 'notebook'], view: 'notes', description: 'Notes, lists and sub-lists: take, find, sort, rename, move, read back, export.' },
  { id: 'tasks', label: 'Tasks', icon: 'check', triggers: ['task', 'tasks', 'todo', 'to do', 'todos'], view: 'tasks', description: 'Tasks and to-dos: add, due dates, priorities, checklists, subtasks, reviews.' },
  { id: 'developer', label: 'Developer', icon: 'code', triggers: ['dev', 'developer', 'console', 'gizmo'], view: 'developer', description: 'Drive the Dev Console and the VPS through Molly: builds, PRs, checks, deploys, health.' },
  { id: 'snippets', label: 'AI snippets', icon: 'sparkles', triggers: ['ask', 'molly', 'ai', 'snippet'], view: 'snippets', description: 'Ready-made prompts run through the AI (Molly): summarize, rewrite, plan, explain.' },
];
export const categoryOf = (id: string) => CATEGORIES.find((c) => c.id === id);

export type CommandKind = 'action' | 'chain' | 'wizard';

/** One step of a chain or wizard. */
export type Step =
  /** run a runtime action spec (`notes.open`, `nav:tasks`, `tasks.open:today`…); `{slot}` filled */
  | { do: 'action'; action: string }
  /** a notes/tasks intent (notes core `Intent`), slots filled in its string fields */
  | { do: 'intent'; intent: Record<string, unknown> }
  /** say something; `{slot}` filled */
  | { do: 'say'; text: string }
  /** ask a question out loud; the answer goes into `slot` (`kind` guides how it's read) */
  | { do: 'ask'; slot: string; question: string; kind?: SlotKind; optional?: boolean; choices?: string[] }
  /** ask yes/no; no = stop the chain */
  | { do: 'confirm'; question: string }
  /** wait (ms) */
  | { do: 'wait'; ms: number }
  /** run another command by id (chains of chains) */
  | { do: 'run'; command: string }
  /** send a prompt to Molly / the AI (`{slot}` filled); the answer is said and kept in slot `answer` */
  | { do: 'ai'; prompt: string; into?: string }
  /** a developer task for Molly on the console / VPS (approvals happen on axHub) */
  | { do: 'molly'; task: string }
  /** a notes / tasks operation from ops.ts (`args` strings take `{slot}`) */
  | { do: 'op'; op: string; args?: Record<string, string> };

export type SlotKind = 'text' | 'list' | 'item' | 'date' | 'priority' | 'number' | 'yesno' | 'choice' | 'tag';

export interface CommandSettings {
  /** ask before running */
  confirm?: boolean;
  /** answer out loud when done */
  speak?: boolean;
  /** what to say when done (`{slot}` filled); empty = the action's own answer */
  reply?: string;
  /** only when this category's page is on screen */
  onlyOnPage?: boolean;
}

export interface Command {
  id: string;
  category: CategoryId;
  kind: CommandKind;
  /** grid group inside the tab ("Lists", "Due dates", "Builds"…) */
  group: string;
  label: string;
  description: string;
  /** patterns: words + `{slot}`; the first is the one shown */
  phrases: string[];
  steps: Step[];
  /** slots the phrases can fill, with how to read them */
  slots?: Record<string, SlotKind>;
  /** slots some phrases leave out (they fill as empty; the step's op has a default) */
  optional?: string[];
  settings?: CommandSettings;
  /** off until the person switches it on */
  defaultOff?: boolean;
  /** needs the AI connection / Molly */
  needsAi?: boolean;
  /** touches the console or VPS (Molly, approvals) */
  developer?: boolean;
}

/* ---------------------------------------------------------------- overrides (what a person changed) */

export interface Recording { phrase: string; at: string }
export interface CommandOverride {
  on?: boolean;
  phrases?: string[];
  settings?: CommandSettings;
  /** phrases recorded twice and matched */
  recordings?: Recording[];
  /** an edited chain / wizard */
  steps?: Step[];
  label?: string;
}
export type Overrides = Record<string, CommandOverride>;
/** chains / wizards / commands the person made */
export type CustomCommands = Command[];

export const MAX_PHRASES = 12;
export const MAX_STEPS = 40;
export const MAX_CUSTOM = 300;

export interface Effective extends Command {
  on: boolean;
  edited: boolean;
  custom: boolean;
  recordings: Recording[];
}

export function effective(library: readonly Command[], overrides: Overrides, custom: readonly Command[] = []): Effective[] {
  const out: Effective[] = [];
  for (const c of [...library, ...custom.map((x) => ({ ...x, __custom: true }))] as (Command & { __custom?: boolean })[]) {
    const o = overrides[c.id] ?? {};
    const recorded = (o.recordings ?? []).map((r) => r.phrase);
    const phrases = dedupe([...(o.phrases ?? c.phrases), ...recorded]).slice(0, MAX_PHRASES + 6);
    const { __custom, ...cmd } = c;
    out.push({
      ...cmd,
      label: o.label ?? c.label,
      phrases,
      steps: o.steps ?? c.steps,
      settings: { ...c.settings, ...o.settings },
      on: o.on ?? !c.defaultOff,
      edited: !!(o.phrases || o.settings || o.steps || o.label || o.on !== undefined || o.recordings?.length),
      custom: !!__custom,
      recordings: o.recordings ?? [],
    });
  }
  return out;
}

const dedupe = (xs: string[]) => [...new Set(xs.map((x) => x.trim()).filter(Boolean))];

export function parseOverrides(raw: unknown): Overrides {
  let v: unknown = raw;
  if (typeof raw === 'string') { try { v = JSON.parse(raw); } catch { return {}; } }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
  const out: Overrides = {};
  for (const [id, o] of Object.entries(v as Record<string, unknown>)) {
    if (!/^[a-z0-9._:-]{1,80}$/i.test(id) || !o || typeof o !== 'object') continue;
    const r = o as Record<string, unknown>;
    const x: CommandOverride = {};
    if (typeof r.on === 'boolean') x.on = r.on;
    if (Array.isArray(r.phrases)) x.phrases = r.phrases.filter((p): p is string => typeof p === 'string').map((p) => p.slice(0, 100)).slice(0, MAX_PHRASES);
    if (r.settings && typeof r.settings === 'object') x.settings = cleanSettings(r.settings);
    if (Array.isArray(r.recordings)) x.recordings = r.recordings.filter((p): p is Recording => !!p && typeof (p as Recording).phrase === 'string').map((p) => ({ phrase: p.phrase.slice(0, 100), at: String(p.at ?? '') })).slice(0, 6);
    if (Array.isArray(r.steps)) { const s = cleanSteps(r.steps); if (s.length) x.steps = s; }
    if (typeof r.label === 'string' && r.label.trim()) x.label = r.label.trim().slice(0, 80);
    out[id] = x;
  }
  return out;
}

export function cleanSettings(raw: unknown): CommandSettings {
  const r = (raw ?? {}) as Record<string, unknown>;
  const s: CommandSettings = {};
  for (const k of ['confirm', 'speak', 'onlyOnPage'] as const) if (typeof r[k] === 'boolean') s[k] = r[k] as boolean;
  if (typeof r.reply === 'string') s.reply = r.reply.slice(0, 300);
  return s;
}

const SLOT_KINDS: SlotKind[] = ['text', 'list', 'item', 'date', 'priority', 'number', 'yesno', 'choice', 'tag'];
const ACTION = /^[a-z][a-z0-9._-]*(:[A-Za-z0-9._:{} -]+)?$/;

/** Steps from anywhere (an edited chain, an import) are checked; bad ones are dropped. */
export function cleanSteps(raw: unknown[]): Step[] {
  const out: Step[] = [];
  for (const x of raw.slice(0, MAX_STEPS)) {
    if (!x || typeof x !== 'object') continue;
    const s = x as Record<string, unknown>;
    const str = (k: string, max = 500) => (typeof s[k] === 'string' ? (s[k] as string).slice(0, max) : '');
    switch (s.do) {
      case 'action': if (ACTION.test(str('action'))) out.push({ do: 'action', action: str('action', 200) }); break;
      case 'intent': if (s.intent && typeof s.intent === 'object') out.push({ do: 'intent', intent: s.intent as Record<string, unknown> }); break;
      case 'say': if (str('text')) out.push({ do: 'say', text: str('text') }); break;
      case 'ask': {
        const slot = str('slot', 40);
        if (/^[a-z][a-z0-9_]*$/i.test(slot) && str('question')) {
          const kind = SLOT_KINDS.includes(s.kind as SlotKind) ? (s.kind as SlotKind) : 'text';
          out.push({ do: 'ask', slot, question: str('question'), kind, ...(s.optional === true ? { optional: true } : {}), ...(Array.isArray(s.choices) ? { choices: s.choices.filter((c): c is string => typeof c === 'string').slice(0, 20) } : {}) });
        }
        break;
      }
      case 'confirm': if (str('question')) out.push({ do: 'confirm', question: str('question') }); break;
      case 'wait': { const ms = Number(s.ms); if (ms > 0) out.push({ do: 'wait', ms: Math.min(ms, 30_000) }); break; }
      case 'run': if (/^[a-z0-9._:-]{1,80}$/i.test(str('command'))) out.push({ do: 'run', command: str('command', 80) }); break;
      case 'ai': if (str('prompt', 4000)) out.push({ do: 'ai', prompt: str('prompt', 4000), ...(str('into', 40) ? { into: str('into', 40) } : {}) }); break;
      case 'molly': if (str('task', 4000)) out.push({ do: 'molly', task: str('task', 4000) }); break;
      case 'op': {
        if (!/^[a-z][a-z0-9-]{1,40}$/.test(str('op', 41))) break;
        const args: Record<string, string> = {};
        if (s.args && typeof s.args === 'object') for (const [k, v] of Object.entries(s.args as Record<string, unknown>)) if (/^[a-z][a-z0-9_]{0,30}$/i.test(k) && typeof v === 'string') args[k] = v.slice(0, 500);
        out.push({ do: 'op', op: str('op', 41), ...(Object.keys(args).length ? { args } : {}) });
        break;
      }
      default: break;
    }
  }
  return out;
}

export function setOverride(o: Overrides, id: string, patch: CommandOverride): Overrides {
  const next = { ...o, [id]: { ...(o[id] ?? {}), ...patch } };
  return next;
}
export function resetOverride(o: Overrides, id: string): Overrides { const { [id]: _gone, ...rest } = o; return rest; }

/* ---------------------------------------------------------------- matching */

/** Lower case, letters/digits/spaces only (same rule as the voice plugin). */
export function norm(s: unknown): string {
  return typeof s === 'string'
    ? s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/['’]/g, '').replace(/[^a-z0-9{} ]+/g, ' ').replace(/\s+/g, ' ').trim()
    : '';
}

/** Splits a category trigger off the front ("task add milk" → tasks, "add milk"). */
export function splitCategory(heard: string, cats: readonly Category[] = CATEGORIES): { category: CategoryId | null; rest: string } {
  const h = norm(heard);
  let best: { id: CategoryId; t: string } | null = null;
  for (const c of cats) for (const t of c.triggers) {
    const n = norm(t);
    if ((h === n || h.startsWith(`${n} `)) && (!best || n.length > best.t.length)) best = { id: c.id, t: n };
  }
  return best ? { category: best.id, rest: h.slice(best.t.length).trim() } : { category: null, rest: h };
}

export interface PatternMatch { slots: Record<string, string>; score: number }

/**
 * Matches a phrase pattern ("add {text} to {list}") against what was heard. Literal words must appear in order; slots
 * take the words between them (a trailing slot takes the rest). Score = literal words matched (more specific wins),
 * minus a little for every extra word not explained by a slot.
 */
export function matchPattern(pattern: string, heard: string): PatternMatch | null {
  const parts = norm(pattern).split(' ').filter(Boolean);
  const words = norm(heard).split(' ').filter(Boolean);
  if (!parts.length || !words.length) return null;
  const literals = parts.filter((p) => !isSlot(p)).length;
  const best = walk(parts, 0, words, 0, {});
  if (!best) return null;
  return { slots: best, score: literals * 10 - 0 };
}

const isSlot = (p: string) => /^\{[a-z][a-z0-9_]*\}$/.test(p);

function walk(parts: string[], pi: number, words: string[], wi: number, slots: Record<string, string>): Record<string, string> | null {
  if (pi === parts.length) return wi === words.length ? slots : null;
  const p = parts[pi]!;
  if (!isSlot(p)) {
    if (wi < words.length && words[wi] === p) return walk(parts, pi + 1, words, wi + 1, slots);
    return null;
  }
  const name = p.slice(1, -1);
  // a slot takes at least one word; try the shortest first so following literals anchor it
  for (let end = wi + 1; end <= words.length; end++) {
    const got = walk(parts, pi + 1, words, end, { ...slots, [name]: words.slice(wi, end).join(' ') });
    if (got) return got;
  }
  return null;
}

export interface CommandHit { command: Effective; phrase: string; slots: Record<string, string>; score: number; category: CategoryId }

/**
 * The command a sentence means. A category trigger said first narrows it to that category; the category whose page is
 * on screen (`onPage`) wins ties; commands set `onlyOnPage` are tried only there. Off commands never match.
 */
export function findCommand(heard: string, commands: readonly Effective[], ctx: { onPage?: CategoryId | null } = {}): CommandHit | null {
  const { category, rest } = splitCategory(heard);
  const tries: { text: string; only: CategoryId | null }[] = category ? [{ text: rest, only: category }, { text: norm(heard), only: null }] : [{ text: norm(heard), only: null }];
  for (const t of tries) {
    let best: CommandHit | null = null;
    for (const c of commands) {
      if (!c.on) continue;
      if (t.only && c.category !== t.only) continue;
      if (c.settings?.onlyOnPage && ctx.onPage !== c.category) continue;
      for (const ph of c.phrases) {
        const m = matchPattern(ph, t.text);
        if (!m) continue;
        const score = m.score + (ctx.onPage === c.category ? 3 : 0) + (t.only ? 5 : 0);
        if (!best || score > best.score) best = { command: c, phrase: ph, slots: m.slots, score, category: c.category };
      }
    }
    if (best) return best;
  }
  return null;
}

/** `{slot}` → value; missing slots become empty. */
export function fill(template: string, slots: Record<string, string>): string {
  return template.replace(/\{([a-z][a-z0-9_]*)\}/gi, (_m, k: string) => slots[k] ?? '');
}

export function fillDeep<T>(v: T, slots: Record<string, string>): T {
  if (typeof v === 'string') return fill(v, slots) as unknown as T;
  if (Array.isArray(v)) return v.map((x) => fillDeep(x, slots)) as unknown as T;
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, fillDeep(x, slots)])) as T;
  return v;
}

/* ---------------------------------------------------------------- recordings */

/** Two recordings agree when they normalise to the same words, or differ by at most one short word. */
export function recordingsMatch(a: string, b: string): boolean {
  const x = norm(a).split(' ').filter(Boolean);
  const y = norm(b).split(' ').filter(Boolean);
  if (!x.length || !y.length) return false;
  if (x.join(' ') === y.join(' ')) return true;
  if (Math.abs(x.length - y.length) > 1) return false;
  const dist = editDistance(x, y);
  return dist <= 1 && Math.max(x.length, y.length) >= 2;
}

function editDistance(a: string[], b: string[]): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)] as number[]);
  for (let j = 1; j <= b.length; j++) d[0]![j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
  }
  return d[a.length]![b.length]!;
}

/** A phrase another command already uses (case/punctuation ignored), so a recording doesn't steal it. */
export function phraseTaken(phrase: string, commands: readonly Effective[], except: string): Effective | null {
  const p = norm(phrase);
  return commands.find((c) => c.id !== except && c.on && c.phrases.some((x) => norm(x) === p)) ?? null;
}

/* ---------------------------------------------------------------- grid helpers */

export type SortKey = 'label' | 'group' | 'kind' | 'phrase' | 'on' | 'edited';
export interface GridFilter { q?: string; group?: string; kind?: CommandKind | ''; state?: '' | 'on' | 'off' | 'edited' | 'custom' }

export function filterCommands(list: readonly Effective[], f: GridFilter): Effective[] {
  const words = norm(f.q ?? '').split(' ').filter(Boolean);
  return list.filter((c) => {
    if (f.group && c.group !== f.group) return false;
    if (f.kind && c.kind !== f.kind) return false;
    if (f.state === 'on' && !c.on) return false;
    if (f.state === 'off' && c.on) return false;
    if (f.state === 'edited' && !c.edited) return false;
    if (f.state === 'custom' && !c.custom) return false;
    if (!words.length) return true;
    const hay = norm(`${c.label} ${c.description} ${c.group} ${c.phrases.join(' ')}`);
    return words.every((w) => hay.includes(w));
  });
}

export function sortCommands(list: readonly Effective[], key: SortKey, dir: 'asc' | 'desc' = 'asc'): Effective[] {
  const val = (c: Effective): string => key === 'phrase' ? c.phrases[0] ?? '' : key === 'on' ? String(Number(!c.on)) : key === 'edited' ? String(Number(!c.edited)) : String(c[key] ?? '');
  const s = [...list].sort((a, b) => val(a).localeCompare(val(b)) || a.label.localeCompare(b.label));
  return dir === 'desc' ? s.reverse() : s;
}

export const groupsOf = (list: readonly Command[]) => [...new Set(list.map((c) => c.group))];

/** Plain words for a step (shown in the grid's details and read out by the edit wizard). */
export function describeStep(s: Step): string {
  switch (s.do) {
    case 'action': return `Run ${s.action}`;
    case 'intent': return `Do: ${String(s.intent.action ?? '')}${s.intent.list ? ` in ${String(s.intent.list)}` : ''}${s.intent.text ? ` “${String(s.intent.text)}”` : ''}`;
    case 'say': return `Say “${s.text}”`;
    case 'ask': return `Ask “${s.question}” → ${s.slot}${s.optional ? ' (optional)' : ''}`;
    case 'confirm': return `Confirm “${s.question}”`;
    case 'wait': return `Wait ${Math.round(s.ms / 100) / 10} s`;
    case 'run': return `Run command ${s.command}`;
    case 'ai': return `Ask the AI: “${s.prompt.slice(0, 80)}${s.prompt.length > 80 ? '…' : ''}”`;
    case 'molly': return `Molly: ${s.task.slice(0, 80)}${s.task.length > 80 ? '…' : ''}`;
    case 'op': return `${s.op.replace(/-/g, ' ')}${s.args ? ` (${Object.entries(s.args).map(([k, v]) => `${k}: ${v}`).join(', ')})` : ''}`;
  }
}

/** Library checks used by the tests: unique ids, phrases parse, slots used by steps are filled by a phrase or asked. */
export function checkLibrary(list: readonly Command[]): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const c of list) {
    if (ids.has(c.id)) errors.push(`duplicate id ${c.id}`);
    ids.add(c.id);
    if (!c.phrases.length) errors.push(`${c.id}: no phrase`);
    if (!c.steps.length) errors.push(`${c.id}: no steps`);
    if (cleanSteps(c.steps as unknown[]).length !== c.steps.length) errors.push(`${c.id}: a step doesn't pass cleanSteps`);
    const asked = new Set(c.steps.filter((s): s is Extract<Step, { do: 'ask' }> => s.do === 'ask').map((s) => s.slot));
    const used = new Set<string>();
    for (const s of c.steps) for (const m of JSON.stringify(s).matchAll(/\{([a-z][a-z0-9_]*)\}/gi)) used.add(m[1]!);
    for (const slot of used) {
      if (slot === 'answer' || asked.has(slot) || c.optional?.includes(slot)) continue;
      if (!c.phrases.some((p) => p.includes(`{${slot}}`)) && !c.steps.some((s) => s.do === 'ai' && s.into === slot)) errors.push(`${c.id}: slot {${slot}} is never filled`);
      else if (!c.phrases.every((p) => p.includes(`{${slot}}`)) && !c.steps.some((s) => s.do === 'ai' && s.into === slot)) errors.push(`${c.id}: slot {${slot}} isn't in every phrase and isn't asked`);
    }
    if (c.kind === 'wizard' && !asked.size) errors.push(`${c.id}: a wizard asks at least one question`);
    if (c.kind === 'chain' && c.steps.length < 2) errors.push(`${c.id}: a chain has two or more steps`);
  }
  for (const c of list) for (const s of c.steps) if (s.do === 'run' && !ids.has(s.command)) errors.push(`${c.id}: runs unknown command ${s.command}`);
  return errors;
}
