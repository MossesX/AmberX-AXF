#!/usr/bin/env node
/**
 * App style (console plugin, build app-style-override): every app's design / colours over axHub's look, from outside
 * the apps (REST, MCP, CLI). The rules are the framework's (framework/core/engines/app-style.mjs, app-style@1 over
 * inherit@1); this runner reads and writes the one shared look document every app follows live
 * (`/projects/_shared/_data/settings/appearance.json`, APPEARANCE-SOURCE.md; AXF_APPEARANCE_FILE elsewhere).
 *
 *   node appstyle.mjs get [--app <id>]                                  every app (or one): inheriting / overriding, axHub's value, its own
 *   node appstyle.mjs override --app <id> --part design|colors --on|--off [--theme <asset id>]
 *   node appstyle.mjs reload --app <id> [--reset]                       every open app re-reads axHub now; --reset drops the app's overrides
 *   node appstyle.mjs save --app <id> --parts design,colors             owner only: the app's own values become axHub's look (versioned)
 *   node appstyle.mjs restore                                           owner only: take back the newest save
 *   --json prints one JSON line (the server part reads it); --by <who> is audited.
 *
 * Owner only = AXF_APPROVER is set, which only the server part does, from Brett's own signed-in click in the console
 * (never the console token, never an agent or a Claude session).
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  APP_STYLE_APPS, APP_STYLE_PARTS, appStyleKey, appStyleOf, appStyleView, appsFollowing, hubStyleValues, isStyleSource,
  restorePreviousChange, saveToHubChange, serializeAppStyle, withPartOverride,
} from '../../../../framework/core/engines/app-style.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../../..');
const ASSETS = join(ROOT, 'framework', 'assets');
export const DATA_DIR = process.env.AXF_APP_STYLE_DATA_DIR || join(ROOT, '.axf-console', 'plugins', 'app-style');
const DOC_MAX = 16 * 1024;
const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

export class StyleError extends Error { constructor(code, message) { super(message); this.code = code; } }

/* ---------------- the shared look document ---------------- */

export function appearanceFile() {
  if (process.env.AXF_APPEARANCE_FILE) return process.env.AXF_APPEARANCE_FILE;
  const projects = process.env.AXHUB_PROJECTS_DIR || '/projects';
  if (existsSync(projects)) return join(projects, '_shared', '_data', 'settings', 'appearance.json');
  return join(DATA_DIR, 'appearance.json');
}

export function readDoc() {
  try { const d = JSON.parse(readFileSync(appearanceFile(), 'utf8')); return d && typeof d === 'object' && d.$axf === 'appearance@1' ? d : { $axf: 'appearance@1' }; } catch { return { $axf: 'appearance@1' }; }
}

/** Per key, last write wins (engines/appearance.ts mergeAppearance); every connected app re-reads on the write. */
export function writeDoc(change, by) {
  const doc = readDoc();
  if (change.slots) { doc.slots = { ...(doc.slots ?? {}) }; for (const [k, v] of Object.entries(change.slots)) { if (v === null || v === undefined) delete doc.slots[k]; else doc.slots[k] = v; } }
  if (change.settings) { doc.settings = { ...(doc.settings ?? {}) }; for (const [k, v] of Object.entries(change.settings)) { if (v === null || v === undefined) delete doc.settings[k]; else doc.settings[k] = v; } }
  if (change.palette) doc.palette = change.palette;
  doc.updatedBy = String(by || 'app-style').slice(0, 80);
  doc.updatedAt = new Date().toISOString();
  const text = JSON.stringify(doc, null, 2);
  if (text.length > DOC_MAX) throw new StyleError('validation', `the look document would be over ${DOC_MAX} bytes`);
  const f = appearanceFile();
  mkdirSync(dirname(f), { recursive: true });
  const tmp = `${f}.tmp-${process.pid}`;
  writeFileSync(tmp, `${text}\n`);
  renameSync(tmp, f);
  return doc;
}

/* ---------------- assets (to name themes and resolve a design package) ---------------- */

