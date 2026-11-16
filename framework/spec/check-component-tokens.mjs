#!/usr/bin/env node
/**
 * component-tokens@1 (build own-token-sets-for-grids-and-tab-groups, Nov 13 2026): the grid and tab-group token families.
 * Fails when
 *   - the schema is not well formed: a token without kind / level / description, a duplicate variable, an unknown kind or
 *     level, a default that is not itself a token reference, a keyword or a plain length (a default that pointed at a
 *     literal colour would change a skin's look);
 *   - the :root block in framework/ui/axf.css differs from the schema (node framework/cli/component-tokens.mjs write);
 *   - a grid / tab rule in axf.css or lib-datagrid reads a general colour token (--fx-surface2, --fx-accent, --fx-border, …)
 *     or a literal colour / shadow where a family token belongs: colours, backgrounds, borders, outlines and box-shadows
 *     in rules whose selector names .fx-tabs, .fx-tab, .fx-tabgroup__bar, [data-fx-tabs…], .fx-table or .axf-grid must
 *     read --fx-grid-* / --fx-tab-* (status colours on the row-tone edge and the panel / settings transparency tokens are
 *     the declared exceptions);
 *   - the engine's compile, validation and per-instance rules (set, previous, restore, hub, caps) stop matching the fixture
 *     spec/fixtures/component-tokens.json or these expectations;
 *   - control@1 tokens.style does not list every token path (with its variable, level and description) or accepts a bad value,
 *     or tokens.instances stops taking <family>.<instance>[.<token>];
 *   - the style-theme registry (schemas/asset-types.json) or the TS type stops naming the two optional maps.
 *
 *   node framework/spec/check-component-tokens.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  COMPONENT_TOKEN_FAMILIES, COMPONENT_TOKEN_KINDS, COMPONENT_TOKEN_LEVELS, INSTANCE_TOKENS_KEY, componentToken, componentTokenDefaults, componentTokenError, componentTokenFields, componentTokenList,
  componentTokenPaths, componentTokenValue, componentTokenVar, componentTokenVars, instanceHasPrevious, instanceTokenList, instanceTokenVars, normalizeInstanceTokens, parseInstanceTokenPath,
  restoreInstanceTokensFromHub, restorePreviousInstanceTokens, setInstanceToken,
} from '../core/engines/component-tokens.mjs';
import { INSTANCE_TOKENS_TARGET, controlErrors, controlPathKnown, controlPaths, controlValueErrors } from '../core/engines/control-rules.mjs';
import { blockIn, componentTokensCss } from '../cli/component-tokens.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const problems = [];
const ok = (c, msg) => { if (!c) problems.push(msg); };
const eq = (a, b, msg) => { if (JSON.stringify(a) !== JSON.stringify(b)) problems.push(`${msg}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); };

/* ---- schema ---- */
const list = componentTokenList();
ok(list.length >= 80, `at least 80 tokens across the families (${list.length})`);
const vars = list.map((x) => x.var);
eq(vars.length, new Set(vars).size, 'every token has its own variable');
const DEFAULT_OK = /^(var\(--fx-[a-z0-9-]+\)|transparent|currentColor|inherit|auto|none|0|1|600|2px|999px|color-mix\(in srgb, var\(--fx-[a-z0-9-]+\) calc\(var\(--fx-opacity-[a-z]+\) \* 100%\), transparent\))$/;
for (const x of list) {
  ok(COMPONENT_TOKEN_KINDS.includes(x.kind), `${x.path}: known kind (${x.kind})`);
  ok(COMPONENT_TOKEN_LEVELS.includes(x.level), `${x.path}: known level (${x.level})`);
  ok(typeof x.description === 'string' && x.description.length >= 12, `${x.path}: a plain-English description`);
  ok(DEFAULT_OK.test(x.default), `${x.path}: default points at a general token, a keyword or a shape (${x.default}), never a literal colour`);
  ok(x.var === componentTokenVar(x.family, x.key) && x.var.startsWith(COMPONENT_TOKEN_FAMILIES[x.family].prefix), `${x.path}: variable from the family prefix`);
  ok(componentToken(x.family, x.key) !== null, `${x.path}: looked up by family + key`);
}
ok(!vars.includes('--fx-tab-py') && !vars.includes('--fx-tab-px') && !vars.includes('--fx-tabs-per-row'), 'no clash with the tab-group engine\'s own vars');
// what Brett asked for (s3 / s4 lists), by name
for (const k of ['headerBg', 'headerText', 'headerBorder', 'sortArrow', 'rowBg', 'rowAltBg', 'hoverBg', 'selectedBg', 'focusRing', 'expandedBg', 'disabledOpacity', 'lineColor', 'outerBorder', 'cellPadY', 'cellPadX', 'rowHeight', 'radius', 'groupHeaderBg', 'stickyShadow', 'emptyText', 'opacity']) ok(componentToken('grid', k), `grid token ${k}`);
for (const k of ['barBg', 'barBorder', 'text', 'bg', 'border', 'hoverText', 'hoverBg', 'activeText', 'activeBg', 'pressedText', 'pressedBg', 'disabledText', 'focusRing', 'indicator', 'indicatorSize', 'badgeBg', 'badgeText', 'foldBg', 'gap', 'radiusUnderline', 'radiusPills', 'radiusBoxed', 'radiusSegmented', 'radiusPlain', 'radiusChips', 'opacity']) ok(componentToken('tabs', k), `tabs token ${k}`);
eq(componentToken('grid', 'opacity').default, '1', 'grid transparency defaults to 100%');
eq(componentToken('tabs', 'opacity').default, '1', 'tab transparency defaults to 100%');

