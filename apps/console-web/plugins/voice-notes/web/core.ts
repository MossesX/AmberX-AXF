/**
 * Voice notes — the pure model (no React, no fetch): the settings a voice-activated notes pusher reads, its lists with
 * numbers, subcategories and question sets, and the rules a listener applies to what it hears (strip the stop trigger,
 * "give me the list of lists", a spoken number → a list, which question set a trigger opens). The settings interface
 * edits this; the listener (Voice Vault on Android: `apps/voicevault/.../notes/`, a Kotlin twin of these rules) reads the
 * same data from axHub and saves notes to table `notes`.
 *
 * Stored on axHub through lib-hubstore: settings = `settings/voice-notes.json` (one key per field below, so two devices
 * editing different fields never overwrite each other), lists = table `lists`, notes = table `notes`, both in folder
 * `voice-notes` of the hub project.
 */

export const ID = 'ai.amberx.axf.console.voice-notes';
export const FOLDER = 'voice-notes';
export const HUB_PROJECT = 'amberx-axf';
export const SETTINGS_FILE = 'settings/voice-notes.json';
export const DATA_FOLDER = 'voice-notes';
export const LISTS_TABLE = 'lists';
export const NOTES_TABLE = 'notes';
export const MAX_LISTS = 99;
export const MAX_PHRASES = 12;
export const MAX_PHRASE_LEN = 60;

export interface Beep { on: boolean; hz: number; ms: number; volume: number }
export interface VoiceNotesSettings {
  enabled: boolean;
  /** what starts a note ("take a note") */
  startTriggers: string[];
  /** what ends the note; always cut from the text (and from the recording when `stripAudio`) */
  stopTriggers: string[];
  /** "give me the list of lists" */
  listTriggers: string[];
  /** backs out at any step */
  cancelTriggers: string[];
  beep: Beep;
  /** beep again when the stop trigger is heard */
  endBeep: boolean;
  maxSeconds: number;
  /** stop by itself after this much silence (0 = only the stop trigger) */
  silenceSeconds: number;
  stripAudio: boolean;
  keepAudio: boolean;
  language: string;
  /** spoken after the note: where to store it */
  askPrompt: string;
  /** how each list is read out: {number} and {name} */
  listFormat: string;
  /** read the lists without being asked */
  readListsFirst: boolean;
  confirm: boolean;
  /** spoken after saving: {list} and {sub} */
  confirmText: string;
  /** what to do when nothing matches after this many tries */
  retries: number;
  fallbackList: string;
}

export interface Subcategory { id: string; number: number; name: string; aliases: string[] }
export type TriggerKind = 'always' | 'number' | 'phrase';
export interface Question { id: string; ask: string; field: string }
export interface QuestionSet { id: string; label: string; trigger: { kind: TriggerKind; number?: number; phrase?: string }; subcategory: string; questions: Question[] }
export interface NoteList {
  id: string; number: number; name: string; aliases: string[];
  /** ask which subcategory after picking the list */
  askSubcategory: boolean;
  subcategoryPrompt: string;
  subcategories: Subcategory[];
  questionSets: QuestionSet[];
  /** the prompt for picking a question set ("say a number or a trigger") */
  questionPrompt: string;
}

export const DEFAULT_SETTINGS: VoiceNotesSettings = {
  enabled: true,
  startTriggers: ['take a note', 'new note'],
  stopTriggers: ['stop note', 'end note'],
  listTriggers: ['give me the list of lists', 'list the lists', 'what lists'],
  cancelTriggers: ['cancel', 'never mind'],
  beep: { on: true, hz: 880, ms: 180, volume: 0.4 },
  endBeep: true,
  maxSeconds: 120,
  silenceSeconds: 0,
  stripAudio: true,
  keepAudio: false,
  language: 'en-US',
  askPrompt: 'Where should I store it? Say a list, or say give me the list of lists.',
  listFormat: '{number}: {name}',
  readListsFirst: false,
  confirm: true,
  confirmText: 'Saved to {list}{sub}.',
  retries: 2,
  fallbackList: '',
};
export const SETTING_KEYS = Object.keys(DEFAULT_SETTINGS) as (keyof VoiceNotesSettings)[];

