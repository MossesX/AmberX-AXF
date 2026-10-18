import defaultRulesJson from '../schemas/project-rules.json';

/**
 * Project manifests (project.manifest.json, project-manifest@1): every project built with or for AmberX AXF has
 * one. It names the project (its `name` is the project's folder on the hub, /projects/<name>), its repo (even one
 * that doesn't exist yet), its relation to the framework and its shared data.
 *
 * No project is loaded or compiled without a manifest that passes these rules. The rules are data
 * (schemas/project-rules.json, managed in the Dev Console under Standards); this file is the reference
 * validator. core/project-check.mjs (used by the build engine, the console and project-guard.mjs) and the Kotlin
 * kernel (ai.amberx.axf.kernel.project) mirror it, and
 * spec/fixtures/project-manifest.json is the conformance contract. Self-contained on purpose: template build
 * guards import it straight from the baked framework.
 */

export const PROJECT_MANIFEST_TAG = 'project-manifest@1';
export const PROJECT_MANIFEST_FILE = 'project.manifest.json';
export const PROJECT_RULES_TAG = 'project-rules@1';

export type RuleSeverity = 'error' | 'warn' | 'off';
export type RuleOp =
  | 'equals' | 'pattern' | 'notIn' | 'string' | 'oneOf' | 'eachOneOf' | 'boolean'
  | 'relativePaths' | 'pathsExist' | 'requiredWhen' | 'knownKeys';
export const RULE_OPS: readonly RuleOp[] = ['equals', 'pattern', 'notIn', 'string', 'oneOf', 'eachOneOf', 'boolean', 'relativePaths', 'pathsExist', 'requiredWhen', 'knownKeys'];

export interface RuleCheck {
  op: RuleOp;
  path?: string;
  required?: boolean;
  value?: unknown;
  values?: unknown[];
  pattern?: string;
  vocab?: string;
  min?: number;
  max?: number;
  when?: { path: string; equals: unknown };
}

export interface ProjectRule {
  id: string;
  title: string;
  description?: string;
  severity: RuleSeverity;
  /** Locked rules are always errors and can't be removed. */
  locked?: boolean;
  check: RuleCheck;
}

export interface ProjectRules {
  $rules: string;
  manifestTag: string;
  manifestFile: string;
  vocab: Record<string, string[]>;
  knownKeys: string[];
  rules: ProjectRule[];
  ops?: Record<string, string>;
  description?: string;
}

export interface ProjectIssue {
  rule: string;
  path: string;
  message: string;
}

export interface ProjectValidation {
  ok: boolean;
  errors: ProjectIssue[];
  warnings: ProjectIssue[];
}

export interface ProjectValidateOptions {
  /** Whether a project-relative path exists. Without it, pathsExist rules are skipped. */
  exists?: (path: string) => boolean;
}

export interface ProjectManifest {
  $manifest: string;
  name: string;
  displayName: string;
  description?: string;
  kind: string;
  status?: string;
  version?: string;
  platforms?: string[];
  framework: { relation: string; version?: string; template?: string; appManifest?: string };
  repo: { host?: string; owner: string; name: string; exists: boolean; visibility?: string; defaultBranch?: string; url?: string };
  location?: { repo?: string; path?: string };
  deploy?: Record<string, unknown>;
  data?: { shared?: string[] };
  owners?: string[];
  created?: string;
  links?: Record<string, string>;
  notes?: string;
  x?: Record<string, unknown>;
}

export const DEFAULT_PROJECT_RULES = defaultRulesJson as unknown as ProjectRules;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const missing = (v: unknown) => v === undefined || v === null;
const show = (v: unknown) => (typeof v === 'string' ? `"${v}"` : JSON.stringify(v));

/** Reads a dot path ("repo.name"); "$manifest" is a plain key. */
export function manifestValue(manifest: unknown, path: string): unknown {
  let cur: unknown = manifest;
  for (const part of path.split('.')) {
    if (!isObj(cur) || !Object.prototype.hasOwnProperty.call(cur, part)) return undefined;
    cur = cur[part];
  }
  return cur;
}

