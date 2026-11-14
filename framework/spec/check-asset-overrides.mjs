#!/usr/bin/env node
/**
 * Asset overrides (chrome-settings@1 instance overrides): an asset inherits the app's settings until one of its own
 * fields is set; chromeOverrideList() is the "Assets with edits" list Settings → Appearance shows. Fails if the list
 * misses an edited asset, lists one with no valid field, keeps an invalid value, or reads an `.asset` pick as edits;
 * and if the controlled-item colour accepts anything but a status token name.
 *
 *   node framework/spec/check-asset-overrides.mjs
 */
import { CONTROLLED_COLORS, chromeOverrideList, controlledColorOf } from '../core/engines/chrome-settings-rules.mjs';

const problems = [];
const eq = (a, b, msg) => { if (JSON.stringify(a) !== JSON.stringify(b)) problems.push(`${msg}: got ${JSON.stringify(a)}`); };
const saved = {
  'axf.chrome.tab-group.settings.main': { style: 'pills', bogus: 1 },
  'axf.chrome.tab-group.settings.main.asset': 'pills-tabs',
  'axf.chrome.tab-group.settings.main.interface': 'chrome-tab-group-axf-console',
  'axf.chrome.toolbar.app.interface': 'chrome-toolbar',
  'axf.chrome.toolbar.app': { variant: 'labels', density: 'nope' },
  'axf.chrome.banner.app': { height: 99 },
  'axf.chrome.nav-menu.app': { style: 'nope' },
  'axf.chrome.settings.toolbar': 'chrome-toolbar',
  'axf.theme': 'x',
};
eq(chromeOverrideList(saved), [
  { type: 'tab-group', instance: 'settings.main', fields: { style: 'pills' } },
  { type: 'toolbar', instance: 'app', fields: { variant: 'labels' } },
  { type: 'banner', instance: 'app', fields: { height: 48 } },
], 'assets with edits');
eq(chromeOverrideList(null), [], 'no saved values');
eq(controlledColorOf('accent'), 'accent', 'a status colour is kept');
eq(controlledColorOf('#ff0000'), CONTROLLED_COLORS[0], 'a literal colour falls back to the default token');
if (problems.length) { console.error(`asset overrides: ${problems.length} problem(s)\n  ${problems.join('\n  ')}`); process.exit(1); }
console.log('asset overrides: ok');
