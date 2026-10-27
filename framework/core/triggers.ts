/*
 * Triggers — triggers@1 (kernel contract, web reference). Same design as the Kotlin kernel's
 * `ai.amberx.axf.kernel.triggers` (Triggers.kt); conformance fixture: spec/fixtures/triggers.json
 * (spec/check-triggers.mts, Kotlin TriggersConformanceTest).
 *
 * A trigger turns an INPUT (a spoken phrase, a hand gesture, a face gesture…) into an ACTION with arguments.
 * The kernel ships the data model, the open kind registry, the module-scoped registry (conflicts become
 * diagnostics) and the pure matcher: threshold, armed state, context filter, cooldown and argument capture are
 * decided here, the same way on every port. Detectors (a speech recognizer, a camera) are modules; `voice` is
 * built (lib-voice), `gesture` and `face` are typed placeholders until a detector module registers.
 *
 * lib-voice's `VoiceCommand`s are hosted as voice triggers through `voiceCommandTrigger` (same phrases, same
 * 0.8 threshold as a percentage, no arming), so Voice Vault keeps working unchanged.
 */

export const TRIGGERS_CONTRACT = 'triggers@1';
/** Capability a trigger host (the thing that listens and runs the matcher) registers under. */
export const TRIGGERS_CAPABILITY = 'axf.triggers';

/* ---------- kinds (open registry) ---------- */

export const TRIGGER_KIND_STATUSES = ['built', 'placeholder'] as const;
export type TriggerKindStatus = (typeof TRIGGER_KIND_STATUSES)[number];
export interface TriggerKindSpec {
  id: string;
  label: string;
  status: TriggerKindStatus;
  /** capability a detector for this kind registers under */
  capability: string;
  /** true when inputs of this kind are phrases with argument slots (else: signature ids) */
  spoken: boolean;
  note?: string;
}

/** Capabilities declared now so detector modules plug in later without reshuffling. */
export const TRIGGER_PLACEHOLDERS = {
  gesture: 'axf.triggers.gesture',
  face: 'axf.triggers.face',
} as const;

const kinds = new Map<string, TriggerKindSpec>([
  ['voice', { id: 'voice', label: 'Voice', status: 'built', capability: 'axf.voice', spoken: true, note: 'Spoken phrases with argument slots (lib-voice on Android)' }],
  ['gesture', { id: 'gesture', label: 'Hand gesture', status: 'placeholder', capability: TRIGGER_PLACEHOLDERS.gesture, spoken: false, note: 'Static poses and motions seen by a camera detector; also the arming poses' }],
  ['face', { id: 'face', label: 'Face gesture', status: 'placeholder', capability: TRIGGER_PLACEHOLDERS.face, spoken: false, note: 'Head poses and blendshape rules (nod, shake, double blink…)' }],
]);

/** Every trigger kind, built or placeholder. */
export function triggerKinds(): TriggerKindSpec[] { return [...kinds.values()]; }
export function triggerKind(id: string): TriggerKindSpec | undefined { return kinds.get(id); }
/** A port or a module adds a kind (or marks a placeholder built). */
export function registerTriggerKind(spec: TriggerKindSpec): void { kinds.set(spec.id, { ...spec }); }

/* ---------- the trigger ---------- */

/** permanent: shipped by a module, can be edited but never removed · custom: made by the user */
export type TriggerSource = 'permanent' | 'custom';
export const TRIGGER_SOURCES: TriggerSource[] = ['permanent', 'custom'];
/** required: fires only while its kind is armed (an arming pose was seen) · always: fires whenever it matches */
export type TriggerArming = 'required' | 'always';
export const TRIGGER_ARMINGS: TriggerArming[] = ['required', 'always'];

/** Thresholds are percentages: a trigger fires when the input's confidence is at least this. */
export const THRESHOLD_MIN = 0.01;
export const THRESHOLD_MAX = 99.99;
export const DEFAULT_THRESHOLD = 80;
export const DEFAULT_COOLDOWN_MS = 600;
/** `worksIn` entry meaning every context. An empty `worksIn` means the same. */
export const ANY_CONTEXT = '*';

