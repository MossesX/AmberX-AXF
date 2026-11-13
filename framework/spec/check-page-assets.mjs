#!/usr/bin/env node
/**
 * Page assets (page-assets@1): the Assets menu's ids, the saved hidden list, the colours and what a console reports.
 * Fails if an asset id parses wrong, the hidden list keeps junk or repeats, hiding / showing on a page or on every page
 * goes wrong, a colour setting accepts anything but a colour token name, a type has no label / icon / default colour,
 * or console_where's here.assets passes an invalid row.
 *
 *   node framework/spec/check-page-assets.mjs
 */
import {
  PAGE_ANY, PAGE_ASSET_COLOURS, PAGE_ASSET_DEFAULT_COLOURS, PAGE_ASSET_ICONS, PAGE_ASSET_LABELS, PAGE_ASSET_TYPES,
  hiddenOnPage, isAssetHidden, normalizeHiddenAssets, normalizePageAssetSummary, pageAssetColourOf, pageAssetHiddenColourOf,
  pageAssetHighlightMs, pageAssetSlug, parsePageAssetId, withAssetHidden,
} from '../core/engines/page-assets-rules.mjs';
import { normalizeHere } from '../core/engines/console-commands.mjs';

const problems = [];
const eq = (a, b, msg) => { if (JSON.stringify(a) !== JSON.stringify(b)) problems.push(`${msg}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); };

for (const t of PAGE_ASSET_TYPES) {
  if (!PAGE_ASSET_LABELS[t] || !PAGE_ASSET_ICONS[t]) problems.push(`${t}: no label or icon`);
  if (!PAGE_ASSET_COLOURS.includes(PAGE_ASSET_DEFAULT_COLOURS[t])) problems.push(`${t}: default colour is not a colour token`);
}
for (const t of ['toolbar', 'tab-group', 'nav-menu', 'app-menu', 'banner', 'widget', 'grid']) if (!PAGE_ASSET_TYPES.includes(t)) problems.push(`missing type ${t}`);

eq(pageAssetSlug('  Plan Studio · Actions '), 'plan-studio-actions', 'slug');
eq(parsePageAssetId('toolbar:plan-actions'), { type: 'toolbar', instance: 'plan-actions' }, 'parse id');
eq(parsePageAssetId('tab-group:a:b'), { type: 'tab-group', instance: 'a:b' }, 'parse id with a colon in the instance');
eq(parsePageAssetId('spaceship:x'), null, 'unknown type');
eq(parsePageAssetId('toolbar:'), null, 'no instance');
eq(parsePageAssetId(42), null, 'not a string');

eq(normalizeHiddenAssets(['home|toolbar:a', 'home|toolbar:a', 'bad', 'home|nope:x', 7, '*|grid:g']), ['home|toolbar:a', '*|grid:g'], 'hidden list cleaned');
let h = withAssetHidden([], 'home', 'toolbar:a', true);
eq(h, ['home|toolbar:a'], 'hide on a page');
eq(isAssetHidden(h, 'home', 'toolbar:a'), true, 'hidden on its page');
eq(isAssetHidden(h, 'plans', 'toolbar:a'), false, 'not hidden on another page');
h = withAssetHidden(h, PAGE_ANY, 'grid:g', true);
eq(isAssetHidden(h, 'plans', 'grid:g'), true, 'hidden on every page');
eq(hiddenOnPage(h, 'home'), ['toolbar:a', 'grid:g'], 'hidden on page includes every-page entries');
h = withAssetHidden(h, 'plans', 'grid:g', false);
eq(isAssetHidden(h, 'home', 'grid:g'), false, 'unhide clears the every-page entry too');
eq(withAssetHidden(h, 'home', 'junk', true), h, 'an invalid id changes nothing');

eq(pageAssetColourOf('toolbar', 'danger'), 'danger', 'a colour token is kept');
eq(pageAssetColourOf('toolbar', '#ff0000'), PAGE_ASSET_DEFAULT_COLOURS.toolbar, 'a literal colour falls back to the default');
eq(pageAssetHiddenColourOf(null), 'muted', 'hidden colour default');
eq(pageAssetHiddenColourOf('rgb(1,2,3)'), 'muted', 'hidden colour refuses literals');
eq(pageAssetHighlightMs(''), 4000, 'highlight default');
eq(pageAssetHighlightMs('999999'), 60000, 'highlight cap');

const rows = [{ id: 'toolbar:a', label: 'Actions', hidden: true }, { id: 'toolbar:a' }, { id: 'nope:x' }, null, { id: 'grid:g' }];
eq(normalizePageAssetSummary(rows), [{ id: 'toolbar:a', type: 'toolbar', label: 'Actions', hidden: true }, { id: 'grid:g', type: 'grid', label: 'Grid', hidden: false }], 'summary rows');
eq(normalizeHere({ screen: 'home', assets: rows }).assets?.length, 2, 'console here carries the page assets');
eq('assets' in normalizeHere({ screen: 'home' }), false, 'no assets reported: none in here');

if (problems.length) { console.error(`page assets: ${problems.length} problem(s)\n  ${problems.join('\n  ')}`); process.exit(1); }
console.log('page assets: ok');