function listFor(check: RuleCheck, rules: ProjectRules): unknown[] {
  if (check.vocab) return rules.vocab[check.vocab] ?? [];
  return check.values ?? [];
}

function isRelativePath(p: unknown): boolean {
  return typeof p === 'string' && p.length > 0 && !p.startsWith('/') && !p.includes('\\') && !p.split('/').includes('..') && !/^[A-Za-z]:/.test(p);
}

/** The message for a failed check, or undefined when it passes. */
function runCheck(manifest: Record<string, unknown>, check: RuleCheck, rules: ProjectRules, opts: ProjectValidateOptions): string | undefined {
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
    case 'equals':
      return value === check.value ? undefined : `${path} must be ${show(check.value)}`;
    case 'pattern':
      return typeof value === 'string' && new RegExp(check.pattern ?? '').test(value) ? undefined : `${path} must match ${check.pattern}`;
    case 'notIn':
      return (check.values ?? []).includes(value) ? `${path} can't be ${show(value)}` : undefined;
    case 'string': {
      if (typeof value !== 'string') return `${path} must be text`;
      const n = value.trim().length;
      return n < (check.min ?? 0) || n > (check.max ?? Number.MAX_SAFE_INTEGER) ? `${path} must be ${check.min ?? 0} to ${check.max ?? '∞'} characters` : undefined;
    }
    case 'oneOf': {
      const list = listFor(check, rules);
      return list.includes(value) ? undefined : `${path} must be one of ${list.map(show).join(', ')}`;
    }
    case 'eachOneOf': {
      if (!Array.isArray(value)) return `${path} must be a list`;
      const list = listFor(check, rules);
      const bad = value.filter((v) => !list.includes(v));
      return bad.length ? `${path} has ${bad.map(show).join(', ')}, not in ${list.map(show).join(', ')}` : undefined;
    }
    case 'boolean':
      return typeof value === 'boolean' ? undefined : `${path} must be true or false`;
    case 'relativePaths': {
      if (!Array.isArray(value)) return `${path} must be a list of paths`;
      const bad = value.filter((p) => !isRelativePath(p));
      return bad.length ? `${path} must be paths inside the project: ${bad.map(show).join(', ')}` : undefined;
    }
    case 'pathsExist': {
      if (!opts.exists) return undefined;
      const paths = (Array.isArray(value) ? value : [value]).filter(isRelativePath) as string[];
      const gone = paths.filter((p) => !opts.exists!(p.replace(/\/+$/, '')));
      return gone.length ? `${path}: not found in the project: ${gone.map(show).join(', ')}` : undefined;
    }
    default:
      return `unknown rule op "${String((check as RuleCheck).op)}"`;
  }
}

/** The severity a rule runs at: locked rules are always errors. */
export function ruleSeverity(rule: ProjectRule): RuleSeverity {
  return rule.locked ? 'error' : rule.severity;
}

