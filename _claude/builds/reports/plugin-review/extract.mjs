#!/usr/bin/env node
/**
 * Plugin review, step 1: declared and real dependencies of every Dev Console plugin.
 *
 * Read-only. For each folder in apps/console-web/plugins (templates skipped) it reads plugin.json, README.md,
 * help.json and every file under web/, server/ and the folder root, and records:
 *
 *   declared   what the manifest says: provides / requires / optional / dependsOn, scopes, banner, tabable, opens,
 *              dataDir, mentions, commands (plugin-commands@1), builtWith
 *   real       what the code does: services provided and looked up (plugin_services.provide/get on the server,
 *              __axfWebServices on the web), other plugins' REST routes it calls (/api/plugins/<folder>/…), Python
 *              modules imported from another plugin folder, console actions registered and dispatched, views and
 *              dialogs navigated to, window events emitted and listened for, banners and slots, settings keys,
 *              shared server modules (console server + framework/python) and the routes it exposes
 *   folderRefs where the framework, the console shell or another plugin names this folder (the rule says never)
 *   mentions   doc lines outside the folder tagged <!-- axf-plugin:<folder> -->
 *
 * Resolution: every looked-up capability is matched to its provider(s) (declared `service:<cap>` or a real
 * provide call) and checked against the consumer's declared requires / optional, so the report can say which
 * dependencies are declared, which are real but undeclared, and which are declared but never used.
 *
 *   node _claude/builds/reports/plugin-review/extract.mjs            writes deps.json + DEPS.md next to itself
 *   node _claude/builds/reports/plugin-review/extract.mjs --json     prints the JSON instead
 */
import { readdirSync, readFileSync, statSync, existsSync, writeFileSync } from 'node:fs';
import { join, relative, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..', '..');
const PLUGINS = join(ROOT, 'apps/console-web/plugins');
const CONSOLE_SERVER = join(ROOT, 'apps/console-web/server');
const CONSOLE_SRC = join(ROOT, 'apps/console-web/src');
const FRAMEWORK = join(ROOT, 'framework');

const CODE_EXT = new Set(['.py', '.ts', '.tsx', '.mts', '.mjs', '.js', '.json', '.css', '.md', '.html']);
const SKIP_DIRS = new Set(['node_modules', 'dist', 'vendor', '__pycache__', '.git']);

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (CODE_EXT.has(extname(name))) out.push(p);
  }
  return out;
}
const read = (p) => { try { return readFileSync(p, 'utf8'); } catch { return ''; } };
const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
const uniq = (a) => [...new Set(a)].sort();
const CAP = /[a-z][a-z0-9_.-]*@[0-9]+/;
const isCap = (s) => CAP.test(s) && new RegExp(`^${CAP.source}$`).test(s);

function allMatches(text, re) {
  const out = [];
  for (const m of text.matchAll(re)) out.push(m);
  return out;
}

