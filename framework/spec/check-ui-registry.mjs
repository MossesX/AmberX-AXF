#!/usr/bin/env node
/**
 * ui-registry@1 (core/engines/ui-registry-rules.mjs): replays spec/fixtures/ui-registry.json — normalizing, the validator
 * (the same messages from core/validate.ts and the build engine), items from a console catalog / search entries / menu and
 * toolbar assets / a plugin manifest, merging, search + resolve (aliases, kind words, fuzzy), the open projection
 * (control@1 console commands + the in-app plan), user shortcuts + `uiSay`, voice-command@1 commands and coverage; then the
 * JSON Schema, the asset type and every app's registry asset. Exit 1 on any difference.
 *
 *   node framework/spec/check-ui-registry.mjs [--write]     (--write regenerates the expected outputs from the fixture's inputs)
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import * as R from '../core/engines/ui-registry-rules.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, '..', '..');
const FILE = join(here, 'fixtures', 'ui-registry.json');
const write = process.argv.includes('--write');
const fx = JSON.parse(readFileSync(FILE, 'utf8'));
let fails = 0; let n = 0;
const check = (name, ok, detail = '') => { n++; if (!ok) { fails++; console.error(`✗ ${name}${detail ? `\n  ${detail}` : ''}`); } };
const expect = (name, got, key, sub) => {
  const slot = sub ? fx.expected[sub] : fx.expected;
  if (write) { if (sub) { fx.expected[sub] ??= {}; fx.expected[sub][key] = got; } else fx.expected[key] = got; return; }
  check(name, isDeepStrictEqual(got, slot?.[key]), `got ${JSON.stringify(got).slice(0, 600)}`);
};
fx.expected ??= {};

/* ---- normalizing + validating */
const registry = R.normalizeUiRegistry(fx.registry);
expect('normalizeUiRegistry', registry, 'registry');
expect('uiRegistryErrors: a valid registry has none', R.uiRegistryErrors('ui-registry', fx.registry), 'validOk');
expect('uiRegistryErrors: the bad registry', R.uiRegistryErrors('ui-registry', fx.bad), 'badErrors');
check('uiRegistryErrors: another type is left alone', R.uiRegistryErrors('dialog', fx.bad).length === 0);
expect('normalizeUiItem: short open forms + defaults per kind', fx.items.map((i) => R.normalizeUiItem(i, { app: 'demo', owner: 'app', source: 'declared' })), 'items');
check('normalizeUiItem: nothing without a label or a way to open', R.normalizeUiItem({ id: 'screen:x' }) === null && R.normalizeUiItem({ id: 'widget:x', label: 'X', open: {} }) === null && R.normalizeUiItem({ id: 'nope', label: 'X' }) === null);
check('parseUiId', isDeepStrictEqual(R.parseUiId('button:plan-studio/new-plan'), { kind: 'button', key: 'plan-studio/new-plan' }) && R.parseUiId('plain') === null && R.parseUiId('Screen:x') === null);
check('uiEffect: action policy, default navigate', R.uiEffect(registry.items.find((i) => i.id === 'action:plan.delete')) === 'destructive' && R.uiEffect(registry.items[0]) === 'navigate');

/* ---- items from what exists */
expect('uiItemsFromConsoleCatalog', R.uiItemsFromConsoleCatalog(fx.catalog), 'fromCatalog');
expect('uiItemsFromSearchEntries', R.uiItemsFromSearchEntries(fx.search.entries, fx.search.actions, { app: 'console-web' }, (kind, id) => (id === 'plan-studio' ? 'plugin:plan-studio' : undefined)), 'fromSearch');
expect('uiItemsFromMenuAsset: app-menu', R.uiItemsFromMenuAsset(fx.menus.appMenu, { app: 'console-web' }), 'fromAppMenu');
expect('uiItemsFromMenuAsset: context-menu', R.uiItemsFromMenuAsset(fx.menus.contextMenu, { app: 'console-web' }), 'fromContextMenu');
expect('uiItemsFromMenuAsset: nav-menu', R.uiItemsFromMenuAsset(fx.menus.navMenu, { app: 'console-web' }), 'fromNavMenu');
expect('uiItemsFromMenuAsset: toolbar', R.uiItemsFromMenuAsset(fx.menus.toolbar, { app: 'console-web' }), 'fromToolbar');
expect('uiItemsFromPluginManifest', R.uiItemsFromPluginManifest(fx.manifest, 'plan-studio', { app: 'console-web' }), 'fromManifest');
expect('mergeUiItems: first wins, aliases unioned, gaps filled', R.mergeUiItems(fx.merge.declared, fx.merge.live, fx.merge.scanned), 'merged');

