#!/usr/bin/env node
/**
 * icon-map@1 + icon-source@1 check (core/engines/iconmap-rules.mjs): the registry pinned to asset-types.json and
 * core/types.ts (both types right before uac-policy, kinds and formats equal), refs, scope keys and chains, map
 * normalising and errors, resolution through a chain (slot wins, alias follows, pack per scope, child over parent,
 * branding pack, framework fallback, `none`), `extends` folding, seeded Randomize and cohesive Generate, the global
 * listing, sources refusing raw secrets, both validators agreeing, the shipped starters, and the golden outputs in
 * spec/fixtures/icon-map.json (`--write` regenerates it after an engine change).
 *
 *   node framework/spec/check-icon-map.mjs [--write]
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as I from '../core/engines/iconmap-rules.mjs';
import { validateAsset } from '../cli/build-engine.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const FIXTURE = join(ROOT, 'framework/spec/fixtures/icon-map.json');
const spec = JSON.parse(readFileSync(join(ROOT, 'framework/schemas/asset-types.json'), 'utf8'));
let n = 0;
const fails = [];
const t = (name, fn) => { n++; try { fn(); } catch (e) { fails.push(`${name}: ${e.message}`); } };

/* ------------------------------------------------------------------ the world the cases run in */

const PACKS = {
  'lucide-1': ['home', 'floppy-disk', 'trash-2', 'settings', 'search', 'cog', 'house', 'pencil', 'x', 'check'],
  'tabler-1': ['home', 'device-floppy', 'trash', 'settings', 'search', 'pencil', 'x', 'check', 'hammer'],
  'amberx-outline': ['home', 'settings', 'search', 'save'],
};
const lookup = { hasGlyph: (p, g) => !!PACKS[p]?.includes(g), brandingPack: 'amberx-outline' };
const packAssets = Object.entries(PACKS).map(([id, names]) => ({ id, data: { glyphs: Object.fromEntries(names.map((g) => [g, 'M0 0'])) } }));

const ROOT_MAP = { id: 'console-root', data: { scope: { app: 'console-web' }, pack: 'lucide-1', slots: { save: 'floppy-disk', trash: 'pack:tabler-1/trash', hidden: 'none' } } };
const UI_MAP = { id: 'console-builds', data: { scope: { app: 'console-web', ui: 'builds' }, extends: 'console-root', slots: { save: 'pack:tabler-1/device-floppy' } } };
const PLUGIN_MAP = { id: 'console-plugin-x', data: { scope: { app: 'console-web', plugin: 'ai.amberx.axf.console.x' }, pack: 'tabler-1', slots: { edit: 'pencil', home: 'house' } } };
const BY_ID = { 'console-root': ROOT_MAP, 'console-builds': UI_MAP, 'console-plugin-x': PLUGIN_MAP };
const CHAIN = [PLUGIN_MAP, { id: 'console-builds', data: I.foldIconMap('console-builds', BY_ID) }, ROOT_MAP];
const NAMES = ['home', 'save', 'trash', 'settings', 'search', 'edit', 'hidden', 'rocket', 'check', 'x'];

const RESOLVE_CASES = {
  'slot in the root (alias to another name)': ['save', [ROOT_MAP]],
  'slot naming a pack glyph': ['trash', [ROOT_MAP]],
  'pack applied to the scope': ['settings', [ROOT_MAP]],
  'branding pack when no map covers it': ['save', [{ id: 'empty', data: { scope: {}, slots: {} } }]],
  'framework fallback': ['rocket', CHAIN],
  'none hides the icon': ['hidden', CHAIN],
  'child slot overrides the parent slot': ['save', CHAIN],
  'child pack wins over the parent pack': ['settings', CHAIN],
  'plugin slot alias resolved in the plugin pack': ['home', CHAIN],
  'ui map inherits the root slot through extends': ['trash', CHAIN.slice(1)],
  'settings overrides sit above the map': ['save', [{ id: 'settings:app', data: { scope: {}, slots: {} }, slots: { save: 'pack:lucide-1/check' } }, ROOT_MAP]],
  'a pack ref to a glyph the pack lacks keeps the glyph name': ['save', [{ id: 'm', data: { scope: {}, slots: { save: 'pack:lucide-1/nope' } } }]],
  'alias loop stops': ['a', [{ id: 'm', data: { scope: {}, slots: { a: 'b', b: 'a' } } }]],
  'a bad name resolves to none': ['Not A Name', CHAIN],
};

