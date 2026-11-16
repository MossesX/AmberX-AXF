/**
 * Icon checks: icon-map@1 / icon-pack@1 / icon-scope@1 (engines/icon-pack.ts, icon-map.ts, icon-rules.mjs), icon-gen@1
 * (icon-gen.ts) and icon-import@1 (icon-import.ts) against their fixtures (spec/fixtures/icon-pack.json, icon-gen.json,
 * icon-import.json; regenerate with gen-fixtures.mts), the validators agreeing (core, build engine), the registry
 * entries, the documents carrying the icon block, and every starter icon-map / icon-pack asset.
 *   npx -y tsx framework/spec/check-icon-pack.mts
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { validateAsset } from '../core/validate';
import { ASSET_TYPES, OPTIONAL_TYPES } from '../core/types';
import * as ip from '../core/engines/icon-pack';
import * as im from '../core/engines/icon-map';
import * as ig from '../core/engines/icon-gen';
import * as ii from '../core/engines/icon-import';
import * as ir from '../core/engines/icon-rules.mjs';
import { APPEARANCE_NEVER, normalizeAppearance, mergeAppearance, serializeAppearance } from '../core/engines/appearance';
import { normalizeAppLook } from '../core/engines/skin-rules.mjs';
import { PATH_DATA } from '../core/engines/brand-rules.mjs';
import * as engine from '../cli/build-engine.mjs';

let n = 0;
const ok = (c: unknown, m: string) => { assert.ok(c, m); n++; };
const eq = (a: unknown, b: unknown, m: string) => { assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)), m); n++; };
const root = new URL('../../', import.meta.url);
const read = (p: string) => JSON.parse(readFileSync(new URL(p, root), 'utf8'));
const fx = read('framework/spec/fixtures/icon-pack.json');
const fg = read('framework/spec/fixtures/icon-gen.json');
const fi = read('framework/spec/fixtures/icon-import.json');

/* ---- registry ---- */
for (const t of ['icon-map', 'icon-pack']) { ok(ASSET_TYPES.includes(t as never), `${t} registered`); ok(OPTIONAL_TYPES.includes(t as never), `${t} optional`); }
const types = read('framework/schemas/asset-types.json').types;
ok(Object.keys(types).indexOf('icon-map') === Object.keys(types).indexOf('uac-policy') - 1, 'icon-map sits before uac-policy');
eq(types['icon-map'].skin, { by: 'none', why: types['icon-map'].skin.why }, 'icon-map: skin none with a why');
ok(typeof types['icon-map'].skin.why === 'string' && types['icon-map'].skin.why.length > 20, 'icon-map why is written');
eq(types['icon-pack'].skin.by, 'reference', 'icon-pack reached by reference');
eq(types['icon-pack'].skin.via, 'iconPack', 'icon-pack via skin.iconPack');
ok(types['icon-map'].collection === true, 'icon-map is a collection (every map in force)');
ok(APPEARANCE_NEVER.includes('icon-map'), 'icon-map is never an appearance slot');
for (const f of ['icon-map', 'icon-pack']) ok(existsSync(new URL(`framework/schemas/json/${f}.schema.json`, root)), `${f} JSON schema written`);
const mapSchema = read('framework/schemas/json/icon-map.schema.json');
ok(mapSchema.properties.data.properties.spots.propertyNames.pattern === ir.SPOT_ID.source, 'icon-map schema carries the spot id pattern');
eq(fx.contract.levels, [...ip.ICON_LEVELS], 'levels pinned');
eq(fx.contract.spotKinds, [...ir.SPOT_KINDS], 'spot kinds pinned');
eq(fx.contract.limits, ir.ICON_PACK_LIMITS, 'pack limits pinned');

