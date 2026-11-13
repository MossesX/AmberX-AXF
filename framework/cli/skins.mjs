#!/usr/bin/env node
/**
 * Skins (engines/skin.ts): every app's own look document on the hub, `shared/settings/looks/<app>.json`, and the
 * hub-wide skin on the shared appearance document. Scopes (skin-coverage@1): hub-wide → app → one screen → one plugin,
 * the child overrides the parent.
 *
 *   node framework/cli/skins.mjs apps                      apps, their skin switch, scopes and overrides
 *   node framework/cli/skins.mjs list                      the skins (and design packages) that can be used
 *   node framework/cli/skins.mjs snapshot [--all | <app>] [--force]   save the current look as the app's default
 *   node framework/cli/skins.mjs use <app> <skin> [--scope ui:<id>|plugin:<id>]   Use skin on, in that app (or one of its screens / plugins)
 *   node framework/cli/skins.mjs off <app> [--scope ui:<id>|plugin:<id>]          back to the app's own look (or no skin inside that scope)
 *   node framework/cli/skins.mjs inherit <app> <scope>     a screen / plugin follows its parent again (drops its own state)
 *   node framework/cli/skins.mjs follow <app> on|off       the app follows the hub-wide skin while Use skin is off
 *   node framework/cli/skins.mjs global <skin>|off         the hub-wide skin (every app that follows it)
 *   node framework/cli/skins.mjs global-color <colour theme>|default   the colour theme inside the hub-wide skin (the skin stays)
 *   node framework/cli/skins.mjs at <app> [--scope …]      which skin is in force at a place, and which level decided
 *   node framework/cli/skins.mjs back <app> <slot>         drop one override ("Back to skin")
 *   node framework/cli/skins.mjs color <app> <colour theme>|default [--scope …]   switch the colour theme inside the skin in force (same skin,
 *                                                           no new skin; default = the skin's own colours); --scope = inside one screen / plugin only
 *   node framework/cli/skins.mjs restore <app>             back to the snapshot (keeps one undo)
 *   node framework/cli/skins.mjs undo <app>                undo the last restore
 *   node framework/cli/skins.mjs coverage                  how a skin reaches every registered asset type, with each type's behaviour axes (CI: spec/check-skin-coverage.mjs)
 *   node framework/cli/skins.mjs covers <skin>             what one skin sets or styles, type by type, and which behaviour axes it sets (✗ = uncovered)
 *   node framework/cli/skins.mjs axes                      skin@2: every behaviour axis a skin may set (type, axis, kind, values, default, token, key)
 *   node framework/cli/skins.mjs behaviour <app> [--scope …]                       the behaviour in force at a place: the skin's picks, the level's overrides, every axis resolved
 *   node framework/cli/skins.mjs behaviour <app> <type> <axis> <value>|default [--scope …]   override one axis inside the skin in force (default = back to the skin's)
 *   node framework/cli/skins.mjs compare <skin> <skin>     two skins side by side: every slot, part and behaviour axis that differs
 *   node framework/cli/skins.mjs preview <app> <skin>|off  show a skin on the open console without saving (needs AXF_CONSOLE_URL + AXF_TOKEN; the console action skin.preview)
 *   node framework/cli/skins.mjs gallery <app> [<skin>]    open Settings → Appearance → skin gallery on the open console (the deep link settings/appearance/skin/<id>)
 *   add --json for machine output. An app is its id (axf-console) or its folder (console-web), or `console`, `axhub`, `amberx`, `molly`.
 *
 * Files are written where /projects is mounted (the hub's data folder), so open apps follow through the hub's change
 * feed. AXF_LOOKS_DIR points elsewhere (tests, local development); AXF_APPEARANCE_FILE is the shared document.
 */
import { chownSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { backToSkin, backToSkinBehaviour, newAppLook, normalizeAppLook, normalizeLookPart, overriddenSlots, pickSkin, resolveLookSkin, restoreAppDefault, scopeEntries, setInheritSkin, setLookSlot, setScopeSkin, setSkinBehaviour, setSkinColorTheme, setUseSkin, skinBehaviourOverrides, skinColorTheme, undoRestore, SKIN_COLOR_SLOT, SKIN_NEVER } from '../core/engines/skin-rules.mjs';
import { coverageSummary, coverageTable, isSubScopeKey, partElements, skinCoversTable, skinScopeOf, skinSlotMap } from '../core/engines/skin-coverage.mjs';
import { axisOf, axisValuesText, behaviourTable, behaviourTokens, mergeBehaviour, normalizeAxisValue, normalizeBehaviour, resolveBehaviour } from '../core/engines/skin-behaviour.mjs';

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

/**
 * The hub-wide skin on the shared document (`skin: { id, overrides, colorTheme? }`), null = none. `colorTheme` = the
 * colour theme picked inside it (a document saved before the rule kept that pick among the overrides; it is read as the
 * colour theme, engines/skin-rules.mjs).
 */
export function readGlobal() {
  const s = readJson(sharedFile())?.skin;
  if (!s || typeof s.id !== 'string' || !ID.test(s.id)) return null;
  const overrides = { ...(s.overrides ?? {}) };
  const colorTheme = typeof s.colorTheme === 'string' && ID.test(s.colorTheme) ? s.colorTheme : overrides[SKIN_COLOR_SLOT] ?? '';
  delete overrides[SKIN_COLOR_SLOT];
  return colorTheme ? { id: s.id, overrides, colorTheme } : { id: s.id, overrides };
}

/**
 * Set or clear the hub-wide skin, or switch the colour theme inside it (`colorTheme`: a colour theme id, '' = the skin's
 * own; the skin id stays): the one field this CLI writes on the shared document.
 */
export function writeGlobal(skin, by = 'skins-cli', colorTheme) {
  const f = sharedFile();
  const doc = readJson(f);
  if (!doc) throw new Error(`can't read the shared look at ${f}`);
  if (skin) {
    const cur = readGlobal();
    const keep = cur && cur.id === skin ? cur : { id: skin, overrides: {} };
    const pick = colorTheme === undefined ? keep.colorTheme ?? '' : colorTheme;
    doc.skin = { id: skin, ...(Object.keys(keep.overrides ?? {}).length ? { overrides: keep.overrides } : {}), ...(pick ? { colorTheme: pick } : {}) };
  } else delete doc.skin;
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
export const skinRows = () => [
  ...assetsOf('skin').map((a) => ({ id: a.id, name: a.name, kind: 'skin', description: a.description ?? '', iconPack: a.data?.iconPack ?? '', parts: Object.keys(a.data?.parts ?? {}) })),
  ...assetsOf('design-package').map((a) => ({ id: a.id, name: a.name, kind: 'design-package', description: a.description ?? '', iconPack: '', parts: [] })),
];

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
const colorThemeKnown = (id) => assetsOf(SKIN_COLOR_SLOT).some((a) => a.id === id);
const scopeArg = (argv) => { const i = argv.indexOf('--scope'); const v = i >= 0 ? argv[i + 1] : ''; if (v && !isSubScopeKey(v)) throw new Error(`"${v}" is not a scope: ui:<id> or plugin:<id>`); return v || ''; };

export const status = (app) => {
  const l = readLook(app);
  const inForce = resolveLookSkin(l, readGlobal(), null);
  return { app, snapshot: !!l, useSkin: !!l?.skin.use, follow: !!l?.skin.inherit, skin: l?.skin.id ?? '', inForce: inForce.id, from: inForce.from, colorTheme: inForce.colorTheme ?? '', overrides: overriddenSlots(l), scopes: scopeEntries(l), canUndo: !!l?.undo, own: Object.keys(l?.own.slots ?? {}) };
};

/**
 * Which skin is in force at a place and which level decided, with the look it gives (every slot, the skin's with the
 * chain's overrides and the colour theme switched inside it) and its behaviour (the skin's picks with the chain's
 * overrides, and every axis resolved: pick > the picked asset's field > today's behaviour).
 */
export function at(app, scopeKey = '') {
  const l = readLook(app);
  const scope = scopeKey ? skinScopeOf(scopeKey, app) : { app };
  const r = resolveLookSkin(l, readGlobal(), scope);
  const out = { app, scope: scopeKey || 'app', ...r };
  if (r.id) {
    const skin = skinDataOf(r.id);
    const look = { ...skinSlotMap(skin), ...r.overrides };
    if (r.colorTheme) look[SKIN_COLOR_SLOT] = r.colorTheme;
    out.look = look;
    out.behaviour = behaviourAt(skin, r.behaviour, look);
  }
  return out;
}

/** The behaviour a skin gives with `overrides` (the chain's) over it, resolved against the assets the look names. */
function behaviourAt(skin, overrides, look) {
  const { spec, targets } = registry();
  const picks = normalizeBehaviour(mergeBehaviour(skin?.behaviour, overrides), spec, targets);
  const assetField = (type, field) => assetsOf(type).find((a) => a.id === look?.[type])?.data?.[field];
  return { picks, overrides: overrides ?? {}, resolved: resolveBehaviour(picks, spec, targets, assetField) };
}

/** skin@2: every behaviour axis a skin may set, from the registry. */
export function axes() {
  const { spec, targets } = registry();
  return { types: behaviourTable(spec, targets), tokens: behaviourTokens(spec, targets) };
}

/** The behaviour in force at a place: `skins.mjs behaviour <app> [--scope …]`. */
export function behaviour(app, scopeKey = '') {
  const r = at(app, scopeKey);
  const l = readLook(app);
  return { app: r.app, scope: r.scope, skin: r.id, from: r.from, levelOverrides: l ? skinBehaviourOverrides(l, scopeKey || undefined) : {}, ...(r.behaviour ?? { picks: {}, overrides: {}, resolved: behaviourAt(null, {}, {}).resolved }) };
}

/** Override one axis inside the skin in force (`value` default | skin = back to the skin's): `skins.mjs behaviour <app> <type> <axis> <value>`. */
export function setBehaviour(app, type, axis, value, scopeKey = '') {
  const l = need(app);
  const { spec, targets } = registry();
  const a = axisOf(type, axis, spec, targets);
  if (!a) throw new Error(`${type} has no behaviour axis "${axis}" (skins.mjs axes lists them)`);
  const scope = scopeKey ? skinScopeOf(scopeKey, app) : { app };
  if (!resolveLookSkin(l, readGlobal(), scope).id) throw new Error(`${app}${scopeKey ? ` ${scopeKey}` : ''} has no skin in force: behaviour comes from a skin (use one first)`);
  if (value === 'default' || value === 'skin' || value === undefined) writeLook(setSkinBehaviour(l, type, axis, null, scopeKey || undefined));
  else {
    const v = normalizeAxisValue(a, value);
    if (v === undefined) throw new Error(`${type}.${axis} takes ${axisValuesText(a)}`);
    writeLook(setSkinBehaviour(l, type, axis, v, scopeKey || undefined));
  }
  return behaviour(app, scopeKey);
}

/** Back to the skin's behaviour at a level: every override, or one type's. */
export function resetBehaviour(app, type = '', scopeKey = '') {
  writeLook(backToSkinBehaviour(need(app), type, scopeKey || undefined));
  return behaviour(app, scopeKey);
}

/** Two skins side by side: every slot, part and behaviour axis that differs. */
export function compare(a, b) {
  const { spec, targets } = registry();
  const da = skinDataOf(a); const db = skinDataOf(b);
  const slots = { a: skinSlotMap(da), b: skinSlotMap(db) };
  const slotDiff = [...new Set([...Object.keys(slots.a), ...Object.keys(slots.b)])].filter((t) => slots.a[t] !== slots.b[t]).map((type) => ({ type, a: slots.a[type] ?? null, b: slots.b[type] ?? null }));
  const partTypes = [...new Set([...Object.keys(da.parts ?? {}), ...Object.keys(db.parts ?? {})])];
  const partDiff = partTypes.filter((t) => JSON.stringify(da.parts?.[t] ?? null) !== JSON.stringify(db.parts?.[t] ?? null)).map((type) => ({ type, a: da.parts?.[type] ?? null, b: db.parts?.[type] ?? null }));
  const ba = resolveBehaviour(normalizeBehaviour(da.behaviour, spec, targets), spec, targets);
  const bb = resolveBehaviour(normalizeBehaviour(db.behaviour, spec, targets), spec, targets);
  const behaviourDiff = [];
  for (const type of Object.keys(ba)) for (const axis of Object.keys(ba[type])) if (ba[type][axis] !== bb[type]?.[axis]) behaviourDiff.push({ type, axis, a: ba[type][axis], b: bb[type]?.[axis] });
  return { a, b, iconPack: da.iconPack === db.iconPack ? null : { a: da.iconPack ?? null, b: db.iconPack ?? null }, slots: slotDiff, parts: partDiff, behaviour: behaviourDiff, same: !slotDiff.length && !partDiff.length && !behaviourDiff.length && da.iconPack === db.iconPack };
}

/**
 * Run a console action on the open Dev Console through its REST API (AXF_CONSOLE_URL + AXF_TOKEN): the one way a CLI
 * reaches a screen that is only alive in a browser (preview, the gallery). The REST route and the MCP command call the
 * console-commands service directly; this is the same action.
 */
async function consoleAction(spec) {
  const base = (process.env.AXF_CONSOLE_URL || '').replace(/\/$/, '');
  const token = process.env.AXF_TOKEN;
  if (!base || !token) throw new Error('needs AXF_CONSOLE_URL and AXF_TOKEN (the Dev Console and its token): this reaches the open console');
  const res = await fetch(`${base}/api/plugins/theme-manager/skins/console-action`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ spec }) });
  const text = await res.text();
  let body; try { body = JSON.parse(text); } catch { body = { ok: false, error: text.slice(0, 300) }; }
  if (!res.ok) throw new Error(body.detail || body.error || `${res.status} from the console`);
  return body;
}
export const preview = (app, skin) => consoleAction(skin === 'off' || skin === 'none' ? 'skin.preview:off' : `skin.preview:${skin}`).then((r) => ({ app, skin, ...r }));
export const gallery = (app, skin = '') => consoleAction(skin ? `skin.gallery:${skin}` : 'skin.gallery').then((r) => ({ app, skin, ...r }));

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
  else if (op === 'color') {
    // the colour theme inside the skin in force: the skin id never moves and no skin is created (Brett, Nov 9 2026)
    const pick = arg === 'default' || arg === 'skin' || arg === 'off' ? '' : arg;
    if (pick && !colorThemeKnown(pick)) throw new Error(`no colour theme "${pick}"`);
    const scope = scopeKey ? skinScopeOf(scopeKey, app) : { app };
    if (!resolveLookSkin(l, readGlobal(), scope).id) throw new Error(`${app}${scopeKey ? ` ${scopeKey}` : ''} has no skin in force: pick the colour theme with the app's own look (control@1 tokens.slots) or use a skin first`);
    writeLook(setSkinColorTheme(l, pick, scopeKey || undefined));
  }
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

