#!/usr/bin/env node
/**
 * toolbar-owner@1 (core/engines/toolbar-owner-rules.mjs; build every-plugin-gets-own-default-toolbar, Nov 18 2026):
 * replays spec/fixtures/toolbar-owner.json through the reference rules (the Kotlin twin is deferred, spec/PORTING.md)
 * and checks the repo (framework/cli/toolbar-owner.mjs check): every console plugin ships its default-<plugin>-toolbar,
 * every toolbar is generic or built for one screen, a screen's picker lists only generic toolbars plus its own, and
 * a pick or an override changes the look only, never the buttons.
 *   node framework/spec/check-toolbar-owner.mjs           check
 *   node framework/spec/check-toolbar-owner.mjs --write   regenerate the fixture's expected outputs
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as to from '../core/engines/toolbar-owner-rules.mjs';
import { check as repoCheck } from '../cli/toolbar-owner.mjs';

const root = new URL('../', import.meta.url).pathname;
const FIXTURE = join(root, 'spec/fixtures/toolbar-owner.json');
const BUTTONS = [{ id: 'g', items: [{ id: 'land', icon: 'rocket', label: 'Land', action: 'command:gate/land' }] }];
const ASSETS = [
  { id: 'default-gate-toolbar', name: 'Gate', data: { scope: 'view:gate', builtFor: 'plugin:gate', variant: 'icons-labels', align: 'start', showSearch: false, groups: BUTTONS } },
  { id: 'gate-dense', name: 'Gate dense', data: { scope: 'view:gate', builtFor: 'view:gate', variant: 'icons', density: 'compact', align: 'start', showSearch: false, groups: [] } },
  { id: 'gate-auto-lander', name: 'Lander', data: { scope: 'view:gate', slot: 'auto-lander', variant: 'icons', align: 'start', showSearch: false, groups: [] } },
  { id: 'default-notes-toolbar', name: 'Notes toolbar (default)', tags: ['default', 'placeholder'], data: { scope: 'plugin:notes', builtFor: 'plugin:notes', variant: 'icons-labels', align: 'start', showSearch: false, groups: [] } },
  { id: 'standard-icons', name: 'Standard icons', data: { variant: 'icons', align: 'spread', surface: 'glass', showSearch: true, groups: [{ id: 'x', items: [{ id: 'home', icon: 'home', label: 'Home', action: 'nav:home' }] }] } },
  { id: 'minimal-glass', name: 'Minimal glass', data: { builtFor: 'generic', variant: 'labels', align: 'center', surface: 'glass', divider: false, showSearch: false, groups: [] } },
  { id: 'builds-only', name: 'Builds only', data: { scope: 'view:builds', variant: 'icons', align: 'start', showSearch: false, groups: [] } },
];
const PAGES = {
  gate: { view: 'gate', plugin: 'ai.amberx.axf.console.gate' },
  'gate lander slot': { view: 'gate', plugin: 'gate', slot: 'auto-lander' },
  'notes (placeholder default)': { view: 'notes-page', plugin: 'notes' },
  builds: { view: 'builds' },
  unknown: { view: 'nowhere' },
};

function outputs() {
  const out = {};
  out.parse = Object.fromEntries(['generic', 'view:gate', 'plugin:gate', 'plugin:Bad Name', 'screen:gate', '', 'app', 42].map((v) => [String(v), to.parseToolbarBuiltFor(v)]));
  out.errors = Object.fromEntries(['generic', 'view:gate', 'nope', undefined].map((v) => [String(v), to.toolbarBuiltForErrors(v)]));
  out.defaultIds = Object.fromEntries(['gate', 'ai.amberx.axf.console.plan-studio', 'Bad Name!', ''].map((p) => [p, to.pluginToolbarDefaultId(p)]));
  out.builtForOf = Object.fromEntries(ASSETS.map((a) => [a.id, to.toolbarBuiltForOf(a)]));
  out.ownToolbar = Object.fromEntries(Object.entries(PAGES).map(([n, p]) => [n, to.pageDefaultToolbar(p, ASSETS)?.id ?? null]));
  out.choices = Object.fromEntries(Object.entries(PAGES).map(([n, p]) => [n, to.toolbarChoices(p, ASSETS).map((c) => `${c.isDefault ? '*' : ''}${c.generic ? 'g' : 's'}:${c.id}`)]));
  const picks = { none: undefined, generic: 'minimal-glass', 'same screen': 'gate-dense', 'other screen': 'builds-only', gone: 'nope', 'own id': 'default-gate-toolbar' };
  out.pick = Object.fromEntries(Object.entries(picks).map(([n, v]) => [n, to.toolbarPick(v, PAGES.gate, ASSETS)]));
  out.pickSet = Object.fromEntries(['default', '', 'minimal-glass', 'builds-only', 'default-gate-toolbar'].map((w) => [w || '(empty)', to.toolbarPickSet(PAGES.gate, w, ASSETS)]));
  out.layer = to.layerToolbarLook(ASSETS[0].data, ASSETS[5].data);
  out.overrideOnly = to.toolbarOverrideOnly({ variant: 'icons', groups: [], widgets: [], showSearch: true, tapConfirm: 'off', scope: 'view:x' });
  out.placeholder = Object.fromEntries(ASSETS.map((a) => [a.id, to.isPlaceholderToolbar(a)]));
  out.generated = to.pluginToolbarDefaultAsset('sample-notes', { label: 'Sample notes' });
  return out;
}

const write = process.argv.includes('--write');
const got = outputs();
if (write) {
  writeFileSync(FIXTURE, `${JSON.stringify({ $comment: 'toolbar-owner@1 golden outputs (framework/spec/check-toolbar-owner.mjs --write); the Kotlin twin is deferred (spec/PORTING.md).', contract: to.TOOLBAR_OWNER_CONTRACT, lookKeys: to.TOOLBAR_LOOK_KEYS, overrideKeys: to.TOOLBAR_OVERRIDE_KEYS, outputs: got }, null, 2)}\n`);
  console.log(`wrote ${FIXTURE}`);
}
let n = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };
const fx = existsSync(FIXTURE) ? JSON.parse(readFileSync(FIXTURE, 'utf8')) : null;
assert.ok(fx, 'spec/fixtures/toolbar-owner.json exists (--write)');
for (const k of Object.keys(got)) eq(got[k], fx.outputs[k], `fixture section "${k}" matches the engine (--write after an engine change)`);
// the rules in plain words
eq(got.ownToolbar.gate, 'default-gate-toolbar', 'a plugin default wins over another toolbar with the same scope');
eq(got.ownToolbar['notes (placeholder default)'], 'default-notes-toolbar', 'a plugin with no page toolbar gets its default');
eq(got.choices.gate.includes('s:builds-only'), false, 'a toolbar built for another screen is never offered');
eq(got.choices.gate.filter((c) => c.startsWith('g:')).length, 2, 'every generic toolbar is offered');
eq(got.pick.generic.locked, false, 'a generic pick unlocks');
eq(got.pick['other screen'].locked, true, 'a pick built for another screen falls back to the default');
eq(got.pick.none.locked, true, 'no pick = the locked default');
eq(got.layer.groups, BUTTONS, 'a pick never changes the buttons');
eq(got.layer.variant, 'labels', 'a pick lends its look');
eq('groups' in got.overrideOnly || 'widgets' in got.overrideOnly || 'scope' in got.overrideOnly, false, 'an override never changes buttons, widgets or placement');
const problems = repoCheck();
if (problems.length) { console.error(`✗ toolbar-owner@1 repo check:\n${problems.join('\n')}`); process.exit(1); }
console.log(`✓ toolbar-owner@1: ${n} checks, repo check ok`);
