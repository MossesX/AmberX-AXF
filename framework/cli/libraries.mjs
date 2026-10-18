/**
 * Library installer — the "add a library to an app" half of the build engine.
 *
 * A library is any framework/android/<module> that ships a `library.json` (library@1): id, module, features,
 * the manifest key it reads its configuration from and the parameters its install wizard asks for.
 *
 *   listLibraries()                       every installable library + its params (what the console lists)
 *   libraryInfo(idOrModule)
 *   resolveParams(lib, answers)           validate/coerce wizard answers → config (throws on missing required)
 *   installLibrary({ dir, library, params, log })
 *       1. axf.manifest.json  → libraries.<key> = config, android.modules += id (also the in-APK copy)
 *       2. app/build.gradle.kts → implementation("ai.amberx.axf:<module>:$axf") under the `// axf:modules` marker
 *       3. app/src/main/kotlin/<pkg>/App.kt → import + `<Module>()` in modules()
 *       4. app/src/main/kotlin/<pkg>/axf/<Name>Setup.kt → generated, typed config object + registration helper,
 *          so the parameters the wizard asked for are plain reusable code the app can read and reuse.
 *   installScript(lib, config)            the same steps as a printable shell/JSON script (what the console shows)
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dataPath } from './persist.mjs';

const FRAMEWORK_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ANDROID_DIR = join(FRAMEWORK_DIR, 'android');
const readJson = (f) => JSON.parse(readFileSync(f, 'utf8'));
const writeJson = (f, o) => writeFileSync(f, JSON.stringify(o, null, 2) + '\n');

export function listLibraries() {
  // Android modules, web libraries (framework/libs) and Python libraries (framework/python/axf_libs) — merged by id.
  const dirs = [ANDROID_DIR, join(FRAMEWORK_DIR, 'libs'), join(FRAMEWORK_DIR, 'python', 'axf_libs')];
  const byId = new Map();
  for (const root of dirs) {
    if (!existsSync(root)) continue;
    for (const d of readdirSync(root, { withFileTypes: true })) {
      const f = join(root, d.name, 'library.json');
      if (!d.isDirectory() || !existsSync(f)) continue;
      const lib = readJson(f);
      const prev = byId.get(lib.id);
      byId.set(lib.id, prev ? { ...prev, ports: { ...(prev.ports ?? {}), ...(lib.ports ?? {}) } } : { ...lib, module: lib.module ?? d.name });
    }
  }
  return [...byId.values()];
}

/** framework/catalog/libraries.json — what the console bundles (copyConsoleData) to list installable libraries offline. */
export function writeLibrariesIndex() {
  const out = dataPath('framework/catalog/libraries.json');
  writeJson(out, { $axf: 'libraries@1', generatedAt: new Date().toISOString(), items: listLibraries() });
  return out;
}

export function libraryInfo(idOrModule) {
  const lib = listLibraries().find((l) => l.id === idOrModule || l.module === idOrModule || l.module === `lib-${idOrModule}`);
  if (!lib) throw new Error(`Unknown library "${idOrModule}". Installable: ${listLibraries().map((l) => l.module.replace(/^lib-/, '')).join(', ') || '(none)'}`);
  return lib;
}

/** Coerce one answer to the parameter's type; throws a readable error. */
export function coerceParam(p, value) {
  if (value === undefined || value === '' || value === null) {
    if (p.required && p.default === undefined) throw new Error(`"${p.label}" (${p.key}) is required`);
    return p.default;
  }
  switch (p.type) {
    case 'bool': return typeof value === 'boolean' ? value : /^(true|yes|y|on|1)$/i.test(String(value));
    case 'number': { const n = Number(value); if (Number.isNaN(n)) throw new Error(`"${p.label}" must be a number`); if (p.min != null && n < p.min) throw new Error(`"${p.label}" must be ≥ ${p.min}`); if (p.max != null && n > p.max) throw new Error(`"${p.label}" must be ≤ ${p.max}`); return n; }
    case 'list': return Array.isArray(value) ? value.map(String) : String(value).split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
    case 'choice': { const v = String(value); if (p.choices && !p.choices.includes(v)) throw new Error(`"${p.label}" must be one of ${p.choices.join(', ')}`); return v; }
    default: return String(value);
  }
}