/* ---- fixture replay: fold, chain, resolve ---- */
const packs: Record<string, unknown> = {
  base: read('framework/assets/icon-pack/amberx-outline.json'),
  child: { id: 'child', data: { style: 'filled', grid: 24, extends: 'base', glyphs: { x: 'M4 4l16 16M20 4L4 20', dot: { ref: 'name:x' } }, spots: { 'framework:tab-group/x': 'x', 'console-web:app/favicon': { d: 'M12 2l10 20H2z' } }, license: { id: 'MIT' } } },
  grandchild: { id: 'grandchild', data: { style: 'outline', grid: 24, extends: 'child', glyphs: { star: 'M12 2l3 7h7l-5 5 2 7-7-4-7 4 2-7-5-5h7z' } } },
  strict: { id: 'strict', data: { style: 'outline', grid: 24, fallback: 'none', glyphs: { home: 'M1 1h1' } } },
  loop1: { id: 'loop1', data: { style: 'outline', grid: 24, extends: 'loop2', glyphs: { a: 'M0 0h1' } } },
  loop2: { id: 'loop2', data: { style: 'outline', grid: 24, extends: 'loop1', glyphs: { b: 'M0 0h1' } } },
  orphan: { id: 'orphan', data: { style: 'outline', grid: 24, extends: 'missing-pack', glyphs: { a: 'M0 0h1' } } },
  deep5: { id: 'deep5', data: { style: 'outline', grid: 24, extends: 'deep4', glyphs: { e: 'M0 0h1' } } },
  deep4: { id: 'deep4', data: { style: 'outline', grid: 24, extends: 'deep3', glyphs: { d: 'M0 0h1' } } },
  deep3: { id: 'deep3', data: { style: 'outline', grid: 24, extends: 'deep2', glyphs: { c: 'M0 0h1' } } },
  deep2: { id: 'deep2', data: { style: 'outline', grid: 24, extends: 'deep1', glyphs: { b: 'M0 0h1' } } },
  deep1: { id: 'deep1', data: { style: 'outline', grid: 24, glyphs: { a: 'M0 0h1' } } },
};
const getPack = (id: string) => packs[id];
for (const [id, want] of Object.entries(fx.fold)) {
  const f = ip.foldIconPack(id, getPack);
  eq(f && { chain: f.chain, broken: f.broken, glyphs: Object.keys(f.glyphs).sort(), spots: Object.keys(f.spots).sort(), style: f.style, license: f.license }, want, `fold ${id}`);
}
ok(ip.foldIconPack('deep5', getPack)!.chain.length === ir.ICON_PACK_LIMITS.extendsDepth, 'extends chain stops at the depth cap');
eq(ip.foldIconPack('loop1', getPack)!.broken, ['loop1'], 'a cycle stops where it is');
eq(ip.foldIconPack('grandchild', getPack)!.license, { id: 'MIT' }, 'a licence is inherited when the child has none');
ok(ip.foldIconPack('nope', getPack) === null, 'unknown pack folds to null');
const lookA = fx.edits.lookA as ip.IconLook, hubA = fx.edits.hubA as ip.IconLevel;
const places: Record<string, ip.IconPlace & { view?: string }> = {
  'plugin-in-plan': { scopeKey: 'plugin:console-terminal', look: lookA, hub: hubA, skinPacks: {}, brandPack: 'base', view: 'plan' },
  'ui-plan': { scopeKey: 'ui:plan', look: lookA, hub: hubA, skinPacks: {}, brandPack: 'base' },
  app: { scopeKey: 'app', look: lookA, hub: hubA, skinPacks: {}, brandPack: 'base' },
  'skin-layer': { scopeKey: 'ui:other', look: { pack: '', overrides: {}, scopes: {} }, hub: null, skinPacks: { 'ui:other': 'grandchild', app: 'child' }, brandPack: 'base' },
  'legacy-brand-only': { scopeKey: 'app', look: null, hub: null, skinPacks: {}, brandPack: 'base' },
  nothing: { scopeKey: 'app', look: null, hub: null, skinPacks: {} },
};
for (const [k, p] of Object.entries(places)) {
  const chain = ip.iconChain(p, p.view);
  eq(chain.map((l) => ({ scope: l.scope, kind: l.kind, pack: l.pack, from: l.from, overrides: Object.keys(l.overrides) })), fx.chains[k], `chain ${k}`);
  for (const [key, want] of Object.entries(fx.resolve[k] as Record<string, unknown>)) {
    const i = key.indexOf(':', key.startsWith('(no spot)') ? 0 : key.indexOf('/'));
    const spot = key.startsWith('(no spot)') ? '' : key.slice(0, i), name = key.slice(i + 1);
    const r = ip.resolveIcon(spot, name, chain, getPack);
    eq({ glyph: r.glyph ? { kind: r.glyph.kind, d: r.glyph.d, fill: r.glyph.fill, secondary: r.glyph.secondary } : null, pack: r.pack, scope: r.scope, by: r.by, name: r.name }, want, `resolve ${k} ${key}`);
  }
}
// the rules in words, checked directly
const planChain = ip.iconChain(places['plugin-in-plan'], 'plan');
eq(planChain.map((l) => l.scope), ['plugin:console-terminal', 'ui:plan', 'app', 'global', 'brand'], 'chain order plugin → ui → app → global → brand');
eq(ip.resolveIcon('framework:app-menu/home', 'home', planChain, getPack).scope, 'plugin:console-terminal', 'the nearest pack wins');
eq(ip.resolveIcon('framework:app-menu/search', 'search', planChain, getPack).by, 'framework', 'fallback: none stops the walk at the framework glyph');
eq(ip.resolveIcon('framework:tab-group/more', 'more', planChain, getPack), { ...ip.resolveIcon('framework:tab-group/more', 'more', planChain, getPack), scope: 'app', by: 'override', name: 'menu' }, 'a name: override renames the spot and wins from its level');
const appChain = ip.iconChain(places.app);
eq(ip.resolveIcon('framework:tab-group/x', 'x', appChain, getPack).by, 'spot', 'a per-spot entry wins over the name');
eq(ip.resolveIcon('framework:chrome/search', 'search', appChain, getPack), { ...ip.resolveIcon('framework:chrome/search', 'search', appChain, getPack), scope: 'global', by: 'override', pack: 'child' }, 'a pack:<id>/<name> override at the hub level');
eq(ip.resolveIcon('framework:nav/zzz', 'zzz', appChain, getPack).by, 'framework', 'a name no pack has falls to the framework');
eq(ip.resolveIcon('framework:x/star', 'star', appChain, getPack), { ...ip.resolveIcon('framework:x/star', 'star', appChain, getPack), scope: 'app', pack: 'child', by: 'name' }, 'a name only the parent pack has resolves through the extends chain at the child level');
eq(ip.resolveIcon('framework:x/star', 'star', ip.iconChain(places['skin-layer']), getPack).scope, 'ui:other', "a skin's pack is the level's pack when nothing is picked");
eq(ip.resolveIconName('home', ip.iconChain(places['legacy-brand-only']), getPack), { ...ip.resolveIconName('home', ip.iconChain(places['legacy-brand-only']), getPack), scope: 'brand', by: 'name', pack: 'base' }, 'no icon block anywhere: the branding pack draws, as before');
eq(ip.resolveIconName('home', ip.iconChain(places.nothing), getPack).by, 'framework', 'nothing anywhere: the framework glyph');