/** The colour theme inside the hub-wide skin: `skins.mjs global-color <colour theme>|default`. The skin stays. */
export function globalColor(arg) {
  const cur = readGlobal();
  if (!cur) throw new Error('there is no hub-wide skin: set one with `skins.mjs global <skin>` first');
  const pick = arg === 'default' || arg === 'skin' || arg === 'off' ? '' : arg;
  if (pick && !colorThemeKnown(pick)) throw new Error(`no colour theme "${pick}"`);
  return { global: writeGlobal(cur.id, 'skins-cli', pick) };
}

/** The colour theme in force at a place and whether it was switched inside the skin. */
export function color(app, scopeKey = '') {
  const l = readLook(app);
  const scope = scopeKey ? skinScopeOf(scopeKey, app) : { app };
  const inForce = resolveLookSkin(l, readGlobal(), scope);
  const skin = inForce.id ? assetsOf('skin').find((a) => a.id === inForce.id) ?? assetsOf('design-package').find((a) => a.id === inForce.id) : null;
  const own = skin ? (skin.type === 'skin' ? skin.data?.colorTheme : skin.data?.['color-theme']) ?? '' : '';
  const shows = inForce.colorTheme || own;
  return { app, scope: scopeKey || 'app', skin: inForce.id, from: inForce.from, colorTheme: shows, own, picked: !!shows && shows !== own, pickedHere: l ? skinColorTheme(l, scopeKey || undefined) : '' };
}

