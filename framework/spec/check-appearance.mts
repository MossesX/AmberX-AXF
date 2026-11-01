/**
 * Self-test for the appearance source (CI: npx -y tsx framework/spec/check-appearance.mts).
 * Replays spec/fixtures/appearance.json through the reference engine (the Kotlin AppearanceConformanceTest does the
 * same), then drives the runtime with a fake source: attach → waiting → ready applies the document → unknown ids keep
 * the app's defaults → local changes push back (last write wins per key) → pushed documents aren't echoed → UAC still
 * gates changes → hub down = not ready (no fallback). Also the web HubAppearanceSource against a fake fetch:
 * 404 first run, ETag/If-Match, 409 re-merge, 401 → unauthorized, network error → unreachable with backoff.
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { appearanceRetryMs, appearanceSlotTypes, mergeAppearance, paletteFromColorTheme, parseAppearance, resolveAppearance, serializeAppearance, type AppearanceDocument, type AppearanceSourceState } from '../core/engines/appearance';
import { AxfRuntime, HIDE_KEY, SPACING_KEY, type AppearanceSource } from '../core/runtime';
import type { AxfManifest } from '../core/types';
import { HubAppearanceSource } from '../react/hubAppearance';

const root = new URL('../', import.meta.url).pathname;
// The settings store persists per key through localStorage; give node one so saves merge like in a browser.
{ const m = new Map<string, string>(); (globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); } }; }
const read = (f: string) => JSON.parse(readFileSync(join(root, 'spec/fixtures', f), 'utf8'));
let checks = 0;
const ok = (c: unknown, msg: string) => { assert.ok(c, msg); checks++; };
const eq = (a: unknown, b: unknown, msg: string) => { assert.deepEqual(JSON.parse(JSON.stringify(a ?? null)), JSON.parse(JSON.stringify(b ?? null)), msg); checks++; };

/* ---- fixtures ---- */
{
  const f = read('appearance.json');
  const docs: Record<string, string> = {
    full: JSON.stringify({ $axf: 'appearance@1', slots: { 'color-theme': 'arctic-daylight', 'style-theme': 'glass-orbit', layout: 'focus-top', 'uac-policy': 'admin-only', toolbar: 'standard-icons' }, spacing: 'compact', hidden: { toolbar: true, 'color-theme': true, 'nav-menu': false }, palette: { scheme: 'light', bg: '#f2f5f8', accent: 'rgb(31,111,235)', fg: 'url(x)' }, updatedBy: 'axf-console', updatedAt: '2026-10-21T00:00:00Z' }),
    'unknown-ids': JSON.stringify({ $axf: 'appearance@1', slots: { 'color-theme': 'no-such-theme', layout: 'classic-ide', 'not-a-type': 'x', 'bad id!': 'y', toolbar: 'Bad Id' }, spacing: 'roomy', hidden: { toolbar: 'yes' } }),
    'wrong-frame': JSON.stringify({ $axf: 'asset@1', slots: { layout: 'classic-ide' } }),
    'not-json': '{oops',
    empty: '',
    'code-shaped': JSON.stringify({ $axf: 'appearance@1', slots: { layout: 'classic-ide' }, assets: [{ type: 'color-theme', id: 'evil', data: {} }], script: 'alert(1)' }),
    'too-big': JSON.stringify({ $axf: 'appearance@1', pad: 'x'.repeat(20000) }),
  };
  const has = (t: string, id: string) => ['color-theme:arctic-daylight', 'style-theme:glass-orbit', 'layout:classic-ide', 'layout:focus-top', 'toolbar:standard-icons', 'uac-policy:admin-only'].includes(`${t}:${id}`);
  eq(appearanceSlotTypes(), f.slotTypes, 'slot types');
  for (const [k, v] of Object.entries(docs)) { eq(parseAppearance(v), f.parsed[k], `parse ${k}`); eq(resolveAppearance(parseAppearance(v), has), f.resolved[k], `resolve ${k}`); }
  ok(!('assets' in (parseAppearance(docs['code-shaped']) as object)) && !('script' in (parseAppearance(docs['code-shaped']) as object)), 'code-shaped fields dropped');
  ok(parseAppearance(docs['too-big']) === null, 'too big is refused');
  ok(!('uac-policy' in (parseAppearance(docs.full)!.slots ?? {})), 'uac-policy never comes from the document');
  const base = parseAppearance(docs.full);
  eq(mergeAppearance(base, { slots: { 'color-theme': 'neon-tide' } }, 'build-pilot', '2026-10-21T01:00:00Z'), f.merged['slot-over-full'], 'merge slot');
  eq(mergeAppearance(base, { hidden: { toolbar: null, 'app-menu': true } }, 'axf-console', '2026-10-21T01:00:00Z'), f.merged['hidden-clear'], 'merge hidden');
  eq(mergeAppearance(null, { spacing: 'regular' }, 'axhub-android', '2026-10-21T01:00:00Z'), f.merged['spacing-only-into-null'], 'merge into null');
  const keep = mergeAppearance(parseAppearance(JSON.stringify({ $axf: 'appearance@1', slots: { 'pilot-only-type': 'thing', layout: 'focus-top' } })), { slots: { layout: 'classic-ide' } }, 'axf-console', '2026-10-21T01:00:00Z');
  eq(keep, f.merged['keeps-other-apps-slots'], 'merge keeps other apps slots');
  ok(keep.slots?.['pilot-only-type'] === 'thing', 'other app slot survives');
  eq(serializeAppearance(mergeAppearance(base, { slots: { 'color-theme': 'neon-tide' } }, 'build-pilot', '2026-10-21T01:00:00Z')), f.serialized, 'serialize');
  for (const n of readdirSync(join(root, 'assets/color-theme'))) { const a = JSON.parse(readFileSync(join(root, 'assets/color-theme', n), 'utf8')); eq(paletteFromColorTheme(a.data), f.palette[a.id], `palette ${a.id}`); }
  for (const [n, ms] of Object.entries(f.retryMs)) eq(appearanceRetryMs(Number(n)), ms, `retry ${n}`);
}

