/**
 * library@1 install parameters — the one contract every wizard that asks for a library's parameters uses
 * (web `LibraryParamField`, Compose `AxfLibraryParamField`, the CLI wizard in `cli/libraries.mjs`).
 *
 * A parameter is answered as **text** (what a person types or picks); `paramToJson` turns the text into the typed
 * value the installer expects and `paramError` says why a text is not acceptable. Same rules on every port:
 * Kotlin `ai.amberx.axf.kernel.library.LibraryParams`, fixture `spec/fixtures/library-params.json`.
 */

export const LIBRARY_PARAM_TYPES = ['text', 'list', 'bool', 'number', 'choice'] as const;
export type LibraryParamType = (typeof LIBRARY_PARAM_TYPES)[number];

/** One entry of a library.json `params[]`. */
export interface LibraryParam {
  key: string;
  label: string;
  type: LibraryParamType;
  required?: boolean;
  default?: unknown;
  help?: string;
  choices?: string[];
  min?: number;
  max?: number;
}

/** Words that mean "yes" for a bool parameter (case-insensitive); everything else is false. */
export const PARAM_TRUE_WORDS = ['true', 'yes', 'y', 'on', '1'] as const;
const TRUE_RE = new RegExp(`^(${PARAM_TRUE_WORDS.join('|')})$`, 'i');

/** A stored/default value as the text a form shows (lists join with commas). */
export function paramText(value: unknown): string {
  if (value == null) return '';
  if (Array.isArray(value)) return value.map((v) => (typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v))).join(',');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/** Numbers as people write them: 6, 0.5 (never 6.0). */
