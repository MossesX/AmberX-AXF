/**
 * Every layout parameter is a token (core/engines/layout.ts, rules core/engines/layout-rules.mjs; build token-control
 * s1, Nov 2026): the registry's enums equal asset-types.json, every default sits in its range and equals the
 * framework's own look (axf.css before the tokens), normalize fills / clamps / rounds and keeps the grid, every
 * field compiles to a regular --fx-layout-* token, the grid vars read the width tokens while the compiled struct
 * keeps px (the Kotlin conformance contract), both validators are the same function, every starter layout and
 * every app's copy validates, the schema carries every field, the fixture matches, and check-theme knows the tokens.
 *   npx -y tsx framework/spec/check-layout-tokens.mts
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { validateAsset } from '../core/validate';
import {
  DEFAULT_LAYOUT, LAYOUT_ENUMS, LAYOUT_FIELDS, LAYOUT_SWITCHES, LAYOUT_VIEWPORTS, compileLayout, layoutBreakpointAttr, layoutErrors, layoutFieldNames, layoutToken, layoutTokenValues, layoutTokenVars, layoutTokens, layoutVars, layoutViewportAttrs, layoutViewports, normalizeLayout,
} from '../core/engines/layout';
import * as engine from '../cli/build-engine.mjs';

let n = 0;
const ok = (c: unknown, m: string) => { assert.ok(c, m); n++; };
const eq = (a: unknown, b: unknown, m: string) => { assert.deepEqual(a, b, m); n++; };
const root = new URL('../../', import.meta.url);
const read = (p: string) => JSON.parse(readFileSync(new URL(p, root), 'utf8'));

/* ---- registry = asset-types.json ---- */
const spec = read('framework/schemas/asset-types.json');
eq(spec.types.layout.enums, LAYOUT_ENUMS, 'layout enums are the same words in the registry and asset-types.json');
eq(spec.types.layout.tokens.rules, 'core/engines/layout-rules.mjs', 'asset-types.json names the rules file');
for (const f of [...Object.keys(LAYOUT_FIELDS), ...Object.keys(LAYOUT_ENUMS), ...Object.keys(LAYOUT_SWITCHES)]) {
  ok(spec.types.layout.required.includes(f) || f in spec.types.layout.optional_fields, `${f} is listed in asset-types.json (required or optional_fields)`);
}
eq(spec.types.layout.required, ['nav', 'navWidth', 'showMenubar', 'showToolbar', 'toolbarPosition', 'showStatusbar', 'inspector', 'inspectorWidth', 'contentMaxWidth'], 'the required list is still the grid (existing assets stay valid)');

/* ---- defaults = the framework's own look ---- */
for (const [f, [def, min, max]] of Object.entries(LAYOUT_FIELDS)) ok(def >= min && def <= max, `${f} default ${def} inside [${min}, ${max}]`);
eq(DEFAULT_LAYOUT.statusHeight, 26, 'status bar 26px (axf.css before the tokens)');
eq(DEFAULT_LAYOUT.regionGap, 0, 'no gap between regions by default');
eq([DEFAULT_LAYOUT.mainPadTop, DEFAULT_LAYOUT.mainPadX, DEFAULT_LAYOUT.mainPadBottom], [2.4, 4, 6], 'main padding 2.4 / 4 / 6 space (was gap-4xl / 4 / 6)');
eq([DEFAULT_LAYOUT.phoneMainPadTop, DEFAULT_LAYOUT.phoneMainPadX, DEFAULT_LAYOUT.phoneMainPadBottom], [1.6, 1.6, 4], 'phone main padding 1.6 / 1.6 / 4 space (was gap-3xl / gap-3xl / 4)');
eq([DEFAULT_LAYOUT.tinyMaxWidth, DEFAULT_LAYOUT.smallMaxWidth, DEFAULT_LAYOUT.phoneMaxWidth, DEFAULT_LAYOUT.mediumMaxWidth, DEFAULT_LAYOUT.largeMaxWidth], [480, 640, 760, 900, 1200], 'viewport cut-offs = the old media-query breakpoints');
eq(DEFAULT_LAYOUT.phoneNavItemMin, 64, 'phone nav item 64px');
eq(DEFAULT_LAYOUT.phoneEdge, 8, 'phone edge 8px');
const vp = LAYOUT_VIEWPORTS.map((v) => DEFAULT_LAYOUT[v.field as keyof typeof DEFAULT_LAYOUT] as number);
ok(vp.every((w, i) => i === 0 || w > vp[i - 1]!), 'viewport cut-offs ascend');
eq(LAYOUT_VIEWPORTS.map((v) => v.attr), ['data-fx-tiny', 'data-fx-small', 'data-fx-narrow', 'data-fx-medium', 'data-fx-large'], 'root attributes per cut-off');

