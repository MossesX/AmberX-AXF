#!/usr/bin/env node
// app-screens — the screens of an Android app built on AXF, in the shape boilerplate-capture.py reads
// (`{ id, screens: [{ id, label, kind }] }`), taken from the app's default nav-menu asset.
//
//   node framework/cli/app-screens.mjs apps/console [--out screens.json] [--max 12]
//
// Used by .github/workflows/rebuild-shots.yml (rebuild log: automatic Android before/after screenshots).
// Screens come from the nav-menu the app's axf.manifest.json picks as its default (`data.items` and every
// `data.sections[].items`), deduplicated by label, so a new app needs no CI change.
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const argv = process.argv.slice(2);
const dir = argv.find((a) => !a.startsWith('--'));
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
if (!dir) { console.error('usage: app-screens <appDir> [--out file] [--max 12]'); process.exit(2); }
const app = resolve(dir);
const manifest = JSON.parse(readFileSync(join(app, 'axf.manifest.json'), 'utf8'));
const navId = manifest.defaults?.['nav-menu'];
const SKIP = new Set(['build', 'node_modules', '.gradle', '.git']);

function findAsset(root, type, id) {
  const stack = [root];
  while (stack.length) {
    const d = stack.pop();
    let entries = [];
    try { entries = readdirSync(d); } catch { continue; }
    for (const e of entries) {
      if (SKIP.has(e)) continue;
      const p = join(d, e);
      let st; try { st = statSync(p); } catch { continue; }
      if (st.isDirectory()) stack.push(p);
      else if (e === `${id}.json` && d.split(/[\\/]/).pop() === type) return p;
    }
  }
  return null;
}

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64) || 'screen';
const screens = [];
const file = navId ? findAsset(app, 'nav-menu', navId) : null;
if (file && existsSync(file)) {
  const data = JSON.parse(readFileSync(file, 'utf8')).data ?? {};
  const items = [...(data.items ?? []), ...(data.sections ?? []).flatMap((s) => s.items ?? [])];
  const seen = new Set();
  for (const it of items) {
    if (!it?.label || seen.has(it.label)) continue;
    seen.add(it.label);
    let id = slug(it.id ?? it.view ?? it.label);
    while (screens.some((s) => s.id === id)) id = `${id}-x`.slice(0, 64);
    screens.push({ id, label: String(it.label), kind: 'app' });
    if (screens.length >= Number(opt('max', 12))) break;
  }
}
const out = { id: manifest.app?.id ?? slug(dir), nav: navId ?? null, navFile: file ? file.slice(app.length + 1) : null, screens };
const json = JSON.stringify(out, null, 2) + '\n';
const target = opt('out');
if (target) writeFileSync(target, json); else process.stdout.write(json);
if (!screens.length) console.error(`app-screens: no nav screens found for ${dir} (nav-menu ${navId ?? 'not set'}); only the start screen will be captured`);