const clamp = (n: unknown, lo: number, hi: number, fb: number) => { const v = Number(n); return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fb; };
const text = (v: unknown, fb: string, max = 300) => (typeof v === 'string' ? v.slice(0, max) : fb);
/** A phrase as the listener compares it: lower case, words only, single spaces. */
export const normPhrase = (s: unknown): string => String(s ?? '').toLowerCase().replace(/[^\p{L}\p{N}' ]+/gu, ' ').replace(/\s+/g, ' ').trim();
export function phrases(v: unknown, fb: string[]): string[] {
  if (!Array.isArray(v)) return [...fb];
  const out: string[] = [];
  for (const p of v) { const t = String(p ?? '').trim().slice(0, MAX_PHRASE_LEN); if (normPhrase(t) && !out.some((o) => normPhrase(o) === normPhrase(t))) out.push(t); }
  return out.slice(0, MAX_PHRASES);
}

/** Stored values (any shape) → complete settings; anything missing or wrong falls back to the default. */
export function normalizeSettings(values: Record<string, unknown>): VoiceNotesSettings {
  const d = DEFAULT_SETTINGS;
  const b = (values.beep && typeof values.beep === 'object' ? values.beep : {}) as Record<string, unknown>;
  const bool = (k: keyof VoiceNotesSettings) => (typeof values[k] === 'boolean' ? (values[k] as boolean) : (d[k] as boolean));
  return {
    enabled: bool('enabled'),
    startTriggers: phrases(values.startTriggers, d.startTriggers),
    stopTriggers: phrases(values.stopTriggers, d.stopTriggers),
    listTriggers: phrases(values.listTriggers, d.listTriggers),
    cancelTriggers: phrases(values.cancelTriggers, d.cancelTriggers),
    beep: { on: typeof b.on === 'boolean' ? b.on : d.beep.on, hz: clamp(b.hz, 200, 4000, d.beep.hz), ms: clamp(b.ms, 40, 2000, d.beep.ms), volume: clamp(b.volume, 0, 1, d.beep.volume) },
    endBeep: bool('endBeep'),
    maxSeconds: Math.round(clamp(values.maxSeconds, 5, 900, d.maxSeconds)),
    silenceSeconds: Math.round(clamp(values.silenceSeconds, 0, 60, d.silenceSeconds)),
    stripAudio: bool('stripAudio'),
    keepAudio: bool('keepAudio'),
    language: /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(String(values.language ?? '')) ? String(values.language) : d.language,
    askPrompt: text(values.askPrompt, d.askPrompt),
    listFormat: text(values.listFormat, d.listFormat, 80),
    readListsFirst: bool('readListsFirst'),
    confirm: bool('confirm'),
    confirmText: text(values.confirmText, d.confirmText),
    retries: Math.round(clamp(values.retries, 0, 5, d.retries)),
    fallbackList: text(values.fallbackList, '', 64),
  };
}

let seq = 0;
export const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}${(seq++).toString(36)}`;

export function newList(lists: NoteList[], name = 'New list'): NoteList {
  const used = new Set(lists.map((l) => l.number));
  let n = 1; while (used.has(n)) n++;
  return { id: newId('list'), number: n, name, aliases: [], askSubcategory: false, subcategoryPrompt: 'Which part of {list}?', subcategories: [], questionSets: [], questionPrompt: 'Say a number or a trigger for the questions, or say none.' };
}

function normalizeSub(raw: unknown, i: number): Subcategory | null {
  const o = (raw && typeof raw === 'object' ? raw : null) as Record<string, unknown> | null;
  if (!o) return null;
  return { id: text(o.id, `sub-${i}`, 64) || `sub-${i}`, number: Math.round(clamp(o.number, 1, MAX_LISTS, i + 1)), name: text(o.name, '', 80), aliases: phrases(o.aliases, []) };
}
function normalizeSet(raw: unknown, i: number): QuestionSet | null {
  const o = (raw && typeof raw === 'object' ? raw : null) as Record<string, unknown> | null;
  if (!o) return null;
  const t = (o.trigger && typeof o.trigger === 'object' ? o.trigger : {}) as Record<string, unknown>;
  const kind: TriggerKind = t.kind === 'number' || t.kind === 'phrase' ? t.kind : 'always';
  const qs = Array.isArray(o.questions) ? o.questions : [];
  return {
    id: text(o.id, `set-${i}`, 64) || `set-${i}`, label: text(o.label, '', 80),
    trigger: kind === 'number' ? { kind, number: Math.round(clamp(t.number, 1, MAX_LISTS, 1)) } : kind === 'phrase' ? { kind, phrase: text(t.phrase, '', MAX_PHRASE_LEN) } : { kind },
    subcategory: text(o.subcategory, '', 64),
    questions: qs.slice(0, 20).map((q, k) => { const x = (q && typeof q === 'object' ? q : {}) as Record<string, unknown>; return { id: text(x.id, `q-${k}`, 64) || `q-${k}`, ask: text(x.ask, ''), field: text(x.field, '', 40) }; }),
  };
}
/** A stored row → a list; null when it isn't one. */
export function normalizeList(raw: unknown, id?: string): NoteList | null {
  const o = (raw && typeof raw === 'object' ? raw : null) as Record<string, unknown> | null;
  if (!o) return null;
  const subs = (Array.isArray(o.subcategories) ? o.subcategories : []).map(normalizeSub).filter((x): x is Subcategory => !!x);
  const sets = (Array.isArray(o.questionSets) ? o.questionSets : []).map(normalizeSet).filter((x): x is QuestionSet => !!x);
  return {
    id: id ?? (text(o.id, '', 64) || newId('list')), number: Math.round(clamp(o.number, 1, MAX_LISTS, 1)), name: text(o.name, '', 80), aliases: phrases(o.aliases, []),
    askSubcategory: o.askSubcategory === true, subcategoryPrompt: text(o.subcategoryPrompt, 'Which part of {list}?'),
    subcategories: subs, questionSets: sets, questionPrompt: text(o.questionPrompt, 'Say a number or a trigger for the questions, or say none.'),
  };
}
export const sortLists = (lists: NoteList[]) => [...lists].sort((a, b) => a.number - b.number || a.name.localeCompare(b.name));

/** Everything the listener couldn't work with, as readable lines ([] = fine). */
export function problems(s: VoiceNotesSettings, lists: NoteList[]): string[] {
  const out: string[] = [];
  if (!s.startTriggers.length) out.push('Add at least one start trigger.');
  if (!s.stopTriggers.length) out.push('Add at least one stop trigger.');
  const groups: [string, string[]][] = [['start', s.startTriggers], ['stop', s.stopTriggers], ['list of lists', s.listTriggers], ['cancel', s.cancelTriggers]];
  const seen = new Map<string, string>();
  for (const [g, ps] of groups) for (const p of ps) { const k = normPhrase(p); const was = seen.get(k); if (was && was !== g) out.push(`"${p}" is both a ${was} and a ${g} trigger.`); seen.set(k, g); }
  const nums = new Map<number, string>();
  for (const l of lists) {
    if (!l.name.trim()) out.push(`List ${l.number} has no name.`);
    const was = nums.get(l.number); if (was !== undefined) out.push(`Lists "${was}" and "${l.name}" both have number ${l.number}.`); nums.set(l.number, l.name);
    const sn = new Set<number>();
    for (const sc of l.subcategories) { if (sn.has(sc.number)) out.push(`${l.name}: two subcategories have number ${sc.number}.`); sn.add(sc.number); if (!sc.name.trim()) out.push(`${l.name}: subcategory ${sc.number} has no name.`); }
    for (const qs of l.questionSets) {
      if (qs.trigger.kind === 'phrase' && !normPhrase(qs.trigger.phrase)) out.push(`${l.name}: a question set has an empty trigger phrase.`);
      if (qs.subcategory && !l.subcategories.some((x) => x.id === qs.subcategory)) out.push(`${l.name}: a question set files into a subcategory that's gone.`);
    }
    if (l.questionSets.filter((q) => q.trigger.kind === 'always').length > 1) out.push(`${l.name}: more than one question set is asked every time.`);
  }
  if (s.fallbackList && !lists.some((l) => l.id === s.fallbackList)) out.push('The fallback list is gone; pick another.');
  return out;
}

