/**
 * Brand engine checks: logo-mark / animated-logo / icon-pack / branding rules (brand-rules.mjs), SVG output of the
 * engine (brand.ts), resolution against a registry, the build engine's validator agreeing with core, and every
 * starter brand asset. Fixture `spec/fixtures/brand.json` pins the SVG and resolution outputs (regenerate with
 * `gen-fixtures.mts`, or `--write` here the first time).
 *   npx -y tsx framework/spec/check-brand.mts [--write]
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { validateAsset } from '../core/validate';
import { ASSET_TYPES, OPTIONAL_TYPES } from '../core/types';
import {
  BRAND_SLOTS, BRAND_TYPES, animatedLogoErrors, animationFor, brandAssetErrors, brandSlots, brandingErrors, brandingVars, decorationFor, glyphFor, glyphSvg, iconPackErrors, markBox, markColor, markErrors, markSvg, normalizeBranding, normalizeIconPack, normalizeMark, registerBrandSlot, resolveBranding,
} from '../core/engines/brand';
import * as engine from '../cli/build-engine.mjs';
import { AxfRuntime } from '../core/runtime';
import { readdirSync as rd } from 'node:fs';

let n = 0;
const ok = (c: unknown, m: string) => { assert.ok(c, m); n++; };
const eq = (a: unknown, b: unknown, m: string) => { assert.deepEqual(a, b, m); n++; };
const root = new URL('../../', import.meta.url);
const read = (p: string) => JSON.parse(readFileSync(new URL(p, root), 'utf8'));

/* ---- types registered ---- */
for (const t of BRAND_TYPES) { ok(ASSET_TYPES.includes(t as never), `${t} registered`); ok(OPTIONAL_TYPES.includes(t as never), `${t} optional`); }
const spec = read('framework/schemas/asset-types.json'); const types = spec.types ?? spec;
for (const t of BRAND_TYPES) ok(types[t]?.group === 'Brand', `${t} in the Brand group`);

