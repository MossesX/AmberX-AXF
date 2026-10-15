/**
 * AmberX AXF build engine — programmatic API.
 * The CLI (frame.mjs) is a thin wrapper; the same functions can be driven
 * from an HTTP API, a browser UI, an SSH session or an MCP server.
 */
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const FRAMEWORK_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

export const spec = readJson(join(FRAMEWORK_DIR, 'schemas/asset-types.json'));
export const structure = readJson(join(FRAMEWORK_DIR, 'schemas/app-structure.json'));
export const defaults = readJson(join(FRAMEWORK_DIR, 'defaults.json'));
export const FRAMEWORK_VERSION = spec.frameworkVersion;

/** Directories of the framework that get baked into every new app. */
const BAKED = ['core', 'react', 'ui', 'schemas'];

/* ------------------------------------------------------------------ */
/* validation — mirrors core/validate.ts, driven by the same spec      */
/* ------------------------------------------------------------------ */

const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

export function validateAsset(raw) {
  const errors = [];
  if (!isObj(raw)) return { ok: false, errors: ['Asset must be a JSON object'] };
  for (const k of spec.envelope.required) if (!(k in raw)) errors.push(`Missing envelope field "${k}"`);
  if (raw.$axf !== spec.envelope.frame) errors.push(`"$axf" must be "${spec.envelope.frame}"`);
  const ts = spec.types[raw.type];
  if (!ts) return { ok: false, errors: [...errors, `Unknown asset type "${raw.type}"`] };
  if (typeof raw.id !== 'string' || !new RegExp(spec.envelope.idPattern).test(raw.id)) errors.push(`"id" must match ${spec.envelope.idPattern}`);
  if (typeof raw.name !== 'string' || !raw.name.trim()) errors.push('"name" must be a non-empty string');
  if (!isObj(raw.data)) return { ok: false, errors: [...errors, '"data" must be an object'] };
  for (const k of ts.required) if (!(k in raw.data)) errors.push(`data.${k} is required for ${raw.type}`);
  for (const [k, allowed] of Object.entries(ts.enums ?? {})) {
    if (k in raw.data && !allowed.includes(raw.data[k])) errors.push(`data.${k} must be one of: ${allowed.join(', ')}`);
  }
  for (const [k, keys] of Object.entries(ts.nested ?? {})) {
    if (isObj(raw.data[k])) for (const nk of keys) if (!(nk in raw.data[k])) errors.push(`data.${k}.${nk} is required`);
  }
  if (raw.type === 'uac-policy' && Array.isArray(raw.data.roles) && !raw.data.roles.some((r) => r.id === raw.data.defaultRole)) {
    errors.push('data.defaultRole must reference a role id');
  }
  return { ok: errors.length === 0, errors };
}