/** control@1 tokens.slots: a slot set from outside reaches every app's look (the colour theme lands inside a skin in force; never a new skin). */
export function setSlotEverywhere(slot, id, by) {
  const global = readGlobal();
  for (const app of appIds()) { const l = readLook(app); if (l) writeLook(setLookSlot(l, slot, id, global), by); }
}

const registry = () => ({ spec: readJson(join(ROOT, 'framework/schemas/asset-types.json')).types, targets: readJson(join(ROOT, 'framework/schemas/customize.json')).targets ?? {} });

/** skin-coverage@1 over the real registry and style targets, each row with the type's behaviour axes (skin@2). */
export function coverage() {
  const { spec, targets } = registry();
  const rows = coverageTable(spec, targets, SKIN_NEVER);
  return { summary: coverageSummary(rows), rows, behaviour: behaviourTable(spec, targets) };
}

/** A shipped skin or design package as skin@2 data (a design package reads with today's behaviour). */
export function skinDataOf(skinId) {
  const a = assetsOf('skin').find((s) => s.id === skinId) ?? assetsOf('design-package').find((s) => s.id === skinId);
  if (!a) throw new Error(`no skin "${skinId}"`);
  const d = a.data ?? {};
  if (a.type === 'skin') return d;
  const assets = { ...(d.extras?.slots ?? {}) };
  if (d['behavior-theme']) assets['behavior-theme'] = d['behavior-theme'];
  return { layoutTheme: d.layout, colorTheme: d['color-theme'], styleTheme: d['style-theme'], assets };
}