/* ---- search + resolve */
expect('uiQueryWords', fx.queries.map((q) => ({ q, ...R.uiQueryWords(q) })), 'queryWords');
expect('resolveUiItem', fx.resolve.map((q) => { const r = R.resolveUiItem(registry.items, q); return { q, item: r.item?.id ?? null, via: r.via ?? null, ambiguous: !!r.ambiguous, ...(r.candidates ? { candidates: r.candidates.map((c) => c.id) } : {}) }; }), 'resolve');
expect('searchUiItems', fx.search.queries.map((s) => ({ ...s, hits: R.searchUiItems(registry.items, s.q, s.opts).map((h) => h.id) })), 'search');
check('nearWord', R.nearWord('orkestrator', 'orchestrator', 2) && !R.nearWord('orkestrator', 'orchestrator', 1) && !R.nearWord('plan', 'plans', 0) && R.nearWord('plan', 'plans', 1) && R.nearWord('setings', 'settings', 1) && !R.nearWord('builds', 'guilds', 0));

/* ---- opening */
expect('uiOpenCommand', registry.items.map((i) => ({ id: i.id, command: R.uiOpenCommand(i, { to: 'recent' }) })), 'openCommands');
expect('uiOpenPlan', registry.items.map((i) => ({ id: i.id, plan: R.uiOpenPlan(i) })), 'openPlans');
check('uiElementSelector lists data-axf-ui first', R.uiElementSelector(registry.items[0]).startsWith(`[${R.UI_ATTR}="${registry.items[0].id}"]`));

/* ---- shortcuts + say */
const shortcuts = fx.shortcuts.map(R.normalizeUiShortcut).filter(Boolean);
expect('normalizeUiShortcut', shortcuts, 'shortcuts');
expect('uiShortcutErrors', fx.badShortcuts.map((s) => R.uiShortcutErrors(s)), 'shortcutErrors');
expect('uiSay', fx.say.map((h) => { const r = R.uiSay(registry.items, shortcuts, h); return { heard: h, item: r.item?.id ?? null, via: r.via ?? null, ambiguous: !!r.ambiguous, say: r.say }; }), 'say');
expect('uiVoiceCommands', R.uiVoiceCommands(fx.shortcuts, { api: 'POST /api/plugins/ui-shortcuts/say', mcp: 'ui-shortcuts_say' }), 'voice');
expect('uiRegistryCoverage', R.uiRegistryCoverage(registry.items, fx.found), 'coverage');

/* ---- constants + schema + the asset type */
check('every kind has a label', R.UI_KINDS.every((k) => R.UI_KIND_LABELS[k]));
check('every kind word maps to a kind', Object.values(R.UI_KIND_WORDS).every((k) => R.UI_KINDS.includes(k)));
const types = JSON.parse(readFileSync(join(ROOT, 'framework/schemas/asset-types.json'), 'utf8')).types;
check('asset-types.json has ui-registry (optional, no slot, not drawn)', types['ui-registry']?.optional === true && types['ui-registry'].roll?.slot === false && isDeepStrictEqual(types['ui-registry'].required, ['app', 'items']));
check('asset-types.json source enum = the rules', isDeepStrictEqual(types['ui-registry']?.enums?.source, [...R.UI_SOURCES, 'mixed']));
const schemaFile = join(ROOT, 'framework/schemas/json/ui-registry.schema.json');
check('schemas/json/ui-registry.schema.json exists', existsSync(schemaFile));
if (existsSync(schemaFile)) { const s = JSON.parse(readFileSync(schemaFile, 'utf8')); const props = s.properties?.data?.properties ?? s.definitions?.data?.properties ?? {}; check('schema lists items, app, source', !!props.items && !!props.app && !!props.source, Object.keys(props).join(',')); }
const propsNow = R.uiRegistrySchemaProperties();
check('uiRegistrySchemaProperties: kinds + vias + effects from the registry', isDeepStrictEqual(propsNow.items.items.properties.kind.enum, [...R.UI_KINDS]) && isDeepStrictEqual(propsNow.items.items.properties.open.properties.via.enum, [...R.UI_OPEN_VIAS]));

/* ---- every app's registry asset validates and matches its app */
for (const app of readdirSync(join(ROOT, 'apps'))) {
  const dir = join(ROOT, 'apps', app, 'src', 'assets', 'ui-registry');
  if (!existsSync(dir)) continue;
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    const asset = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    const errs = R.uiRegistryErrors(asset.type, asset.data);
    check(`apps/${app} ui-registry/${f} validates`, asset.type === 'ui-registry' && errs.length === 0, errs.join('; '));
    check(`apps/${app} ui-registry/${f}: every item is normalized as written`, isDeepStrictEqual(R.normalizeUiRegistry(asset.data).items, asset.data.items), 'run node framework/cli/ui-registry.mjs generate');
  }
}

if (write) { writeFileSync(FILE, `${JSON.stringify(fx, null, 2)}\n`); console.log(`fixture written: ${FILE}`); }
else if (fails) { console.error(`${fails} of ${n} ui-registry checks failed`); process.exit(1); }
else console.log(`✓ ui-registry@1: ${n} checks`);
