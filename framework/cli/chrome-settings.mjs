#!/usr/bin/env node
/**
 * chrome-settings — every app has a custom settings interface for every chrome type (chrome-settings@1; Brett, Nov 4
 * 2026, build tab-group-assets, addendum 2: "there will be another one that will make a customized one for every app").
 *
 *   node framework/cli/chrome-settings.mjs backfill [--check] [app dir…]   write the missing custom copies (default: every
 *                                                                          app in framework/schemas/shared-assets.json + apps/expenses)
 *   node framework/cli/chrome-settings.mjs check [app dir…]                exit 1 when a copy is missing, stale in shape, or invalid
 *   node framework/cli/chrome-settings.mjs list                            the plan: type → default id → custom id, per app
 *   node framework/cli/chrome-settings.mjs overrides [--json]              every asset controlled by its own settings (the open console)
 *   node framework/cli/chrome-settings.mjs reset-all --confirm [--json]    Reset all asset overrides; prints the undo id
 *   node framework/cli/chrome-settings.mjs undo <ra-…|last> [--json]       take a Reset all back
 *       (the theme-manager routes /api/plugins/theme-manager/overrides | reset-all | reset-all/undo; AXF_CONSOLE_URL, AXF_TOKEN)
 *
 * The copy is `customCopy(default, app)` from core/engines/chrome-settings-rules.mjs: the default's data plus
 * `extends` = the default's id (inherit@1). It is written once; an existing copy is never overwritten (it may have
 * been edited), only reported. `axf init` writes the same copies for a new app (build-engine.mjs).
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHROME_TYPES, chromeSettingsCustomId, chromeSettingsDefaultId, chromeSettingsErrors, customCopy } from '../core/engines/chrome-settings-rules.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const FRAMEWORK_SETTINGS = join(ROOT, 'framework/assets/settings');

const readJson = (f) => JSON.parse(readFileSync(f, 'utf8'));

/** The apps that must carry the copies: the shared-assets apps plus Expenses (its own core line; the files ship for its port). */
export function defaultApps() {
  const shared = readJson(join(ROOT, 'framework/schemas/shared-assets.json')).apps ?? [];
  const extra = ['apps/expenses'];
  return [...shared, ...extra.filter((d) => !shared.includes(d))].map((d) => join(ROOT, d)).filter((d) => existsSync(d));
}

/** An app's id and name: axf.manifest.json (app.id / app.name) else project.manifest.json (name / displayName). */
export function appIdentity(dir) {
  const axf = join(dir, 'axf.manifest.json');
  if (existsSync(axf)) { const m = readJson(axf); return { id: m.app?.id ?? m.app?.name ?? relative(ROOT, dir), name: m.app?.name ?? m.app?.id ?? relative(ROOT, dir) }; }
  const pm = join(dir, 'project.manifest.json');
  if (existsSync(pm)) { const m = readJson(pm); return { id: m.name ?? relative(ROOT, dir), name: m.displayName ?? m.name ?? relative(ROOT, dir) }; }
  return { id: relative(ROOT, dir).split('/').pop(), name: relative(ROOT, dir) };
}

/** Where an app keeps its own settings assets (apps on the framework: src/assets/settings; others: the same path, created). */
export function settingsDir(dir) {
  const axf = join(dir, 'axf.manifest.json');
  if (existsSync(axf)) { const t = readJson(axf).framework?.template; const map = { 'react-ts': 'src/assets', 'next-ts': 'src/assets' }; return join(dir, map[t] ?? 'src/assets', 'settings'); }
  return join(dir, 'src/assets/settings');
}

export function sharedDefaults() {
  const out = {};
  for (const t of CHROME_TYPES) {
    const f = join(FRAMEWORK_SETTINGS, `${chromeSettingsDefaultId(t)}.json`);
    if (existsSync(f)) out[t] = readJson(f);
  }
  return out;
}

/**
 * Write the copies an app is missing into `settingsDir` for `app` ({ id, name }). Returns { written, kept, bad }.
 * `defaults` = sharedDefaults(); pass `dry` to only report.
 */
