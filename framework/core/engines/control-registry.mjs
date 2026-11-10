/**
 * control-registry@1 — one index of everything controllable, and the deterministic dispatcher over it (build
 * full-api-cli-control-of-everything-plus-an-offli, Brett Nov 10 2026: "extensive API and CLI control over every single
 * page, app, plugin, tool, behavior, display, and setting with every single option or possibility for a parameter … a
 * powerful complete index and registry for offline management and internal logic. Anything that can possibly be done
 * without AI needs to be, with AI only as a fallback").
 *
 * Pure (no IO, no DOM, no model): the reference engine. Contract: contracts/control-registry@1.schema.json, doc
 * docs/contracts/control-registry.md. The collectors that read the repo, the store and the AI gate's setting read live in
 * apps/console-web/lib/registry/. Kotlin twin deferred (spec/PORTING.md).
 *
 *   entry    { id, type, owner, label, description?, where, open?, state?, actions[], needsAI?, surfaces, aliases?, synonyms?, keywords?, tags?, requires?, parent?, source, gaps?, hash }
 *   index    { $axf: 'control-registry@1', version, generatedAt, source?, hash, counts, owners[], gaps[], entries[] }
 *   resolve  → { ok: true, entry, action, params, how } | { ok: false, code: ambiguous | validation | not_found | needs_ai, … }
 */
import { foldWords } from './console-commands.mjs';

export const REGISTRY_FRAME = 'control-registry@1';
export const VOICE_FRAME = 'voice-intents@1';
export const REGISTRY_VERSION = 1;
export const ENTRY_TYPES = ['page', 'app', 'plugin', 'tool', 'behavior', 'display', 'setting'];
export const EFFECTS = ['read', 'navigate', 'write', 'destructive', 'person'];
export const PARAM_TYPES = ['string', 'number', 'integer', 'boolean', 'enum', 'color', 'token', 'id', 'date', 'time', 'duration', 'url', 'path', 'json', 'object', 'array', 'text', 'secret'];
export const SURFACES = ['rest', 'mcp', 'cli', 'voice', 'deepLink'];
export const SOURCE_KINDS = ['plugin-manifest', 'ui-api', 'control', 'voice', 'declared', 'runtime', 'provider'];
export const OPEN_KINDS = ['screen', 'dialog', 'settings', 'action', 'app', 'intent', 'url', 'none'];
export const RESOLVE_CODES = { AMBIGUOUS: 'ambiguous', VALIDATION: 'validation', NOT_FOUND: 'not_found', NEEDS_AI: 'needs_ai' };
export const LIST_DEFAULT = 50;
export const LIST_MAX = 2000;
/** The generic ways in every entry gets once the Opus steps land (s4 REST, s5 MCP, s6 CLI). */
export const GENERIC_SURFACES = Object.freeze({ rest: 'POST /api/control/<id>/<action>', state: 'GET /api/control/<id>/state', mcp: 'control_invoke', mcpState: 'control_state', cli: 'axf ctl do <id> <action>', cliState: 'axf ctl state <id>' });

/** <owner>/<type>/<name>[/<sub>[/<sub>]]: owner and type lower case; the name keeps the thing's own case (a setting key). */
export const ID = /^[a-z0-9][a-z0-9-]*\/(page|app|plugin|tool|behavior|display|setting)\/[A-Za-z0-9][A-Za-z0-9._:@-]*(\/[A-Za-z0-9][A-Za-z0-9._:@-]*){0,2}$/;
export const ACTION_ID = /^[a-z0-9][a-z0-9._:-]{0,63}$/;
export const REF = /^(none|[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9-]*|(view|dialog|settings|action|value|control|rest|mcp|cli|intent|url|provider|channel|element):.+)$/;
export const HASH = /^[a-f0-9]{16}$/;

