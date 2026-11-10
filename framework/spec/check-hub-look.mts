/**
 * One look, from axHub, for every app on a source without an app-look layer (Nov 1 2026, Brett: "The apps should only
 * get appearance from axhub period" and "if you select design package in one app it changes it for all! Any theme
 * change applies to all"; design packages are skins since Nov 10 2026).
 *
 * Two runtimes stand in for two apps on one hub document: whatever one changes (a skin, a slot, spacing, hidden
 * chrome, plugin look settings) the other ends up with, exactly, and nothing is skipped when both ship the same shared
 * assets. The retired app-wide tweaks (Sliders, per-asset tokens, rolls, the design package keys) never travel.
 * Run: npx -y tsx framework/spec/check-hub-look.mts
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { mergeAppearance, normalizeAppearance, type AppearanceChange, type AppearanceDocument, type AppearanceSourceState } from '../core/engines/appearance';
import { isAppearanceSetting } from '../core/engines/looksettings';
import { AxfRuntime, type AppearanceSource } from '../core/runtime';
import type { AxfManifest } from '../core/types';

const root = new URL('../', import.meta.url).pathname;
{ const m = new Map<string, string>(); (globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); } }; }
let checks = 0;
const ok = (c: unknown, msg: string) => { assert.ok(c, msg); checks++; };
const eq = (a: unknown, b: unknown, msg: string) => { assert.deepEqual(a, b, msg); checks++; };

// every framework asset, so both apps ship the same shared set
const assets: unknown[] = [];
for (const t of readdirSync(join(root, 'assets'))) {
  const dir = join(root, 'assets', t);
  if (!statSync(dir).isDirectory()) continue;
  for (const n of readdirSync(dir)) if (n.endsWith('.json')) assets.push(JSON.parse(readFileSync(join(dir, n), 'utf8')));
}
const defaults = JSON.parse(readFileSync(join(root, 'defaults.json'), 'utf8'));
const manifest = (id: string): AxfManifest => ({ $axf: 'manifest@1', app: { id, name: id, version: '0' }, framework: { version: '0.2.0', template: 'react-ts' }, targets: ['web'], defaults });

/** The hub's data server in memory: one document, every save merged into it and pushed to every app. */
class MemoryHub {
  doc: AppearanceDocument | null = null;
  readonly sources = new Set<HubLink>();
  save(change: AppearanceChange, by: string) {
    this.doc = mergeAppearance(this.doc, change, by, new Date().toISOString());
    const sent = normalizeAppearance(JSON.parse(JSON.stringify(this.doc)));
    for (const s of this.sources) s.receive(sent);
  }
}
class HubLink implements AppearanceSource {
  st: AppearanceSourceState = { status: 'ready', version: 'v' };
  listeners = new Set<Parameters<AppearanceSource['subscribe']>[0]>();
  constructor(readonly hub: MemoryHub, readonly appId: string) {}
  state() { return this.st; }
  subscribe(l: Parameters<AppearanceSource['subscribe']>[0]) { this.listeners.add(l); return () => { this.listeners.delete(l); }; }
  start() { this.hub.sources.add(this); this.receive(this.hub.doc); }
  stop() { this.hub.sources.delete(this); }
  refresh() { this.receive(this.hub.doc); }
  save(c: AppearanceChange) { queueMicrotask(() => this.hub.save(c, this.appId)); }
  receive(doc: AppearanceDocument | null) { for (const l of this.listeners) { l({ state: this.st }); l({ doc, version: 'v' }); } }
}
const settle = () => new Promise((r) => setTimeout(r, 0));
const lookOf = (rt: AxfRuntime) => {
  const saved = rt.settings.savedValues();
  return {
    active: Object.fromEntries(Object.entries(rt.getState().active).filter(([t]) => t !== 'uac-policy')),
    spacing: rt.spacing(),
    hidden: rt.hiddenSlots(),
    settings: Object.fromEntries(Object.entries(saved).filter(([k]) => isAppearanceSetting(k)).sort(([a], [b]) => a.localeCompare(b))),
  };
};