function produce() {
  const out = { resolve: {}, fold: {}, scope: {}, refs: {}, normalize: {}, errors: {}, generate: {}, randomize: {}, all: {}, sources: {}, schema: {} };
  for (const [k, [name, chain]] of Object.entries(RESOLVE_CASES)) out.resolve[k] = I.resolveIcon(name, chain, lookup);
  out.fold['ui map folded with its root'] = I.foldIconMap('console-builds', BY_ID);
  out.fold['missing id'] = I.foldIconMap('nope', BY_ID);
  out.scope['plugin chain'] = I.iconScopeChain({ app: 'console-web', ui: 'builds', plugin: 'p' });
  out.scope['ui chain'] = I.iconScopeChain({ app: 'console-web', ui: 'builds' });
  out.scope['root chain'] = I.iconScopeChain({ app: 'console-web' });
  out.scope.keys = [{ app: 'a' }, { app: 'a', ui: 'u' }, { app: 'a', plugin: 'p' }].map((s) => [I.iconScopeKey(s), I.iconScopeKind(s)]);
  for (const r of ['save', 'pack:lucide-1/floppy-disk', 'none', 'pack:/x', 'pack:lucide-1/', 'Bad Name', '', 'pack:Lucide/x']) out.refs[r || '(empty)'] = I.parseIconRef(r);
  out.normalize['drops bad slots and refs, keeps order'] = I.normalizeIconMap({ scope: { app: 'console-web', junk: 1 }, pack: 'Lucide', slots: { save: 'floppy-disk', 'Bad Slot': 'x', ok: 'pack:tabler-1/trash', 'nav.builds': 'hammer', gone: 'pack:bad id/x' }, tags: ['a', 1] });
  out.normalize['nothing'] = I.normalizeIconMap(null);
  out.errors['valid map'] = I.iconMapErrors('icon-map', ROOT_MAP.data);
  out.errors['bad map'] = I.iconMapErrors('icon-map', { scope: { app: 'Bad App', other: 1 }, extends: 'X', pack: 'Y', slots: { 'Bad Slot': 'x', ok: 'pack:/' } });
  out.errors['no slots'] = I.iconMapErrors('icon-map', { scope: {} });
  out.errors['other type'] = I.iconMapErrors('button', {});
  out.errors['valid local source'] = I.iconSourceErrors('icon-source', { kind: 'local', root: 'framework/icon-library', auth: { mode: 'none' } });
  out.errors['sftp with a raw password'] = I.iconSourceErrors('icon-source', { kind: 'sftp', root: '/icons', auth: { mode: 'password', password: 'hunter2' }, options: { host: 'h', user: 'u', apiKey: 'k' } });
  out.errors['sftp missing user + secretRef'] = I.iconSourceErrors('icon-source', { kind: 'sftp', root: '/icons', auth: { mode: 'password' }, options: { host: 'h' } });
  out.errors['gdrive needs oauth'] = I.iconSourceErrors('icon-source', { kind: 'gdrive', root: 'abc' });
  out.errors['unknown kind + auth mode the kind lacks'] = I.iconSourceErrors('icon-source', { kind: 'carrier-pigeon', root: 'x', auth: { mode: 'oauth' } });
  out.errors['http token auth with a ref'] = I.iconSourceErrors('icon-source', { kind: 'http', root: 'https://icons.example/set.zip', auth: { mode: 'token', secretRef: 'sec-1' }, format: 'zip' });
  const g = I.generateCohesiveMap(NAMES, 'tabler-1', lookup, { app: 'console-web' });
  out.generate['one pack'] = g;
  out.generate['two packs of one style'] = I.generateCohesiveMap(NAMES, ['lucide-1', 'tabler-1'], lookup, { app: 'console-web' });
  out.randomize['seed axf'] = I.randomizeMap(NAMES, ['lucide-1', 'tabler-1'], lookup, 'axf', { app: 'console-web' });
  out.randomize['seed 7'] = I.randomizeMap(NAMES, ['lucide-1', 'tabler-1'], lookup, 7, { app: 'console-web' });
  out.all['every icon'] = I.allIcons(packAssets).slice(0, 12);
  out.all.count = I.allIcons(packAssets).length;
  out.sources['kinds'] = I.iconSourceKinds().map((k) => [k.id, k.auth.join('|'), k.fields.map((f) => f.id).join(',')]);
  out.sources['normalized sftp'] = I.normalizeIconSource({ kind: 'sftp', label: 'Box', root: '/icons', auth: { mode: 'password', secretRef: 'sec-2', password: 'nope' }, options: { host: 'h', port: 22, user: 'u', token: 'leak' }, format: 'svg' });
  out.sources['normalized unknown kind'] = I.normalizeIconSource({ kind: 'nope', root: 'x' });
  out.schema['icon-map'] = Object.keys(I.iconMapSchemaProperties());
  out.schema['icon-source'] = Object.keys(I.iconSourceSchemaProperties());
  return out;
}

