#!/usr/bin/env node
/**
 * instance-look@1 without the UI (build own-look-per-grid-and-tab-group): one grid's / tab row's own look in an app's
 * look document on the hub (`shared/settings/looks/<app>.json` → own.settings, the same keys the settings dialog writes:
 * `axf.chrome.<kind>.<id>.look`, and `axf.chrome.<kind>.look` for every instance of the kind in the app). The running
 * app follows its document live, so a change here restyles the instance on every open screen.
 *
 *   node framework/cli/instance-look.mjs list [<app>] [--json]                        every instance with an own look
 *   node framework/cli/instance-look.mjs get <kind> <id> [--app <app>] [--json]       one instance's record ('-' id = app-wide)
 *   node framework/cli/instance-look.mjs set <kind> <id> key=value… [--app <app>]     set keys (value '' or 'skin' drops the key)
 *   node framework/cli/instance-look.mjs reset <kind> <id> [--app <app>]              drop the record: follow the skin (one undo)
 *   node framework/cli/instance-look.mjs undo <kind> <id> [--app <app>]               put back what the last reset dropped
 *   node framework/cli/instance-look.mjs keys                                         the ten keys and the values each takes
 *   axf look …                                                                        the same (axf.mjs)
 *
 * <kind> = tab-group | grid; <app> defaults to axf-console (aliases console, axhub, amberx). Values are refused unless they
 * are a colour-theme token name, `transparent` (backgrounds) or the key's step (instance-look-rules.mjs): never a raw
 * px or colour. The library half (listLooks, getLook, setLook, resetLook, undoLook) is what the theme-manager routes
 * and control@1 `tokens.looks` call, so the four ways in cannot drift. Undo lives beside the documents
 * (`looks/.instance-look-undo.json`), one per instance.
 */
import { chownSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BORDER_STEPS, INSTANCE_LOOK_KEYS, INSTANCE_LOOK_KEY_IDS, INSTANCE_LOOK_KINDS, RADIUS_STEPS, SPACE_STEPS, TEXT_STEPS, colourTokensOf, instanceLookKeyError, instanceLookStored, isInstanceLookId, isInstanceLookKind, normalizeInstanceLook } from '../core/engines/instance-look-rules.mjs';
import { CHROME_INSTANCE_LOOK_KEY, CHROME_KIND_LOOK_KEY } from '../core/engines/chrome-settings-rules.mjs';
import { appIds, looksDir, readLook, writeLook } from './skins.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const readJson = (f) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; } };
export const DEFAULT_APP = 'axf-console';
const ALIASES = { console: 'axf-console', 'console-web': 'axf-console', axhub: 'axhub-web', amberx: 'amberx-droid' };

export class LookError extends Error { constructor(code, message) { super(message); this.code = code; } }

let colours = null;
/** The colour-theme token names a value may name (the one registry). */
export function lookColourTokens() {
  if (!colours) colours = colourTokensOf(readJson(join(ROOT, 'framework/schemas/asset-types.json')));
  return colours;
}

export function appOf(name) {
  const id = ALIASES[name] ?? (name || DEFAULT_APP);
  const ids = appIds();
  if (!ids.includes(id)) throw new LookError('not_found', `no app "${name}" with a look document: one of ${ids.join(', ')}`);
  return id;
}
/** The settings key of one record; id '' or '-' = the app-wide record of the kind. */
export function lookKey(kind, id) {
  if (!isInstanceLookKind(kind)) throw new LookError('validation', `kind must be one of ${INSTANCE_LOOK_KINDS.join(', ')}, not ${String(kind)}`);
  if (!id || id === '-') return CHROME_KIND_LOOK_KEY(kind);
  if (!isInstanceLookId(id)) throw new LookError('validation', `${String(id)} is not an instance id (letters, digits, . _ : / -)`);
  return CHROME_INSTANCE_LOOK_KEY(kind, id);
}
function docOf(app) {
  const doc = readLook(app);
  if (!doc) throw new LookError('not_found', `${app} has no look document on the hub yet (it is written when the app first loads with skins)`);
  return doc;
}
const settingsOf = (doc) => doc.own?.settings ?? {};
function save(doc, key, record, by) {
  const settings = { ...settingsOf(doc) };
  if (record && Object.keys(record).length) settings[key] = record; else delete settings[key];
  writeLook({ ...doc, own: { ...doc.own, settings } }, by);
}

