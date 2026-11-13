#!/usr/bin/env node
/**
 * icon-map@1 (framework/core/engines/icon-map-rules.mjs + glyphs.mjs): the role vocabulary, slot ids, the manifest
 * block, the scanners (literal icons, raw icons), deriving slots for a plugin, the whole-map build, the resolution
 * order (override → pack role → pack glyph → framework → fallback), icon-pack@1 roles / themable / covers / license,
 * the CI check's verdicts, the projections, fixture replay (spec/fixtures/icon-map.json) and the contract snapshot
 * (framework/schemas/icon-map.json) being current. Plain node, no build step.
 *
 *   node framework/spec/check-icon-map.mjs [--write]      --write: regenerate the fixture's expected outputs and the snapshot
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import * as M from '../core/engines/icon-map-rules.mjs';
import * as G from '../core/engines/glyphs.mjs';
import { ICON_COVERS, iconPackErrors, normalizeIconPack } from '../core/engines/brand-rules.mjs';
import { snapshot, SNAPSHOT_REL, ROOT } from '../cli/icon-map.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(here, 'fixtures', 'icon-map.json');
const write = process.argv.includes('--write');
const fx = JSON.parse(readFileSync(FIXTURE, 'utf8'));
let fails = 0; let n = 0;
const check = (name, ok, detail = '') => { n++; if (!ok) { fails++; console.error(`✗ ${name}${detail ? `\n  ${detail}` : ''}`); } };
const eq = (name, got, want) => check(name, isDeepStrictEqual(got, want), `got ${JSON.stringify(got).slice(0, 600)}`);

/* ---- glyphs: one list, aliases, fallback ---- */
check('glyph set has the framework names the apps use', ['home', 'settings', 'save', 'check', 'x', 'refresh', 'box', 'star'].every(G.isGlyph));
check('every glyph is path data only', G.GLYPH_NAMES.every((k) => /^[MmZzLlHhVvCcSsQqTtAa0-9 ,.\-+eE]+$/.test(G.GLYPHS[k])));
check('every alias points at a glyph', Object.values(G.GLYPH_ALIASES).every((v) => Object.hasOwn(G.GLYPHS, v)) && Object.keys(G.GLYPH_ALIASES).every((k) => !Object.hasOwn(G.GLYPHS, k)));
check('glyphName resolves aliases, unknown is null', G.glyphName('close') === 'x' && G.glyphName('home') === 'home' && G.glyphName('nope') === null);
check('glyphPath falls back to the box', G.glyphPath('nope') === G.GLYPHS.box);
check('names once used that drew the box are glyphs now', ['activity', 'radio', 'square', 'image', 'bot', 'server', 'puzzle', 'book', 'calendar', 'message-square', 'link', 'volume', 'volume-x', 'note', 'map', 'cpu', 'globe', 'history', 'close', 'message', 'chat'].every(G.isGlyph));

/* ---- roles ---- */
const roles = M.allRoles();
check('every framework glyph is a role of its own name (a semantic role of the same name keeps its own group)', G.GLYPH_NAMES.every((g) => roles[g]?.glyph === g) && roles.save.group === 'action' && roles.grid.group === 'glyph');
check('semantic roles name framework glyphs', Object.values(M.ICON_ROLES).every((r) => G.isGlyph(r.glyph) && M.ICON_ROLE_GROUPS.includes(r.group) && r.label));
check('the roles Brett named exist', ['save', 'approve', 'build-running'].every((r) => roles[r]));
eq('allRoles: extra roles cleaned (bad glyph → box, bad group → object, bad id dropped)', M.allRoles({ 'sync-now': { glyph: 'refresh', group: 'action', label: 'Sync now' }, odd: { glyph: 'nope', group: 'weird' }, 'Bad Id': 'home' })['sync-now'], { glyph: 'refresh', group: 'action', label: 'Sync now' });
check('allRoles: odd role fell back', M.allRoles({ odd: { glyph: 'nope', group: 'weird' } }).odd.glyph === 'box' && M.allRoles({ odd: { glyph: 'nope', group: 'weird' } }).odd.group === 'object' && !M.allRoles({ 'Bad Id': 'home' })['Bad Id']);
check('roleGlyph: pack mapping beats the default', M.roleGlyph('save', roles, { roles: { save: 'floppy' } }) === 'floppy' && M.roleGlyph('save', roles) === 'save' && M.roleGlyph('approve', roles) === 'check-circle' && M.roleGlyph('nothing', roles) === 'box');