/* ---- rules ---- */
eq(markErrors({ form: 'mark', paths: [{ d: 'M0 0h10v10z' }] }), [], 'a plain mark validates');
ok(markErrors({ form: 'mark', paths: [] }).length === 1, 'a mark needs a path');
ok(markErrors({ form: 'wordmark', paths: [] }).some((e) => e.includes('text.value')), 'a wordmark needs text');
ok(markErrors({ form: 'mark', paths: [{ d: 'M0 0 <script>' }] }).some((e) => e.includes('commands and numbers')), 'script-looking path data refused');
ok(markErrors({ form: 'mark', paths: [{ d: 'M0 0h1', fill: 'url(#x)' }] }).some((e) => e.includes('fill')), 'url() fills refused');
ok(markErrors({ form: 'mark', paths: [{ d: 'M0 0h1' }], palette: { brand9: '#fff' } }).length === 1, 'palette keys limited');
ok(markErrors({ form: 'mark', paths: [{ d: 'M0 0h1' }], viewBox: 'a b' }).some((e) => e.includes('viewBox')), 'bad viewBox');
ok(markErrors({ form: 'mark', paths: [{ d: 'M0 0h1'.repeat(2000) }] }).some((e) => e.includes('characters')), 'path size cap');
eq(normalizeMark({ form: 'mark', paths: [{ d: ' M0 0h1 ', fill: 'accent', strokeWidth: 99 }] }).paths[0], { d: ' M0 0h1 ', fill: 'accent', stroke: 'none', strokeWidth: 16, opacity: 1, round: false }, 'normalize clamps');
eq(normalizeMark({}).viewBox, [0, 0, 24, 24], 'default viewBox');
eq(animatedLogoErrors({ mark: 'amberx', preset: 'pulse' }), [], 'animated ok');
ok(animatedLogoErrors({ preset: 'pulse' }).length === 1 && animatedLogoErrors({ mark: 'x', preset: 'explode' }).length === 1 && animatedLogoErrors({ mark: 'x', durationMs: 5 }).length === 1, 'animated errors');
eq(iconPackErrors({ style: 'outline', grid: 24, glyphs: { home: 'M0 0h1' } }), [], 'pack ok (string glyph)');
ok(iconPackErrors({ style: 'outline', grid: 24, glyphs: {} }).length === 1 && iconPackErrors({ style: 'neon', grid: 24, glyphs: { a: 'M0 0' } }).length === 1 && iconPackErrors({ glyphs: { 'Bad Name': 'M0 0' } }).some((e) => e.includes('lowercase')), 'pack errors');
eq(Object.keys(normalizeIconPack({ glyphs: { ok: 'M0 0h1', 'Bad': 'M0 0', evil: 'M0 0 <x>' } }).glyphs), ['ok'], 'normalize drops bad glyph names and data');
eq(brandingErrors({ brand: { name: 'A' }, marks: { mark: 'a' } }), [], 'branding minimal ok');
ok(brandingErrors({ marks: { mark: 'a' } }).length === 1 && brandingErrors({ brand: 'A', marks: {} }).length === 1, 'branding needs a name and a mark');
ok(brandingErrors({ brand: 'A', marks: { mark: 'a' }, decorations: { toaster: 'mark' } }).some((e) => e.includes('not a brand slot')), 'unknown slot refused');
ok(brandingErrors({ brand: 'A', marks: { mark: 'a' }, decorations: { banner: 'neon' } }).some((e) => e.includes('must be one of')), 'unknown mode refused');
registerBrandSlot('my-panel');
eq(brandingErrors({ brand: 'A', marks: { mark: 'a' }, decorations: { 'my-panel': 'mark' } }), [], 'a registered slot is accepted');
ok(brandSlots().includes('my-panel') && !BRAND_SLOTS.includes('my-panel'), 'open slot registry');
eq(normalizeBranding({ brand: 'A', marks: { mark: 'a' } }).decorations.banner, 'lockup', 'default decoration modes');
eq(brandAssetErrors('color-theme', {}), null, 'non-brand types pass through');
ok(brandAssetErrors('branding', {})!.length > 0, 'brandAssetErrors routes');