/* ---------- what the listener does with what it hears ---------- */

const UNITS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const NUMBER_SKIP = new Set(['number', 'list', 'the', 'please', 'option', 'store', 'it', 'in', 'to']);
const ORDINAL: Record<string, number> = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10 };
/** "3", "three", "number twenty one", "list 12", "the second one" → 1–99; null when there's no number. */
export function spokenNumber(utterance: string): number | null {
  const words = normPhrase(utterance).replace(/-/g, ' ').split(' ').filter((w) => !NUMBER_SKIP.has(w));
  for (let i = 0; i < words.length; i++) {
    const w = words[i]!;
    if (/^\d{1,2}$/.test(w)) return Number(w) || null;
    if (ORDINAL[w]) return ORDINAL[w]!;
    const t = TENS.indexOf(w);
    if (t >= 2) { const u = UNITS.indexOf(words[i + 1] ?? ''); return t * 10 + (u > 0 && u < 10 ? u : 0); }
    const u = UNITS.indexOf(w);
    if (u > 0) return u;
  }
  return null;
}

/** Cut the stop trigger (and anything after it) off the transcript. Returns the note text and the phrase cut, if any. */
export function stripStopTrigger(transcript: string, stops: string[]): { text: string; cut: string | null } {
  const lower = transcript.toLowerCase();
  let best: { at: number; phrase: string } | null = null;
  for (const p of stops) {
    const n = normPhrase(p); if (!n) continue;
    const re = new RegExp(`(^|[^\\p{L}\\p{N}])${n.split(' ').map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[^\\p{L}\\p{N}]+')}(?=$|[^\\p{L}\\p{N}])`, 'gu');
    let m: RegExpExecArray | null; let last: RegExpExecArray | null = null;
    while ((m = re.exec(lower))) last = m;
    if (last) { const at = last.index + last[1]!.length; if (!best || at > best.at) best = { at, phrase: p }; }
  }
  if (!best) return { text: transcript.trim(), cut: null };
  return { text: transcript.slice(0, best.at).replace(/[\s,;:.!?-]+$/u, '').trim(), cut: best.phrase };
}