/* ---- resolution order ---- */
const pack = { roles: { save: 'floppy', approve: 'tick' }, glyphs: { home: { d: 'M0 0' }, tick: { d: 'M1 1' } } };
eq('resolve: override first', M.resolveIcon({ name: 'save', slot: 'a/b/button/save', overrides: { 'a/b/button/save': 'star' }, pack, roles }), { glyph: 'star', via: 'override' });
eq('resolve: pack role (explicit role)', M.resolveIcon({ name: 'check-circle', role: 'approve', pack, roles }), { glyph: 'tick', via: 'pack-role' });
eq('resolve: pack role (the glyph name is its own role)', M.resolveIcon({ name: 'save', pack, roles }), { glyph: 'floppy', via: 'pack-role' });
eq('resolve: pack glyph of that name', M.resolveIcon({ name: 'home', pack, roles }), { glyph: 'home', via: 'pack-glyph' });
eq('resolve: framework glyph (alias resolved)', M.resolveIcon({ name: 'close', pack, roles }), { glyph: 'x', via: 'framework' });
eq('resolve: a role with no name draws its default', M.resolveIcon({ role: 'build-running', roles }), { glyph: 'refresh', via: 'role' });
eq('resolve: unknown falls back to the box', M.resolveIcon({ name: 'nope', roles }), { glyph: 'box', via: 'fallback' });
eq('resolve: an unknown name with a known role draws the role', M.resolveIcon({ name: 'nope', role: 'save', roles }), { glyph: 'save', via: 'role' });

/* ---- slots ---- */
check('SLOT_ID: app/owner/surface/name', M.SLOT_ID.test('console-web/build-orchestrator/nav/orchestrator') && M.SLOT_ID.test('framework/framework/logo/amberx-app.mark') && !M.SLOT_ID.test('a/b') && !M.SLOT_ID.test('A/b/c/d'));
const s1 = M.normalizeSlot({ surface: 'toolbar', glyph: 'refresh', name: 'sync', label: 'Sync' }, { app: 'console-web', owner: 'hub-sync', ownerKind: 'plugin' });
eq('normalizeSlot fills id, kind, role from the glyph', [s1.id, s1.kind, s1.role, s1.ownerKind, s1.source], ['console-web/hub-sync/toolbar/sync', 'icon', 'refresh', 'plugin', 'code']);
check('normalizeSlot: badge / logo kinds and roles from the surface', M.normalizeSlot({ surface: 'badge', name: 'x' }).kind === 'badge' && M.normalizeSlot({ surface: 'badge', name: 'x' }).role === 'badge-status' && M.normalizeSlot({ surface: 'logo', name: 'x' }).role === 'app-logo');
check('slotErrors', M.slotErrors({}).length === 1 && M.slotErrors({ id: 'bad', surface: 'roof', kind: 'thing', role: 'Bad' }).length === 4 && M.slotErrors({ name: 'ok' }).length === 0);

/* ---- the manifest block ---- */
const blk = M.normalizeIconsBlock({ $axf: 'icon-map@1', roles: { 'sync-now': { glyph: 'refresh', group: 'action', label: 'Sync now' } }, pins: { refresh: 'sync-now' }, slots: [{ name: 'sync', surface: 'toolbar', role: 'sync-now', glyph: 'refresh' }] });
check('icons block: clean one has no errors', blk.errors.length === 0 && blk.declared && blk.block.slots.length === 1 && blk.block.pins.refresh === 'sync-now');
check('icons block: absent = not declared, no errors', !M.normalizeIconsBlock(undefined).declared && M.normalizeIconsBlock(undefined).errors.length === 0);
const bad = M.normalizeIconsBlock({ $axf: 'other', roles: { 'Bad': 'x', ok: { glyph: 'nope', group: 'odd' } }, pins: { a: 'Bad Role' }, slots: [{ surface: 'roof' }, 'x'] });
check('icons block: every problem named', bad.errors.length >= 6, bad.errors.join(' | '));

