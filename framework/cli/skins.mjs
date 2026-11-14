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
 *   node framework/cli/skins.mjs restore <app>             back to the snapshot = the Default skin (keeps one undo)
 *   node framework/cli/skins.mjs undo <app>                undo the last restore
 *   node framework/cli/skins.mjs default <app>|global      the app's Default skin (its saved look as a skin@1 asset, default-<app>)
 *   node framework/cli/skins.mjs migrate [--all | <app>|global] [--dry]   write every Default skin that is missing or stale (idempotent:
 *                                                           a second run keeps everything); snapshots an app with no look document first
 *   node framework/cli/skins.mjs delete <skin>             refuse to delete a Default skin (framework skins are repo files, not deleted here)
 *   node framework/cli/skins.mjs config get|allow|lock|ask|inherit|depth|mode|reset|put|default|brief|hold|make|made <app>|global …
 *        skin-config@1, what the AI may change (configMain below lists the arguments); make = a skin by AI held to it
 *   node framework/cli/skins.mjs coverage                  how a skin reaches every registered asset type (CI: spec/check-skin-coverage.mjs)
 *   node framework/cli/skins.mjs covers <skin>             what one skin sets or styles, type by type
 *   node framework/cli/skins.mjs modes                     every skin's light and dark colour themes, and any skin missing one
 *   node framework/cli/skins.mjs mode <app> [light|dark|system] [--system light|dark] [--scope …]   read or switch the skin in force to
 *                                                          its light / dark colour theme, or follow the device (same skin, a colour pick)
 *   add --json for machine output. An app is its id (axf-console) or its folder (console-web), or `console`, `axhub`, `amberx`, `molly`.
 *
 * Files are written where /projects is mounted (the hub's data folder), so open apps follow through the hub's change
 * feed. AXF_LOOKS_DIR points elsewhere (tests, local development); AXF_APPEARANCE_FILE is the shared document;
 * AXF_SKINS_DIR holds the Default skins; AXF_SKIN_CONFIG_DIR the skin configs and made skins; AXF_SKIN_MAKER_CMD the generator.
 */
import { chownSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { backToSkin, newAppLook, normalizeAppLook, normalizeLookPart, overriddenSlots, pickSkin, resolveLookSkin, restoreAppDefault, scopeEntries, setInheritSkin, setLookSlot, setScopeSkin, setSkinColorTheme, setUseSkin, skinColorTheme, undoRestore, SKIN_COLOR_SLOT, SKIN_NEVER } from '../core/engines/skin-rules.mjs';
import { coverageSummary, coverageTable, isSubScopeKey, partElements, skinScopeOf } from '../core/engines/skin-coverage.mjs';
import { effectiveScheme, isSkinMode, skinModeColor, skinModeProblems, skinModeRows, skinSchemeOf, SKIN_MODES } from '../core/engines/skin-modes.mjs';
import { defaultSkinMigration, isDefaultSkin, skinDeleteError, SKIN_CONFIG_GLOBAL } from '../core/engines/skin-config-rules.mjs';
import * as SC from '../core/engines/skin-config-rules.mjs';
import { spawnSync } from 'node:child_process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const ALIASES = { console: 'axf-console', 'console-web': 'axf-console', axhub: 'axhub-web', amberx: 'amberx-droid' };
const readJson = (f) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; } };
const ID = /^[a-z0-9][a-z0-9-]*$/;