const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v, max = 400) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
/** foldWords for what a person said: decimal points inside numbers survive ("1.2" stays "1.2", "v1.2.3" too). */
export const foldPhrase = (s) => String(s ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/['’]/g, '').replace(/[^a-z0-9.#]+/g, ' ').replace(/(?<!\d)\.|\.(?!\d)/g, ' ').replace(/#(?![0-9a-f]{3,8}\b)/g, ' ').replace(/\s+/g, ' ').trim();
/** An id as compared: owner and type lower case, the name as written. */
const normId = (v) => { const m = /^([^/]+)\/([^/]+)\/(.*)$/.exec(str(v, 200)); return m ? `${m[1].toLowerCase()}/${m[2].toLowerCase()}/${m[3]}` : str(v, 200).toLowerCase(); };
const strList = (v, max = 120, cap = 60) => (Array.isArray(v) ? [...new Set(v.map((x) => str(x, max)).filter(Boolean))].slice(0, cap) : []);
const uniq = (a) => [...new Set(a)];

/* ================================================================== hashing */

/** FNV-1a 64-bit of a string as 16 hex characters (BigInt; the same in any port). */
export function fnv1a64(s) {
  let h = 0xcbf29ce484222325n;
  const P = 0x100000001b3n;
  const M = 0xffffffffffffffffn;
  const bytes = new TextEncoder().encode(String(s));
  for (const b of bytes) { h ^= BigInt(b); h = (h * P) & M; }
  return h.toString(16).padStart(16, '0');
}

/** JSON with keys sorted at every level: the same facts hash the same. */
export function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (isObj(v)) return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
  return JSON.stringify(v === undefined ? null : v);
}

/** The entry's hash: everything but `hash` and `source.file` (a moved file is not a changed thing). */
export function entryHash(entry) {
  const { hash: _h, source, ...rest } = entry;
  const src = isObj(source) ? { kind: source.kind, ...(source.frame ? { frame: source.frame } : {}) } : {};
  return fnv1a64(canonical({ ...rest, source: src }));
}

/** The index hash: every entry's hash in id order. */
export const indexHash = (entries) => fnv1a64([...entries].sort((a, b) => a.id.localeCompare(b.id)).map((e) => `${e.id}=${e.hash}`).join('\n'));

/* ================================================================== a JSON Schema subset validator (no dependency) */

/**
 * Validate `value` against a JSON Schema (draft 2020-12 subset: type, const, enum, required, properties,
 * additionalProperties, items, minItems/maxItems, minLength/maxLength, pattern, minimum/maximum/exclusiveMinimum,
 * local $ref, anyOf). → [] or ["<path>: <what is wrong>", …]. `root` resolves `#/…` refs (default: the schema itself).
 */
export function validateSchema(schema, value, root = schema, path = '$', depth = 0) {
  const errors = [];
  if (!isObj(schema) || depth > 40) return errors;
  if (typeof schema.$ref === 'string') {
    const target = resolveRef(root, schema.$ref);
    if (!target) return [`${path}: unresolvable $ref ${schema.$ref}`];
    return validateSchema(target, value, root, path, depth + 1);
  }
  if (Array.isArray(schema.anyOf)) {
    const alts = schema.anyOf.map((s) => validateSchema(s, value, root, path, depth + 1));
    if (!alts.some((e) => !e.length)) errors.push(`${path}: matches none of the allowed shapes (${alts.map((e) => e[0]).filter(Boolean).slice(0, 3).join(' | ')})`);
  }
  if (schema.const !== undefined && canonical(value) !== canonical(schema.const)) errors.push(`${path}: must be ${JSON.stringify(schema.const)}`);
  if (Array.isArray(schema.enum) && !schema.enum.some((x) => canonical(x) === canonical(value))) errors.push(`${path}: must be one of ${schema.enum.map((x) => JSON.stringify(x)).join(', ')}`);
  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    const actual = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value === 'number' ? (Number.isInteger(value) ? 'integer' : 'number') : typeof value;
    const okType = types.some((t) => t === actual || (t === 'number' && actual === 'integer'));
    if (!okType) { errors.push(`${path}: must be ${types.join(' or ')} (got ${actual})`); return errors; }
  }
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) errors.push(`${path}: at least ${schema.minLength} characters`);
    if (schema.maxLength !== undefined && value.length > schema.maxLength) errors.push(`${path}: at most ${schema.maxLength} characters`);
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) errors.push(`${path}: "${value.slice(0, 60)}" does not match ${schema.pattern}`);
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${path}: at least ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${path}: at most ${schema.maximum}`);
    if (schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum) errors.push(`${path}: more than ${schema.exclusiveMinimum}`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) errors.push(`${path}: at least ${schema.minItems} items`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) errors.push(`${path}: at most ${schema.maxItems} items`);
    if (isObj(schema.items)) value.forEach((x, i) => errors.push(...validateSchema(schema.items, x, root, `${path}[${i}]`, depth + 1)));
  }
  if (isObj(value)) {
    for (const k of Array.isArray(schema.required) ? schema.required : []) if (value[k] === undefined) errors.push(`${path}.${k}: required`);
    const props = isObj(schema.properties) ? schema.properties : {};
    for (const [k, v] of Object.entries(value)) {
      if (props[k]) errors.push(...validateSchema(props[k], v, root, `${path}.${k}`, depth + 1));
      else if (schema.additionalProperties === false) errors.push(`${path}.${k}: not a known field`);
      else if (isObj(schema.additionalProperties)) errors.push(...validateSchema(schema.additionalProperties, v, root, `${path}.${k}`, depth + 1));
    }
  }
  return errors;
}

function resolveRef(root, ref) {
  if (!ref.startsWith('#/')) return null;
  let cur = root;
  for (const part of ref.slice(2).split('/')) { cur = isObj(cur) ? cur[part.replace(/~1/g, '/').replace(/~0/g, '~')] : undefined; if (cur === undefined) return null; }
  return cur;
}

/** Errors of one entry against the contract (the entry definition). */
export const validateEntry = (schema, entry) => validateSchema({ $ref: '#/$defs/entry' }, entry, schema, 'entry');
/** Errors of a whole index against the contract, plus the hash checks the schema can't express. */
export function validateIndex(schema, index) {
  const errors = validateSchema(schema, index, schema, 'index');
  if (!isObj(index) || !Array.isArray(index.entries)) return errors;
  const seen = new Set();
  const owners = new Set((index.owners ?? []).map((o) => o.id));
  for (const e of index.entries) {
    if (!isObj(e) || !e.id) continue;
    if (seen.has(e.id)) errors.push(`index.entries: two entries are called ${e.id}`); seen.add(e.id);
    if (HASH.test(e.hash ?? '') && entryHash(e) !== e.hash) errors.push(`index.entries ${e.id}: hash does not match its fields`);
    if (owners.size && !owners.has(e.owner)) errors.push(`index.entries ${e.id}: owner ${e.owner} is not in owners`);
    const acts = new Set();
    for (const a of e.actions ?? []) { if (acts.has(a.id)) errors.push(`index.entries ${e.id}: two actions are called ${a.id}`); acts.add(a.id); }
  }
  if (HASH.test(index.hash ?? '') && indexHash(index.entries) !== index.hash) errors.push('index.hash does not match its entries');
  return errors;
}

/* ================================================================== parameters */

/** control@1 field declarations ('string', 'enum:a,b', 'string[]', 'object[]', 'string|null', 'boolean', 'number') → a param. */
export function paramFromDecl(name, decl, extra = {}) {
  const d = String(decl ?? 'string');
  if (d.startsWith('enum:')) { const vals = d.slice(5).split(',').map((x) => (/^-?\d+(\.\d+)?$/.test(x) ? Number(x) : x)); return cleanParam({ name, type: 'enum', enum: vals, ...extra }); }
  if (d.endsWith('[]')) return cleanParam({ name, type: 'array', items: d.slice(0, -2) === 'object' ? 'object' : 'string', ...extra });
  const base = d.replace('|null', '');
  return cleanParam({ name, type: PARAM_TYPES.includes(base) ? base : 'string', ...extra });
}

/** A JSON Schema (plugin-commands@1 input) → params, one per property; required and defaults kept, enums become type enum. */
export function paramsFromSchema(schema) {
  if (!isObj(schema) || !isObj(schema.properties)) return [];
  const req = new Set(Array.isArray(schema.required) ? schema.required : []);
  return Object.entries(schema.properties).map(([name, p]) => {
    const s = isObj(p) ? p : {};
    const t = Array.isArray(s.type) ? s.type.find((x) => x !== 'null') : s.type;
    const type = Array.isArray(s.enum) ? 'enum' : t === 'integer' ? 'integer' : t === 'number' ? 'number' : t === 'boolean' ? 'boolean' : t === 'object' ? 'object' : t === 'array' ? 'array' : 'string';
    return cleanParam({ name, type, required: req.has(name), ...(s.description ? { description: s.description } : {}), ...(s.default !== undefined ? { default: s.default } : {}),
      ...(Array.isArray(s.enum) ? { enum: s.enum } : {}), ...(s.minimum !== undefined ? { min: s.minimum } : {}), ...(s.maximum !== undefined ? { max: s.maximum } : {}),
      ...(s.pattern ? { pattern: s.pattern } : {}), ...(s.maxLength !== undefined ? { maxLength: s.maxLength } : {}), ...(type === 'array' && isObj(s.items) && s.items.type ? { items: s.items.type === 'integer' ? 'integer' : PARAM_TYPES.includes(s.items.type) ? s.items.type : 'string' } : {}) });
  });
}

/** A param with only the fields the contract knows, cleaned. */
export function cleanParam(raw) {
  const p = isObj(raw) ? raw : {};
  const out = { name: str(p.name, 64), type: PARAM_TYPES.includes(p.type) ? p.type : 'string' };
  if (!out.name) return null;
  for (const k of ['label', 'description', 'pattern', 'of']) if (str(p[k], 800)) out[k] = str(p[k], 800);
  if (p.required === true) out.required = true;
  if (p.default !== undefined) out.default = p.default;
  if (Array.isArray(p.enum) && p.enum.length) { out.enum = uniq(p.enum.filter((x) => ['string', 'number', 'boolean'].includes(typeof x))); if (out.type !== 'enum' && out.type !== 'boolean') out.type = 'enum'; }
  if (isObj(p.enumLabels)) out.enumLabels = Object.fromEntries(Object.entries(p.enumLabels).filter(([, v]) => typeof v === 'string'));
  for (const k of ['min', 'max', 'step']) if (typeof p[k] === 'number' && Number.isFinite(p[k])) out[k] = p[k];
  if (Number.isInteger(p.maxLength) && p.maxLength >= 0) out.maxLength = p.maxLength;
  if (Number.isInteger(p.position) && p.position >= 0) out.position = p.position;
  if (PARAM_TYPES.includes(p.items)) out.items = p.items;
  if (Array.isArray(p.examples)) out.examples = p.examples.slice(0, 8);
  const al = strList(p.aliases, 64, 12); if (al.length) out.aliases = al;
  return out;
}

const TRUE_WORDS = new Set(['true', 'on', 'yes', '1', 'enable', 'enabled', 'start']);
const FALSE_WORDS = new Set(['false', 'off', 'no', '0', 'disable', 'disabled', 'stop']);

/** A value as typed or spoken (a string) → the param's type, or `undefined` when it can't be. Typed values pass through. */
export function coerceParam(param, v) {
  if (v === undefined || v === null) return undefined;
  const t = param.type;
  if (t === 'boolean') { if (typeof v === 'boolean') return v; const w = foldWords(v); return TRUE_WORDS.has(w) ? true : FALSE_WORDS.has(w) ? false : undefined; }
  if (t === 'number' || t === 'integer' || t === 'duration') { const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN; return Number.isFinite(n) ? n : undefined; }
  if (t === 'enum') {
    if (!Array.isArray(param.enum)) return v;
    const exact = param.enum.find((x) => x === v || String(x).toLowerCase() === String(v).toLowerCase());
    if (exact !== undefined) return exact;
    const w = foldWords(v);
    for (const [val, label] of Object.entries(param.enumLabels ?? {})) if (foldWords(label) === w) return param.enum.find((x) => String(x) === val) ?? val;
    const byWords = param.enum.find((x) => foldWords(x) === w);
    return byWords;
  }
  if (t === 'array') { if (Array.isArray(v)) return v; if (typeof v === 'string') { try { const j = JSON.parse(v); if (Array.isArray(j)) return j; } catch { /* words */ } return v.split(/\s*[,;]\s*|\s+and\s+/).map((x) => x.trim()).filter(Boolean); } return undefined; }
  if (t === 'object' || t === 'json') { if (isObj(v)) return v; if (typeof v === 'string') { try { const j = JSON.parse(v); return t === 'json' ? j : isObj(j) ? j : undefined; } catch { return t === 'json' ? v : undefined; } } return t === 'json' ? v : undefined; }
  return typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : undefined;
}

/** What is allowed, in words (for a validation error and for the CLI help). */
export function allowedWords(p) {
  if (Array.isArray(p.enum)) return `one of: ${p.enum.map((x) => (p.enumLabels?.[String(x)] ? `${x} (${p.enumLabels[String(x)]})` : String(x))).join(', ')}`;
  if (p.type === 'boolean') return 'on or off (true / false)';
  const range = [p.min !== undefined ? `at least ${p.min}` : '', p.max !== undefined ? `at most ${p.max}` : '', p.step !== undefined ? `in steps of ${p.step}` : ''].filter(Boolean).join(', ');
  return `${p.type === 'id' && p.of ? `an id from ${p.of}` : p.type === 'integer' ? 'a whole number' : p.type === 'number' ? 'a number' : p.type === 'duration' ? 'a duration (minutes)' : `a ${p.type}`}${range ? ` (${range})` : ''}${p.pattern ? ` matching ${p.pattern}` : ''}${p.maxLength !== undefined ? `, at most ${p.maxLength} characters` : ''}`;
}

/**
 * Check and complete the parameters of an action: coerce each from strings, apply defaults, refuse unknown names (unless
 * the action takes a free-form `body` / `input` object, which absorbs them), check required, enum, range, step, pattern,
 * length. → { params, errors }.
 */
export function checkParams(action, given = {}) {
  const errors = [];
  const out = {};
  const params = Array.isArray(action?.params) ? action.params : [];
  const byName = new Map();
  for (const p of params) { byName.set(p.name.toLowerCase(), p); for (const a of p.aliases ?? []) byName.set(a.toLowerCase(), p); }
  const absorb = params.find((p) => (p.type === 'object' || p.type === 'json') && ['body', 'input'].includes(p.name));
  const extra = {};
  const src = isObj(given) ? given : {};
  for (const [k, v] of Object.entries(src)) {
    const p = byName.get(k.toLowerCase());
    if (!p) { if (absorb) extra[k] = v; else errors.push(`${k} is not a parameter of ${action.id}${params.length ? ` (it takes ${params.map((x) => x.name).join(', ')})` : ' (it takes none)'}`); continue; }
    if (v === undefined || v === null || v === '') continue;
    const c = coerceParam(p, v);
    if (c === undefined) { errors.push(`${p.name} must be ${allowedWords(p)} (got ${JSON.stringify(v).slice(0, 60)})`); continue; }
    if (p.type === 'integer' && !Number.isInteger(c)) errors.push(`${p.name} must be a whole number`);
    if (typeof c === 'number') {
      if (p.min !== undefined && c < p.min) errors.push(`${p.name} must be at least ${p.min}`);
      if (p.max !== undefined && c > p.max) errors.push(`${p.name} must be at most ${p.max}`);
      if (p.step !== undefined && Math.abs(((c - (p.min ?? 0)) / p.step) - Math.round((c - (p.min ?? 0)) / p.step)) > 1e-9) errors.push(`${p.name} must be in steps of ${p.step}${p.min !== undefined ? ` from ${p.min}` : ''}`);
    }
    if (typeof c === 'string') {
      if (p.pattern && !new RegExp(p.pattern).test(c)) errors.push(`${p.name} must match ${p.pattern}`);
      if (p.maxLength !== undefined && c.length > p.maxLength) errors.push(`${p.name} must be at most ${p.maxLength} characters`);
      if (p.type === 'color' && !/^(#[0-9a-f]{3,8}|[a-z]+\(.*\)|[a-z-]+)$/i.test(c)) errors.push(`${p.name} must be a colour (#rrggbb, rgb(…), hsl(…) or a name)`);
      if (p.type === 'url' && !/^[a-z][a-z0-9+.-]*:\/\//i.test(c)) errors.push(`${p.name} must be a URL`);
      if (p.type === 'time' && !/^([01]\d|2[0-3]):[0-5]\d$/.test(c)) errors.push(`${p.name} must be a time (HH:MM)`);
      if (p.type === 'date' && !/^\d{4}-\d{2}-\d{2}/.test(c)) errors.push(`${p.name} must be a date (YYYY-MM-DD)`);
    }
    out[p.name] = c;
  }
  if (absorb && Object.keys(extra).length) out[absorb.name] = { ...(isObj(out[absorb.name]) ? out[absorb.name] : {}), ...extra };
  for (const p of params) {
    if (out[p.name] === undefined && p.default !== undefined) out[p.name] = p.default;
    if (out[p.name] === undefined && p.required) errors.push(`${p.name} is required: ${allowedWords(p)}`);
  }
  return { params: out, errors };
}

