#!/usr/bin/env node
/**
 * AX Notes Android plugin lifecycle (plugin-lifecycle@1 rules, Gradle-module flavour). Same file in every
 * apps/ax-notes/plugins/<folder>/; it works on the folder it sits in. install.mjs / uninstall.mjs call it.
 *
 * Every trace a plugin leaves outside its folder carries the marker `axf-plugin:<folder>` or is its entry in the
 * plugin list, and nothing else is ever edited:
 *   settings.gradle.kts            include(":plugins:<folder>")                          (Gradle module)
 *   app/build.gradle.kts           implementation(project(":plugins:<folder>"))          (on the app's classpath)
 *   app/src/main/assets/axnotes/plugins.json   {id, folder, entry, dataPrefix}           (the app loads `entry` by name)
 * On the phone a plugin keeps its data only under KV keys starting with `dataPrefix`; its "Remove plugin data" setting
 * (and the host, for plugins no longer listed) deletes them.
 *
 *   node install.mjs   [--dry-run] [--json]
 *   node uninstall.mjs [--all] [--dry-run] [--json]     --all also deletes this folder
 *   node uninstall.mjs --check                          stale-reference check only (exit 1 on hits)
 */
import { existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const FOLDER = basename(HERE);
const APP = join(HERE, '..', '..');
const MARK = `axf-plugin:${FOLDER}`;
const SETTINGS = join(APP, 'settings.gradle.kts');
const BUILD = join(APP, 'app', 'build.gradle.kts');
const LIST = join(APP, 'app', 'src', 'main', 'assets', 'axnotes', 'plugins.json');
const manifest = JSON.parse(readFileSync(join(HERE, 'plugin.json'), 'utf8'));
const x = manifest.x?.android ?? {};

function lines(file) { return existsSync(file) ? readFileSync(file, 'utf8').split('\n') : null; }

function addLine(file, line, before, out, dry) {
  const ls = lines(file);
  if (!ls) { out.push(`skip ${relative(APP, file)} (missing)`); return; }
  if (ls.some((l) => l.includes(MARK))) { out.push(`ok   ${relative(APP, file)} already wired`); return; }
  let at = before ? ls.findLastIndex(before) : -1;
  if (at < 0) at = ls.length && ls[ls.length - 1] === '' ? ls.length - 1 : ls.length;
  ls.splice(at, 0, line);
  if (!dry) writeFileSync(file, ls.join('\n'));
  out.push(`add  ${relative(APP, file)}: ${line.trim()}`);
}

function dropLines(file, out, dry) {
  const ls = lines(file);
  if (!ls) return;
  const kept = ls.filter((l) => !l.includes(MARK));
  if (kept.length === ls.length) return;
  if (!dry) writeFileSync(file, kept.join('\n'));
  out.push(`drop ${relative(APP, file)}: ${ls.length - kept.length} line(s)`);
}

function readList() {
  if (!existsSync(LIST)) return { $axf: 'axnotes-plugins@1', description: 'Android plugins the app loads by entry class (each entry is added and removed by that plugin\'s install.mjs / uninstall.mjs).', plugins: [] };
  return JSON.parse(readFileSync(LIST, 'utf8'));
}

function writeList(list, dry) {
  if (dry) return;
  mkdirSync(dirname(LIST), { recursive: true });
  writeFileSync(LIST, JSON.stringify(list, null, 2) + '\n');
}

export function install({ dry = false } = {}) {
  const out = [];
  addLine(SETTINGS, `include(":plugins:${FOLDER}") // ${MARK}`, null, out, dry);
  addLine(BUILD, `    implementation(project(":plugins:${FOLDER}")) // ${MARK}`, (l) => l.startsWith('}'), out, dry);
  const list = readList();
  const entry = { id: manifest.id, folder: FOLDER, entry: manifest.entry, dataPrefix: x.dataPrefix, version: manifest.version };
  list.plugins = (list.plugins ?? []).filter((p) => p.folder !== FOLDER && p.id !== manifest.id).concat([entry]);
  writeList(list, dry);
  out.push(`list ${relative(APP, LIST)}: ${manifest.id}`);
  return out;
}

export function uninstall({ dry = false, all = false } = {}) {
  const out = [];
  dropLines(SETTINGS, out, dry);
  dropLines(BUILD, out, dry);
  if (existsSync(LIST)) {
    const list = readList();
    const before = (list.plugins ?? []).length;
    list.plugins = (list.plugins ?? []).filter((p) => p.folder !== FOLDER && p.id !== manifest.id);
    if (list.plugins.length !== before) {
      if (list.plugins.length === 0) { if (!dry) rmSync(LIST); out.push(`drop ${relative(APP, LIST)} (no plugins left)`); }
      else { writeList(list, dry); out.push(`drop ${relative(APP, LIST)}: ${manifest.id}`); }
    }
  }
  out.push(`note on the phone: the app deletes KV keys "${x.dataPrefix}*" when the plugin is no longer listed (or use its "Remove plugin data" setting first)`);
  if (all) { if (!dry) rmSync(HERE, { recursive: true, force: true }); out.push(`drop plugins/${FOLDER}/ (code)`); }
  return out;
}

const SKIP = new Set(['.git', 'build', '.gradle', 'node_modules', 'intermediates']);
const TEXT = /\.(kt|kts|json|md|mjs|xml|txt|pro)$/i;

/** Every file in the app (outside this folder) that still names the plugin. */
export function check() {
  const needles = [MARK, `:plugins:${FOLDER}`, manifest.id, x.package].filter(Boolean);
  const hits = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      if (SKIP.has(name)) continue;
      const p = join(dir, name);
      if (p === HERE) continue;
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else if (TEXT.test(name)) {
        const text = readFileSync(p, 'utf8');
        for (const n of needles) if (text.includes(n)) { hits.push(`${relative(APP, p)}: ${n}`); break; }
      }
    }
  };
  walk(APP);
  return hits;
}

export function main(cmd, argv) {
  const dry = argv.includes('--dry-run');
  const json = argv.includes('--json');
  let out; let stale = [];
  if (cmd === 'install') out = install({ dry });
  else if (argv.includes('--check')) out = [];
  else out = uninstall({ dry, all: argv.includes('--all') });
  if (cmd === 'uninstall' && !dry) stale = check();
  if (json) console.log(JSON.stringify({ plugin: manifest.id, folder: FOLDER, cmd, dryRun: dry, steps: out, stale }));
  else {
    for (const l of out) console.log(l);
    if (cmd === 'uninstall') console.log(dry ? '(dry run: stale check skipped)' : stale.length ? `STALE references left:\n  ${stale.join('\n  ')}` : 'clean: nothing outside the folder names this plugin');
  }
  if (stale.length) process.exitCode = 1;
}
