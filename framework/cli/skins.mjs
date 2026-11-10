#!/usr/bin/env node
/**
 * Skins (engines/skin.ts): every app's own look document on the hub, `shared/settings/looks/<app>.json`, and the
 * hub-wide skin on the shared appearance document. Scopes (skin-coverage@1): hub-wide → app → one screen → one plugin,
 * the child overrides the parent.
 *
 *   node framework/cli/skins.mjs apps                      apps, their skin switch, scopes and overrides
 *   node framework/cli/skins.mjs list                      the skins that can be used (every former design package and style package is one)
 *   node framework/cli/skins.mjs snapshot [--all | <app>] [--force]   save the current look as the app's default
 *   node framework/cli/skins.mjs use <app> <skin> [--scope ui:<id>|plugin:<id>]   Use skin on, in that app (or one of its screens / plugins)
 *   node framework/cli/skins.mjs off <app> [--scope ui:<id>|plugin:<id>]          back to the app's own look (or no skin inside that scope)
 *   node framework/cli/skins.mjs inherit <app> <scope>     a screen / plugin follows its parent again (drops its own state)
 *   node framework/cli/skins.mjs follow <app> on|off       the app follows the hub-wide skin while Use skin is off
 *   node framework/cli/skins.mjs global <skin>|off         the hub-wide skin (every app that follows it)
 *   node framework/cli/skins.mjs at <app> [--scope …]      which skin is in force at a place, and which level decided
 *   node framework/cli/skins.mjs back <app> <slot>         drop one override ("Back to skin")
 *   node framework/cli/skins.mjs restore <app>             back to the snapshot (keeps one undo)
 *   node framework/cli/skins.mjs undo <app>                undo the last restore
 *   node framework/cli/skins.mjs coverage                  how a skin reaches every registered asset type (CI: spec/check-skin-coverage.mjs)
 *   node framework/cli/skins.mjs covers <skin>             what one skin sets or styles, type by type
 *   add --json for machine output. An app is its id (axf-console) or its folder (console-web), or `console`, `axhub`, `amberx`, `molly`.
 *
 * Files are written where /projects is mounted (the hub's data folder), so open apps follow through the hub's change
 * feed. AXF_LOOKS_DIR points elsewhere (tests, local development); AXF_APPEARANCE_FILE is the shared document.
 */
import { chownSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { backToSkin, newAppLook, normalizeAppLook, normalizeLookPart, overriddenSlots, pickSkin, resolveLookSkin, restoreAppDefault, scopeEntries, setInheritSkin, setLookSlot, setScopeSkin, setUseSkin, undoRestore, SKIN_NEVER } from '../core/engines/skin-rules.mjs';
import { coverageSummary, coverageTable, isSubScopeKey, partElements, skinScopeOf } from '../core/engines/skin-coverage.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const ALIASES = { console: 'axf-console', 'console-web': 'axf-console', axhub: 'axhub-web', amberx: 'amberx-droid' };
const readJson = (f) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; } };
const ID = /^[a-z0-9][a-z0-9-]*$/;

export const sharedFile = () => process.env.AXF_APPEARANCE_FILE || '/projects/_shared/_data/settings/appearance.json';
export const looksDir = () => process.env.AXF_LOOKS_DIR || join(dirname(sharedFile()), 'looks');
const lookFile = (app) => join(looksDir(), `${app}.json`);

/** The apps with a look document: the shared-assets apps, plus any document already on the hub. */
export function appIds() {
  const listed = (readJson(join(ROOT, 'framework/schemas/shared-assets.json'))?.apps ?? []).map((a) => readJson(join(ROOT, a, 'axf.manifest.json'))?.app?.id).filter(Boolean);
  const onHub = existsSync(looksDir()) ? readdirSync(looksDir()).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)) : [];
  return [...new Set([...listed, ...onHub])].sort();
}

function appId(name) {
  const id = ALIASES[name] ?? name;
  if (!id || !appIds().includes(id)) throw new Error(`no app "${name}": one of ${appIds().join(', ')}`);
  return id;
}

export const readLook = (app) => normalizeAppLook(readJson(lookFile(app)));

function chownLike(f) {
  // the hub's data server owns its folder: a file written as root stays writable by it
  try { const { uid, gid } = statSync(dirname(sharedFile())); chownSync(dirname(f), uid, gid); chownSync(f, uid, gid); } catch { /* not root: the file is already ours */ }
}

export function writeLook(doc, by = 'skins-cli') {
  mkdirSync(looksDir(), { recursive: true });
  const f = lookFile(doc.app);
  const tmp = `${f}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify({ ...doc, updatedBy: by, updatedAt: new Date().toISOString() })}\n`);
  renameSync(tmp, f);
  chownLike(f);
}

