#!/usr/bin/env node
/**
 * Banner widget shapes on the hub (shape@1; engines shape-rules.mjs + shape-scope.mjs). The one writer every surface
 * goes through: this CLI, `axf shape …`, the theme-manager /shapes routes (REST, and MCP through plugin-commands), and
 * the control@1 targets tokens.shape.global | tokens.shape.skin | tokens.shape.widget. The running apps do the same
 * through rt.setShape / rt.restoreShape (console actions shape.set / shape.restore, voice).
 *
 *   node framework/cli/shapes.mjs list                                   every shape asset (starter + added), with kind
 *   node framework/cli/shapes.mjs get [<app>]                            the levels: global, per-skin picks, the app's pick, per-widget picks, history
 *   node framework/cli/shapes.mjs resolve <app> [--widget <type:id>] [--form phone|desktop]   the shape in force there and which level decided
 *   node framework/cli/shapes.mjs set <shape|inherit> --scope global|skin|app|widget [--app <app>] [--skin <id>] [--widget <type:id>] [--form …]
 *   node framework/cli/shapes.mjs restore --scope global|skin|app|widget [--app …] [--skin …] [--widget …]   Restore previous edit
 *   node framework/cli/shapes.mjs add <id> --name "…" (--corners tl=lg,tr=none,br=lg,bl=none | --mask "M … Z" [--viewbox "0 0 100 100"]) [--description "…"]
 *   add --json for machine output ({ ok, result } or { ok: false, error }).
 *
 * Where things live (the same keys the runtime reads, so an open app follows through the hub's change feed):
 *   global          shared appearance document settings["axf.tokens.shape.global"]          (every app)
 *   skin            shared appearance document settings["axf.tokens.shape.skin"][<skin id>]  (over the skin's own assets.shape)
 *   app             the app's look document: own.slots.shape (skin.overrides.shape while a skin is on)
 *   widget          the app's look document: own.settings["axf.banners.widgets.<app>.<form>"][<type:id>].shape
 *   history         shared appearance document settings["axf.tokens.shape.history"]
 *   added shapes    <shared settings folder>/shapes/<id>.json (AXF_SHAPES_DIR), served by GET /api/plugins/theme-manager/shapes
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SHAPE_CORNERS, SHAPE_RADII, normalizeShape, shapeErrors } from '../core/engines/shape-rules.mjs';
import { SHAPE_HISTORY_SETTING, SHAPE_SETTING, SHAPE_SKIN_SETTING, normalizeShapeHistory, recordShapeEdit, resolveShapeAt, restorePreviousShape, shapeId, shapeScopeKey } from '../core/engines/shape-scope.mjs';
import { resolveLookSkin, setLookSlot } from '../core/engines/skin-rules.mjs';
import { appIds, readGlobal, readLook, sharedFile, writeLook } from './skins.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const ALIASES = { console: 'axf-console', 'console-web': 'axf-console', axhub: 'axhub-web', amberx: 'amberx-droid' };
const readJson = (f) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; } };
const ID = /^[a-z0-9][a-z0-9-]{1,47}$/;
const WIDGET = /^[a-z0-9-]{1,40}:[A-Za-z0-9._-]{1,80}$/;
export const SCOPES = ['global', 'skin', 'app', 'widget'];
const LEVEL = { global: 'global', skin: 'skin', app: 'app', widget: 'instance' };

export const shapesDir = () => process.env.AXF_SHAPES_DIR || join(dirname(sharedFile()), 'shapes');

function appId(name) {
  const id = ALIASES[name] ?? name;
  if (!id || !appIds().includes(id)) throw new Error(`no app "${name ?? ''}": one of ${appIds().join(', ')}`);
  return id;
}
const widgetsKey = (app, form = 'desktop') => `axf.banners.widgets.${app}.${form === 'phone' ? 'phone' : 'desktop'}`;

/* ---------------- assets ---------------- */