/* ================================================================== entries */

const cleanSurfaces = (raw) => {
  const s = isObj(raw) ? raw : {};
  const out = {};
  for (const k of ['rest', 'mcp', 'cli', 'deepLink']) if (typeof s[k] === 'string' && s[k].trim()) out[k] = s[k].trim().slice(0, 300); else if (typeof s[k] === 'boolean') out[k] = s[k];
  if (Array.isArray(s.voice)) { const v = strList(s.voice, 80, 40); if (v.length) out.voice = v; } else if (typeof s.voice === 'boolean') out.voice = s.voice;
  return out;
};
const cleanGaps = (raw) => (Array.isArray(raw) ? raw.filter((g) => isObj(g) && str(g.what, 160) && str(g.why, 400)).map((g) => ({ what: str(g.what, 160), why: str(g.why, 400), ...(str(g.plan, 200) ? { plan: str(g.plan, 200) } : {}) })) : []);

/** One action, cleaned: unknown fields dropped, params cleaned, phrases folded. Null when it has no id. */
export function cleanAction(raw) {
  const a = isObj(raw) ? raw : {};
  const id = str(a.id, 64).toLowerCase();
  if (!ACTION_ID.test(id)) return null;
  const out = { id, effect: EFFECTS.includes(a.effect) ? a.effect : 'write', run: REF.test(str(a.run, 400)) ? str(a.run, 400) : 'none' };
  if (str(a.label, 120)) out.label = str(a.label, 120);
  if (str(a.description, 1200)) out.description = str(a.description, 1200);
  const params = (Array.isArray(a.params) ? a.params : []).map(cleanParam).filter(Boolean);
  if (params.length) out.params = params;
  if (a.needsAI === true) out.needsAI = true;
  if (a.confirm === true || out.effect === 'destructive') out.confirm = true;
  if (str(a.permission, 120)) out.permission = str(a.permission, 120);
  const aliases = strList(a.aliases, 64, 12).map((x) => x.toLowerCase()); if (aliases.length) out.aliases = aliases;
  const phrases = strList(a.phrases, 80, 40); if (phrases.length) out.phrases = phrases;
  const s = cleanSurfaces(a.surfaces); if (Object.keys(s).length) out.surfaces = s;
  if (str(a.output, 400)) out.output = str(a.output, 400);
  const gaps = cleanGaps(a.gaps); if (gaps.length) out.gaps = gaps;
  return out;
}

/**
 * One entry, cleaned and completed: defaults filled (surfaces from GENERIC_SURFACES where nothing is declared, a
 * `params` gap for every parameter without allowed values when it should have them), its hash computed. Null without
 * a valid id, type, owner and label.
 */