const hub = new MemoryHub();
const a = new AxfRuntime({ manifest: manifest('app-a'), assets, storageKey: 'hub-look-a' });
const b = new AxfRuntime({ manifest: manifest('app-b'), assets, storageKey: 'hub-look-b' });
a.setRole('admin'); b.setRole('admin');
a.attachAppearanceSource(new HubLink(hub, 'app-a'));
b.attachAppearanceSource(new HubLink(hub, 'app-b'));
await settle();

/* ---- a skin applied in one app is the look in every app ---- */
{
  const skins = a.skinList();
  ok(skins.length >= 2, 'the framework ships skins');
  for (const p of skins.slice(0, 4)) {
    ok(a.applySkin(p.id), `app A applies ${p.id}`);
    await settle(); await settle();
    eq(lookOf(b), lookOf(a), `app B has exactly app A's look after ${p.id} (slots, spacing, hidden chrome, skin settings)`);
    eq(b.appearanceSkipped(), [], `nothing skipped in app B for ${p.id}: both ship the same shared assets`);
  }
  ok(a.applyDesignPackage(skins[1]!.id), 'the old name (applyDesignPackage) still applies a skin');
  await settle(); await settle();
  eq(lookOf(b), lookOf(a), 'and every app follows');
}

/* ---- a single swap, spacing, hidden chrome ---- */
{
  const themes = b.registry.list('color-theme').map((t) => t.id);
  const next = themes.find((id) => id !== b.getState().active['color-theme'])!;
  b.swap('color-theme', next);
  b.setSpacing('regular');
  b.setSlotHidden('toolbar', true);
  await settle(); await settle();
  ok(a.getState().active['color-theme'] === next, 'a colour theme picked in app B shows in app A');
  ok(a.spacing() === 'regular', 'spacing follows');
  ok(a.slotHidden('toolbar'), 'hidden chrome follows');
}

/* ---- plugin look settings are shared; the retired app-wide tweaks are not (Nov 1 2026) ---- */
{
  a.settings.set('axf.banners.prefs', { activity: { launch: 'expanded' } } as never);
  await settle(); await settle();
  eq(b.settings.get('axf.banners.prefs'), { activity: { launch: 'expanded' } }, 'a banner setting made in app A applies in app B');
  ok(hub.doc?.settings && 'axf.banners.prefs' in hub.doc.settings, 'the hub document carries it');
  b.settings.clear('axf.banners.prefs');
  await settle(); await settle();
  ok(a.settings.savedValues()['axf.banners.prefs'] === undefined, 'clearing a look setting in one app clears it in every app');
  ok(!('axf.banners.prefs' in (hub.doc?.settings ?? {})), 'and on the hub');
  a.settings.set('axf.look', { lineHeight: 130 } as never);
  a.settings.set('axf.custom.button', { all: true, shared: { fontSize: 110 }, byId: {} } as never);
  await settle(); await settle();
  ok(!('axf.look' in (hub.doc?.settings ?? {})) && !('axf.custom.button' in (hub.doc?.settings ?? {})), 'the retired Sliders and per-asset tokens never reach the hub');
  ok(b.settings.get('axf.look') === null && b.settings.get('axf.custom.button') === null, 'and never reach another app');
  // a document that still carries them (saved by an older build) is cleaned once, in every app
  hub.save({ settings: { 'axf.look': { lineHeight: 140 }, 'axf.roll.slot.toolbar': true } }, 'old-build');
  await settle(); await settle();
  ok(b.settings.get('axf.look') === null && b.settings.get('axf.roll.slot.toolbar') === null, 'retired settings in an older document are not applied');
  ok(!('axf.look' in (hub.doc?.settings ?? {})) && !('axf.roll.slot.toolbar' in (hub.doc?.settings ?? {})), 'and are removed from the hub document');
  a.settings.clear('axf.look'); a.settings.clear('axf.custom.button');
}