/** `NAME = "x@1"` / `const NAME = 'x@1'` constants in one file, so get(LLM_CAP) resolves. */
function constants(text) {
  const map = {};
  for (const m of text.matchAll(/(?:^|\n)\s*(?:export\s+)?(?:const\s+|let\s+)?([A-Z][A-Z0-9_]+)\s*(?::\s*[\w<>|\[\] ]+)?\s*=\s*["'`]([a-z][a-z0-9_.-]*@[0-9]+)["'`]/g)) map[m[1]] = m[2];
  return map;
}
function capArg(arg, consts) {
  const s = arg.trim();
  const q = s.match(/^["'`]([^"'`]+)["'`]$/);
  if (q) return isCap(q[1]) ? q[1] : null;
  if (consts[s]) return consts[s];
  return null;
}

const folders = readdirSync(PLUGINS).filter((f) => !f.startsWith('_') && statSync(join(PLUGINS, f)).isDirectory() && existsSync(join(PLUGINS, f, 'plugin.json')));

/* ------------------------------------------------------------------ per plugin */
function readmeSummary(folder) {
  const md = read(join(PLUGINS, folder, 'README.md'));
  if (!md) return { present: false, summary: '' };
  const body = md.replace(/^#.*$/m, '').trim();
  const para = body.split(/\n\s*\n/).map((s) => s.trim()).find((s) => s && !s.startsWith('#') && !s.startsWith('<!--')) ?? '';
  return { present: true, summary: para.replace(/\s+/g, ' ').slice(0, 400) };
}

function extract(folder) {
  const dir = join(PLUGINS, folder);
  const m = readJson(join(dir, 'plugin.json')) ?? {};
  const files = walk(dir);
  const rel = (p) => relative(dir, p);
  const serverFiles = files.filter((p) => p.startsWith(join(dir, 'server')) && p.endsWith('.py'));
  const webFiles = files.filter((p) => p.startsWith(join(dir, 'web')) && /\.(ts|tsx|mts|mjs|js)$/.test(p));
  const rootScripts = files.filter((p) => dirname(p) === dir && /\.(mjs|js|py)$/.test(p));
  const isTest = (p) => /(^|\/)(test[^/]*|[^/]*_test|[^/]*\.test)\.(py|mjs|mts|ts|tsx)$/.test(rel(p));
  // tests register fake providers and call fixture routes: they never count as real dependencies
  const codeFiles = [...serverFiles, ...webFiles, ...rootScripts].filter((p) => !isTest(p));

  const real = {
    servicesProvided: {}, servicesUsed: {}, pluginRoutesCalled: {}, pythonImportsOfPlugins: {}, sharedServerModules: [],
    frameworkPython: [], actionsRegistered: [], actionsDispatched: [], viewsNavigated: [], dialogsOpened: [],
    eventsEmitted: [], eventsListened: [], banners: [], slots: [], settingsKeys: [], storageKeys: [],
    routesExposed: [], routeCount: 0, websocketRoutes: 0, capabilityStrings: {}, libraryContributions: {},
    cliScripts: rootScripts.map(rel), testFiles: files.filter((p) => /(^|\/)test[^/]*\.(py|mjs|mts)$/.test(p)).map(rel),
  };
  real.dynamicLookups = [];
  real.dynamicCandidates = {}; // capability strings near a variable lookup; kept only when some plugin provides them (resolved below)
  real.webLibraryProvides = [];
  real.webLibraryDependsOn = [];
  real.globalsTouched = [];
  const add = (bucket, key, file) => { (real[bucket][key] ??= new Set()).add(rel(file)); };
  // constants from every file of the plugin, so `plugin_services.get(complete.CHANGES)` resolves across modules
  const pluginConsts = {};
  const fileConsts = {}; // module stem -> its constants, so `health.CAPABILITY` reads health.py and never another file's CAPABILITY
  for (const f of codeFiles) { const c = constants(read(f)); Object.assign(pluginConsts, c); fileConsts[rel(f).replace(/^.*\//, '').replace(/\.[^.]+$/, '')] = c; }
  const resolveCap = (arg, local) => {
    const a = arg.trim();
    if (/^[a-z_][a-z0-9_]*(\.[a-z_][a-z0-9_]*)*\.[A-Z][A-Z0-9_]*$/.test(a)) {
      const parts = a.split('.'); const name = parts.pop();
      for (const seg of parts.reverse()) if (fileConsts[seg]?.[name]) return fileConsts[seg][name];
      return null; // a constant from outside the plugin (framework/python): not resolvable here
    }
    return capArg(a, local) ?? capArg(a, pluginConsts);
  };
  real.unresolvedProvides = [];

  for (const f of codeFiles) {
    const text = read(f);
    const consts = constants(text);
    const isPy = f.endsWith('.py');
    for (const mm of allMatches(text, /__axf[A-Z][A-Za-z0-9_]*/g)) real.globalsTouched.push(mm[0]);

    // services (server)
    // plugin_services.provide(...) or a local wrapper `_provide(...)` around it
    for (const mm of allMatches(text, /(?:plugin_services\.|(?<![\w.])_)provide\(\s*([^,]+),/g)) { const c = resolveCap(mm[1], consts); if (c) add('servicesProvided', c, f); else real.unresolvedProvides.push(`${rel(f)}: provide(${mm[1].trim()})`); }
    for (const mm of allMatches(text, /plugin_services\.get\(\s*([^)]+)\)/g)) {
      const c = resolveCap(mm[1], consts);
      if (c) add('servicesUsed', c, f);
      else {
        // a variable: every capability string in this file is a likely lookup (build-orchestrator iterates a dict of them)
        real.dynamicLookups.push(`${rel(f)}: get(${mm[1].trim()})`);
        for (const cm of allMatches(text, /["'`]([a-z][a-z0-9_.-]*@[0-9]+)["'`]/g)) (real.dynamicCandidates[cm[1]] ??= new Set()).add(rel(f));
      }
    }
    // services (web): __axfWebServices[X] = …  provides; any other read uses
    if (text.includes('__axfWebServices')) {
      // `services()[TOKEN_TREE] = impl` / `__axfWebServices['x@1'] = impl` provides; any other indexed read uses
      for (const mm of allMatches(text, /\[\s*([A-Z][A-Z0-9_]*|["'`][a-z][a-z0-9_.-]*@[0-9]+["'`])\s*\]\s*=[^=]/g)) { const c = resolveCap(mm[1], consts); if (c) add('servicesProvided', c, f); }
      for (const mm of allMatches(text, /\[\s*([A-Z][A-Z0-9_]*|["'`][a-z][a-z0-9_.-]*@[0-9]+["'`])\s*\](?!\s*=[^=])/g)) { const c = resolveCap(mm[1], consts); if (c && !real.servicesProvided[c]?.has(rel(f))) add('servicesUsed', c, f); }
    }
    if (!isPy && /web\/index\.tsx?$/.test(rel(f))) {
      const lib = (key) => { const b = text.match(new RegExp(`(?:^|\\n)\\s*${key}:\\s*\\[([^\\]]*)\\]`)); return b ? allMatches(b[1], /["'`]([a-z][a-z0-9_.:-]*@[0-9]+)["'`]/g).map((x) => x[1]) : []; };
      real.webLibraryProvides.push(...lib('provides'));
      real.webLibraryDependsOn.push(...lib('dependsOn'));
    }
    // every capability-looking string (context for s2; includes schema ids like asset@1)
    for (const mm of allMatches(text, /["'`]([a-z][a-z0-9_.-]*@[0-9]+)["'`]/g)) add('capabilityStrings', mm[1], f);
    // other plugins' routes by folder name
    for (const mm of allMatches(text, /\/api\/plugins\/([a-z0-9][a-z0-9-]+)/g)) if (mm[1] !== folder && folders.includes(mm[1])) add('pluginRoutesCalled', mm[1], f);
    if (isPy) {
      for (const mm of allMatches(text, /import_module\(\s*["']([a-z0-9-]+)\.server["']\s*\)|from\s+([a-z0-9_-]+)\.server\s+import/g)) { const g = mm[1] || mm[2]; if (g && g !== folder && folders.includes(g)) add('pythonImportsOfPlugins', g, f); }
      for (const mm of allMatches(text, /^(?:import|from)\s+(alerts|credentials|console_context|app_catalog|axf_framework|build_defaults|build_profiles|previews|readcache|wall|plugin_services|mcp_server)\b/gm)) real.sharedServerModules.push(mm[1]);
      for (const mm of allMatches(text, /^from\s+(axf(?:\.[a-z_]+)*)\s+import|^import\s+(axf(?:\.[a-z_]+)+)/gm)) real.frameworkPython.push(mm[1] || mm[2]);
      for (const mm of allMatches(text, /@router\.(get|post|put|delete|patch|api_route|websocket)\(\s*["']([^"']+)["']/g)) { real.routeCount++; if (mm[1] === 'websocket') real.websocketRoutes++; real.routesExposed.push(`${mm[1].toUpperCase()} ${mm[2]}`); }
    } else {
      for (const mm of allMatches(text, /actions\.register\(\s*["'`]([a-zA-Z][\w.:-]*)["'`]/g)) real.actionsRegistered.push(mm[1]);
      for (const mm of allMatches(text, /\b(?:dispatch|actions\.run|runAction)\(\s*["'`]([a-zA-Z][\w.:-]*)["'`]/g)) real.actionsDispatched.push(mm[1]);
      for (const mm of allMatches(text, /\bnavigate\(\s*["'`]([a-zA-Z][\w.:-]*)["'`]/g)) real.viewsNavigated.push(mm[1]);
      for (const mm of allMatches(text, /\bopenDialog\(\s*["'`]([a-zA-Z][\w.:-]*)["'`]/g)) real.dialogsOpened.push(mm[1]);
      for (const mm of allMatches(text, /dispatchEvent\(\s*new\s+(?:Custom)?Event\(\s*["'`]([a-zA-Z][\w.:-]*)["'`]/g)) real.eventsEmitted.push(mm[1]);
      for (const mm of allMatches(text, /addEventListener\(\s*["'`]([a-zA-Z][\w.:-]*[:.][\w.:-]*)["'`]/g)) real.eventsListened.push(mm[1]);
      for (const mm of allMatches(text, /\b(?:useSetting|getSetting|setSetting|settings\.get|settings\.set|setting)\(\s*["'`]([a-zA-Z][\w.:-]*)["'`]/g)) real.settingsKeys.push(mm[1]);
      for (const mm of allMatches(text, /localStorage\.(?:getItem|setItem|removeItem)\(\s*["'`]([a-zA-Z][\w.:-]*)["'`]/g)) real.storageKeys.push(mm[1]);
      if (rel(f) === 'web/index.tsx' || rel(f) === 'web/index.ts') {
        const bannersBlock = text.match(/banners:\s*\[([\s\S]*?)\n\s*\],?\n/);
        if (bannersBlock) for (const mm of allMatches(bannersBlock[1], /\bid:\s*["'`]([\w.:-]+)["'`]/g)) real.banners.push(mm[1]);
        const slotsBlock = text.match(/slots:\s*\{([\s\S]*?)\n\s*\},?\n/);
        if (slotsBlock) for (const mm of allMatches(slotsBlock[1], /["'`]?([a-zA-Z][\w.-]*)["'`]?\s*:\s*\[/g)) real.slots.push(mm[1]);
        for (const key of ['views', 'dialogs', 'tabs', 'nav', 'settingsTabs', 'settings', 'settingsPanels', 'contextMenu', 'appMenu', 'appMenuProviders', 'banners', 'slots', 'embed', 'help']) {
          if (new RegExp(`(^|\\n)\\s*${key}\\s*[:(]`, 'm').test(text) || new RegExp(`[{,]\\s*${key}\\s*,`).test(text)) real.libraryContributions[key] = true;
        }
      }
    }
  }

  const setsToObj = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, [...v].sort()]));
  for (const k of ['servicesProvided', 'servicesUsed', 'pluginRoutesCalled', 'pythonImportsOfPlugins', 'capabilityStrings', 'dynamicCandidates']) real[k] = setsToObj(real[k]);
  real.webLibraryProvides = uniq(real.webLibraryProvides); real.webLibraryDependsOn = uniq(real.webLibraryDependsOn);
  real.dynamicLookups = uniq(real.dynamicLookups);
  for (const k of ['globalsTouched', 'sharedServerModules', 'frameworkPython', 'actionsRegistered', 'actionsDispatched', 'viewsNavigated', 'dialogsOpened', 'eventsEmitted', 'eventsListened', 'banners', 'slots', 'settingsKeys', 'storageKeys']) real[k] = uniq(real[k]);
  real.routesExposed = uniq(real.routesExposed);

  const commands = m.commands && typeof m.commands === 'object' ? m.commands : null;
  const items = Array.isArray(commands?.items) ? commands.items : [];
  const declared = {
    id: m.id ?? '', name: m.name ?? folder, version: m.version ?? '', kind: m.kind ?? '', apiLevel: m.apiLevel ?? null,
    description: (m.description ?? '').replace(/\s+/g, ' '),
    targets: m.targets ?? [], provides: m.provides ?? [], requires: m.requires ?? [], optional: m.optional ?? [], dependsOn: m.dependsOn ?? [],
    scopes: m.scopes ?? [], enabledByDefault: m.enabledByDefault !== false, banner: m.banner ?? false, tabable: m.tabable ?? false, opens: m.opens ?? null,
    dataDir: m.lifecycle?.dataDir ?? null, env: m.lifecycle?.env ?? [], mentions: m.lifecycle?.mentions ?? [],
    commands: commands ? { auto: !!commands.auto, items: items.map((i) => i.id).filter(Boolean), voiceHints: items.filter((i) => /\bSay\b/.test(i.description ?? '')).length } : null,
    builtWith: m.builtWith ?? null, help: m.help ?? null,
  };
  const files_ = {
    readme: existsSync(join(dir, 'README.md')), help: existsSync(join(dir, 'help.json')), server: existsSync(join(dir, 'server/__init__.py')),
    web: existsSync(join(dir, 'web/index.tsx')), install: existsSync(join(dir, 'install.mjs')), uninstall: existsSync(join(dir, 'uninstall.mjs')), hooks: existsSync(join(dir, 'hooks.mjs')),
    notify: existsSync(join(dir, 'notify.json')), count: files.length, serverPy: serverFiles.length, web: webFiles.length,
  };
  return { folder, declared, readme: readmeSummary(folder), files: files_, real };
}

/* ------------------------------------------------------------------ cross-plugin resolution */
const plugins = folders.map(extract);
const byFolder = Object.fromEntries(plugins.map((p) => [p.folder, p]));
const providers = {}; // cap -> [{folder, how: declared|server|web}]
for (const p of plugins) {
  for (const s of p.declared.provides) if (s.startsWith('service:')) (providers[s.slice(8)] ??= []).push({ folder: p.folder, how: 'declared' });
  for (const s of Object.keys(p.real.servicesProvided)) (providers[s] ??= []).push({ folder: p.folder, how: 'code' });
  for (const s of p.real.webLibraryProvides) (providers[s] ??= []).push({ folder: p.folder, how: 'web-library' });
}
// dynamic candidates become real lookups only when some plugin provides them (drops schema ids such as check-routine@1)
for (const p of plugins) {
  for (const [cap, files] of Object.entries(p.real.dynamicCandidates)) if (providers[cap]?.some((x) => x.folder !== p.folder)) p.real.servicesUsed[cap] = uniq([...(p.real.servicesUsed[cap] ?? []), ...files]);
  p.real.servicesUsed = Object.fromEntries(Object.entries(p.real.servicesUsed).sort(([a], [b]) => a.localeCompare(b)));
}
const viewOwner = {}; const dialogOwner = {}; const actionOwner = {};
for (const p of plugins) {
  for (const s of p.declared.provides) { if (s.startsWith('view:')) viewOwner[s.slice(5)] = p.folder; if (s.startsWith('dialog:')) dialogOwner[s.slice(7)] = p.folder; }
  for (const a of p.real.actionsRegistered) actionOwner[a] = p.folder;
}
const declaredDepName = (s) => s.replace(/^service:/, '');

for (const p of plugins) {
  const declaredCaps = new Set([...p.declared.requires, ...p.declared.optional, ...p.declared.dependsOn].map(declaredDepName));
  const selfCaps = new Set([...p.declared.provides.filter((s) => s.startsWith('service:')).map(declaredDepName), ...Object.keys(p.real.servicesProvided), ...p.real.webLibraryProvides]);
  const declaredWeb = new Set(p.real.webLibraryDependsOn.map(declaredDepName));
  for (const c of declaredWeb) declaredCaps.add(c);
  p.real.selfLookups = Object.keys(p.real.servicesUsed).filter((c) => selfCaps.has(c)).sort();
  for (const c of p.real.selfLookups) delete p.real.servicesUsed[c];
  // a declared capability reached through a window event or a shared global rather than a lookup (agent-voice@1 → axf:agent-voice.say)
  const base = (cap) => cap.replace(/@\d+$/, '').replace(/^axf\./, '');
  const channels = [...p.real.eventsEmitted, ...p.real.eventsListened, ...p.real.globalsTouched].join(' ').toLowerCase();
  p.real.usedViaEvents = [...declaredCaps].filter((c) => !p.real.servicesUsed[c] && channels.includes(base(c).replace(/-/g, '')) || channels.includes(base(c))).filter((c) => !p.real.servicesUsed[c]).sort();
  const edges = [];
  const push = (kind, target, via, detail) => edges.push({ kind, target, via, detail });
  for (const [cap, files] of Object.entries(p.real.servicesUsed)) {
    const provs = (providers[cap] ?? []).filter((x) => x.folder !== p.folder);
    const declaredHere = declaredCaps.has(cap);
    push('service', cap, declaredHere ? (p.declared.requires.map(declaredDepName).includes(cap) ? 'required' : 'optional') : 'undeclared', { providers: uniq(provs.map((x) => x.folder)), files });
  }
  for (const [other, files] of Object.entries(p.real.pluginRoutesCalled)) push('route', other, 'folder-name', { files });
  for (const [other, files] of Object.entries(p.real.pythonImportsOfPlugins)) push('python-import', other, 'folder-name', { files });
  for (const v of p.real.viewsNavigated) if (viewOwner[v] && viewOwner[v] !== p.folder) push('view', viewOwner[v], 'navigate', { view: v });
  for (const d of p.real.dialogsOpened) if (dialogOwner[d] && dialogOwner[d] !== p.folder) push('dialog', dialogOwner[d], 'openDialog', { dialog: d });
  for (const a of p.real.actionsDispatched) if (actionOwner[a] && actionOwner[a] !== p.folder) push('action', actionOwner[a], 'dispatch', { action: a });
  for (const e of p.real.eventsListened) { const emitters = plugins.filter((q) => q.folder !== p.folder && q.real.eventsEmitted.includes(e)).map((q) => q.folder); if (emitters.length) push('event', emitters.join(','), 'listens', { event: e }); }
  for (const c of p.real.usedViaEvents) push('service', c, declaredCaps.has(c) ? 'optional' : 'undeclared', { providers: uniq((providers[c] ?? []).filter((x) => x.folder !== p.folder).map((x) => x.folder)), files: [], channel: 'event/global' });
  const usedCaps = new Set([...Object.keys(p.real.servicesUsed), ...p.real.usedViaEvents]);
  p.resolution = {
    edges,
    declaredNotUsed: [...declaredCaps].filter((c) => !usedCaps.has(c) && !p.real.pluginRoutesCalled[providers[c]?.[0]?.folder ?? '']).sort(),
    usedNotDeclared: [...usedCaps].filter((c) => !declaredCaps.has(c)).sort(),
    unprovidedCaps: [...usedCaps].filter((c) => !(providers[c] ?? []).some((x) => x.folder !== p.folder)).sort(),
    providesDeclaredNotInCode: p.declared.provides.filter((s) => s.startsWith('service:')).map(declaredDepName).filter((c) => !p.real.servicesProvided[c] && !p.real.webLibraryProvides.includes(c)).sort(),
    providesInCodeNotDeclared: Object.keys(p.real.servicesProvided).filter((c) => !p.declared.provides.includes(`service:${c}`)).sort(),
    folderNameCouplings: uniq([...Object.keys(p.real.pluginRoutesCalled), ...Object.keys(p.real.pythonImportsOfPlugins)]),
  };
}

/* ------------------------------------------------------------------ outside references */
function grepFiles(dir, exts) { return walk(dir).filter((p) => exts.some((e) => p.endsWith(e))); }
const shellFiles = [...grepFiles(CONSOLE_SRC, ['.ts', '.tsx']), ...grepFiles(CONSOLE_SERVER, ['.py'])];
const frameworkFiles = [...grepFiles(join(FRAMEWORK, 'cli'), ['.mjs', '.py']), ...grepFiles(join(FRAMEWORK, 'core'), ['.mjs']), ...grepFiles(join(FRAMEWORK, 'python'), ['.py'])];
const mdFiles = walk(ROOT).filter((p) => p.endsWith('.md') && !p.startsWith(PLUGINS) && !p.includes('/node_modules/'));
const mdText = mdFiles.map((p) => [relative(ROOT, p), read(p)]);
for (const p of plugins) {
  const f = p.folder;
  // strong = a path or route that can only mean this plugin; weak = the bare folder word in quotes (may be a generic word such as "activity")
  const strongRe = new RegExp(`(plugins/${f}(?![a-z0-9-])|/api/plugins/${f}(?![a-z0-9-]))`);
  const weakRe = new RegExp(`['"\`]${f}['"\`]`);
  const hit = (list, re) => list.filter((file) => !file.includes(`/plugins/${f}/`)).flatMap((file) => {
    const lines = read(file).split('\n').map((l, i) => [i + 1, l]).filter(([, l]) => re.test(l));
    return lines.length ? [{ file: relative(ROOT, file), lines: lines.slice(0, 3).map(([n, l]) => `${n}: ${l.trim().slice(0, 140)}`), count: lines.length }] : [];
  });
  const shellStrong = hit(shellFiles, strongRe), fwStrong = hit(frameworkFiles, strongRe);
  const seen = new Set([...shellStrong, ...fwStrong].map((x) => x.file));
  p.folderRefs = {
    consoleShell: shellStrong, framework: fwStrong,
    weak: [...hit(shellFiles, weakRe), ...hit(frameworkFiles, weakRe)].filter((x) => !seen.has(x.file)),
    otherPlugins: plugins.filter((q) => q.folder !== f && (q.real.pluginRoutesCalled[f] || q.real.pythonImportsOfPlugins[f])).map((q) => q.folder),
  };
  const tag = `<!-- axf-plugin:${f} -->`;
  p.docMentions = mdText.filter(([, t]) => t.includes(tag)).map(([file, t]) => ({ file, lines: t.split('\n').filter((l) => l.includes(tag)).length }));
  p.docMentionsUntagged = mdText.filter(([file, t]) => !p.docMentions.some((d) => d.file === file) && new RegExp(`\\b${f}\\b`).test(t) && /^(CLAUDE\.md|_claude\/(memory\/STATUS|THREADS|rules\/RULES|shared\/rules\/RULES)\.md|apps\/console-web\/README\.md|apps\/console-web\/plugins\/README\.md)$/.test(file)).map(([file]) => file);
}

const out = {
  $axf: 'plugin-review-deps@1', generatedAt: new Date().toISOString(), scope: 'apps/console-web/plugins (templates skipped)', count: plugins.length,
  providers: Object.fromEntries(Object.entries(providers).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, uniq(v.map((x) => x.folder))])),
  plugins,
};

/* ------------------------------------------------------------------ markdown */
function md() {
  const L = [];
  L.push('# Plugin review, step 1: declared and real dependencies', '', `Generated ${out.generatedAt} by \`extract.mjs\` from ${plugins.length} console plugins (read-only). Data: \`deps.json\` (plugin-review-deps@1).`, '');
  const n = (k) => plugins.filter(k).length;
  L.push('## Totals', '',
    `| | Count |`, `|---|---|`,
    `| Plugins | ${plugins.length} |`,
    `| With a server part | ${n((p) => p.files.server)} |`,
    `| With a web part | ${n((p) => p.files.web)} |`,
    `| Provide a capability service (declared) | ${n((p) => p.declared.provides.some((s) => s.startsWith('service:')))} |`,
    `| Look up a capability service in code | ${n((p) => Object.keys(p.real.servicesUsed).length)} |`,
    `| Use a service they never declare (requires / optional) | ${n((p) => p.resolution.usedNotDeclared.length)} |`,
    `| Declare a dependency the code never uses | ${n((p) => p.resolution.declaredNotUsed.length)} |`,
    `| Call another plugin by folder name (REST route or Python import) | ${n((p) => p.resolution.folderNameCouplings.length)} |`,
    `| Named by the console shell or framework by folder | ${n((p) => p.folderRefs.consoleShell.length || p.folderRefs.framework.length)} |`,
    `| Declare a service their code never provides | ${n((p) => p.resolution.providesDeclaredNotInCode.length)} |`,
    `| Missing README | ${n((p) => !p.files.readme)} |`,
    `| Missing install.mjs or uninstall.mjs | ${n((p) => !p.files.install || !p.files.uninstall)} |`, '');
  L.push('## Capability providers', '', '| Capability | Provided by |', '|---|---|');
  for (const [cap, who] of Object.entries(out.providers)) L.push(`| \`${cap}\` | ${who.join(', ')} |`);
  L.push('');
  const caps = new Set(Object.keys(out.providers));
  const orphan = uniq(plugins.flatMap((p) => Object.keys(p.real.servicesUsed))).filter((c) => !caps.has(c));
  if (orphan.length) L.push(`Looked up but provided by no plugin: ${orphan.map((c) => `\`${c}\``).join(', ')}.`, '');
  L.push('## Per plugin', '', 'Declared = plugin.json requires / optional / dependsOn. Real = what the code looks up or calls. Folder couplings break the capability rule.', '',
    '| Plugin | Server | Web | Provides (services) | Declared deps | Real service lookups | Undeclared | Declared, unused | Folder couplings | Routes | Commands |', '|---|---|---|---|---|---|---|---|---|---|---|');
  for (const p of plugins) {
    const svc = (l) => l.length ? l.map((s) => `\`${s}\``).join(' ') : '';
    const provided = p.declared.provides.filter((s) => s.startsWith('service:')).map(declaredDepName);
    const deps = [...p.declared.requires, ...p.declared.optional, ...p.declared.dependsOn].map(declaredDepName);
    L.push(`| **${p.folder}** | ${p.files.server ? 'py' : ''} | ${p.files.web ? 'tsx' : ''} | ${svc(provided)} | ${svc(deps)} | ${svc(Object.keys(p.real.servicesUsed))} | ${svc(p.resolution.usedNotDeclared)} | ${svc(p.resolution.declaredNotUsed)} | ${svc(p.resolution.folderNameCouplings)} | ${p.real.routeCount} | ${p.declared.commands ? (p.declared.commands.auto ? 'auto' : '') + (p.declared.commands.items.length ? `+${p.declared.commands.items.length}` : '') : ''} |`);
  }
  L.push('', '## Detail', '');
  for (const p of plugins) {
    const d = p.declared; const r = p.real; const res = p.resolution;
    L.push(`### ${p.folder}`, '', `**${d.name}** v${d.version} (${d.id}). ${d.description}`, '');
    if (p.readme.summary) L.push(`README: ${p.readme.summary}`, '');
    const rows = [];
    rows.push(['Provides (manifest)', d.provides.join(', ')]);
    rows.push(['Requires / optional / dependsOn', [...d.requires.map((s) => `${s} (required)`), ...d.optional.map((s) => `${s} (optional)`), ...d.dependsOn.map((s) => `${s} (dependsOn)`)].join(', ')]);
    rows.push(['Services provided in code', [...Object.entries(r.servicesProvided).map(([k, v]) => `${k} (${v.join(', ')})`), ...r.webLibraryProvides.map((k) => `${k} (web library provides)`)].join('; ')]);
    rows.push(['Services looked up in code', res.edges.filter((e) => e.kind === 'service').map((e) => `${e.target} → ${e.detail.providers.join('/') || 'nobody'} [${e.via}]`).join('; ')]);
    rows.push(['Other plugins called by folder', [...Object.entries(r.pluginRoutesCalled).map(([k, v]) => `REST /api/plugins/${k} (${v.join(', ')})`), ...Object.entries(r.pythonImportsOfPlugins).map(([k, v]) => `import ${k}.server (${v.join(', ')})`)].join('; ')]);
    rows.push(['Views / dialogs / actions of other plugins used', res.edges.filter((e) => ['view', 'dialog', 'action'].includes(e.kind)).map((e) => `${e.kind} ${e.detail.view ?? e.detail.dialog ?? e.detail.action} (${e.target})`).join('; ')]);
    rows.push(['Own capability looked up (self)', r.selfLookups.join(', ')]);
    rows.push(['Dynamic lookups (variable argument; every capability string in that file counted)', r.dynamicLookups.join('; ')]);
    rows.push(['Shared globals', r.globalsTouched.join(', ')]);
    rows.push(['Window events', [r.eventsEmitted.length ? `emits ${r.eventsEmitted.join(', ')}` : '', r.eventsListened.length ? `listens ${r.eventsListened.join(', ')}` : ''].filter(Boolean).join('; ')]);
    rows.push(['Actions registered', r.actionsRegistered.join(', ')]);
    rows.push(['Banners / slots', [r.banners.length ? `banners ${r.banners.join(', ')}` : '', r.slots.length ? `slots ${r.slots.join(', ')}` : '', d.banner ? `manifest banner ${JSON.stringify(d.banner)}` : ''].filter(Boolean).join('; ')]);
    rows.push(['Library contributions (web/index.tsx)', Object.keys(r.libraryContributions).join(', ')]);
    rows.push(['Settings / storage keys', [...r.settingsKeys, ...r.storageKeys].join(', ')]);
    rows.push(['Shared server modules', uniq([...r.sharedServerModules, ...r.frameworkPython]).join(', ')]);
    rows.push(['Routes exposed', r.routeCount ? `${r.routeCount} (${r.websocketRoutes} websocket)` : '']);
    rows.push(['Commands (plugin-commands@1)', d.commands ? `${d.commands.auto ? 'auto; ' : ''}${d.commands.items.length} explicit${d.commands.voiceHints ? `, ${d.commands.voiceHints} with voice hints` : ''}` : 'none']);
    rows.push(['Scopes', d.scopes.join(', ')]);
    rows.push(['Data dir', d.dataDir ?? '']);
    rows.push(['Lifecycle files', [p.files.install ? 'install.mjs' : 'NO install.mjs', p.files.uninstall ? 'uninstall.mjs' : 'NO uninstall.mjs', p.files.hooks ? 'hooks.mjs' : '', p.files.readme ? 'README.md' : 'NO README.md', p.files.help ? 'help.json' : '', p.files.notify ? 'notify.json' : ''].filter(Boolean).join(', ')]);
    rows.push(['Tests / CLI scripts', uniq([...r.testFiles, ...r.cliScripts]).join(', ')]);
    rows.push(['Doc mentions (tagged)', p.docMentions.map((m) => `${m.file} (${m.lines})`).join(', ')]);
    rows.push(['Named by shell / framework (path or route)', [...p.folderRefs.consoleShell, ...p.folderRefs.framework].map((x) => `${x.file} (${x.count})`).join(', ')]);
    rows.push(['Folder word quoted in shell / framework (check by hand)', p.folderRefs.weak.map((x) => `${x.file} (${x.count})`).join(', ')]);
    const flags = [];
    if (res.usedNotDeclared.length) flags.push(`uses undeclared: ${res.usedNotDeclared.join(', ')}`);
    if (res.declaredNotUsed.length) flags.push(`declares but never looks up: ${res.declaredNotUsed.join(', ')}`);
    if (res.unprovidedCaps.length) flags.push(`looks up a capability nobody provides: ${res.unprovidedCaps.join(', ')}`);
    if (res.providesDeclaredNotInCode.length) flags.push(r.unresolvedProvides.length ? `declares a service not matched to a provide call (code has unresolved provide(s): ${r.unresolvedProvides.join(', ')}): ${res.providesDeclaredNotInCode.join(', ')}` : `declares a service the code never provides (manifest marker, CLI contract or web-only): ${res.providesDeclaredNotInCode.join(', ')}`);
    if (res.providesInCodeNotDeclared.length) flags.push(`provides in code without declaring: ${res.providesInCodeNotDeclared.join(', ')}`);
    if (res.folderNameCouplings.length) flags.push(`couples by folder name: ${res.folderNameCouplings.join(', ')}`);
    if (p.docMentionsUntagged.length) flags.push(`named in docs without the axf-plugin tag: ${p.docMentionsUntagged.join(', ')}`);
    rows.push(['Flags', flags.join('; ')]);
    L.push('| | |', '|---|---|');
    for (const [k, v] of rows) if (v) L.push(`| ${k} | ${String(v).replace(/\|/g, '\\|')} |`);
    L.push('');
  }
  return L.join('\n');
}

if (process.argv.includes('--json')) { process.stdout.write(JSON.stringify(out, null, 1)); }
else {
  writeFileSync(join(HERE, 'deps.json'), JSON.stringify(out, null, 1) + '\n');
  writeFileSync(join(HERE, 'DEPS.md'), md() + '\n');
  console.log(`${plugins.length} plugins → ${relative(ROOT, join(HERE, 'deps.json'))}, ${relative(ROOT, join(HERE, 'DEPS.md'))}`);
}
