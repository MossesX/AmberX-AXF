#!/usr/bin/env node
/**
 * skin-modes@1 (build every-skin-ships-a-light-and-a-dark-colour-theme, Brett: "Yo, every skin needs a light and dark.").
 * Fails if any shipped skin (framework/assets/skin, so every future skin too) lacks a light or a dark colour theme
 * (`data.colorThemes.light` / `.dark`), names one that does not ship or has the wrong `scheme`, or has an own
 * `colorTheme` that is neither of the two. Also replays the pure engine on fixed cases.
 *
 *   node framework/spec/check-skin-modes.mjs
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { effectiveScheme, skinModeColor, skinModeProblems, skinSchemeOf } from '../core/engines/skin-modes.mjs';

const ASSETS = resolve(dirname(fileURLToPath(import.meta.url)), '../assets');
const read = (type) => readdirSync(join(ASSETS, type)).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(join(ASSETS, type, f), 'utf8')));
const fails = [];
const eq = (name, got, want) => { if (JSON.stringify(got) !== JSON.stringify(want)) fails.push(`${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); };

// engine cases
const themes = [{ id: 'a-day', data: { scheme: 'light' } }, { id: 'a-night', data: { scheme: 'dark' } }];
const skin = { id: 's', data: { colorTheme: 'a-day', colorThemes: { light: 'a-day', dark: 'a-night' } } };
eq('pair ok', skinModeProblems([skin], themes), []);
eq('missing dark', skinModeProblems([{ id: 'x', data: { colorTheme: 'a-day', colorThemes: { light: 'a-day' } } }], themes), ['x: no dark colour theme (data.colorThemes.dark)']);
eq('missing both', skinModeProblems([{ id: 'x', data: { colorTheme: 'a-day' } }], themes).length, 2);
eq('wrong scheme', skinModeProblems([{ id: 'x', data: { colorTheme: 'a-day', colorThemes: { light: 'a-day', dark: 'a-day' } } }], themes), ['x: dark colour theme "a-day" is a light theme']);
eq('not shipped', skinModeProblems([{ id: 'x', data: { colorTheme: 'a-day', colorThemes: { light: 'a-day', dark: 'gone' } } }], themes), ['x: dark colour theme "gone" does not ship']);
eq('own outside pair', skinModeProblems([{ id: 'x', data: { colorTheme: 'other', colorThemes: { light: 'a-day', dark: 'a-night' } } }], themes), ['x: its colorTheme "other" is neither its light nor its dark theme']);
eq('dark pick', skinModeColor(skin, 'dark'), { scheme: 'dark', theme: 'a-night', pick: 'a-night' });
eq('light = own, no pick', skinModeColor(skin, 'light'), { scheme: 'light', theme: 'a-day', pick: '' });
eq('system dark', skinModeColor(skin, 'system', true).theme, 'a-night');
eq('system unknown = light', effectiveScheme('system'), 'light');
eq('scheme of', [skinSchemeOf(skin, 'a-night'), skinSchemeOf(skin, 'zzz')], ['dark', '']);
try { skinModeColor(skin, 'dusk'); fails.push('bad mode accepted'); } catch { /* expected */ }

// every shipped skin
const skins = read('skin');
const problems = skinModeProblems(skins, read('color-theme'));
if (fails.length || problems.length) {
  console.error(`skin modes: ${fails.length + problems.length} problem(s)\n  ${[...fails, ...problems].join('\n  ')}`);
  process.exit(1);
}
console.log(`skin modes: ok (${skins.length} skins, each with a light and a dark colour theme)`);
