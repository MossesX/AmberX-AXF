// @ts-nocheck: a Node test, not part of the console's build
/**
 * Follow Amber pure part against a fake axHub: frames, the queue, which route a decision takes, and Approve / Deny
 * round trips (feed → pop-up queue → one tap → the hub's route with the session's CSRF → the item leaves the feed).
 *
 *   npx -y tsx --tsconfig apps/console-web/tsconfig.json apps/console-web/plugins/follow-amber/web/check.mts
 *   (test.mts runs it the same way, so the plugins' test.mts glob in CI picks it up)
 */
import assert from 'node:assert/strict';
import { fetchApprovals } from '@console/axf/libs/approvals';
import { FLASH_COUNT, arrived, decide, flashLabel, flashMs, flashPrefs, flashStyle, highlightIsSelector, matchScore, offers, parseFrame, pickBest, pickNext, queueOf, routeOf } from './core.ts';
import { FLASH_DEFAULTS, colorThemeVars } from '@console/axf/core/engines/theme';

let n = 0;
const t = async (name: string, f: () => unknown) => { try { await f(); n++; } catch (e) { console.error(`✗ ${name}`); throw e; } };

const HUB = 'https://axhub.amberxai.com';
const CONSOLE = 'https://console.amberxai.com';
const A1 = '11111111-1111-4111-8111-111111111111';
const A2 = '22222222-2222-4222-8222-222222222222';
const H1 = '33333333-3333-4333-8333-333333333333';
const H2 = '44444444-4444-4444-8444-444444444444';
const url = (id: string) => `${HUB}/auth/admin/approvals/${id}`;

/** A fake axHub: the approvals feed, the session (CSRF), the decide and veto routes; records every request. */
function fakeHub() {
  const now = Date.now();
  const asks = new Map<string, Record<string, unknown>>([
    [A1, { id: A1, tool: 'axhub.pass_grant', summary: 'axhub.pass_grant with arguments {"minutes":30}', createdAt: new Date(now - 60_000).toISOString(), expiresAt: new Date(now + 600_000).toISOString(), url: url(A1), reason: { title: 'Allow theme changes for 30 minutes', description: 'Lets Amber change theme tokens without a veto.' }, actions: ['approve', 'decline'], revision: 3 }],
    [A2, { id: A2, tool: 'github.pulls_create', summary: 'github.pulls_create', createdAt: new Date(now - 30_000).toISOString(), expiresAt: new Date(now + 600_000).toISOString(), url: url(A2) }],
    [H1, { id: H1, tool: 'vps.run', summary: 'vps.run with arguments {"command":"docker restart axf-console"}', createdAt: new Date(now - 10_000).toISOString(), expiresAt: new Date(now + 600_000).toISOString(), url: url(H1), status: 'held', title: 'Restart the console', veto: { runsAt: new Date(now + 80_000).toISOString(), secondsLeft: 80, countdownSeconds: 90, actions: ['deny', 'approve-now', 'shelve'] }, jobId: 'job-1' }],
    [H2, { id: H2, tool: 'vps.run', summary: 'vps.run with arguments {"command":"df -h"}', createdAt: new Date(now - 5_000).toISOString(), expiresAt: new Date(now + 600_000).toISOString(), url: url(H2), status: 'held', title: 'Check the disk', veto: { runsAt: new Date(now + 20_000).toISOString(), secondsLeft: 20, countdownSeconds: 90, actions: ['deny', 'approve-now', 'shelve'] }, jobId: 'job-2' }],
  ]);
  const log: { method: string; path: string; csrf: string; body: unknown; credentials: string }[] = [];
  const reply = (status: number, j: unknown) => new Response(JSON.stringify(j), { status, headers: { 'content-type': 'application/json' } });
  const fetch = async (u: string, init: RequestInit = {}) => {
    const path = new URL(u).pathname;
    const method = init.method ?? 'GET';
    const csrf = (init.headers as Record<string, string> | undefined)?.['X-AxHub-CSRF'] ?? '';
    const body = init.body ? JSON.parse(String(init.body)) : null;
    log.push({ method, path, csrf, body, credentials: String(init.credentials ?? '') });
    if (path === '/auth/admin/approvals.json') return reply(200, { signedIn: true, admin: true, count: asks.size, pending: [...asks.values()] });
    if (path === '/auth/api/session') return reply(200, { csrf: 'csrf-brett' });
    if (method !== 'POST') return reply(404, {});
    if (csrf !== 'csrf-brett') return reply(403, { error: { message: 'bad CSRF' } });
    const m = path.match(/^\/auth\/api\/approvals\/([0-9a-f-]+)(?:\/(deny|approve-now))?$/);
    if (!m || !asks.has(m[1]!)) return reply(404, { error: { message: 'gone' } });
    const [, id, veto] = m;
    if (veto) { asks.delete(id!); return reply(200, { state: veto === 'deny' ? 'denied' : 'approved-now' }); }
    asks.delete(id!);
    return reply(200, { message: `${body.action === 'approve' ? 'Approved' : 'Declined'} on the hub` });
  };
  return { fetch, log, asks };
}