const starter = () => {
  const dir = join(ROOT, 'framework/assets/shape');
  return existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => readJson(join(dir, f))).filter(Boolean) : [];
};
const added = () => (existsSync(shapesDir()) ? readdirSync(shapesDir()).filter((f) => f.endsWith('.json')).map((f) => readJson(join(shapesDir(), f))).filter((a) => a?.type === 'shape') : []);

/** Every shape asset: the starters, then the ones added on the hub. */
export function list() {
  return [...starter().map((a) => ({ ...a, source: 'framework' })), ...added().map((a) => ({ ...a, source: 'hub' }))]
    .map((a) => ({ id: a.id, name: a.name, kind: normalizeShape(a.data).kind, description: a.description ?? '', source: a.source, data: normalizeShape(a.data) }));
}
const exists = (id) => list().some((a) => a.id === id);
const skinAsset = (id) => readJson(join(ROOT, 'framework/assets/skin', `${id}.json`)) ?? readJson(join(ROOT, 'framework/assets/design-package', `${id}.json`));

/* ---------------- the shared document ---------------- */

const shared = () => readJson(sharedFile()) ?? {};
const sharedSetting = (key) => shared().settings?.[key];
function writeShared(patch, by) {
  const f = sharedFile();
  const doc = readJson(f);
  if (!doc) throw new Error(`can't read the shared look at ${f}`);
  const settings = { ...(doc.settings ?? {}) };
  for (const [k, v] of Object.entries(patch)) { if (v === null || v === undefined || v === '') delete settings[k]; else settings[k] = v; }
  doc.settings = settings;
  doc.updatedBy = by;
  doc.updatedAt = new Date().toISOString();
  const tmp = `${f}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(doc)}\n`);
  renameSync(tmp, f);
}
const skinPicks = () => { const v = sharedSetting(SHAPE_SKIN_SETTING); return v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).filter(([k, id]) => ID.test(k) && shapeId(id))) : {}; };
export const history = () => normalizeShapeHistory(sharedSetting(SHAPE_HISTORY_SETTING));

/* ---------------- one level ---------------- */

/** The skin in force for an app (its own skin, or the hub-wide one it follows), '' = none. */
function skinOf(app) {
  const look = app ? readLook(app) : null;
  if (!look) return readGlobal()?.id ?? '';
  return resolveLookSkin(look, readGlobal(), null)?.id ?? '';
}
const skinShape = (skin) => (skin ? skinPicks()[skin] || shapeId(skinAsset(skin)?.data?.assets?.shape) : '');

/** What one level holds ('' = inherit). `where` = { app, skin, widget, form }. */
export function levelValue(scope, where = {}) {
  if (scope === 'global') return shapeId(sharedSetting(SHAPE_SETTING));
  if (scope === 'skin') return skinPicks()[where.skin || skinOf(where.app)] ?? '';
  const look = readLook(appId(where.app));
  if (!look) return '';
  if (scope === 'app') {
    const id = shapeId(look.skin.use ? look.skin.overrides?.shape : look.own.slots?.shape);
    return id && id !== skinShape(skinOf(look.app)) ? id : '';
  }
  return shapeId(look.own.settings?.[widgetsKey(look.app, where.form)]?.[where.widget]?.shape);
}