/* ---- scanners ---- */
const code = fx.scan.code;
const lits = M.scanIconLiterals(code, 'web/index.tsx');
if (write) fx.scan.literals = lits;
eq('scanIconLiterals (fixture)', lits, fx.scan.literals);
check('scanIconLiterals: surfaces guessed from context', lits.some((l) => l.surface === 'nav') && lits.some((l) => l.surface === 'settings') && lits.some((l) => l.surface === 'button') && lits.some((l) => l.surface === 'view'));
check('scanIconLiterals: unknown names flagged, icon-ok noted', lits.some((l) => !l.known && l.glyph === 'mystery') && lits.some((l) => l.ok));
const raws = M.scanRawIcons(fx.scan.raw, 'web/raw.tsx');
if (write) fx.scan.raws = raws;
eq('scanRawIcons (fixture)', raws, fx.scan.raws);
check('scanRawIcons: comments and icon-ok lines skipped', raws.every((r) => !r.text.includes('icon-ok')) && raws.length === 3);

/* ---- deriving a plugin's slots ---- */
const facts = { app: 'console-web', owner: 'example', ownerKind: 'plugin', manifest: fx.derive.manifest, sources: [{ file: 'apps/console-web/plugins/example/web/index.tsx', text: code }], assets: fx.derive.assets };
const derived = M.deriveSlots(facts);
if (write) fx.derive.slots = derived.slots;
eq('deriveSlots (fixture)', derived.slots, fx.derive.slots);
check('deriveSlots: declared slot took the code literal over (one slot, its id, file:line filled)', derived.slots.filter((s) => s.glyph === 'refresh' && s.surface === 'button').length === 1 && derived.slots.find((s) => s.id === 'console-web/example/button/ask-again')?.line > 0);
check('deriveSlots: pinned glyph carries the declared role', derived.slots.find((s) => s.glyph === 'cloud')?.role === 'server-says');
check('deriveSlots: badge asset is a badge slot', derived.slots.some((s) => s.kind === 'badge' && s.role === 'badge-status' && s.source === 'asset'));
check('deriveSlots: ids are unique and valid', new Set(derived.slots.map((s) => s.id)).size === derived.slots.length && derived.slots.every((s) => M.SLOT_ID.test(s.id)));
check('deriveSlots: unknown names listed', derived.unknown.some((u) => u.glyph === 'mystery'));

