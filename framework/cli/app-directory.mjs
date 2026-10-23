#!/usr/bin/env node
/**
 * app-directory.mjs — the framework's app directory (app-directory@1): every web app built with or for AmberX that has a
 * home on the web, in one list any app can pick from (Patches' tabs, the console's App tabs).
 *
 *   node framework/cli/app-directory.mjs            write framework/libs/apps/directory.json
 *   node framework/cli/app-directory.mjs --check    fail when that file is out of date (CI)
 *   node framework/cli/app-directory.mjs --json     print it
 *
 * Sources (an id is listed once; the first source wins):
 *  1. this repo's project manifests: kind app, framework.relation core | built-on | for, an https deploy.url; the
 *     optional `x.app` block names its tab id, label, icon, start path, settings path and how it understands embedding
 *     (`axf` = embed@1 guest, `marker` = reads the marker by convention, `none`), `host: true` for an app that hosts
 *     others (it is listed but never offered as a tab of itself)
 *  2. framework/libs/apps/external.json: framework apps whose manifest lives in another repo (Build Pilot, axHub)
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = join(ROOT, 'framework', 'libs', 'apps', 'directory.json');
const EXTERNAL = join(ROOT, 'framework', 'libs', 'apps', 'external.json');

const ID = /^[a-z0-9][a-z0-9-]{0,47}$/;
const TAB = /^[a-z][a-z0-9-]{0,23}$/;
const PATH = /^\/[A-Za-z0-9._~\/-]{0,120}$/;
const EMBEDS = new Set(['axf', 'marker', 'none']);
const RELATIONS = new Set(['core', 'built-on', 'for']);
/** the three tabs every developer host had first keep the front of the list */
const ORDER = { console: 10, pilot: 20, axhub: 30 };

export function httpsOrigin(raw) {
  if (typeof raw !== 'string' || raw.length > 200) return null;
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== 'https:' || u.username || u.password || !u.hostname) return null;
    return u.origin;
  } catch { return null; }
}

const str = (v, n) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : '');

/** One directory entry from a manifest-like record, or null with why. */
export function entryFrom(src, from) {
  const x = (src.x && typeof src.x === 'object' && src.x.app && typeof src.x.app === 'object') ? src.x.app : src;
  const id = src.id ?? src.name;
  if (typeof id !== 'string' || !ID.test(id)) return { error: `bad id ${JSON.stringify(id)}` };
  const origin = httpsOrigin(src.url ?? src.deploy?.url);
  if (!origin) return { error: `${id}: no https address` };
  const tab = typeof x.tab === 'string' ? x.tab : id;
  if (!TAB.test(tab)) return { error: `${id}: bad tab id ${JSON.stringify(tab)}` };
  const path = typeof x.path === 'string' ? x.path : '/';
  if (!PATH.test(path)) return { error: `${id}: bad path` };
  const settingsPath = typeof x.settingsPath === 'string' ? x.settingsPath : null;
  if (settingsPath !== null && !PATH.test(settingsPath)) return { error: `${id}: bad settings path` };
  const embed = typeof x.embed === 'string' ? x.embed : 'none';
  if (!EMBEDS.has(embed)) return { error: `${id}: embed must be axf, marker or none` };
  const name = str(src.displayName, 60) || str(src.name === id ? '' : src.name, 60) || str(x.name, 60) || id;
  const label = str(x.label, 24) || name.slice(0, 24);
  const e = { id, tab, label, name, icon: str(x.icon, 32) || 'external', origin, path, settingsPath, embed, host: x.host === true, description: str(src.description ?? x.description, 240), from, order: ORDER[tab] ?? 100 };
  if (typeof src.repo === 'string') e.repo = src.repo;
  else if (src.repo && typeof src.repo.owner === 'string' && typeof src.repo.name === 'string') e.repo = `${src.repo.owner}/${src.repo.name}`;
  return { entry: e };
}

function manifests() {
  const files = [join(ROOT, 'project.manifest.json')];
  const apps = join(ROOT, 'apps');
  if (existsSync(apps)) for (const d of readdirSync(apps, { withFileTypes: true })) if (d.isDirectory()) {
    const f = join(apps, d.name, 'project.manifest.json');
    if (existsSync(f)) files.push(f);
  }
  return files;
}

export function buildDirectory() {
  const out = [];
  const notes = [];
  const seen = new Set();
  const tabs = new Set();
  const add = (r, where) => {
    if (r.error) { notes.push(`${where}: ${r.error}`); return; }
    const e = r.entry;
    if (seen.has(e.id) || tabs.has(e.tab)) { notes.push(`${where}: ${e.id} (tab ${e.tab}) listed already, skipped`); return; }
    seen.add(e.id); tabs.add(e.tab); out.push(e);
  };
  for (const f of manifests()) {
    const m = JSON.parse(readFileSync(f, 'utf8'));
    if (m.kind !== 'app' || !RELATIONS.has(m.framework?.relation) || !m.deploy?.url) continue;
    add(entryFrom(m, 'manifest'), relative(ROOT, f));
  }
  for (const a of JSON.parse(readFileSync(EXTERNAL, 'utf8')).apps ?? []) add(entryFrom(a, 'external'), 'external.json');
  out.sort((a, b) => a.order - b.order || a.label.localeCompare(b.label));
  return { doc: { $axf: 'app-directory@1', note: 'Generated by framework/cli/app-directory.mjs from the project manifests (deploy.url + x.app) and external.json. Do not edit by hand.', apps: out }, notes };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { doc, notes } = buildDirectory();
  const text = JSON.stringify(doc, null, 2) + '\n';
  for (const n of notes) console.error(`note: ${n}`);
  if (process.argv.includes('--json')) process.stdout.write(text);
  else if (process.argv.includes('--check')) {
    const now = existsSync(OUT) ? readFileSync(OUT, 'utf8') : '';
    if (now !== text) { console.error('framework/libs/apps/directory.json is out of date: run node framework/cli/app-directory.mjs'); process.exit(1); }
    console.log(`app directory in sync (${doc.apps.length} apps)`);
  } else {
    writeFileSync(OUT, text);
    console.log(`wrote ${relative(ROOT, OUT)}: ${doc.apps.map((a) => a.tab).join(', ')}`);
  }
}
