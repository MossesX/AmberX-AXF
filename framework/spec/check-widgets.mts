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
import { BANNER_WIDGET_PRIORITY, BANNER_WIDGET_SHOWS, BANNER_WIDGET_SIZES, BANNER_WIDGET_WIDTH, bannerWidgetCapCss, bannerWidgetEmpty, bannerWidgetNumber, bannerWidgetView, findBannerWidget, normalizeBannerWidgetPrefs, overflowWidgets, patchBannerWidget } from '../core/engines/bannerwidgets';
import { ATTACHABLE_ASSET_TYPES, AVATAR_SIZE, LOGO_SIZE, PROGRESS_WIDTH, SEARCH_BAR_WIDTH, SPACER_UNITS, TOOLBAR_SIDES, WIDGET_TONES, WIDGET_TYPES, avatarInitials, counterText, hostSpecs, imageSrc, linkHref, moveOnHost, normalizeArrangement, placeOnHost, placeToolbarWidgets, snapIndex, progressPercent, searchBarConfig, statusOn, themeSwitchNext, themeSwitchPair, validateHostAttachments, widgetTone } from '../core/engines/widgets';
import { validateAsset } from '../core/validate';
import { ARRANGE_KEY, AxfRuntime } from '../core/runtime';
import { HOST_ENTRY_WIDGET, TOOLBAR_WIDGETS_KEY, TOOLBAR_WIDGET_OPS, addToolbarWidget, fitToolbar, foldArrangement, hostEntryErrors, hostShapeErrors, matchToolbarInstance, moveToolbarWidget, normalizeToolbarWidgetSlots, normalizeWidgetStyle, parseToolbarWidgetArgs, parseToolbarWidgetShapeArgs, patchToolbarWidget, removeToolbarWidget, resolveToolbarWidgets, toolbarInstanceOfKey, type ToolbarWidgetSlot } from '../core/engines/toolbar-widgets';

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