/* ---- edits and resets ---- */
eq(ip.listIconOverrides(lookA, hubA), fx.edits.overrides, 'listIconOverrides pinned');
eq(ip.resetIconSpot(lookA, 'framework:tab-group/more'), fx.edits.reset.spot, 'reset spot');
eq(ip.resetIconScope(lookA, 'plugin:console-terminal'), fx.edits.reset.scope, 'reset scope');
eq(ip.resetIconApp(), fx.edits.reset.app, 'reset app');
eq(ip.resetIconHub(), fx.edits.reset.hub, 'reset hub');
eq(ip.resetHubIconSpot(hubA, 'framework:chrome/search'), fx.edits.reset.hubSpot, 'reset hub spot');
eq(ip.setHubIconPack(hubA, 'child'), fx.edits.hubPack, 'set hub pack');
eq(ip.setHubIconOverride(hubA, 'a:b/c', 'star'), fx.edits.hubOverride, 'set hub override (a bare name becomes name:)');
eq(ip.setIconOverride(lookA, 'app', 'not a spot', 'x'), lookA, 'a bad spot id changes nothing');
ok(!('plugin:console-terminal' in ip.resetIconScope(lookA, 'plugin:console-terminal').scopes), 'a reset scope is gone from the document');
eq(ip.setIconPack(ip.setIconPack(null, 'ui:plan', 'child'), 'ui:plan', '').scopes, {}, 'a scope with nothing left is dropped');

