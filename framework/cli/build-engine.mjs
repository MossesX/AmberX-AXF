/**
 * AmberX AXF build engine — programmatic API.
 * The CLI (frame.mjs) is a thin wrapper; the same functions can be driven
 * from an HTTP API, a browser UI, an SSH session or an MCP server.
 */
import { installLibrary } from './libraries.mjs';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const FRAMEWORK_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

export const spec = readJson(join(FRAMEWORK_DIR, 'schemas/asset-types.json'));
/** Port-specific asset types (android first) layered on the shared spec. They are optional slots: validation never requires them. */
const ANDROID_SPEC = join(FRAMEWORK_DIR, 'schemas/asset-types.android.json');
if (existsSync(ANDROID_SPEC)) {
  for (const [id, t] of Object.entries(readJson(ANDROID_SPEC).types)) spec.types[id] ??= { ...t, optional: true };
}
export const structure = readJson(join(FRAMEWORK_DIR, 'schemas/app-structure.json'));

/* ------------------------------------------------------------------ */
/* templates — each template dir carries a template.json describing     */
/* what to bake, where assets go and the app structure it produces      */
/* ------------------------------------------------------------------ */

export function listTemplates() {
  const dir = join(FRAMEWORK_DIR, 'templates');
  return readdirSync(dir).filter((d) => existsSync(join(dir, d, 'template.json'))).map((d) => ({ id: d, ...readJson(join(dir, d, 'template.json')) }));
}

export function templateInfo(id) {
  const file = join(FRAMEWORK_DIR, 'templates', id, 'template.json');
  if (!existsSync(file)) throw new Error(`Unknown template "${id}". Templates: ${listTemplates().map((t) => t.id).join(', ')}`);
  const t = readJson(file);
  return {
    id,
    label: t.label ?? id,
    kind: t.kind ?? 'app',
    targets: t.targets ?? ['web'],
    bake: t.bake ?? [],
    bakeInto: t.bakeInto ?? 'src/axf',
    assetsDir: t.assetsDir ?? 'src/assets',
    structure: t.structure ?? structure.entries,
    tokens: t.tokens ?? {},
    /** extra asset folders (relative to framework/) merged on top of framework/assets — port-specific types live there */
    extraAssets: t.extraAssets ?? [],
    next: t.next ?? '',
  };
}
export const defaults = readJson(join(FRAMEWORK_DIR, 'defaults.json'));
export const FRAMEWORK_VERSION = spec.frameworkVersion;

/** Directories of the framework that the react-ts template bakes into every new app (template.json → bake). */
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
const TEXT = /\.(json|tsx?|jsx?|mjs|css|html|md|txt|gitignore|kts?|xml|pro|properties|toml)$/;