/** Validates a project manifest against the rules (DEFAULT_PROJECT_RULES unless given). */
export function validateProjectManifest(raw: unknown, rules: ProjectRules = DEFAULT_PROJECT_RULES, opts: ProjectValidateOptions = {}): ProjectValidation {
  const errors: ProjectIssue[] = [];
  const warnings: ProjectIssue[] = [];
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

/** Problems with a rules file itself (the console checks edits with this before saving). */
export function validateProjectRules(raw: unknown, base: ProjectRules = DEFAULT_PROJECT_RULES): string[] {
  const out: string[] = [];
  if (!isObj(raw)) return ['rules must be a JSON object'];
  if (raw.$rules !== PROJECT_RULES_TAG) out.push(`"$rules" must be "${PROJECT_RULES_TAG}"`);
  if (raw.manifestTag !== PROJECT_MANIFEST_TAG) out.push(`"manifestTag" must be "${PROJECT_MANIFEST_TAG}"`);
  if (!isObj(raw.vocab) || Object.values(raw.vocab).some((v) => !Array.isArray(v) || v.some((x) => typeof x !== 'string'))) out.push('"vocab" must map names to lists of strings');
  if (!Array.isArray(raw.knownKeys) || raw.knownKeys.some((k) => typeof k !== 'string')) out.push('"knownKeys" must be a list of strings');
  if (!Array.isArray(raw.rules)) return [...out, '"rules" must be a list'];
  const seen = new Set<string>();
  const vocab = isObj(raw.vocab) ? raw.vocab : {};
  for (const r of raw.rules as unknown[]) {
    if (!isObj(r) || typeof r.id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(r.id)) { out.push('every rule needs an "id" (lowercase, digits, dashes)'); continue; }
    if (seen.has(r.id)) out.push(`rule "${r.id}" appears twice`);
    seen.add(r.id);
    if (typeof r.title !== 'string' || !r.title.trim()) out.push(`rule "${r.id}" needs a title`);
    if (!['error', 'warn', 'off'].includes(r.severity as string)) out.push(`rule "${r.id}": severity must be error, warn or off`);
    const c = r.check;
    if (!isObj(c) || !RULE_OPS.includes(c.op as RuleOp)) { out.push(`rule "${r.id}": check.op must be one of ${RULE_OPS.join(', ')}`); continue; }
    if (c.op !== 'knownKeys' && typeof c.path !== 'string') out.push(`rule "${r.id}": check.path is required`);
    if (c.op === 'pattern') { try { new RegExp(String(c.pattern)); } catch { out.push(`rule "${r.id}": check.pattern is not a valid pattern`); } }
    if ((c.op === 'oneOf' || c.op === 'eachOneOf') && !(typeof c.vocab === 'string' ? c.vocab in vocab : Array.isArray(c.values))) out.push(`rule "${r.id}": needs check.vocab (a vocab name) or check.values`);
    if (c.op === 'requiredWhen' && !(isObj(c.when) && typeof c.when.path === 'string')) out.push(`rule "${r.id}": needs check.when.path and check.when.equals`);
  }
  // Locked rules of the framework's own rules file can't be removed or loosened.
  const ids = new Map((raw.rules as Record<string, unknown>[]).filter(isObj).map((r) => [r.id, r]));
  for (const locked of base.rules.filter((r) => r.locked)) {
    const r = ids.get(locked.id);
    if (!r) out.push(`locked rule "${locked.id}" can't be removed`);
    else if (r.locked !== true || JSON.stringify(r.check) !== JSON.stringify(locked.check)) out.push(`locked rule "${locked.id}" can't be changed`);
  }
  return out;
}

/** One line per problem, for build logs and refusals. */
export function formatProjectValidation(v: ProjectValidation, where = PROJECT_MANIFEST_FILE): string {
  const lines = [
    ...v.errors.map((e) => `✗ ${where}: ${e.message} [${e.rule}]`),
    ...v.warnings.map((w) => `! ${where}: ${w.message} [${w.rule}]`),
  ];
  return lines.join('\n');
}

/** A Vite plugin for app templates: refuses to serve or build an app whose project manifest fails validation. */
export function axfProjectGuard(options: { root?: string; read: (file: string) => string | undefined; exists?: (path: string) => boolean; rules?: ProjectRules }) {
  return {
    name: 'axf-project-guard',
    enforce: 'pre' as const,
    buildStart() {
      const text = options.read(PROJECT_MANIFEST_FILE);
      if (text === undefined) throw new Error(`AXF: no ${PROJECT_MANIFEST_FILE} in ${options.root ?? 'this app'}. A project can't be loaded or compiled without a validated manifest (axf project init).`);
      let raw: unknown;
      try { raw = JSON.parse(text); } catch (e) { throw new Error(`AXF: ${PROJECT_MANIFEST_FILE} is not valid JSON (${(e as Error).message})`); }
      const v = validateProjectManifest(raw, options.rules ?? DEFAULT_PROJECT_RULES, { exists: options.exists });
      if (!v.ok) throw new Error(`AXF: the project manifest failed validation, so this project can't be loaded or compiled:\n${formatProjectValidation(v)}`);
      if (v.warnings.length) console.warn(formatProjectValidation(v));
    },
  };
}