/* ------------------------------------------------------------------ registry pins */

t('both types are in asset-types.json right before uac-policy, with the rules\' kinds and formats', () => {
  const types = Object.keys(spec.types);
  const i = types.indexOf('icon-map');
  assert.ok(i > 0, 'icon-map missing');
  assert.equal(types[i + 1], 'icon-source');
  assert.equal(types[i + 2], 'uac-policy');
  for (const ty of ['icon-map', 'icon-source']) { assert.equal(spec.types[ty].optional, true, `${ty} optional`); assert.deepEqual(spec.types[ty].roll, { slot: false, asset: false }, `${ty} roll`); assert.equal(spec.types[ty].collection, true, `${ty} collection`); assert.ok(!spec.types[ty].widget && !spec.types[ty].attachable, `${ty} is not a widget`); }
  assert.deepEqual(spec.types['icon-source'].enums.kind, I.iconSourceKindIds().filter((k) => !I.iconSourceKinds().find((x) => x.id === k).host));
  assert.deepEqual(spec.types['icon-source'].enums.format, [...I.ICON_SOURCE_FORMATS]);
  assert.deepEqual(spec.types['icon-map'].required, ['scope', 'slots']);
  assert.deepEqual(spec.types['icon-source'].required, ['kind', 'root']);
});
t('core/types.ts lists both (ASSET_TYPES before uac-policy, OPTIONAL_TYPES, LateOptionalType, AssetDataMap)', () => {
  const src = readFileSync(join(ROOT, 'framework/core/types.ts'), 'utf8');
  assert.match(src, /'help',\n\s+'icon-map',\n\s+'icon-source',\n\s+'uac-policy',\n\] as const;/);
  assert.match(src, /OPTIONAL_TYPES[^\n]*'icon-map', 'icon-source'\]/);
  assert.match(src, /LateOptionalType =[^\n]*'icon-map' \| 'icon-source'/);
  assert.match(src, /'icon-map': import\('\.\/engines\/iconmap-rules\.mjs'\)\.IconMapData/);
  assert.match(src, /'icon-source': import\('\.\/engines\/iconmap-rules\.mjs'\)\.IconSourceData/);
});
t('the rules import nothing (one copy, no JSON)', () => {
  const src = readFileSync(join(ROOT, 'framework/core/engines/iconmap-rules.mjs'), 'utf8');
  assert.ok(!/^\s*import\s/m.test(src), 'iconmap-rules.mjs must not import');
  assert.equal(I.ICON_MAP_TYPE, 'icon-map'); assert.equal(I.ICON_SOURCE_TYPE, 'icon-source');
  assert.equal(I.ICON_MAP_KEY('app'), 'axf.icons.map.app'); assert.equal(I.ICON_SLOTS_KEY('ui:x'), 'axf.icons.slots.ui:x'); assert.equal(I.ICON_PACK_KEY('plugin:p'), 'axf.icons.pack.plugin:p');
});

/* ------------------------------------------------------------------ behaviour */

const got = produce();