/* ---- documents ---- */
const legacyLook = normalizeAppLook({ $axf: 'app-look@1', app: 'console-web', default: {}, iconPack: 'base', own: { settings: { 'axf.icons.pack.app': 'child', 'axf.tokens.x': 1 } }, icon: { scopes: { 'ui:plan': { pack: 'child' }, bad: { pack: 'x' } } } });
eq(legacyLook?.icon, fx.documents.legacyLook, 'a legacy iconPack folds into icon.pack, bad scope keys drop');
eq(legacyLook?.own.settings, fx.documents.legacySettings, 'the legacy setting leaves own.settings');
ok(!('icon' in (normalizeAppLook({ $axf: 'app-look@1', app: 'a', default: {} }) ?? {})), 'no icon block when nothing is picked');
eq(JSON.parse(serializeAppearance(mergeAppearance(normalizeAppearance({ $axf: 'appearance@1' })!, { icon: { pack: 'child', overrides: { 'a:b/c': 'star' } } }, 'test', '2026-11-16T00:00:00Z'))), fx.documents.appearance, 'appearance@1 carries icon');
eq(JSON.parse(serializeAppearance(mergeAppearance(normalizeAppearance({ $axf: 'appearance@1', icon: { pack: 'child' } })!, { icon: null }, 'test', '2026-11-16T00:00:00Z'))), fx.documents.appearanceCleared, 'icon: null clears the hub block');
ok(!('icon' in normalizeAppearance({ $axf: 'appearance@1', icon: { pack: '' } })!), 'an empty hub block is dropped');

/* ---- validators agree ---- */
eq(ip.validateIconPack(fxCase('ok')), fx.validate.ok, 'validate ok pinned');
eq(ip.validateIconPack(fxCase('bad')), fx.validate.bad, 'validate bad pinned');
ok(fx.validate.ok.length === 0, 'every glyph source validates');
ok(fx.validate.bad.length >= 8, 'bad pack reports every problem');
eq(ir.iconMapErrors({ spots: { 'console-web:view-plan/plus': { glyph: 'plus', tint: 'red', size: 'huge' }, bad: {}, 'a:b/c': { kind: 'thing', dynamic: false } } }), fx.validate.map, 'icon-map errors pinned');
eq(fx.validate.mapOk, [], 'a good map validates (size tokens, badge kind)');
eq(fx.validate.block.length, 5, 'icon block errors: bad pack, bad spot id, bad ref, hostile svg, bad scope key');
function fxCase(which: 'ok' | 'bad') {
  return which === 'ok'
    ? { style: 'outline', grid: 24, glyphs: { a: 'M1 1h1', s: { svg: '<path d="M1 1"/>' }, p: { png: 'data:image/png;base64,iVBORw0KGgo=' }, f: { font: { family: 'Material Symbols', char: '' } }, r: { ref: 'pack:base/home' } }, spots: { 'x:y/z': 'a' }, extends: 'base', seed: { seed: 's1', style: 'line' }, license: 'MIT', source: { kind: 'generated' } }
    : { style: 'outline', grid: 24, glyphs: { ok: 'M1 1', bad: { svg: '<script>' }, two: { d: 'M1 1', ref: 'name:ok' }, none: {}, badref: { ref: 'nope' } }, spots: { 'x:y/z': 'nope', bad: 'ok' }, extends: 'Bad', seed: { style: 'line' }, appIcon: { shape: 'blob', bg: 'red' } };
}
const env = (type: string, data: unknown) => ({ $axf: 'asset@1', type, id: 'test-one', name: 'T', version: '1.0.0', data });
for (const [label, a] of [['pack ok', env('icon-pack', fxCase('ok'))], ['pack bad', env('icon-pack', fxCase('bad'))], ['map', env('icon-map', { spots: { 'a:b/c': { tint: 'red' } } })], ['map ok', env('icon-map', { app: 'all', spots: { 'a:b/c': { glyph: 'x' } } })]] as const) {
  const core = validateAsset(a).errors;
  const build = (engine as unknown as { validateAsset(a: unknown): { errors: string[] } }).validateAsset(a).errors;
  eq([...core].sort(), [...build].sort(), `core and build engine agree: ${label}`);
}
ok(validateAsset(env('icon-map', { app: 'all', spots: { 'a:b/c': { glyph: 'x' } } })).ok, 'a good icon-map passes the asset validator');
ok(!validateAsset(env('icon-pack', { style: 'outline', grid: 24, glyphs: { a: { svg: '<script>x</script>' } } })).ok, 'a hostile svg glyph fails the asset validator');
ok(validateAsset(env('icon-pack', { style: 'outline', grid: 24, glyphs: { a: { svg: '<path d="M1 1"/>' } } })).ok, 'a legacy-shaped validator accepts a non-path glyph source');