/* ---- a skin's sections are plain slots on the shared document: a pick after it changes only that part, in every app ---- */
{
  ok(a.applySkin('hub-default'), 'app A applies Hub Default');
  await settle(); await settle();
  const st = (rt: AxfRuntime, t: string) => rt.getState().active[t as never];
  eq([st(b, 'style-theme'), st(b, 'color-theme')], ['hub', 'hub-night'], 'app B shows the skin\'s style and colour sections');
  ok(b.swap('style-theme', 'fresh'), 'app B picks another style section');
  await settle(); await settle();
  eq([st(a, 'style-theme'), st(a, 'color-theme')], ['fresh', 'hub-night'], 'app A: style changed, colour still the skin\'s');
  ok(a.swap('color-theme', 'fresh-light'), 'app A picks a colour section');
  await settle(); await settle();
  eq([st(b, 'style-theme'), st(b, 'color-theme')], ['fresh', 'fresh-light'], 'app B: both changed');
  ok(b.applySkin('hub-default'), 'app B applies the skin again');
  await settle(); await settle();
  eq([st(a, 'style-theme'), st(a, 'color-theme')], ['hub', 'hub-night'], 'the skin\'s sections are back in every app');
  // the retired design package keys an older build wrote never travel
  hub.save({ settings: { 'axf.appearance.overrides': { 'style-theme': 'glass-orbit' }, 'axf.appearance.design': 'fresh-night' } }, 'old-build');
  await settle(); await settle();
  ok(a.settings.get('axf.appearance.overrides') === null && a.settings.get('axf.appearance.design') === null, 'retired package keys in an older document are not applied');
  eq([st(a, 'style-theme'), st(a, 'color-theme')], ['hub', 'hub-night'], 'and change nothing');
  ok(!('axf.appearance.overrides' in (hub.doc?.settings ?? {})) && !('axf.appearance.design' in (hub.doc?.settings ?? {})), 'and are removed from the hub document');
}

/* ---- Restore default appearance in one app restores every app ---- */
{
  b.restoreDefaultAppearance();
  await settle(); await settle();
  eq(lookOf(a), lookOf(b), 'Restore default appearance reaches every app');
}

/* ---- an older document without look settings: this app's become the shared ones ---- */
{
  const hub2 = new MemoryHub();
  hub2.doc = normalizeAppearance({ $axf: 'appearance@1', slots: {} });
  const c = new AxfRuntime({ manifest: manifest('app-c'), assets, storageKey: 'hub-look-c' });
  c.setRole('admin');
  c.settings.set('axf.toolbar.collapsed', true as never);
  c.attachAppearanceSource(new HubLink(hub2, 'app-c'));
  await settle(); await settle();
  eq(hub2.doc?.settings, { 'axf.toolbar.collapsed': true }, 'local look settings are sent up once when the hub has none');
  ok(c.settings.get('axf.toolbar.collapsed') !== null, 'and kept here');
}

/* ---- non-look settings never ride the look ---- */
{
  a.settings.set('axf.lock.appearance', true as never);
  await settle(); await settle();
  ok(!('axf.lock.appearance' in (hub.doc?.settings ?? {})), 'the lock stays on its device');
  a.settings.clear('axf.lock.appearance');
}

ok(!existsSync(join(root, '..', 'apps', 'console-web', 'src', 'interfaceTabs.tsx')), 'the console has no interface look tabs');

/* ---- the retired design-package slot an older build wrote: dropped on read, gone after the next write ---- */
{
  hub.doc = { ...hub.doc!, slots: { ...(hub.doc?.slots ?? {}), 'design-package': 'fresh-night', 'style-package': 'boardroom' } };
  for (const s of hub.sources) s.receive(normalizeAppearance(JSON.parse(JSON.stringify(hub.doc))));
  await settle(); await settle();
  ok(hub.doc?.slots?.['design-package'] === 'fresh-night', 'the stored document carries the retired slots');
  ok(!a.appearanceSkipped().some((s) => s.startsWith('design-package') || s.startsWith('style-package')), 'no app sees them (dropped on read, not even "skipped")');
  a.setSpacing('compact');
  await settle(); await settle();
  ok(hub.doc?.slots && !('design-package' in hub.doc.slots) && !('style-package' in hub.doc.slots), 'the next write by any app drops them from the hub');
}