export const sharedFile = () => process.env.AXF_APPEARANCE_FILE || '/projects/_shared/_data/settings/appearance.json';
export const looksDir = () => process.env.AXF_LOOKS_DIR || join(dirname(sharedFile()), 'looks');
export const skinsDir = () => process.env.AXF_SKINS_DIR || join(dirname(sharedFile()), 'skins');
const lookFile = (app) => join(looksDir(), `${app}.json`);
const skinFile = (app) => join(skinsDir(), `${app}.json`);

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
/** The Default skins on the hub (`skins/<app>.json`), the hub-wide one first. */
export function defaultSkins() {
  if (!existsSync(skinsDir())) return [];
  return readdirSync(skinsDir()).filter((f) => f.endsWith('.json')).map((f) => readJson(join(skinsDir(), f))).filter(isDefaultSkin).sort((a, b) => (a.app === SKIN_CONFIG_GLOBAL ? -1 : b.app === SKIN_CONFIG_GLOBAL ? 1 : a.app.localeCompare(b.app)));
}
export const readDefaultSkin = (app) => { const s = readJson(skinFile(app)); return isDefaultSkin(s) && s.app === app ? s : null; };
export function writeDefaultSkin(skin, by = 'skins-cli') {
  mkdirSync(skinsDir(), { recursive: true });
  const f = skinFile(skin.app);
  const tmp = `${f}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify({ ...skin, updatedBy: by, updatedAt: new Date().toISOString() })}\n`);
  renameSync(tmp, f);
  chownLike(f);
}
export const skinRows = () => [
  ...defaultSkins().map((a) => ({ id: a.id, name: `${a.name} (${a.app})`, kind: 'skin', description: a.description ?? '', iconPack: '', parts: [], protected: true, app: a.app })),
  ...assetsOf('skin').map((a) => ({ id: a.id, name: a.name, kind: 'skin', description: a.description ?? '', iconPack: a.data?.iconPack ?? '', parts: Object.keys(a.data?.parts ?? {}) })),
  ...assetsOf('design-package').map((a) => ({ id: a.id, name: a.name, kind: 'design-package', description: a.description ?? '', iconPack: '', parts: [] })),
  ...madeSkins().map((a) => ({ id: a.id, name: a.name, kind: 'skin', description: a.description ?? '', iconPack: a.data?.iconPack ?? '', parts: Object.keys(a.data?.parts ?? {}), madeBy: 'ai', app: a.app })),
];

/** The three themes an app's look falls back to when its saved slots name none: the default design package's. */
function themeFill(shared) {
  const id = shared?.slots?.['design-package'] || 'hub-default';
  const pkg = assetsOf('design-package').find((p) => p.id === id) ?? assetsOf('design-package').find((p) => p.id === 'hub-default');
  return pkg ? { layout: pkg.data?.layout ?? '', 'color-theme': pkg.data?.['color-theme'] ?? '', 'style-theme': pkg.data?.['style-theme'] ?? '' } : {};
}

/**
 * The Default skin of one app (or `global`) brought up to date with its saved look: written when missing or stale,
 * kept when it already matches, so running it twice changes nothing. An app with no look document is snapshotted
 * first. `dry` decides without writing. Returns the migration row `{ app, action, skin, why }`.
 */
export function migrate(app, dry = false, by = 'skins-cli') {
  const shared = readJson(sharedFile());
  if (!shared) throw new Error(`can't read the shared look at ${sharedFile()}`);
  let lookPart;
  if (app === SKIN_CONFIG_GLOBAL) lookPart = normalizeLookPart(shared);
  else { if (!readLook(app) && !dry) snapshot(app); lookPart = (readLook(app) ?? newAppLook(app, shared)).default; }
  const row = defaultSkinMigration(app, lookPart, readDefaultSkin(app), themeFill(shared), SKIN_NEVER);
  if (!dry && (row.action === 'create' || row.action === 'update')) writeDefaultSkin(row.skin, by);
  return { ...row, skin: row.skin?.id ?? '', path: skinFile(app), written: !dry && (row.action === 'create' || row.action === 'update') };
}

/** The Default skin as the hub has it, or as it would be written (`derived: true`). */
export function defaultSkin(app) {
  const have = readDefaultSkin(app);
  if (have) return { ...have, derived: false };
  const shared = readJson(sharedFile());
  if (!shared) throw new Error(`can't read the shared look at ${sharedFile()}`);
  const lookPart = app === SKIN_CONFIG_GLOBAL ? normalizeLookPart(shared) : (readLook(app) ?? newAppLook(app, shared)).default;
  const row = defaultSkinMigration(app, lookPart, null, themeFill(shared), SKIN_NEVER);
  if (!row.skin) throw new Error(`${app}: ${row.why}`);
  return { ...row.skin, derived: true };
}