const LOOK_KEY = /^axf\.chrome\.(tab-group|grid)\.(?:(.+)\.)?look$/;
/** Every record in an app's document: [{ app, kind, id ('' = app-wide), key, look }]. */
export function listLooks(app = DEFAULT_APP) {
  const a = appOf(app);
  const out = [];
  for (const [key, raw] of Object.entries(settingsOf(docOf(a)))) {
    const m = LOOK_KEY.exec(key);
    if (!m) continue;
    const look = normalizeInstanceLook(raw, lookColourTokens());
    if (Object.keys(look).length) out.push({ app: a, kind: m[1], id: m[2] ?? '', key, look });
  }
  return out.sort((x, y) => Number(x.id !== '') - Number(y.id !== '') || x.kind.localeCompare(y.kind) || x.id.localeCompare(y.id));
}

/** One record: { app, kind, id, key, look, appWide, followsSkin, canUndo }. */
export function getLook(app, kind, id) {
  const a = appOf(app);
  const key = lookKey(kind, id);
  const s = settingsOf(docOf(a));
  const look = normalizeInstanceLook(s[key], lookColourTokens());
  const appWide = id && id !== '-' ? normalizeInstanceLook(s[CHROME_KIND_LOOK_KEY(kind)], lookColourTokens()) : {};
  return { app: a, kind, id: id === '-' ? '' : id ?? '', key, look, appWide, followsSkin: !Object.keys(look).length, canUndo: !!readUndo()[`${a}|${key}`] };
}

/** Set several keys at once ({ key: value }, value null / '' / 'skin' drops it). All or nothing: one bad value refuses the lot. */
export function setLook(app, kind, id, values, by = 'instance-look-cli') {
  const a = appOf(app);
  const key = lookKey(kind, id);
  if (!values || typeof values !== 'object' || !Object.keys(values).length) throw new LookError('validation', `give at least one key=value (${INSTANCE_LOOK_KEY_IDS.join(', ')})`);
  const doc = docOf(a);
  const next = normalizeInstanceLook(settingsOf(doc)[key], lookColourTokens());
  for (const [k, raw] of Object.entries(values)) {
    if (!INSTANCE_LOOK_KEY_IDS.includes(k)) throw new LookError('validation', `${k} is not a look key (${INSTANCE_LOOK_KEY_IDS.join(', ')})`);
    if (raw === null || raw === undefined || raw === '' || raw === 'skin') { delete next[k]; continue; }
    const v = String(raw);
    const err = instanceLookKeyError(k, v, lookColourTokens());
    if (err) throw new LookError('validation', err);
    next[k] = instanceLookStored(k, v, lookColourTokens());
  }
  save(doc, key, next, by);
  return getLook(a, kind, id);
}

const undoFile = () => join(looksDir(), '.instance-look-undo.json');
const readUndo = () => readJson(undoFile()) ?? {};
function writeUndo(map) {
  mkdirSync(looksDir(), { recursive: true });
  const tmp = `${undoFile()}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(map)}\n`);
  renameSync(tmp, undoFile());
  // the hub's data server owns the folder: a file written as root stays writable by it (as skins.mjs writeLook does)
  try { const { uid, gid } = statSync(looksDir()); chownSync(undoFile(), uid, gid); } catch { /* not root: the file is already ours */ }
}

/** Reset to skin: drop the record (kept for one undo). { changed, dropped }. */
export function resetLook(app, kind, id, by = 'instance-look-cli') {
  const a = appOf(app);
  const key = lookKey(kind, id);
  const doc = docOf(a);
  const before = normalizeInstanceLook(settingsOf(doc)[key], lookColourTokens());
  if (!Object.keys(before).length) return { ...getLook(a, kind, id), changed: false, dropped: {} };
  writeUndo({ ...readUndo(), [`${a}|${key}`]: before });
  save(doc, key, null, by);
  return { ...getLook(a, kind, id), changed: true, dropped: before };
}