export function normalizeEntry(raw) {
  const e = isObj(raw) ? raw : {};
  const id = normId(e.id);
  if (!ID.test(id)) return null;
  const typeSeg = id.split('/')[1];
  const type = ENTRY_TYPES.includes(e.type) ? e.type : typeSeg;
  if (type !== typeSeg) return null; // the id says what it is; a declaration that disagrees is a mistake, not a merge
  const owner = str(e.owner, 60).toLowerCase() || id.split('/')[0];
  const label = str(e.label, 160) || id.split('/').slice(2).join('/');
  if (!label) return null;
  const out = { id, type, owner, label };
  if (str(e.description, 2000)) out.description = str(e.description, 2000);
  const where = {}; for (const k of ['app', 'plugin', 'view', 'settingsTab', 'dialog', 'menu', 'route', 'file', 'host']) if (str(e.where?.[k], 300)) where[k] = str(e.where[k], 300);
  if (!where.app && !where.host) where.app = owner;
  out.where = where;
  if (isObj(e.open)) {
    const open = {};
    if (OPEN_KINDS.includes(e.open.kind)) open.kind = e.open.kind;
    for (const k of ['target', 'deepLink', 'anchor']) if (str(e.open[k], 600)) open[k] = str(e.open[k], 600);
    if (Object.keys(open).length) out.open = open;
  }
  if (isObj(e.state)) {
    const state = {};
    if (REF.test(str(e.state.read, 400))) state.read = str(e.state.read, 400);
    if (str(e.state.shape, 400)) state.shape = str(e.state.shape, 400);
    const fields = (Array.isArray(e.state.fields) ? e.state.fields : []).map(cleanParam).filter(Boolean); if (fields.length) state.fields = fields;
    if (Object.keys(state).length) out.state = state;
  }
  const seen = new Set();
  out.actions = (Array.isArray(e.actions) ? e.actions : []).map(cleanAction).filter((a) => a && !seen.has(a.id) && seen.add(a.id));
  if (e.needsAI === true) out.needsAI = true;
  const surfaces = cleanSurfaces(e.surfaces);
  // every entry with an action is reachable through the generic dispatcher on REST, MCP and the CLI (s4-s6) unless declared otherwise
  if (out.actions.length) for (const k of ['rest', 'mcp', 'cli']) if (surfaces[k] === undefined) surfaces[k] = true;
  if (surfaces.voice === undefined) { const v = uniq(out.actions.flatMap((a) => [...(a.phrases ?? []), ...(Array.isArray(a.surfaces?.voice) ? a.surfaces.voice : [])])); surfaces.voice = v.length ? v.slice(0, 40) : false; }
  if (surfaces.deepLink === undefined) surfaces.deepLink = out.open?.deepLink ? out.open.deepLink : false;
  out.surfaces = surfaces;
  const aliases = uniq(strList(e.aliases, 120, 40).map((x) => x.toLowerCase())).filter((x) => x !== id); if (aliases.length) out.aliases = aliases;
  const synonyms = strList(e.synonyms, 80, 40); if (synonyms.length) out.synonyms = synonyms;
  const keywords = strList(e.keywords, 80, 40); if (keywords.length) out.keywords = keywords;
  const tags = strList(e.tags, 40, 20); if (tags.length) out.tags = tags;
  if (str(e.requires, 120)) out.requires = str(e.requires, 120);
  if (ID.test(normId(e.parent))) out.parent = normId(e.parent);
  const sk = isObj(e.source) && SOURCE_KINDS.includes(e.source.kind) ? e.source.kind : 'declared';
  out.source = { kind: sk, ...(str(e.source?.file, 300) ? { file: str(e.source.file, 300) } : {}), ...(str(e.source?.frame, 60) ? { frame: str(e.source.frame, 60) } : {}) };
  // derived gaps (allowed values, surfaces) are recomputed every time, so a declaration that fixes one removes it
  const gaps = cleanGaps(e.gaps).filter((g) => !(g.what === 'params' && g.why.includes(AUTO_PARAMS_WHY)) && !(SURFACE_GAPS.has(g.what) && AUTO_SURFACE_WHY.some((w) => g.why === w)));
  for (const a of out.actions) for (const p of a.params ?? []) {
    if (needsAllowedValues(p) && !gaps.some((g) => g.what === 'params' && g.why.includes(`${a.id}.${p.name}`))) gaps.push({ what: 'params', why: `${a.id}.${p.name} (${p.type}) ${AUTO_PARAMS_WHY}`, plan: 'full-api-cli-control s7' });
  }
  // a missing surface is a gap: REST / MCP / CLI always; a deep link only for things that are screens (page, plugin, app);
  // voice only for things a person would say (not a plain read or info tool)
  const spoken = ['page', 'setting', 'behavior', 'display', 'plugin', 'app'].includes(type) || out.actions.some((a) => a.effect !== 'read');
  for (const k of ['rest', 'mcp', 'cli', 'voice', 'deepLink']) {
    if (surfaces[k] !== false || gaps.some((g) => g.what === k)) continue;
    if (k === 'deepLink' && !['page', 'plugin', 'app'].includes(type)) continue;
    if (k === 'voice' && !spoken) continue;
    gaps.push({ what: k, why: k === 'voice' ? AUTO_SURFACE_WHY[0] : k === 'deepLink' ? AUTO_SURFACE_WHY[1] : `declared unreachable on ${k}` });
  }
  if (gaps.length) out.gaps = gaps;
  out.hash = entryHash(out);
  return out;
}

const AUTO_PARAMS_WHY = 'declares no allowed values: add enum, min/max or pattern in plugin.json control';
const AUTO_SURFACE_WHY = ['no phrase declared for it yet (plugin.json voice, or a control-registry declaration)', 'nothing to open: it has no view, dialog or settings tab'];
const SURFACE_GAPS = new Set(['voice', 'deepLink']);
/** A free string / number param on a write should say what it allows; ids, text, json, objects, secrets and booleans needn't. */
const needsAllowedValues = (p) => ['string', 'number', 'integer'].includes(p.type) && p.enum === undefined && p.min === undefined && p.max === undefined && !p.pattern && !p.of && p.maxLength === undefined;

/** Merge a partial (declared) entry into a derived one: scalars replace, actions merge by id, params by name, lists union. */
export function mergeEntry(base, patch) {
  if (!isObj(base)) return normalizeEntry(patch);
  if (!isObj(patch)) return base;
  const out = { ...base };
  for (const k of ['type', 'owner', 'label', 'description', 'needsAI', 'requires', 'parent']) if (patch[k] !== undefined) out[k] = patch[k];
  for (const k of ['where', 'open', 'state', 'surfaces']) if (isObj(patch[k])) out[k] = { ...(isObj(base[k]) ? base[k] : {}), ...patch[k] };
  for (const k of ['aliases', 'synonyms', 'keywords', 'tags', 'gaps']) if (Array.isArray(patch[k])) out[k] = uniqBy([...(base[k] ?? []), ...patch[k]], (x) => canonical(x));
  if (Array.isArray(patch.actions)) {
    const acts = [...(base.actions ?? [])];
    for (const pa of patch.actions) {
      if (!isObj(pa) || !pa.id) continue;
      const i = acts.findIndex((a) => a.id === String(pa.id).toLowerCase());
      if (i < 0) { acts.push(pa); continue; }
      const merged = { ...acts[i], ...pa };
      if (Array.isArray(pa.params)) {
        const ps = [...(acts[i].params ?? [])];
        for (const pp of pa.params) { if (!isObj(pp) || !pp.name) continue; const j = ps.findIndex((x) => x.name === pp.name); if (j < 0) ps.push(pp); else ps[j] = { ...ps[j], ...pp }; }
        merged.params = ps;
      }
      for (const k of ['aliases', 'phrases']) if (Array.isArray(pa[k])) merged[k] = uniq([...(acts[i][k] ?? []), ...pa[k]]);
      acts[i] = merged;
    }
    out.actions = acts;
  }
  if (isObj(patch.source)) out.source = { ...base.source, ...patch.source };
  return normalizeEntry(out);
}
const uniqBy = (arr, key) => { const seen = new Set(); return arr.filter((x) => { const k = key(x); if (seen.has(k)) return false; seen.add(k); return true; }); };

/** Apply a control-registry@1 declaration (plugin.json `control`, registry.d/*.json) to a list of entries. → { entries, owners, errors }. */
export function applyDeclaration(entries, declaration, { file = '' } = {}) {
  const errors = [];
  const owners = [];
  if (!isObj(declaration)) return { entries, owners, errors: ['declaration must be an object'] };
  if (declaration.$axf !== REGISTRY_FRAME) errors.push(`${file || 'declaration'}: $axf must be ${REGISTRY_FRAME}`);
  if (isObj(declaration.owner) && str(declaration.owner.id)) owners.push(declaration.owner);
  const byId = new Map(entries.map((e) => [e.id, e]));
  (Array.isArray(declaration.entries) ? declaration.entries : []).forEach((d, i) => {
    if (!isObj(d) || !ID.test(normId(d.id))) { errors.push(`${file || 'declaration'}: entries[${i}] needs an id like <owner>/<type>/<name>`); return; }
    const id = normId(d.id);
    if (d.remove === true) { byId.delete(id); return; }
    const base = byId.get(id);
    const patch = { ...d, source: { kind: base ? base.source.kind : 'declared', ...(file ? { file } : {}), frame: REGISTRY_FRAME } };
    delete patch.remove;
    if (!base && (!d.type || !d.label)) { errors.push(`${file || 'declaration'}: ${id} is new here, so it needs type and label`); return; }
    const merged = mergeEntry(base ?? null, base ? patch : { ...patch, id, owner: d.owner ?? id.split('/')[0] });
    if (!merged) { errors.push(`${file || 'declaration'}: ${id} does not normalise (type, owner, label, actions)`); return; }
    byId.set(id, merged);
  });
  return { entries: [...byId.values()], owners, errors };
}

/* ================================================================== the index */

/** Owners the entries name, described (known apps get their labels; unknown ones are listed as apps). */
export const KNOWN_OWNERS = Object.freeze({
  'console-web': { label: 'Dev Console', kind: 'app', via: 'console', base: 'https://console.amberxai.com' },
  molly: { label: 'Molly', kind: 'app', via: 'console' },
  'axhub-web': { label: 'axHub', kind: 'app', via: 'axhub' },
  'amberx-droid': { label: 'AmberX', kind: 'app', via: 'channel' },
  'walkthrough-studio': { label: 'Walkthrough Studio', kind: 'app', via: 'console' },
  voicevault: { label: 'VoiceVault', kind: 'app', via: 'channel' },
  vps: { label: 'VPS', kind: 'device', via: 'axhub' },
  hostinger: { label: 'Hostinger', kind: 'provider', via: 'axhub' },
  coolify: { label: 'Coolify', kind: 'provider', via: 'axhub' },
  moshi: { label: 'Moshi', kind: 'service', via: 'intent' },
});