const cache = new Map();
function asset(type, id) {
  const k = `${type}/${id}`;
  if (!cache.has(k)) { try { cache.set(k, JSON.parse(readFileSync(join(ASSETS, type, `${id}.json`), 'utf8'))); } catch { cache.set(k, null); } }
  return cache.get(k);
}
const ids = (type) => { try { return readdirSync(join(ASSETS, type)).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)); } catch { return []; } };
const nameOf = (type, id) => asset(type, id)?.name ?? id;

/** The theme in force for a slot under the document (a loaded design package decides, its overrides beat it). */
export function resolveSlot(doc, slot) {
  const pkgId = doc.slots?.['design-package'];
  if (slot === 'design-package') return pkgId && asset('design-package', pkgId) ? pkgId : undefined;
  const pkg = pkgId ? asset('design-package', pkgId)?.data : null;
  if (pkg && (slot === 'style-theme' || slot === 'color-theme')) {
    const over = doc.settings?.['axf.appearance.overrides']?.[slot];
    if (over && asset(slot, over)) return over;
    if (pkg[slot] && asset(slot, pkg[slot])) return pkg[slot];
  }
  return doc.slots?.[slot];
}

/* ---------------- commands ---------------- */

const hubOf = (doc) => hubStyleValues(doc, (slot) => resolveSlot(doc, slot));
const appIdOk = (app) => { if (typeof app !== 'string' || !ID.test(app)) throw new StyleError('invalid', 'an app id is needed (e.g. axf-console, molly, axhub-web, amberx-droid)'); return app; };
const partOk = (p) => { if (!APP_STYLE_PARTS.some((x) => x.id === p)) throw new StyleError('invalid', 'part must be design or colors'); return p; };

/** With names: each slot value also as the theme's name. */
function named(view) {
  for (const p of view.parts) for (const v of p.values) if (v.kind === 'slot') { v.axhubName = v.axhub ? nameOf(v.name, v.axhub) : null; v.ownName = v.own ? nameOf(v.name, v.own) : null; }
  return view;
}

export function get({ app } = {}) {
  const doc = readDoc();
  const hub = hubOf(doc);
  const apps = app ? [{ id: appIdOk(app), label: APP_STYLE_APPS.find((a) => a.id === app)?.label ?? app }] : APP_STYLE_APPS;
  return {
    ok: true,
    axhub: { design: hub.slots['style-theme'] ? nameOf('style-theme', hub.slots['style-theme']) : null, colors: hub.slots['color-theme'] ? nameOf('color-theme', hub.slots['color-theme']) : null, designPackage: hub.slots['design-package'] ?? null, updatedBy: doc.updatedBy ?? '', updatedAt: doc.updatedAt ?? '' },
    apps: apps.map((a) => ({ label: a.label, ...named(appStyleView(doc, a.id, hub, null)) })),
  };
}

export function override({ app, part, on, theme, by = '' }) {
  appIdOk(app); partOk(part);
  if (isStyleSource(app)) throw new StyleError('invalid', `${app} is axHub's own look: it never overrides itself`);
  const doc = readDoc();
  const hub = hubOf(doc);
  const slot = part === 'design' ? 'style-theme' : 'color-theme';
  if (theme !== undefined && theme !== '') {
    if (!on) throw new StyleError('invalid', 'a theme goes with --on');
    if (!ID.test(theme) || !asset(slot, theme)) throw new StyleError('not_found', `no ${slot} "${theme}" (one of: ${ids(slot).sort().join(', ')})`);
  }
  // switched on from here: the app's own values start as axHub's (its own UI shows nothing else), or the theme named
  const current = { slots: { ...hub.slots, ...(theme ? { [slot]: theme } : {}) }, keys: { ...hub.keys } };
  const style = withPartOverride(appStyleOf(doc, app), part, !!on, current);
  if (on && theme) style.own.slots[slot] = theme;
  const value = serializeAppStyle(style, by || 'app-style', new Date().toISOString());
  writeDoc({ settings: { [appStyleKey(app)]: value } }, by || 'app-style');
  log({ op: 'override', app, part, on: !!on, theme: theme || undefined, by });
  return { ok: true, ...get({ app }).apps[0] };
}

export function reload({ app, reset = false, by = '' }) {
  appIdOk(app);
  // any write makes every open app re-read the document at once (the hub's data events); a reset also drops the overrides
  writeDoc(reset ? { settings: { [appStyleKey(app)]: null } } : {}, by || 'app-style');
  log({ op: 'reload', app, reset: !!reset, by });
  return { ok: true, reloaded: true, reset: !!reset, ...get({ app }).apps[0] };
}