export function resolveParams(lib, answers = {}) {
  const out = {};
  for (const p of lib.params ?? []) out[p.key] = coerceParam(p, answers[p.key]);
  return out;
}

const setKey = (obj, dotted, value) => { const parts = dotted.split('.'); let o = obj; for (const k of parts.slice(0, -1)) o = o[k] ??= {}; o[parts.at(-1)] = value; };

/** Kotlin literal for a config value. */
const kt = (v) => Array.isArray(v) ? `listOf(${v.map(kt).join(', ')})` : typeof v === 'string' ? JSON.stringify(v) : typeof v === 'number' ? (Number.isInteger(v) ? String(v) : `${v}`) : String(v);
const ktType = (p, v) => p.type === 'list' ? 'List<String>' : p.type === 'bool' ? 'Boolean' : p.type === 'number' ? (Number.isInteger(v) ? 'Int' : 'Double') : 'String';
const pascal = (s) => s.replace(/^lib-/, '').split(/[^a-z0-9]+/i).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join('');

function findAppKt(dir) {
  const srcRoot = join(dir, 'app/src/main/kotlin');
  const stack = [srcRoot];
  while (stack.length) {
    const d = stack.pop();
    if (!existsSync(d)) continue;
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const f = join(d, e.name);
      if (e.isDirectory()) stack.push(f); else if (e.name === 'App.kt') return f;
    }
  }
  return null;
}

