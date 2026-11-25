#!/usr/bin/env node
/**
 * Hidden assets (hidden-assets@1; Brett, Nov 17 2026: "We're supposed to be able to hide toolbars and tab groups and all
 * that and be able to see what's hidden."): what is hidden in one app, hide a piece, bring one or all back. The list is
 * the app's own look document on the hub (`shared/settings/looks/<app>.json` → `own.hiddenAssets`), the same document the
 * app reads, so an open app follows through the hub's change feed (and re-reads on focus).
 *
 *   axf hidden list [--app <app>]                      everything hidden in the app, oldest first
 *   axf hidden hide <kind> <id> [--app] [--by <who>]   hide one piece (kind: tab-group | toolbar | banner | nav-menu | app-menu | widget)
 *   axf hidden unhide <kind> <id> [--app]              show it again
 *   axf hidden unhide-all [--app]                      show everything again
 *   axf hidden kinds                                   the kinds a piece can be hidden as
 *
 * `--app` is the app id (axf-console) or its alias (console, axhub, amberx); default the console. `--json` for machine
 * output (the console server's /api/hidden-assets routes and the MCP tools read it). The same moves in the UI
 * (right-click → Hide, Assets menu, Settings → Appearance → Hidden), the console actions (chrome.hide / chrome.unhide /
 * chrome.unhideAll / chrome.hidden) and voice. This file is the one writer outside a running app; it reuses the look
 * document I/O of skins.mjs (AXF_LOOKS_DIR for tests).
 */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HIDDEN_ASSETS_FIELD, hiddenAssetKey, hiddenAssetKinds, isHiddenAssetId, isHiddenAssetKind, normalizeHiddenAssets } from '../core/engines/hidden-assets-rules.mjs';
import { appId, readLook, writeLook } from './skins.mjs';

const DEFAULT_APP = 'axf-console';
const BY = /^[a-z0-9][a-z0-9._:@-]{0,79}$/i;

/** The kind + id a caller named, or an error in words. */
export function targetOf(kind, id) {
  if (!isHiddenAssetKind(kind)) return { error: `"${kind ?? ''}" can't be hidden: use one of ${hiddenAssetKinds().join(', ')}` };
  if (!isHiddenAssetId(id)) return { error: `"${id ?? ''}" is not a piece id (lower case letters, digits and . _ : / -, up to 120)` };
  return { kind, id };
}

/** The app's look document, or an error when it has none yet (the app writes it the first time it opens). */
function lookOf(app) {
  const look = readLook(app);
  if (!look) throw new Error(`${app} has no look document yet: open the app once (or run skins.mjs snapshot ${app})`);
  return look;
}

const listOf = (look) => normalizeHiddenAssets(look?.own?.[HIDDEN_ASSETS_FIELD]);

function save(look, list, by) {
  const own = { ...look.own };
  if (list.length) own[HIDDEN_ASSETS_FIELD] = list; else delete own[HIDDEN_ASSETS_FIELD];
  writeLook({ ...look, own }, by);
}

/** What is hidden in an app: `{ app, count, hidden: [...] }`. An app with no look document has nothing hidden. */
export function list(appName = DEFAULT_APP) {
  const app = appId(appName);
  const hidden = listOf(readLook(app));
  return { app, count: hidden.length, hidden };
}

/** Hide one piece. `changed` false when it was already hidden (the first hide stands). */
export function hide(appName, kind, id, { by = 'cli', assetRef } = {}) {
  const t = targetOf(kind, id);
  if (t.error) throw new Error(t.error);
  const app = appId(appName || DEFAULT_APP);
  const look = lookOf(app);
  const cur = listOf(look);
  const key = hiddenAssetKey(t.kind, t.id);
  if (cur.some((e) => hiddenAssetKey(e.kind, e.id) === key)) return { app, changed: false, count: cur.length, hidden: cur };
  const entry = { kind: t.kind, id: t.id, hiddenAt: new Date().toISOString(), by: BY.test(by) ? by : 'cli', ...(assetRef ? { assetRef } : {}) };
  const next = normalizeHiddenAssets([...cur, entry]);
  save(look, next, by);
  return { app, changed: true, count: next.length, hidden: next };
}

/** Show one piece again. `changed` false when it wasn't hidden. */
export function unhide(appName, kind, id, { by = 'cli' } = {}) {
  const t = targetOf(kind, id);
  if (t.error) throw new Error(t.error);
  const app = appId(appName || DEFAULT_APP);
  const look = lookOf(app);
  const cur = listOf(look);
  const key = hiddenAssetKey(t.kind, t.id);
  const next = cur.filter((e) => hiddenAssetKey(e.kind, e.id) !== key);
  if (next.length === cur.length) return { app, changed: false, count: cur.length, hidden: cur };
  save(look, next, by);
  return { app, changed: true, count: next.length, hidden: next };
}

/** Show everything again. `changed` false when nothing was hidden. */
export function unhideAll(appName, { by = 'cli' } = {}) {
  const app = appId(appName || DEFAULT_APP);
  const look = readLook(app);
  const cur = listOf(look);
  if (!look || !cur.length) return { app, changed: false, count: 0, shown: 0, hidden: [] };
  save(look, [], by);
  return { app, changed: true, count: 0, shown: cur.length, hidden: [] };
}

function flag(argv, name) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

function line(e) {
  return `${hiddenAssetKey(e.kind, e.id).padEnd(36)} ${e.hiddenAt || '-'}${e.by ? `  by ${e.by}` : ''}${e.assetRef ? `  (${e.assetRef})` : ''}`;
}

export function main(argv) {
  const json = argv.includes('--json');
  const app = flag(argv, '--app');
  const by = flag(argv, '--by');
  const pos = argv.filter((a, i) => !a.startsWith('--') && !['--app', '--by'].includes(argv[i - 1]));
  const [cmd = 'list', kind, id] = pos;
  const out = (r, text) => console.log(json ? JSON.stringify({ ok: true, ...r }) : text);
  switch (cmd) {
    case 'list': case 'ls': {
      const r = list(app || DEFAULT_APP);
      return out(r, r.count ? `${r.count} hidden in ${r.app}:\n${r.hidden.map(line).join('\n')}` : `Nothing is hidden in ${r.app}.`);
    }
    case 'hide': {
      const r = hide(app, kind, id, by ? { by } : {});
      return out(r, r.changed ? `${kind}:${id} hidden in ${r.app} (${r.count} hidden).` : `${kind}:${id} was already hidden in ${r.app}.`);
    }
    case 'unhide': case 'show': {
      const r = unhide(app, kind, id, by ? { by } : {});
      return out(r, r.changed ? `${kind}:${id} is back in ${r.app} (${r.count} hidden).` : `${kind}:${id} wasn't hidden in ${r.app}.`);
    }
    case 'unhide-all': case 'show-all': {
      const r = unhideAll(app, by ? { by } : {});
      return out(r, r.changed ? `${r.shown} piece(s) back in ${r.app}.` : `Nothing was hidden in ${r.app}.`);
    }
    case 'kinds':
      return out({ kinds: hiddenAssetKinds() }, hiddenAssetKinds().join('\n'));
    default:
      throw new Error(`unknown command "${cmd}": list | hide <kind> <id> | unhide <kind> <id> | unhide-all | kinds [--app <app>] [--json]`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(process.argv.slice(2)); } catch (e) {
    console.log(process.argv.includes('--json') ? JSON.stringify({ ok: false, error: e.message }) : e.message);
    process.exitCode = 1;
  }
}