/** The hub-wide skin on the shared document (`skin: { id, overrides }`), null = none. */
export function readGlobal() {
  const s = readJson(sharedFile())?.skin;
  return s && typeof s.id === 'string' && ID.test(s.id) ? { id: s.id, overrides: s.overrides ?? {} } : null;
}

/** Set or clear the hub-wide skin: the one field this CLI writes on the shared document. */
export function writeGlobal(skin, by = 'skins-cli') {
  const f = sharedFile();
  const doc = readJson(f);
  if (!doc) throw new Error(`can't read the shared look at ${f}`);
  if (skin) doc.skin = { id: skin }; else delete doc.skin;
  doc.updatedBy = by;
  doc.updatedAt = new Date().toISOString();
  const tmp = `${f}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(doc)}\n`);
  renameSync(tmp, f);
  chownLike(f);
  return readGlobal();
}

function assetsOf(type) {
  const dir = join(ROOT, 'framework/assets', type);
  return existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => readJson(join(dir, f))).filter(Boolean) : [];
}
export const skinRows = () => assetsOf('skin').map((a) => ({ id: a.id, name: a.name, kind: 'skin', description: a.description ?? '', tags: a.tags ?? [], sections: { colors: a.data?.sections?.colors ? 'inline' : a.data?.colorTheme ?? '', style: a.data?.sections?.style ? 'inline' : a.data?.styleTheme ?? '', layout: a.data?.sections?.layout ? 'inline' : a.data?.layoutTheme ?? '', behavior: a.data?.sections?.behavior ? 'inline' : a.data?.behaviorTheme ?? '' }, iconPack: a.data?.iconPack ?? '', parts: Object.keys(a.data?.parts ?? {}) }));

/** Save the app's current look as its default. Never replaces a snapshot unless forced. */
export function snapshot(app, force = false) {
  const cur = readLook(app);
  if (cur && !force) return { app, saved: false, why: 'already has a default' };
  const shared = readJson(sharedFile());
  if (!shared) throw new Error(`can't read the shared look at ${sharedFile()}`);
  writeLook(cur ? { ...cur, default: normalizeLookPart(shared) } : newAppLook(app, shared));
  return { app, saved: true };
}

const need = (app) => { const l = readLook(app); if (!l) throw new Error(`${app} has no look document yet: run snapshot first`); return l; };
const skinKnown = (id) => skinRows().some((s) => s.id === id);
const scopeArg = (argv) => { const i = argv.indexOf('--scope'); const v = i >= 0 ? argv[i + 1] : ''; if (v && !isSubScopeKey(v)) throw new Error(`"${v}" is not a scope: ui:<id> or plugin:<id>`); return v || ''; };

export const status = (app) => {
  const l = readLook(app);
  const inForce = resolveLookSkin(l, readGlobal(), null);
  return { app, snapshot: !!l, useSkin: !!l?.skin.use, follow: !!l?.skin.inherit, skin: l?.skin.id ?? '', inForce: inForce.id, from: inForce.from, overrides: overriddenSlots(l), scopes: scopeEntries(l), canUndo: !!l?.undo, own: Object.keys(l?.own.slots ?? {}) };
};

/** Which skin is in force at a place and which level decided. */
export function at(app, scopeKey = '') {
  const l = readLook(app);
  const scope = scopeKey ? skinScopeOf(scopeKey, app) : { app };
  return { app, scope: scopeKey || 'app', ...resolveLookSkin(l, readGlobal(), scope) };
}

/** One change to one app's look; every transport comes through here. */
export function change(op, app, arg, scopeKey = '') {
  const l = need(app);
  if (op === 'use') {
    if (!skinKnown(arg)) throw new Error(`no skin "${arg}"`);
    writeLook(scopeKey ? setScopeSkin(l, scopeKey, 'on', arg) : setUseSkin(pickSkin(l, arg), true));
  } else if (op === 'off') writeLook(scopeKey ? setScopeSkin(l, scopeKey, 'off') : setUseSkin(l, false));
  else if (op === 'inherit') { if (!isSubScopeKey(arg)) throw new Error('inherit needs a scope: ui:<id> or plugin:<id>'); writeLook(setScopeSkin(l, arg, 'inherit', '')); }
  else if (op === 'follow') writeLook(setInheritSkin(l, arg !== 'off'));
  else if (op === 'back') writeLook(backToSkin(l, arg));
  else if (op === 'restore') writeLook(restoreAppDefault(l, new Date().toISOString()));
  else if (op === 'undo') { if (!l.undo) throw new Error(`${app} has nothing to undo`); writeLook(undoRestore(l)); } else throw new Error(`unknown change ${op}`);
  return status(app);
}

/** The hub-wide skin: `skins.mjs global <skin>|off`. */
export function global(arg) {
  if (arg === 'off' || arg === 'none') return { global: writeGlobal('') };
  if (!skinKnown(arg)) throw new Error(`no skin "${arg}"`);
  return { global: writeGlobal(arg) };
}