/* ---- Restore default = the app's default skin in full (Nov 3 2026; skins since Nov 10 2026) ---- */
{
  const def = defaults.skin as string;
  ok(a.registry.has('skin', def), `the default look is a skin (${def})`);
  const skin = a.skinList().find((s) => s.id === def)!.data;
  ok(skin.extras?.spacing && skin.extras.hidden && Object.keys(skin.extras.hidden).length, 'the default skin carries spacing and chrome');
  ok(a.swap('color-theme', 'fresh-light'), 'app A changes the colour section');
  b.setSpacing('regular');
  await settle(); await settle();
  b.restoreDefaultAppearance();
  await settle(); await settle();
  for (const [name, rt] of [['A', a], ['B', b]] as const) {
    const st = (t: string) => rt.getState().active[t as never];
    eq([st('style-theme'), st('color-theme'), st('layout')], [skin.styleTheme, skin.colorTheme, skin.layoutTheme], `app ${name}: back on ${def}, its sections`);
    eq(rt.spacing(), skin.extras!.spacing, `app ${name}: the skin's spacing`);
    for (const [t, hidden] of Object.entries(skin.extras!.hidden!)) eq(rt.slotHidden(t as never), hidden, `app ${name}: the skin's chrome (${t})`);
    eq(rt.appliedSkin(), def, `app ${name}: the default skin counts as applied`);
  }
  eq(lookOf(a), lookOf(b), 'both apps have the same look after Restore');
}

/* ---- the retired appearance-package slot an older build wrote: dropped on read, gone after the next write ---- */
{
  // the hub stores raw JSON: a document an older build PUT still carries the slot
  hub.doc = { ...hub.doc!, slots: { ...(hub.doc?.slots ?? {}), 'appearance-package': 'fresh' } };
  for (const s of hub.sources) s.receive(normalizeAppearance(JSON.parse(JSON.stringify(hub.doc)))); // a source parses the text it reads
  await settle(); await settle();
  ok(hub.doc?.slots?.['appearance-package'] === 'fresh', 'the stored document carries the retired slot');
  ok(!a.appearanceSkipped().some((s) => s.startsWith('appearance-package')), 'no app sees it (dropped on read, not even "skipped")');
  a.setSpacing('compact');
  await settle(); await settle();
  ok(hub.doc?.slots && !('appearance-package' in hub.doc.slots), 'the next write by any app drops it from the hub');
}

