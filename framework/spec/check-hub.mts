/**
 * Self-test for lib-hub on the web port (CI: npx -y tsx framework/spec/check-hub.mts).
 *  1. replays spec/fixtures/hub-approvals.json against libs/hub/hub.ts (the Kotlin lib-hub replays the same file)
 *  2. drives fetchHubFeed + HubWatcher against a fake fetch: credentials included, redirects refused, size cap,
 *     network errors, a bad hub address, resolveHub, one check at a time
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  HUB_DEFAULT, HUB_FEED_MAX_BYTES, HUB_FEED_MAX_ITEMS, HUB_FEED_STATUSES, HUB_FIELD_CAPS, HUB_MESSAGES, HUB_PATHS, HUB_SEEN_CAP,
  accountUrl, apkDownloadName, approvalUrl, approvalsUrl, appsUrl, csrfFromPage, feedUrl, fetchHubFeed, hubOrigin, interpretFeed, isHub,
  loginUrl, logoutUrl, normalizeHub, seenPlan, unreachableFeed,
} from '../libs/hub/hub';
import { APPS_FEED_MAX_BYTES, APPS_FEED_PATH, APPS_MAX, VERSIONS_MAX, appsFeedUrl, expiry, fetchHubApps, formatSize, interpretApps, shortSha, statusNote } from '../libs/hub/apps';
// tsx loads these as CommonJS, where `export *` re-exports aren't visible to named imports: take the watcher from index directly
import { HubWatcher } from '../libs/hub/index';

const f = JSON.parse(readFileSync(new URL('./fixtures/hub-approvals.json', import.meta.url), 'utf8'));
let checks = 0;
const norm = (v: unknown) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const eq = (a: unknown, b: unknown, what: string) => { assert.deepEqual(norm(a), norm(b), what); checks++; };

/* ---------- 1. fixture replay ---------- */
eq(HUB_DEFAULT, f.default, 'default');
eq(HUB_PATHS, f.paths, 'paths');
eq({ feedMaxBytes: HUB_FEED_MAX_BYTES, feedMaxItems: HUB_FEED_MAX_ITEMS, seenCap: HUB_SEEN_CAP, fieldCaps: HUB_FIELD_CAPS }, f.limits, 'limits');
eq(HUB_FEED_STATUSES, f.statuses, 'statuses');
eq(HUB_MESSAGES, f.messages, 'messages');
for (const c of f.normalize) eq(normalizeHub(c.raw), c.hub, `normalize ${JSON.stringify(c.raw)}`);
for (const c of f.origin) eq(hubOrigin(c.url), c.origin, `origin ${JSON.stringify(c.url)}`);
for (const c of f.isHub) eq(isHub(c.base, c.url), c.isHub, `isHub ${c.url}`);
const u = f.urls;
eq({ base: u.base, approvals: approvalsUrl(u.base), apps: appsUrl(u.base), account: accountUrl(u.base), logout: logoutUrl(u.base), feed: feedUrl(u.base), login: loginUrl(u.base) }, u, 'urls');
for (const c of f.approval) eq(approvalUrl(c.base, c.id), c.url, `approval ${c.id}`);
for (const c of f.login) eq(loginUrl(c.base, c.path), c.url, `login ${c.path}`);
for (const c of f.apk) eq(apkDownloadName(c.base, c.url), c.name, `apk ${c.url}`);
for (const c of f.csrf) eq(csrfFromPage(c.html), c.token, `csrf ${c.html}`);
for (const c of f.feeds) eq(interpretFeed(c.base, c.status, c.body), c.feed, `feed ${c.name}`);
eq(unreachableFeed(f.unreachable.base, f.unreachable.error), f.unreachable.feed, 'unreachable');
for (const c of f.seen) eq(seenPlan(c.seen, c.current), c.plan, `seen ${c.current}`);

// the app catalog (apps section; the Kotlin twin waits for the Android hold to lift)
const A = f.apps;
eq([APPS_FEED_PATH, appsFeedUrl(f.default)], [A.path, A.url], 'apps feed path + url');
eq({ appsMax: APPS_MAX, versionsMax: VERSIONS_MAX, feedMaxBytes: APPS_FEED_MAX_BYTES }, A.limits, 'apps limits');
for (const c of A.feeds) eq(interpretApps(c.base, c.status, c.body), c.feed, `apps ${c.name}`);
for (const c of A.feeds) for (const a of c.feed.apps) for (const b of [a.latest, ...a.earlier]) {
  eq(isHub(c.base, b.url) && b.url === `${c.base}/apps/download/${a.project}/${b.file}`, true, `apps ${c.name}: ${b.file} link rebuilt on the hub`);
}

/* ---------- 2. the client against a fake fetch ---------- */
const ID = 'dfe44a5d-15ab-47bf-8128-9843d37cd6ec';
const okBody = JSON.stringify({ signedIn: true, admin: true, count: 1, pending: [{ id: ID, tool: 'vps.run', summary: 's', createdAt: 'a', expiresAt: 'b', url: `${HUB_DEFAULT}/auth/admin/approvals/${ID}` }] });
type Call = { url: string; init: RequestInit };
const calls: Call[] = [];
const fake = (respond: (c: Call) => Response | Promise<Response>) => async (url: string, init: RequestInit) => { const c = { url, init }; calls.push(c); return respond(c); };