function owner() {
  const who = (process.env.AXF_APPROVER || '').trim();
  if (!who) throw new StyleError('denied', 'only Brett can change axHub\'s look for every app: Settings → Appearance → Save to axHub in the app, or his own click in the console');
  return who;
}

export function save({ app, parts, by = '' }) {
  const who = owner();
  appIdOk(app);
  const list = (Array.isArray(parts) ? parts : String(parts ?? '').split(/[,+ ]+/)).filter(Boolean);
  if (!list.length) throw new StyleError('invalid', 'parts: design, colors or both');
  list.forEach(partOk);
  const doc = readDoc();
  const style = appStyleOf(doc, app);
  const missing = list.filter((p) => !style[p]);
  if (missing.length) throw new StyleError('invalid', `${app} doesn't override ${missing.join(' or ')}: there is nothing of its own to save`);
  const changing = appsFollowing(doc, list).map((a) => a.label);
  const out = saveToHubChange(doc, list, style.own, { appId: app, by: who });
  // the saved parts match axHub now: the app follows axHub for them again
  let next = style;
  for (const p of out.parts) next = withPartOverride(next, p, false);
  out.change.settings[appStyleKey(app)] = serializeAppStyle(next, who, new Date().toISOString());
  writeDoc(out.change, `${app} (${who})`);
  log({ op: 'save', app, parts: out.parts, by: who });
  return { ok: true, saved: out.parts, changed: changing, ...get({ app }) };
}

export function restore({ by = '' } = {}) {
  const who = owner();
  const doc = readDoc();
  const r = restorePreviousChange(doc);
  if (!r) throw new StyleError('not_found', 'there is no earlier axHub style to restore');
  writeDoc(r.change, `restore (${who})`);
  log({ op: 'restore', of: r.entry.at, by: who || by });
  return { ok: true, restored: r.entry, ...get({}) };
}

function log(entry) {
  try { mkdirSync(DATA_DIR, { recursive: true }); appendFileSync(join(DATA_DIR, 'audit.jsonl'), `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`); } catch { /* never blocks */ }
}

/* ---------------- CLI ---------------- */

function args(argv) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { o._.push(a); continue; }
    const k = a.slice(2);
    if (['on', 'off', 'reset', 'json'].includes(k)) { o[k] = true; continue; }
    o[k] = argv[++i];
  }
  return o;
}

export function run(cmd, o) {
  switch (cmd) {
    case 'get': return get({ app: o.app });
    case 'override': if (!o.on && !o.off) throw new StyleError('invalid', '--on or --off'); return override({ app: o.app, part: o.part, on: !!o.on, theme: o.theme, by: o.by });
    case 'reload': return reload({ app: o.app, reset: !!o.reset, by: o.by });
    case 'save': return save({ app: o.app, parts: o.parts, by: o.by });
    case 'restore': return restore({ by: o.by });
    default: throw new StyleError('invalid', 'commands: get | override | reload | save | restore');
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const o = args(process.argv.slice(2));
  const cmd = o._[0] || 'get';
  try {
    const res = run(cmd, o);
    if (o.json) console.log(JSON.stringify(res));
    else if (cmd === 'get' || res.apps) {
      console.log(`axHub: design ${res.axhub.design ?? '—'} · colours ${res.axhub.colors ?? '—'}`);
      for (const a of res.apps) console.log(`  ${a.label.padEnd(20)} ${a.source ? 'is axHub' : a.parts.map((p) => `${p.id} ${p.overriding ? `OVERRIDING (${p.values.find((v) => v.kind === 'slot' && v.ownName)?.ownName ?? 'own'})` : 'inherited'}`).join(' · ')}`);
    } else console.log(JSON.stringify(res, null, 2));
  } catch (e) {
    const out = { ok: false, code: e.code || 'unexpected', error: e.message };
    if (o.json) console.log(JSON.stringify(out)); else console.error(`${out.code}: ${out.error}`);
    process.exitCode = e.code === 'denied' ? 3 : 1;
  }
}
