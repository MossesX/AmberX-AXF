/**
 * The approvals screen keeps still while it refreshes (Brett, Nov 1 2026: the whole screen flashed "Reading the hub"
 * over and over while a veto countdown ran). Renders the real Approvals page inside the real AppShell against a fake hub
 * and checks:
 *   - "Reading the hub…" shows before the first answer only: never during a refresh, a failed read or an appearance blip;
 *   - a refresh, a failed read, an unchanged look re-read and a look re-read that fails never remount a row;
 *   - the countdown ticks only its own number: the page header and the rows don't re-render per second.
 *
 *   cd apps/axhub-web && npm install && npm i --no-save react-test-renderer@18.3.1 && npx tsx scripts/refresh-check.mts
 */
import assert from 'node:assert/strict';
import { register } from 'node:module';

// Stylesheets imported by the views (lib-datagrid's datagrid.css) are nothing to Node: load them as empty modules.
register('data:text/javascript,' + encodeURIComponent(
  "export async function load(url, ctx, next) { return url.endsWith('.css') ? { format: 'module', source: '', shortCircuit: true } : next(url, ctx); }",
));
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/* ---- the little DOM the page touches (no jsdom: listeners only) ---- */
const g = globalThis as Record<string, unknown>;
const noop = () => undefined;
const target = { addEventListener: noop, removeEventListener: noop, dispatchEvent: () => true };
g.document = { ...target, visibilityState: 'visible', documentElement: { style: { setProperty: noop, removeProperty: noop }, setAttribute: noop, removeAttribute: noop, dataset: {} }, head: { appendChild: noop }, body: { appendChild: noop }, createElement: () => ({ style: {}, setAttribute: noop, appendChild: noop }), querySelector: () => null, querySelectorAll: () => [], getElementById: () => null, activeElement: null };
g.window = globalThis;
g.addEventListener ??= noop;
g.removeEventListener ??= noop;
g.dispatchEvent ??= () => true;
g.matchMedia ??= () => ({ matches: false, addEventListener: noop, removeEventListener: noop, addListener: noop, removeListener: noop });
g.location ??= { href: 'https://axhub.amberxai.com/#/', hash: '#/', origin: 'https://axhub.amberxai.com', pathname: '/' };
g.navigator ??= { userAgent: 'node' };
g.IS_REACT_ACT_ENVIRONMENT = true;

/* ---- a fake hub: session + approvals grid, one held call counting down ---- */
let down = false;
let held = 60;
const reads = { session: 0, grid: 0 };
const now = Date.now();
const item = (id: string, over: Record<string, unknown> = {}) => ({
  id, tool: 'vps.run', summary: 'echo hi', args: '{}', whole: true, title: `Run ${id.slice(0, 4)}`, reasonGiven: true, effect: 'changes',
  code: { service: 'vps', tool: 'run', qualified: 'vps.run', arguments: '{}' }, status: 'pending', statusLabel: 'Waiting',
  reviewRequired: false, actions: ['approve', 'decline'], revision: 1, callerId: 'claude', createdAt: new Date(now - 60_000).toISOString(),
  expiresAt: new Date(now + 3_600_000).toISOString(), showExpires: false, history: [], ...over,
});
const ID_A = '11111111-1111-1111-1111-111111111111';
const ID_B = '22222222-2222-2222-2222-222222222222';
const grid = () => ({
  filters: [{ id: 'all', label: 'All' }], filter: 'all', page: 1, pages: 1, total: 2, waiting: 1, heldCount: 1, postponed: 0, log: true,
  auto: { available: false, minutes: [] },
  items: [
    item(ID_A, { status: 'held', statusLabel: 'Held', actions: [], veto: { runsAt: new Date(Date.now() + held * 1000).toISOString(), secondsLeft: held, countdownSeconds: 90, actions: ['deny', 'approve-now', 'shelve'] } }),
    item(ID_B),
  ],
});
g.fetch = async (input: string) => {
  const url = String(input);
  if (down) throw new TypeError('fetch failed');
  const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { 'Content-Type': 'application/json' } });
  if (url.includes('/auth/api/session')) { reads.session++; return json({ signedIn: true, hub: 'https://axhub.amberxai.com', loginUrl: '', admin: true, csrf: 'c' }); }
  if (url.includes('/auth/api/approvals')) { reads.grid++; return json(grid()); }
  return new Response('{}', { status: 404 });
};

const React = await import('react');
const { act, create } = await import('react-test-renderer');
const { createAxf } = await import('../src/axf/core');
const { AxfProvider, AppShell } = await import('../src/axf/react');
const { Approvals } = await import('../src/views/Approvals');
const h = React.createElement;

/* ---- the app's runtime, with a look source we drive by hand ---- */
const walk = (dir: string): string[] => readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? walk(p) : p.endsWith('.json') ? [p] : []; });
const here = new URL('..', import.meta.url).pathname;
const manifest = JSON.parse(readFileSync(join(here, 'axf.manifest.json'), 'utf8'));
// as the app registers them: the baked shared set, its own, its overrides (later wins; framework/cli/shared-assets.mjs)
const assets = ['src/axf/assets', 'src/assets', 'src/assets-overrides'].flatMap((d) => (existsSync(join(here, d)) ? walk(join(here, d)) : [])).map((p) => JSON.parse(readFileSync(p, 'utf8')));
const rt = createAxf({ manifest, assets });
type Ev = Parameters<Parameters<import('../src/axf/core').AppearanceSource['subscribe']>[0]>[0];
const subs = new Set<(e: Ev) => void>();
let st: import('../src/axf/core').AppearanceSourceState = { status: 'connecting' };
rt.attachAppearanceSource({ state: () => st, subscribe: (l) => { subs.add(l); return () => subs.delete(l); }, start: noop, stop: noop, refresh: noop, save: noop });
const look = (s: typeof st, doc?: unknown) => { st = s; subs.forEach((l) => l({ state: s })); if (doc !== undefined) subs.forEach((l) => l({ doc: doc as never, version: 'v1' })); };

