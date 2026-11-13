#!/usr/bin/env node
/**
 * Skins plugin CLI: the skin-switch@1 actions (framework/core/engines/skin-switch.mjs) over the same documents the
 * framework skins CLI writes (each app's app-look@1 document and the hub-wide skin on the shared appearance document).
 * The plugin's REST routes, its MCP commands and voice all call this file, so every way in makes the same change.
 *
 *   node apps/console-web/plugins/skin-gallery/skin-gallery.mjs list                         every skin, for the gallery
 *   node apps/console-web/plugins/skin-gallery/skin-gallery.mjs scopes [--app <app>]         the scopes that can be switched
 *   node apps/console-web/plugins/skin-gallery/skin-gallery.mjs state [--scope <s>] [--app <app>]   one scope: own state, skin in force, undo
 *   node apps/console-web/plugins/skin-gallery/skin-gallery.mjs use <skin> [--scope <s>] [--app <app>]
 *   node apps/console-web/plugins/skin-gallery/skin-gallery.mjs back [<slot>] [--scope <s>] [--app <app>]
 *   node apps/console-web/plugins/skin-gallery/skin-gallery.mjs restore [--scope <s>] [--app <app>]
 *   node apps/console-web/plugins/skin-gallery/skin-gallery.mjs undo [--app <app>]
 *   node apps/console-web/plugins/skin-gallery/skin-gallery.mjs scope <scope> follow|own [--app <app>]  Inherit / Follow hub switch
 *   node apps/console-web/plugins/skin-gallery/skin-gallery.mjs open [<skin>] [--scope <s>] [--view phone]  the console deep link
 *
 * Scopes: hub | app | app:<id> | ui:<view> | plugin:<id>; default app (the acting app's own level). The acting app is
 * --app (default axf-console): its look document keeps the one undo record. Add --json for machine output.
 */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { parseSwitchScope, skinSwitch, skinSwitchState, switchScopes } from '../../../../framework/core/engines/skin-switch.mjs';
import { appIds, change, coverage, covers, readGlobal, readLook, sharedFile, skinRows, writeLook } from '../../../../framework/cli/skins.mjs';

export const DEFAULT_APP = 'axf-console';
const ALIASES = { console: 'axf-console', 'console-web': 'axf-console', axhub: 'axhub-web', amberx: 'amberx-droid' };
const VERBS = { use: 'use', back: 'back-to-skin', restore: 'restore-default', undo: 'undo' };

function appOf(name) {
  const id = ALIASES[name] ?? name ?? DEFAULT_APP;
  if (!appIds().includes(id)) throw new Error(`no app "${name}": one of ${appIds().join(', ')}`);
  return id;
}

const known = () => new Set(skinRows().map((s) => s.id));

/** The gallery: every skin and design package, with the scopes each is in force at for the acting app. */
export function list(app = DEFAULT_APP) {
  const look = readLook(appOf(app));
  const global = readGlobal();
  const inForce = new Map();
  for (const scope of ['hub', ...switchScopes(look)]) {
    const v = skinSwitchState(look, global, scope);
    if (v?.inForce.id) inForce.set(v.inForce.id, [...(inForce.get(v.inForce.id) ?? []), v.scope]);
  }
  const total = coverage().summary.total;
  return skinRows().map((s) => {
    let covered = 0;
    try { covered = covers(s.id).filter((r) => r.covered).length; } catch { /* a skin the registry can't read counts as none */ }
    return { ...s, inForceAt: inForce.get(s.id) ?? [], coverage: { covered, total } };
  });
}

/** The scopes of the acting app that can be switched: hub, the app, and every ui / plugin scope its document holds. */
export function scopes(app = DEFAULT_APP) {
  const look = readLook(appOf(app));
  return ['hub', ...switchScopes(look)];
}

export function state(scope = 'app', app = DEFAULT_APP) {
  const id = appOf(app);
  if (!parseSwitchScope(scope)) throw new Error(`"${scope}" is not a scope: hub, app, app:<id>, ui:<view> or plugin:<id>`);
  const ids = known();
  const view = skinSwitchState(readLook(id), readGlobal(), scope, { has: (s) => ids.has(s) });
  if (!view) throw new Error(`${id} has no look document for ${scope}: run \`node framework/cli/skins.mjs snapshot ${id}\` first`);
  return { app: id, ...view };
}