/** The index from entries: sorted by id, owners described, counts, gaps gathered, hash. */
export function buildIndex(rawEntries, { now = new Date(), commit = '', root = '', collectors = [], owners: extraOwners = [] } = {}) {
  const seen = new Map();
  for (const r of rawEntries ?? []) { const e = isObj(r) && HASH.test(r.hash ?? '') && entryHash(r) === r.hash ? r : normalizeEntry(r); if (e) seen.set(e.id, seen.has(e.id) ? mergeEntry(seen.get(e.id), e) : e); }
  const entries = [...seen.values()].sort((a, b) => a.id.localeCompare(b.id));
  const ownerIds = uniq([...entries.map((e) => e.owner), ...extraOwners.map((o) => o.id)]);
  const owners = ownerIds.sort().map((id) => { const d = extraOwners.find((o) => o.id === id); const k = KNOWN_OWNERS[id]; return { id, label: d?.label ?? k?.label ?? id, kind: d?.kind ?? k?.kind ?? 'app', ...(d?.via ?? k?.via ? { via: d?.via ?? k.via } : {}), ...(d?.base ?? k?.base ? { base: d?.base ?? k.base } : {}) }; });
  const count = (f) => entries.reduce((m, x) => { const k = f(x); if (k !== undefined) m[k] = (m[k] ?? 0) + 1; return m; }, {});
  const counts = {
    entries: entries.length, actions: entries.reduce((n, e) => n + e.actions.length, 0), byType: count((e) => e.type), byOwner: count((e) => e.owner), bySource: count((e) => e.source.kind),
    needsAI: entries.filter((e) => e.needsAI || e.actions.some((a) => a.needsAI)).length,
    surfaces: Object.fromEntries(SURFACES.map((s) => [s, entries.filter((e) => e.surfaces[s] !== false && e.surfaces[s] !== undefined).length])),
    gaps: entries.reduce((n, e) => n + (e.gaps?.length ?? 0), 0),
    gapsBy: entries.flatMap((e) => e.gaps ?? []).reduce((m, g) => { m[g.what] = (m[g.what] ?? 0) + 1; return m; }, {}),
  };
  // index-wide gaps only (an entry's gaps stay on the entry: gapsOf(index) lists them all)
  const gaps = extraOwners.flatMap((o) => (Array.isArray(o.gaps) ? o.gaps : []));
  return { $axf: REGISTRY_FRAME, version: REGISTRY_VERSION, generatedAt: now.toISOString(), source: { ...(commit ? { commit } : {}), ...(root ? { root } : {}), collectors }, hash: indexHash(entries), counts, owners: owners.map(({ gaps: _g, ...o }) => o), gaps, entries };
}

/** Every gap in the index, with the entry it belongs to: [{ entry, what, why, plan? }]. */
export const gapsOf = (index) => (index?.entries ?? []).flatMap((e) => (e.gaps ?? []).map((g) => ({ entry: e.id, ...g })));

/**
 * The index as a file: the header fields, then one entry per line (readable diffs, a third of the size of indented
 * JSON). `JSON.parse` reads it back as is.
 */
export function serializeIndex(index) {
  const { entries, ...head } = index;
  const h = JSON.stringify(head, null, 1).replace(/\n}$/, ',\n "entries": [\n');
  return `${h}${(entries ?? []).map((e) => JSON.stringify(e)).join(',\n')}\n ]\n}\n`;
}

/** What changed between two indexes: { same, added, removed, changed: [{ id, fields }] }. */
export function diffIndex(before, after) {
  const a = new Map((before?.entries ?? []).map((e) => [e.id, e]));
  const b = new Map((after?.entries ?? []).map((e) => [e.id, e]));
  const added = [...b.keys()].filter((id) => !a.has(id)).sort();
  const removed = [...a.keys()].filter((id) => !b.has(id)).sort();
  const changed = [];
  for (const [id, e] of b) {
    const o = a.get(id);
    if (!o || o.hash === e.hash) continue;
    const fields = uniq([...Object.keys(o), ...Object.keys(e)]).filter((k) => k !== 'hash' && canonical(o[k]) !== canonical(e[k]));
    changed.push({ id, fields });
  }
  changed.sort((x, y) => x.id.localeCompare(y.id));
  return { same: !added.length && !removed.length && !changed.length, added, removed, changed };
}

/* ================================================================== export / import */

/** The index as a file: the index itself plus when it was exported. */
export const exportIndex = (index, { now = new Date() } = {}) => serializeIndex({ ...index, exportedAt: now.toISOString() });

/** An exported index back in: parsed, exportedAt dropped, checked against the schema and its hashes. → { ok, index?, errors }. */
export function importIndex(textOrObj, schema) {
  let raw = textOrObj;
  if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch (e) { return { ok: false, errors: [`not JSON: ${e.message}`] }; } }
  if (!isObj(raw)) return { ok: false, errors: ['an index is an object'] };
  const { exportedAt: _x, ...index } = raw;
  if (index.$axf !== REGISTRY_FRAME) return { ok: false, errors: [`$axf must be ${REGISTRY_FRAME}`] };
  if (index.version !== REGISTRY_VERSION) return { ok: false, errors: [`version ${index.version} is not ${REGISTRY_VERSION}: rebuild the index on this version`] };
  const errors = schema ? validateIndex(schema, index) : (Array.isArray(index.entries) ? [] : ['entries must be a list']);
  return errors.length ? { ok: false, errors } : { ok: true, index };
}

/* ================================================================== queries */

const entryWords = (e) => foldWords([e.label, e.id.replace(/[/._:-]/g, ' '), ...(e.aliases ?? []), ...(e.synonyms ?? []), ...(e.keywords ?? []), ...(e.tags ?? []), e.where.plugin ?? '', e.description ?? ''].join(' '));

/** Entries by exact id or alias (case-insensitive), by open target, or by label. Null when none. */
export function getEntry(index, idOrAlias) {
  const q = str(idOrAlias, 200).toLowerCase();
  if (!q) return null;
  const entries = index?.entries ?? [];
  return entries.find((e) => e.id.toLowerCase() === q) ?? entries.find((e) => e.aliases?.includes(q)) ?? entries.find((e) => e.open?.target?.toLowerCase() === q) ?? entries.find((e) => foldWords(e.label) === foldWords(q)) ?? null;
}

/** Entries filtered: owner, type, tag, surface (reachable there), needsAI, plugin, and words (every word must hit). */
export function listEntries(index, { owner = '', type = '', tag = '', surface = '', plugin = '', needsAI, q = '', limit = LIST_DEFAULT, offset = 0 } = {}) {
  const words = foldWords(q).split(' ').filter(Boolean);
  const lim = Math.max(1, Math.min(Number(limit) || LIST_DEFAULT, LIST_MAX));
  const all = (index?.entries ?? []).filter((e) => (!owner || e.owner === owner) && (!type || e.type === type) && (!tag || e.tags?.includes(tag)) && (!plugin || e.where.plugin === plugin)
    && (!surface || (e.surfaces[surface] !== false && e.surfaces[surface] !== undefined)) && (needsAI === undefined || !!(e.needsAI || e.actions.some((a) => a.needsAI)) === needsAI)
    && (!words.length || words.every((w) => ` ${entryWords(e)} `.includes(` ${w} `) || entryWords(e).includes(w))));
  return { items: all.slice(offset, offset + lim), total: all.length };
}

/** Ranked search: whole-word hits on label, aliases, synonyms, keywords and id; label phrase matches first. */
export function searchEntries(index, q, { limit = LIST_DEFAULT, type = '', owner = '', strict = false } = {}) {
  const words = foldWords(q).split(' ').filter(Boolean);
  if (!words.length) return [];
  const phrase = words.join(' ');
  const scored = [];
  for (const e of index?.entries ?? []) {
    if ((type && e.type !== type) || (owner && e.owner !== owner)) continue;
    const s = scoreEntry(e, words, phrase, strict);
    if (s > 0) scored.push([e, s]);
  }
  return scored.sort((a, b) => b[1] - a[1] || a[0].id.localeCompare(b[0].id)).slice(0, Math.min(limit, LIST_MAX)).map(([e, score]) => ({ entry: e, score }));
}

/* ================================================================== resolving (deterministic: exact ids, aliases, whole words, allowed values) */

