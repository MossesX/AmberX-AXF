#!/usr/bin/env node
/**
 * new-plugin — start a console plugin from apps/console-web/plugins/_template, with its settings already wired.
 *
 * Brett, Nov 16 2026: "They all need a settings page. They all need a settings interface." Every new plugin starts with
 * what every plugin must have (plugin-settings@1, core/plugin-settings.mjs):
 *   - plugin.json "settings": its Settings → Plugins sub-tab (tab = the folder name), the default sections
 *     (enable, info, logs) plus options, its option keys, gear true;
 *   - web/index.tsx: the sub-tab (settingsTabs, parent plugins), one example option registered under it, and the
 *     screen's header as PluginScreenHeader, whose gear opens the sub-tab;
 *   - install / uninstall / hooks / help / menu / server renamed to the folder (plugin-lifecycle@1).
 * The REST, MCP, CLI and voice routes of the settings come with it: the Plugin Manager's /settings/<folder>,
 * `axf plugin-settings … <folder>` and plugin.settings.* reach any plugin with a block.
 *
 *   node framework/cli/new-plugin.mjs <folder> [--name "Display name"] [--description "…"] [--dry-run] [--json]
 *
 * <folder>: lowercase letters, digits and dashes (2-48). Refuses an existing folder. Prints what it wrote and the
 * checks to run next.
 */
import { cpSync, existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { checkSettings } from '../core/plugin-settings.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const PLUGINS = join(ROOT, 'apps', 'console-web', 'plugins');
export const TEMPLATE = join(PLUGINS, '_template');
const FOLDER = /^[a-z0-9][a-z0-9-]{1,47}$/;
const TEXT = /\.(json|mjs|js|ts|tsx|py|md|css)$/;
const SKIP = new Set(['__pycache__', 'node_modules']);

/** "voice-notes" → "Voice notes". */
export const nameOf = (folder) => folder.split('-').filter(Boolean).map((w, i) => (i ? w : w[0].toUpperCase() + w.slice(1))).join(' ');
/** "voice-notes" → "voicenotes" (the id segment, like the console's own plugins). */
const idPart = (folder) => folder.replace(/-/g, '');

/** The template's text with every name of the example replaced. Pure. */
export function rename(text, { folder, name, id }) {
  const pascal = folder.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join('');
  return text
    .replaceAll('ai.amberx.axf.console.example', id)
    .replace(/\bExampleView\b/g, `${pascal}View`)
    .replace(/\bExample\b/g, name)
    .replace(/\bexample\b/g, folder);
}

function walk(dir) {
  return readdirSync(dir).flatMap((n) => {
    if (SKIP.has(n)) return [];
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

export function newPlugin(folder, { name = nameOf(folder), description = '', dryRun = false, plugins = PLUGINS, template = TEMPLATE } = {}) {
  if (!FOLDER.test(folder)) throw new Error(`"${folder}" is not a plugin folder name (lowercase letters, digits, dashes; 2-48)`);
  const dest = join(plugins, folder);
  if (existsSync(dest)) throw new Error(`plugins/${folder} already exists`);
  const id = `ai.amberx.axf.console.${idPart(folder)}`;
  const files = walk(template);
  const out = [];
  for (const f of files) {
    const rel = relative(template, f);
    out.push({ path: join(dest, rel), text: TEXT.test(f) ? rename(readFileSync(f, 'utf8'), { folder, name, id }) : null, from: f });
  }
  // plugin.json: description, and the settings block checked before anything is written
  const mf = out.find((x) => x.path === join(dest, 'plugin.json'));
  const m = JSON.parse(mf.text);
  m.description = description || `${name}: describe what this plugin does in one plain sentence.`;
  m.builtWith = { model: '', builtAt: new Date().toISOString().slice(0, 10) };
  const problems = checkSettings(m, { folder });
  if (problems.length) throw new Error(`the template's settings block is wrong: ${problems.join('; ')}`);
  mf.text = `${JSON.stringify(m, null, 2)}\n`;
  if (!dryRun) {
    cpSync(template, dest, { recursive: true, filter: (src) => !SKIP.has(src.split('/').pop()) });
    for (const x of out) if (x.text !== null) writeFileSync(x.path, x.text);
    const pyc = join(dest, 'server', '__pycache__');
    if (existsSync(pyc)) rmSync(pyc, { recursive: true, force: true });
  }
  return { folder, id, name, tab: m.settings.tab, settings: m.settings, files: out.map((x) => relative(ROOT, x.path)), dryRun };
}

export async function main(argv, io = { log: (s) => console.log(s), error: (s) => console.error(s) }) {
  const words = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { words.push(a); continue; }
    const k = a.slice(2);
    if ((k === 'name' || k === 'description') && i + 1 < argv.length) flags[k] = argv[++i];
    else flags[k] = true;
  }
  if (!words[0]) { io.error('usage: node framework/cli/new-plugin.mjs <folder> [--name "Display name"] [--description "…"] [--dry-run] [--json]'); return 2; }
  let r;
  try { r = newPlugin(words[0], { name: flags.name, description: flags.description, dryRun: !!flags['dry-run'] }); } catch (e) { io.error(`✗ ${e.message}`); return 1; }
  if (flags.json) { io.log(JSON.stringify(r, null, 2)); return 0; }
  io.log(`${r.dryRun ? '(dry run) would create' : '✓ created'} plugins/${r.folder} — ${r.name} (${r.id})`);
  io.log(`  settings: Settings → Plugins → ${r.name} (tab ${r.tab}), sections ${r.settings.sections.join(', ')}, options ${r.settings.options.join(', ') || 'none'}, gear on its screen header`);
  io.log(`  reach it: axf plugin-settings get ${r.folder} · REST /api/plugins/plugin-manager/settings/${r.folder} · voice plugin.settings.open:${r.folder}`);
  io.log('  next: node framework/cli/plugin-lifecycle.mjs check ' + r.folder + ' · node framework/spec/check-plugin-settings.mjs · node framework/cli/check-plugin-settings.mjs');
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) process.exit(await main(process.argv.slice(2)));
