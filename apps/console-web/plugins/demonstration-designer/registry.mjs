#!/usr/bin/env node
/**
 * The topics the Demonstration Designer can pitch, read from what the repo already registers (no hand-kept list):
 *
 *   plugins      apps/console-web/plugins/<folder>/plugin.json (name, description, the screens it provides) plus its
 *                help.json (help@1: what each screen and control does, in plain words)
 *   screens      the console's own screens from apps/console-web/src/assets/help/*.json (`view:<id>` entries) and
 *                their controls
 *   ui elements  apps/<app>/src/assets/ui-registry/*.json when an app ships one (ui-registry@1)
 *
 *   node apps/console-web/plugins/demonstration-designer/registry.mjs list [--kind plugin|screen|ui-element] [--json]
 *   node …/registry.mjs search <words> [--json]
 *   node …/registry.mjs get <topic id> [--json]
 *
 * Topic ids: plugin:<folder>, screen:<view>, ui-element:<app>:<id>. Env: AXF_REPO_ROOT. No model, no network.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeTopic, searchTopics } from './engine.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = process.env.AXF_REPO_ROOT || join(HERE, '../../../..');
const UI_REGISTRY_APPS = ['console-web', 'axhub-web', 'amberx-droid', 'walkthrough-studio', 'molly', 'demo'];

const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
const listJson = (dir) => (existsSync(dir) ? readdirSync(dir).filter((n) => n.endsWith('.json')).sort().map((n) => join(dir, n)) : []);
const titleCase = (s) => String(s).replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const slugLabel = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/** help@1 entries of a file: screens (`view:<id>` or kind screen) and controls, with the plain text of each. */
function helpOf(file) {
  const raw = readJson(file);
  if (raw?.$axf !== 'asset@1' || raw.type !== 'help') return { screens: new Map(), controls: [] };
  const screens = new Map();
  const controls = [];
  for (const h of raw.data?.entries ?? []) {
    const target = String(h?.target ?? h?.id ?? '').trim();
    if (!target || !h.title || !h.text) continue;
    if (target.startsWith('view:') || h.kind === 'screen') screens.set(target.replace(/^view:/, ''), { label: h.title, text: [h.text, h.more].filter(Boolean).join(' ') });
    else controls.push({ label: h.title, text: h.text, slug: target, draft: h.draft === true, kind: h.kind ?? '' });
  }
  return { screens, controls };
}

/** Which screen a control belongs to: a plugin with one page gets them all; more pages share them out in order, six each. */
function controlsByScreen(help, views) {
  const by = new Map(views.map((v) => [v, []]));
  const list = help.controls.filter((c) => !c.draft && c.kind !== 'screen').map((c) => ({ label: c.label, text: c.text, target: `text=${c.label}` }));
  if (!views.length) return by;
  if (views.length === 1) { by.get(views[0]).push(...list); return by; }
  list.forEach((c, i) => by.get(views[Math.min(views.length - 1, Math.floor(i / 6))]).push(c));
  return by;
}

/** The console's own help names many plugin screens too (`view:<id>` → title, text): the fallback for a plugin without one. */
function consoleScreens() {
  const all = new Map();
  for (const f of listJson(join(ROOT, 'apps/console-web/src/assets/help'))) { if (f.endsWith('-drafts.json')) continue; for (const [v, s] of helpOf(f).screens) if (!all.has(v)) all.set(v, s); }
  return all;
}

export function pluginTopics() {
  const dir = join(ROOT, 'apps/console-web/plugins');
  if (!existsSync(dir)) return [];
  const out = [];
  const known = consoleScreens();
  for (const folder of readdirSync(dir).filter((n) => !n.startsWith('_') && !n.startsWith('.')).sort()) {
    const p = readJson(join(dir, folder, 'plugin.json'));
    if (!p || p.$axf !== 'plugin@1') continue;
    const help = helpOf(join(dir, folder, typeof p.help === 'string' ? p.help : 'help.json'));
    const views = (p.provides ?? []).filter((x) => typeof x === 'string' && x.startsWith('view:')).map((x) => x.slice(5));
    const byScreen = controlsByScreen(help, views);
    const screens = views.map((v) => { const s = help.screens.get(v) ?? known.get(v); return { view: v, label: s?.label ?? (views.length === 1 ? p.name : titleCase(v)), text: s?.text ?? '', controls: byScreen.get(v) ?? [] }; });
    out.push(normalizeTopic({ id: `plugin:${folder}`, kind: 'plugin', label: p.name || titleCase(folder), description: p.description || '', app: 'console', plugin: folder, screens, keywords: [folder, ...(p.provides ?? [])] }));
  }
  return out;
}