/* ---- markup ---- */
for (const [k, want] of Object.entries(fx.markup as Record<string, string>)) {
  ok(!/#[0-9a-fA-F]{3,6}\b|rgb\(/.test(want), `${k}: no literal colours in markup`);
  ok(want.includes('currentColor') || want.includes('var(--fx-'), `${k}: colours are currentColor or tokens`);
}
eq(ip.glyphMarkup(ip.glyphEntry('M4 4l16 16M20 4L4 20')!, { style: 'outline', grid: 24, stroke: 1.75, linecap: 'round' }, 16), fx.markup.path, 'path markup pinned');
eq(ip.appIconMarkup(ip.glyphEntry('M12 2l10 20H2z')!, { style: 'filled', grid: 24, stroke: 2, linecap: 'round', appIcon: { shape: 'squircle', bg: 'accent', fg: 'accentText', padding: 0.2 } }, 48), fx.markup.appIcon, 'app icon markup pinned');
ok(fx.markup.duotone.includes('width="var(--fx-size-icon)"'), 'a CSS size token passes through');

/* ---- registry engine ---- */
const map = { id: 'default', type: 'icon-map', data: { app: 'all', spots: { 'framework:tab-group/x': { glyph: 'x', tags: ['chrome'] }, 'framework:app-menu/icon': { dynamic: true }, 'framework:badge/new': { kind: 'badge', glyph: 'sparkles' }, 'console-web:app/favicon': { kind: 'app-icon', glyph: 'sparkles' }, 'console-web:view-plan/plus': { glyph: 'plus' } } } };
const child = { id: 'console', type: 'icon-map', data: { app: 'console-web', extends: 'default', spots: { 'console-web:view-plan/plus': { glyph: 'plus', label: 'Add a plan item' }, 'bad id': {} } } };
const reg = im.registerIconSpot(im.buildIconRegistry([map, child], [{ id: 'console-web:view-plan/plus', help: 'runtime help' }, { id: 'molly:new/thing', glyph: 'star' }, 'nonsense']), { id: 'amberx-droid:plugin-companion/send', glyph: 'arrow-right' });
eq(reg.spots, fx.registry.spots, 'registry spots pinned');
eq(reg.duplicates, fx.registry.duplicates, 'duplicates pinned');
eq(reg.problems, fx.registry.problems, 'problems pinned');
eq(reg.spots['console-web:view-plan/plus'].from, 'asset', 'an asset entry wins over a run-time one');
eq(reg.spots['console-web:view-plan/plus'].help, 'runtime help', 'a run-time registration fills an empty field');
eq(reg.spots['console-web:view-plan/plus'].maps, ['default', 'console'], 'both maps are recorded');
ok(reg.spots['framework:app-menu/icon'].dynamic && reg.spots['framework:app-menu/icon'].glyph === '', 'a spot with no glyph is dynamic');
eq(reg.spots['framework:badge/new'].size, 'badge', 'a badge spot defaults to the badge size token');
const regChain = ip.iconChain({ scopeKey: 'app', look: { pack: 'child', overrides: {}, scopes: {} }, hub: null });
eq(im.iconCoverage(reg, regChain, getPack), fx.registry.coverage, 'coverage pinned');
const cov = im.iconCoverage(reg, regChain, getPack);
ok(cov.total === cov.covered + cov.framework + cov.dynamic, 'coverage sums');
ok(!cov.missing.includes('framework:app-menu/icon'), 'a dynamic spot is never missing');
eq(fx.registry.search, { 'tab-group': im.searchIconSpots(reg, { q: 'tab-group' }).map((s) => s.id), badge: im.searchIconSpots(reg, { kind: 'badge' }).map((s) => s.id), dynamic: im.searchIconSpots(reg, { dynamic: true }).map((s) => s.id), tag: im.searchIconSpots(reg, { tag: 'chrome' }).map((s) => s.id) }, 'search pinned');
eq(im.spotTree(reg).map((a) => ({ app: a.app, total: a.total, areas: a.areas.map((x) => ({ area: x.area, dynamic: x.dynamic, spots: x.spots.map((s) => s.id) })) })), fx.registry.tree, 'tree pinned');
eq(im.spotGlyphNames(reg), fx.registry.names, 'glyph names pinned');
eq((({ chain, broken, origin }) => ({ chain, broken, origin }))(im.foldIconMap('console', (id) => ({ default: map, console: child } as Record<string, unknown>)[id])!), fx.registry.fold, 'map fold pinned');

/* ---- generator ---- */
eq(ig.seedHash('ember'), fg.hash.ember, 'seed hash pinned');
eq((() => { const r = new ig.SeededRng('ember'); return [r.next(), r.next(), r.int(0, 9), r.pick(['a', 'b', 'c'])]; })(), fg.rng, 'rng pinned');
eq(ig.mirrorPath('M4 4L20 12A5 5 0 1 1 10 10Z', 'x'), fg.mirror.x, 'mirror x pinned');
for (const [k, want] of Object.entries(fg.icons as Record<string, ig.GeneratedGlyph>)) {
  const [seed, ...rest] = k.split(':');
  eq(ig.generateIcon(seed, { name: rest.join(':') }), want, `generateIcon ${k}`);
  ok(PATH_DATA.test(want.d) && (!want.secondary || PATH_DATA.test(want.secondary)), `${k}: path data only`);
}
for (const [style, want] of Object.entries(fg.styles as Record<string, ig.GeneratedGlyph>)) eq(ig.generateIcon('ember', { name: 'blob', style: style as ig.GenStyle }), want, `style ${style}`);
ok(new Set(Object.values(fg.styles as Record<string, ig.GeneratedGlyph>).map((g) => g.d + '|' + g.secondary + g.fill)).size === ig.GEN_STYLES.length, 'every style draws differently');
ok(ig.generateIcon('ember', { name: 'search' }).d !== ig.generateIcon('ash', { name: 'search' }).d, 'two seeds differ');
ok(ig.generateIcon('ember', { name: 'home' }).d !== ig.generateIcon('ember', { name: 'search' }).d, 'two names differ under one seed');
ok(ig.generateIcon('ember', { name: 'chevron-right' }).recipe.startsWith('chevron'), 'a chevron name draws a chevron');
ok(ig.generateIcon('ember', { name: 'check' }).recipe.startsWith('check'), 'check draws a check');
for (const [style, want] of Object.entries(fg.packs as Record<string, { id: string; name: string; data: Record<string, unknown>; errors: string[] }>)) {
  const p = ig.generatePack('ember', ['home', 'settings', 'search', 'bell', 'star', 'check', 'x', 'plus', 'menu', 'grid', 'chevron-right', 'arrow-left', 'refresh', 'clock', 'alert', 'more', 'blob', 'zephyr'], { style: style as ig.GenStyle, spots: [{ id: 'console-web:app/favicon', kind: 'app-icon', glyph: 'sparkles' }, { id: 'framework:badge/new', kind: 'badge', glyph: 'sparkles' }, { id: 'framework:tab-group/x', glyph: 'x' }] });
  eq({ ...p, errors: ip.validateIconPack(p.data) }, want, `generatePack ${style}`);
  eq(want.errors, [], `generated ${style} pack validates`);
  ok(validateAsset(env('icon-pack', p.data)).ok, `generated ${style} pack passes the asset validator`);
  eq((p.data.seed as { grammar: string }).grammar, ig.ICON_GEN_CONTRACT, `${style}: seed block names the grammar`);
}

/* ---- import ---- */
eq(ii.unsafeValue('javascript:x'), true, 'javascript: unsafe'); eq(ii.unsafeValue('#abc'), false, 'in-document ref safe');
for (const [k, want] of Object.entries(fi.sanitize as Record<string, unknown>)) eq(ii.sanitizeSvg(fi.sanitizeInputs?.[k] ?? inputFor(k)), want, `sanitize ${k}`);
for (const [k, want] of Object.entries(fi.normalize as Record<string, unknown>)) eq(ii.normalizeSvg(inputFor(k)), want, `normalize ${k}`);
const hostileOut = fi.sanitize.hostile;
ok(!/script|onload|onclick|https?:|foreignObject|<image|<style|<text/.test(hostileOut.inner), 'hostile: nothing dangerous survives');
ok(hostileOut.inner.includes('fill="currentColor"') && !hostileOut.inner.includes('#ff0000') && !hostileOut.inner.includes('url('), 'hostile: literal, gradient and url colours became currentColor');
ok(hostileOut.inner.includes('<path d="M4 4h40v40H4z"'), 'hostile: the drawing inside the link survived (link unwrapped)');
eq(fi.importSvg.pathsOnly.glyph.kind, 'path', 'clean paths import as path data');
eq(fi.importSvg.pathsOnly.glyph.source, { kind: 'library', library: 'lucide' }, 'source recorded');
eq(fi.importSvg.pathsOnly.glyph.license, { id: 'ISC' }, 'licence recorded');
eq(fi.importSvg.keepSvg.glyph.kind, 'svg', 'keepSvg keeps inline svg');
eq(fi.importSvg.lucide.glyph.kind, 'svg', 'shapes other than paths stay svg');
ok(fi.normalize.big.inner.startsWith('<g transform="translate(') && fi.normalize.big.report.scaled, 'a 512 grid is scaled to 24');
ok(fi.normalize.offCentre.inner.includes('translate(0 6)'), 'a wide drawing is centred');
eq(fi.importSvg.empty.glyph, null, 'nothing left → no glyph');
ok(typeof fi.importSvg.tooBig.report.refused === 'string', 'oversize svg refused');
eq(fi.importPng.ok.glyph.kind, 'png', 'png imports');
ok(fi.importPng.notPng.report.refused.includes('signature'), 'bad png signature refused');
ok(fi.importPng.tooBig.refused.includes('cap'), 'oversize png refused');
eq(fi.importGlyph.path.glyph.kind, 'path', 'bare path data imports');
eq(fi.importGlyph.fragment.glyph.kind, 'path', 'a bare <path> fragment imports as path data');
eq(fi.importGlyph.png, 'png', 'importGlyph picks png');
ok(typeof fi.importGlyph.text === 'string', 'text is refused');
function inputFor(k: string): string {
  const inputs: Record<string, string> = {
    hostile: '<?xml version="1.0"?><!DOCTYPE svg><svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 48 48" onload="alert(1)"><!-- c --><script>alert(2)</script><style>@import url(evil.css)</style><defs><linearGradient id="g"/></defs><a href="https://evil"><path d="M4 4h40v40H4z" fill="#ff0000" stroke="rgb(0,0,0)" onclick="x()"/></a><image href="https://evil/x.png"/><use xlink:href="#g"/><use href="https://evil#g"/><foreignObject><div>hi</div></foreignObject><circle cx="24" cy="24" r="10" fill="url(#g)" style="fill:url(http://x)"/><text>hello</text><title>Box</title></svg>',
    lucide: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>',
    pathsOnly: '<svg viewBox="0 0 24 24" fill="none" stroke="#333"><path d="M3 11 12 3l9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/></svg>',
    big: '<svg viewBox="0 0 512 512"><rect x="64" y="64" width="384" height="384" rx="40" fill="#09f"/></svg>',
    offCentre: '<svg width="100" height="50"><rect x="10" y="10" width="80" height="30" fill="green"/></svg>',
    empty: '<svg><script>1</script></svg>',
    nested: '<svg viewBox="0 0 24 24"><svg viewBox="0 0 1 1"><path d="M1 1"/></svg><path d="M2 2"/></svg>',
    truncated: '<svg viewBox="0 0 24 24"><g><path d="M1 1"',
  };
  return inputs[k];
}

/* ---- starters ---- */
const mapsDir = new URL('framework/assets/icon-map/', root), packsDir = new URL('framework/assets/icon-pack/', root);
if (existsSync(mapsDir)) {
  const maps = readdirSync(mapsDir).filter((f) => f.endsWith('.json')).map((f) => read(`framework/assets/icon-map/${f}`));
  ok(maps.some((m) => m.id === 'default'), 'the default icon-map ships');
  for (const m of maps) { const v = validateAsset(m); eq(v.errors, [], `icon-map ${m.id} validates`); }
  const inv = read('framework/spec/icon-inventory.json');
  const def = maps.find((m) => m.id === 'default');
  if (def) for (const s of inv.spots) ok(s.id in def.data.spots, `inventory spot ${s.id} is in the default map`);
}
const starterPacks = readdirSync(packsDir).filter((f) => f.endsWith('.json')).map((f) => read(`framework/assets/icon-pack/${f}`));
for (const p of starterPacks) { const v = validateAsset(p); eq(v.errors, [], `icon-pack ${p.id} validates`); }
const packIds = new Set(starterPacks.map((p) => p.id));
for (const p of starterPacks) if (p.data.extends) ok(packIds.has(p.data.extends), `${p.id} extends a shipped pack (${p.data.extends})`);

console.log(`check-icon-pack: ${n} checks passed`);