const fmtNum = (n: number): string => String(n);
/** Plain decimal numbers only (no hex, no Infinity), the same on every port (harvested with the typed catalog models, Oct 2026). */
const DECIMAL = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
/** A plain decimal as a finite number, else undefined. */
export function parseDecimal(t: string): number | undefined {
  if (!DECIMAL.test(t)) return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

/** The parameter's default as form text ('' when it has none). */
export const paramDefaultText = (p: Pick<LibraryParam, 'default'>): string => paramText(p.default);

/** Is this text (or, when blank, the default) a "yes" for a bool parameter? */
export function paramBool(p: Pick<LibraryParam, 'default'>, text: string): boolean {
  const t = text.trim() || paramDefaultText(p);
  return TRUE_RE.test(t.trim());
}

/** Form text → the typed JSON value the installer takes; `undefined` for blank text (the installer then uses the default) or a number that isn't a plain finite decimal. */
export function paramToJson(p: Pick<LibraryParam, 'type'>, text: string): unknown {
  const t = text.trim();
  if (!t) return undefined;
  switch (p.type) {
    case 'bool': return TRUE_RE.test(t);
    case 'number': return parseDecimal(t);
    case 'list': return t.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
    default: return t;
  }
}

/** Why this text is not acceptable for the parameter, or null when it is. Blank text is fine unless the parameter is required with no default. */
export function paramError(p: LibraryParam, text: string): string | null {
  const t = text.trim();
  if (!t) return p.required && p.default == null ? 'Required' : null;
  if (p.type === 'number') {
    const n = parseDecimal(t);
    if (n === undefined) return 'Must be a number';
    if (p.min != null && n < p.min) return `Must be ≥ ${fmtNum(p.min)}`;
    if (p.max != null && n > p.max) return `Must be ≤ ${fmtNum(p.max)}`;
  }
  if (p.type === 'choice' && p.choices?.length && !p.choices.includes(t)) return `One of ${p.choices.join(', ')}`;
  return null;
}

/** Every parameter's starting answer (its default as text), keyed by `key`. */
export function paramDefaults(params: readonly LibraryParam[]): Record<string, string> {
  return Object.fromEntries(params.map((p) => [p.key, paramDefaultText(p)]));
}

/* ---------- library@1 parts: features inside a library, each configurable (Oct 22 2026) ----------
 * A library may offer `parts`: features an app includes or leaves out when it installs the library, each with its own
 * parameters (Build Pilot lists them as features under the library and lets a person configure each one). The
 * installed config keeps the library's own params at the top level and `parts: { <part id>: { ...its params } }` for
 * every included part; a part that isn't there is left out. Kotlin twin deferred (Android on hold, PORTING.md). */

export interface LibraryPart {
  id: string;
  label: string;
  description?: string;
  /** included when nobody chose (default true) */
  default?: boolean;
  /** other part ids this one needs (included with it) */
  requires?: string[];
  params?: LibraryParam[];
}
export type PartAnswers = Record<string, boolean | Record<string, unknown>>;

/** The parts included by default (and what they require). */
export function partDefaults(parts: readonly LibraryPart[]): string[] {
  return withRequired(parts, parts.filter((p) => p.default !== false).map((p) => p.id));
}

/** A set of chosen part ids plus everything they require, in the library's order. Unknown ids are dropped. */
export function withRequired(parts: readonly LibraryPart[], chosen: readonly string[]): string[] {
  const on = new Set<string>();
  const add = (id: string) => { const p = parts.find((x) => x.id === id); if (!p || on.has(id)) return; on.add(id); for (const r of p.requires ?? []) add(r); };
  chosen.forEach(add);
  return parts.filter((p) => on.has(p.id)).map((p) => p.id);
}

/** Which parts the answers include: `answers` undefined → the defaults; else a part is in when its answer is true or an object. */
export function includedParts(parts: readonly LibraryPart[], answers?: PartAnswers | null): string[] {
  if (!answers) return partDefaults(parts);
  return withRequired(parts, Object.entries(answers).filter(([, v]) => v === true || (typeof v === 'object' && v !== null)).map(([k]) => k));
}

/** Parts that need this one (so it can't be left out while they're in). */
export function partNeededBy(parts: readonly LibraryPart[], included: readonly string[], id: string): string[] {
  return parts.filter((p) => included.includes(p.id) && p.id !== id && (p.requires ?? []).includes(id)).map((p) => p.id);
}

/** Every problem with the answers (unknown part, bad parameter), as readable lines; [] when fine. Values may be text or typed. */
export function partErrors(parts: readonly LibraryPart[], answers?: PartAnswers | null): string[] {
  const out: string[] = [];
  for (const [id, v] of Object.entries(answers ?? {})) {
    const p = parts.find((x) => x.id === id);
    if (!p) { out.push(`Unknown part "${id}"`); continue; }
    if (typeof v !== 'object' || v === null) continue;
    for (const q of p.params ?? []) {
      const raw = (v as Record<string, unknown>)[q.key];
      const e = paramError(q, raw === undefined || raw === null ? '' : paramText(raw));
      if (e) out.push(`${p.label} › ${q.label}: ${e}`);
    }
  }
  return out;
}

/** The installed config's part map: every included part with its params (blank → default). */
export function resolvePartConfig(parts: readonly LibraryPart[], answers?: PartAnswers | null): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  for (const id of includedParts(parts, answers)) {
    const p = parts.find((x) => x.id === id)!;
    const given = answers && typeof answers[id] === 'object' ? (answers[id] as Record<string, unknown>) : {};
    const cfg: Record<string, unknown> = {};
    for (const q of p.params ?? []) {
      const raw = given[q.key];
      const v = raw === undefined || raw === null || raw === '' ? undefined : typeof raw === 'string' ? paramToJson(q, raw) : raw;
      cfg[q.key] = v === undefined ? q.default ?? null : v;
    }
    out[id] = cfg;
  }
  return out;
}

/** Read an installed library config at run time: is a part on, and its params (defaults filled). No `parts` key = defaults. */
export function partOn(config: { parts?: Record<string, unknown> } | null | undefined, id: string, parts?: readonly LibraryPart[]): boolean {
  if (!config?.parts) return parts ? partDefaults(parts).includes(id) : true;
  return Object.hasOwn(config.parts, id);
}
export function partParams<T extends Record<string, unknown> = Record<string, unknown>>(config: { parts?: Record<string, unknown> } | null | undefined, id: string, part?: LibraryPart): T {
  const given = (config?.parts?.[id] ?? {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const q of part?.params ?? []) out[q.key] = given[q.key] ?? q.default ?? null;
  return { ...out, ...given } as T;
}
