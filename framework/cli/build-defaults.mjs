#!/usr/bin/env node
/**
 * Build-engine default rules (build-defaults@1, framework/schemas/build-defaults.json; Brett, Oct 23 2026).
 *
 * Whenever the build engine builds something (a plugin, an app, a dialog) it applies the rules that exist for that kind,
 * by itself, so a default never depends on Claude remembering it:
 *   op "default"  the field is missing → it is filled with `value` (and noted)
 *   op "require"  the field is missing or not allowed → the build is refused (problems)
 * Rules pick what they apply to with `when` (open registry CONDITIONS below). Used by plugins.mjs --check (CI),
 * plugin-lifecycle install, plugin-catalog pack / install, axf init and the console's plugin loader (Python twin
 * apps/console-web/server/build_defaults.py, same file, same results; test.py there replays this file's cases).
 *
 *   node framework/cli/build-defaults.mjs rules                    the rules, one per line
 *   node framework/cli/build-defaults.mjs check [--kind plugin]    every console plugin against the rules (exit 1 on problems)
 *   node framework/cli/build-defaults.mjs apply [--write]          fill missing defaults in every plugin.json (dry run without --write)
 *   add --json for one JSON result
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(process.env.AXF_ROOT || join(dirname(fileURLToPath(import.meta.url)), '../..'));
// the rules ship with the framework (this file's own checkout), whatever AXF_ROOT points the plugin folders at
export const RULES_FILE = join(dirname(fileURLToPath(import.meta.url)), '../schemas/build-defaults.json');

let cached = null;
export function loadRules(file = RULES_FILE) {
  if (file === RULES_FILE && cached) return cached;
  const r = JSON.parse(readFileSync(file, 'utf8'));
  if (r.$axf !== 'build-defaults@1') throw new Error(`${file} is not build-defaults@1`);
  if (file === RULES_FILE) cached = r;
  return r;
}

const uiRefs = (m) => (Array.isArray(m?.provides) ? m.provides : []).filter((p) => typeof p === 'string' && /^(view|dialog):/.test(p));

/** Open registry of `when` conditions: (thing, kind) → does the rule apply. */
export const CONDITIONS = {
  always: () => true,
  hasUi: (m) => uiRefs(m).length > 0,
  noUi: (m) => uiRefs(m).length === 0,
};

export function getPath(o, path) { return path.split('.').reduce((v, k) => (v && typeof v === 'object' ? v[k] : undefined), o); }
function setPath(o, path, value) {
  const keys = path.split('.');
  let cur = o;
  for (const k of keys.slice(0, -1)) { if (!cur[k] || typeof cur[k] !== 'object' || Array.isArray(cur[k])) cur[k] = {}; cur = cur[k]; }
  cur[keys.at(-1)] = value;
}

/** The values a rule allows (`values`, or a list named by `valuesFrom`), null = anything. */
function allowed(rule, rules) {
  if (Array.isArray(rule.values)) return rule.values;
  if (rule.valuesFrom && Array.isArray(rules[rule.valuesFrom])) return rules[rule.valuesFrom];
  return null;
}

/**
 * Apply every rule of `kind` to `thing` (not changed: the result is a copy).
 * → { value, filled: [{rule, field, value}], problems: [{rule, field, message}] }
 */
export function applyDefaults(kind, thing, rules = loadRules()) {
  if (!rules.kinds?.[kind]) throw new Error(`build-defaults: unknown kind "${kind}" (kinds: ${Object.keys(rules.kinds ?? {}).join(', ')})`);
  const value = structuredClone(thing ?? {});
  const filled = [];
  const problems = [];
  for (const rule of rules.rules ?? []) {
    if (rule.kind !== kind) continue;
    const cond = CONDITIONS[rule.when ?? 'always'];
    if (!cond) { problems.push({ rule: rule.id, field: rule.field, message: `unknown condition "${rule.when}"` }); continue; }
    if (!cond(value, kind)) continue;
    const have = getPath(value, rule.field);
    const ok = allowed(rule, rules);
    if (have === undefined || have === null || have === '') {
      if (rule.op === 'default') { setPath(value, rule.field, structuredClone(rule.value)); filled.push({ rule: rule.id, field: rule.field, value: rule.value }); }
      else if (rule.op === 'require') problems.push({ rule: rule.id, field: rule.field, message: `"${rule.field}" is required: ${rule.description}` });
      continue;
    }
    if (ok && !ok.includes(have)) problems.push({ rule: rule.id, field: rule.field, message: `"${rule.field}" is ${JSON.stringify(have)}; allowed: ${ok.map((x) => JSON.stringify(x)).join(', ')}` });
    else if (rule.pattern && (typeof have !== 'string' || !new RegExp(rule.pattern).test(have))) problems.push({ rule: rule.id, field: rule.field, message: `"${rule.field}" is ${JSON.stringify(have)}; expected ${rule.pattern}` });
  }
  return { value, filled, problems };
}

