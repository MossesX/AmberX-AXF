#!/usr/bin/env node
// AX Notes plugin manager (axnotes-plugins@1). Every plugin's install.mjs / uninstall.mjs calls this; nothing else
// writes app/src/main/assets/axnotes/plugins.json (the installed list Gradle compiles in and the app loads).
//
//   node apps/ax-notes/plugins/manage.mjs list
//   node apps/ax-notes/plugins/manage.mjs install <folder>
//   node apps/ax-notes/plugins/manage.mjs uninstall <folder> [--all] [--dry-run]   (--all: also its code + doc lines)
//   node apps/ax-notes/plugins/manage.mjs check <folder> [--after-uninstall]        (exit 1 on problems)
//   node apps/ax-notes/plugins/manage.mjs check --all                               (every plugin folder + the list)
//
// On the phone, a removed plugin's data (its data module, settings, generated lists, triggers) is deleted by the app's
// plugin host on the next launch (PluginHostModule), from the footprint it recorded while the plugin was installed.
import { existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = resolve(HERE, '..');
const REPO = resolve(APP, '../..');
const LIST = join(APP, 'app/src/main/assets/axnotes/plugins.json');
const FORMAT = 'axnotes-plugins@1';
const FOLDER = /^[a-z0-9][a-z0-9-]{0,63}$/;
const ENTRY = /^ai\.amberx\.axf\.axnotes\.plugins\.[a-z0-9_.]+\.[A-Z][A-Za-z0-9_]*$/;
const DATA_PREFIX = 'ai.amberx.axf.axnotes.plugin.';
const PLUGIN_ID_PREFIX = 'ai.amberx.axf.axnotes.plugins.';

const readJson = (f) => JSON.parse(readFileSync(f, 'utf8'));
const rel = (f) => relative(REPO, f);

export function readList() {
  if (!existsSync(LIST)) return { $axf: FORMAT, description: '', installed: [] };
  const j = readJson(LIST);
  if (j.$axf !== FORMAT || !Array.isArray(j.installed)) throw new Error(`${rel(LIST)} is not ${FORMAT}`);
  return j;
}

function writeList(j, dry) {
  const text = JSON.stringify(j, null, 2).replace(/\{\n\s+"id": ([^\n]+),\n\s+"folder": ([^\n]+),\n\s+"entry": ([^\n]+)\n\s+\}/g, '{ "id": $1, "folder": $2, "entry": $3 }') + '\n';
  if (!dry) writeFileSync(LIST, text);
}

export function manifest(folder) {
  const f = join(HERE, folder, 'plugin.json');
  return existsSync(f) ? readJson(f) : null;
}

/** Problems with a plugin folder as an AX Notes plugin (empty = fine). */
export function validate(folder) {
  const p = [];
  if (!FOLDER.test(folder)) return [`bad folder name "${folder}"`];
  const m = manifest(folder);
  if (!m) return [`${folder}/plugin.json is missing`];
  if (m.$axf !== 'plugin@1') p.push('$axf must be plugin@1');
  if (typeof m.id !== 'string' || !m.id.startsWith(PLUGIN_ID_PREFIX) || m.id !== PLUGIN_ID_PREFIX + folder) p.push(`id must be ${PLUGIN_ID_PREFIX}${folder}`);
  if (m.kind !== 'module') p.push('kind must be module');
  if (!ENTRY.test(m.entry ?? '')) p.push('entry must be a class in ai.amberx.axf.axnotes.plugins.*');
  if (!(m.targets ?? []).includes('ax-notes')) p.push('targets must include ax-notes');
  if (!m.builtWith?.model || !/^\d{4}-\d{2}-\d{2}$/.test(m.builtWith?.builtAt ?? '')) p.push('builtWith {model, builtAt} is required');
  if (m.lifecycle?.$axf !== 'plugin-lifecycle@1') p.push('lifecycle (plugin-lifecycle@1) is required');
  if (m.lifecycle?.dataDir !== DATA_PREFIX + folder) p.push(`lifecycle.dataDir must be ${DATA_PREFIX}${folder}`);
  for (const k of m.lifecycle?.settings ?? []) if (!k.startsWith('app.')) p.push(`setting ${k} must start with app. (so uninstall can delete it)`);
  if (!(m.provides ?? []).includes(`settings-tab:${folder}`)) p.push(`provides must list settings-tab:${folder} (its sub-tab under Settings → Plugins)`);
  if (!(m.provides ?? []).includes('menu:app-menu') || !(m.provides ?? []).includes('menu:nav-menu')) p.push('menu hooks: provides must list menu:app-menu and menu:nav-menu');
  if (m.menus?.application !== true || m.menus?.nav !== true) p.push('menus: { application: true, nav: true } is required');
  for (const s of ['install.mjs', 'uninstall.mjs']) if (!existsSync(join(HERE, folder, s))) p.push(`${s} is missing`);
  if (m.entry) {
    const cls = m.entry.split('.').pop();
    const src = join(HERE, folder, 'src/main/kotlin', ...m.entry.split('.').slice(0, -1));
    if (!existsSync(src) || !readdirSync(src).some((f) => f.endsWith('.kt') && readFileSync(join(src, f), 'utf8').includes(`class ${cls}`))) p.push(`entry class ${cls} not found under src/main/kotlin`);
  }
  const trig = join(HERE, folder, 'assets/axnotes/plugins', folder, 'triggers.json');
  if (existsSync(trig)) {
    try {
      const t = readJson(trig);
      if (t.$axf !== 'axnotes-plugin-triggers@1') p.push('triggers.json must be axnotes-plugin-triggers@1');
      for (const x of t.triggers ?? []) if (x.module !== m.id) p.push(`trigger ${x.id} must belong to module ${m.id}`);
    } catch (e) { p.push(`triggers.json: ${e.message}`); }
  }
  return p;
}

/** Installed AX Notes plugins that require [id] (plugin:<id>). */
function dependents(id, list) {
  return list.installed.filter((e) => e.id !== id).filter((e) => (manifest(e.folder)?.requires ?? []).includes(`plugin:${id}`)).map((e) => e.folder);
}

function install(folder, { dry = false } = {}) {
  const problems = validate(folder);
  if (problems.length) { for (const x of problems) console.error(`✗ ${folder}: ${x}`); return 1; }
  const m = manifest(folder);
  const list = readList();
  const missing = (m.requires ?? []).filter((r) => r.startsWith(`plugin:${PLUGIN_ID_PREFIX}`)).map((r) => r.slice(7)).filter((id) => !list.installed.some((e) => e.id === id));
  if (missing.length) { console.error(`✗ ${folder} needs ${missing.join(', ')}: install that first`); return 1; }
  if (list.installed.some((e) => e.folder === folder)) { console.log(`✓ ${folder} is already installed`); return 0; }
  list.installed.push({ id: m.id, folder, entry: m.entry });
  writeList(list, dry);
  console.log(`${dry ? '(dry run) ' : ''}✓ installed ${m.name} (${m.id}) in ${rel(LIST)}; rebuild AX Notes to include it`);
  return 0;
}

function uninstall(folder, { all = false, dry = false } = {}) {
  if (!FOLDER.test(folder)) { console.error(`✗ bad folder name "${folder}"`); return 1; }
  const list = readList();
  const entry = list.installed.find((e) => e.folder === folder);
  const m = manifest(folder);
  const id = entry?.id ?? m?.id;
  const deps = id ? dependents(id, list) : [];
  if (deps.length) { console.error(`✗ ${deps.join(', ')} need(s) ${folder}: uninstall those first`); return 1; }
  if (entry) {
    list.installed = list.installed.filter((e) => e.folder !== folder);
    writeList(list, dry);
    console.log(`${dry ? '(dry run) ' : ''}✓ removed ${folder} from ${rel(LIST)} (Gradle no longer compiles it; the app purges its data on the next launch)`);
  } else console.log(`· ${folder} wasn't in ${rel(LIST)}`);
  if (all) {
    for (const f of mentionFiles(m)) {
      const text = readFileSync(f, 'utf8');
      const kept = text.split('\n').filter((l) => !l.includes(`axf-plugin:${folder} -->`));
      if (kept.length !== text.split('\n').length) {
        if (!dry) writeFileSync(f, kept.join('\n'));
        console.log(`${dry ? '(dry run) ' : ''}✓ removed ${text.split('\n').length - kept.length} line(s) from ${rel(f)}`);
      }
    }
    const dir = join(HERE, folder);
    if (existsSync(dir)) { if (!dry) rmSync(dir, { recursive: true, force: true }); console.log(`${dry ? '(dry run) ' : ''}✓ deleted ${rel(dir)}`); }
  }
  if (dry) return 0;
  return check(folder, { after: true, id, entry: entry?.entry ?? m?.entry, all });
}

function mentionFiles(m) {
  const out = new Set([join(APP, 'README.md')]);
  for (const f of m?.lifecycle?.mentions ?? []) out.add(resolve(REPO, f));
  return [...out].filter((f) => existsSync(f) && f.startsWith(REPO));
}

function walk(dir, out = []) {
  for (const n of existsSync(dir) ? readdirSync(dir) : []) {
    if (n === 'build' || n === '.gradle' || n.startsWith('.')) continue;
    const f = join(dir, n);
    if (statSync(f).isDirectory()) walk(f, out); else if (/\.(kt|kts|json|md|xml|pro|mjs)$/.test(n)) out.push(f);
  }
  return out;
}

/** After uninstall: nothing outside the plugin folder (or anything at all with --all) may still name it. */
function check(folder, { after = false, id = null, entry = null, all = false } = {}) {
  const problems = [];
  const list = readList();
  const m = manifest(folder);
  id = id ?? m?.id ?? PLUGIN_ID_PREFIX + folder;
  entry = entry ?? m?.entry ?? null;
  const pkg = entry ? entry.split('.').slice(0, -1).join('.') : null;
  if (after) {
    if (list.installed.some((e) => e.folder === folder || e.id === id)) problems.push(`still listed in ${rel(LIST)}`);
    const pluginDir = join(HERE, folder);
    for (const f of walk(APP)) {
      if (f.startsWith(pluginDir + '/') || f === join(HERE, 'manage.mjs')) continue;
      // A plain uninstall keeps the folder, so its tagged doc lines (<!-- axf-plugin:<folder> -->) may stay; --all removes them.
      const marker = `axf-plugin:${folder} -->`;
      const text = readFileSync(f, 'utf8').split('\n').filter((l) => all || !l.includes(marker)).join('\n');
      if (text.includes(id) || (pkg && text.includes(pkg)) || text.includes(marker)) problems.push(`${rel(f)} still names ${folder}`);
    }
    if (all && existsSync(pluginDir)) problems.push(`${rel(pluginDir)} still exists`);
  } else {
    problems.push(...validate(folder));
    if (!list.installed.some((e) => e.folder === folder)) console.log(`· ${folder} is not installed`);
  }
  for (const x of problems) console.error(`✗ ${folder}: ${x}`);
  if (!problems.length) console.log(`✓ ${folder}: ${after ? 'nothing left behind' : 'ok'}`);
  return problems.length ? 1 : 0;
}

function checkAll() {
  let bad = 0;
  const list = readList();
  for (const e of list.installed) if (!manifest(e.folder)) { console.error(`✗ ${rel(LIST)} lists ${e.folder}, which has no plugin.json`); bad++; }
  for (const d of readdirSync(HERE)) if (!d.startsWith('_') && existsSync(join(HERE, d, 'plugin.json'))) bad += check(d);
  return bad ? 1 : 0;
}

export function run(argv) {
  const [cmd, folder, ...rest] = argv;
  const flags = new Set(rest.concat(folder?.startsWith('--') ? [folder] : []));
  const dry = flags.has('--dry-run');
  try {
    switch (cmd) {
      case 'list': {
        const list = readList();
        for (const d of readdirSync(HERE).filter((d) => existsSync(join(HERE, d, 'plugin.json')))) {
          const m = manifest(d);
          console.log(`${list.installed.some((e) => e.folder === d) ? 'installed' : 'available'}  ${m.name}  (${m.id})  ${(m.requires ?? []).filter((r) => r.startsWith('plugin:')).join(' ')}`);
        }
        return 0;
      }
      case 'install': return install(folder, { dry });
      case 'uninstall': return uninstall(folder, { all: flags.has('--all'), dry });
      case 'check': return folder === '--all' ? checkAll() : check(folder, { after: flags.has('--after-uninstall') });
      default:
        console.error('usage: manage.mjs list | install <folder> | uninstall <folder> [--all] [--dry-run] | check <folder> [--after-uninstall] | check --all');
        return 2;
    }
  } catch (e) {
    console.error(`✗ ${e.message}`);
    return 1;
  }
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) process.exit(run(process.argv.slice(2)));
