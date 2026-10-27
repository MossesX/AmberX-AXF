#!/usr/bin/env node
/**
 * Take framework assets into an app, with everything they depend on (interface-roller s6, Oct 27 2026).
 *
 *   node framework/cli/app-assets.mjs deps <type/id>…                 what those assets need (json)
 *   node framework/cli/app-assets.mjs add  <app dir> <type/id>… [--dry-run] [--force]
 *
 * Sources, first match wins: framework/assets/<type>/<id>.json, then the brand library
 * (framework/brand-library/<type>/<id>.json). Dependencies are followed recursively:
 *   interface       → design, branding, every slot
 *   design-package  → its four themes + extras.slots
 *   style-package   → every member control
 *   branding        → mark / wordmark / lockup (logo-mark), animated (animated-logo), iconPack (icon-pack)
 *   animated-logo   → its mark
 *   toolbar         → widgets[];  banner → attach[]
 * An asset the app already has with the same content is left alone; one with other content is kept and reported
 * (the app's own copy wins) unless --force. Writes only into <app dir>/src/assets/<type>/<id>.json.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const SOURCES = [join(REPO, 'framework/assets'), join(REPO, 'framework/brand-library')];
const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

export function locate(type, id) {
  if (!ID.test(type) || !ID.test(id)) return null;
  for (const root of SOURCES) { const f = join(root, type, `${id}.json`); if (existsSync(f)) return f; }
  return null;
}

/** The direct dependencies of one asset, as `type/id` strings. */
export function directDeps(a) {
  const d = a.data ?? {};
  const out = [];
  const add = (t, id) => { if (typeof t === 'string' && typeof id === 'string' && id) out.push(`${t}/${id}`); };
  if (a.type === 'interface') { add('design-package', d.design); add('branding', d.branding); for (const [t, id] of Object.entries(d.slots ?? {})) add(t, id); }
  if (a.type === 'design-package') { for (const t of ['style-theme', 'color-theme', 'layout', 'behavior-theme']) add(t, d[t]); for (const [t, id] of Object.entries(d.extras?.slots ?? {})) add(t, id); }
  if (a.type === 'style-package') for (const [t, id] of Object.entries(d.slots ?? {})) add(t, id);
  if (a.type === 'branding') { for (const [k, id] of Object.entries(d.marks ?? {})) add(k === 'animated' ? 'animated-logo' : 'logo-mark', id); add('icon-pack', d.iconPack); }
  if (a.type === 'animated-logo') add('logo-mark', d.mark);
  if (a.type === 'toolbar') for (const w of d.widgets ?? []) add(w.type, w.id);
  if (a.type === 'banner') for (const w of d.attach ?? []) add(w.type, w.id);
  return out;
}

/** Every asset reachable from `refs` (themselves included), and the refs no source has. */
export function closure(refs) {
  const seen = new Map(); const missing = [];
  const stack = [...refs];
  while (stack.length) {
    const ref = stack.pop();
    if (seen.has(ref)) continue;
    const [type, id] = ref.split('/');
    const file = locate(type, id);
    if (!file) { if (!missing.includes(ref)) missing.push(ref); seen.set(ref, null); continue; }
    const a = JSON.parse(readFileSync(file, 'utf8'));
    seen.set(ref, { file, asset: a });
    stack.push(...directDeps(a));
  }
  return { assets: [...seen.entries()].filter(([, v]) => v).map(([ref, v]) => ({ ref, ...v })), missing };
}

export function addToApp(appDir, refs, { dryRun = false, force = false } = {}) {
  const { assets, missing } = closure(refs);
  const res = { added: [], same: [], kept: [], missing };
  for (const { ref, asset } of assets) {
    const [type, id] = ref.split('/');
    const to = join(appDir, 'src', 'assets', type, `${id}.json`);
    const text = JSON.stringify(asset, null, 2) + '\n';
    if (existsSync(to)) {
      const cur = readFileSync(to, 'utf8');
      if (cur === text || JSON.stringify(JSON.parse(cur)) === JSON.stringify(asset)) { res.same.push(ref); continue; }
      if (!force) { res.kept.push(ref); continue; }
    }
    if (!dryRun) { mkdirSync(dirname(to), { recursive: true }); writeFileSync(to, text); }
    res.added.push(ref);
  }
  return res;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [cmd, ...rest] = process.argv.slice(2);
  const flags = new Set(rest.filter((x) => x.startsWith('--')));
  const args = rest.filter((x) => !x.startsWith('--'));
  if (cmd === 'deps') { const c = closure(args); console.log(JSON.stringify({ assets: c.assets.map((a) => a.ref).sort(), missing: c.missing }, null, 2)); process.exit(c.missing.length ? 1 : 0); }
  if (cmd === 'add') {
    const [app, ...refs] = args;
    if (!app || !refs.length) { console.error('usage: app-assets.mjs add <app dir> <type/id>…'); process.exit(2); }
    const r = addToApp(resolve(app), refs, { dryRun: flags.has('--dry-run'), force: flags.has('--force') });
    console.log(`${flags.has('--dry-run') ? 'would add' : 'added'} ${r.added.length}, already there ${r.same.length}, app's own copy kept ${r.kept.length}${r.kept.length ? ` (${r.kept.join(', ')})` : ''}${r.missing.length ? `, missing ${r.missing.join(', ')}` : ''}`);
    process.exit(r.missing.length ? 1 : 0);
  }
  console.error('usage: app-assets.mjs deps|add …'); process.exit(2);
}