/* ---- the three real apps (GizmoX AI Studio, axHub web, AmberX) on one hub: one default look, every change reaches all ---- */
{
  const APPS = ['console-web', 'axhub-web', 'amberx-droid'];
  const appsRoot = join(root, '..', 'apps');
  const loadDir = (dir: string): unknown[] => {
    if (!existsSync(dir)) return [];
    return readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? loadDir(p) : n.endsWith('.json') ? [JSON.parse(readFileSync(p, 'utf8'))] : []; });
  };
  const hub3 = new MemoryHub();
  const apps = APPS.map((app) => {
    const base = join(appsRoot, app);
    // the order main.tsx registers them: every shared asset, then the app's own, then the shared ids it tunes (overrides)
    const assets = [...loadDir(join(base, 'src', 'axf', 'assets')), ...loadDir(join(base, 'src', 'assets')), ...loadDir(join(base, 'src', 'assets-overrides'))];
    const m = JSON.parse(readFileSync(join(base, 'axf.manifest.json'), 'utf8')) as AxfManifest;
    const rt = new AxfRuntime({ manifest: m, assets, storageKey: `hub-look-${app}` });
    rt.setRole('admin');
    return { app, rt, m };
  });
  const st = (rt: AxfRuntime, t: string) => rt.getState().active[t as never] as string;
  const sharedLook = (rt: AxfRuntime) => ({
    style: st(rt, 'style-theme'), colour: st(rt, 'color-theme'), layout: st(rt, 'layout'),
    spacing: rt.spacing(),
    // what the hub carries: hidden-chrome overrides (an app's own default chrome stays its own) and the look settings
    hidden: Object.fromEntries(Object.entries(rt.settings.savedValues()).filter(([k]) => k.startsWith('axf.hide.')).sort(([x], [y]) => x.localeCompare(y))),
    settings: Object.fromEntries(Object.entries(rt.settings.savedValues()).filter(([k]) => isAppearanceSetting(k)).sort(([x], [y]) => x.localeCompare(y))),
  });
  const frameworkThin = JSON.parse(readFileSync(join(root, 'assets', 'banner', 'amberx-thin.json'), 'utf8'));
  for (const { app, rt, m } of apps) {
    eq([m.defaults['skin' as never], m.defaults['style-theme'], m.defaults['color-theme']], ['hub-default', 'hub', 'hub-night'], `${app}: the manifest's default look is the Hub Default skin (hub + hub-night)`);
    eq([rt.appliedSkin(), st(rt, 'style-theme'), st(rt, 'color-theme')], ['hub-default', 'hub', 'hub-night'], `${app}: starts on Hub Default`);
    eq(rt.registry.get('banner', 'amberx-thin')!.data, frameworkThin.data, `${app}: the thin banner is the framework's (no per-app copy)`);
    ok((rt.registry.get('banner', 'amberx-thin')!.data as { attach: { type: string }[] }).attach.some((x) => x.type === 'theme-switch'), `${app}: the thin banner carries the day/night switch`);
    ok(!existsSync(join(appsRoot, app, 'src', 'assets-overrides', 'banner')), `${app}: no banner override folder`);
    rt.attachAppearanceSource(new HubLink(hub3, app));
  }
  await settle(); await settle();
  const [console_, axhub, amberx] = apps.map((x) => x.rt);
  // the console applies a skin: axHub web and AmberX show exactly that look
  ok(console_.applySkin('fresh-night'), 'the console applies Fresh Night');
  await settle(); await settle();
  for (const { app, rt } of apps.slice(1)) { eq(sharedLook(rt), sharedLook(console_), `${app} has the console's look`); eq(rt.appearanceSkipped(), [], `${app} skipped nothing (ships every shared asset)`); }
  // axHub web picks a colour section: only the colour changes, in all three
  ok(axhub.swap('color-theme', 'hub-night'), 'axHub web picks Hub Night');
  await settle(); await settle();
  for (const { app, rt } of apps) eq([st(rt, 'style-theme'), st(rt, 'color-theme')], ['fresh', 'hub-night'], `${app}: colour changed, style still the skin's`);
  // the banner's day / night switch is a colour pick too
  ok(console_.swap('color-theme', 'fresh-light'), 'the console flips to a day colour (the banner switch does this)');
  await settle(); await settle();
  for (const { app, rt } of apps) eq(st(rt, 'color-theme'), 'fresh-light', `${app}: day colour`);
  // AmberX applies Hub Default again: every app on the default look
  ok(amberx.applySkin('hub-default'), 'AmberX applies Hub Default');
  await settle(); await settle();
  for (const { app, rt } of apps) eq([st(rt, 'style-theme'), st(rt, 'color-theme'), rt.spacing(), rt.slotHidden('toolbar')], ['hub', 'hub-night', 'tight', true], `${app}: Hub Default in full`);
  for (const { app, rt } of apps) eq(st(rt, 'banner'), 'amberx-thin', `${app}: Hub Default's banner (the compact thin bar) in every app`);
  for (const { app, rt } of apps.slice(1)) eq(sharedLook(rt), sharedLook(console_), `${app}: the same look as the console`);
  // Restore in axHub web = Hub Default again, everywhere
  ok(console_.swap('style-theme', 'glass-orbit'), 'the console changes the style section');
  await settle(); await settle();
  axhub.restoreDefaultAppearance();
  await settle(); await settle();
  for (const { app, rt } of apps) eq([st(rt, 'style-theme'), st(rt, 'color-theme')], ['hub', 'hub-night'], `${app}: Restore from axHub web puts every app back on Hub Default`);
  ok(!(hub3.doc?.settings && 'axf.appearance.overrides' in hub3.doc.settings), 'no retired override key on the hub');
}

console.log(`check-hub-look: ${checks} checks passed`);
