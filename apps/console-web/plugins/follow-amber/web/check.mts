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
import { arrived, decide, drawable, highlightIsSelector, offers, parseFrame, pickNext, popsUpHere, queueOf, routeOf } from './core.ts';
import { detectEmbedFull, embedUrlFull } from '@console/axf/core/engines/embed';
import { bannerStripUrl } from '@console/axf/react/bannerStrip';
import { interpretApprovals } from '@console/axf/libs/approvals/core';

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

await t('routes: host first, then the hub origin, else the hub page (opened; framed only where the hub allows it)', () => {
  const h = { kind: 'held' } as const, a = { kind: 'approval' } as const;
  assert.equal(routeOf(h, { hub: HUB, origin: CONSOLE }), 'open', "the console can't sign and axHub refuses the frame here: open axHub's page");
  assert.equal(routeOf(h, { hub: HUB, origin: CONSOLE, frame: true }), 'frame', 'framed only when the hub frames its page for this origin');
  assert.equal(routeOf(h, { hub: HUB, origin: HUB }), 'hub');
  assert.equal(routeOf(h, { hub: HUB, origin: CONSOLE, vetoAct: async () => ({ ok: true }) }), 'host', "AmberX's shell signs held calls");
  assert.equal(routeOf(a, { hub: HUB, origin: CONSOLE, vetoAct: async () => ({ ok: true }) }), 'open', 'a veto host does not decide approvals');
  assert.equal(routeOf(a, { hub: HUB, origin: CONSOLE, approvalDecide: async () => ({ ok: true, message: '' }) }), 'host');
});

await t('no signed path here: nothing is sent, axHub opens (never a refused frame: the sad face, Nov 4 2026)', async () => {
  const before = hub.log.length;
  const r = await decide(feed.items.find((i) => i.id === A1)!, true, { hub: HUB, origin: CONSOLE, fetch: hub.fetch });
  assert.equal(r.open, true);
  assert.notEqual(r.frame, true, 'no frame of axHub inside the pop-up');
  assert.equal(r.ok, false);
  assert.equal(hub.log.length, before, 'no request reached the hub');
  const f = await decide(feed.items.find((i) => i.id === A1)!, true, { hub: HUB, origin: CONSOLE, fetch: hub.fetch, frame: true });
  assert.equal(f.frame, true, 'where the hub allows the frame, it still frames');
});

await t('a host that only opens the page (opened) opens axHub, never a frame', async () => {
  const r = await decide(feed.items.find((i) => i.id === A1)!, true, { hub: HUB, origin: CONSOLE, approvalDecide: async () => ({ ok: true, opened: true, message: '' }) });
  assert.equal(r.open, true);
  assert.notEqual(r.frame, true);
});

/* Regression (urgent-approval-popup-crash, Nov 4 2026): the held-call shapes vps.run, control_add and build_start send,
   plus hostile ones (a reason object where a string belongs, missing lists), all draw: every drawn field is a string. */