export interface Trigger {
  /** namespaced: `<module>.<name>` (`notes.add`, `todo.check`) */
  id: string;
  /** trigger kind id (open: `voice`, `gesture`, `face`, …) */
  kind: string;
  source: TriggerSource;
  /** owning module id (`ai.amberx.axf.notes`); the registry scopes register/unregister by it */
  module: string;
  label: string;
  /**
   * Spoken kinds: phrases with argument slots — `note <text>`, `read my list <name>`, `jump to <time>`; a slot is
   * `<name>` or `<name:type>` with type text (default), number or time (seconds). Other kinds: signature ids
   * (`thumbs_up`, `nod_down`).
   */
  phrases: string[];
  /** action id (namespaced) the trigger fires; captured slots are merged over `args` */
  action: string;
  args?: Record<string, unknown>;
  /** 0.01..99.99 (percent) */
  threshold: number;
  /** contexts the trigger works in (open set: `notes.list`, `todo`, `*`); empty = anywhere */
  worksIn: string[];
  arming: TriggerArming;
  enabled?: boolean;
  cooldownMs?: number;
  /** epoch ms until which the trigger is muted ("Mute 1 h") */
  mutedUntil?: number;
}

export const NAMESPACED_ID = /^[a-z][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)+$/;
export function isNamespacedId(id: unknown): boolean { return typeof id === 'string' && NAMESPACED_ID.test(id); }

export function clampThreshold(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_THRESHOLD;
  const r = Math.round(n * 100) / 100;
  return Math.min(THRESHOLD_MAX, Math.max(THRESHOLD_MIN, r));
}

export interface TriggerCheck { ok: boolean; trigger?: Trigger; errors: string[] }

/** Validates a raw trigger: ids namespaced, a known kind (placeholders allowed), phrases present and parseable, threshold clamped. */
export function validateTrigger(raw: unknown): TriggerCheck {
  const errors: string[] = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, errors: ['trigger must be an object'] };
  const r = raw as Record<string, unknown>;
  if (!isNamespacedId(r.id)) errors.push('id must be namespaced (module.name)');
  const kind = typeof r.kind === 'string' ? r.kind : '';
  const spec = kinds.get(kind);
  if (!spec) errors.push(`unknown kind "${kind}"`);
  if (!TRIGGER_SOURCES.includes(r.source as TriggerSource)) errors.push('source must be permanent or custom');
  if (typeof r.module !== 'string' || !r.module) errors.push('module is required');
  if (typeof r.label !== 'string' || !r.label.trim()) errors.push('label is required');
  const phrases = Array.isArray(r.phrases) ? r.phrases.filter((p): p is string => typeof p === 'string' && p.trim().length > 0) : [];
  if (!phrases.length) errors.push('at least one phrase or signature is required');
  if (spec?.spoken) for (const p of phrases) { const e = patternErrors(p); if (e) errors.push(`phrase "${p}": ${e}`); }
  if (!isNamespacedId(r.action)) errors.push('action must be a namespaced action id');
  if (r.args !== undefined && (typeof r.args !== 'object' || r.args === null || Array.isArray(r.args))) errors.push('args must be an object');
  const arming = r.arming === undefined ? (spec?.spoken ? 'always' : 'required') : r.arming;
  if (!TRIGGER_ARMINGS.includes(arming as TriggerArming)) errors.push('arming must be required or always');
  const worksIn = r.worksIn === undefined ? [] : Array.isArray(r.worksIn) ? r.worksIn.filter((c): c is string => typeof c === 'string' && c.trim().length > 0).map((c) => c.trim()) : null;
  if (worksIn === null) errors.push('worksIn must be a list of context ids');
  if (errors.length) return { ok: false, errors };
  const trigger: Trigger = {
    id: r.id as string, kind, source: r.source as TriggerSource, module: r.module as string, label: (r.label as string).trim(), phrases,
    action: r.action as string, threshold: clampThreshold(typeof r.threshold === 'number' ? r.threshold : Number.NaN), worksIn: worksIn ?? [], arming: arming as TriggerArming,
    enabled: r.enabled !== false,
    cooldownMs: typeof r.cooldownMs === 'number' && r.cooldownMs >= 0 ? Math.floor(r.cooldownMs) : DEFAULT_COOLDOWN_MS,
    mutedUntil: typeof r.mutedUntil === 'number' && r.mutedUntil > 0 ? Math.floor(r.mutedUntil) : 0,
  };
  if (r.args && Object.keys(r.args as object).length) trigger.args = { ...(r.args as Record<string, unknown>) };
  return { ok: true, trigger, errors };
}

