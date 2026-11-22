#!/usr/bin/env node
/**
 * app-menus@1 (core/engines/app-menus-rules.mjs; build every-app-gets-own-locked-default, Nov 18 2026): replays
 * spec/fixtures/app-menus.json through the reference rules (the Kotlin twin is deferred, spec/PORTING.md) and checks
 * the repo (framework/cli/app-menus.mjs check, the CI guard): every app ships default-<app>-nav and
 * default-<app>-appmenu built for it, its manifest names them, and no app points at a shared or another app's menu.
 *   node framework/spec/check-app-menus.mjs           check
 *   node framework/spec/check-app-menus.mjs --write   regenerate the fixture's expected outputs
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as am from '../core/engines/app-menus-rules.mjs';
import { auditAll } from '../cli/app-menus.mjs';

const root = new URL('../', import.meta.url).pathname;
const FIXTURE = join(root, 'spec/fixtures/app-menus.json');
const ASSETS = [
  { type: 'nav-menu', id: 'default-molly-nav', name: 'Molly navigation (default)', data: { builtFor: 'app:molly' } },
  { type: 'nav-menu', id: 'molly-rail', name: 'Molly rail', data: { builtFor: 'app:molly' } },
  { type: 'nav-menu', id: 'molly-big', name: 'Big', data: { builtFor: 'app:molly' } },
  { type: 'nav-menu', id: 'default-axhub-web-nav', name: 'axHub navigation (default)', data: { builtFor: 'app:axhub-web' } },
  { type: 'nav-menu', id: 'sidebar-list', name: 'Sidebar list (shared)', data: {} },
  { type: 'app-menu', id: 'default-molly-appmenu', name: 'Molly app menu (default)', data: { builtFor: 'app:molly' } },
  { type: 'app-menu', id: 'standard-desktop', name: 'Standard desktop (shared)', data: {} },
  { type: 'toolbar', id: 'standard-icons', name: 'Standard icons', data: {} },
];

function compute() {
  return {
    contract: am.APP_MENUS_CONTRACT,
    kinds: am.APP_MENU_KINDS,
    kindOf: Object.fromEntries(['nav-menu', 'app-menu', 'toolbar', ''].map((t) => [t || '(empty)', am.menuKindOf(t)])),
    typeOf: Object.fromEntries(['nav', 'appmenu', 'nav-menu', 'menu', ''].map((t) => [t || '(empty)', am.menuTypeOf(t)])),
    builtFor: Object.fromEntries(['app:molly', 'app:', 'app:Bad Name', 'plugin:molly', 'molly', ''].map((v) => [v || '(empty)', am.parseMenuBuiltFor(v)])),
    defaultIds: Object.fromEntries(['molly', 'console-web', 'Bad'].flatMap((a) => ['nav', 'appmenu', 'toolbar'].map((k) => [`${a}/${k}`, am.menuDefaultId(a, k)]))),
    parseDefault: Object.fromEntries(['default-molly-nav', 'default-console-web-appmenu', 'default-molly-toolbar', 'molly', 'default--nav'].map((id) => [id, am.parseMenuDefaultId(id)])),
    appOfDefaults: {
      own: am.appOfDefaults({ 'nav-menu': 'default-molly-nav', 'app-menu': 'default-molly-appmenu' }),
      appOnly: am.appOfDefaults({ 'app-menu': 'default-molly-appmenu' }),
      swapped: am.appOfDefaults({ 'nav-menu': 'default-molly-appmenu' }),
      shared: am.appOfDefaults({ 'nav-menu': 'sidebar-list' }),
      none: am.appOfDefaults(null),
    },
    allowed: Object.fromEntries(ASSETS.map((a) => [`${a.type}/${a.id}`, am.menuAllowed('molly', a)])),
    choices: { mollyNav: am.menuChoices('molly', 'nav', ASSETS), mollyApp: am.menuChoices('molly', 'app-menu', ASSETS), axhubNav: am.menuChoices('axhub-web', 'nav', ASSETS), unknown: am.menuChoices('nobody', 'nav', ASSETS) },
    picks: {
      none: am.menuPick(undefined, 'molly', 'nav', ASSETS),
      picked: am.menuPick('molly-big', 'molly', 'nav', ASSETS),
      shared: am.menuPick('sidebar-list', 'molly', 'nav', ASSETS),
      otherApp: am.menuPick('default-axhub-web-nav', 'molly', 'nav', ASSETS),
      theDefault: am.menuPick('default-molly-nav', 'molly', 'nav', ASSETS),
    },
    sets: {
      default: am.menuSet('molly', 'nav', 'default', ASSETS),
      empty: am.menuSet('molly', 'nav', '', ASSETS),
      pick: am.menuSet('molly', 'nav', 'molly-rail', ASSETS),
      shared: am.menuSet('molly', 'nav', 'sidebar-list', ASSETS),
      otherApp: am.menuSet('molly', 'nav', 'default-axhub-web-nav', ASSETS),
      badKind: am.menuSet('molly', 'toolbar', 'x', ASSETS),
    },
    args: { nav: am.parseMenuArgs(['nav', 'molly-rail']), type: am.parseMenuArgs(['app-menu', 'default']), colon: am.parseMenuArgs(['nav', 'a', 'b']), bad: am.parseMenuArgs(['toolbar', 'x']), none: am.parseMenuArgs([]) },
    state: am.menuState('molly', { 'nav-menu': 'molly-big', 'app-menu': 'standard-desktop' }, ASSETS),
    audit: {
      ok: am.auditAppMenus('molly', { defaults: { 'nav-menu': 'default-molly-nav', 'app-menu': 'default-molly-appmenu' }, ownAssets: ASSETS.filter((a) => a.data.builtFor === 'app:molly') }),
      sharedDefault: am.auditAppMenus('molly', { defaults: { 'nav-menu': 'sidebar-list', 'app-menu': 'default-molly-appmenu' }, ownAssets: ASSETS.filter((a) => a.data.builtFor === 'app:molly') }),
      foreign: am.auditAppMenus('molly', { defaults: { 'nav-menu': 'default-molly-nav', 'app-menu': 'default-molly-appmenu' }, ownAssets: ASSETS.filter((a) => a.type !== 'toolbar'), sharedIds: ['nav-menu/sidebar-list'] }),
      missing: am.auditAppMenus('molly', { defaults: {}, ownAssets: [] }),
    },
  };
}

const got = JSON.parse(JSON.stringify(compute()));
if (process.argv.includes('--write')) {
  writeFileSync(FIXTURE, `${JSON.stringify({ $comment: 'app-menus@1 golden outputs (framework/spec/check-app-menus.mjs --write). The Kotlin twin replays these when it lands (spec/PORTING.md).', expected: got }, null, 2)}\n`);
  console.log(`wrote ${FIXTURE}`);
} else {
  assert.ok(existsSync(FIXTURE), 'fixture missing: node framework/spec/check-app-menus.mjs --write');
  assert.deepEqual(got, JSON.parse(readFileSync(FIXTURE, 'utf8')).expected, 'app-menus@1 outputs differ from the fixture');
}
// Behaviour the build promises, independent of the fixture.
assert.equal(got.picks.shared.id, 'default-molly-nav', 'a shared menu falls back to the default');
assert.equal(got.picks.otherApp.locked, true, "another app's menu is never used");
assert.ok(got.choices.mollyNav.every((c) => !['sidebar-list', 'default-axhub-web-nav'].includes(c.id)), 'the picker lists only menus built for the app');
assert.ok('error' in got.sets.shared, 'picking a shared menu is refused');
const repo = auditAll();
const errs = repo.flatMap((r) => r.errors.map((e) => `${r.app}: ${e}`));
assert.deepEqual(errs, [], `apps off their own menus:\n${errs.join('\n')}`);
console.log(`app-menus@1: fixture ok; ${repo.length} apps each on their own locked nav + app menu, none shared`);
