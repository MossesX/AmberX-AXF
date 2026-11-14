/**
 * Self-test for the banner + widget host engines on the web port (CI: npx -y tsx framework/spec/check-widgets.mts).
 * Replays spec/fixtures/banner.json and widgets.json through the reference engine (the same way the Kotlin
 * ConformanceTest does), checks the CLI validator (build-engine.mjs) gives the same attachment errors as core/validate.ts,
 * and exercises the runtime's host API (attach / replace / detach / detachAll / warnings) which fixtures can't cover.
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ATTACHABLE_TYPES, BADGE_TONE_TOKEN, BANNER_SIDES, bannerVars, formatClock, placeAttachments } from '../core/engines/banner';
import { BANNER_WIDGET_WIDTH, bannerWidgetCapCss, bannerWidgetEmpty, bannerWidgetNumber, bannerWidgetView, findBannerWidget, normalizeBannerWidgetPrefs, overflowWidgets, patchBannerWidget } from '../core/engines/bannerwidgets';
import { ATTACHABLE_ASSET_TYPES, AVATAR_SIZE, LOGO_SIZE, PROGRESS_WIDTH, SEARCH_BAR_WIDTH, SPACER_UNITS, TOOLBAR_SIDES, WIDGET_TONES, WIDGET_TYPES, avatarInitials, counterText, hostSpecs, imageSrc, linkHref, moveOnHost, normalizeArrangement, placeOnHost, placeToolbarWidgets, snapIndex, progressPercent, searchBarConfig, statusOn, themeSwitchNext, validateHostAttachments, widgetTone } from '../core/engines/widgets';
import { validateAsset } from '../core/validate';
import { AxfRuntime } from '../core/runtime';

const root = new URL('../', import.meta.url).pathname;
const read = (f: string) => JSON.parse(readFileSync(join(root, 'spec/fixtures', f), 'utf8'));
let checks = 0;
const ok = (c: unknown, msg: string) => { assert.ok(c, msg); checks++; };
const eq = (a: unknown, b: unknown, msg: string) => { assert.deepEqual(a, b, msg); checks++; };

// banner widgets (core/engines/bannerwidgets.ts)
{
  // compact by default, the widget's own shape for clocks and search bars, a pick always wins
  eq(bannerWidgetView('status', null, null).size, 'compact', 'a chip is compact by default');
  eq(bannerWidgetView('status', null, null).cap, { n: BANNER_WIDGET_WIDTH.compact, unit: 'space' }, 'compact caps the width');
  eq(bannerWidgetView('clock', null, null).cap, null, 'a clock keeps its own shape');
  eq(bannerWidgetView('clock', null, { size: 'wide' }).cap, { n: BANNER_WIDGET_WIDTH.wide, unit: 'space' }, 'until a size is picked');
  eq(bannerWidgetView('status', { size: 'wide' }, { size: 'icon' }).size, 'icon', 'the pick beats the hint');
  eq(bannerWidgetView('status', null, { size: 'icon' }).show, 'icon', 'icon size shows only the icon');
  eq(bannerWidgetView('status', null, { maxWidth: 90 }).cap, { n: 90, unit: 'px' }, 'max width beats the size');
  eq(bannerWidgetView('status', null, { maxWidth: 20, maxUnit: 'ch' }).cap, { n: 20, unit: 'ch' }, 'max width in characters');
  eq(bannerWidgetCapCss({ n: 14, unit: 'space' }), 'calc(var(--fx-space) * 14)', 'cap css in space tokens');
  eq(bannerWidgetCapCss({ n: 20, unit: 'ch' }), '20ch', 'cap css in characters');
  eq(bannerWidgetView('status', { hidden: true }, { hidden: false }).hidden, false, 'a hint can default hidden, the person decides');
  // damaged settings are cleaned, never trusted
  eq(normalizeBannerWidgetPrefs({ 'status:a': { size: 'huge', priority: 40, maxWidth: 3 }, 'bad key': { hidden: true }, 'status:b': 7 }), { 'status:a': { maxWidth: 24, maxUnit: 'px', priority: 9 } }, 'normalize prefs');
  eq(normalizeBannerWidgetPrefs([1]), {}, 'normalize junk');
  eq(patchBannerWidget({ 'status:a': { hidden: true, size: 'wide' } }, 'status:a', { hidden: null }), { 'status:a': { size: 'wide' } }, 'null goes back to the default');
  eq(patchBannerWidget({ 'status:a': { hidden: true } }, 'status:a', { hidden: null }), {}, 'nothing left: the entry goes');
  // empty only means something for a counter-bound widget
  eq(bannerWidgetEmpty('counter', { counter: 'c' }, () => 0), true, 'zero counter is empty');
  eq(bannerWidgetEmpty('status', { counter: 'c' }, () => 2), false, 'lit status is not empty');
  eq(bannerWidgetEmpty('clock', {}, () => 0), false, 'a clock is never empty');
  eq(bannerWidgetNumber('130 new · Retire Patches', 1), '130', 'number from the text');
  eq(bannerWidgetNumber("What's new", 4), '4', 'number from the counter');
  // overflow: nothing while it fits; lowest priority first, last on the bar first; pinned widgets stay
  const it = (key: string, priority: number, overflow = true) => ({ key, width: 100, priority, overflow });
  eq(overflowWidgets([it('a', 5), it('b', 5)], 210, 30, 10), [], 'everything fits');
  eq(overflowWidgets([it('a', 5), it('b', 1), it('c', 5)], 300, 30, 10), ['b'], 'lowest priority leaves first');
  eq(overflowWidgets([it('a', 5), it('b', 5), it('c', 5)], 300, 30, 10), ['c'], 'then the last on the bar');
  eq(overflowWidgets([it('a', 1, false), it('b', 5), it('c', 5)], 100, 30, 10), ['c', 'b'], 'pinned stays');
  eq(overflowWidgets([it('a', 1, false)], 10, 30, 10), [], 'nothing may leave: nothing leaves');
  const list = [{ key: 'clock:x', id: 'x', label: 'Clock' }, { key: 'status:y', id: 'y', label: "What's new ticker", aliases: ['ticker'] }];
  eq(findBannerWidget(list, 'the clock')?.key, 'clock:x', 'find by name');
  eq(findBannerWidget(list, 'ticker')?.key, 'status:y', 'find by alias');
  eq(findBannerWidget(list, 'status:y')?.key, 'status:y', 'find by key');
  eq(findBannerWidget(list, 'nope'), null, 'nothing found');
}

// banner.json
{
  const f = read('banner.json');
  eq([...ATTACHABLE_TYPES], f.attachable, 'attachable types');
  eq([...BANNER_SIDES], f.sides, 'banner sides');
  const exists = new Set<string>(f.exists);
  const has = (t: string, id: string) => exists.has(`${t}:${id}`);
  for (const [name, c] of Object.entries<any>(f.place)) eq(placeAttachments(c.banner, c.extra, has), c.placed, `place ${name}`);
  for (const c of f.clock) eq(formatClock(c.clock, c.parts), c.text, `clock ${JSON.stringify(c.clock)}`);
  eq(BADGE_TONE_TOKEN, f.tones, 'tones');
  const banners = Object.fromEntries(readdirSync(join(root, 'assets/banner')).map((n) => { const a = JSON.parse(readFileSync(join(root, 'assets/banner', n), 'utf8')); return [a.id, a.data]; }));
  for (const [id, vars] of Object.entries<any>(f.vars)) {
    const thin = banners['amberx-thin'];
    const v = id === 'hidden' ? bannerVars(thin, true) : id === 'none' ? bannerVars(null)
      : id === 'too-tall' ? bannerVars({ ...thin, height: 400 }) : id === 'too-short' ? bannerVars({ ...thin, height: 2 }) : id === 'not-a-number' ? bannerVars({ ...thin, height: 'x' as never })
      : bannerVars(banners[id]);
    eq(v, vars, `vars ${id}`);
  }
}

// widgets.json
{
  const f = read('widgets.json');
  eq([...WIDGET_TYPES], f.widgetTypes, 'widget types');
  eq([...ATTACHABLE_ASSET_TYPES], f.attachableTypes, 'attachable asset types');
  eq([...TOOLBAR_SIDES], f.toolbarSides, 'toolbar sides');
  eq(SEARCH_BAR_WIDTH, f.searchBarWidth, 'search bar widths');
  eq(hostSpecs(), f.hosts, 'host specs');
  const exists = new Set<string>(f.exists);
  const has = (t: string, id: string) => exists.has(`${t}:${id}`);
  for (const [name, c] of Object.entries<any>(f.toolbar)) eq(placeToolbarWidgets(c.toolbar, c.extra, has), c.placed, `toolbar ${name}`);
  for (const [name, c] of Object.entries<any>(f.searchBarConfig)) eq(searchBarConfig(c.data), c.config, `search bar config ${name}`);
  for (const [name, c] of Object.entries<any>(f.attachValidation)) eq(validateHostAttachments(c.host, c.list), c.errors, `attach validation ${name}`);
}

// validation.json: the TS validator and the CLI build engine agree on every case (incl. the host attachment ones)
{
  const cli = await import('../cli/build-engine.mjs') as { validateAsset: (raw: unknown) => { ok: boolean; errors: string[] } };
  for (const c of read('validation.json')) {
    eq(validateAsset(c.raw), c.result, `validate ${c.case} (core)`);
    eq(cli.validateAsset(c.raw), c.result, `validate ${c.case} (cli)`);
  }
}

// runtime host API
{
  const assets = readdirSync(join(root, 'assets')).flatMap((t) => readdirSync(join(root, 'assets', t)).filter((n) => n.endsWith('.json')).map((n) => JSON.parse(readFileSync(join(root, 'assets', t, n), 'utf8'))));
  const defaults = JSON.parse(readFileSync(join(root, 'defaults.json'), 'utf8'));
  const rt = new AxfRuntime({ manifest: { app: { id: 'test', name: 'Test' }, defaults } as never, assets, storageKey: 'test:widgets' });
  const warnings = () => rt.terminal.lines.filter((l) => l.level === 'warn' && l.channel === 'widgets');
  const before = rt.banner();
  eq(before.placed.center.map((p) => p.key), ['search-bar:everything'], 'default banner: search in the center');
  eq(before.placed.right.map((p) => p.key), ['theme-switch:day-night', 'clock:digital-12h'], 'default banner: day/night switch and clock right (the switch moved into the framework copy, Nov 3 2026)');
  // a plugin badge, replaced, then detached by origin
  const off = rt.attachToBanner({ type: 'badge', id: 'new', at: 'left', order: 5, origin: 'p1' });
  eq(rt.banner().placed.left.map((p) => `${p.key}@${p.origin}`), ['badge:new@p1'], 'badge attached');
  rt.attachToBanner({ type: 'badge', id: 'new', at: 'right', origin: 'p2' });
  eq(rt.banner().placed.left.length, 0, 'same type+id replaces (moved to the right)');
  eq(rt.banner().placed.right.map((p) => p.key), ['theme-switch:day-night', 'clock:digital-12h', 'badge:new'], 'order: asset switch and clock (10, 11) then runtime badge (1000)');
  rt.detachFromBanner('p2');
  eq(rt.banner().placed.right.map((p) => p.key), ['theme-switch:day-night', 'clock:digital-12h'], 'detached by origin');
  off(); // already gone: no-op
  // bad calls warn but never throw
  rt.attachToBanner({ type: 'button', id: 'rounded-solid', at: 'left', origin: 'p3' } as never);
  rt.attachToBanner({ type: 'badge', id: 'new', at: 'top' as never, origin: 'p3' });
  rt.attachToBanner({ type: 'badge', id: 'missing', at: 'left', origin: 'p3' });
  rt.attachToHost('ribbon', { type: 'badge', id: 'new', at: 'left', origin: 'p3' });
  ok(warnings().length === 4, `four warnings for four bad calls (${warnings().length}): ${warnings().map((l) => l.text).join(' | ')}`);
  eq(rt.banner().placed.left.length, 0, 'bad attachments never show');
  // toolbar widgets + detachAll across hosts
  rt.attachToToolbar({ type: 'clock', id: 'digital-24h', at: 'end', origin: 'p4' });
  rt.attachToBanner({ type: 'badge', id: 'new', at: 'left', origin: 'p4' });
  eq(rt.toolbarWidgets().end.map((p) => p.key), ['clock:digital-24h'], 'toolbar widget attached');
  rt.detachAll('p4');
  eq(rt.toolbarWidgets().end.length + rt.banner().placed.left.length, 0, 'detachAll clears every host');
  eq(rt.hostAttachments('banner').map((a) => `${a.type}:${a.id}@${a.origin}`), ['button:rounded-solid@p3', 'badge:missing@p3'], 'only the (never shown) bad p3 entries remain (p4 replaced badge:new, then detachAll removed it)');
  // hidden banner: nothing placed, even run-time entries
  rt.attachToBanner({ type: 'badge', id: 'new', at: 'left', origin: 'p5' });
  rt.setSlotHidden('banner', true);
  eq(rt.banner().data, null, 'hidden banner has no data');
  eq(rt.banner().placed.left.length, 0, 'hidden banner places nothing');
  rt.setSlotHidden('banner', false);
  eq(rt.banner().placed.left.map((p) => p.key), ['badge:new'], 'shown again with its run-time badge');
  // popup
  rt.showBannerPopup('badge:new', 'hi', 60_000);
  ok(rt.getState().bannerPopup?.text === 'hi', 'popup shown');
  rt.dismissBannerPopup();
  ok(rt.getState().bannerPopup === null, 'popup dismissed');
}

// widgets.json → kinds (Oct 20 2026): the pure rules logo, counter, status, progress, avatar, link, spacer, theme switch draw from.
{
  const k = read('widgets.json').kinds;
  eq([...WIDGET_TONES], k.tones, 'widget tones');
  for (const [name, c] of Object.entries<any>(k.tone)) { eq(widgetTone(c.in), c.out, `tone ${name}`); eq(widgetTone(c.in, 'accent'), c.accentFallback, `tone fallback ${name}`); }
  for (const c of k.counter) eq(counterText(c.n, c.max, c.hideAtZero), c.text, `counter ${JSON.stringify(c)}`);
  for (const c of k.status) eq(statusOn(c.n), c.on, `status ${c.n}`);
  for (const c of k.progress) eq(progressPercent(c.n, c.max), c.percent, `progress ${c.n}/${c.max}`);
  for (const c of k.initials) eq(avatarInitials(c.name), c.initials, `initials ${JSON.stringify(c.name)}`);
  for (const c of k.link) eq(linkHref(c.href), c.out, `link ${JSON.stringify(c.href)}`);
  for (const c of k.image) eq(imageSrc(c.src), c.out, `image ${JSON.stringify(c.src)}`);
  eq(SPACER_UNITS, k.spacer, 'spacer units'); eq(LOGO_SIZE, k.logo, 'logo sizes'); eq(AVATAR_SIZE, k.avatar, 'avatar sizes'); eq(PROGRESS_WIDTH, k.progressWidth, 'progress widths');
  for (const c of k.themeSwitch) eq(themeSwitchNext(c.active, c.light, c.dark), c.next, `theme switch ${c.active}`);
  // every widget type has a starter asset of its own, and the banner takes all of them
  const banner = hostSpecs().find((h) => h.host === 'banner')!;
  for (const t of WIDGET_TYPES) { ok(readdirSync(join(root, 'assets', t)).length > 0, `starter for ${t}`); ok(banner.types.includes(t), `banner takes ${t}`); }
}

// arranging (drag + snap): the arrangement layer, moves, the snap rule, and the runtime's saved arrangement
{
  const sides = ['left', 'center', 'right'];
  const has = () => true;
  const own = [{ type: 'clock', id: 'c', at: 'right' }, { type: 'badge', id: 'b', at: 'right' }];
  const extra = [{ type: 'status', id: 's', at: 'right', origin: 'p' }];
  const types = ['clock', 'badge', 'status'];
  const keys = (pl: Record<string, { key: string }[]>) => Object.fromEntries(sides.map((s) => [s, pl[s]!.map((p) => p.key)]));
  const plain = placeOnHost(own, extra, has, types, sides);
  eq(keys(plain), { left: [], center: [], right: ['clock:c', 'badge:b', 'status:s'] }, 'arrange: plain placement');
  const arranged = placeOnHost(own, extra, has, types, sides, { 'status:s': { at: 'left', order: 0 }, 'badge:b': { at: 'right', order: -5 }, 'gone:x': { at: 'left', order: 1 } });
  eq(keys(arranged), { left: ['status:s'], center: [], right: ['badge:b', 'clock:c'] }, 'arrange: layer moves and reorders, unknown keys ignored');
  eq(normalizeArrangement({ 'a:b': { at: 'left', order: 3 }, 'bad key': { at: 'left', order: 1 }, 'c:d': { at: 'up', order: 1 }, 'e:f': { at: 'left', order: 'x' } }, sides), { 'a:b': { at: 'left', order: 3 } }, 'arrange: normalize drops bad entries');
  eq(normalizeArrangement([1, 2], sides), {}, 'arrange: normalize non-object');
  const moved = moveOnHost(plain, { 'old:x': { at: 'left', order: 0 } }, 'status:s', 'right', 0, sides);
  eq(moved, { 'old:x': { at: 'left', order: 0 }, 'status:s': { at: 'right', order: 0 }, 'clock:c': { at: 'right', order: 10 }, 'badge:b': { at: 'right', order: 20 } }, 'arrange: move to front keeps other entries');
  eq(keys(placeOnHost(own, extra, has, types, sides, moved)), { left: [], center: [], right: ['status:s', 'clock:c', 'badge:b'] }, 'arrange: move then place');
  eq(keys(placeOnHost(own, extra, has, types, sides, moveOnHost(plain, {}, 'clock:c', 'center', 99, sides))), { left: [], center: ['clock:c'], right: ['badge:b', 'status:s'] }, 'arrange: move past the end clamps');
  eq(moveOnHost(plain, {}, 'nope:x', 'left', 0, sides), {}, 'arrange: unknown key is a no-op');
  eq(moveOnHost(plain, {}, 'clock:c', 'up', 0, sides), {}, 'arrange: unknown side is a no-op');
  eq([snapIndex([10, 20, 30], 5), snapIndex([10, 20, 30], 15), snapIndex([10, 20, 30], 20), snapIndex([10, 20, 30], 99), snapIndex([], 3)], [0, 1, 2, 3, 0], 'arrange: snap index');

  const assets = readdirSync(join(root, 'assets')).flatMap((t) => readdirSync(join(root, 'assets', t)).filter((n) => n.endsWith('.json')).map((n) => JSON.parse(readFileSync(join(root, 'assets', t, n), 'utf8'))));
  const defaults = JSON.parse(readFileSync(join(root, 'defaults.json'), 'utf8'));
  const rt = new AxfRuntime({ manifest: { app: { id: 'test', name: 'Test' }, defaults } as never, assets, storageKey: 'test:arrange' });
  rt.attachToBanner({ type: 'badge', id: 'new', at: 'right', origin: 'p1' });
  const rightBefore = rt.banner().placed.right.map((p) => p.key);
  ok(rightBefore.length >= 2 && rightBefore.includes('badge:new'), 'arrange rt: badge on the right');
  ok(rt.moveHostItem('banner', 'badge:new', 'left', 0), 'arrange rt: move ok');
  eq(rt.banner().placed.left[0]?.key, 'badge:new', 'arrange rt: badge moved to the left, first');
  ok(!rt.banner().placed.right.some((p) => p.key === 'badge:new'), 'arrange rt: gone from the right');
  ok(typeof rt.settings.get('axf.widgets.arrange.banner') === 'string', 'arrange rt: saved as a setting');
  // a plugin re-attaching keeps the person's spot
  rt.attachToBanner({ type: 'badge', id: 'new', at: 'right', origin: 'p1' });
  eq(rt.banner().placed.left[0]?.key, 'badge:new', 'arrange rt: re-attach keeps the spot');
  ok(!rt.moveHostItem('banner', 'badge:new', 'nowhere', 0), 'arrange rt: bad side refused');
  ok(!rt.moveHostItem('nohost', 'badge:new', 'left', 0), 'arrange rt: bad host refused');
  rt.setArranging('banner'); ok(rt.arranging('banner') && rt.arranging(), 'arrange rt: arrange mode on');
  rt.dispatch('widgets.arrange:banner'); ok(!rt.arranging(), 'arrange rt: action toggles off');
  rt.setArranging('nohost'); ok(!rt.arranging(), 'arrange rt: unknown host never arranges');
  const menu = rt.contextExtras.get('*:widgets')!('banner');
  ok(menu.some((m) => m.action === 'widgets.arrange:banner') && menu.some((m) => m.action === 'widgets.reset:banner'), 'arrange rt: banner right-click offers Arrange + Put back');
  eq(rt.contextExtras.get('*:widgets')!('default'), [], 'arrange rt: other targets get nothing');
  rt.dispatch('widgets.reset:banner');
  eq(rt.banner().placed.right.map((p) => p.key), rightBefore, 'arrange rt: reset puts it back');
  eq(rt.settings.get('axf.widgets.arrange.banner'), null, 'arrange rt: reset clears the setting');
  rt.moveHostItem('banner', 'badge:new', 'left', 0); rt.reset();
  eq(rt.settings.get('axf.widgets.arrange.banner'), null, 'arrange rt: Reset to defaults clears arrangements');
}

// host widgets (core/engines/hostwidgets.ts, Nov 13 2026): any banner-style widget on any toolbar or tab row
{
  const hw = await import('../core/engines/hostwidgets');
  const { instanceHost, splitHost, hostSpec, HOST_APP_INSTANCE } = await import('../core/engines/widgets');
  // host instances: the app's own is the bare type; others carry their id; the type's spec answers for every instance
  eq(instanceHost('toolbar', 'app'), 'toolbar', 'host: app instance is the bare type');
  eq(instanceHost('toolbar', 'settings-toolbar'), 'toolbar@settings-toolbar', 'host: instance id');
  eq(splitHost('tab-group@ui-review.sections'), { host: 'tab-group', instance: 'ui-review.sections' }, 'host: split');
  eq(splitHost('toolbar'), { host: 'toolbar', instance: HOST_APP_INSTANCE }, 'host: split bare');
  eq(hostSpec('toolbar@x')?.host, 'toolbar', 'host: instance spec is the type spec');
  eq(hostSpec('tab-group')?.sides, ['start', 'end'], 'host: a tab row is a host (asset-types.json)');
  ok(hostSpec('tab-group')!.types.includes('status') && !hostSpec('tab-group')!.types.includes('badge'), 'host: a tab row takes widgets, not badges');
  const types = hostSpec('toolbar')!.types, sides = hostSpec('toolbar')!.sides;
  // the saved choice is cleaned, never trusted
  const c = hw.normalizeHostWidgetChoice({ attach: [{ type: 'status', id: 'cpu', at: 'end' }, { type: 'badge', id: 'x', at: 'end' }, { type: 'clock', id: 'c', at: 'left' }, { type: 'status', id: 'cpu', at: 'start' }, 'junk'], prefs: { 'status:cpu': { size: 'wide', priority: 99 }, bad: 1 } }, types, sides);
  eq(c.attach.map((a) => `${a.type}:${a.id}@${a.at}#${a.order}/${a.origin}`), ['status:cpu@end#2000/person'], 'host choice: only widget types on known sides, no doubles');
  eq(c.prefs, { 'status:cpu': { size: 'wide', priority: 9 } }, 'host choice: prefs by the banner rules');
  eq(hw.normalizeHostWidgetChoice(null, types, sides), { attach: [], prefs: {} }, 'host choice: junk is empty');
  ok(hw.hostWidgetChoiceEmpty(hw.emptyHostWidgetChoice()) && !hw.hostWidgetChoiceEmpty(c), 'host choice: empty test');
  // add / remove / patch
  const added = hw.addHostWidget(hw.emptyHostWidgetChoice(), 'clock', 'digital-24h', 'start', types, sides);
  eq(added.attach, [{ type: 'clock', id: 'digital-24h', at: 'start', order: 2000, origin: 'person' }], 'host add');
  const two = hw.addHostWidget(added, 'status', 'cpu', 'end', types, sides);
  eq(two.attach.map((a) => a.order), [2000, 2010], 'host add: after what is there');
  eq(hw.addHostWidget(two, 'clock', 'digital-24h', 'end', types, sides).attach.map((a) => `${a.type}:${a.id}@${a.at}`), ['status:cpu@end', 'clock:digital-24h@end'], 'host add: again moves it');
  eq(hw.addHostWidget(two, 'badge', 'new', 'end', types, sides).attach.length, 2, 'host add: a badge is refused on a toolbar');
  eq(hw.addHostWidget(two, 'clock', 'c', 'middle', types, sides).attach.length, 2, 'host add: unknown side refused');
  const hidden = hw.patchHostWidget(two, 'status:cpu', { hidden: true, size: 'icon' });
  eq(hidden.prefs, { 'status:cpu': { hidden: true, size: 'icon' } }, 'host patch');
  eq(hw.addHostWidget(hidden, 'status', 'cpu', 'end', types, sides).prefs, { 'status:cpu': { size: 'icon' } }, 'host add: a widget added back is shown again');
  eq(hw.removeHostWidget(hidden, 'status:cpu'), { attach: added.attach, prefs: {} }, 'host remove: the widget and its prefs');
  eq(hw.hostWidgetsKey('toolbar', 'Dev Console', 'desktop', 'app'), 'axf.widgets.on.toolbar.dev-console.desktop.app', 'host key');
  // what an action says
  eq(hw.parseHostWidgetArgs(['cpu', 'add']), { instance: 'app', name: 'cpu', op: 'add' }, 'host args: name + op');
  eq(hw.parseHostWidgetArgs(['settings-toolbar', 'status', 'cpu', 'wide']), { instance: 'settings-toolbar', name: 'status:cpu', op: 'wide' }, 'host args: instance, key, size');
  eq(hw.parseHostWidgetArgs(['cpu', 'bigger']), null, 'host args: unknown op');
  eq(hw.parseHostWidgetArgs(['add']), null, 'host args: no name');
  // which bar a person means
  const bars = [{ id: 'app', label: 'Toolbar' }, { id: 'settings-toolbar', label: 'Settings toolbar' }, { id: 'axf-ws-toolbar:notes', label: 'Notes workspace toolbar' }];
  eq(hw.matchHostInstance(bars, 'the main toolbar'), 'app', 'host match: main');
  eq(hw.matchHostInstance(bars, ''), 'app', 'host match: nothing = app');
  eq(hw.matchHostInstance(bars, 'settings'), 'settings-toolbar', 'host match: words');
  eq(hw.matchHostInstance(bars, 'the notes toolbar'), 'axf-ws-toolbar:notes', 'host match: label words');
  eq(hw.matchHostInstance(bars, 'axf-ws-toolbar:notes'), 'axf-ws-toolbar:notes', 'host match: exact id');
  eq(hw.matchHostInstance([], 'my.page.tabs'), 'my.page.tabs', 'host match: a valid id with nothing on screen is taken as is');
  eq(hw.matchHostInstance(bars, 'nothing like this'), null, 'host match: nothing');

  // the runtime: add by voice-style action, persist per instance, draw, hide, move, remove, reset; the context menu
  const assets = readdirSync(join(root, 'assets')).flatMap((t) => readdirSync(join(root, 'assets', t)).filter((n) => n.endsWith('.json')).map((n) => JSON.parse(readFileSync(join(root, 'assets', t, n), 'utf8'))));
  const defaults = JSON.parse(readFileSync(join(root, 'defaults.json'), 'utf8'));
  const rt = new AxfRuntime({ manifest: { app: { id: 'test', name: 'Test' }, defaults } as never, assets, storageKey: 'test:hostwidgets' });
  const endKeys = (instance = 'app') => rt.toolbarWidgets(instance).end.map((p) => p.key);
  const before = endKeys();
  ok(rt.hostWidgets('toolbar', 'app').some((w) => w.key === 'clock:digital-24h' && !w.attached), 'host rt: the catalog lists every widget asset');
  ok(rt.hostWidgets('toolbar', 'app').some((w) => w.key === 'theme-switch:day-night'), 'host rt: the banner registry is in the catalog');
  ok(!rt.hostWidgets('toolbar', 'app').some((w) => w.type === 'badge'), 'host rt: no badges for a toolbar');
  rt.dispatch('toolbar.widget:clock:add');
  eq(rt.hostWidgetChoice('toolbar', 'app').attach.length, 1, 'host rt: "add the clock" (first match of the word) saved');
  ok(endKeys().length === before.length + 1, 'host rt: drawn at the end');
  const key = rt.hostWidgetChoice('toolbar', 'app').attach[0]!;
  const k = `${key.type}:${key.id}`;
  ok(typeof rt.settings.get(rt.hostWidgetsKey('toolbar', 'app')) === 'object', 'host rt: saved as a setting');
  eq(endKeys('settings-toolbar').includes(k), false, 'host rt: another toolbar is untouched (per instance)');
  rt.dispatch(`toolbar.widget:app:${k}:hide`);
  eq(endKeys().includes(k), false, 'host rt: hidden is not drawn');
  ok(rt.hostInstanceWidgets('toolbar', 'app', { all: true }).end.some((p) => p.key === k), 'host rt: but still placed (all)');
  rt.dispatch(`toolbar.widget:app:${k}:show`);
  rt.dispatch(`toolbar.widget:app:${k}:wide`);
  eq(rt.hostWidgetView('toolbar', 'app', k).size, 'wide', 'host rt: size by action');
  rt.dispatch(`toolbar.widget:app:${k}:start`);
  ok(rt.toolbarWidgets().start.some((p) => p.key === k), 'host rt: moved to the start');
  ok(typeof rt.settings.get('axf.widgets.arrange.toolbar') === 'string', 'host rt: the app toolbar keeps its arrangement key');
  // a page toolbar is its own instance with its own arrangement key
  ok(rt.addHostWidget('toolbar', 'settings-toolbar', 'clock', 'digital-24h', 'end'), 'host rt: add to a page toolbar');
  eq(endKeys('settings-toolbar'), ['clock:digital-24h'], 'host rt: drawn on that toolbar only');
  rt.moveHostItem('toolbar@settings-toolbar', 'clock:digital-24h', 'start', 0);
  ok(typeof rt.settings.get('axf.widgets.arrange.toolbar@settings-toolbar') === 'string', 'host rt: per-instance arrangement');
  eq(rt.hostPlaced('toolbar@settings-toolbar').start.map((p) => p.key), ['clock:digital-24h'], 'host rt: hostPlaced reads an instance host');
  // a tab row hosts widgets too
  ok(rt.addHostWidget('tab-group', 'ui-review.sections', 'clock', 'digital-24h'), 'host rt: add to a tab row');
  eq(rt.hostInstanceWidgets('tab-group', 'ui-review.sections').end.map((p) => p.key), ['clock:digital-24h'], 'host rt: drawn on the row');
  ok(!rt.addHostWidget('tab-group', 'ui-review.sections', 'badge', 'new'), 'host rt: a badge is refused');
  // the context menu of a toolbar / tab row offers Widgets…, a hit widget's settings and remove, arrange + put back
  rt.contextHostWidget = 'clock:digital-24h';
  const menu = rt.contextExtras.get('*:widgets')!('toolbar', 'settings-toolbar');
  ok(menu.some((m) => m.action === 'toolbar.widgets:settings-toolbar'), 'host rt: right-click offers Widgets…');
  ok(menu.some((m) => m.action === 'toolbar.widgets:settings-toolbar:clock:digital-24h'), 'host rt: widget settings for the hit widget');
  ok(menu.some((m) => m.action === 'toolbar.widget:settings-toolbar:clock:digital-24h:remove' && m.label === 'Remove Clock'), 'host rt: remove for a widget the person added');
  ok(menu.some((m) => m.action === 'widgets.arrange:toolbar@settings-toolbar'), 'host rt: arrange this instance');
  const tabMenu = rt.contextExtras.get('*:widgets')!('tab-group', 'ui-review.sections');
  ok(tabMenu.some((m) => m.action === 'tabs.widgets:ui-review.sections'), 'host rt: a tab row offers Widgets…');
  eq(rt.contextExtras.get('*:widgets')!('tab-group', 'empty.row').map((m) => m.action), ['tabs.widgets:empty.row'], 'host rt: an empty row still offers Widgets… (nothing to arrange)');
  // remove and reset
  rt.dispatch('toolbar.widget:settings-toolbar:clock:remove');
  eq(endKeys('settings-toolbar').length + rt.toolbarWidgets('settings-toolbar').start.length, 0, 'host rt: removed');
  rt.dispatch('toolbar.widgets.reset:app');
  eq(rt.settings.get(rt.hostWidgetsKey('toolbar', 'app')), null, 'host rt: reset clears the choice');
  eq(rt.settings.get('axf.widgets.arrange.toolbar'), null, 'host rt: reset clears the arrangement');
  eq(endKeys(), before, 'host rt: back to the defaults');
  // a module's widget is hidden, not removed
  rt.attachToToolbar({ type: 'clock', id: 'digital-24h', at: 'end', origin: 'p9', widget: { label: 'Plugin clock' } });
  ok(rt.hostWidgets('toolbar', 'app').some((w) => w.key === 'clock:digital-24h' && w.attached && w.label === 'Plugin clock'), 'host rt: a module widget with its hint');
  rt.removeHostWidget('toolbar', 'app', 'clock:digital-24h');
  ok(rt.hostWidgetView('toolbar', 'app', 'clock:digital-24h').hidden && rt.hostInstanceWidgets('toolbar', 'app', { all: true }).end.some((p) => p.key === 'clock:digital-24h'), 'host rt: hidden, still placed');
  rt.dispatch('toolbar.widget:app:plugin clock:show');
  ok(!rt.hostWidgetView('toolbar', 'app', 'clock:digital-24h').hidden, 'host rt: shown again by its name');
}

console.log(`check-widgets: ${checks} checks ok`);
