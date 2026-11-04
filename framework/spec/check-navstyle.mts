/**
 * nav-style@1 (core/engines/navstyle.ts, navstyle-rules.mjs): replays spec/fixtures/nav-style.json through the reference
 * engine (the Kotlin twin is deferred, spec/PORTING.md), checks every preset validates with no engine errors, the TS and
 * build-engine validators agree, control@1 `tokens.nav` lists every field, and the registry entry (optional, shared).
 *   npx -y tsx framework/spec/check-navstyle.mts
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NAV_STYLE_FIELDS, NAV_STYLE_FRAME, navArrange, navFollow, navPathTo, navStyleErrors, navStyleOutput, navToggle, normalizeNavStyle } from '../core/engines/navstyle';
import { navFieldErrors } from '../core/engines/navstyle-rules.mjs';
import { controlPaths, controlValueErrors, CONTROL_TARGETS } from '../core/engines/control-rules.mjs';
import { CONTROL_TOKEN_SLOTS } from '../core/engines/control-tokens.mjs';
import { validateAsset } from '../core/validate';
import { ASSET_TYPES, OPTIONAL_TYPES } from '../core/types';
// @ts-expect-error plain .mjs (the build engine's own validator)
import { validateAsset as engineValidate } from '../cli/build-engine.mjs';

const root = new URL('../', import.meta.url).pathname;
const f = JSON.parse(readFileSync(join(root, 'spec/fixtures/nav-style.json'), 'utf8'));
const spec = JSON.parse(readFileSync(join(root, 'schemas/asset-types.json'), 'utf8'));
let checks = 0;
const ok = (c: unknown, msg: string) => { assert.ok(c, msg); checks++; };
const eq = (a: unknown, b: unknown, msg: string) => { assert.deepEqual(JSON.parse(JSON.stringify(a ?? null)), JSON.parse(JSON.stringify(b ?? null)), msg); checks++; };

eq(f.contract, NAV_STYLE_FRAME, 'contract'); eq(f.fields, NAV_STYLE_FIELDS, 'fields');
ok((ASSET_TYPES as readonly string[]).includes('nav-style') && (OPTIONAL_TYPES as readonly string[]).includes('nav-style'), 'nav-style is an optional asset type');
ok(spec.types['nav-style']?.optional === true && spec.types['nav-style']?.shared !== false, 'asset-types.json: optional and shared (every app ships the presets)');
ok(spec.types['nav-menu']?.optional_fields?.navStyle, 'nav-menu documents navStyle (the opt-in)');
ok(existsSync(join(root, 'schemas/json/nav-style.schema.json')), 'JSON schema generated');

for (const [id, s] of Object.entries(f.starters) as [string, { normalized: unknown; errors: string[]; valid: unknown; output: unknown; reduced: unknown }][]) {
  const a = JSON.parse(readFileSync(join(root, 'assets/nav-style', `${id}.json`), 'utf8'));
  eq(normalizeNavStyle(a.data), s.normalized, `${id} normalized`); eq(navStyleErrors(a.data), [], `${id} has no errors`); eq(validateAsset(a), s.valid, `${id} validates`);
  eq(navStyleOutput(a.data), s.output, `${id} output`); eq(navStyleOutput(a.data, { reducedMotion: true }), s.reduced, `${id} reduced motion`);
  eq(engineValidate(a).errors, [], `${id} build engine agrees`);
}
ok(f.starters.standard && Object.keys(f.starters.standard.output.vars).every((k: string) => !k.startsWith('--fx-navs-') || ['--fx-navs-indent', '--fx-navs-dur', '--fx-navs-ease', '--fx-navs-stagger'].includes(k)), 'standard leaves every colour and font to the theme');
ok(Object.values(f.starters).every((s) => (s as { reduced: { attrs: Record<string, string> } }).reduced.attrs['data-fx-navs-anim'] === 'none' || (s as { normalized: { animation: { reduced: string } } }).normalized.animation.reduced === 'never'), 'reduced motion turns the animation off');
for (const n of f.normalize) eq(normalizeNavStyle(n.raw), n.out, `normalize ${n.name}`);
for (const e of f.errors) eq(navStyleErrors(e.raw), e.errors, `errors ${e.name}`);
ok(f.errors.find((e: { name: string }) => e.name === 'bad values').errors.length >= 6, 'bad values are named');
for (const e of f.fieldErrors) eq(navFieldErrors(e.path, e.value), e.errors, `field ${e.path}=${e.value}`);
eq(navStyleOutput({}, { collapsed: true }), f.output.collapsed, 'collapsed'); eq(navStyleOutput({ width: { resizable: true, min: 180, max: 400 } }, { width: 999 }), f.output.resized, 'resized (clamped)');
eq(navStyleOutput({ width: { size: 260 } }), f.output.fixedWidth, 'fixed width'); eq(navStyleOutput({ colors: { background: 'surface2', activeText: 'accent' }, font: { family: 'display', size: 'sm', weight: '600' }, layout: { density: 'compact' } }), f.output.colours, 'colours');
ok(f.output.resized.vars['--fx-layout-nav-width'] === '400px', 'a dragged width is clamped to the max');
ok(!JSON.stringify(f.output.colours).match(/#[0-9a-f]{3,8}\b/i), 'colours compile to theme tokens, never literals');

const t = f.tree.tree;
for (const p of f.tree.path) eq(navPathTo(t, p.view), p.path, `path ${p.view}`);
const single = normalizeNavStyle({}); const multi = normalizeNavStyle({ behavior: { single: false, autoCollapse: false } }); const noFollow = normalizeNavStyle({ behavior: { followActive: false } });
eq(navToggle(t, [], 'console', true), f.tree.toggle[0].out, 'toggle 0'); eq(navToggle(t, ['console'], 'build', true), f.tree.toggle[1].out, 'toggle 1');
eq(navToggle(t, ['console', 'build'], 'axhub', true), f.tree.toggle[2].out, 'toggle 2'); eq(navToggle(t, ['console', 'build'], 'axhub', false), f.tree.toggle[3].out, 'toggle 3');
eq(navToggle(t, ['console', 'build', 'axhub'], 'console', false), f.tree.toggle[4].out, 'toggle 4'); eq(navToggle(t, ['console'], 'console', true, true), f.tree.toggle[5].out, 'toggle 5');
eq(f.tree.toggle[2].out, ['axhub'], 'single mode: opening axHub closes the Console'); eq(f.tree.toggle[4].out, ['axhub'], 'closing a group closes what is under it');
eq(navFollow(t, ['axhub'], 'console/nav:pending', single), f.tree.follow[0].out, 'follow 0'); eq(navFollow(t, ['axhub'], 'console/nav:pending', multi), f.tree.follow[1].out, 'follow 1');
eq(navFollow(t, ['axhub'], 'console/nav:pending', noFollow), f.tree.follow[2].out, 'follow 2'); eq(navFollow(t, [], 'console', single), f.tree.follow[3].out, 'follow 3'); eq(navFollow(t, ['console'], 'nope', single), f.tree.follow[4].out, 'follow 4');
eq(f.tree.follow[0].out, ['console', 'build'], 'the active page opens its branch');
eq(navArrange(t, single), f.tree.arrange[0].out, 'arrange default'); eq(navArrange(t, normalizeNavStyle({ items: { order: 'axhub,console', hidden: 'home', pinned: 'console' } })), f.tree.arrange[1].out, 'arrange');

// control@1 tokens.nav: one registry, every field listed, values checked by the same rules
ok(CONTROL_TARGETS['tokens.nav']?.asset === 'nav-style' && CONTROL_TOKEN_SLOTS['tokens.nav'].key === 'axf.tokens.nav', 'control@1 tokens.nav → nav-style, key axf.tokens.nav');
eq((controlPaths('tokens.nav') ?? []).map((p: { id: string }) => p.id), Object.keys(NAV_STYLE_FIELDS), 'tokens.nav lists every field');
eq(controlValueErrors('tokens.nav', 'animation.kind', 'push'), [], 'set animation.kind push'); ok(controlValueErrors('tokens.nav', 'animation.kind', 'spin').length === 1, 'refuses an unknown animation');
eq(controlValueErrors('tokens.nav', 'accents.console', 'success'), [], 'accents.<item> takes a colour token'); ok(controlValueErrors('tokens.nav', 'nope', 1).length === 1, 'refuses an unknown field');

console.log(`✓ nav-style@1 — ${checks} checks`);
