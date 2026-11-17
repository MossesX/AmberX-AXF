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
import { BANNER_WIDGET_CUSTOM_PATH, BANNER_WIDGET_SHAPES, BANNER_WIDGET_SHAPE_DEFAULT, BANNER_WIDGET_SHAPE_TOKENS, BANNER_WIDGET_WIDTH, WIDGET_ICON_OWN, WIDGET_SHAPE_CURVE_STEPS, WIDGET_SHAPE_FRAME, WIDGET_SHAPE_HEXAGON_CLIP, WIDGET_SHAPE_RADIUS, bannerWidgetCapCss, bannerWidgetEmpty, bannerWidgetNumber, bannerWidgetView, customPathClip, findBannerWidget, flattenCustomPath, hostWidgetShapeTokens, migrateBannerWidgetPrefs, normalizeBannerWidgetPrefs, overflowWidgets, patchBannerWidget, resolveWidgetShape, widgetShapeTokens } from '../core/engines/bannerwidgets';
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
  // widget-shape@1 migration: the old implicit circle is written out once, nothing else moves, a second run is a no-op
  const mig = migrateBannerWidgetPrefs({ 'status:a': { size: 'wide' }, 'clock:c': { shape: 'pill' }, 'bad key': { hidden: true } });
  eq(mig, { prefs: { 'status:a': { size: 'wide', shape: 'circle' }, 'clock:c': { shape: 'pill' } }, changed: true, migrated: ['status:a'] }, 'migrate: circle written out where no shape was saved');
  eq(migrateBannerWidgetPrefs(mig.prefs).changed, false, 'migrate: idempotent');
  eq(migrateBannerWidgetPrefs(null), { prefs: {}, changed: false, migrated: [] }, 'migrate: nothing saved, nothing to do');
  eq(bannerWidgetView('status', null, null).shape, 'circle', 'a widget is a circle by default');
  eq(bannerWidgetView('status', { shape: 'hexagon' }, { shape: 'square' }).shape, 'square', 'the shape pick beats the hint');
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