/* ---- normalize: fills, clamps, rounds, keeps the rest ---- */
const grid = { nav: 'left', navWidth: 224, showMenubar: true, showToolbar: true, toolbarPosition: 'top', showStatusbar: true, inspector: 'right', inspectorWidth: 280, contentMaxWidth: 0 } as const;
const norm = normalizeLayout({ ...grid, navWidth: 5000, regionGap: 0.33333, statusHeight: 26.4, slots: { nav: [] } });
eq(norm.navWidth, 640, 'clamped to the max');
eq(norm.regionGap, 0.333, 'rounded to 3 decimals');
eq(norm.statusHeight, 26, 'px rounded to whole');
eq(norm.slots, { nav: [] }, 'other keys kept');
eq(norm.phoneMaxWidth, 760, 'missing field → default');
eq(normalizeLayout({ ...grid, nav: 'middle', showStatusbar: 'yes' }).nav, 'left', 'bad enum → default');
eq(normalizeLayout({ ...grid, nav: 'middle', showStatusbar: 'yes' }).showStatusbar, true, 'bad switch → default');
eq(normalizeLayout(null).navWidth, 224, 'null → defaults');

/* ---- tokens: regular names, every field, units ---- */
const vars = layoutTokenVars(null);
eq(Object.keys(vars).length, layoutFieldNames().length, 'one token per field');
for (const f of layoutFieldNames()) ok(layoutToken(f) in vars, `${f} → ${layoutToken(f)}`);
eq(layoutToken('phoneMaxWidth'), '--fx-layout-phone-max-width', 'kebab-case token names');
eq(vars['--fx-layout-nav-width'], '224px', 'px unit');
eq(vars['--fx-layout-main-pad-x'], 'calc(var(--fx-space) * 4)', 'space unit (× --fx-space, so the Spacing choice applies)');
eq(vars['--fx-layout-nav'], 'left', 'enum → its word');
eq(vars['--fx-layout-show-menubar'], '1', 'switch → 1 / 0');
eq(layoutTokens().length, layoutFieldNames().length, 'the token list covers every field');
eq(layoutTokens().find((t) => t.field === 'nav')?.options, ['left', 'right', 'top'], 'enum tokens list their words');
eq(layoutTokenValues({ ...grid, navWidth: 100 }).find((t) => t.field === 'navWidth')?.value, 100, 'token values for one layout');

