/**
 * Library templates — boilerplates for *libraries* (framework/library-templates/<id>), each with an Android,
 * a web and a Python port.
 *
 *   listLibraryTemplates()
 *   newLibrary({ name, label, description, template, ports, features, params })
 *       android → framework/android/lib-<slug>   (module + screen + services, registered in settings.gradle.kts)
 *       web     → framework/libs/<slug>          (index.tsx exporting `library: AxfWebLibrary`)
 *       python  → framework/python/axf_libs/<py> (package exporting LIBRARY)
 *     and a library.json in each (library@1 + template, ports, features) so the installer, the console and
 *     `port-library` know what it is.
 *   compileLibrary({ slug, ports })   android: gradle :lib-<slug>:compileDebugKotlin when the SDK is present, else CI
 *                                     web: tsc over framework/libs (+ core/react)   python: compileall + import smoke test
 *   portLibrary({ slug, to })         generates another port of an existing library from its template
 */
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const FRAMEWORK_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATES = join(FRAMEWORK_DIR, 'library-templates');
const ANDROID = join(FRAMEWORK_DIR, 'android');
const WEB = join(FRAMEWORK_DIR, 'libs');
const PY = join(FRAMEWORK_DIR, 'python');
const VERSION = JSON.parse(readFileSync(join(FRAMEWORK_DIR, 'schemas/asset-types.json'), 'utf8')).frameworkVersion ?? '0.2.0';
export const LIBRARY_PORTS = ['android', 'web', 'python'];
const readJson = (f) => JSON.parse(readFileSync(f, 'utf8'));
const writeJson = (f, o) => { mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, JSON.stringify(o, null, 2) + '\n'); };
const slugify = (s) => String(s).toLowerCase().replace(/^lib-/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const pascal = (slug) => slug.split('-').filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join('');

export function listLibraryTemplates() {
  if (!existsSync(TEMPLATES)) return [];
  return readdirSync(TEMPLATES, { withFileTypes: true }).filter((d) => d.isDirectory() && existsSync(join(TEMPLATES, d.name, 'template.json'))).map((d) => {
    const t = readJson(join(TEMPLATES, d.name, 'template.json'));
    const files = {};
    for (const port of LIBRARY_PORTS) {
      const dir = join(TEMPLATES, d.name, port);
      const out = [];
      const walk = (p) => { for (const e of readdirSync(p, { withFileTypes: true })) { const f = join(p, e.name); if (e.isDirectory()) walk(f); else out.push(relative(dir, f)); } };
      if (existsSync(dir)) walk(dir);
      files[port] = out;
    }
    return { ...t, files };
  });
}

export function libraryTemplate(id) {
  const t = listLibraryTemplates().find((x) => x.id === id);
  if (!t) throw new Error(`Unknown library template "${id}". Templates: ${listLibraryTemplates().map((x) => x.id).join(', ')}`);
  return t;
}

/** Names for one library across ports. */
export function libraryNames(name) {
  const slug = slugify(name);
  if (!slug) throw new Error('library name is required');
  const pkgSeg = slug.replace(/-/g, '.');
  return { slug, moduleName: `lib-${slug}`, pkg: `ai.amberx.axf.${pkgSeg}`, moduleId: `ai.amberx.axf.${pkgSeg}`, cls: pascal(slug), py: slug.replace(/-/g, '_'), route: slug };
}

function tokensFor(n, { label, description, template, params }) {
  const t = { SLUG: n.slug, MODULE_NAME: n.moduleName, PACKAGE: n.pkg, MODULE_ID: n.moduleId, CLASS: n.cls, CLASS_LOWER: n.cls[0].toLowerCase() + n.cls.slice(1), ROUTE: n.route, PY: n.py, LABEL: label, DESCRIPTION: description, TEMPLATE: template.id, VERSION };
  for (const p of template.params ?? []) t[`P_${p.key.toUpperCase()}`] = String(params?.[p.key] ?? p.default ?? '');
  return t;
}
const fill = (text, tokens) => text.replace(/\{\{([A-Z_]+)\}\}/g, (m, k) => (k in tokens ? tokens[k] : m));
const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\$/g, '\\$');

function libraryJson(n, meta, ports) {
  return {
    $axf: 'library@1', id: n.moduleId, module: n.moduleName, name: meta.label, description: meta.description, template: meta.template.id,
    features: meta.features ?? [], dependsOn: meta.template.deps ?? [], manifestKey: `libraries.${n.slug}`,
    params: meta.template.params ?? [], templateParams: meta.params ?? {}, ports,
    install: { gradle: `implementation("ai.amberx.axf:${n.moduleName}:$axf")`, module: `${n.cls}Module()`, import: `${n.pkg}.${n.cls}Module` },
  };
}
const portDir = (n, port) => (port === 'android' ? join(ANDROID, n.moduleName) : port === 'web' ? join(WEB, n.slug) : join(PY, 'axf_libs', n.py));

