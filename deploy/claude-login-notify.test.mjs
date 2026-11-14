#!/usr/bin/env node
/**
 * Login events reach the phone: every sign-in verified (ok / renews / failed / unchecked) and every token refresh
 * confirmed as saved. Fake tokens, a local HTTP server standing in for Anthropic, alerts captured to a file through
 * AXF_LOGIN_NOTIFY_CMD: nothing reaches the real console, phone or Anthropic.
 *
 *   node deploy/claude-login-notify.test.mjs
 */
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmp = mkdtempSync(join(tmpdir(), 'axf-login-notify-'));
const SINK = join(tmp, 'alerts.jsonl');
// set before the modules run: alerts go to a file, verification to the local server below
Object.assign(process.env, { AXF_LOGIN_NOTIFY: 'on', AXF_LOGIN_VERIFY: 'on', AXF_LOGIN_NOTIFY_CMD: `cat >> '${SINK}'; echo >> '${SINK}'`, AXF_HEADLESS_DIR: join(tmp, 'headless'), AXF_CREW_SAY: 'off' });
delete process.env.CLAUDE_CONFIG_DIR; delete process.env.AXF_CLAUDE_ACCOUNT;

const N = await import('./claude-login-notify.mjs');
const { release, snapshot } = await import('./claude-login.mjs');
const { saveBack } = await import('./claude-token-save.mjs');