export function installLibrary({ dir, library, params = {}, log = () => {} }) {
  const root = resolve(dir);
  const mPath = join(root, 'axf.manifest.json');
  if (!existsSync(mPath)) throw new Error(`Not an AXF app (no axf.manifest.json in ${root})`);
  const lib = libraryInfo(library);
  const config = resolveParams(lib, params);
  const changed = [];

  // 1. manifest (+ in-APK copy)
  const m = readJson(mPath);
  setKey(m, lib.manifestKey ?? `libraries.${lib.module.replace(/^lib-/, '')}`, config);
  m.android ??= {};
  m.android.modules = [...new Set([...(m.android.modules ?? []), ...(lib.dependsOn ?? []), lib.id])];
  m.libraries ??= {};
  m.libraries.$installed = [...new Set([...(m.libraries.$installed ?? []), lib.id])];
  writeJson(mPath, m); changed.push('axf.manifest.json');
  const inApk = join(root, 'app/src/main/assets/axf/axf.manifest.json');
  if (existsSync(dirname(inApk))) { writeJson(inApk, m); changed.push(relative(root, inApk)); }
  log(`• manifest: ${lib.manifestKey} = ${JSON.stringify(config)}`);

  // 2. gradle
  const gradle = join(root, 'app/build.gradle.kts');
  if (existsSync(gradle)) {
    let g = readFileSync(gradle, 'utf8');
    const dep = lib.install?.gradle ?? `implementation("ai.amberx.axf:${lib.module}:$axf")`;
    if (!g.includes(dep)) {
      g = g.includes('// axf:modules') ? g.replace(/(\/\/ axf:modules[^\n]*\n)/, `$1    ${dep}\n`) : g.replace(/dependencies\s*\{\n/, (s) => `${s}    ${dep}\n`);
      writeFileSync(gradle, g); changed.push('app/build.gradle.kts'); log(`• gradle: ${dep}`);
    }
  }

  // 3. App.kt
  const appKt = findAppKt(root);
  let pkg = m.android?.applicationId ?? 'app';
  if (appKt) {
    let k = readFileSync(appKt, 'utf8');
    pkg = /^package\s+([\w.]+)/m.exec(k)?.[1] ?? pkg;
    const imp = `import ${lib.install?.import ?? `ai.amberx.axf.${lib.module.replace(/^lib-/, '')}.${pascal(lib.module)}Module`}`;
    const inst = lib.install?.module ?? `${pascal(lib.module)}Module()`;
    if (!k.includes(imp)) k = k.replace(/(import ai\.amberx\.axf\.platform\.AxfApplication\n)/, `$1${imp}\n`);
    if (!k.includes(inst)) k = k.replace(/(\n\s*)AppModule\(\),/, `$1${inst},$1AppModule(),`);
    writeFileSync(appKt, k); changed.push(relative(root, appKt)); log(`• App.kt: ${inst}`);
  }

  // 4. generated setup code — the wizard's answers as typed, reusable Kotlin.
  const name = pascal(lib.module);
  const setupDir = appKt ? join(dirname(appKt), 'axf') : join(root, 'app/src/main/kotlin', ...pkg.split('.'), 'axf');
  mkdirSync(setupDir, { recursive: true });
  const fields = (lib.params ?? []).map((p) => `    /** ${p.label}${p.help ? ` — ${p.help}` : ''} */\n    public val ${p.key}: ${ktType(p, config[p.key])} = ${kt(config[p.key])}`).join('\n');
  const code = `package ${pkg}.axf

// Generated by \`axf install ${lib.module.replace(/^lib-/, '')}\` on ${new Date().toISOString().slice(0, 10)} — edit freely; re-running the installer rewrites this file.
// The same values live in axf.manifest.json → ${lib.manifestKey}; the module reads the manifest, this object is for app code.

/** ${lib.name}: install parameters as code. */
public object ${name}Setup {
    public const val LIBRARY: String = "${lib.id}"
${fields}
    /** Every parameter by manifest key (handy for diagnostics / re-running the wizard). */
    public val asMap: Map<String, Any?> = mapOf(${(lib.params ?? []).map((p) => `"${p.key}" to ${p.key}`).join(', ')})
}
`;
  const setupFile = join(setupDir, `${name}Setup.kt`);
  writeFileSync(setupFile, code); changed.push(relative(root, setupFile)); log(`• generated ${relative(root, setupFile)}`);
  return { dir: root, library: lib.id, module: lib.module, config, changed, manifest: m, script: installScript(lib, config) };
}

/** The install as a script the console can show / a human can run. */
export function installScript(lib, config) {
  const flags = Object.entries(config).map(([k, v]) => `--param ${k}=${JSON.stringify(Array.isArray(v) ? v.join(',') : v)}`).join(' \\\n    ');
  return `# ${lib.name} (${lib.id})\nnode framework/cli/axf.mjs install ${lib.module.replace(/^lib-/, '')} <appDir> \\\n    ${flags}\n`;
}

/** Interactive wizard on a TTY: asks every parameter (shows default), returns answers. */
export async function wizard(lib, preset = {}, io = process) {
  const { createInterface } = await import('node:readline/promises');
  const rl = createInterface({ input: io.stdin, output: io.stdout });
  const answers = { ...preset };
  io.stdout.write(`\n${lib.name}\n${lib.description}\n\n`);
  for (const p of lib.params ?? []) {
    if (answers[p.key] !== undefined) continue;
    const def = p.default !== undefined ? ` [${Array.isArray(p.default) ? p.default.join(',') : p.default}]` : p.required ? ' (required)' : '';
    const hint = p.type === 'choice' ? ` (${p.choices.join('/')})` : p.type === 'bool' ? ' (y/n)' : p.type === 'list' ? ' (comma-separated)' : '';
    for (;;) {
      const a = (await rl.question(`${p.label}${hint}${def}${p.help ? `\n  ${p.help}` : ''}\n> `)).trim();
      try { answers[p.key] = coerceParam(p, a); break; } catch (e) { io.stdout.write(`  ! ${e.message}\n`); }
    }
  }
  rl.close();
  return answers;
}