/* ---- the whole map + check ---- */
const map = M.buildIconMap([facts, { app: 'framework', owner: 'framework', ownerKind: 'framework', sources: [{ file: 'framework/react/x.tsx', text: '<Icon name="home" />' }], assets: [] }]);
check('buildIconMap: frame, sorted slots, counts, no problems', map.$axf === 'icon-map@1' && map.slots.length === derived.slots.length + 1 && map.counts.slots === map.slots.length && map.counts.byApp.framework === 1 && map.problems.length === 0 && map.roles['server-says']);
eq('iconMapErrors: a good map', M.iconMapErrors(map), []);
check('iconMapErrors: bad map named', M.iconMapErrors({ $axf: 'x', slots: [{ id: 'bad' }, { id: 'bad' }], roles: 1 }).length >= 4);
const verdict = M.iconMapCheck(map, raws, { files: {} });
check('iconMapCheck: unknown name fails, raw icons beyond the baseline fail', !verdict.ok && verdict.failures.some((f) => f.includes('"mystery"')) && verdict.failures.some((f) => f.includes('raw icon')));
const ok = M.iconMapCheck({ ...map, unknown: [] }, raws, verdict.baseline);
check('iconMapCheck: baseline holds the raws; fewer raws is a warning', ok.ok && M.iconMapCheck({ ...map, unknown: [] }, [], verdict.baseline).warnings.length === 1);
const frozen = M.iconMapCheck(map, [], { files: {}, unknown: {} }, { frozen: [/^apps\/console-web\/plugins\/example\//] });
check('iconMapCheck: frozen code is ratcheted, not failed outright', frozen.failures.every((f) => !f.includes('"mystery"')) && frozen.failures.some((f) => f.includes('frozen')) && frozen.baseline.unknown['apps/console-web/plugins/example/web/index.tsx'] === 1);
check('iconMapCheck: a declared role makes the name known', M.iconMapCheck({ ...map, roles: { ...map.roles, mystery: { glyph: 'box', group: 'object', label: 'm' } } }, [], { files: {} }).ok);

/* ---- projections ---- */
const tree = M.iconMapTree(map);
check('iconMapTree: app → owner → surface', tree.length === 2 && tree[0].owners[0].surfaces.every((s) => s.slots.length) && tree.find((a) => a.app === 'framework').count === 1);
check('iconMapSearch: words and filters', M.iconMapSearch(map, 'ask again').length === 1 && M.iconMapSearch(map, '', { kind: 'badge' }).length === 1 && M.iconMapSearch(map, '', { owner: 'framework' }).length === 1);

/* ---- icon-pack@1: roles, themable, covers, license ---- */
const p = normalizeIconPack({ style: 'duotone', grid: 24, glyphs: { save: 'M0 0' }, roles: { save: 'save', 'build-running': 'spinner', 'Bad Role': 'x', ok: 7 }, themable: false, covers: ['icons', 'badges', 'nope'], license: { name: 'MIT', url: 'https://x' } });
eq('normalizeIconPack: roles cleaned, themable, covers, license', [p.roles, p.themable, p.covers, p.license], [{ save: 'save', 'build-running': 'spinner' }, false, ['icons', 'badges'], { name: 'MIT', url: 'https://x' }]);
eq('normalizeIconPack: defaults', [normalizeIconPack({ glyphs: { a: 'M0 0' } }).themable, normalizeIconPack({ glyphs: { a: 'M0 0' } }).covers, normalizeIconPack({ glyphs: { a: 'M0 0' }, license: 'CC0' }).license], [true, ['icons'], { name: 'CC0', url: '' }]);
check('iconPackErrors: new fields validated', iconPackErrors({ style: 'outline', grid: 24, glyphs: { a: 'M0 0' }, roles: { 'Bad Role': 'x', ok: 7 }, themable: 'yes', covers: ['nope'], license: 7 }).length === 5 && iconPackErrors({ style: 'outline', grid: 24, glyphs: { a: 'M0 0' }, roles: { save: 'a' }, themable: true, covers: ICON_COVERS, license: 'MIT' }).length === 0);

/* ---- schemas + snapshot current ---- */
const schemas = M.iconMapSchemas();
check('schemas: four, with ids', Object.keys(schemas).length === 4 && Object.values(schemas).every((s) => s.$id));
const snapNow = snapshot(M.buildIconMap([]));
const snapFile = JSON.parse(readFileSync(join(ROOT, SNAPSHOT_REL), 'utf8'));
if (write) writeFileSync(join(ROOT, SNAPSHOT_REL), `${JSON.stringify(snapshot(), null, 2)}\n`);
const strip = (s) => ({ ...s, counts: undefined });
check(`${SNAPSHOT_REL} is current (node framework/cli/icon-map.mjs build --write)`, isDeepStrictEqual(strip(snapFile), strip(snapNow)));
check('snapshot carries roles, glyphs, settings keys and the resolution order', snapFile.roles?.save && snapFile.glyphs?.names?.length === G.GLYPH_NAMES.length && snapFile.settings?.pack === M.ICON_PACK_KEY && snapFile.resolution?.[0] === 'override');

if (write) writeFileSync(FIXTURE, `${JSON.stringify(fx, null, 1)}\n`);
console.log(fails ? `check-icon-map: ${fails} of ${n} checks failed` : `check-icon-map: ${n} checks passed`);
process.exit(fails ? 1 : 0);
