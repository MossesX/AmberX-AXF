#!/usr/bin/env node
/**
 * asset-gate@1 (framework/core/engines/asset-gate.mjs): a picked asset is applied only when it has a manifest (a
 * registered asset@1 document naming the same type and id) and passes schema conformance (the shared type spec).
 * Replays spec/fixtures/asset-gate.json, runs the build engine's gate over framework starters, and checks that the
 * runtime's apply paths (swap, skin picks, chrome instance picks) and the console API call the gate.
 *
 *   node framework/spec/check-asset-gate.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import * as G from '../core/engines/asset-gate.mjs';
import { gateAppAsset, spec } from '../cli/build-engine.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, '../..');
const read = (f) => readFileSync(join(ROOT, f), 'utf8');
const fx = JSON.parse(readFileSync(join(here, 'fixtures', 'asset-gate.json'), 'utf8'));
let fails = 0; let n = 0;
const check = (name, ok, detail = '') => { n++; if (!ok) { fails++; console.error(`✗ ${name}${detail ? `\n  ${detail}` : ''}`); } };

// the contract
check('contract id', G.ASSET_GATE_CONTRACT === fx.contract && G.ASSET_FRAME === spec.envelope.frame);
check('reasons are the fixture\'s', isDeepStrictEqual([...G.GATE_REASONS], fx.reasons) && fx.reasons.every((r) => typeof G.GATE_LABELS[r] === 'string'));
check('id pattern is the envelope\'s', G.ASSET_ID_PATTERN === spec.envelope.idPattern);
check('manifest fields are the envelope\'s required fields', isDeepStrictEqual([...G.MANIFEST_FIELDS], spec.envelope.required));

// fixture replay against a fixture registry + validator (the real validator is exercised below, over the framework)
const ctx = {
  isType: (t) => fx.types.includes(t),
  get: (t, id) => fx.registry[`${t}/${id}`] ?? null,
  validate: (raw) => { const k = `${raw.type}/${raw.id}`; return k in fx.invalid ? { ok: false, errors: fx.invalid[k] } : { ok: true, errors: [] }; },
};
for (const c of fx.cases) {
  const r = G.gateAsset(c.pick, ctx);
  check(`gateAsset: ${c.name}`, r.reason === c.reason && r.ok === (c.reason === 'ok') && isDeepStrictEqual(r.errors, c.errors) && r.label === G.GATE_LABELS[c.reason] && r.contract === fx.contract, JSON.stringify(r));
}
check('message: ok', G.gateMessage(G.gateAsset({ type: 'nav-menu', id: 'essentials-list' }, ctx)) === fx.messages.ok);
check('message: no manifest', G.gateMessage(G.gateAsset({ type: 'nav-menu', id: 'missing' }, ctx)) === fx.messages['no-manifest']);
check('message: invalid', G.gateMessage(G.gateAsset({ type: 'nav-menu', id: 'bad-data' }, ctx)) === fx.messages.invalid);
check('message: nothing is safe', G.gateMessage(null) === '' && G.gateState(null).ok === false && G.gateState(null).reason === 'bad-type');
const batch = G.gatePicks(fx.batch.picks, ctx);
check('gatePicks: one blocked pick blocks the batch', batch.ok === fx.batch.ok && isDeepStrictEqual(batch.blocked.map((r) => `${r.type}/${r.id}`), fx.batch.blocked) && batch.results.length === fx.batch.picks.length);
check('gatePicks: a non-list is an empty, passing batch', G.gatePicks(null, ctx).ok === true && G.gatePicks(null, ctx).results.length === 0);
const st = G.gateState(G.gateAsset({ type: 'nav-menu', id: 'bad-data' }, ctx));
check('gateState carries the message and no functions', st.message === fx.messages.invalid && Object.values(st).every((v) => typeof v !== 'function'));
check('a throwing registry is no manifest, a throwing validator is invalid',
  G.gateAsset({ type: 'nav-menu', id: 'essentials-list' }, { ...ctx, get: () => { throw new Error('boom'); } }).reason === 'no-manifest'
  && G.gateAsset({ type: 'nav-menu', id: 'essentials-list' }, { ...ctx, validate: () => { throw new Error('boom'); } }).reason === 'invalid');

// the build engine's gate over the framework's own starters (the real spec validator)
for (const p of fx.framework.pass) {
  const r = gateAppAsset({ framework: true, type: p.type, id: p.id });
  check(`framework starter passes: ${p.type}/${p.id}`, r.ok && r.reason === 'ok', JSON.stringify(r));
}
for (const p of fx.framework.refuse) {
  const r = gateAppAsset({ framework: true, type: p.type, id: p.id });
  check(`framework refuses: ${p.type}/${p.id} → ${p.reason}`, !r.ok && r.reason === p.reason, JSON.stringify(r));
}
const bad = gateAppAsset({ framework: true, type: 'nav-menu', id: 'essentials-list', raw: { $axf: 'asset@1', type: 'nav-menu', id: 'essentials-list', name: 'X', version: '1', data: { style: 'nope' } } });
check('a handed-in document that fails the type spec is invalid', bad.reason === 'invalid' && bad.errors.some((e) => e.startsWith('data.')), JSON.stringify(bad));

// the apply paths call the gate (framework default, enforced here)
const runtime = read('framework/core/runtime.ts');
const swapBody = runtime.slice(runtime.indexOf('\n  swap(type: AssetType, target: string): boolean {'), runtime.indexOf('\n  swap(type: AssetType, target: string): boolean {') + 3000);
check('runtime.swap gates the pick', /this\.checkAsset\(type, next\)/.test(swapBody));
for (const m of ['useSkin', 'pickSkin', 'scopeSkin']) {
  const at = runtime.indexOf(`\n  ${m}(`);
  check(`runtime.${m} gates the skin`, at > 0 && /this\.checkSkin\(/.test(runtime.slice(at, at + 1200)));
}
check('runtime exposes checkAsset / checkSkin / applyGate and the assets.check action', /\n  checkAsset\(type: string, id: string\): GateResult/.test(runtime) && /\n  checkSkin\(id: string\): GateResult/.test(runtime) && /\n  applyGate\(/.test(runtime) && /register\('assets\.check'/.test(runtime));
const chrome = read('framework/react/components/ChromeContext.tsx');
check('chrome instance picks (swapChrome) gate the pick', /rt\.applyGate\(rt\.checkAsset\(type, id\)/.test(chrome));
check('core exports the engine', /export \* from '\.\/engines\/asset-gate\.mjs';/.test(read('framework/core/index.ts')));
check('engine-rpc has the asset-gate op (REST / Python)', /case 'asset-gate':/.test(read('framework/cli/engine-rpc.mjs')));
check('the CLI has asset-check', /case 'asset-check':/.test(read('framework/cli/axf.mjs')));
for (const app of ['console-web', 'axhub-web', 'molly', 'amberx-droid']) {
  const base = `apps/${app}/src/axf`;
  let same = false;
  try { same = read(`${base}/core/engines/asset-gate.mjs`) === read('framework/core/engines/asset-gate.mjs') && /this\.checkAsset\(type, next\)/.test(read(`${base}/core/runtime.ts`)); } catch { same = false; }
  check(`${app} carries the gate (baked core)`, same);
}

console.log(`${fails ? '✗' : '✓'} asset-gate@1: ${n - fails}/${n} checks`);
process.exit(fails ? 1 : 0);