let n = 0; let failed = 0;
const ok = (c, msg) => { n++; if (c) console.log(`  ✓ ${msg}`); else { failed++; console.log(`  ✗ FAIL ${msg}`); } };
const alerts = () => { try { return readFileSync(SINK, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };
const SECRET = 'fake-access-SECRET-777';

// the stand-in for Anthropic: the profile answers 200 for the good token, 401 for anything else; models wants the key
const seen = [];
const server = createServer((req, res) => {
  seen.push({ url: req.url, auth: req.headers.authorization || '', key: req.headers['x-api-key'] || '' });
  const good = req.url.startsWith('/api/oauth/profile') ? req.headers.authorization === `Bearer ${SECRET}` : req.url.startsWith('/v1/models') ? req.headers['x-api-key'] === 'fake-key-1' : false;
  res.writeHead(good ? 200 : 401, { 'content-type': 'application/json' }); res.end(good ? '{"account":{}}' : '{"error":"unauthorized"}');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
process.env.AXF_LOGIN_VERIFY_URL = `http://127.0.0.1:${server.address().port}`;

console.log('the alerts');
const at = new Date().toISOString();
const a1 = N.alertOf({ kind: 'signin', account: 'acct', build: 'b1', result: 'ok', at, shared: true });
ok(a1.source === 'claude-login' && a1.key.startsWith('claude-login:signin:ok:acct:b1:') && a1.severity === 'success' && /verified: acct · b1/.test(a1.title), 'sign-in OK: account + build in the title, its own key');
ok(N.alertOf({ kind: 'signin', account: 'acct', build: 'b1', result: 'failed', at, detail: 'HTTP 401' }).key.startsWith('claude-login:signin:failed:'), 'a failure has the failed key (its own phone setting)');
ok(/FAILED/.test(N.alertOf({ kind: 'signin', account: 'acct', result: 'failed', at }).title) && N.alertOf({ kind: 'signin', result: 'failed', at }).severity === 'error', 'a failed sign-in is an error');
ok(/refreshed: acct/.test(N.alertOf({ kind: 'refresh', account: 'acct', result: 'ok', saved: 2, at }).title) && /shared login file and 2 other stores, read back OK/.test(N.alertOf({ kind: 'refresh', account: 'acct', result: 'ok', saved: 2, at }).body), 'refresh OK says it was saved and read back');
ok(/NOT saved/.test(N.alertOf({ kind: 'refresh', account: 'acct', result: 'failed', at }).title), 'a refresh that was not saved says so');

console.log('verifying a token with Anthropic');
const cfg = join(tmp, 'cfg'); mkdirSync(cfg);
const creds = (access, exp) => writeFileSync(join(cfg, '.credentials.json'), JSON.stringify({ claudeAiOauth: { accessToken: access, refreshToken: 'fake-refresh-1', expiresAt: exp } }));
creds(SECRET, Date.now() + 3600e3);
ok((await N.verifyToken({ config: cfg })).result === 'ok', 'a live access token: ok (HTTP 200 from the profile)');
ok(seen.at(-1).url === '/api/oauth/profile' && seen.at(-1).auth === `Bearer ${SECRET}`, 'the same call Claude Code makes: GET /api/oauth/profile with the bearer token');
creds('fake-access-revoked', Date.now() + 3600e3);
const r401 = await N.verifyToken({ config: cfg });
ok(r401.result === 'failed' && /HTTP 401/.test(r401.detail), 'a refused token: failed (HTTP 401)');
const callsBefore = seen.length; creds('fake-access-old', Date.now() - 1000);
ok((await N.verifyToken({ config: cfg })).result === 'renews' && seen.length === callsBefore, 'an expired access token with a refresh token: renews (no call made)');
const keyDir = join(tmp, 'kb'); mkdirSync(keyDir); writeFileSync(join(keyDir, 'token.env'), "unset CLAUDE_CODE_OAUTH_TOKEN\nexport ANTHROPIC_API_KEY='fake-key-1'\n");
ok((await N.verifyToken({ config: keyDir, buildDir: keyDir, kind: 'api' })).result === 'ok' && seen.at(-1).url.startsWith('/v1/models') && seen.at(-1).key === 'fake-key-1', 'an API-key account: checked on /v1/models with its key');
const down = await N.verifyToken({ config: cfg }, { ...process.env, AXF_LOGIN_VERIFY_URL: 'http://127.0.0.1:9' });
ok(down.result === 'renews' || down.result === 'unchecked', 'no answer: never reported as a failure');
creds(SECRET, Date.now() + 3600e3);
ok((await N.verifyToken({ config: cfg }, { ...process.env, AXF_LOGIN_VERIFY_URL: 'http://127.0.0.1:9' })).result === 'unchecked', 'Anthropic unreachable: unchecked');

console.log('a build signs in: verified and on the phone');
const A = join(tmp, 'accounts'); const SH = join(tmp, 'claude-home');
mkdirSync(join(A, 'acct'), { recursive: true }); mkdirSync(SH, { recursive: true });
writeFileSync(join(A, 'acct', '.credentials.json'), JSON.stringify({ claudeAiOauth: { accessToken: SECRET, refreshToken: 'fake-refresh-0', expiresAt: Date.now() + 3600e3 } }));
writeFileSync(join(A, '.active'), 'acct\n');
const env = { ...process.env, HOME: tmp, AXF_CLAUDE_ACCOUNTS: A, AXF_CLAUDE_HOME: SH, AXF_CLAUDE_GLOBAL: join(tmp, 'g.json'), AXF_CLAUDE_SEEN: join(tmp, 'seen.json'), AXF_AI_KEYS_HOST_DIR: join(tmp, 'ai-keys') };
const build = join(tmp, 'build'); mkdirSync(build);
const s = snapshot({ dir: build, session: 'axf-demo', env });
rmSync(SINK, { force: true });
const ev = await N.verifyBuild({ dir: build, session: 'axf-demo', build: 'demo-build' }, env);
ok(ev.kind === 'signin' && ev.account === 'acct' && ev.build === 'demo-build' && ev.result === 'ok' && ev.sent, 'the sign-in event: account, build, verified OK, sent');
ok(alerts().length === 1 && /Claude sign-in verified: acct · demo-build/.test(alerts()[0].title), 'one phone alert for it');
ok(N.recent(5, env).at(-1)?.result === 'ok', 'and one line in login-events.jsonl (pipeline readers, CLI recent)');
const sec = readFileSync(SINK, 'utf8') + readFileSync(N.eventsFile(env), 'utf8');
ok(!sec.includes('fake-access') && !sec.includes('fake-refresh'), 'no token in any alert or log line');

console.log('a token refresh: saved, read back, on the phone');
rmSync(SINK, { force: true });
saveBack(s.dir);
ok(alerts().length === 0, 'a save-back with nothing renewed sends nothing');
writeFileSync(join(s.config, '.credentials.json'), JSON.stringify({ claudeAiOauth: { accessToken: 'fake-access-new', refreshToken: 'fake-refresh-new', expiresAt: Date.now() + 7200e3 } }));
saveBack(s.dir);
const ra = alerts();
ok(ra.length === 1 && ra[0].meta.kind === 'refresh' && ra[0].meta.result === 'ok' && ra[0].meta.account === 'acct' && ra[0].meta.build === 'axf-demo', `one refresh alert: account and the build that saw it (${ra.map((x) => x.title).join(' | ')})`);
ok(/read back OK/.test(ra[0]?.body || ''), '…saying the new token was saved and read back');
saveBack(s.dir); saveBack(s.dir);
ok(alerts().length === 1, 'the same renewal is confirmed once, however many watchers pass');
ok(JSON.parse(readFileSync(join(A, 'acct', '.credentials.json'), 'utf8')).claudeAiOauth.refreshToken === 'fake-refresh-new', 'the saved account login holds the new token');

console.log('off switch');
rmSync(SINK, { force: true });
const offEv = N.record({ kind: 'signin', account: 'acct', build: 'x', result: 'ok' }, { ...env, AXF_LOGIN_NOTIFY: 'off' });
ok(!offEv.sent && alerts().length === 0 && N.recent(1, env).at(-1)?.build === 'x', 'AXF_LOGIN_NOTIFY=off: logged, not sent');

release({ dir: build, session: 'axf-demo' });
server.close();
rmSync(tmp, { recursive: true, force: true });
console.log(failed ? `\nFAILED ${failed}/${n}` : `\nOK: ${n} checks`);
process.exit(failed ? 1 : 0);