/* ---- the grid reads the tokens; the compiled struct keeps px ---- */
const c = compileLayout(grid);
eq(c.columns, '224px minmax(0, 1fr) 280px', 'compiled columns stay px (Kotlin compares these)');
eq(c.columnRegions, ['nav', 'main', 'inspector'], 'column regions name the columns');
const v = layoutVars(grid);
eq(v['--fx-grid-cols'], 'var(--fx-layout-nav-width) minmax(0, 1fr) var(--fx-layout-inspector-width)', 'grid columns read the width tokens');
eq(v['--fx-content-max'], 'none', 'no content limit → none');
eq(layoutVars({ ...grid, contentMaxWidth: 920 })['--fx-content-max'], 'var(--fx-layout-content-max-width)', 'a content limit reads its token');
eq(v['--fx-layout-nav-orientation'], 'vertical', 'the drawn nav orientation is a token too');
eq(layoutVars({ ...grid, nav: 'top' })['--fx-layout-nav-orientation'], 'horizontal', 'top nav → horizontal');
eq(layoutVars({ ...grid, nav: 'right' })['--fx-grid-cols'], 'minmax(0, 1fr) var(--fx-layout-inspector-width) var(--fx-layout-nav-width)', 'right nav → last column');
eq(layoutVars(grid, ['nav-menu'])['--fx-grid-cols'], 'minmax(0, 1fr) var(--fx-layout-inspector-width)', 'a hidden nav drops its column');
eq(layoutViewports(grid).map((x) => x.maxWidth), [480, 640, 760, 900, 1200], 'viewports for the runtime to watch');
eq(layoutViewportAttrs(grid, 320), { 'data-fx-tiny': '1', 'data-fx-small': '1', 'data-fx-narrow': '1', 'data-fx-medium': '1', 'data-fx-large': '1' }, 'a phone carries every attribute');
eq(layoutViewportAttrs(grid, 700), { 'data-fx-narrow': '1', 'data-fx-medium': '1', 'data-fx-large': '1' }, '700px: narrow and up');
eq(layoutViewportAttrs(grid, 1920), {}, 'a wide desktop carries none');
eq(layoutBreakpointAttr(720, 'max')?.attr, 'data-fx-narrow', 'max-width 720 lands on narrow');
eq(layoutBreakpointAttr(1500, 'max'), null, 'max-width 1500 has no cut-off (above large)');
eq(layoutBreakpointAttr(761, 'min'), { attr: 'data-fx-narrow', field: 'phoneMaxWidth', maxWidth: 760, negate: true }, 'min-width 761 = not narrow');
eq(layoutBreakpointAttr(760, 'min')?.attr, 'data-fx-narrow', 'min-width 760 = not narrow too');

/* ---- validators: the same function in core and the build engine ---- */
const bad = { ...grid, navWidth: 5000, nav: 'middle', showMenubar: 'yes', statusHeight: 26.4, phoneMaxWidth: 600, smallMaxWidth: 700 };
const errs = layoutErrors('layout', bad);
ok(errs.some((e) => e.includes('navWidth')) && errs.some((e) => e.includes('data.nav must be one of')) && errs.some((e) => e.includes('showMenubar')) && errs.some((e) => e.includes('whole number')) && errs.some((e) => e.includes('must be below')), `errors name every bad field: ${errs.join(' | ')}`);
eq(layoutErrors('layout', grid), [], 'a grid-only asset is fine');
eq(layoutErrors('button', { navWidth: 'x' }), [], 'other types are not checked here');
const asset = (data: unknown) => ({ $axf: 'asset@1', type: 'layout', id: 'test-layout', name: 'Test', version: '1.0.0', data });
const core = validateAsset(asset(bad));
const build = engine.validateAsset(asset(bad));
ok(!core.ok && !build.ok, 'both validators reject');
for (const e of errs) { ok(core.errors.includes(e), `core reports: ${e}`); ok(build.errors.includes(e), `build engine reports: ${e}`); }
ok(validateAsset(asset(grid)).ok && engine.validateAsset(asset(grid)).ok, 'both validators accept a grid-only asset');
ok(validateAsset(asset({ ...grid, statusHeight: 30, regionGap: 0.5, phoneMaxWidth: 700 })).ok, 'token fields accepted');

/* ---- every starter + every app's copy validates and normalizes to in-range values ---- */
const dirs = ['framework/assets/layout', ...readdirSync(new URL('apps', root)).flatMap((a) => ['src/assets/layout', 'src/axf/assets/layout', 'src/assets-overrides/layout'].map((p) => `apps/${a}/${p}`))].filter((d) => existsSync(new URL(d, root)));
let assets = 0;
for (const d of dirs) for (const f of readdirSync(new URL(`${d}/`, root)).filter((f) => f.endsWith('.json'))) {
  const a = read(`${d}/${f}`);
  if (a.type !== 'layout') continue;
  assets++;
  const r = validateAsset(a);
  ok(r.ok, `${d}/${f} validates: ${r.errors.join('; ')}`);
  eq(layoutErrors('layout', a.data), [], `${d}/${f}: token fields in range`);
}
ok(assets >= 15, `${assets} layout assets checked`);