/** `skins.mjs delete <skin>`: a Default skin is never deleted; a framework skin is a repo file this CLI does not remove. */
export function deleteSkin(id) {
  const d = defaultSkins().find((s) => s.id === id);
  if (d) throw new Error(skinDeleteError(d));
  if (!skinKnown(id)) throw new Error(`no skin "${id}"`);
  throw new Error(`${id} is a framework skin (framework/assets/skin): remove the file from the repository, this CLI does not delete it`);
}

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
const optArg = (argv, flag) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] ?? '' : ''; };
const scopeArg = (argv) => { const i = argv.indexOf('--scope'); const v = i >= 0 ? argv[i + 1] : ''; if (v && !isSubScopeKey(v)) throw new Error(`"${v}" is not a scope: ui:<id> or plugin:<id>`); return v || ''; };

export const status = (app) => {
  const l = readLook(app);
  const inForce = resolveLookSkin(l, readGlobal(), null);
  return { app, snapshot: !!l, defaultSkin: readDefaultSkin(app)?.id ?? '', useSkin: !!l?.skin.use, follow: !!l?.skin.inherit, skin: l?.skin.id ?? '', inForce: inForce.id, from: inForce.from, colorTheme: inForce.colorTheme ?? '', overrides: overriddenSlots(l), scopes: scopeEntries(l), canUndo: !!l?.undo, own: Object.keys(l?.own.slots ?? {}) };
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
  else if (op === 'color') {
    // the colour theme inside the skin in force: the skin id never moves and no skin is created (Brett, Nov 9 2026)
    const pick = arg === 'default' || arg === 'skin' || arg === 'off' ? '' : arg;
    if (pick && !colorThemeKnown(pick)) throw new Error(`no colour theme "${pick}"`);
    const scope = scopeKey ? skinScopeOf(scopeKey, app) : { app };
    if (!resolveLookSkin(l, readGlobal(), scope).id) throw new Error(`${app}${scopeKey ? ` ${scopeKey}` : ''} has no skin in force: pick the colour theme with the app's own look (control@1 tokens.slots) or use a skin first`);
    writeLook(setSkinColorTheme(l, pick, scopeKey || undefined));
  }
  else if (op === 'restore') {
    // Restore to default = back to the saved look, which is the Default skin's source: the skin is brought up to date with it
    writeLook(restoreAppDefault(l, new Date().toISOString()));
    try { migrate(app); } catch { /* a look without the three themes has no Default skin yet; restore still happened */ }
  }
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

/* ---------------------------------------------------------------- light / dark (skin-modes@1) */

/** Where the light / dark / system choice is kept, per app and level: `{ "<app>": { "app": "system", "ui:x": "dark" } }`. */
export const modesFile = () => process.env.AXF_SKIN_MODES_FILE || join(dirname(sharedFile()), 'skin-modes.json');
const readModes = () => readJson(modesFile()) ?? {};
function writeModes(doc) {
  mkdirSync(dirname(modesFile()), { recursive: true });
  const tmp = `${modesFile()}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(doc)}\n`);
  renameSync(tmp, modesFile());
  chownLike(modesFile());
}
const skinAsset = (id) => assetsOf('skin').find((a) => a.id === id) ?? null;

/** Every skin's light and dark colour themes (`skins.mjs modes`). */
export const modeRows = () => skinModeRows(assetsOf('skin'));

/** Skins missing a light or a dark colour theme (empty = every skin covered). */
export const modeProblems = () => skinModeProblems(assetsOf('skin'), assetsOf('color-theme'));

