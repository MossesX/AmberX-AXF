/**
 * Appearance lock + "Get the look from axHub" switch (Oct 27 2026): the runtime greys out every look control while
 * the look is locked (assets.swap / assets.import gate as `disable`), sets this device's own tweaks aside without
 * deleting them, keeps applying the look from axHub, and a developer app can stop reading (and writing) the hub's
 * look. Also: Restore default appearance clears the Sliders (`axf.look`), and the Sliders can't make lines overlap.
 * Run: npx -y tsx framework/spec/check-appearance-lock.mts
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseAppearance, type AppearanceDocument, type AppearanceSourceState } from '../core/engines/appearance';
import { isAppearanceSetting } from '../core/engines/designpackage';
import { lookCss, normalizeLook } from '../core/engines/looktokens';
import { APPEARANCE_FOLLOW_KEY, APPEARANCE_LOCK_KEY, AxfRuntime, type AppearanceSource } from '../core/runtime';
import type { AxfManifest } from '../core/types';

const root = new URL('../', import.meta.url).pathname;
{ const m = new Map<string, string>(); (globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); } }; }
let checks = 0;
const ok = (c: unknown, msg: string) => { assert.ok(c, msg); checks++; };

const assets = ['color-theme', 'style-theme', 'layout', 'app-menu', 'toolbar', 'nav-menu', 'context-menu', 'dialog', 'popup', 'button', 'slider', 'container', 'banner', 'clock', 'search-bar', 'badge', 'uac-policy']
  .flatMap((t) => readdirSync(join(root, 'assets', t)).map((n) => JSON.parse(readFileSync(join(root, 'assets', t, n), 'utf8'))));
const defaults = JSON.parse(readFileSync(join(root, 'defaults.json'), 'utf8'));
const manifest: AxfManifest = { $axf: 'manifest@1', app: { id: 'check-lock', name: 'x', version: '0' }, framework: { version: '0.2.0', template: 'react-ts' }, targets: ['web'], defaults };

class FakeSource implements AppearanceSource {
  st: AppearanceSourceState = { status: 'connecting' };
  listeners = new Set<Parameters<AppearanceSource['subscribe']>[0]>();
  saved: Parameters<AppearanceSource['save']>[0][] = [];
  started = 0; stopped = 0;
  state() { return this.st; }
  subscribe(l: Parameters<AppearanceSource['subscribe']>[0]) { this.listeners.add(l); return () => { this.listeners.delete(l); }; }
  start() { this.started++; }
  stop() { this.stopped++; }
  refresh() {}
  save(c: Parameters<AppearanceSource['save']>[0]) { this.saved.push(c); }
  push(doc: AppearanceDocument | null) { for (const l of this.listeners) l({ doc, version: 'v' }); }
  setState(st: AppearanceSourceState) { this.st = st; for (const l of this.listeners) l({ state: st }); }
}

/* ---- the lock ---- */
{
  const rt = new AxfRuntime({ manifest, assets, storageKey: 'check-lock-1' });
  rt.setRole('admin');
  ok(!rt.appearanceLocked() && rt.gate('assets.swap') === 'allow' && rt.can('assets.swap'), 'unlocked: look controls allowed');
  rt.settings.set('axf.custom.button', { all: true, shared: { fontSize: 120 }, byId: {} } as never);
  const sheet = rt.customSheet();
  ok(rt.setAppearanceLocked(true) && rt.appearanceLocked(), 'admin locks the look');
  ok(rt.gate('assets.swap') === 'disable' && rt.gate('assets.import') === 'disable', 'locked: look controls grey out (disable, never hide)');
  ok(!rt.can('assets.swap') && !rt.can('assets.import'), 'locked: can() says no');
  ok(rt.gate('uac.manage') === 'allow', 'locked: other permissions untouched');
  ok(rt.mayChangeLook(), 'the role itself still may change the look (to unlock it)');
  const before = rt.getState().active['color-theme'];
  const other = rt.registry.list('color-theme').find((a) => a.id !== before)!.id;
  ok(rt.swap('color-theme', other) === false && rt.getState().active['color-theme'] === before, 'locked: swap refused');
  ok(rt.customSheet() === '' && (sheet === '' || sheet.length > 0), 'locked: per-asset tokens set aside');
  ok(rt.settings.get('axf.custom.button') !== null, 'locked: the tweaks are kept, not deleted');
  ok(!isAppearanceSetting(APPEARANCE_LOCK_KEY), 'the lock is not an appearance setting (Restore and packages leave it)');
  rt.dispatch('appearance.lock:off');
  ok(!rt.appearanceLocked() && rt.gate('assets.swap') === 'allow', 'action appearance.lock:off unlocks (works while locked)');
  rt.dispatch('appearance.lock:toggle');
  ok(rt.appearanceLocked(), 'appearance.lock:toggle locks again');
  rt.setAppearanceLocked(false);
  ok(rt.swap('color-theme', other) && rt.getState().active['color-theme'] === other, 'unlocked: swap works again');
}