export function writeCopies(settingsDirPath, app, defaults = sharedDefaults(), { dry = false } = {}) {
  const written = [], kept = [], bad = [];
  for (const t of CHROME_TYPES) {
    const d = defaults[t];
    if (!d) { bad.push(`${chromeSettingsDefaultId(t)}: shared default missing in framework/assets/settings`); continue; }
    const id = chromeSettingsCustomId(t, app.id);
    const f = join(settingsDirPath, `${id}.json`);
    if (existsSync(f)) {
      const errs = chromeSettingsErrors(readJson(f));
      if (errs.length) bad.push(`${f}: ${errs.join('; ')}`); else kept.push(f);
      continue;
    }
    const copy = customCopy(d, app);
    if (!dry) { mkdirSync(settingsDirPath, { recursive: true }); writeFileSync(f, JSON.stringify(copy, null, 2) + '\n'); }
    written.push(f);
  }
  return { written, kept, bad };
}

/** Every finding for an app: missing copies, invalid ones, a copy whose `extends` isn't its default. */
export function checkApp(dir, defaults = sharedDefaults()) {
  const app = appIdentity(dir);
  const sdir = settingsDir(dir);
  const findings = [];
  for (const t of CHROME_TYPES) {
    if (!defaults[t]) findings.push(`${chromeSettingsDefaultId(t)}: shared default missing`);
    const id = chromeSettingsCustomId(t, app.id);
    const f = join(sdir, `${id}.json`);
    if (!existsSync(f)) { findings.push(`${relative(ROOT, f)}: missing (node framework/cli/chrome-settings.mjs backfill)`); continue; }
    let a; try { a = readJson(f); } catch (e) { findings.push(`${relative(ROOT, f)}: ${e.message}`); continue; }
    const errs = chromeSettingsErrors(a);
    if (a.id !== id) errs.push(`id must be ${id}`);
    if (a.type !== 'settings') errs.push('type must be settings');
    if (a.data?.for !== t) errs.push(`data.for must be ${t}`);
    if (a.data?.extends !== chromeSettingsDefaultId(t)) errs.push(`data.extends must be ${chromeSettingsDefaultId(t)}`);
    for (const e of errs) findings.push(`${relative(ROOT, f)}: ${e}`);
  }
  return { app, dir: sdir, findings };
}

/* ---- asset overrides: Reset all (build reset-all-button-every-asset-override) ---- */

/** The theme-manager routes the override commands call (they drive the open console through console-control@1). */
export const OVERRIDE_COMMANDS = {
  overrides: { method: 'GET', path: '/overrides', help: 'every asset controlled by its own settings in the open console' },
  'reset-all': { method: 'POST', path: '/reset-all', help: 'reset every asset override (needs --confirm); prints the undo id' },
  undo: { method: 'POST', path: '/reset-all/undo', help: 'undo a Reset all: undo <ra-…|last>' },
};

/** One override command as a request: { method, path, body } or { error }. Pure (tests read it). */
export function overrideRequest(cmd, args = [], flags = new Set()) {
  const c = OVERRIDE_COMMANDS[cmd];
  if (!c) return { error: `unknown command ${cmd}` };
  if (cmd === 'reset-all') return flags.has('--confirm') ? { method: c.method, path: c.path, body: { confirm: true, reason: 'Reset all asset overrides (CLI)' } } : { error: 'reset-all clears every asset override: run it again with --confirm' };
  if (cmd === 'undo') return { method: c.method, path: c.path, body: { undoId: args[0] || 'last' } };
  return { method: c.method, path: c.path };
}

/** Call the theme-manager route on the console (AXF_CONSOLE_URL, default https://console.amberxai.com; AXF_TOKEN). */
export async function overrideCall(req, { base = process.env.AXF_CONSOLE_URL || 'https://console.amberxai.com', token = process.env.AXF_TOKEN || '', fetch: f = globalThis.fetch } = {}) {
  const url = `${base.replace(/\/$/, '')}/api/plugins/theme-manager${req.path}`;
  try {
    const res = await f(url, { method: req.method, headers: { ...(req.body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) }, ...(req.body ? { body: JSON.stringify(req.body) } : {}) });
    const text = await res.text();
    let data; try { data = JSON.parse(text); } catch { data = { detail: text.slice(0, 200) }; }
    return { ok: res.ok, status: res.status, data };
  } catch (e) { return { ok: false, status: 0, data: { detail: `could not reach ${url}: ${String(e?.message ?? e).slice(0, 200)}` } }; }
}