/** control@1 tokens.slots: a slot set from outside reaches every app's look. */
export function setSlotEverywhere(slot, id, by) {
  for (const app of appIds()) { const l = readLook(app); if (l) writeLook(setLookSlot(l, slot, id), by); }
}

/** skin-coverage@1 over the real registry and style targets. */
export function coverage() {
  const spec = readJson(join(ROOT, 'framework/schemas/asset-types.json')).types;
  const targets = readJson(join(ROOT, 'framework/schemas/customize.json')).targets ?? {};
  const rows = coverageTable(spec, targets, SKIN_NEVER);
  return { summary: coverageSummary(rows), rows };
}

/** What one skin sets or styles, type by type. */
export function covers(skinId) {
  const a = assetsOf('skin').find((s) => s.id === skinId);
  if (!a) throw new Error(`no skin "${skinId}"`);
  const d = a.data ?? {};
  const section = (name, type, field) => (d.sections?.[name] ? { [type]: `skin-${skinId}` } : d[field] ? { [type]: d[field] } : {});
  const slots = { ...(d.assets ?? {}), ...section('layout', 'layout', 'layoutTheme'), ...section('colors', 'color-theme', 'colorTheme'), ...section('style', 'style-theme', 'styleTheme'), ...section('behavior', 'behavior-theme', 'behaviorTheme') };
  const targets = readJson(join(ROOT, 'framework/schemas/customize.json')).targets ?? {};
  return coverage().rows.map((r) => {
    const how = [];
    if (slots[r.type]) how.push(`slot ${slots[r.type]}`);
    if (d.parts?.[r.type]) how.push(`parts ${Object.keys(d.parts[r.type]).join(', ')} (${partElements(targets[r.type]).join('/')})`);
    if (r.by === 'reference' && r.via === 'iconPack' && d.iconPack) how.push(`iconPack ${d.iconPack}`);
    if (r.by === 'reference' && r.via && r.via !== 'iconPack' && slots[r.via]) how.push(`via ${r.via} ${slots[r.via]}`);
    if (r.by === 'bundle') how.push('the skin itself');
    if (r.by === 'none') how.push('no look');
    return { type: r.type, by: r.by, covered: r.by !== 'none' && how.length > 0, how };
  });
}

function main(argv) {
  const json = argv.includes('--json');
  const args = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--scope');
  const [cmd, app, arg] = args;
  const scope = scopeArg(argv);
  let out;
  if (!cmd || cmd === 'apps') out = appIds().map(status);
  else if (cmd === 'list') out = skinRows();
  else if (cmd === 'snapshot') out = (argv.includes('--all') ? appIds() : [appId(app)]).map((a) => snapshot(a, argv.includes('--force')));
  else if (['use', 'back', 'inherit', 'follow'].includes(cmd)) { if (!arg) throw new Error(`${cmd} needs <app> and ${cmd === 'use' ? 'a skin' : cmd === 'back' ? 'a slot' : cmd === 'inherit' ? 'a scope' : 'on | off'}`); out = change(cmd, appId(app), arg, scope); }
  else if (['off', 'restore', 'undo'].includes(cmd)) out = change(cmd, appId(app), undefined, scope);
  else if (cmd === 'at') out = at(appId(app), scope);
  else if (cmd === 'global') { if (!app) out = { global: readGlobal() }; else out = global(app); }
  else if (cmd === 'coverage') out = coverage();
  else if (cmd === 'covers') { if (!app) throw new Error('covers needs a skin id'); out = covers(app); }
  else throw new Error(`unknown command ${cmd}`);
  if (json) console.log(JSON.stringify({ ok: true, result: out }));
  else if (cmd === 'coverage') { for (const r of out.rows) console.log(`${r.type.padEnd(16)} ${r.by.padEnd(10)}${r.also.length ? `+${r.also.join('+')}` : ''}${r.elements.length ? `  ${r.elements.join('/')}` : ''}`); const s = out.summary; console.log(`${s.total} types · slot ${s.slot} · parts ${s.parts} · reference ${s.reference} · bundle ${s.bundle} · none ${s.none} · uncovered ${s.uncovered}`); }
  else if (cmd === 'covers') for (const c of out) console.log(`${c.covered ? '✓' : '·'} ${c.type.padEnd(16)} ${c.by.padEnd(10)} ${c.how.join('; ')}`);
  else console.log(Array.isArray(out) ? out.map((x) => JSON.stringify(x)).join('\n') : JSON.stringify(out));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(process.argv.slice(2)); } catch (e) {
    console.log(process.argv.includes('--json') ? JSON.stringify({ ok: false, error: e.message }) : e.message);
    process.exitCode = 1;
  }
}
