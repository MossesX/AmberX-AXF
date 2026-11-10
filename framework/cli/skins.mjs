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
 *   node framework/cli/skins.mjs at <app> [--scope …]      which skin is in force at a place, and which level decided
 *   node framework/cli/skins.mjs back <app> <slot>         drop one override ("Back to skin")
 *   node framework/cli/skins.mjs restore <app>             back to the snapshot (keeps one undo)
 *   node framework/cli/skins.mjs undo <app>                undo the last restore
 *   node framework/cli/skins.mjs coverage                  how a skin reaches every registered asset type (CI: spec/check-skin-coverage.mjs)
 *   node framework/cli/skins.mjs covers <skin>             what one skin sets or styles, type by type
 *
 * Skins as packages of sections (skin-sections@1, Nov 10 2026):
 *   node framework/cli/skins.mjs sections [--category <section>] [--q <text>]   the slice library: every section asset, by section
 *   node framework/cli/skins.mjs skin <skin>               one skin's sections (asset per section) and what it resolves to
 *   node framework/cli/skins.mjs use <app> <skin> [--include a,b | --exclude c,d]   apply with picks: left-out sections keep the current look's
 *   node framework/cli/skins.mjs plan <app> <skin> [--include | --exclude]          the same, without writing: what mixes, from which skins
 *   node framework/cli/skins.mjs build <id> --name "…" --section colors=<id> [--section …] [--from <skin>] [--description …] [--tags a,b]
 *                                                          save a skin manifest from sections (--from starts from that skin's sections)
 *   node framework/cli/skins.mjs save-section <section> <id> --name "…" (--from <skin> | --file <asset.json> | --stdin) [--description …]
 *                                                          save one section as a standalone asset (--from copies that skin's section, inline chrome / parts included)
 *   node framework/cli/skins.mjs export <skin> [--out <file>]       the skin with its section assets inside (skin-package@1)
 *   node framework/cli/skins.mjs import (<file> | --stdin)          a skin-package@1 file: its sections, then the skin
 *   Saved assets live in AXF_SAVED_ASSETS_DIR/<type>/<id>.json (the Theme manager's data folder when called from the
 *   console) or --dir <folder>; built-in ids are never overwritten.
 *   add --json for machine output. An app is its id (axf-console) or its folder (console-web), or `console`, `axhub`, `amberx`, `molly`.
 *
 * Files are written where /projects is mounted (the hub's data folder), so open apps follow through the hub's change
 * feed. AXF_LOOKS_DIR points elsewhere (tests, local development); AXF_APPEARANCE_FILE is the shared document.
 */
import { chownSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { backToSkin, newAppLook, normalizeAppLook, normalizeLookPart, overriddenSlots, pickSkin, pickSkinWith, resolveLookSkin, restoreAppDefault, scopeEntries, setInheritSkin, setLookSlot, setScopeSkin, setUseSkin, undoRestore, SKIN_NEVER } from '../core/engines/skin-rules.mjs';
import { coverageSummary, coverageTable, isSubScopeKey, partElements, skinScopeOf } from '../core/engines/skin-coverage.mjs';
import { SKIN_SECTIONS, applySectionOverrides, exportSkinPackage, importSkinPackage, inlineSectionsOf, isSectionId, missingSections, mixSkins, resolveSections, sectionType, sectionsErrors, sectionsOf, skinManifest, sliceCatalog } from '../core/engines/skin-sections.mjs';

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

/** Where saved (user-made) assets live: AXF_SAVED_ASSETS_DIR or --dir, as <dir>/<type>/<id>.json. '' = none. */
export const savedDir = (argv = process.argv) => { const i = argv.indexOf('--dir'); return (i >= 0 ? argv[i + 1] : '') || process.env.AXF_SAVED_ASSETS_DIR || ''; };
const listDir = (dir, source) => (existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => { const a = readJson(join(dir, f)); return a && typeof a === 'object' ? { ...a, __source: source } : null; }).filter(Boolean) : []);
/** The assets of a type: the framework's starters, then the saved ones (a saved id never shadows a built-in). */
export function assetsOf(type) {
  const builtin = listDir(join(ROOT, 'framework/assets', type), 'builtin');
  const ids = new Set(builtin.map((a) => a.id));
  const saved = savedDir() ? listDir(join(savedDir(), type), 'saved').filter((a) => !ids.has(a.id)) : [];
  return [...builtin, ...saved];
}
const STYLE_MEMBERS = () => readJson(join(ROOT, 'framework/schemas/asset-types.json'))?.types?.['style-package']?.members ?? [];
/** skin-sections@1 resolver over the files: an asset's data by type and id. */
export const resolveAsset = (type, id) => assetsOf(type).find((a) => a.id === id)?.data ?? null;
const assetOf = (type, id) => assetsOf(type).find((a) => a.id === id) ?? null;
/** A skin or design package as resolved skin data (engines/skin.ts does the same in the app). */
export function skinDataOf(id, sections) {
  const s = assetOf('skin', id);
  const members = STYLE_MEMBERS();
  let skin = null;
  if (s) {
    const d = s.data ?? {};
    if (d.sections && Object.keys(d.sections).length) skin = resolveSections(d.sections, resolveAsset, members);
    else skin = { layoutTheme: d.layoutTheme ?? '', colorTheme: d.colorTheme ?? '', styleTheme: d.styleTheme ?? '', assets: { ...(d.assets ?? {}) }, ...(d.iconPack ? { iconPack: d.iconPack } : {}), ...(d.parts ? { parts: d.parts } : {}), ...(d.extras ? { extras: d.extras } : {}) };
  } else {
    const p = assetOf('design-package', id);
    if (!p) return null;
    const d = p.data ?? {};
    const x = d.extras ?? {};
    skin = { layoutTheme: d.layout ?? '', colorTheme: d['color-theme'] ?? '', styleTheme: d['style-theme'] ?? '', assets: { ...(x.slots ?? {}), ...(d['behavior-theme'] ? { 'behavior-theme': d['behavior-theme'] } : {}) } };
    if (x.spacing || x.hidden || x.settings) skin.extras = { ...(x.spacing ? { spacing: x.spacing } : {}), ...(x.hidden ? { hidden: x.hidden } : {}), ...(x.settings ? { settings: x.settings } : {}) };
    const derived = sectionsOf(skin);
    if (x.chrome) { const own = { ...skin.assets }; skin = applySectionOverrides(skin, { chrome: x.chrome }, resolveAsset, members); skin.assets = { ...skin.assets, ...own }; if (x.spacing) skin.extras = { ...(skin.extras ?? {}), spacing: x.spacing }; }
    skin.sections = { ...derived, ...(x.chrome ? { chrome: x.chrome } : {}) };
  }
  return sections && Object.keys(sections).length ? applySectionOverrides(skin, sections, resolveAsset, members) : skin;
}
export const skinRows = () => [
  ...assetsOf('skin').map((a) => ({ id: a.id, name: a.name, kind: 'skin', source: a.__source, description: a.description ?? '', sections: sectionsOf(a.data ?? {}), iconPack: a.data?.iconPack ?? '', parts: Object.keys(a.data?.parts ?? {}) })),
  ...assetsOf('design-package').map((a) => ({ id: a.id, name: a.name, kind: 'design-package', source: a.__source, description: a.description ?? '', sections: skinDataOf(a.id)?.sections ?? {}, iconPack: '', parts: [] })),
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

/* ---- skin-sections@1: the slice library, one skin's sections, apply with picks, build, save a section, export, import ---- */

const listArg = (argv, flag) => { const i = argv.indexOf(flag); const v = i >= 0 ? argv[i + 1] : ''; return v ? v.split(',').map((x) => x.trim()).filter(Boolean) : null; };
const strArg = (argv, flag, fb = '') => { const i = argv.indexOf(flag); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fb; };
const SKIN_ID = /^[a-z0-9][a-z0-9-]{1,47}$/;

/** The slice library over the files: every section asset, by section, with the skins that use it. */
export function sections(category = '', q = '') {
  const skins = [...assetsOf('skin'), ...assetsOf('design-package')].map((a) => ({ id: a.id, data: a.type === 'skin' ? a.data : (skinDataOf(a.id) ?? {}) }));
  let rows = sliceCatalog((type) => assetsOf(type), skins);
  if (category) { if (!isSectionId(category)) throw new Error(`"${category}" is not a section: ${SKIN_SECTIONS.map((s) => s.id).join(', ')}`); rows = rows.filter((r) => r.section === category); }
  if (q) { const t = q.toLowerCase(); rows = rows.filter((r) => `${r.id} ${r.name} ${r.description} ${r.tags.join(' ')}`.toLowerCase().includes(t)); }
  return rows;
}

/** One skin's sections: the asset per section, what it still carries inline, and the slots it resolves to. */
export function skin(id) {
  const data = skinDataOf(id);
  if (!data) throw new Error(`no skin "${id}"`);
  const a = assetOf('skin', id) ?? assetOf('design-package', id);
  const sections = sectionsOf(data);
  const detail = Object.fromEntries(Object.entries(sections).map(([sec, sid]) => { const x = assetOf(sectionType(sec), sid); return [sec, { id: sid, type: sectionType(sec), name: x?.name ?? sid, exists: !!x, source: x?.__source ?? 'missing' }]; }));
  return { id, kind: a.type, name: a.name, source: a.__source, sections: detail, inline: Object.keys(inlineSectionsOf(data, STYLE_MEMBERS())), resolved: { layout: data.layoutTheme, 'color-theme': data.colorTheme, 'style-theme': data.styleTheme, ...data.assets, ...(data.iconPack ? { 'icon-pack': data.iconPack } : {}) }, parts: Object.keys(data.parts ?? {}), extras: data.extras ?? {} };
}

/** The sections in force in an app now (the skin in force with its picks, or the app's own look's assets). */
export function currentSections(app) {
  const l = readLook(app);
  const inForce = resolveLookSkin(l, readGlobal(), null);
  const data = inForce.id ? skinDataOf(inForce.id, inForce.sections) : null;
  if (data) return { skin: inForce.id, sections: sectionsOf(data) };
  const slots = { ...(l?.default.slots ?? {}), ...(l?.own.slots ?? {}) };
  const out = {};
  for (const s of SKIN_SECTIONS) if (s.id !== 'icons' && s.id !== 'chrome' && s.id !== 'parts' && slots[s.type]) out[s.id] = slots[s.type];
  return { skin: '', sections: out };
}

/** What `use <app> <skin> --include | --exclude` gives, without writing. */
export function plan(app, id, argv) {
  const data = skinDataOf(id);
  if (!data) throw new Error(`no skin "${id}"`);
  const all = Object.keys(sectionsOf(data));
  const include = listArg(argv, '--include');
  const exclude = listArg(argv, '--exclude');
  for (const x of [...(include ?? []), ...(exclude ?? [])]) if (!isSectionId(x)) throw new Error(`"${x}" is not a section: ${SKIN_SECTIONS.map((s) => s.id).join(', ')}`);
  const take = include ?? (exclude ? all.filter((s) => !exclude.includes(s)) : all);
  return { app, skin: id, include: take, ...mixSkins(currentSections(app), { skin: id, sections: sectionsOf(data) }, take) };
}

/** Save an asset file into the saved folder (never over a built-in id). */
function saveAsset(asset, by = 'skins-cli') {
  const dir = savedDir();
  if (!dir) throw new Error('nowhere to save: set AXF_SAVED_ASSETS_DIR or pass --dir <folder>');
  if (!SKIN_ID.test(asset.id)) throw new Error(`"${asset.id}" is not an asset id (lower-case letters, digits, dashes)`);
  if (listDir(join(ROOT, 'framework/assets', asset.type), 'builtin').some((a) => a.id === asset.id)) throw new Error(`${asset.id} is a built-in ${asset.type}; save under another id`);
  mkdirSync(join(dir, asset.type), { recursive: true });
  const f = join(dir, asset.type, `${asset.id}.json`);
  writeFileSync(f, `${JSON.stringify({ ...asset, updatedBy: by, updatedAt: new Date().toISOString() }, null, 2)}\n`);
  return { ...asset, file: f };
}

/** `build <id> --name … --section colors=<id> … [--from <skin>]`: a skin manifest from sections. */
export function build(id, argv) {
  const from = strArg(argv, '--from');
  const start = from ? sectionsOf(skinDataOf(from) ?? (() => { throw new Error(`no skin "${from}"`); })()) : {};
  const picks = {};
  for (let i = 0; i < argv.length; i++) if (argv[i] === '--section' && argv[i + 1]) { const [sec, sid] = argv[i + 1].split('='); if (!isSectionId(sec)) throw new Error(`"${sec}" is not a section`); if (sid === '' || sid === 'none') delete start[sec]; else picks[sec] = sid; }
  const sections = { ...start, ...picks };
  const errors = [...sectionsErrors(sections), ...missingSections(sections, (t, sid) => !!assetOf(t, sid))];
  if (errors.length) throw new Error(errors.join('; '));
  const asset = skinManifest({ id, name: strArg(argv, '--name', id), description: strArg(argv, '--description'), tags: listArg(argv, '--tags') ?? ['skin', 'custom'], author: strArg(argv, '--author', 'skins-cli') }, sections, { caption: strArg(argv, '--caption') });
  return saveAsset(asset);
}

/** `save-section <section> <id> --name … (--from <skin> | --file <asset.json> | --stdin)`: one section as a standalone asset. */
export function saveSection(sec, id, argv, stdinText = '') {
  if (!isSectionId(sec)) throw new Error(`"${sec}" is not a section: ${SKIN_SECTIONS.map((s) => s.id).join(', ')}`);
  const type = sectionType(sec);
  const from = strArg(argv, '--from');
  const file = strArg(argv, '--file');
  let data;
  if (from) {
    const skinData = skinDataOf(from);
    if (!skinData) throw new Error(`no skin "${from}"`);
    const named = sectionsOf(skinData)[sec];
    const inline = inlineSectionsOf(skinData, STYLE_MEMBERS());
    if (named) data = resolveAsset(type, named);
    else if (sec === 'chrome' && inline.chrome) data = inline.chrome;
    else if (sec === 'parts' && inline.parts) data = inline.parts;
    if (!data) throw new Error(`${from} has no ${sec} section`);
  } else {
    const text = file ? readFileSync(file, 'utf8') : stdinText;
    if (!text) throw new Error('save-section needs --from <skin>, --file <asset.json> or --stdin');
    const raw = JSON.parse(text);
    data = raw && raw.$axf === 'asset@1' ? raw.data : raw;
  }
  const asset = { $axf: 'asset@1', type, id, name: strArg(argv, '--name', id), version: '1.0.0', description: strArg(argv, '--description', from ? `The ${sec} of ${from}, saved as its own asset.` : ''), author: strArg(argv, '--author', 'skins-cli'), tags: listArg(argv, '--tags') ?? [sec, 'custom'], data };
  return saveAsset(asset);
}

/** `export <skin>`: the skin and its section assets as one skin-package@1 document. */
export function exportSkin(id) {
  const a = assetOf('skin', id);
  const p = a ? null : assetOf('design-package', id);
  if (!a && !p) throw new Error(`no skin "${id}"`);
  const skinAsset = a ?? { ...p, type: 'skin', data: { sections: skinDataOf(id).sections, preview: {} } };
  const { __source, ...clean } = skinAsset;
  return exportSkinPackage(clean, (t, sid) => { const x = assetOf(t, sid); if (!x) return null; const { __source: _s, ...rest } = x; return rest; });
}

/** `import <file>`: a skin-package@1 file: its section assets, then the skin, into the saved folder. */
export function importSkin(text) {
  const r = importSkinPackage(JSON.parse(text));
  if (!r.ok) throw new Error(r.errors.join('; '));
  const saved = [];
  for (const sec of r.sections) { const builtin = listDir(join(ROOT, 'framework/assets', sec.type), 'builtin').some((x) => x.id === sec.id); if (!builtin) saved.push(saveAsset(sec, 'skins-import').file); }
  saved.push(saveAsset(r.skin, 'skins-import').file);
  return { id: r.skin.id, saved, notIncluded: r.notIncluded };
}

/** One change to one app's look; every transport comes through here. */
export function change(op, app, arg, scopeKey = '', argv = []) {
  const l = need(app);
  if (op === 'use') {
    if (!skinKnown(arg)) throw new Error(`no skin "${arg}"`);
    const picks = argv.includes('--include') || argv.includes('--exclude') ? plan(app, arg, argv) : null;
    writeLook(scopeKey ? setScopeSkin(l, scopeKey, 'on', arg, picks?.overrides) : setUseSkin(picks ? pickSkinWith(l, arg, picks.overrides) : pickSkin(l, arg), true));
    if (picks) return { ...status(app), mixed: picks.mixed, from: picks.from, left: picks.left, sources: picks.sources };
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
  const VALUED = ['--scope', '--include', '--exclude', '--category', '--q', '--name', '--description', '--tags', '--author', '--caption', '--from', '--file', '--out', '--dir', '--section'];
  const args = argv.filter((a, i) => !a.startsWith('--') && !VALUED.includes(argv[i - 1]));
  const [cmd, app, arg] = args;
  const scope = scopeArg(argv);
  let out;
  if (!cmd || cmd === 'apps') out = appIds().map(status);
  else if (cmd === 'list') out = skinRows();
  else if (cmd === 'snapshot') out = (argv.includes('--all') ? appIds() : [appId(app)]).map((a) => snapshot(a, argv.includes('--force')));
  else if (['use', 'back', 'inherit', 'follow'].includes(cmd)) { if (!arg) throw new Error(`${cmd} needs <app> and ${cmd === 'use' ? 'a skin' : cmd === 'back' ? 'a slot' : cmd === 'inherit' ? 'a scope' : 'on | off'}`); out = change(cmd, appId(app), arg, scope, argv); }
  else if (cmd === 'sections') out = sections(strArg(argv, '--category'), strArg(argv, '--q'));
  else if (cmd === 'skin') { if (!app) throw new Error('skin needs a skin id'); out = skin(app); }
  else if (cmd === 'plan') { if (!arg) throw new Error('plan needs <app> and a skin'); out = plan(appId(app), arg, argv); }
  else if (cmd === 'build') { if (!app) throw new Error('build needs a skin id'); out = build(app, argv); }
  else if (cmd === 'save-section') { if (!arg) throw new Error('save-section needs <section> and <id>'); out = saveSection(app, arg, argv, argv.includes('--stdin') ? readFileSync(0, 'utf8') : ''); }
  else if (cmd === 'export') { if (!app) throw new Error('export needs a skin id'); out = exportSkin(app); const f = strArg(argv, '--out'); if (f) { writeFileSync(f, `${JSON.stringify(out, null, 2)}\n`); out = { written: f, skin: out.skin.id, sections: out.sections.length, missing: out.missing }; } }
  else if (cmd === 'import') { out = importSkin(argv.includes('--stdin') ? readFileSync(0, 'utf8') : readFileSync(app, 'utf8')); }
  else if (['off', 'restore', 'undo'].includes(cmd)) out = change(cmd, appId(app), undefined, scope);
  else if (cmd === 'at') out = at(appId(app), scope);
  else if (cmd === 'global') { if (!app) out = { global: readGlobal() }; else out = global(app); }
  else if (cmd === 'coverage') out = coverage();
  else if (cmd === 'covers') { if (!app) throw new Error('covers needs a skin id'); out = covers(app); }
  else throw new Error(`unknown command ${cmd}`);
  if (json) console.log(JSON.stringify({ ok: true, result: out }));
  else if (cmd === 'coverage') { for (const r of out.rows) console.log(`${r.type.padEnd(16)} ${r.by.padEnd(10)}${r.also.length ? `+${r.also.join('+')}` : ''}${r.elements.length ? `  ${r.elements.join('/')}` : ''}`); const s = out.summary; console.log(`${s.total} types · slot ${s.slot} · parts ${s.parts} · reference ${s.reference} · bundle ${s.bundle} · none ${s.none} · uncovered ${s.uncovered}`); }
  else if (cmd === 'covers') for (const c of out) console.log(`${c.covered ? '✓' : '·'} ${c.type.padEnd(16)} ${c.by.padEnd(10)} ${c.how.join('; ')}`);
  else if (cmd === 'sections') for (const r of out) console.log(`${r.section.padEnd(11)} ${r.id.padEnd(24)} ${r.name.padEnd(28)} ${r.source.padEnd(8)} ${r.usedBy.length ? `used by ${r.usedBy.join(', ')}` : ''}`);
  else if (cmd === 'export') console.log(JSON.stringify(out, null, 2));
  else console.log(Array.isArray(out) ? out.map((x) => JSON.stringify(x)).join('\n') : JSON.stringify(out));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(process.argv.slice(2)); } catch (e) {
    console.log(process.argv.includes('--json') ? JSON.stringify({ ok: false, error: e.message }) : e.message);
    process.exitCode = 1;
  }
}
