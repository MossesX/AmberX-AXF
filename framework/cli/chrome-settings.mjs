#!/usr/bin/env node
/**
 * chrome-settings — every app has a custom settings interface for every chrome type (chrome-settings@1; Brett, Nov 4
 * 2026, build tab-group-assets, addendum 2: "there will be another one that will make a customized one for every app").
 *
 *   node framework/cli/chrome-settings.mjs backfill [--check] [app dir…]   write the missing custom copies (default: every
 *                                                                          app in framework/schemas/shared-assets.json + apps/expenses)
 *   node framework/cli/chrome-settings.mjs check [app dir…]                exit 1 when a copy is missing, stale in shape, or invalid
 *   node framework/cli/chrome-settings.mjs list                            the plan: type → default id → custom id, per app
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

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const [cmd = 'check', ...rest] = process.argv.slice(2);
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
  console.error('usage: chrome-settings.mjs backfill [--check] | check | list  [app dir…]');
  process.exit(2);
}