const said = (utterance: string, ps: string[]) => { const u = ` ${normPhrase(utterance)} `; return ps.some((p) => { const n = normPhrase(p); return !!n && u.includes(` ${n} `); }); };
export const asksForLists = (utterance: string, s: VoiceNotesSettings) => said(utterance, s.listTriggers);
export const isCancel = (utterance: string, s: VoiceNotesSettings) => said(utterance, s.cancelTriggers);

/** The list a reply names: a spoken number first, else its name or an alias. */
export function pickList(utterance: string, lists: NoteList[]): NoteList | null {
  const n = spokenNumber(utterance);
  if (n !== null) { const byNum = lists.find((l) => l.number === n); if (byNum) return byNum; }
  const u = ` ${normPhrase(utterance)} `;
  let best: NoteList | null = null; let len = 0;
  for (const l of lists) for (const p of [l.name, ...l.aliases]) { const k = normPhrase(p); if (k && u.includes(` ${k} `) && k.length > len) { best = l; len = k.length; } }
  return best;
}
export function pickSubcategory(utterance: string, list: NoteList): Subcategory | null {
  const n = spokenNumber(utterance);
  if (n !== null) { const s = list.subcategories.find((x) => x.number === n); if (s) return s; }
  const u = ` ${normPhrase(utterance)} `;
  return list.subcategories.find((x) => [x.name, ...x.aliases].some((p) => { const k = normPhrase(p); return k && u.includes(` ${k} `); })) ?? null;
}
/** Which question set a reply opens: a number trigger, a phrase trigger, else the "always" set (or none). */
export function pickQuestionSet(utterance: string, list: NoteList): QuestionSet | null {
  const n = spokenNumber(utterance);
  if (n !== null) { const q = list.questionSets.find((x) => x.trigger.kind === 'number' && x.trigger.number === n); if (q) return q; }
  const u = ` ${normPhrase(utterance)} `;
  const byPhrase = list.questionSets.find((x) => x.trigger.kind === 'phrase' && normPhrase(x.trigger.phrase) && u.includes(` ${normPhrase(x.trigger.phrase)} `));
  return byPhrase ?? list.questionSets.find((x) => x.trigger.kind === 'always') ?? null;
}