/** The light / dark state at a place: the stored mode, the scheme showing and the skin's pair. */
export function mode(app, scopeKey = '') {
  const c = color(app, scopeKey);
  const skin = c.skin ? skinAsset(c.skin) : null;
  const stored = readModes()[app]?.[scopeKey || 'app'] ?? '';
  const pair = skin ? { light: skin.data?.colorThemes?.light ?? '', dark: skin.data?.colorThemes?.dark ?? '' } : { light: '', dark: '' };
  return { app, scope: scopeKey || 'app', skin: c.skin, mode: stored || skinSchemeOf(skin, c.colorTheme) || '', scheme: skinSchemeOf(skin, c.colorTheme), colorTheme: c.colorTheme, ...pair, modes: SKIN_MODES };
}

/**
 * Switch the skin in force to its light or dark colour theme, or follow the device (`system`; `prefers` = the device's
 * scheme when the caller knows it, else light). A colour pick inside the skin: the skin stays the same skin.
 */
export function setMode(app, value, scopeKey = '', prefers = '') {
  if (!isSkinMode(value)) throw new Error(`"${value}" is not a mode: ${SKIN_MODES.join(', ')}`);
  const l = need(app);
  const scope = scopeKey ? skinScopeOf(scopeKey, app) : { app };
  const inForce = resolveLookSkin(l, readGlobal(), scope);
  if (!inForce.id) throw new Error(`${app}${scopeKey ? ` ${scopeKey}` : ''} has no skin in force: use a skin first`);
  const skin = skinAsset(inForce.id);
  if (!skin) throw new Error(`"${inForce.id}" is a design package, not a skin: pick its day or night package instead`);
  const { pick } = skinModeColor(skin, value, prefers === 'dark');
  writeLook(setSkinColorTheme(l, pick, scopeKey || undefined));
  const modes = readModes();
  modes[app] = { ...(modes[app] ?? {}), [scopeKey || 'app']: value };
  writeModes(modes);
  return { ...mode(app, scopeKey), applied: effectiveScheme(value, prefers === 'dark') };
}

/** control@1 tokens.slots: a slot set from outside reaches every app's look (the colour theme lands inside a skin in force; never a new skin). */
export function setSlotEverywhere(slot, id, by) {
  const global = readGlobal();
  for (const app of appIds()) { const l = readLook(app); if (l) writeLook(setLookSlot(l, slot, id, global), by); }
}

/** skin-coverage@1 over the real registry and style targets. */
export function coverage() {
  const spec = readJson(join(ROOT, 'framework/schemas/asset-types.json')).types;
  const targets = readJson(join(ROOT, 'framework/schemas/customize.json')).targets ?? {};
  const rows = coverageTable(spec, targets, SKIN_NEVER);
  return { summary: coverageSummary(rows), rows };
}

/** What one skin (or design package) sets or styles, type by type. */
export function covers(skinId) {
  const a = assetsOf('skin').find((s) => s.id === skinId) ?? assetsOf('design-package').find((s) => s.id === skinId);
  if (!a) throw new Error(`no skin "${skinId}"`);
  const d = a.data ?? {};
  const slots = a.type === 'skin'
    ? { ...(d.assets ?? {}), ...(d.layoutTheme ? { layout: d.layoutTheme } : {}), ...(d.colorTheme ? { 'color-theme': d.colorTheme } : {}), ...(d.styleTheme ? { 'style-theme': d.styleTheme } : {}) }
    : { ...(d.extras?.slots ?? {}), ...(d.layout ? { layout: d.layout } : {}), ...(d['color-theme'] ? { 'color-theme': d['color-theme'] } : {}), ...(d['style-theme'] ? { 'style-theme': d['style-theme'] } : {}) };
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

/* ---------------------------------------------------------------- skin-config@1: what the AI may change */

export const configDir = () => process.env.AXF_SKIN_CONFIG_DIR || join(dirname(sharedFile()), 'skin-config');
const configFile = (app) => join(configDir(), `${app}.json`);
export const madeDir = () => join(configDir(), 'made');
let treeCache = null;
/** The permission tree over the real registry (asset-types.json + customize.json, the slots a skin never sets). */
export function configTree() {
  if (!treeCache) treeCache = SC.skinConfigTree(readJson(join(ROOT, 'framework/schemas/asset-types.json')), readJson(join(ROOT, 'framework/schemas/customize.json')) ?? {}, SKIN_NEVER);
  return treeCache;
}
const configApp = (name) => (name === SKIN_CONFIG_GLOBAL ? name : appId(name));
export const readConfig = (app) => SC.normalizeSkinConfig(readJson(configFile(app)), configTree()) ?? SC.newSkinConfig(app);

function writeAtomic(f, doc) {
  mkdirSync(dirname(f), { recursive: true });
  const tmp = `${f}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(doc)}\n`);
  renameSync(tmp, f);
  chownLike(f);
}
export function writeConfig(doc, by = 'skins-cli') {
  const clean = SC.normalizeSkinConfig({ ...doc, $axf: SC.SKIN_CONFIG_FRAME }, configTree());
  if (!clean) throw new Error('not a skin-config@1 document');
  const out = { ...clean, updatedBy: by, updatedAt: new Date().toISOString() };
  writeAtomic(configFile(clean.app), out);
  return out;
}