// widget-shape.json (Nov 16 2026): shapes, custom outlines, invalid input, icon overrides, host token, fold, normalize, migration
{
  const f = read('widget-shape.json');
  eq(WIDGET_SHAPE_FRAME, f.frame, 'widget-shape frame');
  eq([...BANNER_WIDGET_SHAPES], f.shapes, 'widget shapes');
  eq(BANNER_WIDGET_SHAPE_DEFAULT, f.default, 'default shape is circle');
  eq(BANNER_WIDGET_SHAPE_TOKENS, f.tokens, 'widget shape tokens');
  eq(WIDGET_SHAPE_RADIUS, f.radius, 'shape radii');
  eq(WIDGET_SHAPE_HEXAGON_CLIP, f.hexagonClip, 'hexagon clip');
  eq(WIDGET_ICON_OWN, f.iconOwn, 'own icon token value');
  eq({ ...BANNER_WIDGET_CUSTOM_PATH, curveSteps: WIDGET_SHAPE_CURVE_STEPS }, f.customPath, 'custom path limits');
  const hasGlyph = (pack: string, id: string) => ((f.packs[pack] as string[] | undefined) ?? []).includes(id);
  const replay = (c: any, name: string) => {
    const v = bannerWidgetView('status', c.hint ?? null, c.pref ?? null);
    const r = resolveWidgetShape(v, hasGlyph);
    eq({ shape: v.shape, ...(v.customPath !== undefined ? { customPath: v.customPath } : {}), iconOverride: v.iconOverride, shapeSource: v.shapeSource }, c.view, `${name}: view`);
    eq(r, c.resolved, `${name}: resolved`);
    eq(widgetShapeTokens(r), c.tokens, `${name}: tokens`);
  };
  // the fixture records what each case was built from; rebuild the inputs the same way gen-fixtures does
  const inputs: Record<string, { pref?: unknown; hint?: unknown }> = {
    ...Object.fromEntries(BANNER_WIDGET_SHAPES.filter((s) => s !== 'custom').map((s) => [`shape.${s}`, { pref: { shape: s } }])),
    'custom.with-path': { pref: { shape: 'custom', customPath: f.paths.diamond.path } },
    'custom.bad-path': { pref: { shape: 'custom', customPath: f.paths['out-of-box'].path } },
    'custom.no-path': { pref: { shape: 'custom' } },
    'custom.path-from-hint': { pref: { shape: 'custom' }, hint: { shape: 'custom', customPath: f.paths['relative-square'].path } },
    'custom.pick-ignores-hint-path-when-not-custom': { pref: { shape: 'square' }, hint: { shape: 'custom', customPath: f.paths.diamond.path } },
    'invalid.unknown-shape': { pref: { shape: 'blob' } },
    'invalid.shape-not-text': { pref: { shape: 4 } },
    'icon.pack-and-glyph': { pref: { iconOverride: { pack: 'pack-021', id: 'bell' } } },
    'icon.glyph-missing': { pref: { iconOverride: { pack: 'pack-021', id: 'nope' } } },
    'icon.pack-missing': { pref: { iconOverride: { pack: 'pack-999', id: 'bell' } } },
    'icon.from-hint': { hint: { iconOverride: { pack: 'amberx-outline', id: 'home' } } },
    'icon.pick-beats-hint': { pref: { iconOverride: { pack: 'pack-021', id: 'star' } }, hint: { iconOverride: { pack: 'amberx-outline', id: 'home' } } },
    'icon.with-hexagon': { pref: { shape: 'hexagon', iconOverride: { pack: 'pack-021', id: 'bell' } } },
    'fold.default': {},
    'fold.hint': { hint: { shape: 'pill' } },
    'fold.pick': { pref: { shape: 'rounded' }, hint: { shape: 'pill' } },
    'fold.bad-pick-falls-to-hint': { pref: { shape: 'blob' }, hint: { shape: 'pill' } },
  };
  for (const [name, inp] of Object.entries(inputs)) { const [group, key] = name.split('.') as [string, string]; ok(f[group]?.[key], `${name} in the fixture`); replay({ ...inp, ...f[group][key] }, name); }
  eq(Object.keys(f.shape).sort(), BANNER_WIDGET_SHAPES.filter((s) => s !== 'custom').sort(), 'every named shape has a golden case');
  for (const [name, c] of Object.entries<any>(f.paths)) { eq(flattenCustomPath(c.path), c.points, `path ${name}: points`); eq(customPathClip(c.path), c.clip, `path ${name}: clip`); }
  ok(f.paths.diamond.clip === 'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)', 'diamond is an exact four-corner polygon');
  for (const name of ['out-of-box', 'two-points', 'two-subpaths', 'arc', 'unclosed', 'no-move', 'odd-numbers', 'bad-chars', 'too-long', 'empty', 'not-text', 'null']) ok(f.paths[name].clip === null, `path ${name} is refused`);
  for (const name of ['diamond', 'relative-square', 'rounded-leaf', 'quadratic-drop', 'smooth-quadratic', 'triangle-decimals']) ok(typeof f.paths[name].clip === 'string' && f.paths[name].clip.startsWith('polygon('), `path ${name} compiles to a polygon`);
  eq(resolveWidgetShape({ shape: 'blob' as never, customPath: undefined, iconOverride: null, shapeSource: 'pick' }, hasGlyph), f.invalid['unknown-shape-resolved-directly'], 'unknown shape at resolve time falls back and says so');
  eq(resolveWidgetShape({ shape: 'circle', customPath: undefined, iconOverride: { pack: 'Bad Id', id: 'bell' } as never, shapeSource: 'default' }, hasGlyph), f.invalid['override-malformed'], 'malformed override falls back and says so');
  ok(f.custom['bad-path'].resolved.shape === 'circle' && f.custom['bad-path'].resolved.fell.length === 1, 'a bad custom path draws a circle and reports it');
  ok(f.icon['glyph-missing'].resolved.icon === 'own' && f.icon['pack-and-glyph'].resolved.icon === 'pack-021/bell', 'icon override only once the glyph exists');
  ok(f.fold.default.resolved.explicit === false && f.fold.hint.resolved.explicit && f.fold.pick.resolved.explicit, 'only a chosen shape is explicit');
  for (const [name, t] of Object.entries<any>(f.host)) eq(hostWidgetShapeTokens(name === 'empty' ? '' : name), t, `host shape ${name}`);
  eq(f.host.custom, f.host.circle, 'the host never takes custom');
  eq(normalizeBannerWidgetPrefs(f.normalize.in), f.normalize.out, 'normalize the new fields');
  eq(f.normalize.out, { 'status:a': { shape: 'hexagon', customPath: 'M0 0 L100 0 L50 100 Z', iconOverride: { pack: 'pack-021', id: 'bell' } } }, 'normalize drops an unknown shape, an overlong path and a malformed override');
  for (const [name, c] of Object.entries<any>(f.migrate)) { const { in: raw, ...want } = c; eq(migrateBannerWidgetPrefs(raw), want, `migrate ${name}`); eq(migrateBannerWidgetPrefs(want.prefs).changed, false, `migrate ${name} again: no change`); }
  ok(f.migrate['old-choices'].migrated.length === 2 && f.migrate['already-shaped'].changed === false, 'migration touches only choices without a shape');
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

// widget-shape@1 context menu: Shape ▸ and Change icon… only on a banner widget, filled with that widget's key
{
  const assets = readdirSync(join(root, 'assets')).flatMap((t) => readdirSync(join(root, 'assets', t)).filter((n) => n.endsWith('.json')).map((n) => JSON.parse(readFileSync(join(root, 'assets', t, n), 'utf8'))));
  const defaults = JSON.parse(readFileSync(join(root, 'defaults.json'), 'utf8'));
  const rt = new AxfRuntime({ manifest: { app: { id: 'test', name: 'Test' }, defaults } as never, assets, storageKey: 'test:widget-menu' });
  rt.contextBannerWidget = null;
  ok(!rt.contributedContext('banner').some((e) => e.label === 'Shape'), 'widget menu: not on the banner background');
  rt.contextBannerWidget = 'clock:digital-12h';
  const menu = rt.contributedContext('banner');
  const shape = menu.find((e) => e.label === 'Shape');
  eq(shape?.items?.map((e) => e.action), ['banner.widget:clock:digital-12h:circle', 'banner.widget:clock:digital-12h:square', 'banner.widget:clock:digital-12h:rounded', 'banner.widget:clock:digital-12h:pill', 'banner.widget:clock:digital-12h:hexagon', 'banner.widget.custom-shape:clock:digital-12h'], 'widget menu: every shape for the hit widget, Custom… opens the editor');
  eq(menu.find((e) => e.label === 'Change icon…')?.action, 'banner.widget.icon-picker:clock:digital-12h', 'widget menu: Change icon… for the hit widget');
  rt.dispatch(shape!.items![4]!.action!);
  eq(rt.bannerWidgetShape('clock:digital-12h').shape, 'hexagon', 'widget menu: Hexagon sets the shape');
  rt.dispatch('banner.widget.shape:clock:digital-12h:pill');
  eq(rt.bannerWidgetShape('clock:digital-12h').shape, 'pill', 'banner.widget.shape sets the shape');
  rt.dispatch('banner.widget.shape:clock:digital-12h:path=M50 0 L100 50 L50 100 L0 50 Z');
  eq(rt.bannerWidgetShape('clock:digital-12h').shape, 'custom', 'banner.widget.shape with path= sets a custom outline');
  rt.dispatch('banner.widget.reset:clock:digital-12h');
  eq(rt.bannerWidgetShape('clock:digital-12h').shape, 'circle', 'banner.widget.reset puts the circle back');
  rt.contextBannerWidget = 'nope:x';
  ok(!rt.contributedContext('banner').some((e) => e.label === 'Shape'), 'widget menu: an unknown widget gets none');
}

// custom shape editor presets: every one is an outline the engine accepts, ids unique
{
  const { WIDGET_SHAPE_PRESETS, customPathClip } = await import('../core/engines/bannerwidgets');
  ok(WIDGET_SHAPE_PRESETS.length >= 6, 'presets: at least six ready-made outlines');
  eq(new Set(WIDGET_SHAPE_PRESETS.map((p) => p.id)).size, WIDGET_SHAPE_PRESETS.length, 'presets: ids unique');
  for (const p of WIDGET_SHAPE_PRESETS) ok(customPathClip(p.path)?.startsWith('polygon(') === true, `preset ${p.id}: the engine accepts it`);
}

// migration renders as before: a widget saved before widget-shape@1 (no shape) draws a circle with nothing inline,
// so its item looks exactly as it did (no data-fx-shaped, no token style; the host's default circle token stands)
{
  const { widgetShapeAttrs } = await import('../react/components/widgetShape');
  const assets = readdirSync(join(root, 'assets')).flatMap((t) => readdirSync(join(root, 'assets', t)).filter((n) => n.endsWith('.json')).map((n) => JSON.parse(readFileSync(join(root, 'assets', t, n), 'utf8'))));
  const defaults = JSON.parse(readFileSync(join(root, 'defaults.json'), 'utf8'));
  const rt = new AxfRuntime({ manifest: { app: { id: 'test', name: 'Test' }, defaults } as never, assets, storageKey: 'test:widget-migrate' });
  const old = rt.bannerWidgetShape('clock:digital-12h');
  eq([old.shape, old.explicit], ['circle', false], 'migration: an old widget is a circle, not a choice');
  const a = widgetShapeAttrs(old);
  eq([a.attrs['data-fx-shaped'], Object.keys(a.style).length], [undefined, 0], 'migration: nothing inline, the item renders as before');
  rt.dispatch('banner.widget:clock:digital-12h:hexagon');
  const now = widgetShapeAttrs(rt.bannerWidgetShape('clock:digital-12h'));
  eq([now.attrs['data-fx-shaped'], now.attrs['data-fx-wshape'], Object.keys(now.style).sort()], ['', 'hexagon', ['--fx-widget-icon', '--fx-widget-shape-clip', '--fx-widget-shape-radius']], 'a chosen shape: shaped item with the three tokens inline');
}

console.log(`check-widgets: ${checks} checks ok`);