/* ---- :root block ---- */
const css = readFileSync(join(ROOT, 'ui/axf.css'), 'utf8');
eq(blockIn(css), componentTokensCss(), 'axf.css :root carries exactly the schema\'s defaults (node framework/cli/component-tokens.mjs write)');
for (const [v, d] of Object.entries(componentTokenDefaults())) ok(css.includes(`${v}: ${d};`), `axf.css defines ${v}: ${d}`);

/* ---- grid / tab rules read only family tokens ---- */
const GRID_SEL = /\.fx-table\b|\.fx-tablewrap\b|\.axf-grid/;
const TAB_SEL = /\.fx-tabs\b|\.fx-tab\b|\.fx-tabgroup__bar|\[data-fx-tabs/;
const COLOUR_PROPS = /(?:^|;|\{)\s*(color|background(?:-color)?|border(?:-[a-z]+)?(?:-color)?|outline(?:-color)?|box-shadow)\s*:\s*([^;}]+)/g;
const GENERAL = /var\(--fx-(?!grid-|tab-|border-w\b|opacity-(?:panel|settings|disabled|muted|tint)\b|space\b|dens-|size-|radius-|shadow-|type-)[a-z0-9-]+\)/;
const STATUS_EDGE = /--axf-grid-edge: var\(--fx-(success|accent|danger|warning|info)\)/;
const LITERAL = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\(|\b(?:white|black|red|green|blue|gray|grey|orange|yellow)\b/;
function ruleFindings(file, sel) {
  const text = readFileSync(join(ROOT, file), 'utf8');
  const out = [];
  text.split('\n').forEach((line, i) => {
    if (line.includes('component-tokens@1 begin') || /^\s*(\/\*|\*|--fx-)/.test(line)) return;
    for (const rule of line.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
      const selector = rule[1].trim();
      if (!sel.test(selector) || selector.startsWith('/*')) continue;
      for (const m of rule[2].matchAll(COLOUR_PROPS)) {
        const value = m[2].trim();
        if (STATUS_EDGE.test(rule[2]) && m[1] === 'box-shadow') continue;
        if (GENERAL.test(value)) out.push(`${file}:${i + 1} ${selector} { ${m[1]}: ${value} } reads a general token; use a --fx-grid-* / --fx-tab-* token`);
        if (LITERAL.test(value)) out.push(`${file}:${i + 1} ${selector} { ${m[1]}: ${value} } is a literal colour`);
      }
    }
  });
  return out;
}
for (const f of [...ruleFindings('ui/axf.css', GRID_SEL), ...ruleFindings('ui/axf.css', TAB_SEL), ...ruleFindings('libs/datagrid/datagrid.css', GRID_SEL)]) problems.push(f);
// the status colours of the row-tone edge are the one declared exception in lib-datagrid
ok(readFileSync(join(ROOT, 'libs/datagrid/datagrid.css'), 'utf8').includes('--axf-grid-edge: var(--fx-grid-line-color)'), 'the muted row-tone edge reads the grid line token');

/* ---- values ---- */
eq(componentTokenValue('colour', 'accentSoft'), 'var(--fx-accent-soft)', 'a camelCase colour-theme token name');
eq(componentTokenValue('colour', 'accent-soft'), 'var(--fx-accent-soft)', 'a kebab token name');
eq(componentTokenValue('colour', '#ff8800'), '#ff8800', 'a hex colour');
eq(componentTokenValue('colour', 'rgb(1 2 3 / 50%)'), 'rgb(1 2 3 / 50%)', 'an rgb() colour');
eq(componentTokenValue('colour', 'transparent'), 'transparent', 'transparent');
eq(componentTokenValue('colour', 'red;}body{display:none'), null, 'no CSS injection');
eq(componentTokenValue('colour', 'url(x)'), null, 'no url()');
eq(componentTokenValue('length', 8), '8px', 'a number is px');
eq(componentTokenValue('length', 'radius.sm'), 'var(--fx-radius-sm)', 'a nested style token');
eq(componentTokenValue('length', 'dens-gap-md'), 'var(--fx-dens-gap-md)', 'a scale token');
eq(componentTokenValue('length', '0.5em'), '0.5em', 'an em length');
eq(componentTokenValue('length', 'auto'), 'auto', 'auto');
eq(componentTokenValue('length', 'big'), null, 'not a length');
eq(componentTokenValue('shadow', 'shadow.md'), 'var(--fx-shadow-md)', 'a shadow token');
eq(componentTokenValue('shadow', 'none'), 'none', 'no shadow');
eq(componentTokenValue('opacity', 1.4), '1', 'opacity clamps to 1');
eq(componentTokenValue('opacity', '0.5'), '0.5', 'opacity as text');
eq(componentTokenValue('opacity', 'x'), null, 'opacity wants a number');
eq(componentTokenValue('number', 700), '700', 'a weight');
ok(componentTokenError('grid', 'hoverBg', 'nope nope') !== null && componentTokenError('grid', 'hoverBg', 'accent') === null, 'componentTokenError explains a bad colour and passes a good one');
ok(componentTokenError('grid', 'bogus', 'x').includes('no token'), 'an unknown token is named');

/* ---- the style theme ---- */
eq(componentTokenVars(null), {}, 'no theme = nothing');
eq(componentTokenVars({ fontSize: 14 }), {}, 'a theme without the maps = nothing (the :root defaults stand)');
eq(componentTokenVars({ grid: { hoverBg: 'accentSoft', headerText: 'text', bogus: 'x', radius: 6 }, tabs: { indicator: '#f5a524', opacity: 0.8, activeText: 7 } }),
  { '--fx-grid-header-text': 'var(--fx-text)', '--fx-grid-hover-bg': 'var(--fx-accent-soft)', '--fx-grid-radius': '6px', '--fx-tab-indicator': '#f5a524', '--fx-tab-opacity': '0.8' },
  'only named tokens, only accepted values (a number is no colour), in schema order');
const fields = componentTokenFields();
eq(fields['grid.hoverBg'], 'string', 'colour fields are strings for control@1');
eq(fields['grid.opacity'], 'number', 'opacity fields are numbers');
eq(Object.keys(fields).length, list.length, 'one style field per token');

/* ---- control@1 ---- */
const stylePaths = controlPaths('tokens.style');
for (const x of list) {
  const p = stylePaths.find((p) => p.id === x.path);
  ok(p && p.token === x.var && p.level === x.level && p.description === x.description && p.default === x.default, `tokens.style lists ${x.path} with its variable, level and description`);
}
eq(controlValueErrors('tokens.style', 'grid.hoverBg', 'accentSoft'), [], 'tokens.style set grid.hoverBg accentSoft');
ok(controlValueErrors('tokens.style', 'grid.hoverBg', 'nope nope')[0].includes('grid.hoverBg wants'), 'tokens.style refuses a bad colour by name');
eq(controlValueErrors('tokens.style', 'tabs.opacity', 0.5), [], 'tokens.style set tabs.opacity 0.5');
ok(controlValueErrors('tokens.style', 'tabs.opacity', 'x').length === 1, 'tokens.style refuses a non-number opacity');
eq(controlValueErrors('tokens.style', 'radius.md', 8), [], 'the older style fields still validate');
eq(controlPathKnown(INSTANCE_TOKENS_TARGET, 'tabs.settings.main.activeText'), true, 'tokens.instances path with a token');
eq(controlPathKnown(INSTANCE_TOKENS_TARGET, 'grid.ui-review.items'), true, 'tokens.instances path = a whole instance');
eq(controlPathKnown(INSTANCE_TOKENS_TARGET, 'nav.x.y'), false, 'tokens.instances refuses an unknown family');
eq(controlErrors({ op: 'set', target: INSTANCE_TOKENS_TARGET, path: 'tabs.settings.main.activeText', value: 'accent' }), [], 'a good per-instance set');
ok(controlErrors({ op: 'set', target: INSTANCE_TOKENS_TARGET, path: 'tabs.settings.main', value: 'accent' })[0].includes('needs a token'), 'a set on a whole instance names the missing token');
eq(controlErrors({ op: 'act', target: INSTANCE_TOKENS_TARGET, path: 'tabs.settings.main', action: 'restore-previous' }), [], 'restore-previous is an act');
eq(controlErrors({ op: 'act', target: INSTANCE_TOKENS_TARGET, path: 'tabs.settings.main', action: 'restore-hub' }), [], 'restore-hub is an act');
eq(controlErrors({ op: 'reset', target: INSTANCE_TOKENS_TARGET, path: 'tabs.settings.main' }), [], 'reset a whole instance');
eq(parseInstanceTokenPath('tabs.settings.main.activeText'), { family: 'tabs', instance: 'settings.main', key: 'activeText' }, 'path parsing keeps dots in the instance id');
eq(parseInstanceTokenPath('grid.builds'), { family: 'grid', instance: 'builds', key: null }, 'a whole-instance path');

/* ---- per-instance rules ---- */
eq(INSTANCE_TOKENS_KEY, 'axf.tokens.instances', 'one axf.tokens.* key (rides the axHub look)');
let saved = {};
saved = setInstanceToken(saved, 'tabs', 'settings.main', 'activeText', 'accent');
eq(saved, { 'tabs.settings.main': { values: { activeText: 'accent' }, previous: {} } }, 'first edit: value + empty previous');
saved = setInstanceToken(saved, 'tabs', 'settings.main', 'indicator', '#ff0000');
eq(saved['tabs.settings.main'], { values: { activeText: 'accent', indicator: '#ff0000' }, previous: { activeText: 'accent' } }, 'second edit remembers the values before it');
eq(instanceTokenVars(saved, 'tabs', 'settings.main'), { '--fx-tab-active-text': 'var(--fx-accent)', '--fx-tab-indicator': '#ff0000' }, 'inline-style vars for the instance');
eq(instanceTokenVars(saved, 'tabs', 'other'), {}, 'another instance has none');
eq(instanceTokenVars(saved, 'grid', 'settings.main'), {}, 'another family has none');
ok(instanceHasPrevious(saved, 'tabs', 'settings.main'), 'has a previous edit');
const restored = restorePreviousInstanceTokens(saved, 'tabs', 'settings.main');
eq(restored['tabs.settings.main'], { values: { activeText: 'accent' }, previous: { activeText: 'accent', indicator: '#ff0000' } }, 'Restore previous edit swaps back');
eq(restorePreviousInstanceTokens(restored, 'tabs', 'settings.main'), saved, 'a second Restore previous edit redoes');
eq(restoreInstanceTokensFromHub(saved, 'tabs', 'settings.main'), {}, 'Restore from axHub drops the instance (values and history)');
eq(restoreInstanceTokensFromHub(saved, 'grid', 'nope'), saved, 'restoring an unknown instance changes nothing');
eq(setInstanceToken(saved, 'tabs', 'settings.main', 'indicator', null)['tabs.settings.main'].values, { activeText: 'accent' }, 'null drops one token');
eq(setInstanceToken(saved, 'tabs', 'settings.main', 'indicator', '#ff0000'), saved, 'setting the same value again changes nothing');
let threw = '';
try { setInstanceToken(saved, 'tabs', 'settings.main', 'activeText', 'not a colour at all'); } catch (e) { threw = e.message; }
ok(threw.includes('tabs.activeText wants'), 'a bad value throws with the kind\'s wording');
threw = '';
try { setInstanceToken(saved, 'tabs', 'settings.main', 'nope', 'accent'); } catch (e) { threw = e.message; }
ok(threw.includes('no token'), 'an unknown token throws');
threw = '';
try { setInstanceToken(saved, 'nav', 'x', 'activeText', 'accent'); } catch (e) { threw = e.message; }
ok(threw.includes('unknown family'), 'an unknown family throws');
eq(normalizeInstanceTokens({ 'tabs.a': { values: { activeText: 'accent', bogus: 1, indicator: 'x;y' } }, 'nav.a': { values: { x: 1 } }, 'tabs.Bad Id': { values: { activeText: 'accent' } }, junk: 1 }), { 'tabs.a': { values: { activeText: 'accent' } } }, 'normalize drops unknown families, bad ids, unknown tokens and bad values');
eq(instanceTokenList(saved), [{ id: 'tabs.settings.main', family: 'tabs', instance: 'settings.main', values: { activeText: 'accent', indicator: '#ff0000' }, hasPrevious: true }], 'the list of instances with edits');
threw = '';
try { let big = {}; for (let i = 0; i < 400; i++) big = setInstanceToken(big, 'grid', `grid-${i}`, 'hoverBg', 'accentSoft'); } catch (e) { threw = e.message; }
ok(threw.includes('exceed'), 'the setting cap is enforced by name');

/* ---- registry + type ---- */
const spec = JSON.parse(readFileSync(join(ROOT, 'schemas/asset-types.json'), 'utf8'));
ok(typeof spec.types['style-theme'].optional_fields.grid === 'string' && typeof spec.types['style-theme'].optional_fields.tabs === 'string', 'asset-types.json documents grid and tabs on the style theme');
const types = readFileSync(join(ROOT, 'core/types.ts'), 'utf8');
ok(/grid\?: Record<string, string \| number>;/.test(types) && /tabs\?: Record<string, string \| number>;/.test(types), 'StyleThemeData carries the two optional maps');
const theme = readFileSync(join(ROOT, 'core/engines/theme.ts'), 'utf8');
ok(theme.includes('...componentTokenVars(s)'), 'styleThemeVars spreads the component tokens');
for (const f of ['react/components/TabGroup.tsx', 'libs/datagrid/index.tsx']) ok(readFileSync(join(ROOT, f), 'utf8').includes('instanceTokenVars('), `${f} applies its instance's tokens`);

/* ---- fixture ---- */
const fixture = JSON.parse(readFileSync(join(ROOT, 'spec/fixtures/component-tokens.json'), 'utf8'));
eq(fixture.defaults, componentTokenDefaults(), 'fixture defaults = schema (npx -y tsx framework/spec/gen-fixtures.mts)');
eq(fixture.paths, componentTokenPaths(), 'fixture paths = schema');
for (const [name, c] of Object.entries(fixture.themeCases)) eq(componentTokenVars(c.style), c.vars, `fixture theme case ${name}`);
for (const [name, c] of Object.entries(fixture.instanceCases)) eq(c.saved, c.replay, `fixture instance case ${name}`);

if (problems.length) { console.error(`component tokens: ${problems.length} problem(s)\n  ${problems.join('\n  ')}`); process.exit(1); }
console.log(`component tokens: ok (${list.length} tokens: ${list.filter((x) => x.family === 'grid').length} grid, ${list.filter((x) => x.family === 'tabs').length} tabs)`);
