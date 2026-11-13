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
 *   node framework/cli/skins.mjs coverage                  how a skin reaches every registered asset type (CI: spec/check-skin-coverage.mjs)
 *   node framework/cli/skins.mjs covers <skin>             what one skin sets or styles, type by type
 *   add --json for machine output. An app is its id (axf-console) or its folder (console-web), or `console`, `axhub`, `amberx`, `molly`.
 *
 * Files are written where /projects is mounted (the hub's data folder), so open apps follow through the hub's change
 * feed. AXF_LOOKS_DIR points elsewhere (tests, local development); AXF_APPEARANCE_FILE is the shared document;
 * AXF_SKINS_DIR holds the Default skins (`shared/settings/skins/<app>.json`, skin-config-rules.mjs).
 */
import { chownSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { backToSkin, newAppLook, normalizeAppLook, normalizeLookPart, overriddenSlots, pickSkin, resolveLookSkin, restoreAppDefault, scopeEntries, setInheritSkin, setLookSlot, setScopeSkin, setSkinColorTheme, setUseSkin, skinColorTheme, undoRestore, SKIN_COLOR_SLOT, SKIN_NEVER } from '../core/engines/skin-rules.mjs';
import { coverageSummary, coverageTable, isSubScopeKey, partElements, skinScopeOf } from '../core/engines/skin-coverage.mjs';
import { defaultSkinMigration, isDefaultSkin, skinDeleteError, SKIN_CONFIG_GLOBAL } from '../core/engines/skin-config-rules.mjs';

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

function main(argv) {
  const json = argv.includes('--json');
  const args = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--scope');
  const [cmd, app, arg] = args;
  const scope = scopeArg(argv);
  let out;
  if (!cmd || cmd === 'apps') out = appIds().map(status);
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
