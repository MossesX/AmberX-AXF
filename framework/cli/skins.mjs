#!/usr/bin/env node
/**
 * Skins (engines/skin.ts): every app's own look document on the hub, `shared/settings/looks/<app>.json`.
 *
 *   node framework/cli/skins.mjs apps                      apps, their skin switch and overrides
 *   node framework/cli/skins.mjs list                      the skins (and design packages) that can be used
 *   node framework/cli/skins.mjs snapshot [--all | <app>] [--force]   save the current look as the app's default
 *   node framework/cli/skins.mjs use <app> <skin>          Use skin on, in that app only
 *   node framework/cli/skins.mjs off <app>                 back to the app's own look
 *   node framework/cli/skins.mjs back <app> <slot>         drop one override ("Back to skin")
 *   node framework/cli/skins.mjs restore <app>             back to the snapshot (keeps one undo)
 *   node framework/cli/skins.mjs undo <app>                undo the last restore
 *   add --json for machine output. An app is its id (axf-console) or its folder (console-web), or `console`, `axhub`, `amberx`, `molly`.
 *
 * Files are written where /projects is mounted (the hub's data folder), so open apps follow through the hub's change
 * feed. AXF_LOOKS_DIR points elsewhere (tests, local development); AXF_APPEARANCE_FILE is the shared document.
 */
import { chownSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { backToSkin, newAppLook, normalizeAppLook, normalizeLookPart, overriddenSlots, pickSkin, restoreAppDefault, setLookSlot, setUseSkin, undoRestore } from '../core/engines/skin-rules.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const ALIASES = { console: 'axf-console', 'console-web': 'axf-console', axhub: 'axhub-web', amberx: 'amberx-droid' };
const readJson = (f) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; } };

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

export function writeLook(doc, by = 'skins-cli') {
  mkdirSync(looksDir(), { recursive: true });
  const f = lookFile(doc.app);
  const tmp = `${f}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify({ ...doc, updatedBy: by, updatedAt: new Date().toISOString() })}\n`);
  renameSync(tmp, f);
  // the hub's data server owns its folder: a file written as root stays writable by it
  try { const { uid, gid } = statSync(dirname(sharedFile())); chownSync(looksDir(), uid, gid); chownSync(f, uid, gid); } catch { /* not root: the file is already ours */ }
}

function assetsOf(type) {
  const dir = join(ROOT, 'framework/assets', type);
  return existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => readJson(join(dir, f))).filter(Boolean) : [];
}
export const skinRows = () => [
  ...assetsOf('skin').map((a) => ({ id: a.id, name: a.name, kind: 'skin', description: a.description ?? '' })),
  ...assetsOf('design-package').map((a) => ({ id: a.id, name: a.name, kind: 'design-package', description: a.description ?? '' })),
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
export const status = (app) => { const l = readLook(app); return { app, snapshot: !!l, useSkin: !!l?.skin.use, skin: l?.skin.id ?? '', overrides: overriddenSlots(l), canUndo: !!l?.undo, own: Object.keys(l?.own.slots ?? {}) }; };

/** One change to one app's look; every transport comes through here. */
export function change(op, app, arg) {
  const l = need(app);
  if (op === 'use') {
    if (!skinKnown(arg)) throw new Error(`no skin "${arg}"`);
    writeLook(setUseSkin(pickSkin(l, arg), true));
  } else if (op === 'off') writeLook(setUseSkin(l, false));
  else if (op === 'back') writeLook(backToSkin(l, arg));
  else if (op === 'restore') writeLook(restoreAppDefault(l, new Date().toISOString()));
  else if (op === 'undo') { if (!l.undo) throw new Error(`${app} has nothing to undo`); writeLook(undoRestore(l)); } else throw new Error(`unknown change ${op}`);
  return status(app);
}

/** control@1 tokens.slots: a slot set from outside reaches every app's look. */
export function setSlotEverywhere(slot, id, by) {
  for (const app of appIds()) { const l = readLook(app); if (l) writeLook(setLookSlot(l, slot, id), by); }
}

function main(argv) {
  const json = argv.includes('--json');
  const args = argv.filter((a) => !a.startsWith('--'));
  const [cmd, app, arg] = args;
  let out;
  if (!cmd || cmd === 'apps') out = appIds().map(status);
  else if (cmd === 'list') out = skinRows();
  else if (cmd === 'snapshot') out = (argv.includes('--all') ? appIds() : [appId(app)]).map((a) => snapshot(a, argv.includes('--force')));
  else if (['use', 'back'].includes(cmd)) { if (!arg) throw new Error(`${cmd} needs <app> and a ${cmd === 'use' ? 'skin' : 'slot'}`); out = change(cmd, appId(app), arg); } else if (['off', 'restore', 'undo'].includes(cmd)) out = change(cmd, appId(app));
  else throw new Error(`unknown command ${cmd}`);
  console.log(json ? JSON.stringify({ ok: true, result: out }) : Array.isArray(out) ? out.map((x) => JSON.stringify(x)).join('\n') : JSON.stringify(out));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(process.argv.slice(2)); } catch (e) {
    console.log(process.argv.includes('--json') ? JSON.stringify({ ok: false, error: e.message }) : e.message);
    process.exitCode = 1;
  }
}