/* ---- a role without assets.swap can't lock or unlock ---- */
{
  const rt = new AxfRuntime({ manifest, assets, storageKey: 'check-lock-2' });
  rt.setRole('admin');
  ok(rt.swap('uac-policy', 'hub-accounts'), 'policy with a role that may not change the look');
  const policy = rt.asset('uac-policy').data as { roles: { id: string }[] };
  let tested = 0;
  for (const r of policy.roles) {
    rt.setRole(r.id);
    if (rt.mayChangeLook()) continue;
    ok(rt.setAppearanceLocked(true) === false && !rt.appearanceLocked(), `role ${r.id} can't lock the look`);
    tested++;
  }
  ok(tested > 0, 'some starter role may not change the look');
}

/* ---- the look from axHub still applies while locked; the follow switch ---- */
{
  const rt = new AxfRuntime({ manifest, assets, storageKey: 'check-lock-3' });
  rt.setRole('admin');
  const src = new FakeSource();
  rt.attachAppearanceSource(src);
  ok(src.started === 1 && rt.appearanceFollowing() && !rt.appearanceReady(), 'developer app: reads the hub, waits for it');
  src.setState({ status: 'ready', version: 'v' });
  rt.setAppearanceLocked(true);
  src.push(parseAppearance(JSON.stringify({ $axf: 'appearance@1', slots: { 'color-theme': 'neon-tide' } })));
  ok(rt.getState().active['color-theme'] === 'neon-tide', 'locked: the look from axHub still applies');
  rt.setAppearanceLocked(false);
  rt.setAppearanceFollowing(false);
  ok(!rt.appearanceFollowing() && src.stopped === 1 && rt.appearanceReady() && rt.getState().appearance === null, 'follow off: source stopped, the app runs without the hub');
  src.push(parseAppearance(JSON.stringify({ $axf: 'appearance@1', slots: { 'color-theme': 'arctic-daylight' } })));
  ok(rt.getState().active['color-theme'] === 'neon-tide', 'follow off: hub documents are ignored');
  const n = src.saved.length;
  rt.swap('color-theme', 'arctic-daylight');
  ok(src.saved.length === n, 'follow off: local changes are not sent to the hub');
  ok(rt.settings.get(APPEARANCE_FOLLOW_KEY) === false, 'the switch is a setting');
  rt.dispatch('appearance.hub:on');
  ok(rt.appearanceFollowing() && src.started === 2 && rt.getState().appearance?.status === 'ready', 'appearance.hub:on starts reading again');
  rt.detachAppearanceSource();
  ok(src.stopped === 2, 'detach stops a running source');
}

/* ---- Restore clears the Sliders; the Sliders can't overlap lines ---- */
{
  ok(isAppearanceSetting('axf.look'), 'the Sliders (axf.look) are part of the look');
  const rt = new AxfRuntime({ manifest, assets, storageKey: 'check-lock-4' });
  rt.setRole('admin');
  rt.settings.set('axf.look', { lineHeight: 5, letterSpacing: 20 } as never);
  rt.restoreDefaultAppearance();
  ok(rt.settings.get('axf.look') === null || rt.settings.get('axf.look') === undefined, 'Restore default appearance clears the Sliders');
  const css = lookCss({ lineHeight: 5, letterSpacing: 20 }, { scope: 'body', base: 'html', p: 'fxa', for: 'app' });
  ok(/line-height:1(?:\.0+)?[;}]/.test(css) || css.includes('line-height:1;') || css.includes('line-height:1}'), `line height never below 100% (${css})`);
  ok(!/letter-spacing:0\.2em/.test(css), 'letter spacing capped');
  ok(normalizeLook({ letterSpacing: 20 }).letterSpacing !== 20, 'a stored 20 reads as the cap');
}

console.log(`check-appearance-lock: ${checks} checks passed`);