/* ---------- phrases: normalizing, patterns, argument capture ---------- */

/** Lowercase, punctuation to spaces, single spaces (= lib-voice `PhraseMatcher.normalize`). */
export function normalizePhrase(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, ' ').replace(/\s+/g, ' ').trim();
}

/** 1.0 = identical, 0.0 = nothing in common (Levenshtein over the longer length; = lib-voice `similarity`). */
export function phraseSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(cur[j - 1]! + 1, prev[j]! + 1, prev[j - 1]! + cost);
    }
    prev = cur;
  }
  return 1 - prev[b.length]! / Math.max(a.length, b.length);
}

export const SLOT_TYPES = ['text', 'number', 'time'] as const;
export type SlotType = (typeof SLOT_TYPES)[number];
export interface PatternPart { literal?: string; slot?: { name: string; type: SlotType } }

const SLOT = /^<([a-z][a-z0-9_-]*)(?::(text|number|time))?>$/i;

/** Splits a pattern into literal words and slots. Literals are normalized; a slot keeps its name as written. */
export function parsePattern(pattern: string): PatternPart[] {
  const parts: PatternPart[] = [];
  for (const tok of pattern.trim().split(/\s+/)) {
    if (!tok) continue;
    const m = SLOT.exec(tok);
    if (m) { parts.push({ slot: { name: m[1]!, type: (m[2] as SlotType | undefined) ?? 'text' } }); continue; }
    const lit = normalizePhrase(tok);
    if (!lit) continue;
    const last = parts[parts.length - 1];
    if (last?.literal !== undefined) last.literal += ' ' + lit; else parts.push({ literal: lit });
  }
  return parts;
}

/** Why a pattern can't be used, or '' when it is fine. */
export function patternErrors(pattern: string): string {
  const parts = parsePattern(pattern);
  if (!parts.length) return 'empty';
  if (parts.every((p) => p.slot)) return 'a pattern needs at least one word';
  for (let i = 1; i < parts.length; i++) if (parts[i]!.slot && parts[i - 1]!.slot) return 'two slots in a row';
  const names = parts.filter((p) => p.slot).map((p) => p.slot!.name.toLowerCase());
  if (new Set(names).size !== names.length) return 'duplicate slot name';
  const raw = pattern.trim().split(/\s+/).filter((t) => t.startsWith('<') && !SLOT.test(t));
  if (raw.length) return `bad slot "${raw[0]}"`;
  return '';
}

export function patternHasSlots(pattern: string): boolean { return parsePattern(pattern).some((p) => p.slot); }
/** Words in a pattern (a slot counts as one); the tie-breaker between phrases that score the same. */
export function patternWords(pattern: string): number { return parsePattern(pattern).reduce((n, p) => n + (p.slot ? 1 : p.literal!.split(' ').length), 0); }

export interface PhraseMatch {
  /** 1 exact · 0.95 found inside more words · < 0.95 similarity (slot-less patterns only) · 0 none */
  score: number;
  /** captured slot values, parsed by slot type (number/time → a number, or the raw text when it doesn't parse) */
  args: Record<string, unknown>;
}