const r1 = await fetchHubFeed(HUB_DEFAULT, { fetch: fake(() => new Response(okBody, { status: 200 })) });
eq(r1.status, 'ok', 'client ok'); eq(r1.pending[0]?.url, `${HUB_DEFAULT}/auth/admin/approvals/${ID}`, 'client link');
const c1 = calls.at(-1)!;
eq(c1.url, `${HUB_DEFAULT}/auth/admin/approvals.json`, 'feed url');
eq([c1.init.credentials, c1.init.redirect, c1.init.cache], ['include', 'error', 'no-store'], 'credentials included, redirects refused, no cache');
eq((await fetchHubFeed(HUB_DEFAULT, { fetch: fake(() => new Response('{}', { status: 401 })) })).status, 'signed-out', 'client 401');
eq((await fetchHubFeed(HUB_DEFAULT, { fetch: fake(() => new Response('{}', { status: 403 })) })).status, 'not-admin', 'client 403');
const net = await fetchHubFeed(HUB_DEFAULT, { fetch: fake(() => { throw new TypeError('Failed to fetch'); }) });
eq([net.status, net.error], ['unreachable', 'Failed to fetch'], 'network error');
const redirected = await fetchHubFeed(HUB_DEFAULT, { fetch: fake(() => new Response(null, { status: 302, headers: { location: 'https://evil.example' } })) });
eq(redirected.status, 'unreachable', 'redirect never followed');
const huge = await fetchHubFeed(HUB_DEFAULT, { fetch: fake(() => new Response(JSON.stringify({ count: 1, pending: [], pad: 'x'.repeat(HUB_FEED_MAX_BYTES) }), { status: 200 })) });
eq([huge.status, huge.error], ['unreachable', HUB_MESSAGES.tooLarge], 'size cap');
const n0 = calls.length;
const bad = await fetchHubFeed('http://axhub.amberxai.com', { fetch: fake(() => new Response(okBody)) });
eq([bad.status, calls.length], ['unreachable', n0], 'a bad hub address is never fetched');

// watcher: resolves the hub once, one check at a time, tells subscribers, onCheck sees the state
let resolves = 0; let seen = 0; let onCheck = 0;
let release: () => void = () => undefined;
const w = new HubWatcher({
  hub: 'https://not-this.example',
  resolveHub: async () => { resolves++; return 'https://Hub.Example.Test/'; },
  fetch: fake((c) => new Promise<Response>((res) => { release = () => res(new Response(okBody.replaceAll(HUB_DEFAULT, 'https://hub.example.test'), { status: 200 })); void c; })),
  onCheck: () => { onCheck++; },
});
w.subscribe(() => { seen++; });
eq(w.state.phase, 'idle', 'watcher idle first');
const p1 = w.check(); const p2 = w.check();
await new Promise((r) => setTimeout(r, 0));
release();
await Promise.all([p1, p2]);
eq([resolves, onCheck, seen], [1, 1, 1], 'one check at a time, hub resolved once');
eq([w.state.phase, w.state.hub, w.state.status, w.state.pending.length, calls.at(-1)!.url], ['checked', 'https://hub.example.test', 'ok', 1, 'https://hub.example.test/auth/admin/approvals.json'], 'watcher state');
const p3 = w.check(); await new Promise((r) => setTimeout(r, 0)); release(); await p3;
eq(resolves, 1, 'hub resolved only once');

// catalog client: same transport rules as the feed
const apOk = await fetchHubApps(HUB_DEFAULT, { fetch: fake(() => new Response(A.feeds[0].body, { status: 200 })) });
eq([apOk.status, apOk.apps.length], ['ok', 1], 'apps client ok');
const ca = calls.at(-1)!;
eq([ca.url, ca.init.credentials, ca.init.redirect, ca.init.cache], [`${HUB_DEFAULT}/apps.json`, 'include', 'error', 'no-store'], 'apps: credentials included, redirects refused, no cache');
eq((await fetchHubApps(HUB_DEFAULT, { fetch: fake(() => new Response(null, { status: 302, headers: { location: 'https://evil.example' } })) })).status, 'unreachable', 'apps redirect never followed');
eq((await fetchHubApps(HUB_DEFAULT, { fetch: fake(() => new Response('x'.repeat(APPS_FEED_MAX_BYTES + 1), { status: 200 })) })).status, 'unreachable', 'apps size cap');
eq((await fetchHubApps(HUB_DEFAULT, { fetch: fake(() => new Response('{}', { status: 401 })) })).status, 'signed-out', 'apps 401');
const nApps = calls.length;
eq([(await fetchHubApps('http://axhub.amberxai.com', { fetch: fake(() => new Response('{}')) })).status, calls.length], ['unreachable', nApps], 'apps: a bad hub address is never fetched');
// display words
eq([formatSize(512), formatSize(7_340_032), formatSize(-1), shortSha('a'.repeat(64)), shortSha('x')], ['512 B', '7.0 MB', '—', 'aaaaaaaaaaaa', ''], 'sizes + short hash');
eq(expiry({ expiresAt: '2026-10-21T18:02:00.000Z' }, Date.parse('2026-10-21T18:00:00.000Z')), { text: '2 min left', soon: true, expired: false }, 'expiry soon');
eq([statusNote('signed-out', ''), statusNote('unreachable', ''), statusNote('ok', '')], ['Sign in to the hub to see this.', HUB_MESSAGES.unreachable, ''], 'status notes');

console.log(`✓ lib-hub (web): ${checks} checks (fixture hub-approvals.json incl. apps + clients + watcher)`);
