/**
 * project-check — the JavaScript copy of the project-manifest validator (mirrors core/project.ts rule for rule;
 * spec/fixtures/project-manifest.json is the contract). Dependency-free and baked into every app with the rest of
 * core/, so the build engine (cli/project.mjs), the Dev Console and app build guards (project-guard.mjs) all run
 * the same checks. Rules are passed in: the caller decides which rules file is in force.
 */
export const PROJECT_MANIFEST_TAG = 'project-manifest@1';
export const PROJECT_MANIFEST_FILE = 'project.manifest.json';
export const PROJECT_RULES_TAG = 'project-rules@1';
/** Rule patterns are editable, so they are kept simple: at most this long, no nested quantifiers (catastrophic backtracking). */
export const MAX_RULE_PATTERN = 200;
/** Values longer than this never match a pattern rule (no regex runs on them). */
export const MAX_PATTERN_INPUT = 300;
const NESTED_QUANTIFIER = /\((?:[^()\\]|\\.)*[+*}|](?:[^()\\]|\\.)*\)\s*[+*{]/;
/** Why a rule pattern is refused, or undefined when it is fine. */
export function patternProblem(pattern) {
  if (typeof pattern !== 'string') return 'check.pattern must be text';
  if (pattern.length > MAX_RULE_PATTERN) return `check.pattern can be at most ${MAX_RULE_PATTERN} characters`;
  if (NESTED_QUANTIFIER.test(pattern) || /\\[1-9]/.test(pattern)) return 'check.pattern has a nested quantifier, a repeated alternation or a back-reference (too slow to run safely)';
  try { new RegExp(pattern); } catch { return 'check.pattern is not a valid pattern'; }
  return undefined;
}
export const RULE_OPS = ['equals', 'pattern', 'notIn', 'string', 'oneOf', 'eachOneOf', 'boolean', 'relativePaths', 'pathsExist', 'requiredWhen', 'knownKeys'];

const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const missing = (v) => v === undefined || v === null;
const show = (v) => (typeof v === 'string' ? `"${v}"` : JSON.stringify(v));

export function manifestValue(manifest, path) {
  let cur = manifest;
  for (const part of path.split('.')) {
    if (!isObj(cur) || !Object.prototype.hasOwnProperty.call(cur, part)) return undefined;
    cur = cur[part];
  }
  return cur;
}

const listFor = (check, rules) => (check.vocab ? rules.vocab[check.vocab] ?? [] : check.values ?? []);
const isRelativePath = (p) => typeof p === 'string' && p.length > 0 && !p.startsWith('/') && !p.includes('\\') && !p.split('/').includes('..') && !/^[A-Za-z]:/.test(p);

function runCheck(manifest, check, rules, opts) {
  const path = check.path ?? '';
  if (check.op === 'knownKeys') {
    const extra = Object.keys(manifest).filter((k) => !rules.knownKeys.includes(k));
    return extra.length ? `unknown field(s) ${extra.map(show).join(', ')}; put extensions under "x"` : undefined;
  }
  const value = manifestValue(manifest, path);
  if (check.op === 'requiredWhen') {
    const w = check.when;
    if (!w) return undefined;
    return manifestValue(manifest, w.path) === w.equals && missing(value) ? `${path} is required when ${w.path} is ${show(w.equals)}` : undefined;
  }
  if (missing(value)) return check.required ? `${path} is required` : undefined;
  switch (check.op) {
    case 'equals': return value === check.value ? undefined : `${path} must be ${show(check.value)}`;
    case 'pattern': return typeof value === 'string' && value.length <= MAX_PATTERN_INPUT && new RegExp(check.pattern ?? '').test(value) ? undefined : `${path} must match ${check.pattern}`;
    case 'notIn': return (check.values ?? []).includes(value) ? `${path} can't be ${show(value)}` : undefined;
    case 'string': {
      if (typeof value !== 'string') return `${path} must be text`;
      const n = value.trim().length;
      return n < (check.min ?? 0) || n > (check.max ?? Number.MAX_SAFE_INTEGER) ? `${path} must be ${check.min ?? 0} to ${check.max ?? '∞'} characters` : undefined;
    }
    case 'oneOf': { const list = listFor(check, rules); return list.includes(value) ? undefined : `${path} must be one of ${list.map(show).join(', ')}`; }
    case 'eachOneOf': {
      if (!Array.isArray(value)) return `${path} must be a list`;
      const list = listFor(check, rules);
      const bad = value.filter((v) => !list.includes(v));
      return bad.length ? `${path} has ${bad.map(show).join(', ')}, not in ${list.map(show).join(', ')}` : undefined;
    }
    case 'boolean': return typeof value === 'boolean' ? undefined : `${path} must be true or false`;
    case 'relativePaths': {
      if (!Array.isArray(value)) return `${path} must be a list of paths`;
      const bad = value.filter((p) => !isRelativePath(p));
      return bad.length ? `${path} must be paths inside the project: ${bad.map(show).join(', ')}` : undefined;
    }
    case 'pathsExist': {
      if (!opts.exists) return undefined;
      const paths = (Array.isArray(value) ? value : [value]).filter(isRelativePath);
      const gone = paths.filter((p) => !opts.exists(p.replace(/\/+$/, '')));
      return gone.length ? `${path}: not found in the project: ${gone.map(show).join(', ')}` : undefined;
    }
    default: return `unknown rule op "${String(check.op)}"`;
  }
}

export const ruleSeverity = (rule) => (rule.locked ? 'error' : rule.severity);

/** Mirrors validateProjectManifest in core/project.ts. */
export function validateProjectManifest(raw, rules, opts = {}) {
  const errors = [], warnings = [];
  if (!isObj(raw)) return { ok: false, errors: [{ rule: 'manifest-object', path: '', message: `${rules.manifestFile} must be a JSON object` }], warnings };
  for (const rule of rules.rules) {
    const severity = ruleSeverity(rule);
    if (severity === 'off') continue;
    const message = runCheck(raw, rule.check, rules, opts);
    if (message === undefined) continue;
    (severity === 'error' ? errors : warnings).push({ rule: rule.id, path: rule.check.path ?? '', message });
  }
  return { ok: errors.length === 0, errors, warnings };
}

/** Mirrors validateProjectRules in core/project.ts. */
export function validateProjectRules(raw, base) {
  const out = [];
  if (!isObj(raw)) return ['rules must be a JSON object'];
  if (raw.$rules !== PROJECT_RULES_TAG) out.push(`"$rules" must be "${PROJECT_RULES_TAG}"`);
  if (raw.manifestTag !== PROJECT_MANIFEST_TAG) out.push(`"manifestTag" must be "${PROJECT_MANIFEST_TAG}"`);
  if (!isObj(raw.vocab) || Object.values(raw.vocab).some((v) => !Array.isArray(v) || v.some((x) => typeof x !== 'string' || !/^[a-z0-9][a-z0-9-]{0,40}$/.test(x)))) out.push('"vocab" must map names to lists of short lowercase words (letters, digits, dashes)');
  if (!Array.isArray(raw.knownKeys) || raw.knownKeys.some((k) => typeof k !== 'string')) out.push('"knownKeys" must be a list of strings');
  if (!Array.isArray(raw.rules)) return [...out, '"rules" must be a list'];
  const seen = new Set();
  const vocab = isObj(raw.vocab) ? raw.vocab : {};
  for (const r of raw.rules) {
    if (!isObj(r) || typeof r.id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(r.id)) { out.push('every rule needs an "id" (lowercase, digits, dashes)'); continue; }
    if (seen.has(r.id)) out.push(`rule "${r.id}" appears twice`);
    seen.add(r.id);
    if (typeof r.title !== 'string' || !r.title.trim()) out.push(`rule "${r.id}" needs a title`);
    if (!['error', 'warn', 'off'].includes(r.severity)) out.push(`rule "${r.id}": severity must be error, warn or off`);
    const c = r.check;
    if (!isObj(c) || !RULE_OPS.includes(c.op)) { out.push(`rule "${r.id}": check.op must be one of ${RULE_OPS.join(', ')}`); continue; }
    if (c.op !== 'knownKeys' && typeof c.path !== 'string') out.push(`rule "${r.id}": check.path is required`);
    if (c.op === 'pattern') { const why = patternProblem(c.pattern); if (why) out.push(`rule "${r.id}": ${why}`); }
    if ((c.op === 'oneOf' || c.op === 'eachOneOf') && !(typeof c.vocab === 'string' ? c.vocab in vocab : Array.isArray(c.values))) out.push(`rule "${r.id}": needs check.vocab (a vocab name) or check.values`);
    if (c.op === 'requiredWhen' && !(isObj(c.when) && typeof c.when.path === 'string')) out.push(`rule "${r.id}": needs check.when.path and check.when.equals`);
  }
  const ids = new Map(raw.rules.filter(isObj).map((r) => [r.id, r]));
  for (const locked of (base?.rules ?? []).filter((r) => r.locked)) {
    const r = ids.get(locked.id);
    if (!r) out.push(`locked rule "${locked.id}" can't be removed`);
    else if (r.locked !== true || JSON.stringify(r.check) !== JSON.stringify(locked.check)) out.push(`locked rule "${locked.id}" can't be changed`);
  }
  return out;
}

export function formatProjectValidation(v, where = PROJECT_MANIFEST_FILE) {
  return [...v.errors.map((e) => `✗ ${where}: ${e.message} [${e.rule}]`), ...v.warnings.map((w) => `! ${where}: ${w.message} [${w.rule}]`)].join('\n');
}

/** JSON Schema (2020-12) for editors, generated from the rules so it never drifts from them. */
export function jsonSchema(rules = baseRules()) {
  const schema = { $schema: 'https://json-schema.org/draft/2020-12/schema', $id: 'https://axf.amberxai.com/schemas/project-manifest.schema.json', title: 'AXF project manifest (project-manifest@1)', description: 'Generated from framework/schemas/project-rules.json. Errors here are hints; the rules are what the build engine enforces.', type: 'object', required: [], properties: {} };
  const node = (path) => {
    let cur = schema;
    const parts = path.split('.');
    for (const [i, p] of parts.entries()) {
      cur.properties ??= {};
      cur.properties[p] ??= i < parts.length - 1 ? { type: 'object', properties: {} } : {};
      if (i < parts.length - 1) cur = cur.properties[p];
      else return { parent: cur, key: p, node: cur.properties[p] };
    }
  };
  for (const r of rules.rules) {
    const c = r.check;
    if (!c.path || ruleSeverity(r) === 'off') continue;
    const { parent, key, node: n } = node(c.path);
    if (c.required) { parent.required ??= []; if (!parent.required.includes(key)) parent.required.push(key); }
    n.description ??= r.description;
    if (c.op === 'equals') n.const = c.value;
    if (c.op === 'pattern') { n.type = 'string'; n.pattern = c.pattern; }
    if (c.op === 'string') { n.type = 'string'; n.minLength = c.min; n.maxLength = c.max; }
    if (c.op === 'oneOf') n.enum = listFor(c, rules);
    if (c.op === 'eachOneOf') { n.type = 'array'; n.items = { enum: listFor(c, rules) }; }
    if (c.op === 'boolean') n.type = 'boolean';
    if (c.op === 'relativePaths') { n.type = 'array'; n.items = { type: 'string' }; }
  }
  for (const k of rules.knownKeys) schema.properties[k] ??= {};
  return schema;
}