/** Readable lines for an override answer. */
export function describeOverrides(cmd, r) {
  if (!r.ok) { const d = r.data?.detail; return [`✗ ${r.status || 'offline'}: ${typeof d === 'string' ? d : d?.message ?? JSON.stringify(d)}`, ...(d?.openUrl ? [`  open the console: ${d.openUrl}`] : [])]; }
  const d = r.data ?? {};
  if (cmd === 'reset-all') return d.reset?.length ? [`✓ reset ${d.reset.length}: ${d.reset.join(', ')}`, `  undo: node framework/cli/chrome-settings.mjs undo ${d.undoId}`] : ['✓ nothing to reset (no asset overrides)'];
  const lines = cmd === 'undo' ? [`✓ undone ${d.undone}`] : [];
  lines.push(`${d.count ?? 0} asset(s) controlled by their own settings`);
  for (const o of d.overrides ?? []) lines.push(`  ${o.id}  ${Object.keys(o.fields ?? {}).length} field(s)${o.asset ? ` · asset ${o.asset}` : ''}${o.interface ? ` · interface ${o.interface}` : ''}${o.tokens ? ` · ${Object.keys(o.tokens).length} token(s)` : ''}`);
  if (d.undo?.length) lines.push(`  undo ids: ${d.undo.map((u) => u.id).join(', ')}`);
  return lines;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const [cmd = 'check', ...rest] = process.argv.slice(2);
  if (Object.hasOwn(OVERRIDE_COMMANDS, cmd)) {
    const fl = new Set(rest.filter((a) => a.startsWith('--')));
    const req = overrideRequest(cmd, rest.filter((a) => !a.startsWith('--')), fl);
    if (req.error) { console.error(`✗ ${req.error}`); process.exit(2); }
    const r = await overrideCall(req);
    if (fl.has('--json')) console.log(JSON.stringify(r.data, null, 2)); else for (const l of describeOverrides(cmd, r)) console.log(l);
    process.exit(r.ok ? 0 : 1);
  }
  const flags = new Set(rest.filter((a) => a.startsWith('--')));
  const dirs = rest.filter((a) => !a.startsWith('--')).map((a) => resolve(ROOT, a));
  const apps = dirs.length ? dirs : defaultApps();
  const defaults = sharedDefaults();
  if (cmd === 'list') {
    for (const d of apps) { const app = appIdentity(d); console.log(`${relative(ROOT, d)} (${app.id})`); for (const t of CHROME_TYPES) console.log(`  ${t.padEnd(13)} ${chromeSettingsDefaultId(t).padEnd(22)} → ${chromeSettingsCustomId(t, app.id)}`); }
    process.exit(0);
  }
  if (cmd === 'backfill') {
    let bad = 0;
    for (const d of apps) {
      const app = appIdentity(d);
      const r = writeCopies(settingsDir(d), app, defaults, { dry: flags.has('--check') });
      console.log(`${relative(ROOT, d)} (${app.id}): ${r.written.length} ${flags.has('--check') ? 'to write' : 'written'}, ${r.kept.length} kept${r.bad.length ? `, ${r.bad.length} bad` : ''}`);
      for (const w of r.written) console.log(`  + ${relative(ROOT, w)}`);
      for (const b of r.bad) { console.log(`  ✗ ${b}`); bad++; }
    }
    process.exit(bad ? 1 : 0);
  }
  if (cmd === 'check') {
    let n = 0;
    for (const d of apps) { const r = checkApp(d, defaults); for (const f of r.findings) { console.log(`✗ ${f}`); n++; } }
    console.log(n ? `✗ ${n} chrome settings finding(s)` : `✓ every app has a custom settings interface for ${CHROME_TYPES.length} chrome types (${apps.length} app(s))`);
    process.exit(n ? 1 : 0);
  }
  console.error('usage: chrome-settings.mjs backfill [--check] | check | list  [app dir…]\n       chrome-settings.mjs overrides | reset-all --confirm | undo <ra-…|last>  [--json]');
  process.exit(2);
}