await t('frames', () => {
  assert.equal(parseFrame({ $axf: 'follow-amber@1', type: 'state', on: true })?.type, 'state');
  const s = parseFrame({ $axf: 'follow-amber@1', type: 'show', kind: 'screen', target: 'plan studio', highlight: 'h1', say: 'look' });
  assert.equal(s?.type === 'show' && s.highlight, 'h1');
  assert.equal(parseFrame({ $axf: 'follow-amber@1', type: 'approval', id: A1 })?.type, 'approval');
  assert.equal(parseFrame({ $axf: 'other@1', type: 'state', on: true }), null);
  assert.equal(parseFrame({ $axf: 'follow-amber@1', type: 'show' }), null, 'a show needs a target');
  assert.equal(parseFrame({ $axf: 'follow-amber@1', type: 'run', spec: 'x' }), null, 'nothing else runs');
});

await t('highlight: selector or exact text', () => {
  for (const h of ['#a', '.fx-card', '[data-x="1"]', 'button.fx-btn', 'h2:first-child']) assert.ok(highlightIsSelector(h), h);
  for (const h of ['Plan Studio', 'Follow Amber', 'Approve']) assert.ok(!highlightIsSelector(h), h);
});

const hub = fakeHub();
const feed = await fetchApprovals(HUB, { fetch: hub.fetch });

await t('event -> the pop-up queue: held calls first (soonest first), then approvals oldest first', () => {
  assert.equal(feed.status, 'ok');
  const q = queueOf(feed.items);
  assert.deepEqual(q.map((i) => i.id), [H2, H1, A1, A2]);
  assert.deepEqual(arrived(new Set(), q), [H2, H1, A1, A2], 'everything is new the first time: it pops up');
  assert.deepEqual(arrived(new Set([H2, H1, A1]), q), [A2], 'only what just arrived pops up again');
  assert.equal(pickNext(q, A1)?.id, A1, 'the one Amber named comes first');
  assert.equal(pickNext(q, 'nope')?.id, H2, 'else the head of the queue');
  assert.deepEqual(queueOf(feed.items, new Set([H2])).map((i) => i.id), [H1, A1, A2], 'decided here: out of the queue');
  const shelved = feed.items.map((i) => (i.id === H1 && i.veto ? { ...i, veto: { ...i.veto, shelved: true } } : i));
  assert.ok(!queueOf(shelved).some((i) => i.id === H1), 'a shelved call waits quietly');
});

await t('title, description and the exact call come from the hub', () => {
  const a1 = feed.items.find((i) => i.id === A1)!;
  assert.equal(a1.title, 'Allow theme changes for 30 minutes');
  assert.equal(a1.description, 'Lets Amber change theme tokens without a veto.');
  const h1 = feed.items.find((i) => i.id === H1)!;
  assert.equal(h1.command, 'docker restart axf-console');
  assert.ok(offers(h1, true) && offers(h1, false), 'a held call offers Approve (run now) and Deny');
  assert.ok(offers(a1, true) && offers(a1, false), 'an approval offers Approve and Deny');
});

await t('routes: host first, then the hub origin, else the hub page in a frame', () => {
  const h = { kind: 'held' } as const, a = { kind: 'approval' } as const;
  assert.equal(routeOf(h, { hub: HUB, origin: CONSOLE }), 'frame', 'the console on its own origin cannot sign: frame');
  assert.equal(routeOf(h, { hub: HUB, origin: HUB }), 'hub');
  assert.equal(routeOf(h, { hub: HUB, origin: CONSOLE, vetoAct: async () => ({ ok: true }) }), 'host', "AmberX's shell signs held calls");
  assert.equal(routeOf(a, { hub: HUB, origin: CONSOLE, vetoAct: async () => ({ ok: true }) }), 'frame', 'a veto host does not decide approvals');
  assert.equal(routeOf(a, { hub: HUB, origin: CONSOLE, approvalDecide: async () => ({ ok: true, message: '' }) }), 'host');
});