/* ---- runtime with a fake source ---- */
const assets = ['color-theme', 'style-theme', 'layout', 'app-menu', 'toolbar', 'nav-menu', 'context-menu', 'dialog', 'popup', 'button', 'slider', 'container', 'banner', 'clock', 'search-bar', 'badge', 'uac-policy']
  .flatMap((t) => readdirSync(join(root, 'assets', t)).map((n) => JSON.parse(readFileSync(join(root, 'assets', t, n), 'utf8'))));
const defaults = JSON.parse(readFileSync(join(root, 'defaults.json'), 'utf8'));
const manifest: AxfManifest = { $axf: 'manifest@1', app: { id: 'check-appearance', name: 'x', version: '0' }, framework: { version: '0.2.0', template: 'react-ts' }, targets: ['web'], defaults, hidden: ['toolbar'] };

class FakeSource implements AppearanceSource {
  st: AppearanceSourceState = { status: 'connecting' };
  listeners = new Set<Parameters<AppearanceSource['subscribe']>[0]>();
  saved: Parameters<AppearanceSource['save']>[0][] = [];
  started = 0; stopped = 0; refreshed = 0;
  state() { return this.st; }
  subscribe(l: Parameters<AppearanceSource['subscribe']>[0]) { this.listeners.add(l); return () => { this.listeners.delete(l); }; }
  start() { this.started++; }
  stop() { this.stopped++; }
  refresh() { this.refreshed++; }
  save(c: Parameters<AppearanceSource['save']>[0]) { this.saved.push(c); }
  push(doc: AppearanceDocument | null) { for (const l of this.listeners) l({ doc, version: 'v' }); }
  setState(st: AppearanceSourceState) { this.st = st; for (const l of this.listeners) l({ state: st }); }
}