/* ---- schema carries every field; fixture matches ---- */
const schema = read('framework/schemas/json/layout.schema.json');
for (const f of layoutFieldNames()) ok(f in schema.properties.data.properties, `schema has ${f}`);
eq(schema.properties.data.properties.statusHeight, { type: 'integer', minimum: 16, maximum: 64, default: 26, description: 'px; token --fx-layout-status-height' }, 'schema field typed + ranged');
const fixture = read('framework/spec/fixtures/layout-tokens.json');
eq(fixture.tokens, layoutTokens(), 'fixture token list');
eq(fixture.vars.defaults, vars, 'fixture default vars');
eq(fixture.normalize.clamped.navWidth, 640, 'fixture clamp case');
const layoutFixture = read('framework/spec/fixtures/layout.json');
for (const [id, f] of Object.entries<{ vars: Record<string, string> }>(layoutFixture)) ok(f.vars['--fx-layout-nav-width'] !== undefined && f.vars['--fx-grid-cols'] !== undefined, `layout.json ${id} carries the tokens + grid`);

/* ---- s2: the shell stylesheet reads the tokens; no px breakpoint left in the framework UI ---- */
const css = readFileSync(new URL('framework/ui/axf.css', root), 'utf8');
for (const t of ['status-height', 'region-gap', 'main-pad-top', 'main-pad-x', 'main-pad-bottom', 'phone-main-pad-top', 'phone-main-pad-x', 'phone-main-pad-bottom', 'phone-nav-item-min', 'phone-edge']) ok(css.includes(`var(--fx-layout-${t})`), `axf.css reads --fx-layout-${t}`);
ok(!/@media[^{]*\((?:max|min)-width\s*:\s*\d/.test(css), 'axf.css has no px breakpoint (viewport attributes instead)');
for (const attr of LAYOUT_VIEWPORTS.map((v) => v.attr).slice(0, 3)) ok(css.includes(`:where([${attr}])`), `axf.css selects on ${attr}`);
const adopt = execFileSync('node', ['framework/cli/layout-adopt.mjs', 'framework/ui', 'framework/libs', 'framework/react', '--check'], { cwd: root, encoding: 'utf8' });
ok(/would move 0 media block/.test(adopt), `layout-adopt finds nothing left in the framework UI: ${adopt.trim().split('\n').pop()}`);
const { adoptLayoutSource } = await import('../cli/layout-adopt.mjs');
const sample = '@media (max-width: 640px) { .a, .b { color: var(--fx-text); } .c { gap: 0 } }\n@media (min-width: 761px) {\n  .d { display: none }\n}\n@media (max-width: 1500px) { .e { x: 1 } }';
const r = adoptLayoutSource(sample);
eq(r.out, ':where([data-fx-small]) .a, :where([data-fx-small]) .b { color: var(--fx-text); } :where([data-fx-small]) .c { gap: 0 }\n:where(:not([data-fx-narrow])) .d { display: none }\n@media (max-width: 1500px) { .e { x: 1 } }', 'codemod output');
eq(r.left.map((l) => l.px), [1500], 'a breakpoint above the largest cut-off is left and reported');
eq(adoptLayoutSource(r.out).changed, [], 'idempotent');

/* ---- check-theme knows the tokens ---- */
const out = execFileSync('node', ['framework/cli/check-theme.mjs', 'framework/spec/fixtures'], { cwd: root, encoding: 'utf8' });
ok(/tokens known/.test(out), 'check-theme runs');
const knownCount = Number(out.match(/(\d+) tokens known/)?.[1] ?? 0);
ok(knownCount > 0, 'check-theme counts tokens');

console.log(`✓ layout tokens — ${n} checks, ${layoutFieldNames().length} tokens, ${assets} layout assets`);