function generatePort(n, meta, port, log) {
  const t = meta.template;
  const src = join(TEMPLATES, t.id, port);
  const dest = portDir(n, port);
  if (existsSync(dest)) throw new Error(`${relative(FRAMEWORK_DIR, dest)} already exists`);
  const tokens = tokensFor(n, { ...meta, description: esc(meta.description), label: esc(meta.label), template: t });
  if (port === 'android') {
    mkdirSync(join(dest, 'src/main'), { recursive: true });
    writeFileSync(join(dest, 'build.gradle.kts'), fill(readFileSync(join(src, 'build.gradle.kts'), 'utf8'), tokens));
    cpSync(join(src, 'AndroidManifest.xml'), join(dest, 'src/main/AndroidManifest.xml'));
    const pkgDir = join(dest, 'src/main/kotlin', ...n.pkg.split('.'));
    mkdirSync(pkgDir, { recursive: true });
    for (const f of readdirSync(join(src, 'kotlin'))) writeFileSync(join(pkgDir, fill(f, tokens)), fill(readFileSync(join(src, 'kotlin', f), 'utf8'), tokens));
    writeFileSync(join(dest, 'README.md'), `# ${n.moduleName}\n\n${meta.label}: ${meta.description}\n\nGenerated from the \`${t.id}\` library template. Install into an app with \`axf install ${n.slug}\`; compile with \`axf compile-library ${n.slug}\`.\n`);
    const settings = join(ANDROID, 'settings.gradle.kts');
    const st = readFileSync(settings, 'utf8');
    if (!st.includes(`include(":${n.moduleName}")`)) writeFileSync(settings, st.trimEnd() + `\ninclude(":${n.moduleName}")\n`);
  } else if (port === 'web') {
    mkdirSync(dest, { recursive: true });
    writeFileSync(join(dest, 'index.tsx'), fill(readFileSync(join(src, 'index.tsx'), 'utf8'), { ...tokens, LABEL: meta.label.replace(/'/g, "\\'"), DESCRIPTION: meta.description.replace(/'/g, "\\'") }));
  } else {
    mkdirSync(dest, { recursive: true });
    writeFileSync(join(dest, '__init__.py'), fill(readFileSync(join(src, '__init__.py'), 'utf8'), tokens));
  }
  log(`• ${port}: ${relative(FRAMEWORK_DIR, dest)}`);
  return relative(FRAMEWORK_DIR, dest);
}

function writeLibraryJsons(n, meta, ports) {
  const lj = libraryJson(n, meta, ports);
  for (const port of Object.keys(ports)) writeJson(join(portDir(n, port), 'library.json'), lj);
  return lj;
}

/** Read the library.json of a library from whichever port has it. */
export function readLibraryJson(slugOrId) {
  const n = libraryNames(String(slugOrId).replace(/^ai\.amberx\.axf\./, '').replace(/\./g, '-'));
  for (const port of LIBRARY_PORTS) { const f = join(portDir(n, port), 'library.json'); if (existsSync(f)) return { n, lib: readJson(f) }; }
  throw new Error(`No library.json for "${slugOrId}" in any port`);
}

export function newLibrary({ name, label, description, template = 'feature-screens', ports = ['android', 'web'], features = [], params = {}, log = () => {} }) {
  const t = libraryTemplate(template);
  const n = libraryNames(name);
  const meta = { label: label || n.cls.replace(/([a-z])([A-Z])/g, '$1 $2'), description: description || t.description, template: t, features, params };
  const unknown = ports.filter((p) => !LIBRARY_PORTS.includes(p));
  if (unknown.length) throw new Error(`unknown port(s): ${unknown.join(', ')}`);
  log(`▶ new library ${n.moduleName} from "${t.id}" (${ports.join(', ')})`);
  const out = {};
  for (const port of ports) out[port] = { status: 'scaffolded', dir: generatePort(n, meta, port, log) };
  const lj = writeLibraryJsons(n, meta, out);
  log(`✓ ${meta.label}: ${Object.keys(out).length} port(s) generated — compile with axf compile-library ${n.slug}`);
  return { library: lj, slug: n.slug, ports: out };
}

export function portLibrary({ slug, to, log = () => {} }) {
  if (!LIBRARY_PORTS.includes(to)) throw new Error(`unknown port "${to}"`);
  const { n, lib } = readLibraryJson(slug);
  if (lib.ports?.[to]) throw new Error(`${lib.name} already has a ${to} port (${lib.ports[to].dir})`);
  const t = libraryTemplate(lib.template ?? 'blank');
  const meta = { label: lib.name, description: lib.description, template: t, features: lib.features, params: lib.templateParams ?? {} };
  log(`▶ port ${lib.name} → ${to} (template ${t.id})`);
  const ports = { ...(lib.ports ?? {}), [to]: { status: 'scaffolded', dir: generatePort(n, meta, to, log) } };
  const lj = writeLibraryJsons(n, meta, ports);
  log(`✓ ${lib.name} now has ${Object.keys(ports).join(', ')}`);
  return { library: lj, slug: n.slug, ports };
}

function run(cmd, args, opts) {
  try { return { ok: true, out: execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 32 * 1024 * 1024, ...opts }) }; }
  catch (e) { return { ok: false, out: `${e.stdout ?? ''}${e.stderr ?? ''}` || e.message }; }
}
const has = (cmd) => run('sh', ['-c', `command -v ${cmd}`]).ok;

/** Compile the library's ports. Returns per-port { status: passed | failed | ci | skipped, output }. */
export function compileLibrary({ slug, ports, log = () => {} }) {
  const { n, lib } = readLibraryJson(slug);
  const want = (ports?.length ? ports : Object.keys(lib.ports ?? {})).filter((p) => lib.ports?.[p]);
  const results = {};
  for (const port of want) {
    log(`▶ compile ${lib.name} (${port})`);
    if (port === 'web') {
      if (!existsSync(join(FRAMEWORK_DIR, 'node_modules/typescript'))) { log('  installing type-check dependencies (framework/package.json)'); run('npm', ['install', '--no-audit', '--no-fund', '--silent'], { cwd: FRAMEWORK_DIR }); }
      const r = run(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['tsc', '-p', 'libs/tsconfig.json'], { cwd: FRAMEWORK_DIR });
      const mine = r.out.split('\n').filter((l) => l.includes(`libs/${n.slug}/`) || (!r.ok && !l.includes('libs/'))).filter(Boolean);
      results.web = { status: mine.length && !r.ok ? 'failed' : 'passed', output: mine.join('\n') || 'tsc: no errors' };
    } else if (port === 'python') {
      const py = has('python3') ? 'python3' : 'python';
      const c = run(py, ['-m', 'compileall', '-q', join(PY, 'axf_libs', n.py)]);
      const i = c.ok ? run(py, ['-c', `import axf_libs.${n.py} as m; from axf.library import MemoryKernel; k = MemoryKernel(); m.LIBRARY.register(k); print(f"{m.LIBRARY.label}: {len(k.contributions)} contributions, {len(k.services)} services")`], { cwd: PY, env: { ...process.env, PYTHONPATH: PY } }) : c;
      results.python = { status: i.ok ? 'passed' : 'failed', output: i.out.trim() };
    } else {
      const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
      const gradle = existsSync(join(ANDROID, 'gradlew')) ? './gradlew' : has('gradle') ? 'gradle' : null;
      if (!sdk || !gradle) { results.android = { status: 'ci', output: 'No Android SDK / Gradle here — CI compiles every module on push (.github/workflows/android.yml).' }; }
      else { const r = run(gradle, [`:${n.moduleName}:compileDebugKotlin`, '-q', '--no-daemon'], { cwd: ANDROID, timeout: 20 * 60 * 1000 }); results.android = { status: r.ok ? 'passed' : 'failed', output: r.out.split('\n').filter((l) => /^e: |error|FAILED|BUILD/.test(l)).join('\n') || (r.ok ? 'compileDebugKotlin: OK' : r.out.slice(-2000)) }; }
    }
    log(`  ${port}: ${results[port].status}${results[port].output ? ` — ${results[port].output.split('\n')[0]}` : ''}`);
  }
  // record results in library.json
  const ports2 = { ...(lib.ports ?? {}) };
  for (const [p, r] of Object.entries(results)) ports2[p] = { ...ports2[p], status: r.status === 'passed' ? 'compiled' : r.status === 'ci' ? 'scaffolded' : 'failed', checkedAt: new Date().toISOString() };
  writeLibraryJsons(n, { label: lib.name, description: lib.description, template: libraryTemplate(lib.template ?? 'blank'), features: lib.features, params: lib.templateParams }, ports2);
  return { slug: n.slug, results };
}

/** Remove a generated library from every port (only libraries generated from a template). */
export function removeLibrary({ slug, log = () => {} }) {
  const { n, lib } = readLibraryJson(slug);
  if (!lib.template) throw new Error('only template-generated libraries can be removed this way');
  for (const port of Object.keys(lib.ports ?? {})) { rmSync(portDir(n, port), { recursive: true, force: true }); log(`• removed ${port}`); }
  const settings = join(ANDROID, 'settings.gradle.kts');
  writeFileSync(settings, readFileSync(settings, 'utf8').split('\n').filter((l) => l.trim() !== `include(":${n.moduleName}")`).join('\n'));
  return { slug: n.slug };
}