await t('no signed path here: nothing is sent, the hub page takes the tap', async () => {
  const before = hub.log.length;
  const r = await decide(feed.items.find((i) => i.id === A1)!, true, { hub: HUB, origin: CONSOLE, fetch: hub.fetch });
  assert.equal(r.frame, true);
  assert.equal(r.ok, false);
  assert.equal(hub.log.length, before, 'no request reached the hub');
});

await t('approve round trip on an approval: CSRF from the session, the decide route, then it leaves the feed', async () => {
  const r = await decide(feed.items.find((i) => i.id === A1)!, true, { hub: HUB, origin: HUB, fetch: hub.fetch });
  assert.ok(r.ok, r.message);
  assert.equal(r.route, 'hub');
  const post = hub.log.filter((x) => x.method === 'POST').at(-1)!;
  assert.equal(post.path, `/auth/api/approvals/${A1}`);
  assert.deepEqual(post.body, { action: 'approve', rev: 3 });
  assert.equal(post.csrf, 'csrf-brett', "signed with Brett's session CSRF");
  assert.equal(post.credentials, 'include', "with Brett's own hub cookie");
  const again = await fetchApprovals(HUB, { fetch: hub.fetch });
  assert.ok(!again.items.some((i) => i.id === A1), 'decided: gone from the feed');
});

await t('deny round trip on an approval = decline', async () => {
  const r = await decide(feed.items.find((i) => i.id === A2)!, false, { hub: HUB, origin: HUB, fetch: hub.fetch });
  assert.ok(r.ok, r.message);
  assert.equal(hub.log.filter((x) => x.method === 'POST').at(-1)!.body.action, 'decline');
});

await t('held call: Approve = run it now, Deny = stop it (veto@1 routes)', async () => {
  const a = await decide(feed.items.find((i) => i.id === H1)!, true, { hub: HUB, origin: HUB, fetch: hub.fetch });
  assert.ok(a.ok, a.message);
  assert.equal(hub.log.filter((x) => x.method === 'POST').at(-1)!.path, `/auth/api/approvals/${H1}/approve-now`);
  const d = await decide(feed.items.find((i) => i.id === H2)!, false, { hub: HUB, origin: HUB, fetch: hub.fetch });
  assert.ok(d.ok, d.message);
  assert.equal(hub.log.filter((x) => x.method === 'POST').at(-1)!.path, `/auth/api/approvals/${H2}/deny`);
  const after = await fetchApprovals(HUB, { fetch: hub.fetch });
  assert.equal(after.items.length, 0, 'the queue is empty: the pop-up closes');
  assert.equal(queueOf(after.items).length, 0);
});

await t("held call through AmberX's host: its own session, nothing posted from the page", async () => {
  const h = fakeHub();
  const f = await fetchApprovals(HUB, { fetch: h.fetch });
  const calls: string[] = [];
  const before = h.log.length;
  const r = await decide(f.items.find((i) => i.id === H1)!, false, { hub: HUB, origin: CONSOLE, fetch: h.fetch, vetoAct: async (id, action) => { calls.push(`${id}:${action}`); return { ok: true, state: 'denied' }; } });
  assert.ok(r.ok && r.route === 'host');
  assert.deepEqual(calls, [`${H1}:deny`]);
  assert.equal(h.log.length, before);
});

await t('a refused decision says why and keeps the item', async () => {
  const h = fakeHub();
  const f = await fetchApprovals(HUB, { fetch: h.fetch });
  h.asks.delete(A1); // decided somewhere else meanwhile
  const r = await decide(f.items.find((i) => i.id === A1)!, true, { hub: HUB, origin: HUB, fetch: h.fetch });
  assert.equal(r.ok, false);
  assert.ok(r.message.length > 0);
});

/* ---------------- the flash (Brett, Nov 4 2026: "flash the background … five times", yellow and orange) ---------------- */

await t('show frames carry the id the console reports against', () => {
  const s = parseFrame({ $axf: 'follow-amber@1', type: 'show', id: 'abc123', kind: 'screen', target: 'builds' });
  assert.equal(s?.type === 'show' && s.id, 'abc123');
});

await t('flash defaults: on, theme colours, five flashes, 2.5 s', () => {
  const p = flashPrefs(() => undefined, FLASH_DEFAULTS.flashA, FLASH_DEFAULTS.flashB);
  assert.deepEqual(p, { on: true, colorA: '', colorB: '', count: 5, speed: 'normal' });
  assert.equal(flashMs(p), 2500);
  assert.deepEqual(flashStyle(p), { '--axf-attn-count': '5', '--axf-attn-period': '500ms' });
});

