/**
 * xlayout@1 (core/engines/xlayout.ts): replays spec/fixtures/xlayout.json through the reference engine (the Kotlin twin
 * is deferred, spec/PORTING.md; the fixture is what it will replay), checks the starter validates with no engine
 * errors, that the validator and the engine agree, and the registry (asset type, schema, not shared: host-only).
 *   npx -y tsx framework/spec/check-xlayout.mts
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { CHROME_KINDS, DEFAULT_MERGE, DEFAULT_PRESETS, MERGE_MODES, OPEN_TARGETS, TOOLBAR_LOCATIONS, TOOLBAR_SLOT_COUNT, XLAYOUT_CONTRACT, XLAYOUT_LIMITS, dockRulesOf, guestHidden, guestTakes, guestUrl, guestUserAgent, idePresets, normalizeXLayout, nsId, openTargetFor, parseToolbarItem, splitNs, stripNs, visibleToolbars, xlayoutErrors } from '../core/engines/xlayout';
import { embedTakeIds, embedFromQueryFull } from '../core/engines/embed';
import { validateAsset } from '../core/validate';
import { ASSET_TYPES, OPTIONAL_TYPES } from '../core/types';

const root = new URL('../', import.meta.url).pathname;
const f = JSON.parse(readFileSync(join(root, 'spec/fixtures/xlayout.json'), 'utf8'));
const spec = JSON.parse(readFileSync(join(root, 'schemas/asset-types.json'), 'utf8'));
let checks = 0;
const ok = (c: unknown, msg: string) => { assert.ok(c, msg); checks++; };
const eq = (a: unknown, b: unknown, msg: string) => { assert.deepEqual(JSON.parse(JSON.stringify(a ?? null)), JSON.parse(JSON.stringify(b ?? null)), msg); checks++; };

// ---- registry ----
eq(f.contract, XLAYOUT_CONTRACT, 'contract'); eq(f.kinds, CHROME_KINDS, 'kinds'); eq(f.modes, MERGE_MODES, 'modes'); eq(f.defaultMerge, DEFAULT_MERGE, 'default merge');
eq(f.slots, TOOLBAR_SLOT_COUNT, 'three toolbar slots'); eq(f.locations, TOOLBAR_LOCATIONS, 'locations'); eq(f.openTargets, OPEN_TARGETS, 'open targets'); eq(f.defaultPresets, DEFAULT_PRESETS, 'default presets'); eq(f.limits, XLAYOUT_LIMITS, 'limits');
ok((ASSET_TYPES as readonly string[]).includes('xlayout') && (OPTIONAL_TYPES as readonly string[]).includes('xlayout'), 'xlayout is an optional asset type');
ok(spec.types.xlayout?.shared === false && spec.types.xlayout?.optional === true && spec.types.xlayout?.required?.includes('apps'), 'asset-types.json: host-only, optional, apps required');
ok(existsSync(join(root, 'schemas/json/xlayout.schema.json')), 'JSON schema generated');
// every default preset is a real dock-layout starter
const layouts = readdirSync(join(root, 'assets/dock-layout')).map((n) => n.replace(/\.json$/, ''));
for (const p of DEFAULT_PRESETS) ok(layouts.includes(p), `default preset ${p} ships as a dock-layout starter`);
// the merged kinds are embed@1 takes (nav-menu / context-menu / toolbar / widgets joined app-menu)
for (const k of CHROME_KINDS.filter((k) => k !== 'banner')) ok(embedTakeIds().includes(k), `embed take ${k} registered`);

// ---- starters ----
const starters = readdirSync(join(root, 'assets/xlayout')).filter((n) => n.endsWith('.json')).map((n) => JSON.parse(readFileSync(join(root, 'assets/xlayout', n), 'utf8')));
ok(starters.length >= 1 && starters.some((a) => a.id === 'molly'), 'the Molly starter ships');
for (const a of starters) {
  const v = validateAsset(a); ok(v.ok, `starter ${a.id} validates: ${v.errors.join('; ')}`);
  eq(xlayoutErrors(a.data), [], `starter ${a.id} has no engine errors`);
  const fx = f.starters[a.id]; ok(fx, `starter ${a.id} is in the fixture`);
  eq(normalizeXLayout(a.data), fx.normalized, `starter ${a.id} normalized`); eq(v, fx.valid, `starter ${a.id} validator result`);
  const d = normalizeXLayout(a.data);
  eq(d.toolbars.length, TOOLBAR_SLOT_COUNT, `starter ${a.id} has three slots`);
  for (const t of d.toolbars) for (const it of t.items) if (it.app) ok(it.action.startsWith(`${it.app}:`) && d.apps.some((x) => x.id === it.app), `starter ${a.id}: item ${it.id} is namespaced to a listed app`);
}

// ---- fixture replay ----
for (const c of f.normalize) eq(normalizeXLayout(c.raw), c.out, `normalize ${c.name}`);
for (const c of f.errors) { eq(xlayoutErrors(c.raw), c.errors, `errors ${c.name}`); ok(c.errors.length > 0, `errors ${c.name}: something is wrong`); }
for (const c of f.items) eq(parseToolbarItem(c.raw, ['amberx', 'axhub', 'console']), c.item, `item ${JSON.stringify(c.raw)}`);
for (const c of f.open) eq(openTargetFor({ open: c.open }, c.ideOn), c.target, `open ${c.open} ide=${c.ideOn}`);
for (const c of f.ns.make) eq(nsId(c.app, c.id), c.ns, `ns ${c.app} ${c.id}`);
for (const c of f.ns.split) eq(splitNs(c.id, ['amberx', 'axhub', 'console']), c.out, `split ${c.id}`);
for (const c of f.ns.strip) eq(stripNs(c.id, c.app), c.out, `strip ${c.id}`);
const molly = normalizeXLayout(starters.find((a) => a.id === 'molly')!.data);
for (const c of f.merge) {
  const d = normalizeXLayout({ apps: starters.find((a) => a.id === 'molly')!.data.apps, merge: c.merge });
  eq(guestHidden(d), c.hidden, `hidden ${c.name}`); eq(guestTakes(d), c.takes, `takes ${c.name}`);
  eq(guestUrl(d, d.apps[0]!), c.url, `url ${c.name}`); eq(guestUrl(d, d.apps[2]!, 'molly', '#/build'), c.urlRoute, `url with route ${c.name}`); eq(guestUserAgent(d), c.userAgent, `user agent ${c.name}`);
  // what the guest reads back from that URL is exactly what the host meant
  const e = embedFromQueryFull(new URL(c.url).search);
  ok(e && e.host === 'molly', `guest detects the host (${c.name})`);
  eq(e!.takes ?? [], c.takes, `guest reads the takes (${c.name})`);
  for (const h of c.hidden) ok(e!.hidden.includes(h), `guest hides ${h} (${c.name})`);
}
eq(visibleToolbars(molly), f.toolbars.all, 'visible toolbars'); eq(visibleToolbars(molly, 'top'), f.toolbars.top, 'top toolbars'); eq(visibleToolbars(molly, 'bottom'), f.toolbars.bottom, 'bottom toolbars');
eq(visibleToolbars({ toolbars: molly.toolbars.map((t) => ({ ...t, visible: true })) }).map((t) => t.slot), f.toolbars.everyOn, 'every slot on, in order');
eq(idePresets(molly, ['ide', 'single', 'two-columns', 'other']), f.presets.offered, 'presets offered'); eq(idePresets(molly, []), f.presets.none, 'no presets');
eq(dockRulesOf(molly), f.presets.rules, 'dock rules'); eq(dockRulesOf(normalizeXLayout({ apps: [], ide: { paneLimit: 99 } })), f.presets.rulesClamped, 'dock rules clamped');

// ---- validator and engine agree ----
for (const c of f.errors) {
  const v = validateAsset({ $axf: 'asset@1', type: 'xlayout', id: 'x', name: 'X', version: '1', data: c.raw });
  ok(!v.ok, `validator rejects ${c.name}`);
  // the envelope check refuses non-object data before the engine sees it; for objects the engine's words come through
  if (c.raw && typeof c.raw === 'object') for (const e of c.errors) ok(v.errors.includes(e), `validator carries the engine error "${e}" (${c.name})`);
}
// an item's `open: pane` only applies while the IDE is on; standalone apps never get an xlayout (not shared, not baked)
ok(openTargetFor({ open: 'pane' }, false) === 'floating' && openTargetFor({ open: 'pane' }, true) === 'pane', 'pane needs the IDE switch');
for (const app of ['apps/console-web', 'apps/axhub-web', 'apps/amberx-droid', 'apps/molly']) ok(!existsSync(join(root, '..', app, 'src/axf/assets/xlayout')), `${app} does not bake xlayout (host-only)`);

console.log(`check-xlayout: ok (${checks} checks)`);