export function screenTopics() {
  const out = [];
  for (const f of listJson(join(ROOT, 'apps/console-web/src/assets/help'))) {
    if (f.endsWith('-drafts.json')) continue;
    const help = helpOf(f);
    for (const [view, s] of help.screens) {
      // controls the console's help names for this screen: those whose text mentions the screen, else none
      const own = help.controls.filter((c) => !c.draft && c.kind !== 'screen' && new RegExp(`\\b${s.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(c.text)).slice(0, 6).map((c) => ({ label: c.label, text: c.text, target: `text=${c.label}` }));
      out.push(normalizeTopic({ id: `screen:${view}`, kind: 'screen', label: s.label, description: s.text, app: 'console', screens: [{ view, label: s.label, text: s.text, controls: own }], keywords: [view, slugLabel(s.label)] }));
    }
  }
  return out;
}

export function uiElementTopics() {
  const out = [];
  for (const app of UI_REGISTRY_APPS) {
    for (const f of listJson(join(ROOT, 'apps', app, 'src/assets/ui-registry'))) {
      const a = readJson(f);
      const items = a?.data?.items ?? a?.data?.entries ?? [];
      for (const it of Array.isArray(items) ? items : []) {
        if (!it?.id) continue;
        out.push(normalizeTopic({ id: `ui-element:${app}:${it.id}`, kind: 'ui-element', label: it.label || it.title || it.id, description: it.description || it.help || '', app, screens: it.view ? [{ view: it.view, label: it.label || it.id, text: it.description || '', controls: [] }] : [], keywords: [it.kind, ...(it.voice ?? [])] }));
      }
    }
  }
  return out;
}

/** Every topic, deduped by id (plugins first: a plugin's screen is pitched as part of the plugin unless asked for alone). */
export function allTopics() {
  const seen = new Map();
  for (const t of [...pluginTopics(), ...screenTopics(), ...uiElementTopics()]) if (!seen.has(t.id)) seen.set(t.id, t);
  return [...seen.values()].sort((a, b) => a.label.localeCompare(b.label, 'en', { sensitivity: 'base' }));
}

export const getTopic = (id) => allTopics().find((t) => t.id === id) ?? null;

/* ---------------- CLI ---------------- */

async function main(argv) {
  const [cmd = 'list', ...rest] = argv;
  const json = rest.includes('--json');
  const flag = (name) => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] ?? '' : ''; };
  const out = (v) => process.stdout.write(`${JSON.stringify(v)}\n`);
  if (cmd === 'list') {
    const kind = flag('--kind');
    const topics = allTopics().filter((t) => !kind || t.kind === kind);
    if (json) { out(topics.map((t) => ({ id: t.id, kind: t.kind, label: t.label, screens: t.screens.length, description: t.description.slice(0, 160) }))); return 0; }
    for (const t of topics) console.log(`${t.kind.padEnd(11)} ${t.id.padEnd(44)} ${t.label} (${t.screens.length} screens)`);
    return 0;
  }
  if (cmd === 'search') {
    const hits = searchTopics(allTopics(), rest.filter((x) => !x.startsWith('--')).join(' '), 30);
    if (json) { out(hits); return 0; }
    for (const t of hits) console.log(`${t.id.padEnd(44)} ${t.label} — ${t.description.slice(0, 90)}`);
    return 0;
  }
  if (cmd === 'get') { const t = getTopic(rest[0]); if (!t) { console.error(`registry: no topic ${rest[0]}`); return 2; } out(t); return 0; }
  console.error('usage: registry.mjs list [--kind k] [--json] | search <words> [--json] | get <id>');
  return 2;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exit(await main(process.argv.slice(2)));