/** What a reader gets: the document, every option's mode and every limit, counts, and the Default skin it is held to. */
export function configState(app) {
  const tree = configTree();
  const config = readConfig(app);
  const eff = SC.effectiveConfig(config, tree);
  let def = null;
  try { const d = defaultSkin(app); def = { id: d.id, derived: d.derived, name: d.name }; } catch (e) { def = { id: '', derived: true, error: e.message }; }
  return { app, path: configFile(app), config, default: eff.default, counts: eff.counts, limits: eff.limits, options: eff.options, summary: SC.treeSummary(tree), defaultSkin: def, brief: SC.skinConfigBrief(config, tree) };
}

/**
 * One move on an app's config; every transport (panel, REST, MCP, CLI, voice) comes through here.
 * `allow | lock | ask | inherit <path>`, `depth <type> <n> [limit]`, `mode <allow|lock|ask>` (the document's default),
 * `reset`, `put <doc>` (whole document, checked first).
 */
export function configChange(op, app, a = '', b = '', c = '', by = 'skins-cli') {
  const tree = configTree();
  const cur = readConfig(app);
  let next;
  if (['allow', 'lock', 'ask', 'inherit'].includes(op)) { if (!a) throw new Error(`${op} needs a path: <type>[/<group>[/<option>]]`); next = SC.setConfigMode(cur, tree, a, op === 'inherit' ? null : op); }
  else if (op === 'depth' || op === 'limit') {
    if (!a) throw new Error('depth needs <type> <n> [limit id]');
    const lim = c || (SC.findLimit(tree, a, 'depth') ? 'depth' : SC.findCategory(tree, a)?.limits[0]?.id ?? 'depth');
    const v = b === 'default' || b === '' ? null : Number(b);
    if (v !== null && !Number.isInteger(v)) throw new Error(`${a}/${lim}: a whole number or default`);
    next = SC.setConfigLimit(cur, tree, a, lim, v);
  }
  else if (op === 'mode') next = SC.setConfigDefault(cur, a);
  else if (op === 'reset') next = SC.resetSkinConfig(cur);
  else if (op === 'put') {
    const doc = typeof a === 'string' ? JSON.parse(a) : a;
    const errors = SC.skinConfigErrors({ ...doc, app }, tree);
    if (errors.length) throw new Error(`skin-config@1: ${errors.slice(0, 8).join('; ')}`);
    next = { ...doc, app };
  } else throw new Error(`unknown config move ${op}`);
  writeConfig({ ...next, app }, by);
  return configState(app);
}