/** Words that start a sentence and only say what to do; mapped to an action id when the entry has it. */
const VERBS = [
  [/^(open|show|go to|goto|load|bring up|pull up|take me to|display)$/, 'open'],
  [/^(close|dismiss)$/, 'close'],
  [/^(set|change|make|put|switch to|choose|select|pick|use)$/, 'set'],
  [/^(turn on|enable|start|activate|switch on)$/, 'on'],
  [/^(turn off|disable|stop|deactivate|switch off)$/, 'off'],
  [/^(toggle|flip)$/, 'toggle'],
  [/^(reset|restore|default)$/, 'reset'],
  [/^(run|do|execute|trigger|fire|call|invoke)$/, 'run'],
  [/^(read|get|what is|whats|what's|tell me|check|status of|state of|show me|list)$/, 'read'],
  [/^(press|click|tap|hit)$/, 'press'],
  [/^(add|create|new)$/, 'add'],
  [/^(remove|delete)$/, 'remove'],
];
/** When several exact names can do the verb, which type a person most likely means: open → the page; set / read → the setting or display; run → the tool. */
const TYPE_RANK = {
  open: ['page', 'app', 'plugin', 'display', 'behavior', 'setting', 'tool'],
  set: ['setting', 'display', 'behavior', 'tool', 'page', 'plugin', 'app'], on: ['behavior', 'setting', 'tool', 'display', 'plugin', 'page', 'app'], off: ['behavior', 'setting', 'tool', 'display', 'plugin', 'page', 'app'], toggle: ['behavior', 'setting', 'tool', 'display', 'plugin', 'page', 'app'], reset: ['setting', 'display', 'behavior', 'tool', 'page', 'plugin', 'app'],
  read: ['setting', 'display', 'behavior', 'tool', 'plugin', 'page', 'app'], run: ['tool', 'behavior', 'setting', 'display', 'plugin', 'page', 'app'],
  '': ['page', 'setting', 'display', 'behavior', 'tool', 'plugin', 'app'],
};
/** Grammar words that never name anything, dropped anywhere in a phrase. */
const FILLER = new Set(['the', 'a', 'an', 'my', 'me', 'please', 'to', 'in', 'on', 'of', 'for', 'at', 'up', 'screen', 'page', 'tab', 'view', 'now', 'it', 'this', 'that']);
/** Wake words and addresses, dropped only at the front ("hey amber, …"): "amber" inside a name (Follow Amber) stays. */
const WAKE = new Set(['hey', 'okay', 'ok', 'amber', 'amberx', 'console', 'computer', 'yo', ...FILLER]);

/**
 * How well an entry matches words (0 = not at all; every word must hit something). Labels weigh most, then aliases /
 * synonyms, then keywords / id, then the description. `strict` leaves the description out (resolving a phrase: a value
 * word that happens to be in a description must not be swallowed into the name).
 */
function scoreEntry(e, words, phrase, strict = false) {
  const label = foldWords(e.label);
  const lw = label.split(' ');
  const names = (e.aliases ?? []).concat(e.synonyms ?? []).map(foldWords);
  const idw = foldWords(e.id.replace(/[/._:-]/g, ' ')).split(' ');
  const kw = foldWords((e.keywords ?? []).concat(e.tags ?? []).concat(e.where.plugin ? [e.where.plugin] : []).join(' ')).split(' ');
  const desc = foldWords(e.description ?? '');
  let score = 0;
  for (const w of words) {
    if (lw.includes(w)) score += 4;
    else if (names.some((n) => n.split(' ').includes(w))) score += 3.5;
    else if (idw.includes(w)) score += 3;
    else if (kw.includes(w)) score += 2;
    else if (lw.some((x) => x.startsWith(w) && w.length >= 3)) score += 1.5;
    else if (!strict && ` ${desc} `.includes(` ${w} `)) score += 0.5;
    else return 0;
  }
  if (label === phrase || names.includes(phrase)) score += 20;
  else if (label.startsWith(phrase)) score += 5;
  if (e.id === phrase.replace(/ /g, '-') || e.id.endsWith(`/${phrase.replace(/ /g, '-')}`)) score += 15;
  return score - lw.length * 0.01;
}

/** The action of an entry a token names: id, alias, or a verb (on/off → toggle/set with on param). → { action, preset? } or null. */
export function findAction(entry, token) {
  const t = foldWords(token);
  if (!t) return null;
  const acts = entry.actions ?? [];
  const by = (id) => acts.find((a) => a.id === id || a.aliases?.includes(id));
  let hit = by(t.replace(/ /g, '-')) ?? by(t);
  if (hit) return { action: hit };
  for (const [re, id] of VERBS) {
    if (!re.test(t)) continue;
    if (id === 'on' || id === 'off') {
      const tog = by('toggle') ?? by('switch') ?? by('set') ?? acts.find((a) => (a.params ?? []).some((p) => p.type === 'boolean')) ?? by('enable');
      if (!tog) return null;
      const p = (tog.params ?? []).find((x) => x.type === 'boolean') ?? (tog.params ?? []).find((x) => x.name === 'value' || x.name === 'on');
      return { action: tog, preset: p ? { [p.name]: id === 'on' } : {} };
    }
    if (id === 'read') hit = by('read') ?? by('get') ?? by('state') ?? by('list') ?? by('status') ?? by('info');
    else if (id === 'open') hit = by('open') ?? by('show');
    else hit = by(id);
    if (hit) return { action: hit };
  }
  return null;
}

/** The action used when none is named: open for a page, read for a setting or display, run for a tool, else the first. */
export function defaultAction(entry) {
  const acts = entry.actions ?? [];
  const by = (id) => acts.find((a) => a.id === id);
  if (entry.type === 'page') return by('open') ?? acts[0] ?? null;
  if (entry.type === 'setting' || entry.type === 'display') return by('read') ?? by('get') ?? acts[0] ?? null;
  if (entry.type === 'tool') return by('run') ?? by('read') ?? acts[0] ?? null;
  return by('open') ?? by('toggle') ?? acts[0] ?? null;
}

const fail = (code, message, extra = {}) => ({ ok: false, code, message, ...extra });
const candidatesOf = (index, q, limit = 6) => searchEntries(index, q, { limit }).map(({ entry }) => ({ id: entry.id, label: entry.label, type: entry.type, owner: entry.owner, actions: entry.actions.map((a) => a.id) }));
const gapFor = (what, how) => ({ what, why: `no registry entry, alias, synonym or phrase names "${what}" (${how})`, declare: 'add it to the plugin.json control / voice block, or _claude/builds/registry/registry.d/*.json' });

/** Finish a match: parameters checked, needsAI gated. */
function finish(index, entry, action, given, how, { aiAvailable = false } = {}) {
  if (!action) return fail(RESOLVE_CODES.NOT_FOUND, `${entry.label} (${entry.id}) has no actions to run`, { entry: entry.id, candidates: [], gap: { what: entry.id, why: 'the entry declares no actions', declare: 'add actions in plugin.json control' } });
  const { params, errors } = checkParams(action, given);
  if (errors.length) return fail(RESOLVE_CODES.VALIDATION, `${entry.label} · ${action.id}: ${errors.join('; ')}`, { entry: entry.id, action: action.id, errors, allowed: Object.fromEntries((action.params ?? []).map((p) => [p.name, allowedWords(p)])), how });
  if (entry.needsAI || action.needsAI) {
    return fail(RESOLVE_CODES.NEEDS_AI, `${entry.label} · ${action.id} needs a model${aiAvailable ? '' : ', and Claude is not available to the console (Claude settings → Console control → Make Claude available to the console)'}`, { entry: entry.id, action: action.id, params, ai: { available: aiAvailable }, how });
  }
  return { ok: true, entry: entry.id, action: action.id, params, effect: action.effect, run: action.run, ...(action.confirm ? { confirm: true } : {}), how, open: entry.open ?? null };
}

/**
 * Resolve a structured command: { id (or alias), action?, params? }. Exact ids only; the action by id, alias or verb;
 * parameters checked against their allowed values.
 */
export function resolveCommand(index, cmd, opts = {}) {
  const c = isObj(cmd) ? cmd : {};
  const q = str(c.id ?? c.entry, 200);
  if (!q) return fail(RESOLVE_CODES.VALIDATION, 'a command needs an entry id', { errors: ['id is required'] });
  const entry = getEntry(index, q);
  if (!entry) { const candidates = candidatesOf(index, q.replace(/[/._:-]/g, ' ')); return fail(RESOLVE_CODES.NOT_FOUND, `no entry "${q}"${candidates.length ? `; closest: ${candidates.map((x) => x.id).join(', ')}` : ''}`, { candidates, gap: gapFor(q, 'exact id or alias') }); }
  let action = null; let preset = {};
  if (str(c.action, 64)) { const f = findAction(entry, c.action); if (!f) return fail(RESOLVE_CODES.NOT_FOUND, `${entry.label} has no action "${c.action}" (it has ${entry.actions.map((a) => a.id).join(', ') || 'none'})`, { entry: entry.id, candidates: [], actions: entry.actions.map((a) => a.id), gap: gapFor(`${entry.id} ${c.action}`, 'action id or alias') }); action = f.action; preset = f.preset ?? {}; }
  else action = defaultAction(entry);
  return finish(index, entry, action, { ...preset, ...(isObj(c.params) ? c.params : {}) }, { kind: 'command' }, opts);
}

/**
 * Resolve a CLI call: ['<entry id | alias | plugin> [<command>]', '<action>?', '<positional>…', '--name', 'value', '--flag'].
 * `follow-amber show --target plan-studio` names the tool entry <app>/tool/follow-amber/show with action run.
 */
export function resolveCli(index, argv, opts = {}) {
  const args = (Array.isArray(argv) ? argv : String(argv ?? '').split(/\s+/)).map(String).filter(Boolean);
  if (!args.length) return fail(RESOLVE_CODES.VALIDATION, 'nothing to resolve', { errors: ['an entry is required'] });
  const flags = {}; const words = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) { const k = args[i].slice(2); const eq = k.indexOf('='); if (eq > 0) flags[k.slice(0, eq)] = k.slice(eq + 1); else if (args[i + 1] !== undefined && !args[i + 1].startsWith('--')) flags[k] = args[++i]; else flags[k.replace(/^no-/, '')] = !k.startsWith('no-'); }
    else words.push(args[i]);
  }
  // `<plugin> <command>` names the tool before `<plugin>` alone names the plugin entry
  let entry = null; let used = 1;
  if (words.length >= 2) { const two = `${words[0]}/${words[1]}`.toLowerCase(); entry = (index?.entries ?? []).find((e) => e.id.toLowerCase().endsWith(`/tool/${two}`) || e.aliases?.includes(two)) ?? null; if (entry) used = 2; }
  if (!entry) entry = getEntry(index, words[0]);
  if (!entry) { const one = words[0].toLowerCase(); const tools = (index?.entries ?? []).filter((e) => e.id.toLowerCase().endsWith(`/${one}`) || e.where.plugin === one); if (tools.length === 1) entry = tools[0]; else if (tools.length > 1 && words.length === 1) return fail(RESOLVE_CODES.AMBIGUOUS, `"${one}" names several: ${tools.slice(0, 8).map((e) => e.id).join(', ')}`, { candidates: tools.slice(0, 8).map((e) => ({ id: e.id, label: e.label, type: e.type, owner: e.owner, actions: e.actions.map((a) => a.id) })) }); }
  if (!entry) { const candidates = candidatesOf(index, words.join(' ')); return fail(RESOLVE_CODES.NOT_FOUND, `no entry "${words[0]}"${candidates.length ? `; closest: ${candidates.map((x) => x.id).join(', ')}` : ''}`, { candidates, gap: gapFor(words.join(' '), 'CLI: entry id, alias or <plugin> <command>') }); }
  let action = null; let preset = {}; let rest = words.slice(used);
  if (rest.length) { const f = findAction(entry, rest[0]); if (f) { action = f.action; preset = f.preset ?? {}; rest = rest.slice(1); } }
  if (!action) action = defaultAction(entry);
  const given = { ...preset, ...flags };
  if (action) {
    const positional = (action.params ?? []).filter((p) => p.position !== undefined).sort((a, b) => a.position - b.position);
    const free = positional.length ? positional : (action.params ?? []).filter((p) => p.required && given[p.name] === undefined);
    rest.forEach((w, i) => { const p = free[i]; if (p && given[p.name] === undefined) given[p.name] = w; else if (!p) given[`arg${i}`] = w; });
  }
  return finish(index, entry, action, given, { kind: 'cli', argv: args }, opts);
}

