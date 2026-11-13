#!/usr/bin/env node
/**
 * Asset designer — the Node side of the server part. The console's Python server calls this for everything that
 * must agree with the framework's own engines, so there is one validator and one manifest maker, never a copy:
 *
 *   node server/designer.mjs validate  < {"asset": …}                     → {ok, errors}
 *   node server/designer.mjs prepare   < {"asset", "previous"?, "app"?, "by"?, "now"?}
 *                                                                          → {ok, errors, asset}  (asset carries its designed@1 manifest)
 *   node server/designer.mjs chrome    < {}                                → {ok, types, labels, fields, tabs, defaults}
 *   node server/designer.mjs types     < {}                                → {ok, items: [{type, label, group, icon, required, enums, optional_fields, attachable, hideable}]}
 *
 * The validator is the build engine's (`axf validate`, cli/build-engine.mjs); the manifest comes from
 * core/engines/designer-rules.mjs (designed@1); chrome fields from core/engines/chrome-settings-rules.mjs.
 * Reads one JSON document on stdin, prints one JSON line.
 */
import { validateAsset, spec } from '../../../../../framework/cli/build-engine.mjs';
import { DESIGNER_ADDONS, addonForType, designedOf, makeDesigned, withDesigned } from '../../../../../framework/core/engines/designer-rules.mjs';
import { CHROME_FIELDS, CHROME_LABELS, CHROME_SETTINGS_TABS, CHROME_TYPES, chromeSettingsDefaultId } from '../../../../../framework/core/engines/chrome-settings-rules.mjs';

const op = process.argv[2] ?? 'validate';
const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

function readStdin() {
  return new Promise((resolve) => {
    let s = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => { s += c; });
    process.stdin.on('end', () => resolve(s));
    if (process.stdin.isTTY) resolve('');
  });
}

function typesSummary() {
  return Object.entries(spec.types).map(([type, t]) => ({
    type, label: t.label, group: t.group ?? '', icon: t.icon ?? 'layers', description: t.description ?? '',
    required: t.required ?? [], enums: t.enums ?? {}, optional_fields: t.optional_fields ?? {},
    attachable: t.attachable === true, hideable: t.hideable === true, shared: t.shared !== false,
  }));
}

/** The asset with a fresh designed@1 manifest (first revision, or the next one after `previous`), then validated. */
function prepare(payload) {
  const asset = payload.asset;
  if (!isObj(asset) || typeof asset.type !== 'string' || typeof asset.id !== 'string') return { ok: false, errors: ['asset: an asset@1 object with type and id is needed'] };
  const base = { ...asset };
  delete base.designed;
  const prev = designedOf(payload.previous) ?? designedOf(asset);
  const addon = addonForType(DESIGNER_ADDONS, asset.type) ?? 'host';
  const now = typeof payload.now === 'string' && !Number.isNaN(Date.parse(payload.now)) ? payload.now : new Date().toISOString();
  const manifest = makeDesigned({ asset: base, addon, app: typeof payload.app === 'string' ? payload.app : '', by: typeof payload.by === 'string' ? payload.by : '', now, previous: prev });
  const out = withDesigned(base, manifest);
  const r = validateAsset(out);
  return { ok: r.ok, errors: r.errors, asset: out };
}

const text = await readStdin();
let payload = {};
try { payload = text.trim() ? JSON.parse(text) : {}; } catch (e) { console.log(JSON.stringify({ ok: false, errors: [`stdin is not JSON: ${e.message}`] })); process.exit(0); }

let result;
switch (op) {
  case 'validate': {
    const r = validateAsset(payload.asset);
    result = { ok: r.ok, errors: r.errors };
    break;
  }
  case 'prepare': result = prepare(payload); break;
  case 'chrome': result = { ok: true, types: CHROME_TYPES, labels: CHROME_LABELS, fields: CHROME_FIELDS, tabs: CHROME_SETTINGS_TABS, defaults: Object.fromEntries(CHROME_TYPES.map((t) => [t, chromeSettingsDefaultId(t)])) }; break;
  case 'types': result = { ok: true, items: typesSummary(), idPattern: spec.envelope.idPattern, frameworkVersion: spec.frameworkVersion }; break;
  default: result = { ok: false, errors: [`unknown op ${op}`] };
}
console.log(JSON.stringify(result));