/** Apply and refuse: the filled thing, or an Error listing what is wrong. What the installers call. */
export function enforceDefaults(kind, thing, label = kind, rules = loadRules()) {
  const r = applyDefaults(kind, thing, rules);
  if (r.problems.length) throw new Error(`${label}: ${r.problems.map((p) => p.message).join('; ')}`);
  return r;
}

/** Fill a plugin.json on disk (keeps key order, adds missing keys at the end). → { file, filled, problems, written } */
export function applyToPluginFile(file, { write = false } = {}) {
  const m = JSON.parse(readFileSync(file, 'utf8'));
  const r = applyDefaults('plugin', m);
  const written = write && r.filled.length > 0 && r.problems.length === 0;
  if (written) {
    // Top-level fields go in as new lines before the closing brace, so the file keeps its own layout; a nested field
    // rewrites the file.
    const text = readFileSync(file, 'utf8');
    const flat = r.filled.every((f) => !f.field.includes('.'));
    const end = text.trimEnd().lastIndexOf('}');
    const next = flat && end > 0
      ? `${text.slice(0, end).trimEnd()},\n${r.filled.map((f) => `  ${JSON.stringify(f.field)}: ${JSON.stringify(f.value)}`).join(',\n')}\n}\n`
      : `${JSON.stringify(r.value, null, 2)}\n`;
    JSON.parse(next);
    writeFileSync(file, next);
  }
  return { file, filled: r.filled, problems: r.problems, written };
}

export function consolePluginFiles(root = ROOT) {
  const dir = join(root, 'apps/console-web/plugins');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => !f.startsWith('.') && !f.startsWith('_') && existsSync(join(dir, f, 'plugin.json'))).map((f) => join(dir, f, 'plugin.json'));
}

async function main(argv) {
  const json = argv.includes('--json');
  const [cmd = 'check'] = argv.filter((a) => !a.startsWith('--'));
  const rules = loadRules();
  const out = (o) => console.log(JSON.stringify({ ok: true, ...o }, null, json ? 0 : 2));
  if (cmd === 'rules') {
    if (json) return out({ rules: rules.rules, kinds: rules.kinds });
    for (const r of rules.rules) console.log(`${r.kind.padEnd(7)} ${r.op.padEnd(8)} ${r.field.padEnd(18)} ${r.id}${r.locked ? ' (locked)' : ''}: ${r.description}`);
    return;
  }
  if (cmd === 'check' || cmd === 'apply') {
    const write = cmd === 'apply' && argv.includes('--write');
    const results = consolePluginFiles().map((f) => {
      const rel = f.slice(ROOT.length + 1);
      // templates are filled like every plugin (new plugins start from them), but checked the same way
      return { ...applyToPluginFile(f, { write }), file: rel };
    });
    const missing = results.filter((r) => r.filled.length && !r.written);
    const bad = results.filter((r) => r.problems.length);
    if (json) out({ results, missingDefaults: missing.length, problems: bad.length });
    else {
      for (const r of results) {
        for (const f of r.filled) console.log(`${r.written ? 'filled' : cmd === 'apply' ? 'would fill' : '✗ missing'} ${r.file}: ${f.field} = ${JSON.stringify(f.value)} (${f.rule})`);
        for (const p of r.problems) console.error(`✗ ${r.file}: ${p.message} (${p.rule})`);
      }
      if (!missing.length && !bad.length) console.log(`✓ ${results.length} plugin manifests follow every build-default rule (${rules.rules.filter((x) => x.kind === 'plugin').length} plugin rules)`);
    }
    // check: a missing default in a checked-in plugin.json is a problem too (the engine fills it; commit the filled file)
    if (bad.length || (cmd === 'check' && missing.length)) process.exitCode = 1;
    return;
  }
  console.error('usage: build-defaults.mjs rules | check | apply [--write] [--json]');
  process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main(process.argv.slice(2));