/** A phrase pattern with {param} slots → a regexp over folded words, capturing each slot. */
function phraseRegex(phrase) {
  const slots = [];
  const src = foldPhrase(phrase.replace(/\{([a-z0-9_.-]+)\}/gi, (_, n) => { slots.push(n); return ` zzslot${slots.length - 1}zz `; })).replace(/zzslot(\d+)zz/g, '__slot$1__')
    .split(' ').filter(Boolean).map((w) => (/^__slot\d+__$/.test(w) ? '(.+?)' : w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))).join(' ');
  return { re: new RegExp(`(?:^| )${src}(?: |$)`), slots };
}

/**
 * Resolve a spoken or typed phrase. In order, all exact: an action phrase or voice phrase (longest match wins; {param}
 * slots fill parameters), then a verb + the entry's words (label, alias, synonym, whole words) + leftover words as the
 * action's first positional / required parameter. Nothing fuzzy; no model. Ties → ambiguous with candidates; nothing →
 * not_found with the closest entries and the gap.
 */
export function resolvePhrase(index, phrase, opts = {}) {
  const heard = foldPhrase(phrase);
  if (!heard) return fail(RESOLVE_CODES.VALIDATION, 'nothing was said', { errors: ['a phrase is required'] });
  const entries = index?.entries ?? [];
  // 1. declared phrases (action.phrases, surfaces.voice): the longest phrase that appears whole wins
  let best = null;
  for (const e of entries) {
    const pool = [...e.actions.flatMap((a) => (a.phrases ?? []).map((p) => [p, a])), ...(Array.isArray(e.surfaces.voice) ? e.surfaces.voice.filter((p) => !e.actions.some((a) => a.phrases?.includes(p))).map((p) => [p, null]) : [])];
    for (const [p, a] of pool) {
      const { re, slots } = phraseRegex(p);
      const m = re.exec(heard);
      if (!m) continue;
      const len = foldPhrase(p.replace(/\{[^}]+\}/g, '')).length;
      const fill = {}; slots.forEach((s, i) => { fill[s] = m[i + 1]?.trim(); });
      if (!best || len > best.len || (len === best.len && m[0].trim() === heard && best.whole !== true)) best = { e, a: a ?? defaultAction(e), len, fill, whole: m[0].trim() === heard, p };
      else if (len === best.len && best.e.id !== e.id && !(best.whole && m[0].trim() !== heard)) best.tie = [...(best.tie ?? []), e];
    }
  }
  if (best) {
    if (best.tie?.length && !best.whole) { const cands = [best.e, ...best.tie]; return fail(RESOLVE_CODES.AMBIGUOUS, `"${phrase}" matches several: ${cands.map((e) => `${e.label} (${e.id})`).join(', ')}; say which`, { candidates: cands.map((e) => ({ id: e.id, label: e.label, type: e.type, owner: e.owner, actions: e.actions.map((a) => a.id) })) }); }
    return finish(index, best.e, best.a, best.fill, { kind: 'phrase', matched: best.p }, opts);
  }
  // 2. verb + entry words [+ value]
  let verb = ''; let restWords = heard.split(' ');
  while (restWords.length > 1 && WAKE.has(restWords[0])) restWords.shift(); // "hey amber, open plans please"
  for (const [re] of VERBS) { for (const n of [3, 2, 1]) { const head = restWords.slice(0, n).join(' '); if (re.test(head)) { verb = head; restWords = restWords.slice(n); break; } } if (verb) break; }
  // "turn follow amber on", "follow amber off": a trailing on / off is the verb
  const last = restWords[restWords.length - 1];
  if ((last === 'on' || last === 'off') && restWords.length > 1 && (!verb || /^(turn|switch|set|put|make|flip)$/.test(verb))) { verb = `turn ${last}`; restWords = restWords.slice(0, -1); }
  else if (!verb && /^(turn|switch|put|make)$/.test(restWords[0] ?? '')) restWords = restWords.slice(1);
  const content = restWords;
  if (!content.some((w) => !FILLER.has(w))) return fail(RESOLVE_CODES.NOT_FOUND, `"${phrase}" names nothing in the registry`, { candidates: [], gap: gapFor(phrase, 'phrase') });
  // the longest run of leading words that names exactly one entry; what follows is the value. Grammar words are
  // ignored for scoring but kept for exact names ("follow me" is a synonym; "me" alone is filler).
  const namesOf = (e) => [foldWords(e.label), ...(e.aliases ?? []).concat(e.synonyms ?? []).map(foldWords)];
  for (let n = content.length; n >= 1; n--) {
    const raw = content.slice(0, n).join(' ');
    const name = content.slice(0, n).filter((w) => !FILLER.has(w)).join(' ');
    if (!name) continue;
    const hits = searchEntries(index, name, { limit: 8, strict: true });
    if (!hits.length) continue;
    const top = hits[0];
    let exact = hits.filter((h) => { const ns = namesOf(h.entry); return ns.includes(raw) || ns.includes(name); });
    // several things share the name ("Follow Amber" the plugin, "follow amber" the switch): the one that can do the verb
    // wins; an exact name that cannot do the verb yields to the one hit that can
    if (verb) {
      const can = hits.filter((h) => findAction(h.entry, verb));
      const exactCan = exact.filter((h) => can.includes(h));
      if (exactCan.length) exact = exactCan; else if (exact.length && can.length === 1) exact = can;
    }
    if (exact.length > 1 && n < content.length) { const takes = exact.filter((h) => h.entry.actions.some((a) => (a.params ?? []).length)); if (takes.length === 1) exact = takes; }
    // still several: the exact label beats an alias or synonym; then what a person means by the words: a page over a plugin over a tool
    if (exact.length > 1) { const byLabel = exact.filter((h) => [raw, name].includes(foldWords(h.entry.label))); if (byLabel.length >= 1 && byLabel.length < exact.length) exact = byLabel; }
    if (exact.length > 1) { const rank = TYPE_RANK[verb ? (VERBS.find(([re]) => re.test(verb))?.[1] ?? '') : ''] ?? TYPE_RANK['']; const best = Math.min(...exact.map((h) => rank.indexOf(h.entry.type))); const top2 = exact.filter((h) => rank.indexOf(h.entry.type) === best); if (top2.length === 1) exact = top2; }
    const chosen = exact.length === 1 ? exact[0] : exact.length > 1 ? null : hits.length === 1 || top.score - hits[1].score >= 1 ? top : null;
    if (!chosen) {
      if (n === 1 || exact.length > 1) { const cands = (exact.length > 1 ? exact : hits).slice(0, 6).map((h) => h.entry); return fail(RESOLVE_CODES.AMBIGUOUS, `"${name}" matches several: ${cands.map((e) => `${e.label} (${e.id})`).join(', ')}; say which`, { candidates: cands.map((e) => ({ id: e.id, label: e.label, type: e.type, owner: e.owner, actions: e.actions.map((a) => a.id) })) }); }
      continue;
    }
    const entry = chosen.entry;
    const value = content.slice(n).filter((w) => !FILLER.has(w));
    let action = null; let preset = {};
    if (verb) { const f = findAction(entry, verb); if (f) { action = f.action; preset = f.preset ?? {}; } }
    if (!action && value.length) { const f = findAction(entry, value[0]); if (f) { action = f.action; preset = f.preset ?? {}; value.shift(); } }
    if (!action) action = value.length ? (entry.actions.find((a) => a.id === 'set') ?? defaultAction(entry)) : defaultAction(entry);
    const given = { ...preset };
    if (action && value.length) {
      // the spoken values, in order, over the positional (else required) parameters: an enum or boolean takes the one word
      // that is one of its values, the last parameter takes everything left ("accent #ff8800" → path accent, value #ff8800)
      const slots = (action.params ?? []).filter((p) => given[p.name] === undefined).sort((a, b) => (a.position ?? 99) - (b.position ?? 99) || (b.required ? 1 : 0) - (a.required ? 1 : 0));
      const targets = slots.some((p) => p.position !== undefined) ? slots.filter((p) => p.position !== undefined) : slots.filter((p) => p.required).length ? slots.filter((p) => p.required) : slots.slice(0, 1);
      if (!targets.length) return fail(RESOLVE_CODES.VALIDATION, `${entry.label} · ${action.id} takes no value, but "${value.join(' ')}" was said`, { entry: entry.id, action: action.id, errors: [`"${value.join(' ')}" has nowhere to go`], how: { kind: 'phrase' } });
      const words = [...value];
      targets.forEach((p, i) => {
        if (!words.length) return;
        if (i === targets.length - 1) { given[p.name] = words.splice(0).join(' '); return; }
        if (p.type === 'enum' || p.type === 'boolean') { const j = words.findIndex((w) => coerceParam(p, w) !== undefined); given[p.name] = j >= 0 ? words.splice(j, 1)[0] : words.shift(); return; }
        given[p.name] = words.shift();
      });
    }
    return finish(index, entry, action, given, { kind: 'phrase', verb, name }, opts);
  }
  const candidates = candidatesOf(index, content.join(' '));
  return fail(RESOLVE_CODES.NOT_FOUND, `"${phrase}" names nothing in the registry${candidates.length ? `; closest: ${candidates.map((x) => x.label).join(', ')}` : ''}`, { candidates, gap: gapFor(phrase, 'phrase: label, alias, synonym or declared phrase') });
}