function escapeRe(s: string): string { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/** Regex over normalized text: literals joined by single spaces, slots capture lazily (the last one greedily). */
function patternRegex(parts: PatternPart[]): RegExp {
  const lastSlot = parts.map((p) => !!p.slot).lastIndexOf(true);
  const src = parts.map((p, i) => (p.slot ? (i === lastSlot ? '(.+)' : '(.+?)') : escapeRe(p.literal!))).join(' ');
  return new RegExp(`^${src}$`);
}

function parseSlot(type: SlotType, text: string): unknown {
  if (type === 'number') { const n = parseSpokenNumber(text); return n === null ? text : n; }
  if (type === 'time') { const s = parseSpokenSeconds(text); return s === null ? text : s; }
  return text;
}

/** Scores what was heard against one pattern and captures its slots. Pure; the same on every port. */
export function matchPhrase(heard: string, pattern: string): PhraseMatch {
  const h = normalizePhrase(heard);
  const parts = parsePattern(pattern);
  if (!h || !parts.length || parts.every((p) => p.slot)) return { score: 0, args: {} };
  const slots = parts.filter((p) => p.slot).map((p) => p.slot!);
  const re = patternRegex(parts);
  const capture = (m: RegExpExecArray): Record<string, unknown> => Object.fromEntries(slots.map((s, i) => [s.name, parseSlot(s.type, m[i + 1]!.trim())]));
  const exact = re.exec(h);
  if (exact) return { score: 1, args: capture(exact) };
  if (!slots.length) {
    const p = parts[0]!.literal!;
    if (` ${h} `.includes(` ${p} `)) return { score: 0.95, args: {} };
    return { score: Math.round(phraseSimilarity(h, p) * 10000) / 10000, args: {} };
  }
  // with slots: the pattern may sit inside more words ("ok amber note buy milk please" → note <text>)
  const first = parts[0]!;
  if (first.literal) {
    const at = (' ' + h + ' ').indexOf(' ' + first.literal + ' ');
    if (at > 0) {
      const inside = re.exec(h.slice(at));
      if (inside) return { score: 0.95, args: capture(inside) };
    }
  }
  return { score: 0, args: {} };
}

/** Best pattern of a trigger for any recognizer alternative; ties go to the pattern with more words. */
export function bestPhrase(heard: string[], phrases: string[]): { phrase: string; heard: string; match: PhraseMatch } | null {
  let best: { phrase: string; heard: string; match: PhraseMatch } | null = null;
  for (const h of heard) for (const phrase of phrases) {
    const m = matchPhrase(h, phrase);
    if (m.score <= 0) continue;
    if (!best || m.score > best.match.score || (m.score === best.match.score && patternWords(phrase) > patternWords(best.phrase))) best = { phrase, heard: h, match: m };
  }
  return best;
}

/* ---------- spoken numbers and times ---------- */

const UNITS: Record<string, number> = { zero: 0, oh: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };

/** Numbers spoken in words or digits, in order: "one thirty eight" → [1, 38], "ninety" → [90], "2 15" → [2, 15]. Also reports minute/second markers. */
function spokenNumbers(phrase: string): { numbers: number[]; minutes: number | null; seconds: number | null } {
  const words = phrase.toLowerCase().replace(/-/g, ' ').split(/\s+/).filter((w) => w && w !== 'and');
  const numbers: number[] = [];
  let cur: number | null = null;
  let minutes: number | null = null;
  let seconds: number | null = null;
  const flush = () => { if (cur !== null) numbers.push(cur); cur = null; };
  for (const w of words) {
    if (/^\d+$/.test(w)) { flush(); cur = Number.parseInt(w, 10); }
    // a tens word starts a new number unless it follows a hundreds value; a unit attaches only to a tens value (twenty one, one hundred five)
    else if (w in TENS) { if (cur !== null && cur % 100 !== 0) flush(); cur = (cur ?? 0) + TENS[w]!; }
    else if (w in UNITS) { if (cur !== null && !(cur % 10 === 0 && cur >= 20)) flush(); cur = (cur ?? 0) + UNITS[w]!; }
    else if (w === 'hundred') cur = (cur ?? 1) * 100;
    else if (w.startsWith('minute')) { flush(); minutes = numbers.length ? numbers[numbers.length - 1]! : null; numbers.length = 0; }
    else if (w.startsWith('second')) { flush(); seconds = numbers.length ? numbers[numbers.length - 1]! : null; numbers.length = 0; }
  }
  flush();
  return { numbers, minutes, seconds };
}

/** The first number in a spoken phrase ("set it to forty five" → 45, "3 items" → 3), or null. */
export function parseSpokenNumber(phrase: string): number | null {
  const { numbers, minutes, seconds } = spokenNumbers(phrase);
  if (minutes !== null) return minutes;
  if (seconds !== null) return seconds;
  return numbers.length ? numbers[0]! : null;
}

/** Spoken time to seconds: "one minute thirty-eight seconds", "one thirty eight", "2:15", "ninety seconds" (= lib SpokenTime). */
export function parseSpokenSeconds(phrase: string): number | null {
  const p = phrase.toLowerCase().replace(/-/g, ' ').trim();
  const clock = /(\d+):(\d{1,2})/.exec(p);
  if (clock) return Number.parseInt(clock[1]!, 10) * 60 + Number.parseInt(clock[2]!, 10);
  const { numbers, minutes, seconds } = spokenNumbers(p);
  if (minutes !== null || seconds !== null) return (minutes ?? 0) * 60 + (seconds ?? numbers[0] ?? 0);
  if (!numbers.length) return null;
  if (numbers.length === 1) return numbers[0]!;
  return numbers[0]! * 60 + numbers[1]!;
}

/* ---------- the matcher (pure decisions) ---------- */

export const TRIGGER_OUTCOMES = ['fired', 'no-match', 'disabled', 'muted', 'kind-off', 'below-threshold', 'wrong-context', 'not-armed', 'cooldown'] as const;
export type TriggerOutcome = (typeof TRIGGER_OUTCOMES)[number];

/** One input from a detector. Spoken kinds give `heard` (recognizer alternatives, best first); others give a `signature` id. */
export interface Observation {
  kind: string;
  heard?: string[];
  signature?: string;
  /** detector confidence in percent (default 100) */
  confidence?: number;
  at: number;
}

/** What the host knows when an observation arrives. */
export interface MatchEnv {
  /** the app's current context id (`notes.list`, `todo`, …) */
  context: string;
  /** kinds armed right now (an arming pose was seen within the arming window) */
  armed?: string[];
  /** kinds the user switched off */
  kindsOff?: string[];
  /** trigger id → when it last fired */
  lastFired?: Record<string, number>;
}

export interface TriggerDecision {
  triggerId: string;
  outcome: TriggerOutcome;
  /** confidence in percent after phrase scoring (voice: score × detector confidence) */
  confidence: number;
  phrase?: string;
  /** the recognizer alternative that matched (spoken kinds) */
  heard?: string;
  args?: Record<string, unknown>;
}

/** What the host runs when a trigger fires. */
export interface TriggerCommand { triggerId: string; action: string; args: Record<string, unknown>; phrase?: string; heard?: string }

export interface MatchResult { decisions: TriggerDecision[]; fired: TriggerCommand | null; lastFired: Record<string, number> }

export function worksInContext(t: Trigger, context: string): boolean {
  return !t.worksIn.length || t.worksIn.includes(ANY_CONTEXT) || t.worksIn.includes(context);
}

function round2(n: number): number { return Math.round(n * 100) / 100; }

/**
 * Decides one trigger against one observation. Order (= the reference engine's): enabled, not muted, kind on,
 * input matches (phrase/signature), confidence ≥ threshold, context, armed, cooldown.
 */
export function decide(t: Trigger, obs: Observation, env: MatchEnv): TriggerDecision {
  const base: TriggerDecision = { triggerId: t.id, outcome: 'no-match', confidence: 0 };
  if (t.kind !== obs.kind) return base;
  const spec = kinds.get(t.kind);
  let confidence = Math.min(100, Math.max(0, obs.confidence ?? 100));
  let phrase: string | undefined;
  let heard: string | undefined;
  let args: Record<string, unknown> | undefined;
  if (spec?.spoken) {
    const best = bestPhrase(obs.heard ?? [], t.phrases);
    if (!best) return base;
    phrase = best.phrase; heard = best.heard; args = best.match.args; confidence = round2(confidence * best.match.score);
  } else {
    if (!obs.signature || !t.phrases.includes(obs.signature)) return base;
    phrase = obs.signature;
  }
  const d: TriggerDecision = { triggerId: t.id, outcome: 'fired', confidence, phrase, ...(heard !== undefined ? { heard } : {}), args: { ...(t.args ?? {}), ...(args ?? {}) } };
  const fail = (outcome: TriggerOutcome): TriggerDecision => ({ ...d, outcome });
  if (t.enabled === false) return fail('disabled');
  if ((t.mutedUntil ?? 0) > obs.at) return fail('muted');
  if (env.kindsOff?.includes(t.kind)) return fail('kind-off');
  if (confidence < t.threshold) return fail('below-threshold');
  if (!worksInContext(t, env.context)) return fail('wrong-context');
  if (t.arming === 'required' && !(env.armed ?? []).includes(t.kind)) return fail('not-armed');
  const last = env.lastFired?.[t.id];
  if (last !== undefined && obs.at - last < (t.cooldownMs ?? DEFAULT_COOLDOWN_MS)) return fail('cooldown');
  return d;
}

/**
 * Runs every trigger against an observation. Exactly one command fires per observation: the fired decision with
 * the highest confidence (ties → the longer phrase, then registration order). Returns the updated `lastFired`.
 */
export function matchTriggers(triggers: Trigger[], obs: Observation, env: MatchEnv): MatchResult {
  const decisions = triggers.map((t) => decide(t, obs, env));
  let pick: { t: Trigger; d: TriggerDecision } | null = null;
  decisions.forEach((d, i) => {
    if (d.outcome !== 'fired') return;
    const t = triggers[i]!;
    if (!pick || d.confidence > pick.d.confidence || (d.confidence === pick.d.confidence && patternWords(d.phrase ?? '') > patternWords(pick.d.phrase ?? ''))) pick = { t, d };
  });
  const lastFired = { ...(env.lastFired ?? {}) };
  if (!pick) return { decisions, fired: null, lastFired };
  const { t, d } = pick as { t: Trigger; d: TriggerDecision };
  lastFired[t.id] = obs.at;
  return { decisions, fired: { triggerId: t.id, action: t.action, args: d.args ?? {}, ...(d.phrase ? { phrase: d.phrase } : {}), ...(d.heard !== undefined ? { heard: d.heard } : {}) }, lastFired };
}

/* ---------- registry (modules register, conflicts become diagnostics) ---------- */

export type TriggerDiagnostic = { kind: 'contribution-conflict'; what: 'trigger' | 'trigger-phrase'; id: string; was: string; now: string };

export interface TriggerFilter { kind?: string; module?: string; context?: string; source?: TriggerSource }

export class TriggerRegistry {
  private items = new Map<string, Trigger>();
  private listeners = new Set<() => void>();
  constructor(private readonly report: (d: TriggerDiagnostic) => void = () => {}) {}

  /**
   * Registers a module's triggers. An id already owned by another module is a conflict (the new one replaces it,
   * like assets); a slot-less phrase already answered by another enabled trigger in an overlapping context is a
   * phrase conflict (both stay; the matcher picks by confidence). Returns the diagnostics raised.
   */
  register(module: string, triggers: Trigger[]): TriggerDiagnostic[] {
    const out: TriggerDiagnostic[] = [];
    for (const t of triggers) {
      const was = this.items.get(t.id);
      if (was && was.module !== module) out.push({ kind: 'contribution-conflict', what: 'trigger', id: t.id, was: was.module, now: module });
      const next = { ...t, module };
      for (const other of this.items.values()) {
        if (other.id === t.id || other.kind !== t.kind || other.enabled === false || t.enabled === false) continue;
        if (!contextsOverlap(other.worksIn, t.worksIn)) continue;
        for (const p of t.phrases) {
          if (patternHasSlots(p)) continue;
          const n = normalizePhrase(p);
          if (other.phrases.some((q) => !patternHasSlots(q) && normalizePhrase(q) === n)) out.push({ kind: 'contribution-conflict', what: 'trigger-phrase', id: n, was: other.id, now: t.id });
        }
      }
      this.items.set(t.id, next);
    }
    for (const d of out) this.report(d);
    if (triggers.length) this.notify();
    return out;
  }

  /** Removes every trigger a module registered. */
  unregister(module: string): number {
    let n = 0;
    for (const [id, t] of [...this.items]) if (t.module === module) { this.items.delete(id); n++; }
    if (n) this.notify();
    return n;
  }

  /** Removes one trigger; a permanent one can't be removed (false). */
  remove(id: string): boolean {
    const t = this.items.get(id);
    if (!t || t.source === 'permanent') return false;
    this.items.delete(id);
    this.notify();
    return true;
  }

  /** Replaces a trigger's editable fields (phrases, threshold, worksIn, arming, enabled, cooldown, mute); id/kind/module/source/action stay. */
  update(id: string, patch: Partial<Pick<Trigger, 'label' | 'phrases' | 'threshold' | 'worksIn' | 'arming' | 'enabled' | 'cooldownMs' | 'mutedUntil' | 'args'>>): Trigger | null {
    const t = this.items.get(id);
    if (!t) return null;
    const check = validateTrigger({ ...t, ...patch, id: t.id, kind: t.kind, module: t.module, source: t.source, action: t.action });
    if (!check.ok) return null;
    this.items.set(id, check.trigger!);
    this.notify();
    return check.trigger!;
  }

  get(id: string): Trigger | undefined { return this.items.get(id); }
  list(filter: TriggerFilter = {}): Trigger[] {
    return [...this.items.values()].filter((t) => (!filter.kind || t.kind === filter.kind) && (!filter.module || t.module === filter.module)
      && (!filter.source || t.source === filter.source) && (filter.context === undefined || worksInContext(t, filter.context)));
  }
  /** Which trigger answers to this exact (slot-less) phrase for a kind, if any. */
  owner(kind: string, phrase: string): Trigger | undefined {
    const n = normalizePhrase(phrase);
    return [...this.items.values()].find((t) => t.kind === kind && t.phrases.some((p) => !patternHasSlots(p) && normalizePhrase(p) === n));
  }
  subscribe(fn: () => void): () => void { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  private notify() { for (const fn of this.listeners) fn(); }
}

export function contextsOverlap(a: string[], b: string[]): boolean {
  const anyA = !a.length || a.includes(ANY_CONTEXT);
  const anyB = !b.length || b.includes(ANY_CONTEXT);
  return anyA || anyB || a.some((c) => b.includes(c));
}

/* ---------- lib-voice commands as triggers ---------- */

/** lib-voice's `VoiceCommand` shape (Android `ai.amberx.axf.voice.VoiceCommand`). */
export interface VoiceCommandLike { id: string; label: string; defaults: string[]; module?: string; group?: string }
/** lib-voice matches at 0.8 → 80 %. */
export const VOICE_COMMAND_THRESHOLD = 80;

/** A lib-voice command hosted as a permanent voice trigger: its phrases, its id as the action, no arming, every context. */
export function voiceCommandTrigger(cmd: VoiceCommandLike, phrases: string[] = cmd.defaults): Trigger {
  const module = cmd.module || 'app';
  const raw: string = cmd.id;
  const namespaced = isNamespacedId(raw);
  const id = namespaced ? raw : `${module.split('.').pop() || 'app'}.${raw.replace(/[^a-z0-9-]+/gi, '-').toLowerCase()}`;
  return { id, kind: 'voice', source: 'permanent', module, label: cmd.label, phrases: phrases.length ? phrases : cmd.defaults, action: namespaced ? raw : `voice.${id}`, threshold: VOICE_COMMAND_THRESHOLD, worksIn: [], arming: 'always', enabled: true, cooldownMs: DEFAULT_COOLDOWN_MS, mutedUntil: 0 };
}

/* ---------- settings voice binding ---------- */

/** Actions a settings binding fires. The settings host applies them to the registry. */
export const SETTINGS_SET_ACTION = 'axf.settings.set';
export const SETTINGS_TOGGLE_ACTION = 'axf.settings.toggle';

/** One phrase and what it does to the setting: a fixed value, a toggle, or the value captured in the `<value>` slot. */
export interface SettingPhrase { pattern: string; value?: unknown; toggle?: boolean }

/** A setting exposes phrases → a setting change. Declared by the module that owns the setting (`SettingSpec.key`). */
export interface SettingVoiceBinding {
  /** setting key (`axf.voice.sensitivity`) */
  key: string;
  module: string;
  label: string;
  phrases: SettingPhrase[];
  threshold?: number;
  worksIn?: string[];
}

export interface SettingChange { key: string; value?: unknown; toggle?: boolean }

/** The triggers a binding becomes: one per phrase, ids `<key>.<n>` under the setting key, permanent. */
export function bindingTriggers(b: SettingVoiceBinding): Trigger[] {
  const base = b.key.replace(/[^a-z0-9.-]+/gi, '-').toLowerCase();
  return b.phrases.map((p, i) => ({
    id: `${base}.${i + 1}`, kind: 'voice', source: 'permanent', module: b.module, label: b.label, phrases: [p.pattern],
    action: p.toggle ? SETTINGS_TOGGLE_ACTION : SETTINGS_SET_ACTION,
    args: p.toggle ? { key: b.key } : p.value !== undefined ? { key: b.key, value: p.value } : { key: b.key },
    threshold: clampThreshold(b.threshold ?? DEFAULT_THRESHOLD), worksIn: b.worksIn ?? [], arming: 'always', enabled: true, cooldownMs: DEFAULT_COOLDOWN_MS, mutedUntil: 0,
  }));
}

/** The setting change a fired binding command means (a captured `value` slot wins over a fixed value). */
export function settingChangeFor(cmd: TriggerCommand): SettingChange | null {
  if (cmd.action !== SETTINGS_SET_ACTION && cmd.action !== SETTINGS_TOGGLE_ACTION) return null;
  const key = typeof cmd.args.key === 'string' ? cmd.args.key : '';
  if (!key) return null;
  if (cmd.action === SETTINGS_TOGGLE_ACTION) return { key, toggle: true };
  return { key, value: cmd.args.value };
}

/* ---------- detector placeholder ---------- */

export class TriggersNotImplemented extends Error {
  constructor(readonly capability: string) { super(`"${capability}" is declared but not built yet.`); this.name = 'NotImplemented'; }
}

/** What a detector module provides for a kind (a recognizer, a camera pipeline). Observations go to the host's matcher. */
export interface TriggerDetector {
  readonly kind: string;
  available(): Promise<boolean>;
  start(onObservation: (o: Observation) => void): Promise<() => void>;
}

/** Kernel default for `gesture` and `face` until a detector module registers. Never pretends to work. */
export class PlaceholderDetector implements TriggerDetector {
  constructor(readonly kind: string, readonly capability: string) {}
  async available() { return false; }
  start(): Promise<() => void> { return Promise.reject(new TriggersNotImplemented(this.capability)); }
}
