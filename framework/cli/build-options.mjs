/**
 * Build options — the `--switches` every UI build accepts (CLI, engine-rpc, `axf serve`, console API/UI, console MCP).
 *
 * The list lives in framework/schemas/build-options.json. Each option writes a token into the app's assets
 * (for example --wrap-groups → style-theme `wrapGroups`), so both ports' engines read it like any other token.
 *
 *   resolveOptions(input)            normalize { 'wrap-groups': 'on' } / { wrapGroups: true } / CLI flags → { 'wrap-groups': true }
 *   applyOptions(assetsDir, values)  write the tokens into every asset of the target type; returns the files changed
 *   readOptions(assetsDir)           current value of every option in an asset folder
 *   OPTIONS                          the registry
 *
 * New builds get every option at its default (off unless the registry says otherwise), even when the
 * framework's own starter assets have it on.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REGISTRY = resolve(HERE, '../schemas/build-options.json');

export const OPTIONS = JSON.parse(readFileSync(REGISTRY, 'utf8')).options;

const camel = (s) => s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());

/** 'on' | 'off' | true | false | 'true' | '1' … → boolean; throws on anything else. */
function toBool(v, name) {
  if (typeof v === 'boolean') return v;
  const s = String(v).trim().toLowerCase();
  if (['', 'on', 'true', '1', 'yes', 'enable', 'enabled'].includes(s)) return true;
  if (['off', 'false', '0', 'no', 'disable', 'disabled'].includes(s)) return false;
  throw new Error(`--${name} takes on|off (got "${v}")`);
}

/**
 * Pick build options out of any input shape: CLI flags ({ 'wrap-groups': true, 'no-wrap-groups': true }),
 * an options object ({ 'wrap-groups': 'off' } or { wrapGroups: false }). Only options actually given are returned.
 */
export function pickOptions(input = {}) {
  const out = {};
  for (const [name, spec] of Object.entries(OPTIONS)) {
    let v;
    if (name in input) v = input[name];
    else if (camel(name) in input) v = input[camel(name)];
    else if (`no-${name}` in input && input[`no-${name}`] !== false) v = false;
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) v = v[v.length - 1];
    out[name] = spec.type === 'boolean' ? toBool(v, name) : v;
  }
  return out;
}

/** Every option filled in: given values over registry defaults. */
export function resolveOptions(input = {}) {
  return { ...Object.fromEntries(Object.entries(OPTIONS).map(([n, s]) => [n, s.default])), ...pickOptions(input) };
}

function assetFiles(assetsDir, type) {
  const dir = join(assetsDir, type);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => join(dir, f));
}

/** Write each given option's token into every asset of its target type. Returns the changed files. */
export function applyOptions(assetsDir, values, log = () => {}) {
  const changed = [];
  for (const [name, value] of Object.entries(values)) {
    const spec = OPTIONS[name];
    if (!spec) throw new Error(`Unknown build option --${name}. Options: ${Object.keys(OPTIONS).map((o) => `--${o}`).join(', ')}`);
    const { assetType, field } = spec.token;
    for (const file of assetFiles(assetsDir, assetType)) {
      const text = readFileSync(file, 'utf8');
      const a = JSON.parse(text);
      if (a.type !== assetType || typeof a.data !== 'object' || a.data === null) continue;
      if (a.data[field] === value) continue;
      a.data[field] = value;
      writeFileSync(file, JSON.stringify(a, null, 2) + '\n');
      changed.push(file);
    }
    log(`• --${name} ${typeof value === 'boolean' ? (value ? 'on' : 'off') : value} → ${assetType}.${field}`);
  }
  return changed;
}

/** Current value per option: true/false when every target asset agrees, 'mixed' otherwise, default when unset. */
export function readOptions(assetsDir) {
  const out = {};
  for (const [name, spec] of Object.entries(OPTIONS)) {
    const { assetType, field } = spec.token;
    const vals = new Set(assetFiles(assetsDir, assetType).map((f) => { const d = JSON.parse(readFileSync(f, 'utf8')).data ?? {}; return field in d ? d[field] : spec.default; }));
    out[name] = vals.size === 0 ? spec.default : vals.size === 1 ? [...vals][0] : 'mixed';
  }
  return out;
}

/** One line per option for `axf options` / help text. */
export function describeOptions() {
  return Object.entries(OPTIONS).map(([n, s]) => ({ flag: `--${n}`, label: s.label, description: s.description, type: s.type, default: s.default, token: `${s.token.assetType}.${s.token.field}` }));
}