let checks = 0;
const ok = (c: unknown, msg: string) => { assert.ok(c, msg); checks++; };
const tick = (ms: number) => act(() => new Promise<void>((r) => setTimeout(r, ms)));

let root!: ReturnType<typeof create>;
await act(async () => {
  root = create(h(AxfProvider, { runtime: rt }, h(AppShell, { views: { home: { title: 'Approvals', icon: 'shield', render: () => h(Approvals) } } })));
});
const text = () => JSON.stringify(root.toJSON());
ok(text().includes('Waiting for axHub') && !text().includes('Run 1111'), 'before the look is read: the waiting screen');
const DOC = { $axf: 'appearance@1', slots: {} };
await act(async () => { look({ status: 'ready', version: 'v1' }, DOC); });
await tick(50);
ok(reads.grid >= 1 && text().includes('Run 2222'), 'first read: the list is on screen');
ok(!text().includes('Reading the hub'), 'first read done: no loading line');

/** The fibers of the rows now; a remount gives a new fiber (not the same one or its alternate). */
type Fiber = { alternate: Fiber | null };
// The list is lib-datagrid's grid since axHub decision 109 ("who asked"): one `axf-grid-row` per request.
const rows = () => root.root.findAll((n) => typeof n.type === 'string' && /\b(axp-axhub-row|axf-grid-row)\b/.test(String(n.props.className ?? '')), { deep: false });
const fibers = () => rows().map((n) => (n as unknown as { _fiber: Fiber })._fiber);
const sameFibers = (a: Fiber[], b: Fiber[]) => a.length === b.length && a.every((f, i) => f === b[i] || f.alternate === b[i] || f === b[i]?.alternate);
const f0 = fibers();
ok(f0.length === 2, 'two rows');

// every text we ever render from here on: "Reading the hub" must never appear
const seen: string[] = [];
const watch = async (what: () => Promise<void>) => { seen.push(text()); await what(); seen.push(text()); };
const checkNow = () => root.root.find((n) => n.props.icon === 'refresh' && n.props.children === 'Check now' && typeof n.props.onClick === 'function');

// 1. refresh with the same answer, and with a changed countdown
for (let i = 0; i < 3; i++) {
  held -= 3;
  await watch(async () => { await act(async () => { checkNow().props.onClick(); }); seen.push(text()); await tick(30); });
}
ok(sameFibers(fibers(), f0), 'refreshes: no row remounted');

// 2. a failed read with the list on screen: list kept, no loading line, no error note on the first miss
down = true;
await watch(async () => { await act(async () => { checkNow().props.onClick(); }); await tick(30); });
ok(text().includes('Run 2222') && !text().includes('fetch failed') && !text().includes("Can't reach"), 'one failed read: the list stays, no error flash');
down = false;
await watch(async () => { await act(async () => { checkNow().props.onClick(); }); await tick(30); });
ok(sameFibers(fibers(), f0), 'failed read and back: no row remounted');

// 3. the look: the same document again, then a re-read that fails, then back
const rev = rt.getState().rev;
await watch(async () => { await act(async () => { look({ status: 'ready', version: 'v1' }, DOC); }); });
ok(rt.getState().rev === rev, 'the same look again: no state change');
await watch(async () => { await act(async () => { look({ status: 'unreachable', reason: 'blip', retryInMs: 1000, attempt: 1 }); }); });
ok(!text().includes('Waiting for axHub') && text().includes('Run 2222'), 'a look re-read that fails keeps the app on screen');
await watch(async () => { await act(async () => { look({ status: 'ready', version: 'v1' }, DOC); }); await tick(30); });
ok(sameFibers(fibers(), f0), 'look blip and back: no row remounted');

// 4. the countdown ticks its own number only
const head = () => root.root.find((n) => n.type === 'h1');
const timer = () => root.root.find((n) => n.type === 'span' && n.props.role === 'timer');
const headProps = head().props;
const rowProps = rows().map((n) => n.props);
const t0 = JSON.stringify(timer().props.children);
await watch(async () => { await tick(2_200); });
ok(JSON.stringify(timer().props.children) !== t0, `the countdown ticked (${t0} → ${JSON.stringify(timer().props.children)})`);
ok(head().props === headProps, 'countdown ticks: the page header did not re-render');
ok(rows().every((n, i) => n.props === rowProps[i]), 'countdown ticks: the rows did not re-render');
ok(sameFibers(fibers(), f0), 'countdown ticks: no row remounted');

ok(seen.length > 10 && seen.every((s) => !s.includes('Reading the hub')), `"Reading the hub" never shown once the list was on screen (${seen.length} renders looked at)`);
await act(async () => { root.unmount(); });
rt.detachAppearanceSource();
console.log(`refresh-check: ${checks} checks passed`);
process.exit(0);
