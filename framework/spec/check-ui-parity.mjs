#!/usr/bin/env node
/**
 * ui-api@1 parity check (framework/cli/ui-parity.mjs) and deep-link@1 (framework/core/engines/deep-link.mjs), build
 * ui-api-parity-rule: refs resolve or say why, the ratchet holds, a mapped view must be full, the Demonstration
 * Designer and the Book Builder are at full parity, and deep links round-trip and only open things.
 *   node framework/spec/check-ui-parity.mjs
 */
import assert from 'node:assert/strict';
import { build, check, baselineOf, refError } from '../cli/ui-parity.mjs';
import { links } from '../cli/deep-links.mjs';
import { DEEP_LINK_PARAMS, deepLink, deepLinkRefusal, hasDeepLink, parseDeepLink, stripDeepLink } from '../core/engines/deep-link.mjs';

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); n++; };
const throws = (f, re, m) => { assert.throws(f, re, m); n++; };

/* ---- deep-link@1 ---- */
eq(deepLink({ view: 'demo-designer' }), '?axf-view=demo-designer', 'a view alone is just the query');
eq(deepLink({ base: 'https://console.amberxai.com', view: 'book-builder' }), 'https://console.amberxai.com/?axf-view=book-builder', 'a base gets a slash before the query');
eq(deepLink({ base: 'https://x.test/app/?old=1#h', view: 'a' }), 'https://x.test/app/?axf-view=a', "the base's own query and hash are dropped");
const multi = deepLink({ view: 'demo-designer', settings: 'glossary-index', dialog: 'glossary-index.book-wizard', do: ['demo.edit:demonstration:tour', 'demo.play:demonstration:tour'] });
const p = parseDeepLink(multi);
eq([p.view, p.settings, p.dialog, p.do, p.errors], ['demo-designer', 'glossary-index', 'glossary-index.book-wizard', ['demo.edit:demonstration:tour', 'demo.play:demonstration:tour'], []], 'everything round-trips, actions in order');
eq(parseDeepLink('https://c.test/?axf-view=x#frag').view, 'x', 'a full URL parses');
eq(parseDeepLink('?axf-view=glossary-index').view, 'glossary-index', 'the old glossary form (?axf-view=) still works');
ok(parseDeepLink('?axf-view=Bad View').errors.length === 1 && !parseDeepLink('?axf-view=Bad View').view, 'a bad view is an error, not a navigation');
ok(parseDeepLink(`?${Array.from({ length: 12 }, () => 'axf-do=nav:x').join('&')}`).do.length === 8, 'at most 8 actions');
throws(() => deepLink({}), /needs a view/, 'an empty link is refused');
throws(() => deepLink({ view: 'x', do: ['has space'] }), /not an action spec/, 'a bad action is refused');
eq(stripDeepLink('?axf-view=a&keep=1&axf-do=nav:b'), '?keep=1', 'stripping keeps the other params');
eq(stripDeepLink('?axf-view=a'), '', 'stripping everything leaves nothing');
ok(hasDeepLink('?axf-settings=x') && !hasDeepLink('?q=1'), 'hasDeepLink');
eq(Object.values(DEEP_LINK_PARAMS), ['axf-view', 'axf-dialog', 'axf-settings', 'axf-do'], 'the four params');
eq(deepLinkRefusal({ effect: 'navigate' }), '', 'navigate actions run from a link');
eq(deepLinkRefusal({ effect: 'read' }), '', 'read actions run from a link');
ok(/only opens/.test(deepLinkRefusal({ effect: 'write' })), 'a write action is refused');
ok(/only opens/.test(deepLinkRefusal({})), 'an action without a declared effect is refused');
ok(/own tap/.test(deepLinkRefusal({ effect: 'navigate', personOnly: true })), 'a person-only action is refused');
ok(/no such/.test(deepLinkRefusal(undefined)), 'an unknown action is refused');

/* ---- the deep-link registry: every plugin view, dialog and settings tab has a URL ---- */
const L = links({ base: 'https://console.test' });
ok(L.length > 50 && L.every((l) => l.url && !l.error), 'every declared view / dialog / settings tab has a link');
for (const v of ['demo-designer', 'book-builder', 'glossary-index']) ok(L.some((l) => l.kind === 'view' && l.id === v && l.url === `https://console.test/?axf-view=${v}`), `${v} has its link`);

/* ---- refs ---- */
const plugin = { folder: 'p', commands: new Map([['go', {}]]) };
const ctx = { plugin, byFolder: new Map([['p', plugin], ['q', { folder: 'q', commands: new Map([['x', {}]]) }]]), actions: new Set(['demo.play']), views: new Set(['v1']), dialogs: new Set(['d.one']) };
eq(['go', 'q/x', 'action:demo.play', 'action:demo.play:demonstration:a', 'value:glossary.designer.open', 'view:v1', 'dialog:d.one', 'settings:anything'].map((r) => refError(r, ctx)), Array(8).fill(''), 'good refs resolve');
ok(/no command "nope" in p/.test(refError('nope', ctx)), 'an unknown own command');
ok(/no command "y" in plugin q/.test(refError('q/y', ctx)), "another plugin's unknown command");
ok(/no console action/.test(refError('action:nope', ctx)), 'an unknown action');
ok(/no view/.test(refError('view:zz', ctx)), 'an unknown view');
ok(/not a ref/.test(refError('Has Spaces', ctx)), 'not a ref');

/* ---- the repo today ---- */
const model = build();
const gi = model.areas.find((a) => a.id === 'glossary-index');
ok(gi && gi.full && gi.errors.length === 0 && gi.gaps.length === 0, 'Glossary, Index & Demos (Demonstration Designer + Book Builder) is at full parity');
for (const v of ['demo-designer', 'book-builder']) {
  const view = gi.views.find((x) => x.id === v);
  ok(view.mapped && view.state.length >= 4 && view.actions >= 30, `${v}: mapped, its state readable, its actions named`);
  ok(view.state.some((s) => s.startsWith('value:')), `${v}: what is on screen is a console.values key`);
}
ok(model.areas.every((a) => a.errors.length === 0), `no UI map names an op that doesn't exist: ${model.areas.flatMap((a) => a.errors.map((e) => `${a.id}: ${e}`)).join('; ')}`);
const verdict = check(model);
ok(verdict.ok, `the repo passes: ${verdict.problems.join('; ')}`);

/* ---- the ratchet ---- */
const base = baselineOf(model);
ok(!('glossary-index' in base.areas), 'a full area has no baseline entry');
const worse = { areas: model.areas.map((a) => (a.id === 'console' ? { ...a, gaps: [...a.gaps, { what: 'action', label: 'New button', file: 'x.tsx' }] } : a)) };
ok(check(worse, base).problems.some((q) => /console: \d+ gap\(s\), the baseline allows/.test(q)), 'a new gap over the baseline fails');
const fresh = { areas: [...model.areas, { id: 'new-plugin', kind: 'plugin', views: [], gaps: [{ what: 'state', label: 'v' }], errors: [] }] };
ok(check(fresh, base).problems.some((q) => /new-plugin: new UI with 1 gap/.test(q)), 'a new plugin with any gap fails');
const half = { areas: model.areas.map((a) => (a.id === 'glossary-index' ? { ...a, views: a.views.map((v, i) => (i === 0 ? { ...v, gaps: [{ what: 'action', label: 'X' }] } : v)) } : a)) };
ok(check(half, base).problems.some((q) => /is mapped \(ui-api@1\) but not full/.test(q)), 'a mapped view must be full');

console.log(`check-ui-parity: ${n} checks passed`);