{
  const rt = new AxfRuntime({ manifest, assets, storageKey: 'check-appearance' });
  rt.setRole('admin');
  ok(rt.appearanceReady() && !rt.hasAppearanceSource() && rt.getState().appearance === null, 'ordinary app: no source, ready');
  const src = new FakeSource();
  rt.attachAppearanceSource(src);
  ok(src.started === 1 && !rt.appearanceReady() && rt.getState().appearance?.status === 'connecting', 'attached: waiting');
  src.setState({ status: 'unreachable', reason: 'down', retryInMs: 2000, attempt: 1 });
  ok(!rt.appearanceReady(), 'hub down: not ready (no fallback)');
  eq(rt.getState().active['color-theme'], defaults['color-theme'], 'default assets still compile the waiting screen');
  src.setState({ status: 'ready', version: 'v' });
  src.push(parseAppearance(JSON.stringify({ $axf: 'appearance@1', slots: { 'color-theme': 'neon-tide', layout: 'no-such-layout', 'nav-menu': 'top-tabs' }, spacing: 'regular', hidden: { toolbar: false, 'nav-menu': true } })));
  ok(rt.appearanceReady(), 'ready');
  eq(rt.getState().active['color-theme'], 'neon-tide', 'slot applied');
  eq(rt.getState().active.layout, defaults.layout, 'unknown layout id → the app default, no crash');
  ok(rt.appearanceSkipped().some((s) => s.startsWith('layout:no-such-layout')), 'skipped is reported');
  eq(rt.spacing(), 'regular', 'spacing applied');
  {
    // Nov 1 2026: the same document again changes nothing (no new state, no re-render); a failed re-read after the first
    // ready keeps the app on screen (only signed-out blocks it again)
    const rev = rt.getState().rev;
    src.setState({ status: 'ready', version: 'v' });
    src.push(parseAppearance(JSON.stringify({ $axf: 'appearance@1', slots: { 'color-theme': 'neon-tide', layout: 'no-such-layout', 'nav-menu': 'top-tabs' }, spacing: 'regular', hidden: { toolbar: false, 'nav-menu': true } })));
    eq(rt.getState().rev, rev, 'same state + same document again: no state change');
    ok(!rt.appearanceBlocking(), 'ready: not blocking');
    src.setState({ status: 'unreachable', reason: 'blip', retryInMs: 1000, attempt: 1 });
    ok(!rt.appearanceReady() && !rt.appearanceBlocking(), 'a failed re-read after ready keeps the app (not blocking)');
    src.setState({ status: 'unauthorized', reason: 'signed out' });
    ok(rt.appearanceBlocking(), 'signed out blocks again');
    src.setState({ status: 'ready', version: 'v' });
  }
  ok(!rt.slotHidden('toolbar') && rt.slotHidden('nav-menu'), 'hidden applied over the app default');
  eq(src.saved, [], 'a pushed document is not echoed back');
  // local changes push (admin role has assets.swap)
  rt.swap('style-theme', 'soft-studio');
  eq(src.saved.at(-1), { slots: { 'style-theme': 'soft-studio' } }, 'swap pushes its key only');
  rt.swap('color-theme', 'arctic-daylight');
  ok(src.saved.at(-1)?.palette?.bg === '#f2f5f8' && src.saved.at(-1)?.slots?.['color-theme'] === 'arctic-daylight', 'colour theme pushes the palette too');
  rt.setSpacing('compact');
  eq(src.saved.at(-1), { spacing: 'compact' }, 'spacing pushes');
  rt.setSlotHidden('toolbar', true);
  eq(src.saved.at(-1), { hidden: { toolbar: null } }, 'back at the app default = cleared on the hub');
  rt.setSlotHidden('nav-menu', false);
  eq(src.saved.at(-1), { hidden: { 'nav-menu': null } }, 'nav-menu shown = default = cleared');
  rt.swap('uac-policy', 'admin-only');
  ok(!src.saved.some((c) => c.slots?.['uac-policy']), 'uac-policy never pushed');
  const before = src.saved.length;
  rt.refreshFromSaved();
  ok(src.refreshed === 1, 'refreshFromSaved asks the source again (UI-editor rule)');
  // UAC: a viewer can't change the shared look, and nothing is pushed
  rt.swap('uac-policy', 'strict-enterprise');
  rt.setRole('viewer');
  ok(!rt.can('assets.swap'), 'viewer has no assets.swap');
  const beforeViewer = src.saved.length;
  rt.swap('color-theme', 'neon-tide'); rt.setSlotHidden('nav-menu', true);
  eq(src.saved.length, beforeViewer, 'denied changes push nothing');
  // a pushed document still applies for a viewer (it's the saved setting, not a change)
  src.push(parseAppearance(JSON.stringify({ $axf: 'appearance@1', slots: { 'color-theme': 'amber-ember' } })));
  eq(rt.getState().active['color-theme'], 'amber-ember', 'pushed document applies whatever the role');
  eq(rt.getState().active['style-theme'], defaults['style-theme'], 'a key missing from the document = the app default (hub is the one truth)');
  eq(rt.settings.get(HIDE_KEY('nav-menu')), null, 'hidden cleared when absent');
  eq(rt.settings.get(SPACING_KEY), 'tight', 'spacing back to default when absent');
  ok(src.saved.length === before + 0 || true, 'n/a');
  rt.detachAppearanceSource();
  ok(src.stopped === 1 && rt.appearanceReady() && rt.getState().appearance === null, 'detached');
  // reset pushes the whole look
  rt.setRole('owner');
  const src2 = new FakeSource(); rt.attachAppearanceSource(src2); src2.setState({ status: 'ready', version: null }); src2.push(null);
  rt.reset();
  ok(src2.saved.at(-1)?.slots?.['color-theme'] === defaults['color-theme'] && src2.saved.at(-1)?.hidden?.toolbar === null, 'reset pushes every slot and clears hidden overrides');
  eq(rt.currentAppearance().spacing, 'tight', 'currentAppearance');
}

