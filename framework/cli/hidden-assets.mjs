#!/usr/bin/env node
/**
 * Hidden assets from the command line (hidden-assets@1; Brett, Nov 17 2026: "We're supposed to be able to hide toolbars
 * and tab groups and all that and be able to see what's hidden."): what is hidden in one app, hide a piece, bring one or
 * all of them back. The list is the app's own look document on the hub (`shared/settings/looks/<app>.json` →
 * `own.hiddenAssets`, spec/APPEARANCE-SOURCE.md), the same document the app reads, so an open app follows through the
 * hub's change feed and a closed one picks it up the next time it opens.
 *
 *   axf hidden list [--app <app>]                      everything hidden in the app, oldest first
 *   axf hidden hide <kind> <id> [--app] [--by <who>] [--asset <asset id>]
 *                                                      hide one piece (kind: tab-group | toolbar | banner | nav-menu | app-menu | widget)
 *   axf hidden unhide <kind> <id> [--app]              show it again
 *   axf hidden unhide-all [--app]                      show everything again
 *   axf hidden kinds                                   the kinds a piece can be hidden as
 *
 * `<kind> <id>` may also be given as one word, `<kind>:<id>` (the key the Hidden list shows). `--app` is the app id
 * (axf-console) or its alias (console, axhub); default the console. `--json` prints one JSON object
 * (`{ ok, app, changed, count, hidden }`, or `{ ok: false, error }` with exit code 1).
 *
 * The same moves in the UI (right-click → Hide, the Assets menu, Settings → Appearance → Hidden), over REST and MCP, and
 * by voice ("hide the toolbar", "show what's hidden", "unhide everything": core/engines/console-control-voice.mjs).
 *
 * The rules here are the ones of core/engines/hidden-assets.ts (that engine is TypeScript; this file runs on plain
 * node): the kinds come from the chrome-settings@1 kind list, one entry per kind + id, the first hide stands, oldest
 * first, at most 500. The document is read and written as saved (never re-shaped), so nothing else in it changes.
 * AXF_LOOKS_DIR points at another folder (tests, local development).
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHROME_TARGETS, CHROME_TYPES } from '../core/engines/chrome-settings-rules.mjs';
import { appIds, looksDir, writeLook } from './skins.mjs';

export const HIDDEN_ASSETS_FIELD = 'hiddenAssets';
export const HIDDEN_ASSETS_MAX = 500;
const WIDGET_KIND = 'widget';
const DEFAULT_APP = 'axf-console';
const ALIASES = { console: 'axf-console', 'console-web': 'axf-console', axhub: 'axhub-web' };
const ID = /^[a-z0-9][a-z0-9._:/-]{0,119}$/;
const ASSET_REF = /^[a-z0-9][a-z0-9._-]{0,119}$/;
const BY = /^[A-Za-z0-9][A-Za-z0-9 ._:@/-]{0,119}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const USAGE = 'list | hide <kind> <id> | unhide <kind> <id> | unhide-all | kinds  [--app <app>] [--by <who>] [--json]';

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/** The kinds a piece can be hidden as: the chrome kinds with a region on the page, plus widget. */
export const hiddenAssetKinds = () => [...CHROME_TYPES.filter((k) => (CHROME_TARGETS[k] ?? []).length > 0), WIDGET_KIND];
export const hiddenAssetKey = (kind, id) => `${kind}:${id}`;

/** `<kind> <id>` or `<kind>:<id>` → { kind, id }; throws in plain words for an unknown kind or a bad id. */
export function targetOf(kind, id) {
  let k = String(kind ?? '');
  let i = id;
  if (i === undefined && k.includes(':')) { i = k.slice(k.indexOf(':') + 1); k = k.slice(0, k.indexOf(':')); }
  if (!hiddenAssetKinds().includes(k)) throw new Error(`"${k}" is not a kind that can be hidden: one of ${hiddenAssetKinds().join(', ')}`);
  if (typeof i !== 'string' || !ID.test(i)) throw new Error(`"${i ?? ''}" is not a piece id (lower case letters, digits and . _ : / -, up to 120)`);
  return { kind: k, id: i };
}

/** The saved list, cleaned: well-formed entries only, one per kind + id (the first stands), the newest 500. */
export function normalizeHiddenAssets(raw) {
  const kinds = hiddenAssetKinds();
  const out = [];
  const seen = new Set();
  for (const e of Array.isArray(raw) ? raw : []) {
    if (!isObj(e) || !kinds.includes(e.kind) || typeof e.id !== 'string' || !ID.test(e.id)) continue;
    const key = hiddenAssetKey(e.kind, e.id);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      kind: e.kind,
      id: e.id,
      ...(typeof e.assetRef === 'string' && ASSET_REF.test(e.assetRef) ? { assetRef: e.assetRef } : {}),
      hiddenAt: typeof e.hiddenAt === 'string' && ISO.test(e.hiddenAt) ? e.hiddenAt : '',
      by: typeof e.by === 'string' && BY.test(e.by) ? e.by : '',
    });
  }
  return out.slice(-HIDDEN_ASSETS_MAX);
}

/** An app id or alias → the app id; throws when there is no such app. */
export function appId(name = DEFAULT_APP) {
  const id = ALIASES[name] ?? name;
  const ids = appIds();
  if (!id || !ids.includes(id)) throw new Error(`no app "${name}": one of ${ids.join(', ')}`);
  return id;
}

/** The app's look document as saved, or null when it has none (or it is not one). */
function readRawLook(app) {
  const f = join(looksDir(), `${app}.json`);
  if (!existsSync(f)) return null;
  let doc;
  try { doc = JSON.parse(readFileSync(f, 'utf8')); } catch { throw new Error(`${f} is not JSON: not touched`); }
  return isObj(doc) && doc.app === app ? doc : null;
}