// toolbar-widgets.json (toolbar-widgets@1, core/engines/toolbar-widgets.ts): replay every golden output through the engine
{
  const f = read('toolbar-widgets.json');
  const spec = JSON.parse(readFileSync(join(root, 'schemas/asset-types.json'), 'utf8'));
  eq(HOST_ENTRY_WIDGET, spec.hostEntry.widget, 'the rules file mirrors asset-types.json → hostEntry.widget');
  eq(HOST_ENTRY_WIDGET.sizes, [...BANNER_WIDGET_SIZES], 'hostEntry sizes = the banner widget sizes');
  eq(HOST_ENTRY_WIDGET.shows, [...BANNER_WIDGET_SHOWS], 'hostEntry shows = the banner widget shows');
  eq(HOST_ENTRY_WIDGET.priority, BANNER_WIDGET_PRIORITY, 'hostEntry priority = the banner widget priority');
  ok(spec.types.toolbar.optional_fields.shape && spec.types.banner.optional_fields.shape, 'both hosts document their shape default');
  eq([...TOOLBAR_WIDGET_OPS], f.ops, 'widget ops');
  for (const [k, v] of Object.entries<any>(f.instanceOfKey)) eq(toolbarInstanceOfKey(k), v, `instance of key ${k}`);
  eq(normalizeToolbarWidgetSlots(f.normalize.raw), f.normalize.slots, 'normalize slots');
  eq(normalizeWidgetStyle(f.normalize.style.in), f.normalize.style.out, 'normalize style');
  eq(normalizeToolbarWidgetSlots('[{"type":"clock","id":"digital-12h","at":"end"}]'), f.normalize.slotsJson, 'slots saved as JSON text');
  const exists = new Set<string>(f.exists);
  const has = (t: string, id: string) => exists.has(`${t}:${id}`);
  for (const [name, c] of Object.entries<any>(f.resolve)) eq(resolveToolbarWidgets({ toolbar: c.toolbar, extra: c.extra ?? [], slots: normalizeToolbarWidgetSlots(c.slots), style: normalizeWidgetStyle(c.style), arrange: c.arrange ?? null, has }, WIDGET_TYPES), c.out, `resolve ${name}`);
  // the contract's promises, read off the golden outputs
  const r = f.resolve['person-slots'].out;
  ok(r.hidden.some((w: any) => w.key === 'clock:digital-12h'), 'a slot can hide an asset widget');
  ok(r.sides.start.some((w: any) => w.key === 'avatar:account' && w.origin === 'person' && w.shape === 'hexagon' && w.shapeFrom === 'slot'), 'a person adds a widget with its own shape');
  ok(r.sides.end.some((w: any) => w.key === 'status:online' && w.shape === 'pill' && w.shapeFrom === 'host' && w.attrs['data-fx-wsize'] === 'compact'), 'a plugin chip takes the host chip shape and its hint size');
  eq(f.resolve['asset-only'].out.sides.start.map((w: any) => w.key), ['clock:digital-12h'], 'asset entries keep their place with no slots (nothing moves)');
  eq(f.resolve['asset-only'].out.hidden.map((w: any) => w.key), ['counter:alerts'], 'a hint can hide a widget until the person ticks it');
  eq(f.resolve['legacy-arrange'].out.sides.start.map((w: any) => w.key), ['status:online'], 'the legacy arrangement is honoured as a layer');
  eq(f.resolve['slot-over-arrange'].out.sides.start.map((w: any) => w.key), ['clock:digital-12h'], 'a slot with a side beats the legacy arrangement');
  eq(f.resolve['style-under-slot'].out.sides.end.find((w: any) => w.key === 'status:online').view.size, 'wide', 'the person\'s per-widget choice beats the toolbar style');
  eq(f.resolve['toolbar-style'].out.sides.end.find((w: any) => w.key === 'status:online').view.size, 'icon', 'the toolbar style beats the entry hint');
  eq(f.resolve['no-toolbar'].out, { sides: { start: [], end: [] }, hidden: [] }, 'no toolbar: nothing, run-time and slots included');
  eq(f.resolve['added-missing-asset'].out.sides.start, [], 'a slot for a missing asset or a non-widget type is skipped');
  eq(f.resolve['empty-toolbar'].out, { sides: { start: [], end: [] }, hidden: [] }, 'an empty toolbar resolves to nothing');
  eq(f.resolve['old-asset-no-widgets'].out, { sides: { start: [], end: [] }, hidden: [] }, 'an old toolbar asset with no widgets field stays valid and resolves to nothing');
  for (const size of BANNER_WIDGET_SIZES) for (const show of BANNER_WIDGET_SHOWS) {
    const c = f.resolve[`style-${size}-${show}`];
    const w = [...c.out.sides.start, ...c.out.sides.end][0];
    eq([w.view.size, w.shape, w.attrs['data-fx-shape']], [size, c.toolbar.widgets[0].shape, c.toolbar.widgets[0].shape], `banner widget style ${size} / ${show} with its shape on a toolbar`);
    // the banner's own rule: an icon-only widget on `auto` shows its icon; every other pick is kept as made
    eq(w.view.show, show === 'auto' && size === 'icon' ? 'icon' : show, `show ${show} at size ${size} on a toolbar`);
  }
  for (const [name, c] of Object.entries<any>(f.fit)) eq(fitToolbar(c.plan, c.available), c.fit, `fit ${name}`);
  const fits = Object.values<any>(f.fit).map((c) => c.fit);
  ok(fits.every((x) => Object.values<number>(x.sides).every((w) => w >= 0)), 'sides never go negative');
  eq(f.fit.w600.fit.flex < 400 && f.fit.w600.fit.overflow.length === 0, true, 'the flexible piece shrinks before anything leaves');
  eq(f.fit.w420.fit.flex, 160, 'the flexible piece stops at its minimum');
  eq(f.fit.w420.fit.overflow[0], 'search', 'lowest priority leaves first');
  ok(!f.fit.w120.fit.overflow.includes('avatar') && f.fit.w120.fit.scroll && f.fit.w120.fit.snap.length > 0, 'a widget that may not leave stays; a bar still too wide scrolls with snap points');
  eq(f.fit['no-more-menu-w330'].fit.overflow, [], 'no ⋯ menu: straight to scrolling');
  let s: ToolbarWidgetSlot[] = [];
  const tb = f.resolve['person-slots'].toolbar, cpu = f.resolve['person-slots'].extra[0];
  const drawnOf = (list: ToolbarWidgetSlot[]) => resolveToolbarWidgets({ toolbar: tb, extra: [cpu], slots: list, has }, WIDGET_TYPES).sides;
  const steps: ((x: ToolbarWidgetSlot[]) => ToolbarWidgetSlot[])[] = [
    (x) => addToolbarWidget(x, 'avatar', 'account', 'start', WIDGET_TYPES), (x) => addToolbarWidget(x, 'badge', 'new', 'start', WIDGET_TYPES), (x) => addToolbarWidget(x, 'avatar', 'account', 'top', WIDGET_TYPES),
    (x) => patchToolbarWidget(x, 'avatar:account', { size: 'icon', shape: 'hexagon', priority: 3 }), (x) => patchToolbarWidget(x, 'status:online', { hidden: true }), (x) => patchToolbarWidget(x, 'status:online', { hidden: null }),
    (x) => patchToolbarWidget(x, 'avatar:account', { shape: null, priority: null }), (x) => addToolbarWidget(x, 'avatar', 'account', 'end', WIDGET_TYPES), (x) => moveToolbarWidget(x, drawnOf(x), 'status:online', 'start', 0),
    (x) => moveToolbarWidget(x, drawnOf(x), 'clock:nope', 'start', 0), (x) => removeToolbarWidget(x, 'avatar:account'),
  ];
  f.edits.forEach((e: any, i: number) => { s = steps[i]!(s); eq(s, e.slots, `edit: ${e.step}`); });
  eq(foldArrangement(f.fold.slots, f.fold.arrange), f.fold.out, 'legacy arrangement folds into slots (a placed slot wins, bad sides skipped)');
  for (const [k, v] of Object.entries<any>(f.parse)) eq(parseToolbarWidgetArgs(k.split(':')), v, `parse ${k}`);
  for (const [k, v] of Object.entries<any>(f.parseShape)) eq(parseToolbarWidgetShapeArgs(k.split(':')), v, `parse shape ${k}`);
  const rows = [{ id: 'ui-review.sections', label: 'UI Review sections' }, { id: 'settings-toolbar', label: 'Settings toolbar' }];
  for (const [k, v] of Object.entries<any>(f.match)) eq(matchToolbarInstance(rows, k === '(empty)' ? '' : k), v, `match ${k}`);
  for (const [k, c] of Object.entries<any>(f.entryErrors)) eq(hostEntryErrors('data.widgets[0]', c.entry), c.errors, `entry errors ${k}`);
  for (const [k, c] of Object.entries<any>(f.shapeErrors)) eq(hostShapeErrors(c.shape), c.errors, `shape errors ${k}`);
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
  // toolbar-widgets@1: per-instance hosts, the person's slots, the legacy arrangement folded in (nothing moves)
  const appBefore = rt.toolbarWidgets();
  rt.attachToToolbar({ type: 'status', id: 'online', at: 'end', origin: 'p4', widget: { label: 'CPU' } }, 'settings-toolbar');
  eq(rt.toolbarWidgets(), appBefore, 'a widget attached to another toolbar instance leaves the app toolbar alone');
  eq(rt.toolbarInstanceWidgets('settings-toolbar').sides.end.map((p) => `${p.key}@${p.origin}`), ['status:online@p4'], 'a toolbar with no asset of its own still draws what was attached to it');
  eq(rt.toolbarInstanceWidgets('settings-toolbar').sides.start, [], 'and nothing of the app toolbar\'s own');
  rt.settings.set(ARRANGE_KEY('toolbar'), JSON.stringify({ 'clock:digital-24h': { at: 'start', order: 0 } }));
  eq(rt.toolbarWidgets().start.map((p) => p.key), ['clock:digital-24h'], 'the legacy app-toolbar arrangement still places the widget');
  ok(rt.addToolbarWidget('app', 'avatar', 'account', 'end'), 'add a widget to the app toolbar');
  eq(rt.settings.get(ARRANGE_KEY('toolbar')), null, 'the legacy arrangement is retired once folded in');
  eq(rt.toolbarWidgets().start.map((p) => p.key), ['clock:digital-24h'], 'nothing moved: the clock kept the side the arrangement gave it');
  eq(rt.toolbarWidgets().end.map((p) => `${p.key}@${p.origin}`), ['avatar:account@person'], 'the added widget is drawn at the end');
  ok(rt.setToolbarWidget('app', 'clock:digital-24h', { hidden: true }), 'hide a plugin widget through a slot');
  eq(rt.toolbarWidgets().start.length, 0, 'hidden widgets are not drawn');
  eq(rt.toolbarInstanceWidgets('app').hidden.map((w) => w.key), ['clock:digital-24h'], 'but listed as hidden');
  ok(rt.setToolbarWidgetStyle('app', { size: 'icon' }), 'a toolbar default style');
  eq(rt.toolbarInstanceWidgets('app').sides.end[0]!.view.size, 'icon', 'the style applies to every widget on it');
  ok(rt.setToolbarWidgetStyle(null, { shape: 'squircle' }), 'an app-wide default shape');
  eq(rt.toolbarInstanceWidgets('app').sides.end[0]!.shape, 'squircle', 'the app-wide shape reaches the widget');
  ok(!rt.addToolbarWidget('app', 'clock', 'nope', 'end'), 'an unregistered asset is refused');
  ok(!rt.addToolbarWidget('Bad Instance!', 'avatar', 'account', 'end'), 'a bad instance id is refused');
  rt.resetToolbarWidgets('app');
  eq([rt.settings.get(TOOLBAR_WIDGETS_KEY('app')), rt.toolbarWidgets().end.length, rt.toolbarWidgets().start.map((p) => p.key)], [null, 1, []], 'reset: slots and style gone, the plugin clock back where the asset put it');
  rt.setToolbarWidgetStyle(null, { shape: null });
  rt.detachFromToolbar('p4', 'settings-toolbar');
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
  for (const c of k.themeSwitchPair) eq(JSON.stringify(themeSwitchPair(c.active, c.own, c.others)), JSON.stringify(c.pair), `theme switch pair ${c.active}`);
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

console.log(`check-widgets: ${checks} checks ok`);