function writeLevel(scope, id, where, by) {
  if (scope === 'global') { writeShared({ [SHAPE_SETTING]: id || null }, by); return; }
  if (scope === 'skin') {
    const skin = where.skin || skinOf(where.app);
    if (!skin) throw new Error('no skin in force: name one with --skin <id> (or --app <app> with a skin on)');
    const picks = { ...skinPicks() };
    if (id) picks[skin] = id; else delete picks[skin];
    writeShared({ [SHAPE_SKIN_SETTING]: Object.keys(picks).length ? picks : null }, by);
    return;
  }
  const app = appId(where.app);
  const look = readLook(app);
  if (!look) throw new Error(`${app} has no look document on the hub yet (open it once, or run skins.mjs snapshot ${app})`);
  if (scope === 'app') { writeLook(setLookSlot(look, 'shape', id || null, readGlobal()), by); return; }
  const key = widgetsKey(app, where.form);
  const prefs = { ...(look.own.settings?.[key] ?? {}) };
  const mine = { ...(prefs[where.widget] ?? {}) };
  if (id) mine.shape = id; else delete mine.shape;
  if (Object.keys(mine).length) prefs[where.widget] = mine; else delete prefs[where.widget];
  const settings = { ...(look.own.settings ?? {}) };
  if (Object.keys(prefs).length) settings[key] = prefs; else delete settings[key];
  writeLook({ ...look, own: { ...look.own, settings } }, by);
}

function checkWhere(scope, where) {
  if (!SCOPES.includes(scope)) throw new Error(`--scope must be one of: ${SCOPES.join(', ')}`);
  if ((scope === 'app' || scope === 'widget') && !where.app) throw new Error(`--scope ${scope} needs --app <app>`);
  if (scope === 'widget' && !WIDGET.test(where.widget ?? '')) throw new Error('--scope widget needs --widget <type:id> (a banner widget key, e.g. clock:digital-12h)');
}
const historyKey = (scope, where) => shapeScopeKey(LEVEL[scope], scope === 'widget' ? where.widget : undefined);

/** Pick a shape at one level ('inherit' or '' = back to inherit); recorded for Restore previous edit. */
export function set(scope, value, where = {}, by = 'shapes-cli') {
  checkWhere(scope, where);
  const id = value === 'inherit' ? '' : String(value ?? '');
  if (id && (!ID.test(id) || !exists(id))) throw new Error(`no shape "${id}": one of ${list().map((a) => a.id).join(', ')}`);
  const before = levelValue(scope, where);
  writeLevel(scope, id, where, by);
  writeShared({ [SHAPE_HISTORY_SETTING]: recordShapeEdit(history(), historyKey(scope, where), before, id, new Date().toISOString()) }, by);
  return { scope, ...where, previous: before, current: id };
}

/** Put back what a level held before its last edit (a second restore brings the edit back). */
export function restore(scope, where = {}, by = 'shapes-cli') {
  checkWhere(scope, where);
  const r = restorePreviousShape(history(), historyKey(scope, where), new Date().toISOString());
  if (!r) throw new Error('nothing to restore at that level yet');
  writeLevel(scope, r.id, where, by);
  writeShared({ [SHAPE_HISTORY_SETTING]: r.history }, by);
  return { scope, ...where, current: r.id };
}

/** The shape in force for an app (and one widget), and which level decided. */
export function resolveAt(app, widget = '', form = 'desktop') {
  const a = appId(app);
  const where = { app: a, widget, form };
  const read = (key) => (key === 'global' ? levelValue('global') : key === 'skin' ? skinShape(skinOf(a)) : key === 'app' ? levelValue('app', where) : levelValue('widget', where));
  const r = resolveShapeAt(widget ? { widget } : null, read);
  return r.level === 'default' ? { ...r, note: "nothing picked: the banner asset's default (circle for icon-only widgets, pill for chips)" } : r;
}

/** Every level at once (for an app: its skin, its pick, its widgets). */
export function get(app) {
  const out = { global: levelValue('global'), skins: skinPicks(), history: history() };
  if (!app) return out;
  const a = appId(app);
  const look = readLook(a);
  const widgets = {};
  for (const form of ['desktop', 'phone']) for (const [k, v] of Object.entries(look?.own.settings?.[widgetsKey(a, form)] ?? {})) if (shapeId(v?.shape)) widgets[`${k}${form === 'phone' ? ' (phone)' : ''}`] = v.shape;
  return { ...out, app: a, skin: skinOf(a), skinShape: skinShape(skinOf(a)), appPick: levelValue('app', { app: a }), widgets, inForce: resolveAt(a) };
}

