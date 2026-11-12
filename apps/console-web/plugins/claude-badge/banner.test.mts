// @ts-nocheck: a Node test, not part of the console's build
/**
 * Banner guard: the connection badges (Claude, VPS, axHub, AmberX) are on the console's banner by default.
 *
 *   npx -y tsx apps/console-web/plugins/claude-badge/banner.test.mts
 *
 * Builds the console's own runtime (its framework copy, manifest and every asset it ships), attaches each badge exactly
 * as the plugin does (web/model.ts badgeAttachment) and asks the banner what it draws. Fails when the banner draws zero
 * connection badges, or drops any of them, with default settings, under every banner asset and form factor the console
 * ships, and after a person's widget choices are reset.
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AxfRuntime } from '../../src/axf/core/runtime';
import { BADGES, CONNECTION_KINDS, KINDS, badgeAttachment, shownOf } from './web/model';

const here = dirname(fileURLToPath(import.meta.url));
const app = join(here, '../..');
const ORIGIN = 'ai.amberx.axf.console.claude-badge';
let checks = 0;
const ok = (v: unknown, what: string) => { assert.ok(v, what); checks += 1; };

const jsonUnder = (dir: string): unknown[] => {
  let out: unknown[] = [];
  let names: string[] = [];
  try { names = readdirSync(dir); } catch { return out; }
  for (const n of names) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) out = out.concat(jsonUnder(p));
    else if (n.endsWith('.json')) out.push(JSON.parse(readFileSync(p, 'utf8')));
  }
  return out;
};
// the same three layers main.tsx loads: shared framework assets, the console's own, then its overrides
const assets = [...jsonUnder(join(app, 'src/axf/assets')), ...jsonUnder(join(app, 'src/assets')), ...jsonUnder(join(app, 'src/assets-overrides'))]
  .filter((a): a is { $axf: string; type: string; id: string } => !!a && typeof a === 'object' && (a as { $axf?: unknown }).$axf === 'asset@1');
const manifest = JSON.parse(readFileSync(join(app, 'axf.manifest.json'), 'utf8'));
const banners = assets.filter((a) => a.type === 'banner').map((a) => a.id);
ok(banners.includes(manifest.defaults.banner), `the console's default banner (${manifest.defaults.banner}) ships`);

const defaults = () => undefined; // no saved settings: every badge setting at its default
const keyOf = (kind: (typeof KINDS)[number]) => `badge:${BADGES[kind].id}`;

function consoleWithBadges(storageKey: string) {
  const rt = new AxfRuntime({ manifest, assets: assets as never, storageKey });
  for (const kind of KINDS) {
    if (!shownOf(defaults, kind)) continue;
    const d = BADGES[kind];
    rt.registry.register({ $axf: 'asset@1', type: 'badge', id: d.id, name: d.title, version: '0.0.0', data: { icon: d.icon, label: d.label, shape: 'pill', tone: 'muted', tooltip: d.about } } as never, 'app', ORIGIN);
    rt.attachToBanner(badgeAttachment(defaults, kind, ORIGIN));
  }
  return rt;
}

/** The connection badges the banner draws right now (keys, in bar order). */
const drawn = (rt: AxfRuntime) => {
  const { data, placed } = rt.banner();
  if (!data) return [];
  return Object.values(placed).flat().map((p) => p.key).filter((k) => CONNECTION_KINDS.some((c) => keyOf(c) === k));
};

// 1. Every connection badge is on by default.
for (const kind of CONNECTION_KINDS) ok(shownOf(defaults, kind), `${kind}: "Show on the banner" is on by default`);

// 2. The default banner draws all of them.
{
  const rt = consoleWithBadges('test:badges-default');
  const keys = drawn(rt);
  ok(keys.length > 0, 'the console banner draws at least one connection badge by default (it drew none)');
  for (const kind of CONNECTION_KINDS) ok(keys.includes(keyOf(kind)), `${keyOf(kind)} is on the default banner`);
  for (const kind of CONNECTION_KINDS) {
    const v = rt.bannerWidgetView(keyOf(kind));
    ok(!v.hidden, `${keyOf(kind)} is not hidden by default in the Widgets picker`);
    ok(v.priority > 5, `${keyOf(kind)} outranks a plain widget, so it is not the first into the ⋯ menu`);
  }
  // the Widgets picker lists them as on the bar, so its checkbox controls something real
  const rows = rt.bannerWidgets();
  for (const kind of CONNECTION_KINDS) ok(rows.find((r) => r.key === keyOf(kind))?.shown, `${keyOf(kind)} shows as on the bar in the Widgets picker`);
}

// 3. Under every banner asset the console ships (skins swap the banner: the Windows title bar, the branded bar, …).
for (const id of banners) {
  const rt = consoleWithBadges(`test:badges-${id}`);
  rt.swap('banner' as never, id);
  if (!rt.banner().data) continue; // a banner that hides itself draws nothing at all; not a badge question
  const keys = drawn(rt);
  ok(keys.length > 0, `banner ${id}: draws at least one connection badge (it drew none)`);
  for (const kind of CONNECTION_KINDS) ok(keys.includes(keyOf(kind)), `banner ${id}: ${keyOf(kind)} is drawn`);
}

// 4. Phone and computer keep separate widget choices: both start with every badge shown, and Reset brings them back.
for (const phone of [false, true]) {
  const g = globalThis as { matchMedia?: (q: string) => { matches: boolean } };
  const before = g.matchMedia;
  g.matchMedia = () => ({ matches: phone });
  try {
    const rt = consoleWithBadges(`test:badges-${phone ? 'phone' : 'desktop'}`);
    ok(drawn(rt).length === CONNECTION_KINDS.length, `${phone ? 'phone' : 'computer'}: every connection badge is drawn by default`);
    for (const kind of CONNECTION_KINDS) rt.settings.set(rt.bannerWidgetsKey(), { ...rt.bannerWidgetPrefs(), [keyOf(kind)]: { hidden: true } } as never);
    ok(drawn(rt).length === 0, `${phone ? 'phone' : 'computer'}: hiding them in the Widgets picker takes them off (the guard can see a miss)`);
    rt.settings.clear(rt.bannerWidgetsKey());
    ok(drawn(rt).length === CONNECTION_KINDS.length, `${phone ? 'phone' : 'computer'}: back to default draws every connection badge again`);
  } finally { g.matchMedia = before; }
}

console.log(`claude-badge banner guard: ${checks} checks passed`);