/** Save the app's current look (its saved default with its own changes on top) as the Default skin. */
export function saveCurrentAsDefault(app, by = 'skins-cli') {
  if (app !== SKIN_CONFIG_GLOBAL) {
    const l = readLook(app);
    if (!l) snapshot(app);
    else {
      const d = l.default; const o = l.own ?? {};
      const merged = normalizeLookPart({ slots: { ...(d.slots ?? {}), ...(o.slots ?? {}) }, spacing: o.spacing ?? d.spacing, hidden: { ...(d.hidden ?? {}), ...(o.hidden ?? {}) }, settings: { ...(d.settings ?? {}), ...(o.settings ?? {}) } });
      writeLook({ ...l, default: merged, own: {} }, by);
    }
  }
  return migrate(app, false, by);
}

/** An existing asset's data: the framework's, the console's, a skin the maker saved before. */
function assetData(type, id) {
  for (const dir of [join(ROOT, 'framework/assets', type), join(ROOT, 'apps/console-web/src/assets', type), join(madeDir(), 'assets', type)]) {
    const a = readJson(join(dir, `${id}.json`));
    if (a?.data) return a.data;
  }
  return null;
}

/** The generation brief for an app: allowed options, limits, the Default skin, and the asset ids each allowed slot can pick. */
export function makerBrief(app, wish = '') {
  const tree = configTree();
  const config = readConfig(app);
  const base = defaultSkin(app);
  const brief = SC.skinMakerBrief(config, tree, base, wish);
  const open = new Set(brief.allowed.map((a) => a.path.split('/')[0]));
  const choices = {};
  for (const c of tree.categories) {
    if (!open.has(c.type) || !SC.findGroup(tree, c.type, 'pick') || SC.optionMode(config, c.type, 'pick', SC.findGroup(tree, c.type, 'pick').options[0].id) !== 'allow') continue;
    const ids = assetsOf(c.type).map((a) => a.id).filter(Boolean);
    if (ids.length) choices[c.type] = ids.slice(0, 40);
  }
  return { ...brief, defaultSkin: base.id, choices };
}

/** Hold a maker's output (`{ skin, assets }`) to the app's config. */
export function holdOutput(app, output) {
  return SC.holdGeneratedSkin(output, defaultSkin(app), readConfig(app), configTree(), assetData);
}

/** The command that turns a brief into skin JSON: $AXF_SKIN_MAKER_CMD (brief on stdin, JSON on stdout), else `claude -p` on Opus. */
function makerCommand() {
  const env = process.env.AXF_SKIN_MAKER_CMD;
  if (env === 'off') return null;
  if (env) return ['sh', ['-c', env]];
  const has = spawnSync('sh', ['-c', 'command -v claude'], { encoding: 'utf8' });
  if (has.status !== 0) return null;
  return [process.execPath, [join(ROOT, 'framework/cli/agent-slots.mjs'), 'heavy', '--label', 'skin-maker', '--', 'claude', '-p', '--model', 'opus', '--output-format', 'text']];
}
const firstJson = (text) => { const s = String(text ?? ''); const i = s.indexOf('{'); const j = s.lastIndexOf('}'); if (i < 0 || j <= i) return null; try { return JSON.parse(s.slice(i, j + 1)); } catch { return null; } };

const madeId = (app, at) => `ai-${app}-${at.replace(/[^0-9]/g, '').slice(2, 14)}`.slice(0, 48);
export function madeJobs(app = '') {
  if (!existsSync(madeDir())) return [];
  return readdirSync(madeDir()).filter((f) => f.endsWith('.json')).map((f) => readJson(join(madeDir(), f))).filter((j) => j && (!app || j.app === app)).sort((a, b) => String(b.at).localeCompare(String(a.at)));
}

/**
 * Make a skin with AI under the app's config: brief → generator → held to the config → saved as a skin@1 asset (made by
 * AI, never the Default) with the new assets it names. `from` = a file (or JSON text) with the generator's output
 * instead of running it; `dry` = the brief only. The job record lists what was applied and what was dropped and why.
 */
