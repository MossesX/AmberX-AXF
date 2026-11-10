#!/usr/bin/env node
/** Search bar matcher self-test: node apps/console-web/plugins/search-bar/test.mjs */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  aiActive, applyRanking, categoryOf, flatten, groupHits, matchEntries, normOptions, parseValue, pathOf, pickValue, quickOptions, submenuSide,
} from './web/match.mjs';

const E = [
  { id: 'setting:axf.display.fontScale', kind: 'setting', label: 'Font size', detail: 'Settings › Appearance › Text', keywords: ['scale'], focus: {} },
  { id: 'setting:axf.display.dark', kind: 'setting', label: 'Dark mode', detail: 'Settings › Appearance › Colours', focus: {} },
  { id: 'settings-tab:appearance', kind: 'settings-tab', label: 'Appearance settings', detail: 'Settings', focus: {} },
  { id: 'plugin:todo-manager', kind: 'plugin', label: 'Todo manager', detail: 'Plugin · on', focus: {} },
  { id: 'view:home', kind: 'view', label: 'Home', detail: 'Page', focus: {} },
  { id: 'action:theme.toggle', kind: 'action', label: 'Toggle dark mode', detail: 'theme.toggle', focus: {} },
  { id: 'x:1', kind: 'mystery', label: 'Font foundry', focus: {} },
];

test('letter by letter: every prefix of a word matches, best first', () => {
  for (const q of ['f', 'fo', 'fon', 'font']) assert.equal(matchEntries(E, q, {}).hits[0].label.startsWith('Font'), true, q);
  assert.equal(matchEntries(E, 'dark', {}).hits.length, 2);
});

test('gear scope keeps settings only; globe searches everything', () => {
  assert.deepEqual(matchEntries(E, 'dark', {}, 'settings').hits.map((h) => h.id), ['setting:axf.display.dark']);
  assert.equal(matchEntries(E, 'dark', {}, 'everything').hits.length, 2);
});

test('regular expressions, exact and prefix modes, case', () => {
  assert.deepEqual(matchEntries(E, '^(home|todo)', { mode: 'regex' }).hits.map((h) => h.label).sort(), ['Home', 'Todo manager']);
  const bad = matchEntries(E, '([', { mode: 'regex' });
  assert.equal(bad.hits.length, 0);
  assert.ok(bad.error);
  assert.deepEqual(matchEntries(E, 'dark mode', { mode: 'exact' }).hits.map((h) => h.label), ['Dark mode', 'Toggle dark mode']);
  assert.equal(matchEntries(E, 'ark', { mode: 'prefix' }).hits.length, 0);
  assert.equal(matchEntries(E, 'ark', { mode: 'words' }).hits.length, 2);
  assert.equal(matchEntries(E, 'dark', { caseSensitive: true }).hits.map((h) => h.label).join(), 'Toggle dark mode');
  assert.equal(matchEntries(E, 'scale', { details: false }).hits.length, 0);
  assert.equal(matchEntries(E, 'scale', { details: true }).hits.length, 1);
});

test('categories in order, a tree from where each result lives', () => {
  const { hits } = matchEntries(E, 'o', {});
  const g = groupHits(hits, {});
  assert.deepEqual(g.map((x) => x.id), ['settings', 'plugins', 'pages', 'actions', 'other']);
  const settings = g[0];
  assert.equal(settings.root.children[0].label, 'Appearance');
  assert.ok(flatten(settings.root).some((h) => h.id === 'setting:axf.display.fontScale'));
  assert.deepEqual(pathOf({ detail: 'Settings › Appearance › Text' }, 'Settings'), ['Appearance', 'Text']);
  assert.deepEqual(pathOf({ detail: 'Page' }, 'Pages'), []);
  assert.equal(categoryOf('weird').id, 'other');
  assert.equal(groupHits(hits, { perCategory: 1 })[0].root.children.flatMap((c) => flatten(c)).length, 1);
});

test('quick options: toggle, choice, multi-choice; values parsed for the API', () => {
  assert.deepEqual(quickOptions({ kind: 'toggle' }, true).items.map((i) => [i.label, i.checked]), [['On', true], ['Off', false]]);
  const choice = { kind: 'choice', options: [{ value: 's', label: 'Small' }, { value: 'l', label: 'Large' }] };
  assert.equal(quickOptions(choice, 'l').items[1].checked, true);
  const multi = { kind: 'multi_choice', options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }] };
  assert.deepEqual(pickValue(multi, ['a'], { value: 'b' }), ['a', 'b']);
  assert.deepEqual(pickValue(multi, ['a', 'b'], { value: 'a' }), ['b']);
  assert.equal(quickOptions({ kind: 'text' }, 'x'), null);
  assert.equal(parseValue({ kind: 'toggle' }, 'on'), true);
  assert.equal(parseValue({ kind: 'toggle' }, 'maybe'), undefined);
  assert.equal(parseValue(choice, 'large'), 'l');
  assert.deepEqual(parseValue(multi, 'a,B'), ['a', 'b']);
});

test('sub-menu opens right when it fits, else left', () => {
  assert.equal(submenuSide(500, 300, 200, 1200), 'right');
  assert.equal(submenuSide(1100, 900, 200, 1200), 'left');
});

test('AI only with Ollama AND the capability AND the switch; ranking reorders', () => {
  assert.equal(aiActive({ ollama: true, capability: true, enabled: true }), true);
  assert.equal(aiActive({ ollama: false, capability: true, enabled: true }), false);
  assert.equal(aiActive({ ollama: true, capability: true, enabled: false }), false);
  assert.deepEqual(applyRanking([{ id: 'a' }, { id: 'b' }, { id: 'c' }], ['c', 'zz']).map((x) => x.id), ['c', 'a', 'b']);
  assert.equal(normOptions({ mode: 'nope', perCategory: 9999 }).perCategory, 100);
});