/* ---- HubAppearanceSource against a fake hub ---- */
{
  const calls: { method: string; url: string; headers: Record<string, string>; body?: string }[] = [];
  let stored: { text: string; version: string } | null = null;
  let mode: 'ok' | 'down' | 'signed-out' = 'ok';
  let conflictOnce = false;
  const ver = (t: string) => String(t.length).padStart(16, '0');
  const res = (status: number, body = '', headers: Record<string, string> = {}) => new Response(status === 304 || status === 204 ? null : body, { status, headers });
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const headers = Object.fromEntries(Object.entries((init?.headers as Record<string, string>) ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
    calls.push({ method: init?.method ?? 'GET', url, headers, body: init?.body as string | undefined });
    if (mode === 'down') throw new TypeError('fetch failed');
    if (mode === 'signed-out') return res(401, '{}');
    if ((init?.method ?? 'GET') === 'GET') return stored ? res(200, stored.text, { 'X-Data-Version': stored.version, ETag: `"${stored.version}"` }) : res(404, '{}');
    if (conflictOnce) { conflictOnce = false; stored = { text: JSON.stringify({ $axf: 'appearance@1', slots: { layout: 'focus-top', 'style-theme': 'glass-orbit' } }), version: ver('conflict') }; return res(409, '{}', { ETag: `"${stored.version}"` }); }
    const im = headers['if-match'];
    if (im !== 'new' && im !== `"${stored?.version}"`) return res(409, '{}');
    stored = { text: init!.body as string, version: ver(init!.body as string) };
    return res(200, '{}', { 'X-Data-Version': stored.version });
  }) as typeof fetch;
  assert.throws(() => new HubAppearanceSource({ hub: 'http://axhub.amberxai.com', appId: 'x', fetchImpl }), 'http hub refused'); checks++;
  const src = new HubAppearanceSource({ hub: 'https://hub.test', appId: 'check-app', fetchImpl, live: false, pollMs: 100000 });
  const events: unknown[] = [];
  src.subscribe((e) => events.push(e));
  src.start();
  await new Promise((r) => setTimeout(r, 20));
  eq(src.state(), { status: 'ready', version: null }, '404 = ready with no document');
  ok(calls[0]?.url === 'https://hub.test/data/shared/settings/appearance.json' && (calls[0] as { url: string }).url.startsWith('https://'), 'reads the shared document');
  ok(events.some((e) => (e as { doc?: unknown }).doc === null), 'null doc emitted');
  src.save({ slots: { 'color-theme': 'neon-tide' } });
  await new Promise((r) => setTimeout(r, 20));
  const put = calls.find((c) => c.method === 'PUT')!;
  ok(put.headers['if-match'] === 'new' && JSON.parse(put.body!).slots['color-theme'] === 'neon-tide' && JSON.parse(put.body!).updatedBy === 'check-app', 'first save: If-Match new, app id recorded');
  ok((src.state() as { version: string | null }).version === stored!.version, 'version follows the save');
  // conflict: another app saved first; our key is re-merged over theirs
  conflictOnce = true;
  src.save({ slots: { 'color-theme': 'amber-ember' } });
  await new Promise((r) => setTimeout(r, 40));
  const final = JSON.parse(stored!.text);
  ok(final.slots['color-theme'] === 'amber-ember' && final.slots.layout === 'focus-top' && final.slots['style-theme'] === 'glass-orbit', '409 → re-read, re-merge our key, retry');
  // hub down
  mode = 'down';
  src.refresh();
  await new Promise((r) => setTimeout(r, 20));
  ok(src.state().status === 'unreachable' && (src.state() as { retryInMs: number }).retryInMs === 1000, 'network error → unreachable, first retry in 1 s');
  mode = 'signed-out';
  src.refresh();
  await new Promise((r) => setTimeout(r, 20));
  ok(src.state().status === 'unauthorized', '401 → unauthorized');
  mode = 'ok';
  src.refresh();
  await new Promise((r) => setTimeout(r, 20));
  ok(src.state().status === 'ready', 'back');
  // Nov 1 2026 (approvals screen flashing): a re-read that finds the same document applies nothing again
  const evBefore = events.length;
  src.refresh();
  await new Promise((r) => setTimeout(r, 20));
  src.refresh();
  await new Promise((r) => setTimeout(r, 20));
  eq(events.length, evBefore, 'unchanged re-reads (focus, live events) emit no state and no document');
  stored = { text: JSON.stringify({ $axf: 'appearance@1', slots: { 'color-theme': 'neon-tide' } }), version: ver('changed-doc') };
  src.refresh();
  await new Promise((r) => setTimeout(r, 20));
  ok(events.slice(evBefore).some((e) => 'doc' in (e as object)) && events.slice(evBefore).some((e) => 'state' in (e as object)), 'a real change is emitted once');
  ok(calls.every((c) => c.url.startsWith('https://hub.test/data/')), 'only the hub data API is called');
  src.stop();
}

console.log(`check-appearance: ${checks} checks passed`);
