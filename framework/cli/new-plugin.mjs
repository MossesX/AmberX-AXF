#!/usr/bin/env node
/**
 * new-plugin — scaffold a console plugin from apps/console-web/plugins/_template (plugin-lifecycle@1), with three
 * layouts per screen and the hidden layout switcher already in place (screen-layouts@1, Brett Nov 4 2026: "From now
 * on, all plugin screens get three layouts, and come with a toolbar to select which one, with the toolbar hidden by
 * default."). Every screen it makes passes check-screen-layouts.mjs; rename the layouts to what fits the screen.
 *
 *   node framework/cli/new-plugin.mjs <folder> [--label "Name"] [--id ai.amberx.axf.console.<folder>] [--view <id>]
 *        [--app apps/console-web] [--model fable|opus] [--description "…"] [--dry-run]
 *   axf new-plugin <folder> …
 *
 * Folder: kebab-case (`my-thing`). The view id defaults to the folder. The copy replaces every "example" id, label and
 * data dir; plugin.json gets the id, name, screens (3 layouts + default) and builtWith (model + today).
 */
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { STARTER_DEFAULT, STARTER_LAYOUTS } from '../core/engines/screen-layouts.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const FOLDER_RE = /^[a-z0-9][a-z0-9-]{1,47}$/;
const ID_RE = /^[a-z][a-z0-9]*(\.[a-z][a-z0-9-]*)+$/;

const title = (slug) => slug.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');

function walk(d, out = []) { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) walk(p, out); else out.push(p); } return out; }

export function newPlugin({ folder, label, id, view, app = 'apps/console-web', model = 'opus', description = '', dryRun = false, root = ROOT, log = () => {} }) {
  if (!FOLDER_RE.test(folder || '')) throw new Error('folder is kebab-case, e.g. my-thing');
  const pluginsDir = join(root, app, 'plugins');
  const src = join(pluginsDir, '_template');
  const dest = join(pluginsDir, folder);
  if (!existsSync(src)) throw new Error(`no template at ${relative(root, src)}`);
  if (existsSync(dest)) throw new Error(`${relative(root, dest)} exists already`);
  const pid = id || `ai.amberx.axf.console.${folder}`;
  if (!ID_RE.test(pid)) throw new Error('id is namespaced, e.g. ai.amberx.axf.console.my-thing');
  const viewId = view || folder;
  const name = label || title(folder);
  const cls = name.replace(/[^A-Za-z0-9]+/g, '');
  const today = new Date().toISOString().slice(0, 10);
  const files = [];
  for (const f of walk(src)) {
    const rel = relative(src, f);
    let text = readFileSync(f, 'utf8');
    if (rel === 'plugin.json') {
      const m = JSON.parse(text);
      m.id = pid; m.name = name; m.description = description || `${name} console plugin.`;
      m.provides = (m.provides ?? []).map((p) => p.replace(/example/g, viewId));
      if (m.lifecycle?.dataDir) m.lifecycle.dataDir = m.lifecycle.dataDir.replace(/example/g, folder);
      m.screens = { [viewId]: { layouts: STARTER_LAYOUTS.map((l) => ({ ...l })), default: STARTER_DEFAULT } };
      m.builtWith = { ...(m.builtWith ?? {}), model, builtAt: today };
      text = JSON.stringify(m, null, 2) + '\n';
    } else {
      text = text
        .replace(/ai\.amberx\.axf\.console\.example/g, pid)
        .replace(/ExampleView/g, `${cls}View`)
        .replace(/'Example'/g, `'${name.replace(/'/g, "\\'")}'`)
        .replace(/<h1>Example<\/h1>/g, `<h1>${name}</h1>`)
        .replace(/const FOLDER = 'example'/g, `const FOLDER = '${folder}'`)
        .replace(/const VIEW = 'example'/g, `const VIEW = '${viewId}'`)
        .replace(/\bexample\b/g, viewId)
        .replace(/Copy this folder \(without the leading underscore\) to start a console plugin\./g, `${name}.`);
    }
    files.push({ path: join(dest, rel), text });
  }
  if (!dryRun) {
    mkdirSync(dest, { recursive: true });
    for (const f of files) { mkdirSync(dirname(f.path), { recursive: true }); writeFileSync(f.path, f.text); }
    log(`✓ ${relative(root, dest)}: ${files.length} files (${pid}, view ${viewId}, ${STARTER_LAYOUTS.length} layouts, layout toolbar hidden by default)`);
  }
  return { dir: dest, id: pid, view: viewId, files: files.map((f) => relative(root, f.path)) };
}

export function main(argv) {
  const flags = {}; const args = [];
  for (let i = 0; i < argv.length; i++) { const a = argv[i]; if (a.startsWith('--')) { const k = a.slice(2); const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true; flags[k] = v; } else args.push(a); }
  if (!args[0]) { console.error('Usage: axf new-plugin <folder> [--label "Name"] [--id …] [--view <id>] [--app apps/console-web] [--model fable|opus] [--description "…"] [--dry-run]'); return 1; }
  const r = newPlugin({ folder: args[0], label: flags.label, id: flags.id, view: flags.view, app: flags.app, model: flags.model, description: flags.description, dryRun: !!flags['dry-run'], log: (m) => console.log(m) });
  if (flags['dry-run']) console.log(r.files.join('\n'));
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exit(main(process.argv.slice(2))); } catch (e) { console.error(`✗ ${e.message}`); process.exit(1); }
}