t('refs: names, pack refs and none parse; junk does not', () => {
  assert.deepEqual(got.refs.save, { kind: 'name', glyph: 'save', pack: '' });
  assert.deepEqual(got.refs['pack:lucide-1/floppy-disk'], { kind: 'pack', pack: 'lucide-1', glyph: 'floppy-disk' });
  assert.deepEqual(got.refs.none, { kind: 'none', glyph: '', pack: '' });
  for (const k of ['pack:/x', 'pack:lucide-1/', 'Bad Name', '(empty)', 'pack:Lucide/x']) assert.equal(got.refs[k], null, k);
  assert.equal(I.iconRef(I.parseIconRef('pack:a/b')), 'pack:a/b'); assert.equal(I.iconRef(null), 'none');
});
t('scope keys and chains: plugin → ui → app', () => {
  assert.deepEqual(got.scope['plugin chain'], ['plugin:p', 'ui:builds', 'app']);
  assert.deepEqual(got.scope['ui chain'], ['ui:builds', 'app']);
  assert.deepEqual(got.scope['root chain'], ['app']);
  assert.deepEqual(got.scope.keys, [['app', 'app'], ['ui:u', 'ui'], ['plugin:p', 'plugin']]);
});
t('normalise drops bad slots, refs, pack ids and foreign scope fields', () => {
  const m = got.normalize['drops bad slots and refs, keeps order'];
  assert.deepEqual(m.slots, { save: 'floppy-disk', ok: 'pack:tabler-1/trash', 'nav.builds': 'hammer' });
  assert.equal(m.pack, ''); assert.deepEqual(m.scope, { app: 'console-web', ui: '', plugin: '' }); assert.deepEqual(m.tags, ['a']);
  assert.deepEqual(got.normalize.nothing, { scope: { app: '', ui: '', plugin: '' }, extends: '', pack: '', slots: {}, tags: [] });
});
t('map errors name the field; other types answer []', () => {
  assert.deepEqual(got.errors['valid map'], []);
  const e = got.errors['bad map'].join('\n');
  for (const f of ['data.scope.app', 'data.scope.other', 'data.extends', 'data.pack', 'data.slots.Bad Slot', 'data.slots.ok']) assert.match(e, new RegExp(f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), f);
  assert.deepEqual(got.errors['no slots'], ['data.slots is required (an object of slot → icon ref; {} is fine)']);
  assert.deepEqual(got.errors['other type'], []);
});
t('resolution: slot wins, alias follows, pack per scope, child over parent, branding, framework, none', () => {
  const r = got.resolve;
  assert.deepEqual(r['slot in the root (alias to another name)'], { glyph: 'floppy-disk', pack: 'lucide-1', via: 'pack', from: 'console-root' });
  assert.deepEqual(r['slot naming a pack glyph'], { glyph: 'trash', pack: 'tabler-1', via: 'slot', from: 'console-root' });
  assert.deepEqual(r['pack applied to the scope'], { glyph: 'settings', pack: 'lucide-1', via: 'pack', from: 'console-root' });
  assert.deepEqual(r['branding pack when no map covers it'], { glyph: 'save', pack: 'amberx-outline', via: 'branding', from: '' });
  assert.deepEqual(r['framework fallback'], { glyph: 'rocket', pack: '', via: 'framework', from: '' });
  assert.deepEqual(r['none hides the icon'], { glyph: '', pack: '', via: 'none', from: 'console-builds' }); // inherited through extends: the folded ui map carries the root's slot
  assert.deepEqual(r['child slot overrides the parent slot'], { glyph: 'device-floppy', pack: 'tabler-1', via: 'slot', from: 'console-builds' });
  assert.deepEqual(r['child pack wins over the parent pack'], { glyph: 'settings', pack: 'tabler-1', via: 'pack', from: 'console-plugin-x' });
  assert.deepEqual(r['plugin slot alias resolved in the plugin pack'], { glyph: 'house', pack: 'lucide-1', via: 'pack', from: 'console-builds' }); // the plugin's own pack (tabler) lacks house; the next scope's pack in the chain has it
  assert.deepEqual(r['ui map inherits the root slot through extends'], { glyph: 'trash', pack: 'tabler-1', via: 'slot', from: 'console-builds' });
  assert.deepEqual(r['settings overrides sit above the map'], { glyph: 'check', pack: 'lucide-1', via: 'slot', from: 'settings:app' });
  assert.deepEqual(r['a pack ref to a glyph the pack lacks keeps the glyph name'], { glyph: 'nope', pack: '', via: 'slot', from: 'm' });
  assert.equal(r['alias loop stops'].via, 'framework');
  assert.deepEqual(r['a bad name resolves to none'], { glyph: '', pack: '', via: 'none', from: '' });
});
t('extends folds parent slots and pack under the child', () => {
  const f = got.fold['ui map folded with its root'];
  assert.equal(f.pack, 'lucide-1'); assert.equal(f.extends, '');
  assert.deepEqual(f.slots, { save: 'pack:tabler-1/device-floppy', trash: 'pack:tabler-1/trash', hidden: 'none' });
  assert.equal(got.fold['missing id'], null);
});
t('generate: one pack covers by name or synonym, the rest are missing', () => {
  const g = got.generate['one pack'];
  assert.deepEqual(g.covered, ['check', 'edit', 'home', 'save', 'search', 'settings', 'trash', 'x']);
  assert.deepEqual(g.missing, ['hidden', 'rocket']);
  assert.equal(g.data.slots.save, 'pack:tabler-1/device-floppy'); assert.equal(g.data.slots.edit, 'pack:tabler-1/pencil'); assert.equal(g.data.pack, 'tabler-1');
  assert.deepEqual(g.data.scope, { app: 'console-web', ui: '', plugin: '' });
  assert.equal(I.iconMapErrors('icon-map', g.data).length, 0);
});
t('randomize is seeded: same seed same map, another seed differs, only same-meaning glyphs', () => {
  const a = got.randomize['seed axf'];
  assert.deepEqual(a, I.randomizeMap(NAMES, ['lucide-1', 'tabler-1'], lookup, 'axf', { app: 'console-web' }));
  assert.notDeepEqual(a.data.slots, got.randomize['seed 7'].data.slots);
  assert.deepEqual(a.kept, ['hidden', 'rocket']);
  for (const [name, ref] of Object.entries(a.data.slots)) { const r = I.parseIconRef(ref); assert.ok(r.glyph === name || I.iconSynonyms(name).includes(r.glyph), `${name} → ${ref}`); assert.ok(lookup.hasGlyph(r.pack, r.glyph)); }
  assert.equal(I.iconMapErrors('icon-map', a.data).length, 0);
});
t('synonyms are an open table', () => {
  const before = I.iconSynonyms('save').length;
  I.registerIconSynonyms('save', ['disk', 'save']);
  assert.equal(I.iconSynonyms('save').length, before + 2);
  assert.throws(() => I.registerIconSynonyms('Bad Name', []));
  assert.ok(Object.keys(I.iconSynonymTable()).length > 50);
});
t('the global listing is every glyph of every pack, sorted', () => {
  assert.equal(got.all.count, 23);
  assert.deepEqual(got.all['every icon'][0], { name: 'check', pack: 'lucide-1', ref: 'pack:lucide-1/check' });
});
t('sources: kinds registry, secrets refused and stripped', () => {
  assert.deepEqual(got.errors['valid local source'], []);
  const e = got.errors['sftp with a raw password'].join('\n');
  assert.match(e, /data\.auth\.password: secrets never go in an asset/); assert.match(e, /data\.options\.apiKey: secrets never/); assert.match(e, /secretRef is required/);
  assert.match(got.errors['sftp missing user + secretRef'].join('\n'), /data\.options\.user is required/);
  assert.match(got.errors['gdrive needs oauth'].join('\n'), /data\.auth is required: a Google Drive folder source needs oauth auth/);
  assert.match(got.errors['unknown kind + auth mode the kind lacks'].join('\n'), /data\.kind must be one of/);
  assert.deepEqual(got.errors['http token auth with a ref'], []);
  const s = got.sources['normalized sftp'];
  assert.deepEqual(s.auth, { mode: 'password', secretRef: 'sec-2' }); assert.deepEqual(s.options, { host: 'h', port: 22, user: 'u' }); assert.equal(s.format, 'svg');
  assert.equal(got.sources['normalized unknown kind'].kind, 'local');
  const k = I.registerIconSourceKind({ id: 'pigeon', label: 'Carrier pigeon', fields: [{ id: 'root', label: 'Loft', kind: 'text', required: true }], auth: ['none'] });
  assert.equal(k.host, true); assert.ok(I.iconSourceKindIds().includes('pigeon'));
  assert.deepEqual(I.iconSourceErrors('icon-source', { kind: 'pigeon', root: 'x' }), []);
  assert.throws(() => I.registerIconSourceKind({ id: 'Bad' }));
});
t('both validators agree on the starters and on a bad map', () => {
  for (const [ty, dir] of [['icon-map', 'icon-map'], ['icon-source', 'icon-source']]) {
    const files = readdirSync(join(ROOT, 'framework/assets', dir)).filter((f) => f.endsWith('.json'));
    assert.ok(files.length >= 1, `${ty} starter`);
    for (const f of files) {
      const a = JSON.parse(readFileSync(join(ROOT, 'framework/assets', dir, f), 'utf8'));
      assert.equal(a.type, ty);
      const v = validateAsset(a);
      assert.ok(v.ok, `${f}: ${(v.errors ?? []).join('; ')}`);
      assert.deepEqual(ty === 'icon-map' ? I.iconMapErrors(ty, a.data) : I.iconSourceErrors(ty, a.data), []);
    }
  }
  const bad = { $axf: 'asset@1', type: 'icon-map', id: 'bad-map', name: 'Bad', version: '1.0.0', data: { scope: {}, slots: { 'Bad Slot': 'x' } } };
  const v = validateAsset(bad);
  assert.ok(!v.ok);
  for (const e of I.iconMapErrors('icon-map', bad.data)) assert.ok(v.errors.includes(e), `build engine lacks: ${e}`);
  const badSrc = { $axf: 'asset@1', type: 'icon-source', id: 'bad-src', name: 'Bad', version: '1.0.0', data: { kind: 'sftp', root: '/x', auth: { mode: 'password', password: 'p' } } };
  const w = validateAsset(badSrc);
  assert.ok(!w.ok);
  for (const e of I.iconSourceErrors('icon-source', badSrc.data)) assert.ok(w.errors.includes(e), `build engine lacks: ${e}`);
});
t('schema properties cover every field', () => {
  assert.deepEqual(got.schema['icon-map'], ['scope', 'extends', 'pack', 'slots', 'tags']);
  assert.deepEqual(got.schema['icon-source'], ['kind', 'label', 'root', 'auth', 'options', 'format', 'enabled', 'tags']);
  for (const ty of ['icon-map', 'icon-source']) {
    const f = join(ROOT, 'framework/schemas/json', `${ty}.schema.json`);
    assert.ok(existsSync(f), `${f}: run node framework/cli/axf.mjs schemas`);
    const s = JSON.parse(readFileSync(f, 'utf8'));
    for (const k of got.schema[ty]) assert.ok(s.properties?.data?.properties?.[k] || s.properties?.[k] || JSON.stringify(s).includes(`"${k}"`), `${ty} schema lacks ${k}`);
  }
});

/* ------------------------------------------------------------------ golden outputs */

if (process.argv.includes('--write')) {
  writeFileSync(FIXTURE, `${JSON.stringify({ $axf: 'fixture@1', about: 'icon-map@1 + icon-source@1 golden outputs (framework/spec/check-icon-map.mjs --write)', ...got }, null, 1)}\n`);
  console.log(`wrote ${FIXTURE}`);
}
t('engine matches the fixture', () => {
  assert.ok(existsSync(FIXTURE), 'no fixture: run with --write');
  const want = JSON.parse(readFileSync(FIXTURE, 'utf8'));
  for (const k of Object.keys(got)) assert.deepEqual(got[k], want[k], k);
});

if (fails.length) { console.error(`✗ icon-map@1: ${fails.length}/${n} failed\n${fails.map((f) => `  ✗ ${f}`).join('\n')}`); process.exit(1); }
console.log(`✓ icon-map@1 + icon-source@1: ${n} checks (registry pins, refs, scopes, normalise, errors, resolution, extends, generate, randomize, synonyms, listing, sources, validators agree, schema, fixture)`);