/** Load every *.json asset under a directory (expects <dir>/<type>/<id>.json). */
export function loadAssets(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const type of readdirSync(dir)) {
    const tdir = join(dir, type);
    if (!statSync(tdir).isDirectory()) continue;
    for (const f of readdirSync(tdir).filter((f) => f.endsWith('.json'))) {
      const file = join(tdir, f);
      let raw;
      try {
        raw = readJson(file);
      } catch (e) {
        out.push({ file, raw: null, result: { ok: false, errors: [`Invalid JSON: ${e.message}`] } });
        continue;
      }
      const result = validateAsset(raw);
      if (result.ok && raw.type !== type) result.errors.push(`File is in "${type}/" but declares type "${raw.type}"`);
      if (result.ok && raw.id !== basename(f, '.json')) result.errors.push(`File name should be "${raw.id}.json"`);
      result.ok = result.errors.length === 0;
      out.push({ file, raw, result });
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const sha = (file) => createHash('sha256').update(readFileSync(file)).digest('hex').slice(0, 16);
const TEXT = /\.(json|tsx?|jsx?|mjs|css|html|md|txt|gitignore)$/;

function copyTemplate(src, dest, tokens) {
  for (const file of walk(src)) {
    const rel = relative(src, file).replace(/^_gitignore$/, '.gitignore');
    const target = join(dest, rel);
    mkdirSync(dirname(target), { recursive: true });
    if (TEXT.test(file) || basename(file).startsWith('_')) {
      let text = readFileSync(file, 'utf8');
      for (const [k, v] of Object.entries(tokens)) text = text.replaceAll(`{{${k}}}`, v);
      writeFileSync(target, text);
    } else cpSync(file, target);
  }
}

export const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'axf-app';

/* ------------------------------------------------------------------ */
/* init                                                                */
/* ------------------------------------------------------------------ */

/**
 * Initialize a new AmberX AXF app: copy the template, bake the framework runtime
 * and every starter asset into it, write the manifest and lock file, then
 * validate the result. Every app starts from the exact same asset set, so
 * apps left on defaults look identical.
 */
export function init({ dir, name = 'AXF App', id, template = 'react-ts', targets = ['web'], log = () => {} }) {
  const dest = resolve(dir);
  if (existsSync(dest) && readdirSync(dest).length) throw new Error(`Target directory is not empty: ${dest}`);
  const tplDir = join(FRAMEWORK_DIR, 'templates', template);
  if (!existsSync(tplDir)) throw new Error(`Unknown template "${template}"`);
  const appId = id ?? slugify(name);

  log(`• copying template "${template}"`);
  copyTemplate(tplDir, dest, { APP_NAME: name, APP_ID: appId, FRAMEWORK_VERSION });

  log('• baking framework runtime into src/axf');
  const frameDir = join(dest, 'src/axf');
  for (const part of BAKED) cpSync(join(FRAMEWORK_DIR, part), join(frameDir, part), { recursive: true });

  log('• baking starter assets into src/assets');
  const assets = loadAssets(join(FRAMEWORK_DIR, 'assets'));
  const bad = assets.filter((a) => !a.result.ok);
  if (bad.length) throw new Error(`Framework assets failed validation:\n${bad.map((b) => `  ${b.file}: ${b.result.errors.join('; ')}`).join('\n')}`);
  cpSync(join(FRAMEWORK_DIR, 'assets'), join(dest, 'src/assets'), { recursive: true });

  log('• writing axf.manifest.json');
  const manifest = {
    $axf: 'manifest@1',
    app: { id: appId, name, version: '0.1.0' },
    framework: { version: FRAMEWORK_VERSION, template },
    initializedAt: new Date().toISOString(),
    targets,
    startView: 'home',
    defaults,
    structure: structure.entries.map(({ path, purpose }) => ({ path, purpose })),
  };
  writeFileSync(join(dest, 'axf.manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

  log('• writing axf.lock.json');
  const files = Object.fromEntries(walk(frameDir).map((f) => [relative(dest, f), sha(f)]));
  writeFileSync(join(dest, 'axf.lock.json'), JSON.stringify({ framework: FRAMEWORK_VERSION, files }, null, 2) + '\n');
  mkdirSync(join(dest, 'public'), { recursive: true });

  const report = validateApp(dest);
  if (!report.ok) throw new Error(`Initialized app failed validation:\n${report.errors.join('\n')}`);
  return { dir: dest, manifest, assets: assets.length, bakedFiles: Object.keys(files).length, report };
}

/* ------------------------------------------------------------------ */
/* validate                                                            */
/* ------------------------------------------------------------------ */

export function validateApp(dir) {
  const root = resolve(dir);
  const errors = [];
  const warnings = [];
  for (const e of structure.entries) {
    const p = join(root, e.path);
    if (!existsSync(p)) (e.required ? errors : warnings).push(`missing ${e.kind} ${e.path}`);
  }
  const assets = loadAssets(join(root, 'src/assets'));
  for (const a of assets) if (!a.result.ok) errors.push(`${relative(root, a.file)}: ${a.result.errors.join('; ')}`);
  const byType = {};
  for (const a of assets) if (a.result.ok) (byType[a.raw.type] ??= new Set()).add(a.raw.id);
  for (const t of Object.keys(spec.types)) if (!byType[t]?.size) errors.push(`slot "${t}" has no assets`);

  const mPath = join(root, 'axf.manifest.json');
  if (existsSync(mPath)) {
    const m = readJson(mPath);
    for (const [t, id] of Object.entries(m.defaults ?? {})) {
      if (!byType[t]?.has(id)) errors.push(`manifest default ${t} → "${id}" does not exist`);
    }
    if (m.framework?.version !== FRAMEWORK_VERSION) warnings.push(`app targets framework ${m.framework?.version}, engine is ${FRAMEWORK_VERSION}`);
  }
  const lPath = join(root, 'axf.lock.json');
  if (existsSync(lPath)) {
    const lock = readJson(lPath);
    for (const [rel, hash] of Object.entries(lock.files)) {
      const p = join(root, rel);
      if (!existsSync(p)) errors.push(`baked file removed: ${rel}`);
      else if (sha(p) !== hash) warnings.push(`baked file modified: ${rel}`);
    }
  }
  return { ok: errors.length === 0, errors, warnings, assets: assets.length };
}

/* ------------------------------------------------------------------ */
/* new-asset & schemas                                                 */
/* ------------------------------------------------------------------ */

export function newAsset({ dir, type, id, from, name }) {
  if (!spec.types[type]) throw new Error(`Unknown type "${type}". Types: ${Object.keys(spec.types).join(', ')}`);
  const assetsDir = join(resolve(dir), 'src/assets');
  const source = from ? join(assetsDir, type, `${from}.json`) : null;
  const base = source && existsSync(source) ? readJson(source) : loadAssets(assetsDir).find((a) => a.raw?.type === type)?.raw;
  if (!base) throw new Error(`No ${type} asset to start from.`);
  const asset = { ...base, id, name: name ?? id.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()), version: '0.1.0', author: undefined };
  const r = validateAsset(asset);
  if (!r.ok) throw new Error(r.errors.join('; '));
  const target = join(assetsDir, type, `${id}.json`);
  if (existsSync(target)) throw new Error(`${relative(process.cwd(), target)} already exists`);
  writeFileSync(target, JSON.stringify(asset, null, 2) + '\n');
  return target;
}

/** Emit JSON Schema files (for editor autocompletion) from the type spec. */
export function writeSchemas(outDir = join(FRAMEWORK_DIR, 'schemas/json')) {
  mkdirSync(outDir, { recursive: true });
  const written = [];
  for (const [type, ts] of Object.entries(spec.types)) {
    const props = Object.fromEntries(ts.required.map((k) => [k, ts.enums?.[k] ? { enum: ts.enums[k] } : ts.nested?.[k] ? { type: 'object', required: ts.nested[k] } : {}]));
    const schema = {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      $id: `axf/${type}.schema.json`,
      title: `AmberX AXF ${ts.label} asset`,
      type: 'object',
      required: spec.envelope.required,
      properties: {
        $axf: { const: spec.envelope.frame },
        type: { const: type },
        id: { type: 'string', pattern: spec.envelope.idPattern },
        name: { type: 'string', minLength: 1 },
        version: { type: 'string' },
        description: { type: 'string' },
        data: { type: 'object', required: ts.required, properties: props },
      },
    };
    const f = join(outDir, `${type}.schema.json`);
    writeFileSync(f, JSON.stringify(schema, null, 2) + '\n');
    written.push(f);
  }
  return written;
}