export function make(app, { wish = '', from = '', dry = false, by = 'skins-cli' } = {}) {
  const brief = makerBrief(app, wish);
  const at = new Date().toISOString();
  const id = madeId(app, at);
  if (dry) return { id, app, status: 'brief', brief };
  let output = null; let error = '';
  if (from) output = firstJson(existsSync(from) ? readFileSync(from, 'utf8') : from);
  else {
    const cmd = makerCommand();
    if (!cmd) return { id, app, status: 'brief', brief, error: 'no skin maker here: set AXF_SKIN_MAKER_CMD or install the claude CLI; run make --from <output.json> with the result' };
    const prompt = `${brief.lines.join('\n')}\n\nAllowed paths: ${JSON.stringify(brief.allowed.map((a) => a.path))}\nLimits: ${JSON.stringify(brief.limits)}\nAsset ids you can pick: ${JSON.stringify(brief.choices)}\nThe Default skin: ${JSON.stringify(brief.base)}\n\nAnswer with the JSON only.`;
    const r = spawnSync(cmd[0], cmd[1], { input: prompt, encoding: 'utf8', timeout: 10 * 60_000, maxBuffer: 8 * 1024 * 1024 });
    output = firstJson(r.stdout);
    if (!output) error = `the skin maker returned no JSON (exit ${r.status ?? 'timeout'})${r.stderr ? `: ${r.stderr.trim().slice(0, 200)}` : ''}`;
  }
  if (!output) { const job = { id, app, at, status: 'failed', wish: brief.wish, error: error || 'no JSON in the output', by }; writeAtomic(join(madeDir(), `${id}.json`), job); return { ...job, brief }; }
  const held = holdOutput(app, output);
  const asset = { $axf: 'asset@1', type: 'skin', id, name: str(wish) || `AI skin for ${app}`, version: '1.0.0', description: `Made by AI from the Default skin of ${app} under its skin config${wish ? `: ${wish}` : ''}.`, author: 'AI skin maker', tags: ['skin', 'ai'], app, madeBy: 'ai', data: { ...held.skin, preview: { caption: str(wish) || 'Made by AI under the skin config.' } } };
  for (const a of held.assets) writeAtomic(join(madeDir(), 'assets', a.type, `${a.id}.json`), { $axf: 'asset@1', type: a.type, id: a.id, name: a.name, version: '1.0.0', author: 'AI skin maker', tags: ['ai'], data: a.data });
  writeAtomic(join(madeDir(), 'skins', `${id}.json`), asset);
  const job = { id, app, at, status: 'done', wish: brief.wish, skin: id, applied: held.applied, dropped: held.dropped, droppedLines: SC.droppedLines(held.dropped), assets: held.assets.map((a) => `${a.type}/${a.id}`), by };
  writeAtomic(join(madeDir(), `${id}.json`), job);
  return job;
}
const str = (v) => (typeof v === 'string' ? v.slice(0, 120) : '');
/** The skins the maker saved (skin@1 assets, usable like any skin). */
export const madeSkins = () => (existsSync(join(madeDir(), 'skins')) ? readdirSync(join(madeDir(), 'skins')).filter((f) => f.endsWith('.json')).map((f) => readJson(join(madeDir(), 'skins', f))).filter((a) => a?.type === 'skin') : []);

/**
 * `skins.mjs config <move> <app>|global …`:
 *   get | tree | schema | brief [--wish "…"] | made        read (brief = what the AI would get: allowed options + limits only)
 *   allow | lock | ask | inherit <type>[/<group>[/<option>]] one category, group or option
 *   depth <type> <n>|default [limit]                         a limit (menu levels, toolbar groups), clamped
 *   mode allow|lock|ask · reset · put <file> | --json-doc '{…}'   the default mode, everything back, the whole document
 *   default                                                  save the current look as the Default skin
 *   hold --from out.json                                     hold a generator's output to the config (nothing saved)
 *   make [--wish "…"] [--from out.json] [--dry]              brief → generator → held → saved as ai-<app>-… (dropped listed)
 * Stored at shared/settings/skin-config/<app>.json; made skins under made/. The generator is $AXF_SKIN_MAKER_CMD (brief
 * on stdin, JSON on stdout; `off` = none), else `claude -p` on Opus under the agent cap.
 */
