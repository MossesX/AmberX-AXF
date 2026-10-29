/**
 * Plugin theme override, pure part (framework/libs/plugintheme/core.ts): storage shape, value checks, editing helpers, CSS.
 *
 *   npx -y tsx framework/spec/check-plugintheme.mts
 */
import {
  PLUGIN_LOOK_KEY, PLUGIN_THEME_GROUPS, PLUGIN_THEME_TOKENS, changedCount, groupState, lookJson, mergeTokens, normalizePluginLook, normalizeTokenValue,
  numberOf, numberValue, parseLookJson, pluginThemeCss, pluginThemeToken, resetTokens, searchTokens, setToken, storedLook, tokensFromThemes, tokensIn, validPluginId,
} from '../libs/plugintheme/core';

let ok = 0, fail = 0;
const check = (cond: unknown, msg: string) => { if (cond) ok++; else { fail++; console.log(`✗ ${msg}`); } };
const ID = 'ai.amberx.axf.console.todo-manager';

// registry
check(PLUGIN_LOOK_KEY(ID) === `axf.plugin.${ID}.look`, 'setting key');
for (const g of ['layout', 'colour', 'style', 'animation'] as const) check(tokensIn(g).length > 0, `group ${g} has tokens`);
check(PLUGIN_THEME_GROUPS.length === 4, 'four groups');
check(new Set(PLUGIN_THEME_TOKENS.map((t) => t.name)).size === PLUGIN_THEME_TOKENS.length, 'token names unique');
check(PLUGIN_THEME_TOKENS.every((t) => t.name.startsWith('--fx-')), 'every token is a theme variable');
for (const n of ['--fx-space', '--fx-accent', '--fx-radius-md', '--fx-motion', '--fx-ease', '--fx-opacity-glass']) check(!!pluginThemeToken(n), `${n} is in the registry`);
check(validPluginId(ID) && !validPluginId('a"]{x') && !validPluginId(''), 'plugin ids are checked');

// values
check(normalizeTokenValue('--fx-space', '12px') === '12px', 'length kept');
check(normalizeTokenValue('--fx-space', '99px') === '32px', 'length clamped');
check(normalizeTokenValue('--fx-space', '7.3px') === '7.5px', 'length snapped');
check(normalizeTokenValue('--fx-motion', '0.3s') === '300ms', 'seconds to ms');
check(normalizeTokenValue('--fx-accent', 'var(--fx-info)') === 'var(--fx-info)', 'colour reference kept');
check(normalizeTokenValue('--fx-accent', 'var(--fx-accent)') === undefined, 'self reference dropped');
check(normalizeTokenValue('--fx-accent', 'rgb(1, 2, 3)') === 'rgb(1, 2, 3)', 'rgb colour kept');
check(normalizeTokenValue('--fx-accent', 'red;}body{x:1') === undefined, 'injection dropped');
check(normalizeTokenValue('--fx-accent', 'url(x)') === undefined, 'url dropped');
check(normalizeTokenValue('--fx-nope', '1px') === undefined, 'unknown token dropped');
check(normalizeTokenValue('--fx-space', 'calc(var(--fx-space) * 2)') === 'calc(var(--fx-space) * 2)', 'calc kept');
check(numberOf('12px') === 12 && numberOf('x') === null, 'numberOf');
check(numberValue(pluginThemeToken('--fx-opacity-muted')!, 0.555) === '0.56', 'unitless number snapped');

// storage shape
const raw = { on: true, tokens: { '--fx-space': '10px', '--fx-accent': 'var(--fx-success)', '--fx-bogus': 'x', '--fx-radius-md': 'nope' }, extra: 1 };
const look = normalizePluginLook(raw);
check(look.on && Object.keys(look.tokens).join() === '--fx-space,--fx-accent', 'normalize keeps known, valid tokens');
check(normalizePluginLook(null).on === false && !Object.keys(normalizePluginLook('x').tokens).length, 'bad input = off, empty');
check(storedLook({ on: false, tokens: {} }) === null, 'nothing to keep = no setting');
check(storedLook(look)?.on === true, 'stored keeps on');

