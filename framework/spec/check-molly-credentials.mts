/**
 * molly-credentials@1 (apps/molly/src/molly/credentials.ts): Molly's credential seam. Every Molly app has a backend
 * entry; the API base comes from the setting override or the default; each scheme prepares a request its own way
 * (bearer: Authorization and no cookies; session: cookies, CSRF on writes; none: nothing); `check` maps the backend's
 * answer to signed-in / signed-out / unreachable; sign-in and sign-out; a plugin's provider replaces the default and
 * is restored when its owner is cleared; the API client rides the seam.
 *   npx -y tsx framework/spec/check-molly-credentials.mts
 */
import assert from 'node:assert/strict';
import { MOLLY_APPS } from '../../apps/molly/src/molly/apps';
import {
  AUTH_SCHEMES, CONNECTION_STATES, CREDENTIALS_CONTRACT, CredentialSeam, MOLLY_BACKENDS, WRITE_METHODS, authSettingKeys, backendErrors, backendOf,
  connectionLine, joinUrl, memoryTokens, normalizeApiBase, originOf, type AppConnection, type AuthProvider,
} from '../../apps/molly/src/molly/credentials';

let checks = 0;
const ok = (c: unknown, msg: string) => { assert.ok(c, msg); checks++; };
const eq = (a: unknown, b: unknown, msg: string) => { assert.deepEqual(a, b, msg); checks++; };

// ---- registry ----
eq(CREDENTIALS_CONTRACT, 'molly-credentials@1', 'contract');
eq(AUTH_SCHEMES, ['bearer', 'session', 'none'], 'schemes');
eq(CONNECTION_STATES, ['signed-in', 'signed-out', 'unreachable', 'unknown', 'none'], 'states');
eq(WRITE_METHODS, ['POST', 'PUT', 'PATCH', 'DELETE'], 'write methods');
eq(backendErrors(), [], 'every Molly app has a backend entry and every entry is sound');
eq(backendErrors([{ id: 'x' }], []), ['app x has no backend entry'], 'a missing entry is reported');
eq(backendErrors([], MOLLY_BACKENDS).length, MOLLY_BACKENDS.length, 'an entry without an app is reported');
eq(MOLLY_APPS.map((a) => a.id).sort(), MOLLY_BACKENDS.map((b) => b.app).sort(), 'the two lists are the same apps');
eq(backendOf('console')?.scheme, 'bearer', 'console: bearer token');
eq(backendOf('axhub')?.scheme, 'session', 'axHub: session');
eq(backendOf('expenses')?.scheme, 'session', 'Expenses: session');
eq(backendOf('amberx')?.scheme, 'none', 'AmberX: nothing to sign in to');

// ---- helpers ----
eq(normalizeApiBase('https://console.amberxai.com/api/'), 'https://console.amberxai.com/api', 'base: trailing slash dropped');
eq(normalizeApiBase('HTTPS://Console.AmberXai.com'), 'https://console.amberxai.com', 'base: origin normalised');
for (const bad of ['http://x.test/api', 'https://u:p@x.test', 'https://x.test/?q=1', 'https://x.test/#f', '', '   ', 'not a url', 42, null])
  eq(normalizeApiBase(bad), null, `base refused: ${JSON.stringify(bad)}`);
eq(joinUrl('https://x.test/api', '/me'), 'https://x.test/api/me', 'join strips the leading slash');
eq(joinUrl('https://x.test/api', ''), 'https://x.test/api', 'join with no path is the base');
eq(originOf('https://expenses.amberxai.com/api/expenses/v1'), 'https://expenses.amberxai.com', 'origin of a base');
eq(originOf('nope'), '', 'origin of nothing');
eq(authSettingKeys('console'), { base: 'molly.auth.console.base', user: 'molly.auth.console.user' }, 'setting keys');