/** One door: a command object, a CLI argv list, or a phrase string. */
export function resolve(index, input, opts = {}) {
  if (Array.isArray(input)) return resolveCli(index, input, opts);
  if (isObj(input)) return input.phrase !== undefined ? resolvePhrase(index, input.phrase, opts) : input.argv !== undefined ? resolveCli(index, input.argv, opts) : resolveCommand(index, input, opts);
  return resolvePhrase(index, String(input ?? ''), opts);
}

/* ================================================================== the AI gate (pure part) */

/**
 * Whether a resolution may fall to Claude: only when nothing matched (not_found) or the match needs a model (needs_ai),
 * and the Claude setting "Make Claude available to the console" is on. Everything else is answered by the registry.
 * → { fallback: boolean, why }.
 */
export function aiGate(resolution, { available = false } = {}) {
  if (resolution?.ok) return { fallback: false, why: 'resolved deterministically' };
  const code = resolution?.code;
  if (code !== RESOLVE_CODES.NOT_FOUND && code !== RESOLVE_CODES.NEEDS_AI) return { fallback: false, why: `the registry answered ${code}: nothing for a model to add` };
  if (!available) return { fallback: false, why: 'Claude is not available to the console (Claude settings → Console control → Make Claude available to the console is off); the closest registry matches and the gap are the answer' };
  return { fallback: true, why: code === RESOLVE_CODES.NEEDS_AI ? 'the action needs a model and Claude is available to the console' : 'nothing in the registry matched and Claude is available to the console' };
}

/** What a model is handed when the gate is open: the phrase, the closest entries and their actions and parameters, and what it must answer. */
export function aiFallbackBrief(index, input, resolution) {
  const cands = (resolution?.candidates?.length ? resolution.candidates : candidatesOf(index, typeof input === 'string' ? input : isObj(input) ? String(input.phrase ?? input.id ?? '') : (input ?? []).join(' '), 8))
    .map((c) => { const e = getEntry(index, c.id); return e ? { id: e.id, label: e.label, type: e.type, actions: e.actions.map((a) => ({ id: a.id, effect: a.effect, params: (a.params ?? []).map((p) => ({ name: p.name, type: p.type, allowed: allowedWords(p), ...(p.required ? { required: true } : {}) })) })) } : null; }).filter(Boolean);
  return { $axf: 'control-registry-fallback@1', input, code: resolution?.code ?? '', message: resolution?.message ?? '', candidates: cands, answer: 'Reply with JSON { "id": <entry id>, "action": <action id>, "params": { … } } using only ids and allowed values listed here, or { "none": "<why nothing fits>" }. The registry validates the reply before anything runs.' };
}

/* ================================================================== projections (what s4-s6 wire up) */

/** The generic ways in for one entry, for the docs and the API Browser: REST, MCP, CLI, voice, deep link. */
export function surfacesOf(entry) {
  const out = {};
  for (const k of ['rest', 'mcp', 'cli']) out[k] = typeof entry.surfaces[k] === 'string' ? entry.surfaces[k] : entry.surfaces[k] === false ? null : GENERIC_SURFACES[k].replace('<id>', entry.id);
  out.state = entry.state?.read ? GENERIC_SURFACES.state.replace('<id>', entry.id) : null;
  out.voice = Array.isArray(entry.surfaces.voice) ? entry.surfaces.voice : null;
  out.deepLink = typeof entry.surfaces.deepLink === 'string' ? entry.surfaces.deepLink : entry.open?.deepLink ?? null;
  out.open = entry.open?.target ? `console_open ${entry.open.kind ?? 'screen'} ${entry.open.target}` : null;
  return out;
}

/** CLI usage for one entry, one line per action, with its parameters and allowed values. */
export function cliUsage(entry) {
  return entry.actions.map((a) => `axf ctl do ${entry.id} ${a.id}${(a.params ?? []).map((p) => (p.required ? ` --${p.name} <${allowedWords(p)}>` : ` [--${p.name} <${allowedWords(p)}>]`)).join('')}${a.confirm ? ' [--confirm <token>]' : ''}${a.needsAI ? '  (needs Claude available to the console)' : ''}`);
}