await t('flash settings: picked colours override the theme, count and speed are clamped', () => {
  const v: Record<string, unknown> = { 'follow-amber.flash': false, 'follow-amber.flash.colorA': '#00ff00', 'follow-amber.flash.colorB': FLASH_DEFAULTS.flashB, 'follow-amber.flash.count': 99, 'follow-amber.flash.speed': 'fast' };
  const p = flashPrefs((k) => v[k], FLASH_DEFAULTS.flashA, FLASH_DEFAULTS.flashB);
  assert.equal(p.on, false);
  assert.equal(p.colorA, '#00ff00');
  assert.equal(p.colorB, '', 'left at the default = follow the theme');
  assert.equal(p.count, FLASH_COUNT.max);
  assert.equal(flashStyle(p)['--axf-attn-a'], '#00ff00');
  assert.equal(flashStyle(p)['--axf-attn-b'], undefined);
  assert.equal(flashStyle(p)['--axf-attn-period'], '300ms');
  assert.equal(flashPrefs((k) => ({ 'follow-amber.flash.count': 0, 'follow-amber.flash.colorA': 'red', 'follow-amber.flash.speed': 'warp' } as Record<string, unknown>)[k]).count, 5);
  assert.equal(flashPrefs((k) => (k === 'follow-amber.flash.colorA' ? 'red' : undefined)).colorA, '', 'only #rrggbb colours');
});

await t('colour themes compile flash-a / flash-b / flash-text (yellow / orange / dark when a theme has none)', () => {
  const base = { bg: '#000', surface: '#000', surface2: '#000', surface3: '#000', text: '#fff', muted: '#888', border: '#333', accent: '#f80', accentText: '#000', accentSoft: '#f80', danger: '#f00', success: '#0f0', warning: '#ff0', info: '#00f', focus: '#f80', shadow: '#000' }; // theme-ok: test data
  const v = colorThemeVars({ scheme: 'dark', tokens: base });
  assert.equal(v['--fx-flash-a'], FLASH_DEFAULTS.flashA);
  assert.equal(v['--fx-flash-b'], FLASH_DEFAULTS.flashB);
  assert.equal(v['--fx-flash-text'], FLASH_DEFAULTS.flashText);
  assert.equal(colorThemeVars({ scheme: 'dark', tokens: { ...base, flashA: '#123456' } })['--fx-flash-a'], '#123456'); // theme-ok: test data
});

await t('best match: exact text, then the dialog on top, then visible, then the row itself', () => {
  assert.equal(matchScore('Follow Amber flash', 'follow  amber FLASH'), 3);
  assert.equal(matchScore('Follow Amber flash · Feature', 'Follow Amber flash'), 2);
  assert.equal(matchScore('Build: Follow Amber flash', 'Follow Amber flash'), 1);
  assert.equal(matchScore('Something else', 'Follow Amber flash'), 0);
  const c = (text: string, onTop = false, visible = true, order = 0) => ({ text, onTop, visible, order });
  assert.equal(pickBest([c('Follow Amber flash · Feature', false, true, 0), c('Follow Amber flash', false, false, 1)], 'Follow Amber flash'), 1, 'exact beats partial, even off screen');
  assert.equal(pickBest([c('Builds', false, true, 0), c('Builds', true, true, 1)], 'builds'), 1, 'the dialog on top wins');
  assert.equal(pickBest([c('Builds', false, false, 0), c('Builds', false, true, 1)], 'builds'), 1, 'the visible one wins');
  assert.equal(pickBest([c('Plan Studio parked plans and more', false, true, 0), c('Plan Studio parked', false, true, 1)], 'plan studio'), 1, 'the shorter (the row, not its list)');
  assert.equal(pickBest([c('Builds', false, true, 0), c('Builds', false, true, 1)], 'builds'), 0, 'then document order');
  assert.equal(pickBest([c('Nope')], 'builds'), -1);
  assert.equal(pickBest([c('x'.repeat(500) + 'builds')], 'builds'), -1, 'a whole page of text is not a match');
});

await t('what flashed is reported as a short label', () => {
  assert.equal(flashLabel('  Follow Amber\n flash  ', 'x'), 'Follow Amber flash');
  assert.equal(flashLabel('', 'Builds'), 'Builds');
  assert.equal(flashLabel('y'.repeat(200), '').length, 80);
});

console.log(`✓ follow amber (web) — ${n} checks`);