// editing
const a = setToken(look, '--fx-motion', '400ms');
check(a.tokens['--fx-motion'] === '400ms' && !look.tokens['--fx-motion'], 'setToken returns a copy');
check(!('--fx-space' in setToken(a, '--fx-space', null).tokens), 'setToken null resets');
check(changedCount(a) === 3 && changedCount(a, 'colour') === 1, 'changed counts');
check(groupState(a, 'colour') === 'some' && groupState(a, 'layout') === 'some' && groupState({ on: true, tokens: {} }, 'style') === 'none', 'tri-state some / none');
let all = { on: true, tokens: {} as Record<string, string> };
for (const t of tokensIn('animation')) all = setToken(all, t.name, t.kind === 'choice' ? t.options![0]!.value : numberValue(t, 100));
check(groupState(all, 'animation') === 'all', 'tri-state all');
check(changedCount(resetTokens(a, 'colour'), 'colour') === 0 && changedCount(resetTokens(a, 'colour')) === 2, 'reset a group');
check(changedCount(resetTokens(a)) === 0 && resetTokens(a).on, 'reset all keeps the switch');
check(mergeTokens(a, { '--fx-text': 'var(--fx-muted)' }).tokens['--fx-space'] === '10px', 'merge keeps');
check(Object.keys(mergeTokens(a, { '--fx-text': 'var(--fx-muted)' }, true).tokens).join() === '--fx-text', 'replace drops');
check(searchTokens('radius').length === 3 && searchTokens('').length === PLUGIN_THEME_TOKENS.length && searchTokens('--fx-motion').length === 1, 'search');

// JSON view
check(JSON.parse(lookJson(a)).tokens['--fx-motion'] === '400ms', 'json out');
const p = parseLookJson('{"on":true,"tokens":{"--fx-space":"9px","--fx-zzz":"1"}}');
check(p.look?.tokens['--fx-space'] === '9px' && p.dropped.join() === '--fx-zzz', 'json in, dropped listed');
check(parseLookJson('{"--fx-space":"9px"}').look?.on === true, 'bare token map accepted');
check(!!parseLookJson('{').error && !!parseLookJson('[]').error, 'bad json = error');

// copy from theme assets
const fromColour = tokensFromThemes({ scheme: 'dark', tokens: { bg: '#000000', surface: '#111111', surface2: '#222222', surface3: '#333333', text: '#eeeeee', muted: '#999999', border: '#444444', accent: '#ff8800', accentText: '#000000', accentSoft: 'rgba(255,136,0,0.14)', danger: '#ff0000', success: '#00ff00', warning: '#ffff00', info: '#0000ff', focus: '#ff8800', shadow: 'rgba(0,0,0,0.5)' } } as never); // theme-ok: test data
check(fromColour['--fx-accent'] === '#ff8800' && fromColour['--fx-accent-soft']?.startsWith('rgba('), 'colour theme copied'); // theme-ok: test data
const fromStyle = tokensFromThemes(null, { fontFamily: 'Inter, sans-serif', fontDisplay: 'Inter', fontMono: 'monospace', fontSize: 14, radius: { sm: 4, md: 8, lg: 12 }, space: 8, borderWidth: 1, shadow: { sm: 'none', md: 'none', lg: 'none' }, density: 'comfortable', motion: 160, blur: 12, headingWeight: 600, tracking: 0 } as never);
check(fromStyle['--fx-space'] === '8px' && fromStyle['--fx-motion'] === '160ms' && fromStyle['--fx-radius-md'] === '8px', 'style theme copied');

// CSS
check(pluginThemeCss({}) === '', 'nothing on = no css');
check(pluginThemeCss({ [ID]: { on: false, tokens: { '--fx-space': '4px' } } }) === '', 'off = no css');
check(pluginThemeCss({ [ID]: look }, { locked: true }) === '', 'locked look = no css');
const css = pluginThemeCss({ [ID]: { on: true, tokens: { '--fx-space': '4px', '--fx-text': 'var(--fx-muted)' } }, 'bad"]{': { on: true, tokens: { '--fx-space': '1px' } } });
check(css.includes(`[data-axf-plugin="${ID}"]{--fx-space:4px;--fx-text:var(--fx-muted);color:var(--fx-text)}`), 'scoped rule');
check(!css.includes('bad"'), 'bad id skipped');
check(css.includes('body{--axfpt-base-space:var(--fx-space)') && css.includes('[data-axf-plugin-editor]{--fx-space:var(--axfpt-base-space)'), 'editor gets the app values back');

console.log(`${fail ? '✗' : '✓'} plugin theme override: ${ok} passed, ${fail} failed`);
if (fail) process.exit(1);