// ---- a seam over a fake fetch ----
type Call = { url: string; init: RequestInit };
const calls: Call[] = [];
let answer: (url: string, init: RequestInit) => { status: number; json?: unknown } | 'down' = () => ({ status: 200, json: {} });
const fakeFetch = async (url: string, init: RequestInit): Promise<Response> => {
  calls.push({ url, init });
  const a = answer(url, init);
  if (a === 'down') throw new TypeError('Failed to fetch');
  return new Response(a.json === undefined ? 'not json' : JSON.stringify(a.json), { status: a.status, headers: { 'content-type': 'application/json' } });
};
const settings = new Map<string, unknown>();
const watchers = new Map<string, Set<() => void>>();
const setSetting = (k: string, v: unknown) => { if (v === null) settings.delete(k); else settings.set(k, v); watchers.get(k)?.forEach((f) => f()); };
const stores = new Map<string, ReturnType<typeof memoryTokens>>();
const seam = new CredentialSeam({
  settings: { get: (k) => settings.get(k), onChange: (k, fn) => { const s = watchers.get(k) ?? new Set(); s.add(fn); watchers.set(k, s); return () => { s.delete(fn); }; } },
  fetch: fakeFetch,
  tokens: (k) => { let s = stores.get(k); if (!s) { s = memoryTokens(k); stores.set(k, s); } return s; },
  now: () => '2026-11-10T12:00:00.000Z',
});
const header = (c: Call, name: string) => new Headers(c.init.headers).get(name);
const last = () => calls[calls.length - 1]!;
let revs = 0; seam.subscribe(() => { revs++; });

eq(seam.apps().sort(), MOLLY_APPS.map((a) => a.id).sort(), 'the seam holds every Molly app');
eq(seam.provider('nope'), null, 'an unknown app has no provider');
eq(seam.connections().map((c) => c.state), MOLLY_APPS.map((a) => (a.id === 'amberx' ? 'none' : 'unknown')), 'unknown until the first check (none for AmberX)');

