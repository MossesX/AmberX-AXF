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
  if (Array.isArray(value)) return value.map((v) => String(v)).join(',');
  return String(value);
}

/** The parameter's default as form text ('' when it has none). */
export const paramDefaultText = (p: Pick<LibraryParam, 'default'>): string => paramText(p.default);

/** Is this text (or, when blank, the default) a "yes" for a bool parameter? */
export function paramBool(p: Pick<LibraryParam, 'default'>, text: string): boolean {
  const t = text.trim() || paramDefaultText(p);
  return TRUE_RE.test(t.trim());
}

/** Form text → the typed JSON value the installer takes; `undefined` for blank text (the installer then uses the default). */
export function paramToJson(p: Pick<LibraryParam, 'type'>, text: string): unknown {
  const t = text.trim();
  if (!t) return undefined;
  switch (p.type) {
    case 'bool': return TRUE_RE.test(t);
    case 'number': return Number(t);
    case 'list': return t.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
    default: return t;
  }
}

/** Why this text is not acceptable for the parameter, or null when it is. Blank text is fine unless the parameter is required with no default. */
export function paramError(p: LibraryParam, text: string): string | null {
  const t = text.trim();
  if (!t) return p.required && p.default == null ? 'Required' : null;
  if (p.type === 'number') {
    const n = Number(t);
    if (Number.isNaN(n)) return 'Must be a number';
    if (p.min != null && n < p.min) return `Must be ≥ ${p.min}`;
    if (p.max != null && n > p.max) return `Must be ≤ ${p.max}`;
  }
  if (p.type === 'choice' && p.choices?.length && !p.choices.includes(t)) return `One of ${p.choices.join(', ')}`;
  return null;
}

/** Every parameter's starting answer (its default as text), keyed by `key`. */
export function paramDefaults(params: readonly LibraryParam[]): Record<string, string> {
  return Object.fromEntries(params.map((p) => [p.key, paramDefaultText(p)]));
}