export const readLists = (s: VoiceNotesSettings, lists: NoteList[]) => sortLists(lists).map((l) => s.listFormat.replace('{number}', String(l.number)).replace('{name}', l.name));

/** The conversation a listener would have, for the preview in the settings. */
export function conversationPreview(s: VoiceNotesSettings, lists: NoteList[], sample = 'buy milk and eggs'): { who: 'you' | 'app'; text: string }[] {
  const out: { who: 'you' | 'app'; text: string }[] = [];
  const stop = s.stopTriggers[0] ?? '…';
  out.push({ who: 'you', text: s.startTriggers[0] ?? '…' });
  if (s.beep.on) out.push({ who: 'app', text: `(beep ${s.beep.hz} Hz)` });
  out.push({ who: 'you', text: `${sample} ${stop}` });
  if (s.endBeep && s.beep.on) out.push({ who: 'app', text: '(beep)' });
  out.push({ who: 'app', text: `(note: "${stripStopTrigger(`${sample} ${stop}`, s.stopTriggers).text}")` });
  out.push({ who: 'app', text: s.askPrompt });
  const sorted = sortLists(lists);
  if (!s.readListsFirst) out.push({ who: 'you', text: s.listTriggers[0] ?? 'give me the list of lists' });
  out.push({ who: 'app', text: sorted.length ? readLists(s, sorted).join('. ') : '(no lists yet)' });
  const l = sorted[0];
  if (!l) return out;
  out.push({ who: 'you', text: String(l.number) });
  let sub = '';
  if (l.askSubcategory && l.subcategories.length) {
    out.push({ who: 'app', text: `${l.subcategoryPrompt.replace('{list}', l.name)} ${l.subcategories.map((x) => `${x.number}: ${x.name}`).join('. ')}` });
    const sc = l.subcategories[0]!;
    out.push({ who: 'you', text: String(sc.number) });
    sub = ` › ${sc.name}`;
  }
  const always = l.questionSets.find((x) => x.trigger.kind === 'always');
  const triggered = l.questionSets.find((x) => x.trigger.kind !== 'always');
  for (const qs of [always, triggered]) {
    if (!qs) continue;
    if (qs.trigger.kind !== 'always') { out.push({ who: 'app', text: l.questionPrompt }); out.push({ who: 'you', text: qs.trigger.kind === 'number' ? String(qs.trigger.number) : qs.trigger.phrase ?? '' }); }
    const into = l.subcategories.find((x) => x.id === qs.subcategory);
    if (into && !sub) sub = ` › ${into.name}`;
    for (const q of qs.questions) { out.push({ who: 'app', text: q.ask || '(question)' }); out.push({ who: 'you', text: `(answer → ${q.field || 'answer'})` }); }
  }
  if (s.confirm) out.push({ who: 'app', text: s.confirmText.replace('{list}', l.name).replace('{sub}', sub) });
  return out;
}