/* ---- engine output ---- */
eq([markColor('currentColor'), markColor('accent'), markColor('accentText'), markColor('brand1', { brand1: '#abc' }), markColor('#fff'), markColor('bogus')], ['currentColor', 'var(--fx-accent)', 'var(--fx-accent-text)', 'var(--fx-brand-1, #abc)', '#fff', 'currentColor'], 'colour words → CSS');
const svg = markSvg({ form: 'mark', brand: 'T', paths: [{ d: 'M0 0h10v10z', fill: 'accent' }, { d: 'M1 1', stroke: 'bg', strokeWidth: 2, round: true, fill: 'none' }] }, { height: 32 });
ok(svg.startsWith('<svg') && svg.includes('role="img"') && svg.includes('aria-label="T"') && svg.includes('fill="var(--fx-accent)"') && svg.includes('stroke-linecap="round"') && svg.includes('width="32" height="32"'), 'mark svg');
ok(!/<script|href=|url\(/.test(markSvg({ form: 'mark', paths: [{ d: 'M0 0h1' }] })), 'svg never carries script, links or urls');
const lock = markSvg({ form: 'lockup', paths: [{ d: 'M0 0h24v24z' }], text: { value: 'Brand', weight: 700 } }, { height: 24 });
ok(lock.includes('<text') && lock.includes('>Brand</text>') && /width="\d+"/.test(lock), 'lockup draws its text');
ok(!markSvg({ form: 'lockup', paths: [{ d: 'M0 0h24v24z' }], text: { value: 'Brand' } }, { text: false }).includes('<text'), 'text can be left out');
ok(markSvg({ form: 'mark', paths: [{ d: 'M0 0h1' }], brand: 'a<b' }).includes('aria-label="a&lt;b"'), 'labels escaped');
eq(markBox(normalizeMark({ form: 'mark', paths: [{ d: 'M0 0h1' }] }), 24), { width: 24, height: 24 }, 'square mark box');
ok(markBox(normalizeMark({ form: 'lockup', paths: [{ d: 'M0 0h1' }], text: { value: 'AmberX' } }), 24).width > 24, 'lockup is wider');
eq(animationFor({ mark: 'a', preset: 'spin', durationMs: 1000, loop: 'hover' })?.className, 'fx-brand-anim fx-brand-anim--spin fx-brand-anim--hover', 'animation class');
eq(animationFor({ mark: 'a', preset: 'spin' }, true), null, 'reduced motion = still frame');
eq(animationFor({ mark: 'a', preset: 'none' }), null, 'preset none');
eq(animationFor({ mark: 'a', preset: 'pulse', durationMs: 2000 })?.iteration, 'infinite', 'loop by default');
const pack = { style: 'outline', grid: 24, stroke: 2, glyphs: { home: 'M0 0h1', solid: { d: 'M0 0h2', fill: true }, duo: { d: 'M0 0h3', secondary: 'M1 1h1' } } };
eq(glyphFor(pack, 'home')?.d, 'M0 0h1', 'glyph lookup');
eq(glyphFor(pack, 'nope'), null, 'unknown glyph = framework fallback');
ok(glyphSvg(pack, 'home', 20)!.includes('stroke-width="2"') && glyphSvg(pack, 'solid')!.includes('fill="currentColor"') && glyphSvg(pack, 'duo')!.includes('opacity="var(--fx-opacity-tint'), 'glyph svg per style');
eq(glyphSvg(pack, 'nope'), null, 'no svg for unknown');

/* ---- resolution ---- */
const reg = { has: (t: string, id: string) => ({ 'logo-mark': ['amberx', 'amberx-lockup'], 'animated-logo': ['amberx-pulse'], 'icon-pack': ['amberx-outline'] } as Record<string, string[]>)[t]?.includes(id) ?? false };
const r = resolveBranding({ brand: 'AmberX', marks: { mark: 'amberx', wordmark: 'missing', lockup: 'amberx-lockup', animated: 'amberx-pulse' }, iconPack: 'amberx-outline', decorations: { toolbar: 'wordmark', container: 'animated' } }, reg);
eq([r.mark, r.wordmark, r.lockup, r.animated, r.iconPack, r.missing], ['amberx', 'amberx', 'amberx-lockup', 'amberx-pulse', 'amberx-outline', ['logo-mark/missing']], 'resolution with fallbacks');
eq(decorationFor(r, 'banner'), { mode: 'lockup', asset: 'amberx-lockup', type: 'logo-mark' }, 'banner lockup');
eq(decorationFor(r, 'toolbar'), { mode: 'wordmark', asset: 'amberx', type: 'logo-mark' }, 'missing wordmark falls back to the mark');
eq(decorationFor(r, 'container'), { mode: 'animated', asset: 'amberx-pulse', type: 'animated-logo' }, 'animated place');
eq(decorationFor(r, 'tab-group'), null, 'none = nothing');
const r2 = resolveBranding({ brand: 'A', marks: { mark: 'amberx', animated: 'gone' }, decorations: { splash: 'animated' } }, reg);
eq(decorationFor(r2, 'splash'), { mode: 'animated', asset: 'amberx', type: 'logo-mark' }, 'missing animation → the still mark');
eq(brandingVars({ brand: 'A', marks: { mark: 'a' }, palette: { brand1: '#123456' } }), { '--fx-brand-name': '"A"', '--fx-brand-1': '#123456' }, 'brand vars');
eq(brandingVars({ brand: 'A', marks: { mark: 'a' }, palette: { brand1: '#123456' }, accentFromBrand: true })['--fx-accent'], '#123456', 'brand1 as accent when asked');

/* ---- build engine = core ---- */
for (const t of BRAND_TYPES) {
  const bad = { $axf: 'asset@1', type: t, id: 'x', name: 'x', version: '1.0.0', data: {} };
  eq(engine.validateAsset ? engine.validateAsset(bad).errors : validateAsset(bad).errors, validateAsset(bad).errors, `build engine mirrors core for ${t}`);
}

/* ---- starters ---- */
let count = 0;
for (const t of BRAND_TYPES) {
  const dir = new URL(`framework/assets/${t}/`, root);
  if (!existsSync(dir)) continue;
  for (const f of readdirSync(dir)) { const a = read(`framework/assets/${t}/${f}`); eq(validateAsset(a).errors, [], `${t}/${f} valid`); count++; }
}
ok(count >= 10, `${count} starter brand assets`);
const starters = { has: (t: string, id: string) => existsSync(new URL(`framework/assets/${t}/${id}.json`, root)) };
for (const id of ['amberx', 'gizmox']) { const rb = resolveBranding(read(`framework/assets/branding/${id}.json`).data, starters); eq(rb.missing, [], `branding ${id} resolves every id`); ok(rb.animated && rb.iconPack, `${id} has an animated mark and a pack`); }

/* ---- runtime: brandPlace / brandGlyph / vars with the starter assets ---- */
{
  const assetsDir = new URL('framework/assets/', root).pathname;
  const assets = rd(assetsDir).flatMap((t) => rd(assetsDir + t).filter((n) => n.endsWith('.json')).map((n) => read(`framework/assets/${t}/${n}`)));
  const defaults = read('framework/defaults.json');
  const rt = new AxfRuntime({ manifest: { app: { id: 'test', name: 'Test' }, defaults: { ...defaults, branding: 'amberx' } } as never, assets, storageKey: 'test:brand' });
  const b = rt.branding();
  ok(b && b.name === 'AmberX' && b.missing.length === 0, 'runtime resolves the amberx branding');
  const banner = rt.brandPlace('banner', 14);
  ok(banner && banner.mode === 'lockup' && banner.svg.includes('<svg') && banner.svg.includes('height="14"') && banner.animation === null, 'banner place = lockup svg at 14px');
  eq(rt.brandPlace('tab-group'), null, 'tab-group draws nothing by default');
  ok(rt.brandGlyph('home') !== null && rt.brandGlyph('no-such-glyph') === null, 'icon pack glyph lookup with framework fallback');
  const vars = rt.compileStyles().vars;
  ok(vars['--fx-brand-name'] === '"AmberX"' && /^#/.test(vars['--fx-brand-1'] ?? ''), 'brand vars compiled');
  eq(rt.compileStyles().attrs['data-fx-brand'], 'amberx', 'root carries the branding id');
  rt.swap('branding' as never, 'gizmox');
  ok(rt.branding()?.name === 'GizmoX' && rt.brandPlace('banner')?.svg.includes('GizmoX'), 'hot swap to GizmoX');
  const splash = rt.brandPlace('splash');
  ok(splash && splash.mode === 'animated' && splash.animation && splash.animation.name.startsWith('fx-brand-'), 'animated place carries its animation');
}

/* ---- fixture ---- */
const fixture = {
  svg: { amberx: markSvg(read('framework/assets/logo-mark/amberx.json').data, { height: 24 }), gizmoxLockup: markSvg(read('framework/assets/logo-mark/gizmox-lockup.json').data, { height: 24 }) },
  glyph: glyphSvg(read('framework/assets/icon-pack/amberx-outline.json').data, 'home', 16),
  resolved: resolveBranding(read('framework/assets/branding/amberx.json').data, starters),
  animation: animationFor(read('framework/assets/animated-logo/gizmox-spin.json').data),
};
const fx = new URL('fixtures/brand.json', import.meta.url);
if (process.argv.includes('--write') || !existsSync(fx)) writeFileSync(fx, JSON.stringify(fixture, null, 2) + '\n');
eq(JSON.parse(readFileSync(fx, 'utf8')), fixture, 'fixture brand.json matches (regenerate with --write when the engine changes on purpose)');
console.log(`check-brand: ${n} checks passed`);
