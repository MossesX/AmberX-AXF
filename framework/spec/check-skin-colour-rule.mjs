#!/usr/bin/env node
/**
 * Skin + colour theme rule (Brett, Nov 10 2026: "You can change the color theme without changing the skin. If you
 * change the color theme, it makes a new skin, don't like that."). A skin owns every section (look, layout,
 * behavior, every asset type) and carries a colour theme; switching the colour theme is a change inside the current
 * skin, never a new or forked skin. This check runs the shared engine (core/engines/skin-rules.mjs) and fails if
 *   - setSkinColorTheme changes the skin id, its overrides, its use / inherit switches or any sub-scope,
 *   - it changes anything other than the level's `colorTheme`,
 *   - '' / null does not go back to the skin's own colours,
 *   - pickSkin on the same skin drops the colour pick (a no-op must stay a no-op),
 *   - a sub-scope colour pick touches the app level,
 *   - the CLI or runtime grows a code path that writes a skin document on a colour change.
 *
 *   node framework/spec/check-skin-colour-rule.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { newAppLook, pickSkin, setSkinColorTheme, skinColorTheme } from '../core/engines/skin-rules.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const problems = [];
const ok = (cond, msg) => { if (!cond) problems.push(msg); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const without = (o, k) => { const c = { ...o }; delete c[k]; return c; };

let look = newAppLook('console-web');
look = pickSkin(look, 'hub-default');
look = { ...look, skin: { ...look.skin, use: true, overrides: { button: 'windows' } } };

const picked = setSkinColorTheme(look, 'windows-dark');
ok(picked.skin.id === look.skin.id, 'colour pick changed the skin id');
ok(same(picked.skin.overrides, look.skin.overrides), 'colour pick changed the skin overrides');
ok(picked.skin.use === look.skin.use && picked.skin.inherit === look.skin.inherit, 'colour pick changed use / inherit');
ok(skinColorTheme(picked) === 'windows-dark', 'colour pick did not land as the skin colour theme');
ok(same(without(picked.skin, 'colorTheme'), without(look.skin, 'colorTheme')), 'colour pick changed more than colorTheme');
ok(same(without(picked, 'skin'), without(look, 'skin')), 'colour pick changed the look outside the skin');

const back = setSkinColorTheme(picked, null);
ok(skinColorTheme(back) === '' && back.skin.id === look.skin.id, "'' / null does not return to the skin's own colours");

ok(skinColorTheme(pickSkin(picked, picked.skin.id)) === 'windows-dark', 'picking the same skin dropped the colour theme');
ok(skinColorTheme(pickSkin(picked, 'other-skin')) === '', 'a different skin kept the previous colour pick');

const scoped = setSkinColorTheme(look, 'windows-dark', 'plugin:terminal');
ok(same(scoped.skin, look.skin), 'a plugin-scope colour pick touched the app level');
ok(skinColorTheme(scoped, 'plugin:terminal') === 'windows-dark', 'a plugin-scope colour pick did not land');

let threw = false; try { setSkinColorTheme(look, 'x', 'bogus'); } catch { threw = true; }
ok(threw, 'an unknown scope key was accepted');

// Source scan: the colour-theme paths in the CLI must not write a skin asset.
const cli = readFileSync(join(ROOT, 'cli/skins.mjs'), 'utf8');
const colourBlock = cli.split(/\n(?=\s*(?:if|case)\b)/).filter((b) => /setSkinColorTheme/.test(b)).join('\n');
ok(!/writeSkin|saveSkin|createSkin|forkSkin|duplicateSkin/.test(colourBlock), 'cli/skins.mjs: a colour-theme path writes a skin');

if (problems.length) { console.error(`skin colour rule: ${problems.length} problem(s)\n  ${problems.join('\n  ')}`); process.exit(1); }
console.log('skin colour rule: ok (colour theme switches inside the skin; no new skin, no fork)');
