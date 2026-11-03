/**
 * chrome@1 (core/engines/chrome.ts): replays spec/fixtures/chrome.json through the reference engine (the Kotlin twin is
 * deferred, spec/PORTING.md), then checks the invariants a host relies on: every namespaced id routes back to the app
 * that sent it, no action id ever crosses over, limits hold, the embed@1 `chrome` / `chrome-request` messages parse, and
 * the runtime's guest side (shareChrome) sends what the host can merge and runs only what it offered.
 *   npx -y tsx framework/spec/check-chrome.mts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CHROME_CONTRACT, CHROME_LIMITS, WIDGET_TONES, WIDGET_TYPES, activeNav, chromePicks, emptyChrome, mergeChrome, parseChromeBundle, routePick, type ChromeBundle } from '../core/engines/chrome';
import { embedTakeIds, embedTakeSpec, parseEmbedMessage } from '../core/engines/embed';

const root = new URL('../', import.meta.url).pathname;
const f = JSON.parse(readFileSync(join(root, 'spec/fixtures/chrome.json'), 'utf8'));
let checks = 0;
const ok = (c: unknown, msg: string) => { assert.ok(c, msg); checks++; };
const eq = (a: unknown, b: unknown, msg: string) => { assert.deepEqual(JSON.parse(JSON.stringify(a ?? null)), JSON.parse(JSON.stringify(b ?? null)), msg); checks++; };

// ---- fixture replay ----
eq(f.contract, CHROME_CONTRACT, 'contract'); eq(f.limits, CHROME_LIMITS, 'limits'); eq(f.widgetTypes, WIDGET_TYPES, 'widget types'); eq(f.widgetTones, WIDGET_TONES, 'widget tones');
eq(emptyChrome('x', 'X'), f.empty, 'empty bundle');
for (const c of f.parse) eq(parseChromeBundle(c.raw), c.bundle, `parse ${typeof c.raw === 'string' ? c.raw.slice(0, 30) : JSON.stringify(c.raw).slice(0, 60)}`);
const B = f.bundles as { host: ChromeBundle; amberx: ChromeBundle; axhub: ChromeBundle; console: ChromeBundle };
eq(mergeChrome(B.host, [B.amberx, B.axhub, B.console], { order: ['console', 'amberx', 'axhub'], activeApp: 'axhub' }), f.merged, 'merged');
eq(mergeChrome(null, [B.axhub, B.amberx]), f.noHost, 'merged without a host');
eq(mergeChrome(B.host, [B.axhub, B.amberx], { menus: 'flat', widgetsOnce: false }), f.flat, 'flat menus, every widget');
eq(mergeChrome(null, [B.amberx, { ...B.amberx, nav: [] }], { activeApp: 'nope' }), f.twice, 'same app twice');
eq(chromePicks(f.merged), f.picks, 'picks'); eq(activeNav(f.merged), f.active, 'active nav'); eq(activeNav(f.noHost), f.activeNone, 'no active nav');
for (const c of f.route) eq(routePick(c.id, ['amberx', 'axhub', 'console']), c.out, `route ${c.id}`);
for (const c of f.routed) eq(routePick(c.id, f.merged.apps), c.route, `routed ${c.id}`);
f.message.forEach((m: unknown, i: number) => eq([parseEmbedMessage({ $axf: 'embed@1', type: 'chrome', chrome: B.axhub }), parseEmbedMessage({ $axf: 'embed@1', type: 'chrome', chrome: { app: 'x' } }), parseEmbedMessage({ $axf: 'embed@1', type: 'chrome-request' }), parseEmbedMessage(JSON.stringify({ $axf: 'embed@1', type: 'chrome', chrome: B.amberx }))][i], m, `message #${i}`));

// ---- invariants ----
{
  const u = f.merged as ReturnType<typeof mergeChrome>;
  // every guest id is namespaced to its app and routes back to it; host ids route to the host
  for (const p of chromePicks(u)) {
    const r = routePick(p.id, u.apps);
    eq(r.app, p.app, `pick ${p.id} routes to its app`);
    if (p.app) ok(p.id.startsWith(`${p.app}:`), `pick ${p.id} carries its namespace`);
  }
  // the original ids are recoverable: the app's own id is what it sent
  const sentIds = new Set<string>();
  const walk = (items: { id: string; items?: unknown[] }[]) => { for (const i of items) { sentIds.add(i.id); if (i.items) walk(i.items as { id: string }[]); } };
  for (const b of [B.amberx, B.axhub, B.console]) { for (const m of b.menus) { sentIds.add(m.id); walk(m.items); } for (const s of b.nav) walk(s.items); for (const t of b.context) walk(t.items); for (const t of b.toolbars) walk(t.items); }
  for (const p of chromePicks(u)) if (p.app) { const r = routePick(p.id, u.apps); ok(sentIds.has(r.id), `routed id ${r.id} was sent by ${p.app}`); }
  // no action ids anywhere in a bundle or the merged model
  ok(!JSON.stringify([B.amberx, B.axhub, B.console, u]).includes('"action"'), 'no action ids cross over');
  // one widget per kind, the host's first; notes say what was left out
  const kinds = u.widgets.map((w) => w.type); eq(kinds.length, new Set(kinds).size, 'one widget per kind'); ok(u.widgets[0]!.app === null && u.widgets[0]!.type === 'clock', 'the host clock wins'); ok(u.notes.length >= 2, 'left-out widgets are noted');
  // the active app's nav comes first among the apps and carries the active item; default context target always exists
  eq(u.nav[1]!.app, 'axhub', 'active app first'); eq(activeNav(u)?.id, 'axhub:approvals', 'active item'); ok(Array.isArray(u.context.default), 'default target');
  // the order option is honoured for menus / toolbars; unknown apps follow
  eq(u.apps, ['console', 'amberx', 'axhub'], 'app order');
}
// limits hold: an oversized bundle is cut, never rejected whole
{
  const big = { $axf: CHROME_CONTRACT, app: 'big', menus: [], nav: Array.from({ length: 20 }, (_, s) => ({ items: Array.from({ length: 20 }, (_, i) => ({ id: `n${s}-${i}`, label: 'N' })) })), context: Array.from({ length: 60 }, (_, i) => ({ target: `t${i}`, items: [{ id: `c${i}`, label: 'C' }] })), toolbars: Array.from({ length: 10 }, (_, t) => ({ id: `tb${t}`, items: Array.from({ length: 20 }, (_, i) => ({ id: `b${t}-${i}`, label: 'B', icon: 'x' })) })), widgets: Array.from({ length: 30 }, (_, i) => ({ id: `w${i}`, type: 'clock' })) };
  const b = parseChromeBundle(big)!;
  ok(b.nav.length <= CHROME_LIMITS.navSections && b.nav.reduce((a, s) => a + s.items.length, 0) <= CHROME_LIMITS.navItems, 'nav limits');
  ok(b.context.length <= CHROME_LIMITS.context, 'context limit'); ok(b.toolbars.length <= CHROME_LIMITS.toolbars && b.toolbars.reduce((a, t) => a + t.items.length, 0) <= CHROME_LIMITS.toolbarItems, 'toolbar limits'); ok(b.widgets.length <= CHROME_LIMITS.widgets, 'widget limit');
  ok(parseChromeBundle('x'.repeat(CHROME_LIMITS.raw + 1)) === null, 'oversized text refused');
  ok(parseEmbedMessage(JSON.stringify({ $axf: 'embed@1', type: 'chrome', chrome: big })) !== null, 'a long chrome message is still read (its own limits apply)');
}
// the embed takes that carry it hide the right chrome in the guest
{
  eq(embedTakeSpec('nav-menu')?.hides, ['nav-menu'], 'nav-menu take hides the nav'); eq(embedTakeSpec('context-menu')?.hides, ['context-menu'], 'context-menu take hides the context menu');
  eq(embedTakeSpec('toolbar')?.hides, ['toolbar'], 'toolbar take hides the toolbar'); eq(embedTakeSpec('widgets')?.hides, [], 'widgets take hides nothing (the banner is hidden by the host)');
  ok(['app-menu', 'nav-menu', 'context-menu', 'toolbar', 'widgets'].every((t) => embedTakeIds().includes(t)), 'all chrome takes registered');
}

// ---- runtime guest side: shareChrome sends data, run picks only what was offered ----
{
  const { AxfRuntime } = await import('../core/runtime');
  const { readdirSync } = await import('node:fs');
  const assets = readdirSync(join(root, 'assets')).flatMap((t) => readdirSync(join(root, 'assets', t)).filter((n) => n.endsWith('.json')).map((n) => JSON.parse(readFileSync(join(root, 'assets', t, n), 'utf8'))));
  const defaults = JSON.parse(readFileSync(join(root, 'defaults.json'), 'utf8'));
  const manifest = { app: { id: 'test', name: 'Test' }, defaults } as never;
  const rt = new AxfRuntime({ manifest, assets, storageKey: `axf-test:${Math.random()}`, embed: { host: 'molly', hidden: ['banner', 'nav-menu', 'context-menu', 'toolbar'], takes: ['app-menu', 'nav-menu', 'context-menu', 'toolbar', 'widgets'] } });
  eq(rt.embedded?.takes, ['app-menu', 'nav-menu', 'context-menu', 'toolbar', 'widgets'], 'runtime takes');
  const sent: unknown[] = [];
  (rt as unknown as { postToHost: (m: unknown) => boolean }).postToHost = (m: unknown) => { sent.push(m); return true; };
  ok(await rt.shareChrome({ force: true }), 'chrome shared');
  const msg = sent.find((m) => (m as { type?: string }).type === 'chrome') as { chrome: ChromeBundle } | undefined;
  ok(msg, 'a chrome message went to the host');
  const parsed = parseChromeBundle(msg!.chrome); ok(parsed, 'the host can parse it');
  ok(parsed!.nav.length > 0 && parsed!.nav.some((s) => s.items.length > 0), 'navigation sent'); ok(parsed!.context.some((t) => t.target === 'default'), 'default context target sent');
  ok(!JSON.stringify(msg).includes('"action"'), 'no action ids cross over');
  const navId = parsed!.nav[0]!.items[0]!.id;
  ok(rt.runSharedMenuItem(navId), `the host can run nav pick ${navId}`);
  ok(!rt.runSharedMenuItem('never-offered'), 'a pick the app never offered is refused');
  ok(!(await rt.shareChrome()), 'unchanged chrome is not sent again');
  ok(await rt.shareChrome({ force: true }), 'force sends it again');
}

console.log(`check-chrome: ok (${checks} checks)`);