/** What one skin (or design package) sets or styles, type by type, with its behaviour axes set / unset (skin@2). */
export function covers(skinId) {
  const { spec, targets } = registry();
  return skinCoversTable(skinDataOf(skinId), spec, targets, SKIN_NEVER).map((r) => ({ ...r, how: r.how.map((h) => (h.startsWith('parts ') ? `${h} (${partElements(targets[r.type]).join('/')})` : h)) }));
}

async function main(argv) {
  const json = argv.includes('--json');
  const args = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--scope');
  const [cmd, app, arg, arg2, arg3] = args;
  const scope = scopeArg(argv);
  let out;
  if (!cmd || cmd === 'apps') out = appIds().map(status);
  else if (cmd === 'axes') out = axes();
  else if (cmd === 'behaviour' || cmd === 'behavior') {
    if (!app) throw new Error('behaviour needs <app> [<type> <axis> <value>|default]');
    if (arg === 'reset') out = resetBehaviour(appId(app), arg2 || '', scope);
    else if (arg) { if (!arg2) throw new Error('behaviour needs <type> <axis> <value>|default'); out = setBehaviour(appId(app), arg, arg2, arg3, scope); }
    else out = behaviour(appId(app), scope);
  }
  else if (cmd === 'compare') { if (!app || !arg) throw new Error('compare needs two skin ids'); out = compare(app, arg); }
  else if (cmd === 'preview') { if (!app || !arg) throw new Error('preview needs <app> and a skin id or off'); if (arg !== 'off' && arg !== 'none' && !skinKnown(arg)) throw new Error(`no skin "${arg}"`); out = await preview(appId(app), arg); }
  else if (cmd === 'gallery') { if (!app) throw new Error('gallery needs <app> [<skin>]'); if (arg && !skinKnown(arg)) throw new Error(`no skin "${arg}"`); out = await gallery(appId(app), arg || ''); }
  else if (cmd === 'list') out = skinRows();
  else if (cmd === 'snapshot') out = (argv.includes('--all') ? appIds() : [appId(app)]).map((a) => snapshot(a, argv.includes('--force')));
  else if (['use', 'back', 'inherit', 'follow'].includes(cmd)) { if (!arg) throw new Error(`${cmd} needs <app> and ${cmd === 'use' ? 'a skin' : cmd === 'back' ? 'a slot' : cmd === 'inherit' ? 'a scope' : 'on | off'}`); out = change(cmd, appId(app), arg, scope); }
  else if (cmd === 'color' || cmd === 'colour') { if (!app) throw new Error('color needs <app> [colour theme | default]'); out = arg ? change('color', appId(app), arg, scope) : color(appId(app), scope); }
  else if (cmd === 'global-color' || cmd === 'global-colour') { if (!app) throw new Error('global-color needs a colour theme or default'); out = globalColor(app); }
  else if (['off', 'restore', 'undo'].includes(cmd)) out = change(cmd, appId(app), undefined, scope);
  else if (cmd === 'at') out = at(appId(app), scope);
  else if (cmd === 'global') { if (!app) out = { global: readGlobal() }; else out = global(app); }
  else if (cmd === 'coverage') out = coverage();
  else if (cmd === 'covers') { if (!app) throw new Error('covers needs a skin id'); out = covers(app); }
  else throw new Error(`unknown command ${cmd}`);
  if (json) console.log(JSON.stringify({ ok: true, result: out }));
  else if (cmd === 'coverage') { for (const r of out.rows) console.log(`${r.type.padEnd(16)} ${r.by.padEnd(10)}${r.also.length ? `+${r.also.join('+')}` : ''}${r.elements.length ? `  ${r.elements.join('/')}` : ''}${r.behaviour.length ? `  behaviour: ${r.behaviour.join(', ')}` : ''}`); const s = out.summary; console.log(`${s.total} types · slot ${s.slot} · parts ${s.parts} · reference ${s.reference} · bundle ${s.bundle} · none ${s.none} · uncovered ${s.uncovered} · ${s.behaviour} with behaviour`); }
  else if (cmd === 'covers') { for (const c of out) console.log(`${c.missing ? '✗' : c.covered ? '✓' : '·'} ${c.type.padEnd(16)} ${c.by.padEnd(10)} ${c.how.join('; ')}${c.behaviour.axes.length ? `  behaviour ${c.behaviour.set.length}/${c.behaviour.axes.length}${c.behaviour.missing.length ? ` (unset: ${c.behaviour.missing.join(', ')})` : ''}` : ''}`); const miss = out.filter((c) => c.missing); console.log(miss.length ? `${miss.length} type(s) uncovered by this skin` : 'covers every type'); }
  else if (cmd === 'axes') { for (const t of out.types) for (const a of t.axes) console.log(`${t.type.padEnd(14)} ${a.name.padEnd(13)} ${a.kind.padEnd(7)} ${String(a.default).padEnd(12)} ${a.kind === 'choice' ? a.values.join(' | ') : a.kind === 'number' ? `${a.min}..${a.max}${a.unit ? ` ${a.unit}` : ''}` : 'true | false'}${a.field ? `  (layers on ${a.of ?? t.type}.${a.field})` : ''}`); console.log(`${out.tokens.length} axes on ${out.types.length} types · --fx-bhv-<type>-<axis> · axf.behaviour.<type>.<axis>`); }
  else if (cmd === 'behaviour' || cmd === 'behavior') { console.log(`${out.app} ${out.scope}: skin ${out.skin || 'none'}${out.from ? ` (from ${out.from})` : ''}`); for (const [t, axes] of Object.entries(out.resolved)) console.log(`  ${t.padEnd(14)} ${Object.entries(axes).map(([a, v]) => `${a}=${String(v)}${out.levelOverrides?.[t]?.[a] !== undefined ? '*' : ''}`).join('  ')}`); console.log('  * = overridden at this level'); }
  else if (cmd === 'compare') { console.log(`${out.a} vs ${out.b}${out.same ? ': the same' : ''}`); for (const d of out.slots) console.log(`  slot      ${d.type.padEnd(14)} ${String(d.a).padEnd(20)} ${d.b}`); for (const d of out.parts) console.log(`  parts     ${d.type.padEnd(14)} ${JSON.stringify(d.a)} → ${JSON.stringify(d.b)}`); for (const d of out.behaviour) console.log(`  behaviour ${`${d.type}.${d.axis}`.padEnd(28)} ${String(d.a).padEnd(14)} ${String(d.b)}`); if (out.iconPack) console.log(`  iconPack  ${out.iconPack.a} → ${out.iconPack.b}`); }
  else console.log(Array.isArray(out) ? out.map((x) => JSON.stringify(x)).join('\n') : JSON.stringify(out));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((e) => {
    console.log(process.argv.includes('--json') ? JSON.stringify({ ok: false, error: e.message }) : e.message);
    process.exitCode = 1;
  });
}