/* ---------- saved notes (table `notes`, written by the listener) ---------- */

/** One note the listener saved: hub-table@1 row `{list, subcategory, text, answers, at, by, device}`. */
export interface SavedNote { id: string; list: string; subcategory: string; text: string; answers: Record<string, string>; at: string; by: string; device: string }

const str = (v: unknown, max = 4000) => (typeof v === 'string' ? v.slice(0, max) : '');

/** A row from table `notes` → a note; null when it has no text. Unknown fields are dropped, long ones cut. */
export function normalizeNote(raw: unknown, id: string): SavedNote | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const text = str(r.text).trim();
  if (!text) return null;
  const answers: Record<string, string> = {};
  if (r.answers && typeof r.answers === 'object' && !Array.isArray(r.answers)) {
    for (const [k, v] of Object.entries(r.answers as Record<string, unknown>).slice(0, 40)) if (typeof v === 'string' && k) answers[k.slice(0, 60)] = v.slice(0, 1000);
  }
  return { id: str(r.id, 120) || id, list: str(r.list, 120), subcategory: str(r.subcategory, 120), text, answers, at: str(r.at, 40), by: str(r.by, 120), device: str(r.device, 120) };
}

/** Where a note went, in words: "Groceries › Vegetables", or the raw id when the list is gone. */
export function noteWhere(n: SavedNote, lists: NoteList[]): string {
  const l = lists.find((x) => x.id === n.list);
  if (!l) return n.list ? `${n.list} (list removed)` : 'No list';
  const sub = n.subcategory ? l.subcategories.find((s) => s.id === n.subcategory)?.name ?? n.subcategory : '';
  return sub ? `${l.name} › ${sub}` : l.name;
}

export interface NoteFilter { q?: string; list?: string; sub?: string }

/** Notes newest first, filtered by list (`''` = all, `'none'` = list gone or unset), subcategory and words (text, answers, where). */
export function filterNotes(notes: SavedNote[], lists: NoteList[], f: NoteFilter = {}): SavedNote[] {
  const words = normPhrase(f.q ?? '').split(' ').filter(Boolean);
  const known = new Set(lists.map((l) => l.id));
  return notes
    .filter((n) => !f.list || (f.list === 'none' ? !known.has(n.list) : n.list === f.list))
    .filter((n) => !f.sub || n.subcategory === f.sub)
    .filter((n) => {
      if (!words.length) return true;
      const hay = normPhrase([n.text, noteWhere(n, lists), ...Object.entries(n.answers).flat(), n.device].join(' '));
      return words.every((w) => hay.includes(w));
    })
    .sort((a, b) => (b.at || '').localeCompare(a.at || '') || b.id.localeCompare(a.id));
}

/** How many notes each list has (key `none` = list gone or unset). */
export function noteCounts(notes: SavedNote[], lists: NoteList[]): Record<string, number> {
  const known = new Set(lists.map((l) => l.id));
  const out: Record<string, number> = {};
  for (const n of notes) { const k = known.has(n.list) ? n.list : 'none'; out[k] = (out[k] ?? 0) + 1; }
  return out;
}

/** The notes as Markdown (for Copy). */
export function notesMarkdown(notes: SavedNote[], lists: NoteList[]): string {
  return notes.map((n) => {
    const ans = Object.entries(n.answers).map(([k, v]) => `  - ${k}: ${v}`).join('\n');
    return `- **${noteWhere(n, lists)}** (${n.at || 'no date'}): ${n.text}${ans ? `\n${ans}` : ''}`;
  }).join('\n');
}