function writeShared(global, by) {
  const f = sharedFile();
  const doc = JSON.parse(readFileSync(f, 'utf8'));
  if (global) doc.skin = { id: global.id, ...(Object.keys(global.overrides ?? {}).length ? { overrides: global.overrides } : {}), ...(global.colorTheme ? { colorTheme: global.colorTheme } : {}) };
  else delete doc.skin;
  doc.updatedBy = by;
  doc.updatedAt = new Date().toISOString();
  const tmp = `${f}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(doc)}\n`);
  renameSync(tmp, f);
}

/** One skin-switch@1 command for the acting app; saves what changed and returns the scope's new state. */
export function run(action, { scope = 'app', skin = '', slot = '', app = DEFAULT_APP, by = 'skin-gallery' } = {}) {
  const id = appOf(app);
  const ids = known();
  const look = readLook(id);
  const res = skinSwitch({ look, global: readGlobal() }, { action, scope, skin, slot }, { has: (s) => ids.has(s), now: new Date().toISOString() });
  if (!res.ok) { const e = new Error(res.message || res.error); e.code = res.error; throw e; }
  if (res.changed.look && res.look) writeLook(res.look, by);
  if (res.changed.global) writeShared(res.global, by);
  const shown = action === 'undo' ? (res.look?.undo === null && look?.undo ? look.undo.scope || 'app' : scope) : scope;
  return { changed: res.changed, ...state(shown, id) };
}

/**
 * The Inherit / Follow hub switch of one scope. `follow` on: the app follows the hub-wide skin, a screen or plugin
 * follows its parent. Off: the scope pins the skin in force there now (or no skin when none is).
 */
export function follow(scope, on, app = DEFAULT_APP) {
  const id = appOf(app);
  const sc = parseSwitchScope(scope);
  if (!sc || sc.kind === 'hub') throw Object.assign(new Error(`"${scope}" can't follow: pick app, ui:<view> or plugin:<id>`), { code: 'bad-scope' });
  const now = state(scope, id).inForce.id;
  if (sc.kind === 'app') {
    if (on) { change('off', id, ''); change('follow', id, 'on'); }
    else { change('follow', id, 'off'); if (now) change('use', id, now); }
  } else if (on) change('inherit', id, sc.key);
  else if (now) change('use', id, now, sc.key);
  else change('off', id, '', sc.key);
  return state(scope, id);
}

/** The console deep link (console_open target) for the gallery, one skin, or one scope. */
export function open(skin = '', scope = '', view = '') {
  const q = new URLSearchParams({ ...(skin ? { skin } : {}), ...(scope ? { scope } : {}), ...(view === 'phone' ? { view } : {}) }).toString();
  return { kind: 'screen', target: 'skin-gallery', ...(q ? { arg: q } : {}), link: `/#/skin-gallery${q ? `?${q}` : ''}` };
}

function main(argv) {
  const json = argv.includes('--json');
  const opt = (k) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };
  const args = argv.filter((a, i) => !a.startsWith('--') && !['--scope', '--app', '--view'].includes(argv[i - 1]));
  const [cmd = 'list', arg] = args;
  const app = opt('app') ?? DEFAULT_APP;
  const scope = opt('scope') ?? 'app';
  let out;
  if (cmd === 'list') out = list(app);
  else if (cmd === 'scopes') out = scopes(app);
  else if (cmd === 'state') out = state(scope, app);
  else if (cmd === 'use') { if (!arg) throw new Error('use needs a skin id'); out = run('use', { scope, skin: arg, app }); }
  else if (cmd === 'back') out = run('back-to-skin', { scope, slot: arg ?? '', app });
  else if (cmd === 'restore') out = run('restore-default', { scope, app });
  else if (cmd === 'undo') out = run('undo', { scope, app });
  else if (cmd === 'scope') { if (!arg) throw new Error('scope needs a scope: app, ui:<view> or plugin:<id>'); out = follow(arg, (args[2] ?? 'follow') !== 'own', app); }
  else if (cmd === 'open') out = open(arg ?? '', opt('scope') ?? '', opt('view') ?? '');
  else throw new Error(`unknown command ${cmd}: list | scopes | state | use | back | restore | undo | scope | open`);
  if (json) console.log(JSON.stringify({ ok: true, result: out }));
  else console.log(Array.isArray(out) ? out.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join('\n') : JSON.stringify(out, null, 1));
}

export const VERB_ACTIONS = VERBS;

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(process.argv.slice(2)); } catch (e) {
    console.log(process.argv.includes('--json') ? JSON.stringify({ ok: false, error: e.message, code: e.code ?? '' }) : e.message);
    process.exitCode = 1;
  }
}
