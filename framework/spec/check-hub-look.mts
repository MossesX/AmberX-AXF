/**
 * One look, from axHub, for every app (Nov 1 2026, Brett: "The apps should only get appearance from axhub period" and
 * "if you select design package in one app it changes it for all! Any theme change applies to all").
 *
 * Two runtimes stand in for two apps on one hub document: whatever one changes (a design package, a slot, spacing,
 * hidden chrome, plugin look settings, the design overrides) the other ends up with, exactly, and nothing is skipped
 * when both ship the same shared assets. The retired app-wide tweaks (Sliders, per-asset tokens, rolls) never travel.
 * Run: npx -y tsx framework/spec/check-hub-look.mts
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { mergeAppearance, normalizeAppearance, type AppearanceChange, type AppearanceDocument, type AppearanceSourceState } from '../core/engines/appearance';
import { isAppearanceSetting } from '../core/engines/designpackage';
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

/* ---- a design package picked in one app is the look in every app ---- */
{
  const packages = a.registry.list('design-package');
  ok(packages.length >= 2, 'the framework ships design packages');
  for (const p of packages.slice(0, 4)) {
    ok(a.applyDesignPackage(p.id), `app A applies ${p.id}`);
    await settle(); await settle();
    eq(lookOf(b), lookOf(a), `app B has exactly app A's look after ${p.id} (slots, spacing, hidden chrome, package settings)`);
    eq(b.appearanceSkipped(), [], `nothing skipped in app B for ${p.id}: both ship the same shared assets`);
  }
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

/* ---- precedence: a loaded design package wins; a later pick overrides only its part (Nov 1 2026) ---- */
{
  ok(a.applyDesignPackage('hub-default'), 'app A loads Hub Default');
  await settle(); await settle();
  const st = (rt: AxfRuntime, t: string) => rt.getState().active[t as never];
  eq([st(b, 'design-package'), st(b, 'style-theme'), st(b, 'color-theme')], ['hub-default', 'hub', 'hub-night'], 'app B shows the package\'s style and colour');
  // a stale style / colour slot in the document is ignored while the package is loaded
  hub.save({ slots: { 'style-theme': 'glass-orbit', 'color-theme': 'arctic-daylight' } }, 'old-build');
  await settle(); await settle();
  eq([st(a, 'style-theme'), st(a, 'color-theme')], ['hub', 'hub-night'], 'individual picks without an override are not applied (app A)');
  eq([st(b, 'style-theme'), st(b, 'color-theme')], ['hub', 'hub-night'], 'individual picks without an override are not applied (app B)');
  // picking a style in app B overrides only the style, in every app
  ok(b.swap('style-theme', 'fresh'), 'app B picks the Fresh style');
  await settle(); await settle();
  eq([st(a, 'style-theme'), st(a, 'color-theme')], ['fresh', 'hub-night'], 'app A: style overridden, colour still the package\'s');
  eq(a.designOverrides(), { 'style-theme': 'fresh' }, 'app A sees the override');
  // picking the package's own style again drops the override
  ok(a.swap('style-theme', 'hub'), 'app A picks the package\'s style again');
  await settle(); await settle();
  eq(b.designOverrides(), {}, 'override dropped everywhere');
  // colour override, then reloading the package clears it
  ok(a.swap('color-theme', 'fresh-light'), 'app A picks a colour');
  await settle(); await settle();
  eq([st(b, 'style-theme'), st(b, 'color-theme')], ['hub', 'fresh-light'], 'app B: colour overridden, style the package\'s');
  ok(b.applyDesignPackage('hub-default'), 'app B loads the package again');
  await settle(); await settle();
  eq([st(a, 'style-theme'), st(a, 'color-theme'), a.designOverrides()], ['hub', 'hub-night', {}], 'reloading the package clears the overrides in every app');
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

console.log(`check-hub-look: ${checks} checks passed`);