await t('real held-call payloads (vps.run, control_add, build_start) and broken fields draw without crashing', () => {
  const now = Date.now();
  const at = (s: number) => new Date(now + s * 1000).toISOString();
  const veto = (left: number) => ({ runsAt: at(left), secondsLeft: left, countdownSeconds: 90, actions: ['deny', 'approve-now', 'shelve'] });
  const ids = ['55555555-5555-4555-8555-555555555555', '66666666-6666-4666-8666-666666666666', '77777777-7777-4777-8777-777777777777', '88888888-8888-4888-8888-888888888888'];
  const pending = [
    { id: ids[0], tool: 'vps.run', status: 'held', summary: 'vps.run with arguments {"command":"uptime"}', args: { command: 'uptime' }, createdAt: at(-5), expiresAt: at(600), url: url(ids[0]!), jobId: 'job-u1',
      reason: { title: 'Check the VPS uptime', description: 'Harmless read: prints uptime for the popup repro.' }, source: { kind: 'headless', who: 'urgent-approval-popup-crash', client: 'claude-code' }, veto: veto(85) },
    { id: ids[1], tool: 'axf.control_add', status: 'held', summary: 'axf.control_add with arguments {"target":"tokens.theme","value":{"accent":"#f80"}}', args: { target: 'tokens.theme', value: { accent: '#f80' } }, createdAt: at(-4), expiresAt: at(600), url: url(ids[1]!), jobId: 'job-c1',
      reason: { title: 'Add a theme control', description: 'Adds a control@1 target for the accent colour.' }, source: { kind: 'claude-ai', session: 'chat Amber' }, veto: veto(60) },
    { id: ids[2], tool: 'axf.build_start', status: 'held', summary: 'axf.build_start with arguments {"id":"expenses-port","model":"opus"}', args: { id: 'expenses-port', model: 'opus' }, createdAt: at(-3), expiresAt: at(600), url: url(ids[2]!), jobId: 'job-b1',
      title: { title: 'Start build expenses-port' }, reason: { title: { nested: true }, description: ['not', 'a', 'string'] }, veto: veto(30) },
    { id: ids[3], tool: 'axf.build_start', summary: 'axf.build_start', createdAt: at(-2), expiresAt: at(600), url: url(ids[3]!), reason: 'Start it', actions: null, source: 'not an object' },
  ];
  const st = interpretApprovals(HUB, 200, JSON.stringify({ signedIn: true, admin: true, count: pending.length, pending }), now);
  assert.equal(st.status, 'ok');
  assert.equal(st.items.length, 4, 'every shape is read');
  const q = queueOf(st.items);
  for (const raw of q) {
    const d = drawable(raw)!;
    assert.ok(d, raw.id);
    for (const k of ['title', 'description', 'summary', 'command', 'tool', 'url'] as const) assert.equal(typeof d[k], 'string', `${raw.tool} ${k}`);
    assert.ok(d.title.length > 0, 'always a title');
    assert.ok(d.decisions.length > 0, 'always a button to tap');
    assert.ok(offers(d, false), 'Deny is always there');
  }
  assert.equal(drawable(q.find((i) => i.id === ids[0]))!.command, 'uptime');
  assert.equal(drawable(q.find((i) => i.id === ids[1]))!.title, 'Add a theme control');
  // shapes the lib never produces but a stale bundle or a hub change could: objects and junk where strings belong
  const junk = drawable({ id: 'x1', kind: 'held', tool: { name: 'vps.run' }, title: { title: 'A title object' }, description: { a: 1 }, decisions: 'deny', veto: 'nope', source: { kind: 'x' } })!;
  assert.equal(junk.title, 'A title object');
  assert.equal(typeof junk.description, 'string');
  assert.deepEqual(junk.decisions, ['deny']);
  assert.equal(junk.veto, null);
  assert.equal(junk.source, null);
  assert.equal(drawable(null), null);
  assert.equal(drawable({ tool: 'vps.run' }), null, 'no id: nothing to decide');
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

await t('inside a Molly-style embed only the whole console pops up, never its banner strip page', async () => {
  // Molly frames the console twice: the app (host molly, chrome hidden) and its banner strip (page view:axf-banners).
  const app = detectEmbedFull(new URL(embedUrlFull(CONSOLE, 'molly', { hidden: ['banner', 'app-menu', 'toolbar'] })).search, '');
  const strip = detectEmbedFull(new URL(bannerStripUrl(CONSOLE, 'molly')).search, '');
  assert.equal(app?.host, 'molly');
  assert.ok(strip?.page, 'the strip is a page view');
  assert.equal(popsUpHere(null), true, 'standalone console pops up');
  assert.equal(popsUpHere(app), true, 'the console in Molly pops up');
  assert.equal(popsUpHere(strip), false, "the strip's copy stays quiet");
  // And the pop-up in Molly never frames the hub (Molly is an ancestor the hub doesn't list): the tap opens axHub.
  const h = fakeHub();
  const f = await fetchApprovals(HUB, { fetch: h.fetch });
  const held = f.items.find((i) => i.id === H1)!;
  assert.equal(routeOf(held, { hub: HUB, origin: CONSOLE }), 'open');
  const r = await decide(held, true, { hub: HUB, origin: CONSOLE, fetch: h.fetch });
  assert.ok(r.open && !r.frame, 'no refused frame in the pop-up');
  assert.ok(drawable(held), 'the held call draws');
});

console.log(`✓ follow amber (web) — ${n} checks`);
