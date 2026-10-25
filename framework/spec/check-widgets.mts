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
import { ATTACHABLE_ASSET_TYPES, AVATAR_SIZE, LOGO_SIZE, PROGRESS_WIDTH, SEARCH_BAR_WIDTH, SPACER_UNITS, TOOLBAR_SIDES, WIDGET_TONES, WIDGET_TYPES, avatarInitials, counterText, hostSpecs, imageSrc, linkHref, moveOnHost, normalizeArrangement, placeOnHost, placeToolbarWidgets, snapIndex, progressPercent, searchBarConfig, statusOn, themeSwitchNext, validateHostAttachments, widgetTone } from '../core/engines/widgets';
import { validateAsset } from '../core/validate';
import { AxfRuntime } from '../core/runtime';

const root = new URL('../', import.meta.url).pathname;
const read = (f: string) => JSON.parse(readFileSync(join(root, 'spec/fixtures', f), 'utf8'));
let checks = 0;
const ok = (c: unknown, msg: string) => { assert.ok(c, msg); checks++; };
const eq = (a: unknown, b: unknown, msg: string) => { assert.deepEqual(a, b, msg); checks++; };

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
  eq(before.placed.right.map((p) => p.key), ['clock:digital-12h'], 'default banner: clock right');
  // a plugin badge, replaced, then detached by origin
  const off = rt.attachToBanner({ type: 'badge', id: 'new', at: 'left', order: 5, origin: 'p1' });
  eq(rt.banner().placed.left.map((p) => `${p.key}@${p.origin}`), ['badge:new@p1'], 'badge attached');
  rt.attachToBanner({ type: 'badge', id: 'new', at: 'right', origin: 'p2' });
  eq(rt.banner().placed.left.length, 0, 'same type+id replaces (moved to the right)');
  eq(rt.banner().placed.right.map((p) => p.key), ['clock:digital-12h', 'badge:new'], 'order: asset clock (10) then runtime badge (1000)');
  rt.detachFromBanner('p2');
  eq(rt.banner().placed.right.map((p) => p.key), ['clock:digital-12h'], 'detached by origin');
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

console.log(`check-widgets: ${checks} checks ok`);
