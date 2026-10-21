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
import { ATTACHABLE_ASSET_TYPES, SEARCH_BAR_WIDTH, TOOLBAR_SIDES, WIDGET_TYPES, hostSpecs, placeToolbarWidgets, searchBarConfig, validateHostAttachments } from '../core/engines/widgets';
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

console.log(`check-widgets: ${checks} checks ok`);