/** Add a corners or mask shape on the hub (validated by the same rules as every shape asset). */
export function add(id, { name, description, corners, mask, viewBox } = {}, by = 'shapes-cli') {
  if (!ID.test(id ?? '')) throw new Error('the id must be lower-case letters, digits and dashes (2 to 48)');
  if (exists(id)) throw new Error(`a shape "${id}" already exists`);
  const data = mask ? { kind: 'mask', mask, ...(viewBox ? { viewBox } : {}) } : { kind: 'corners', corners: corners ?? {} };
  const errors = shapeErrors('shape', data);
  if (errors.length) throw new Error(errors.join('; '));
  const asset = { $axf: 'asset@1', type: 'shape', id, name: name || id, version: '1.0.0', description: description || (mask ? 'A shape cut from an SVG path.' : 'A shape with a radius step per corner.'), author: by, tags: ['shape', 'custom'], data: normalizeShape(data) };
  mkdirSync(shapesDir(), { recursive: true });
  writeFileSync(join(shapesDir(), `${id}.json`), `${JSON.stringify(asset, null, 2)}\n`);
  return asset;
}

/** `tl=lg,tr=none` → { tl: 'lg', tr: 'none' } (unknown corners / steps are left for the validator to name). */
export function parseCorners(text) {
  const out = {};
  for (const part of String(text ?? '').split(',').map((s) => s.trim()).filter(Boolean)) { const [k, v] = part.split('='); if (k) out[k.trim()] = (v ?? '').trim(); }
  return out;
}

/* ---------------- CLI ---------------- */

function opts(argv) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') o.json = true;
    else if (a.startsWith('--')) { const [k, v] = a.slice(2).split('='); o[k] = v ?? argv[++i]; }
    else o._.push(a);
  }
  return o;
}

export function main(argv = process.argv.slice(2)) {
  const [cmd = 'help', ...rest] = argv;
  const o = opts(rest);
  const where = { ...(o.app ? { app: o.app } : {}), ...(o.skin ? { skin: o.skin } : {}), ...(o.widget ? { widget: o.widget } : {}), ...(o.form ? { form: o.form } : {}) };
  let result;
  try {
    switch (cmd) {
      case 'list': result = list().map(({ data: _d, ...r }) => r); break;
      case 'get': result = get(o._[0] ?? o.app); break;
      case 'resolve': result = resolveAt(o._[0] ?? o.app, o.widget ?? '', o.form); break;
      case 'set': result = set(o.scope ?? 'global', o._[0], where); break;
      case 'restore': result = restore(o.scope ?? 'global', where); break;
      case 'add': result = add(o._[0], { name: o.name, description: o.description, corners: o.corners ? parseCorners(o.corners) : undefined, mask: o.mask, viewBox: o.viewbox ?? o.viewBox }); break;
      default:
        console.log(`usage: shapes.mjs list | get [<app>] | resolve <app> [--widget <type:id>] | set <shape|inherit> --scope ${SCOPES.join('|')} [--app …] [--skin …] [--widget …] | restore --scope … | add <id> --name … (--corners ${SHAPE_CORNERS.map((c) => `${c}=<${SHAPE_RADII.join('|')}>`).join(',')} | --mask "M … Z") [--json]`);
        return cmd === 'help' ? 0 : 1;
    }
  } catch (e) {
    if (o.json) console.log(JSON.stringify({ ok: false, error: e.message }));
    else console.error(`\x1b[31m✗ ${e.message}\x1b[0m`);
    return 1;
  }
  if (o.json) console.log(JSON.stringify({ ok: true, result }));
  else if (Array.isArray(result)) for (const r of result) console.log(`${r.id.padEnd(16)} ${r.kind.padEnd(9)} ${r.source.padEnd(9)} ${r.name}`);
  else console.log(JSON.stringify(result, null, 2));
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main();