function lookOf(app) {
  const look = readRawLook(app);
  if (!look) throw new Error(`${app} has no look document yet: open the app once (or run: node framework/cli/skins.mjs snapshot ${app})`);
  return look;
}

const listOf = (look) => normalizeHiddenAssets(isObj(look?.own) ? look.own[HIDDEN_ASSETS_FIELD] : undefined);

function save(look, list, by) {
  const own = { ...(isObj(look.own) ? look.own : {}) };
  if (list.length) own[HIDDEN_ASSETS_FIELD] = list; else delete own[HIDDEN_ASSETS_FIELD];
  writeLook({ ...look, own }, by);
}

const who = (by) => (typeof by === 'string' && BY.test(by) ? by : 'cli');

/** What is hidden in an app: `{ app, count, hidden }`. An app with no look document has nothing hidden. */
export function list(appName) {
  const app = appId(appName);
  const hidden = listOf(readRawLook(app));
  return { app, count: hidden.length, hidden };
}

/** Hide one piece. `changed` false when it was already hidden (the first hide stands). */
export function hide(appName, kind, id, { by, assetRef } = {}) {
  const t = targetOf(kind, id);
  if (assetRef !== undefined && !(typeof assetRef === 'string' && ASSET_REF.test(assetRef))) throw new Error(`"${assetRef}" is not an asset id`);
  const app = appId(appName);
  const look = lookOf(app);
  const cur = listOf(look);
  const key = hiddenAssetKey(t.kind, t.id);
  if (cur.some((e) => hiddenAssetKey(e.kind, e.id) === key)) return { app, key, changed: false, count: cur.length, hidden: cur };
  const next = normalizeHiddenAssets([...cur, { ...t, ...(assetRef ? { assetRef } : {}), hiddenAt: new Date().toISOString(), by: who(by) }]);
  save(look, next, who(by));
  return { app, key, changed: true, count: next.length, hidden: next };
}

/** Show one piece again. `changed` false when it wasn't hidden. */
export function unhide(appName, kind, id, { by } = {}) {
  const t = targetOf(kind, id);
  const app = appId(appName);
  const key = hiddenAssetKey(t.kind, t.id);
  const look = readRawLook(app);
  const cur = listOf(look);
  const next = cur.filter((e) => hiddenAssetKey(e.kind, e.id) !== key);
  if (!look || next.length === cur.length) return { app, key, changed: false, count: cur.length, hidden: cur };
  save(look, next, who(by));
  return { app, key, changed: true, count: next.length, hidden: next };
}

/** Show everything again. `changed` false when nothing was hidden. */
export function unhideAll(appName, { by } = {}) {
  const app = appId(appName);
  const look = readRawLook(app);
  const cur = listOf(look);
  if (!look || !cur.length) return { app, changed: false, count: 0, shown: 0, hidden: [] };
  save(look, [], who(by));
  return { app, changed: true, count: 0, shown: cur.length, hidden: [] };
}

const VALUE_FLAGS = ['--app', '--by', '--asset'];

function parse(argv) {
  const flags = {};
  const pos = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (VALUE_FLAGS.includes(a)) {
      if (argv[i + 1] === undefined || argv[i + 1].startsWith('--')) throw new Error(`${a} needs a value`);
      flags[a.slice(2)] = argv[++i];
    } else if (a === '--json') flags.json = true;
    else if (a.startsWith('--')) throw new Error(`unknown option ${a}: ${USAGE}`);
    else pos.push(a);
  }
  return { flags, pos };
}

const row = (e) => `  ${hiddenAssetKey(e.kind, e.id).padEnd(36)} ${e.hiddenAt || '-'}${e.by ? `  by ${e.by}` : ''}${e.assetRef ? `  (${e.assetRef})` : ''}`;

/** Run one `axf hidden …` command; prints the result, throws in plain words when it can't. */
export function main(argv) {
  const { flags, pos } = parse(argv);
  const [cmd = 'list', kind, id] = pos;
  const out = (r, text) => console.log(flags.json ? JSON.stringify({ ok: true, ...r }) : text);
  const opts = { ...(flags.by ? { by: flags.by } : {}) };
  switch (cmd) {
    case 'list': case 'ls': {
      const r = list(flags.app);
      return out(r, r.count ? `${r.count} hidden in ${r.app}:\n${r.hidden.map(row).join('\n')}` : `Nothing is hidden in ${r.app}.`);
    }
    case 'hide': {
      const r = hide(flags.app, kind, id, { ...opts, ...(flags.asset ? { assetRef: flags.asset } : {}) });
      return out(r, r.changed ? `${r.key} hidden in ${r.app} (${r.count} hidden).` : `${r.key} was already hidden in ${r.app}.`);
    }
    case 'unhide': case 'show': {
      const r = unhide(flags.app, kind, id, opts);
      return out(r, r.changed ? `${r.key} is back in ${r.app} (${r.count} still hidden).` : `${r.key} wasn't hidden in ${r.app}.`);
    }
    case 'unhide-all': case 'show-all': {
      const r = unhideAll(flags.app, opts);
      return out(r, r.changed ? `${r.shown} piece(s) back in ${r.app}.` : `Nothing was hidden in ${r.app}.`);
    }
    case 'kinds':
      return out({ kinds: hiddenAssetKinds() }, hiddenAssetKinds().join('\n'));
    default:
      throw new Error(`unknown command "${cmd}": ${USAGE}`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(process.argv.slice(2)); } catch (e) {
    console.log(process.argv.includes('--json') ? JSON.stringify({ ok: false, error: e.message }) : e.message);
    process.exitCode = 1;
  }
}