function copyTemplate(src, dest, tokens) {
  for (const file of walk(src)) {
    // `src/main/kotlin/app/…` in a template lands at the app's real package path.
    const rel = relative(src, file).replace(/^_gitignore$/, '.gitignore').replace(/^(app\/src\/main\/kotlin\/)app\//, (_, pre) => pre + (tokens.APPLICATION_ID ?? 'app').replace(/\./g, '/') + '/');
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
export function init({ dir, name = 'AXF App', id, template = 'react-ts', targets, applicationId, modules = [], boilerplate, libraries = [], log = () => {} }) {
  const dest = resolve(dir);
  if (existsSync(dest) && readdirSync(dest).length) throw new Error(`Target directory is not empty: ${dest}`);
  const tpl = templateInfo(template);
  const tplDir = join(FRAMEWORK_DIR, 'templates', template);
  const appId = id ?? slugify(name);
  targets ??= tpl.targets;
  const pkg = applicationId ?? `ai.amberx.axf.${appId.replace(/-/g, '')}`;
  const bp = boilerplate ? loadBoilerplate(boilerplate) : null;
  if (bp) { modules = [...new Set([...modules, ...(bp.modules ?? [])])]; libraries = [...(bp.libraries ?? []).map((l) => (typeof l === 'string' ? { library: l } : l)), ...libraries]; }
  const tokens = { APP_NAME: name, APP_ID: appId, APPLICATION_ID: pkg, FRAMEWORK_VERSION, AXF_MODULES: JSON.stringify(modules), ...tpl.tokens };

  log(`• copying template "${template}"`);
  copyTemplate(tplDir, dest, tokens);
  const tplJson = join(dest, 'template.json');
  if (existsSync(tplJson)) rmSync(tplJson);

  let files = {};
  if (tpl.bake.length) {
    log(`• baking framework runtime into ${tpl.bakeInto}`);
    const frameDir = join(dest, tpl.bakeInto);
    for (const part of tpl.bake) cpSync(join(FRAMEWORK_DIR, part), join(frameDir, part), { recursive: true });
    files = Object.fromEntries(walk(frameDir).map((f) => [relative(dest, f), sha(f)]));
  }

  log(`• baking starter assets into ${tpl.assetsDir}`);
  const assets = loadAssets(join(FRAMEWORK_DIR, 'assets'));
  const bad = assets.filter((a) => !a.result.ok);
  if (bad.length) throw new Error(`Framework assets failed validation:\n${bad.map((b) => `  ${b.file}: ${b.result.errors.join('; ')}`).join('\n')}`);
  cpSync(join(FRAMEWORK_DIR, 'assets'), join(dest, tpl.assetsDir), { recursive: true });
  for (const extra of tpl.extraAssets) if (existsSync(join(FRAMEWORK_DIR, extra))) cpSync(join(FRAMEWORK_DIR, extra), join(dest, tpl.assetsDir), { recursive: true });

  log('• writing axf.manifest.json');
  const manifest = {
    $axf: 'manifest@1',
    app: { id: appId, name, version: '0.1.0' },
    framework: { version: FRAMEWORK_VERSION, template },
    initializedAt: new Date().toISOString(),
    targets,
    startView: bp?.screens?.[0]?.id ?? 'home',
    defaults: { ...defaults, ...(bp?.defaults ?? {}) },
    structure: tpl.structure.map(({ path, purpose }) => ({ path, purpose })),
  };
  if (bp) manifest.boilerplate = { id: bp.id, name: bp.name, category: bp.category, screens: bp.screens, features: bp.features ?? [] };
  if (targets.includes('android')) manifest.android = { applicationId: pkg, scheme: 'axf', modules, minSdk: 26, targetSdk: 35 };
  const manifestText = JSON.stringify(manifest, null, 2) + '\n';
  writeFileSync(join(dest, 'axf.manifest.json'), manifestText);
  // Android apps also carry the manifest inside the APK assets so the kernel can read it at runtime.
  if (tpl.kind === 'android-app') {
    const inApk = join(dest, dirname(tpl.assetsDir), 'axf.manifest.json');
    mkdirSync(dirname(inApk), { recursive: true });
    writeFileSync(inApk, manifestText);
  }

  if (bp) applyBoilerplate(dest, tpl, bp, log);

  // Pre-build configuration: libraries chosen in the console / boilerplate are installed with their parameters.
  const installed = [];
  for (const l of libraries) {
    log(`• installing library ${l.library}`);
    installed.push(installLibrary({ dir: dest, library: l.library, params: l.params ?? {}, log }));
  }

  log('• writing axf.lock.json');
  writeFileSync(join(dest, 'axf.lock.json'), JSON.stringify({ framework: FRAMEWORK_VERSION, template, files }, null, 2) + '\n');
  if (tpl.kind !== 'android-app') mkdirSync(join(dest, 'public'), { recursive: true });

  const report = validateApp(dest);
  if (!report.ok) throw new Error(`Initialized app failed validation:\n${report.errors.join('\n')}`);
  return { dir: dest, manifest: installed.length ? readJson(join(dest, 'axf.manifest.json')) : manifest, assets: assets.length, bakedFiles: Object.keys(files).length, libraries: installed.map((i) => ({ library: i.library, config: i.config })), report, next: tpl.next };
}

/* ------------------------------------------------------------------ */
/* validate                                                            */
/* ------------------------------------------------------------------ */

/** `app/src/main/kotlin/app/…` placeholder paths → the app's real package path (Android apps). */
export function pkgPath(root, p) {
  const mPath = join(root, 'axf.manifest.json');
  const pkg = existsSync(mPath) ? readJson(mPath).android?.applicationId : null;
  return pkg ? p.replace(/^app\/src\/main\/kotlin\/app(\/|$)/, `app/src/main/kotlin/${pkg.replace(/\./g, '/')}$1`) : p;
}

export function appTemplate(root) {
  const mPath = join(root, 'axf.manifest.json');
  const id = existsSync(mPath) ? readJson(mPath).framework?.template : undefined;
  try { return templateInfo(id ?? 'react-ts'); } catch { return templateInfo('react-ts'); }
}

export function validateApp(dir) {
  const root = resolve(dir);
  const errors = [];
  const warnings = [];
  const tpl = appTemplate(root);
  for (const e of tpl.structure) {
    const p = join(root, pkgPath(root, e.path));
    if (!existsSync(p)) (e.required ? errors : warnings).push(`missing ${e.kind} ${relative(root, p)}`);
  }
  const assets = loadAssets(join(root, tpl.assetsDir));
  for (const a of assets) if (!a.result.ok) errors.push(`${relative(root, a.file)}: ${a.result.errors.join('; ')}`);
  const byType = {};
  for (const a of assets) if (a.result.ok) (byType[a.raw.type] ??= new Set()).add(a.raw.id);
  for (const [t, ts] of Object.entries(spec.types)) if (!ts.optional && !byType[t]?.size) errors.push(`slot "${t}" has no assets`);

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
    for (const [rel, hash] of Object.entries(lock.files ?? {})) {
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
  const root = resolve(dir);
  const assetsDir = existsSync(join(root, 'axf.manifest.json')) ? join(root, appTemplate(root).assetsDir) : join(root, 'src/assets');
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

/* ------------------------------------------------------------------ */
/* Android modules & demo apps (driven by the Dev Console)              */
/* ------------------------------------------------------------------ */

export const ANDROID_DIR = join(FRAMEWORK_DIR, 'android');

/**
 * Scaffold a new framework library module `lib-<name>` in framework/android from the android-module
 * template and register it in settings.gradle.kts. The module is a placeholder AxfModule until built out.
 */
export function newModule({ name, label, capabilities = [], dependsOn = [], compose = true, log = () => {} }) {
  const slug = slugify(name);
  const moduleName = slug.startsWith('lib-') || slug.startsWith('axf-') ? slug : `lib-${slug}`;
  const pkgName = moduleName.replace(/^(lib|axf)-/, '').replace(/-/g, '.');
  const dest = join(ANDROID_DIR, moduleName);
  if (existsSync(dest)) throw new Error(`Module ${moduleName} already exists`);
  const className = pkgName.split('.').map((p) => p.replace(/\b\w/g, (c) => c.toUpperCase())).join('') + 'Module';
  const tokens = {
    MODULE_NAME: moduleName, PACKAGE: `ai.amberx.axf.${pkgName}`, CLASS_NAME: className, LABEL: label ?? name,
    MODULE_ID: `ai.amberx.axf.${pkgName}`, PLUGIN: compose ? 'axf.android.compose.library' : 'axf.android.library',
    CAPABILITIES: capabilities.map((c) => `Capability("${c}")`).join(', '),
    DEPENDS_ON: dependsOn.map((d) => `"${d}"`).join(', '),
    FRAMEWORK_VERSION,
  };
  log(`• scaffolding ${moduleName}`);
  copyTemplate(join(FRAMEWORK_DIR, 'templates/android-module'), dest, tokens);
  rmSync(join(dest, 'template.json'), { force: true });
  // Kotlin sources live under a package path: move the placeholder file.
  const srcTpl = join(dest, 'src/main/kotlin/Module.kt');
  if (existsSync(srcTpl)) {
    const pkgDir = join(dest, 'src/main/kotlin', ...tokens.PACKAGE.split('.'));
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(join(pkgDir, `${className}.kt`), readFileSync(srcTpl, 'utf8'));
    rmSync(srcTpl);
  }
  const settings = join(ANDROID_DIR, 'settings.gradle.kts');
  const text = readFileSync(settings, 'utf8');
  if (!text.includes(`":${moduleName}"`)) writeFileSync(settings, text.trimEnd() + `\ninclude(":${moduleName}")\n`);
  return { dir: dest, moduleName, moduleId: tokens.MODULE_ID, className };
}

/** Create a demo app `apps/demo-<lib>` that showcases one library (what the Dev Console's library picker does). */
export function newDemoApp({ library, name, dir, log = () => {} }) {
  const slug = slugify(library).replace(/^lib-/, '');
  const target = dir ?? join(FRAMEWORK_DIR, '..', 'apps', `demo-${slug}`);
  const moduleId = library.startsWith('ai.amberx.') ? library : `ai.amberx.axf.${slug.replace(/-/g, '.')}`;
  return init({ dir: target, name: name ?? `AXF Demo — ${slug}`, id: `demo-${slug}`, template: 'android-compose', targets: ['android'], modules: [moduleId], log });
}

export function listModules() {
  const settings = readFileSync(join(ANDROID_DIR, 'settings.gradle.kts'), 'utf8');
  return [...settings.matchAll(/include\("(:[^"]+)"\)/g)].map((m) => m[1].slice(1)).map((name) => {
    const readme = join(ANDROID_DIR, name, 'README.md');
    const first = existsSync(readme) ? readFileSync(readme, 'utf8').split('\n').find((l) => l && !l.startsWith('#'))?.trim() ?? '' : '';
    return { name, kind: name.startsWith('lib-') ? 'library' : name.startsWith('axf-') ? 'framework' : 'other', description: first };
  });
}

/* ------------------------------------------------------------------ */
/* boilerplates                                                        */
/* ------------------------------------------------------------------ */

export const BOILERPLATES_DIR = join(FRAMEWORK_DIR, 'boilerplates');

export function listBoilerplates() {
  const idx = join(BOILERPLATES_DIR, 'index.json');
  return existsSync(idx) ? readJson(idx).items : [];
}

export function loadBoilerplate(id) {
  const file = join(BOILERPLATES_DIR, id, 'boilerplate.json');
  if (!existsSync(file)) throw new Error(`Unknown boilerplate "${id}". Available: ${listBoilerplates().map((b) => b.id).join(', ')}`);
  return readJson(file);
}

/** Writes a nav-menu asset for the boilerplate's screens and a placeholder view per screen into a fresh app. */
function applyBoilerplate(dest, tpl, bp, log) {
  log(`• applying boilerplate "${bp.id}" (${(bp.screens ?? []).length} screens)`);
  const nav = {
    $axf: 'asset@1', type: 'nav-menu', id: `${bp.id}-nav`, name: `${bp.name} navigation`, version: '0.1.0',
    description: `Generated from the ${bp.id} boilerplate.`, author: 'AmberX AXF build engine', tags: ['boilerplate'],
    data: { style: 'list', header: bp.name, sections: [{ label: null, items: (bp.screens ?? []).map((s) => ({ id: s.id, label: s.label, icon: iconFor(s.kind), view: s.id })) }] },
  };
  const navDir = join(dest, tpl.assetsDir, 'nav-menu');
  mkdirSync(navDir, { recursive: true });
  writeFileSync(join(navDir, `${nav.id}.json`), JSON.stringify(nav, null, 2) + '\n');
  const m = readJson(join(dest, 'axf.manifest.json'));
  m.defaults['nav-menu'] = nav.id;
  writeFileSync(join(dest, 'axf.manifest.json'), JSON.stringify(m, null, 2) + '\n');
  if (tpl.kind === 'android-app') {
    writeFileSync(join(dest, dirname(tpl.assetsDir), 'axf.manifest.json'), JSON.stringify(m, null, 2) + '\n');
    const viewsDir = join(dest, pkgPath(dest, 'app/src/main/kotlin/app/views'));
    mkdirSync(viewsDir, { recursive: true });
    const pkg = m.android?.applicationId ?? 'app';
    for (const s of bp.screens ?? []) {
      const cls = s.id.replace(/(^|-)(\w)/g, (_, __, c) => c.toUpperCase()) + 'View';
      if (existsSync(join(viewsDir, `${cls}.kt`))) continue;
      writeFileSync(join(viewsDir, `${cls}.kt`), `package ${pkg}.views\n\nimport androidx.compose.runtime.Composable\nimport ai.amberx.axf.ui.components.PlaceholderScreen\n\n/** ${s.label} — "${s.kind}" screen from the ${bp.id} boilerplate. Replace the placeholder with the real screen. */\n@Composable\nfun ${cls}() {\n    PlaceholderScreen("${s.label}", message = "Boilerplate screen (${s.kind}). Build it here.")\n}\n`);
    }
    const screens = (bp.screens ?? []).map((s) => { const cls = s.id.replace(/(^|-)(\w)/g, (_, __, c) => c.toUpperCase()) + 'View'; return `"${s.id}" to { ${cls}() }`; });
    const main = join(dest, pkgPath(dest, 'app/src/main/kotlin/app/MainActivity.kt'));
    if (existsSync(main)) {
      let text = readFileSync(main, 'utf8');
      text = text.replace('AppShell(views = mapOf("home" to { HomeView() }))', `AppShell(views = mapOf(${screens.join(', ')}))`).replace(`import ${pkg}.views.HomeView`, `import ${pkg}.views.*`);
      writeFileSync(main, text);
    }
  }
}

function iconFor(kind) {
  return { 'list-detail': 'list', dashboard: 'grid', wizard: 'chevron-right', settings: 'settings', feed: 'layers', editor: 'edit', player: 'play', map: 'map', chat: 'users', profile: 'user', landing: 'home', custom: 'box' }[kind] ?? 'box';
}