function configMain(args, argv) {
  const [sub = 'get', app, a, b, c] = args;
  const flag = (k) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] ?? '' : ''; };
  if (sub === 'tree') return configTree();
  if (sub === 'schema') return SC.skinConfigSchema(configTree());
  if (!app) throw new Error(`config ${sub} needs <app> (or global)`);
  const id = configApp(app);
  if (sub === 'get') return configState(id);
  if (sub === 'brief') return makerBrief(id, flag('wish'));
  if (sub === 'default') return saveCurrentAsDefault(id);
  if (sub === 'make') return make(id, { wish: flag('wish'), from: flag('from'), dry: argv.includes('--dry') });
  if (sub === 'made') return madeJobs(id);
  if (sub === 'hold') { const f = flag('from') || a; if (!f) throw new Error('hold needs --from <output.json>'); return holdOutput(id, firstJson(existsSync(f) ? readFileSync(f, 'utf8') : f)); }
  if (sub === 'put') return configChange('put', id, flag('json-doc') || (a && existsSync(a) ? readFileSync(a, 'utf8') : a));
  return configChange(sub, id, a, b, c);
}

function main(argv) {
  const json = argv.includes('--json');
  const valued = ['--scope', '--system', '--wish', '--from', '--json-doc'];
  const args = argv.filter((a, i) => !a.startsWith('--') && !valued.includes(argv[i - 1]));
  const [cmd, app, arg] = args;
  const scope = cmd === 'config' ? '' : scopeArg(argv);
  let out;
  if (!cmd || cmd === 'apps') out = appIds().map(status);
  else if (cmd === 'config') out = configMain(args.slice(1), argv);
  else if (cmd === 'list') out = skinRows();
  else if (cmd === 'snapshot') out = (argv.includes('--all') ? appIds() : [appId(app)]).map((a) => snapshot(a, argv.includes('--force')));
  else if (cmd === 'migrate') out = (argv.includes('--all') || !app ? [SKIN_CONFIG_GLOBAL, ...appIds()] : [app === SKIN_CONFIG_GLOBAL ? app : appId(app)]).map((a) => migrate(a, argv.includes('--dry')));
  else if (cmd === 'default') { if (!app) throw new Error('default needs <app> or global'); out = defaultSkin(app === SKIN_CONFIG_GLOBAL ? app : appId(app)); }
  else if (cmd === 'delete') { if (!app) throw new Error('delete needs a skin id'); out = deleteSkin(app); }
  else if (['use', 'back', 'inherit', 'follow'].includes(cmd)) { if (!arg) throw new Error(`${cmd} needs <app> and ${cmd === 'use' ? 'a skin' : cmd === 'back' ? 'a slot' : cmd === 'inherit' ? 'a scope' : 'on | off'}`); out = change(cmd, appId(app), arg, scope); }
  else if (cmd === 'color' || cmd === 'colour') { if (!app) throw new Error('color needs <app> [colour theme | default]'); out = arg ? change('color', appId(app), arg, scope) : color(appId(app), scope); }
  else if (cmd === 'global-color' || cmd === 'global-colour') { if (!app) throw new Error('global-color needs a colour theme or default'); out = globalColor(app); }
  else if (['off', 'restore', 'undo'].includes(cmd)) out = change(cmd, appId(app), undefined, scope);
  else if (cmd === 'at') out = at(appId(app), scope);
  else if (cmd === 'global') { if (!app) out = { global: readGlobal() }; else out = global(app); }
  else if (cmd === 'coverage') out = coverage();
  else if (cmd === 'modes') out = { skins: modeRows(), problems: modeProblems() };
  else if (cmd === 'mode') { if (!app) throw new Error('mode needs <app> [light | dark | system] [--system light|dark]'); out = arg ? setMode(appId(app), arg, scope, optArg(argv, '--system')) : mode(appId(app), scope); }
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