// console: bearer
const console_ = seam.provider('console')!;
eq(console_.apiBase(), 'https://console.amberxai.com/api', 'console default base');
let c = await console_.check();
eq(c.state, 'signed-out', 'console without a token: signed out');
eq(c.hasToken, false, 'no token saved');
eq(last().url, 'https://console.amberxai.com/api/me', 'console whoami is /api/me');
eq(header(last(), 'authorization'), null, 'no Authorization header without a token');
eq(last().init.credentials, 'omit', 'a bearer app never gets cookies');
eq(last().init.redirect, 'error', 'redirects refused');
eq(last().init.cache, 'no-store', 'never cached');
answer = () => ({ status: 200, json: { wall: true, role: 'admin', user: null, admin: true } });
let r = await console_.signIn('tok-123');
eq(r.open, null, 'a bearer sign-in opens no page');
eq(r.connection.state, 'signed-in', 'console with an accepted token: signed in');
eq(r.connection.who, 'console token', 'who: the token');
eq(header(last(), 'authorization'), 'Bearer tok-123', 'the token rides as Bearer');
ok(!last().url.includes('tok-123'), 'the token is never in the URL');
eq(connectionLine(r.connection), 'Console: signed in as console token (token)', 'status line');
answer = () => ({ status: 200, json: { wall: true, role: null, user: null } });
c = await console_.check();
eq([c.state, c.detail], ['signed-out', 'The token was not accepted.'], 'a token the console refuses: signed out with the reason');
answer = () => ({ status: 401, json: { detail: 'console token required' } });
c = await console_.check(); eq([c.state, c.detail], ['signed-out', 'Console token required.'], '401: signed out');
answer = () => 'down';
c = await console_.check();
eq(c.state, 'unreachable', 'a failed fetch is unreachable');
ok(/Molly's address/.test(c.detail), 'the line names the CORS cause too');
answer = () => ({ status: 500, json: {} });
c = await console_.check(); eq(c.detail, 'The server answered 500.', 'other statuses are named');
c = await console_.signOut();
eq([c.hasToken, header(last(), 'authorization')], [false, null], 'sign-out forgets the token');

// base override through the setting
setSetting(authSettingKeys('console').base, 'https://console.example.test/api/');
eq(console_.apiBase(), 'https://console.example.test/api', 'the setting overrides the base (normalised)');
eq(console_.connection().baseOverridden, true, 'the connection says so');
await console_.check(); eq(last().url, 'https://console.example.test/api/me', 'calls follow the override');
setSetting(authSettingKeys('console').base, 'http://insecure.test');
eq(console_.apiBase(), 'https://console.amberxai.com/api', 'an unusable override is ignored');
setSetting(authSettingKeys('console').base, null);
eq(console_.connection().baseOverridden, false, 'cleared: back to the default');

// axHub: session + CSRF
const hub = seam.provider('axhub')!;
answer = () => ({ status: 200, json: { signedIn: false, hub: 'https://axhub.amberxai.com', loginUrl: 'https://axhub.amberxai.com/auth/login?rd=%2F' } });
c = await hub.check();
eq(c.state, 'signed-out', 'hub session signed out');
eq(last().url, 'https://axhub.amberxai.com/auth/api/session', 'hub whoami');
eq(last().init.credentials, 'include', 'a session app sends the browser cookie');
eq(c.signInUrl, 'https://axhub.amberxai.com/auth/login?rd=%2F', 'the hub names its sign-in page');
r = await hub.signIn();
eq(r.open, 'https://axhub.amberxai.com/auth/login?rd=%2F', 'a session sign-in answers the page to open');
eq(calls.length, (() => calls.length)(), 'and does no network');
answer = () => ({ status: 200, json: { signedIn: true, user: { username: 'brett' }, csrf: 'csrf-1', admin: true } });
c = await hub.check();
eq([c.state, c.who, c.signInUrl], ['signed-in', 'brett', ''], 'signed in as brett; no sign-in page while signed in');
let p = hub.prepare({ method: 'post', body: '{}' });
eq(new Headers(p.headers).get('X-AxHub-CSRF'), 'csrf-1', 'a write carries the CSRF value');
eq(p.method, 'POST', 'method upper-cased');
eq(new Headers(p.headers).get('content-type'), 'application/json', 'JSON content type with a body');
p = hub.prepare({ method: 'GET' });
eq(new Headers(p.headers).get('X-AxHub-CSRF'), null, 'a read carries none');
eq(new Headers(p.headers).get('accept'), 'application/json', 'Accept JSON by default');
// a write through the seam on a fresh CSRF: checks first
const hub2 = new CredentialSeam({ settings: { get: () => undefined }, fetch: fakeFetch, tokens: (k) => memoryTokens(k) });
calls.length = 0;
await hub2.fetch('axhub', 'auth/api/approvals/x/approve', { method: 'POST', body: '{}' });
eq(calls.map((x) => x.url.replace('https://axhub.amberxai.com/', '')), ['auth/api/session', 'auth/api/approvals/x/approve'], 'a first write reads the session for its CSRF value');
eq(header(calls[1]!, 'X-AxHub-CSRF'), 'csrf-1', 'then carries it');
// sign-out posts to the hub then re-checks
calls.length = 0;
answer = (url) => (url.endsWith('/logout') ? { status: 200, json: { message: 'bye' } } : { status: 200, json: { signedIn: false, hub: 'https://axhub.amberxai.com' } });
c = await hub.signOut();
eq(calls.map((x) => x.url.split('/').pop()), ['logout', 'session'], 'sign-out: POST logout, then who am I');
eq(header(calls[0]!, 'X-AxHub-CSRF'), 'csrf-1', 'the logout carried the CSRF value');
eq(c.state, 'signed-out', 'signed out afterwards');
answer = () => ({ status: 404 });
c = await hub.check(); eq(c.detail, "This hub hasn't got its JSON API yet.", 'an old hub is named');

// Expenses: cookie session, or a token with the user header
const ex = seam.provider('expenses')!;
answer = () => ({ status: 401, json: { error: 'sign in or send a bearer token' } });
c = await ex.check();
eq([c.state, c.detail, c.signInUrl], ['signed-out', 'sign in or send a bearer token', 'https://expenses.amberxai.com/login'], 'Expenses signed out: its own words and its sign-in page');
eq(last().url, 'https://expenses.amberxai.com/api/expenses/v1/entries?limit=1', 'Expenses whoami reads one entry');
eq(last().init.credentials, 'include', 'cookie session');
answer = () => ({ status: 200, json: { entries: [], count: 0, of: 0 } });
c = await ex.check(); eq([c.state, c.hasToken], ['signed-in', false], 'a 200 ledger read is signed in');
setSetting(authSettingKeys('expenses').user, 'brett');
r = await ex.signIn('exp-token');
eq(header(last(), 'authorization'), 'Bearer exp-token', 'a token on a session app rides as Bearer');
eq(header(last(), 'X-Expenses-User'), 'brett', 'with the user it acts as');
eq(last().init.credentials, 'omit', 'and no cookie');
eq([r.connection.hasToken, r.connection.signInUrl], [true, ''], 'with a token there is no page to open');
answer = () => ({ status: 400, json: { error: 'no user: send X-Expenses-User or set EXPENSES_API_USER' } });
c = await ex.check(); eq(c.state, 'signed-out', 'a token without a user is signed out');

// AmberX: nothing to do
const ax = seam.provider('amberx')!;
calls.length = 0;
c = await ax.check();
eq([c.state, calls.length], ['none', 0], 'no backend: no call');
eq((await ax.signIn()).open, null, 'nothing to open');
eq(connectionLine(c), 'AmberX: no sign-in · No backend of its own; it reads the hub.', 'status line');

// plugin override and restore
const fake: AuthProvider = {
  app: 'console', scheme: 'session', apiBase: () => 'https://sso.test/api', url: (p) => `https://sso.test/api/${p}`,
  prepare: (i = {}) => ({ ...i, credentials: 'include' }),
  connection: (): AppConnection => ({ app: 'console', label: 'Console', scheme: 'session', apiBase: 'https://sso.test/api', baseOverridden: false, state: 'signed-in', who: 'sso', detail: '', signInUrl: '', hasToken: false, checkedAt: null }),
  check: async () => fake.connection(), signIn: async () => ({ connection: fake.connection(), open: null }), signOut: async () => fake.connection(), subscribe: () => () => {},
};
const before = revs;
const restore = seam.set('ai.amberx.axf.molly.sso', 'console', fake);
eq(seam.provider('console'), fake, 'a plugin provider replaces the default');
eq(seam.connection('console')?.who, 'sso', 'connections read the plugin provider');
ok(revs > before, 'subscribers heard');
calls.length = 0;
await seam.fetch('console', 'builds');
eq([last().url, last().init.credentials], ['https://sso.test/api/builds', 'include'], 'fetch rides the plugin provider');
restore();
eq(seam.provider('console'), console_, 'restored');
seam.set('ai.amberx.axf.molly.sso', 'console', fake); seam.set('ai.amberx.axf.molly.sso', 'axhub', fake);
seam.clearOwner('ai.amberx.axf.molly.sso');
eq([seam.provider('console'), seam.provider('axhub')], [console_, hub], 'clearing the owner restores every default');
await assert.rejects(() => seam.fetch('nope', 'x'), /doesn't hold an app/); checks++;

// the API client over the seam
answer = () => ({ status: 200, json: { items: [1, 2] } });
await console_.signIn('tok-9');
const api = seam.api('console');
eq(await api.call('builds'), { items: [1, 2] }, 'call returns JSON');
eq([header(last(), 'authorization'), last().url], ['Bearer tok-9', 'https://console.amberxai.com/api/builds'], 'through the provider');
answer = () => ({ status: 401, json: { detail: 'console token required' } });
await assert.rejects(() => api.call('builds'), /console token required/); checks++;
answer = () => 'down';
await assert.rejects(() => api.call('builds'), /Can't reach Console from Molly/); checks++;
answer = (url) => (url.endsWith('/session') ? { status: 200, json: { signedIn: true, user: { username: 'brett' }, csrf: 'csrf-1' } } : { status: 200, json: { ok: true } });
const hubApi = seam.api('axhub');
await hub.check();
await hubApi.post('auth/api/approvals/x/approve', { note: 'ok' });
eq([header(last(), 'X-AxHub-CSRF'), last().init.credentials, header(last(), 'authorization')], ['csrf-1', 'include', null], 'a hub write through the client: cookie + CSRF, no bearer');

console.log(`check-molly-credentials: ok (${checks} checks)`);