/** Undo the last reset of one record (once). */
export function undoLook(app, kind, id, by = 'instance-look-cli') {
  const a = appOf(app);
  const key = lookKey(kind, id);
  const map = readUndo();
  const before = map[`${a}|${key}`];
  if (!before) throw new LookError('not_found', `nothing to undo for ${kind} ${id || '(app-wide)'} in ${a}`);
  delete map[`${a}|${key}`];
  writeUndo(map);
  save(docOf(a), key, normalizeInstanceLook(before, lookColourTokens()), by);
  return { ...getLook(a, kind, id), changed: true };
}

/** The keys and what each takes (for help, MCP tool descriptions and voice). */
export function lookKeys() {
  const steps = { text: TEXT_STEPS, space: SPACE_STEPS, border: BORDER_STEPS, radius: RADIUS_STEPS };
  return INSTANCE_LOOK_KEYS.map((k) => ({ key: k.key, label: k.label, kind: k.kind, description: k.description, values: k.kind === 'colour' ? [...(k.transparent ? ['transparent'] : []), ...lookColourTokens()] : steps[k.kind] ?? [] }));
}

/* ------------------------------------------------------------------ CLI */

const HELP = `instance-look@1: one grid's or tab row's own look (Settings… → Look on the grid / tab row)
  axf look list [<app>]                        every grid / tab row with an own look
  axf look get <kind> <id> [--app <app>]       one record ('-' as id = every <kind> in the app)
  axf look set <kind> <id> key=value… [--app]  e.g. rowBg=surface2 textSize=sm radius=md (value skin = drop the key)
  axf look reset <kind> <id> [--app <app>]     back to the skin (one undo)
  axf look undo <kind> <id> [--app <app>]      put the reset record back
  axf look keys                                the ten keys and their values
kind: tab-group | grid · app: ${DEFAULT_APP} (default), axhub-web, amberx-droid, … · --json for machine output`;

export function main(argv) {
  const json = argv.includes('--json');
  const ai = argv.indexOf('--app');
  const app = ai >= 0 ? argv[ai + 1] : '';
  const args = argv.filter((x, i) => x !== '--json' && (ai < 0 || (i !== ai && i !== ai + 1)));
  const [cmd, kind, id, ...rest] = args;
  const out = (v, text) => console.log(json ? JSON.stringify(v, null, 2) : text(v));
  const fmt = (r) => `${r.app} ${r.kind} ${r.id || '(app-wide)'}: ${Object.keys(r.look).length ? Object.entries(r.look).map(([k, v]) => `${k}=${v}`).join(' ') : 'follows the skin'}${r.canUndo ? ' · undo available' : ''}`;
  try {
    switch (cmd) {
      case 'list': { const rows = listLooks(kind || app || DEFAULT_APP); out(rows, (r) => r.length ? r.map(fmt).join('\n') : 'no grid or tab row has an own look'); return 0; }
      case 'get': out(getLook(app, kind, id), fmt); return 0;
      case 'set': {
        const values = Object.fromEntries(rest.map((p) => { const i = p.indexOf('='); if (i < 1) throw new LookError('validation', `${p}: write key=value`); return [p.slice(0, i), p.slice(i + 1)]; }));
        out(setLook(app, kind, id, values), (r) => `✓ ${fmt(r)}`); return 0;
      }
      case 'reset': out(resetLook(app, kind, id), (r) => r.changed ? `✓ reset to skin: ${r.app} ${r.kind} ${r.id || '(app-wide)'} (undo: axf look undo ${r.kind} ${r.id || '-'}${app ? ` --app ${app}` : ''})` : `${r.kind} ${r.id} already follows the skin`); return 0;
      case 'undo': out(undoLook(app, kind, id), (r) => `✓ undone: ${fmt(r)}`); return 0;
      case 'keys': out(lookKeys(), (ks) => ks.map((k) => `${k.key.padEnd(12)} ${k.label}: ${k.values.join(' ')}`).join('\n')); return 0;
      default: console.log(HELP); return cmd && cmd !== 'help' && cmd !== '--help' ? 1 : 0;
    }
  } catch (e) {
    console.error(json ? JSON.stringify({ ok: false, code: e.code ?? 'error', message: e.message }) : `✗ ${e.message}`);
    return e.code === 'validation' ? 2 : 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
