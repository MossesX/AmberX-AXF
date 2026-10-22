#!/usr/bin/env node
/**
 * CI: lib-github (x.lib.github) — replays fixtures/github.json against framework/cli/github.mjs (the Python twin,
 * framework/python/axf_server/github.py, replays the same file in framework/python/axf_server/test.py), then checks the
 * client's guards against a fake fetch: the token only on the API origin, no redirects followed, size cap, scrubbed
 * errors.
 *
 *   node framework/spec/check-github.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as gh from '../cli/github.mjs';

const FIX = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'github.json'), 'utf8'));
let ok = 0, fail = 0;
const check = (name, cond, detail = '') => { if (cond) ok++; else { fail++; console.error(`✗ ${name}${detail ? `: ${detail}` : ''}`); } };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const attempt = (f) => { try { return { out: f() }; } catch { return { error: true }; } };
const ordered = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));

/* ─── fixture ─────────────────────────────────────────────────────────── */

for (const c of FIX.validRepo) check(`validRepo ${JSON.stringify(c.input)}`, gh.validRepo(c.input) === c.out);
for (const c of FIX.parseRepo) check(`parseRepo ${JSON.stringify(c.input)}`, gh.parseRepo(c.input) === c.out, String(gh.parseRepo(c.input)));
for (const c of FIX.repoPath) {
  const r = attempt(() => gh.repoPath(c.repo, c.parts, c.query ?? undefined));
  check(`repoPath ${c.repo} ${c.parts.join('/')}`, c.error ? r.error === true : r.out === c.out, JSON.stringify(r));
}
for (const c of FIX.apiPath) {
  const r = attempt(() => gh.apiPath(c.parts, c.query ?? undefined));
  check(`apiPath ${c.parts.join('/')}`, c.error ? r.error === true : r.out === c.out, JSON.stringify(r));
}
for (const c of FIX.nextLink) check(`nextLink ${String(c.header).slice(0, 50)}`, gh.nextLink(c.header) === c.out, String(gh.nextLink(c.header)));
for (const c of FIX.runState) check(`runState ${c.status}/${c.conclusion}`, gh.runState(c.status, c.conclusion) === c.out);
for (const c of FIX.tokenAllowed) check(`tokenAllowed ${c.url} @ ${c.base}`, gh.tokenAllowed(c.url, c.base) === c.out);
for (const c of FIX.redirectStep) check(`redirectStep ${c.location} #${c.hop}`, same(gh.redirectStep(c.current, c.location, c.hop), c.out), JSON.stringify(gh.redirectStep(c.current, c.location, c.hop)));
for (const c of FIX.gitAuthConfig) check(`gitAuthConfig ${c.base}`, same(gh.gitAuthConfig(c.token, c.base), c.out));
for (const c of FIX.gitEnv) check(`gitEnv ${c.base} ${JSON.stringify(c.env)}`, same(ordered(gh.gitAuthEnv(c.token, c.base, c.env)), ordered(c.out)));
for (const c of FIX.scrub) check(`scrub ${c.text.slice(0, 30)}`, gh.scrub(c.text, c.secrets) === c.out, gh.scrub(c.text, c.secrets));

/* ─── client guards (fake fetch) ──────────────────────────────────────── */

const seen = [];
const respond = (status, body, headers = {}) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers });
const fake = async (url, init) => {
  seen.push({ url, init });
  if (init.redirect !== 'manual') throw new Error('redirects must be manual');
  if (url.endsWith('/user')) return respond(200, { login: 'MossesX' });
  if (url.endsWith('/moved')) return respond(301, '', { location: 'https://evil.example/x' });
  if (url.endsWith('/bad')) return respond(401, { message: 'Bad credentials for TOKEN-abc123' });
  if (url.endsWith('/big')) return respond(200, 'x'.repeat(5000));
  if (url.includes('/pages')) {
    const page = Number(new URL(url).searchParams.get('page') || 1);
    const next = page === 1 ? '<https://api.github.com/repos/o/r/pages?page=2>; rel="next"' : page === 2 ? '<https://evil.example/pages?page=3>; rel="next"' : '';
    return respond(200, { items: [page * 10, page * 10 + 1] }, next ? { link: next } : {});
  }
  return respond(404, { message: 'Not Found' });
};
const c = gh.createGitHub({ token: 'TOKEN-abc123', base: 'https://api.github.com', userAgent: 'axf-test', fetchImpl: fake });
check('client get', (await c.get('/user')).login === 'MossesX');
check('client sends bearer + api headers', seen[0].init.headers.Authorization === 'Bearer TOKEN-abc123' && seen[0].init.headers['X-GitHub-Api-Version'] === gh.API_VERSION && seen[0].init.headers['User-Agent'] === 'axf-test');
check('absolute URL on the API origin is allowed', (await c.get('https://api.github.com/user')).login === 'MossesX');
let n = seen.length;
let err = await c.get('https://evil.example/user').catch((e) => e);
check('absolute URL elsewhere refused before sending', err instanceof gh.GitHubError && err.status === 0 && seen.length === n);
err = await c.get('http://api.github.com/user').catch((e) => e);
check('plain http to the API refused', err instanceof gh.GitHubError && seen.length === n);
err = await c.get('/moved').catch((e) => e);
check('a redirect is an error, never followed', err.status === 301 && /redirects/.test(err.message) && !seen.some((s) => s.url.startsWith('https://evil.example')));
err = await c.get('/bad').catch((e) => e);
check('error message scrubbed', err.status === 401 && err.message === 'GitHub 401: Bad credentials for ***', err.message);
err = await c.call('GET', '/big', undefined, { maxBytes: 1000 }).catch((e) => e);
check('size cap', err instanceof gh.GitHubError && /larger/.test(err.message));
check('paginate follows next on the API origin only', same(await c.paginate('/repos/o/r/pages', { key: 'items' }), [10, 11, 20, 21]) && !seen.some((s) => s.url.startsWith('https://evil.example')));
check('paginate maxItems', same(await c.paginate('/repos/o/r/pages', { key: 'items', maxItems: 3 }), [10, 11, 20]));
const anon = gh.createGitHub({ token: '', base: 'https://api.github.com', fetchImpl: fake });
err = await anon.get('/user').catch((e) => e);
check('no token: refused with the hint', err instanceof gh.GitHubError && /GITHUB_TOKEN/.test(err.message));
n = seen.length;
check('no token, auth: false: anonymous call', (await anon.get('/user', { auth: false })).login === 'MossesX' && !('Authorization' in seen[n].init.headers));
let threw = false;
try { gh.createGitHub({ base: 'http://10.0.0.1' }); } catch { threw = true; }
check('base must be https (or loopback http)', threw);
const local = gh.createGitHub({ token: 't', base: 'http://127.0.0.1:9', fetchImpl: async () => { throw new TypeError('fetch failed', { cause: new Error('connect ECONNREFUSED t') }); } });
err = await local.get('/user').catch((e) => e);
check('network error: status 0, no token in the text', err.status === 0 && /not reachable/.test(err.message));

console.log(`lib-github (fixtures/github.json + client guards): ${ok} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
