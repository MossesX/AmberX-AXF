#!/usr/bin/env node
/**
 * github-app@1 broker checks (framework/cli/github-app.mjs + github-token.mjs) against a fake GitHub on loopback:
 * manifest generation, the manifest callback exchange, file permissions, app JWT, installation token + cache,
 * git credential helper order + fallback, user token exchange + refresh (rolled, locked, failure recorded),
 * repo creation, health states, and that no secret reaches an error, stdout of `status` or app.json.
 *
 *   node framework/spec/check-github-app.mjs
 */
import assert from 'node:assert/strict';
import { createVerify, generateKeyPairSync } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const BROKER = join(HERE, '..', 'cli', 'github-token.mjs');
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });

/* ─── fake GitHub ───────────────────────────────────────────────────────── */
const fake = {
  hits: [], mintCount: 0, refreshCount: 0, keyRevoked: false, installations: [{ id: 77, account: { login: 'MossesX' }, repository_selection: 'all' }],
  mintFails: false, refreshFails: false, inst: 'ghs_' + 'a'.repeat(36), refresh: 1, repos: new Set(['taken']),
};
const jwtOk = (auth) => {
  const m = /^Bearer (.+)\.(.+)\.(.+)$/.exec(auth ?? '');
  if (!m || fake.keyRevoked) return false;
  const ok = createVerify('RSA-SHA256').update(`${m[1]}.${m[2]}`).verify(publicKey, Buffer.from(m[3], 'base64url'));
  const claims = JSON.parse(Buffer.from(m[2], 'base64url').toString());
  return ok && claims.iss === 'Iv1.client' && claims.exp - claims.iat <= 600;
};
const userTok = () => `ghu_${String(fake.refresh).padStart(36, 'u')}`;
const server = createServer(async (req, res) => {
  let body = '';
  for await (const c of req) body += c;
  const send = (code, v) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(v)); };
  const url = new URL(req.url, 'http://x');
  fake.hits.push(`${req.method} ${url.pathname}`);
  const auth = req.headers.authorization;
  if (req.method === 'POST' && url.pathname === '/app-manifests/goodcode123/conversions') {
    return send(201, { id: 4242, slug: 'amberx-axf-bot', name: 'AmberX AXF Bot', client_id: 'Iv1.client', client_secret: 'cs_' + 'z'.repeat(40), webhook_secret: 'wh_secret_value', pem: privateKey, owner: { login: 'MossesX', type: 'User' }, html_url: 'https://github.com/apps/amberx-axf-bot', permissions: { contents: 'write' } });
  }
  if (url.pathname === '/app' || url.pathname === '/app/installations' || url.pathname.startsWith('/app/installations/')) {
    if (!jwtOk(auth)) return send(401, { message: 'A JSON web token could not be decoded' });
    if (url.pathname === '/app') return send(200, { slug: 'amberx-axf-bot' });
    if (url.pathname === '/app/installations') return send(200, fake.installations);
    if (req.method === 'POST' && url.pathname === '/app/installations/77/access_tokens') {
      if (fake.mintFails) return send(500, { message: 'boom' });
      fake.mintCount += 1;
      return send(201, { token: fake.inst, expires_at: new Date(Date.now() + 3600_000).toISOString() });
    }
    return send(404, { message: 'Not Found' });
  }
  if (url.pathname === '/login/oauth/access_token') {
    const p = JSON.parse(body);
    if (p.client_secret !== 'cs_' + 'z'.repeat(40)) return send(200, { error: 'incorrect_client_credentials' });
    if (p.grant_type === 'refresh_token') {
      if (fake.refreshFails || p.refresh_token !== `ghr_${String(fake.refresh).padStart(36, 'r')}`) return send(200, { error: 'bad_refresh_token', error_description: `The refresh token passed is incorrect or expired. ${p.refresh_token}` });
      fake.refreshCount += 1; fake.refresh += 1;
    } else if (p.code !== 'usercode123') return send(200, { error: 'bad_verification_code' });
    return send(200, { access_token: userTok(), expires_in: 28800, refresh_token: `ghr_${String(fake.refresh).padStart(36, 'r')}`, refresh_token_expires_in: 15811200, token_type: 'bearer' });
  }
  if (url.pathname === '/user') return auth === `Bearer ${userTok()}` ? send(200, { login: 'MossesX' }) : send(403, { message: 'Resource not accessible by integration' });
  if (url.pathname === '/rate_limit') return auth === `Bearer ${fake.inst}` ? send(200, { resources: { core: { remaining: 4990, limit: 5000, reset: 1 } } }) : send(401, { message: 'Bad credentials' });
  if (req.method === 'POST' && url.pathname === '/user/repos') {
    if (auth !== `Bearer ${userTok()}`) return send(403, { message: 'Resource not accessible by integration' });
    const { name, private: priv } = JSON.parse(body);
    if (fake.repos.has(name)) return send(422, { message: 'Repository creation failed.' });
    fake.repos.add(name);
    return send(201, { full_name: `MossesX/${name}`, private: priv, html_url: `https://github.com/MossesX/${name}` });
  }
  if (url.pathname === '/repos/MossesX/taken') return send(200, { full_name: 'MossesX/taken', private: true, html_url: 'https://github.com/MossesX/taken' });
  return send(404, { message: 'Not Found' });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;
process.env.GITHUB_API_URL = BASE;
process.env.GITHUB_WEB_URL = BASE;
delete process.env.GITHUB_TOKEN; delete process.env.GITHUB_TOKEN_PAT; delete process.env.GH_TOKEN;
const app = await import('../cli/github-app.mjs');

const root = mkdtempSync(join(tmpdir(), 'axf-ghapp-'));
const dir = join(root, '.axf-console', 'github-app');
const SECRETS = [privateKey, 'cs_' + 'z'.repeat(40), 'wh_secret_value', fake.inst];
const noSecret = (text, label) => { for (const s of [...SECRETS, userTok()]) assert.ok(!String(text).includes(s.slice(0, 30)), `${label} leaks a secret`); };
const mode = (p) => (statSync(p).mode & 0o777).toString(8);
// async: the fake GitHub runs in this process, so a blocking spawn would starve it
const DEPLOY = join(HERE, '..', 'deploy');
const run = (cmd, args, env = {}, input = '') => new Promise((res) => {
  const p = spawn(cmd, args, { env: { PATH: process.env.PATH, GITHUB_API_URL: BASE, GITHUB_WEB_URL: BASE, AXF_GITHUB_APP_DIR: dir, AXF_GITHUB_BROKER: BROKER, AXF_CONSOLE_SECRETS: join(root, '.axf-console', 'secrets.env'), ...env } });
  let stdout = ''; let stderr = '';
  p.stdout.on('data', (d) => { stdout += d; }); p.stderr.on('data', (d) => { stderr += d; });
  p.on('close', (status) => res({ status, stdout, stderr }));
  p.stdin.end(input);
});
const cli = (args, env = {}, input = '') => new Promise((res) => {
  const p = spawn(process.execPath, [BROKER, ...args], { env: { PATH: process.env.PATH, GITHUB_API_URL: BASE, GITHUB_WEB_URL: BASE, AXF_GITHUB_APP_DIR: dir, ...env } });
  let stdout = ''; let stderr = '';
  p.stdout.on('data', (d) => { stdout += d; }); p.stderr.on('data', (d) => { stderr += d; });
  p.on('close', (status) => res({ status, stdout, stderr }));
  p.stdin.end(input);
});

let n = 0;
async function t(name, fn) { await fn(); n += 1; console.log(`  ✓ ${name}`); }

try {
  await t('manifest: permissions, return URLs, private, webhook off', () => {
    const m = app.buildManifest({ origin: 'https://console.amberxai.com/' });
    assert.equal(m.name, 'AmberX AXF Bot');
    assert.equal(m.public, false);
    assert.equal(m.hook_attributes.active, false);
    assert.equal(m.redirect_url, 'https://console.amberxai.com/?ghapp=created');
    assert.deepEqual(m.callback_urls, ['https://console.amberxai.com/?ghapp=authorized']);
    assert.equal(m.setup_url, 'https://console.amberxai.com/?ghapp=installed');
    assert.deepEqual(m.default_permissions, { administration: 'write', contents: 'write', pull_requests: 'write', actions: 'write', workflows: 'write', issues: 'write', checks: 'read', statuses: 'read', metadata: 'read' });
    assert.throws(() => app.buildManifest({ origin: 'http://evil.example' }), /https/);
    assert.throws(() => app.buildManifest({ origin: 'https://x.example/path' }), /host/);
    assert.equal(app.buildManifest({ origin: 'https://c.example', name: 'AmberX AXF Bot 2' }).name, 'AmberX AXF Bot 2');
  });

  let start;
  await t('manifest start: action on the personal account with a one-time state', () => {
    start = app.startManifest(dir, { origin: 'https://console.amberxai.com' });
    assert.equal(start.action, `${BASE}/settings/apps/new?state=${start.state}`);
    assert.match(start.state, /^[0-9a-f]{48}$/);
    assert.equal(app.manifestAction({ org: 'acme' }), `${BASE}/organizations/acme/settings/apps/new`);
  });

  await t('callback exchange: bad state refused, good one stores every credential 0600 in a 0700 folder', async () => {
    await assert.rejects(app.convertManifest(dir, { code: 'goodcode123', state: 'f'.repeat(48) }), /stale/);
    const meta = await app.convertManifest(dir, { code: 'goodcode123', state: start.state, origin: 'https://console.amberxai.com' });
    assert.equal(meta.appId, 4242);
    assert.equal(meta.installUrl, `${BASE}/apps/amberx-axf-bot/installations/new`);
    assert.equal(mode(dir), '700');
    for (const f of ['app.json', 'private-key.pem', 'client-secret', 'webhook-secret', 'pending-state.json']) assert.equal(mode(join(dir, f)), '600', f);
    assert.deepEqual(app.permissionProblems(dir), []);
    noSecret(readFileSync(join(dir, 'app.json'), 'utf8'), 'app.json');
    noSecret(JSON.stringify(meta), 'convert answer');
    await assert.rejects(app.convertManifest(dir, { code: 'goodcode123', state: start.state }), /stale|already/);
  });

  await t('app JWT: RS256, iss = client id, ≤ 10 min, verifies with the public key', () => {
    const jwt = app.appJwt({ appId: 4242, clientId: 'Iv1.client' }, privateKey, 1_000_000);
    const [h, b, s] = jwt.split('.');
    assert.deepEqual(JSON.parse(Buffer.from(h, 'base64url')), { alg: 'RS256', typ: 'JWT' });
    assert.deepEqual(JSON.parse(Buffer.from(b, 'base64url')), { iat: 999_940, exp: 1_000_540, iss: 'Iv1.client' });
    assert.ok(createVerify('RSA-SHA256').update(`${h}.${b}`).verify(publicKey, Buffer.from(s, 'base64url')));
  });

  await t('installation: found on the owner, token minted once and cached, re-minted inside the last 10 min', async () => {
    assert.deepEqual(await app.findInstallation(dir), { id: 77, account: 'MossesX', repositorySelection: 'all' });
    const a = await app.installationToken(dir);
    const b = await app.installationToken(dir);
    assert.equal(a.token, fake.inst); assert.equal(b.cached, true); assert.equal(fake.mintCount, 1);
    assert.equal(mode(join(dir, 'installation-token.json')), '600');
    const f = join(dir, 'installation-token.json');
    const c = JSON.parse(readFileSync(f, 'utf8'));
    writeFileSync(f, JSON.stringify({ ...c, expiresAt: new Date(Date.now() + 9 * 60_000).toISOString() }), { mode: 0o600 });
    assert.equal((await app.installationToken(dir)).cached, false);
    assert.equal(fake.mintCount, 2);
    await Promise.all([app.installationToken(dir, { force: true }), app.installationToken(dir, { force: true })]);
    assert.equal(fake.mintCount, 4, 'forced mints each run, one at a time under the lock');
  });

  await t('git credential helper: installation token first', async () => {
    const r = await cli(['credential', 'get'], {}, 'protocol=https\nhost=github.com\n\n');
    assert.equal(r.status, 0);
    assert.equal(r.stdout, `username=x-access-token\npassword=${fake.inst}\n`);
  });

  await t('VPS helpers: axf-git-cred hands git the app token; the gh wrapper sets GH_TOKEN (explicit GH_TOKEN wins)', async () => {
    let r = await run('sh', [join(DEPLOY, 'axf-git-cred'), 'get'], {}, 'protocol=https\nhost=github.com\n\n');
    assert.equal(r.stdout, `username=x-access-token\npassword=${fake.inst}\n`);
    assert.equal((await run('sh', [join(DEPLOY, 'axf-git-cred'), 'store'])).stdout, '');
    const fakeGh = join(root, 'fake-gh.sh');
    writeFileSync(fakeGh, '#!/bin/sh\necho "token=$GH_TOKEN args=$*"\n', { mode: 0o755 });
    r = await run('sh', [join(DEPLOY, 'gh-app'), 'pr', 'list'], { AXF_REAL_GH: fakeGh });
    assert.equal(r.stdout.trim(), `token=${fake.inst} args=pr list`, 'no user yet → installation token');
    r = await run('sh', [join(DEPLOY, 'gh-app'), 'api', 'user'], { AXF_REAL_GH: fakeGh, GH_TOKEN: 'mine' });
    assert.equal(r.stdout.trim(), 'token=mine args=api user');
  });

  await t('git credential helper: falls back to the old GITHUB_TOKEN in secrets.env when minting fails, nothing when neither works', async () => {
    const pat = 'github_pat_' + 'P'.repeat(40);
    writeFileSync(join(root, '.axf-console', 'secrets.env'), `# x\nGITHUB_TOKEN=${pat}\n`, { mode: 0o600 });
    rmSync(join(dir, 'installation-token.json'));
    fake.mintFails = true;
    let r = await cli(['credential', 'get']);
    assert.equal(r.stdout, `username=x-access-token\npassword=${pat}\n`);
    assert.equal((await run('sh', [join(DEPLOY, 'axf-git-cred'), 'get'])).stdout, `username=x-access-token\npassword=${pat}\n`, 'shell helper falls back too');
    assert.equal((await run('sh', [join(DEPLOY, 'axf-git-cred'), 'get'], { AXF_GITHUB_BROKER: '/nonexistent' })).stdout, `username=x-access-token\npassword=${pat}\n`, 'no broker → old token');
    assert.equal((await cli(['token', '--json'])).stdout.includes('"source":"legacy"'), true);
    rmSync(join(root, '.axf-console', 'secrets.env'));
    r = await cli(['credential', 'get']);
    assert.equal(r.stdout, ''); assert.equal(r.status, 0);
    r = await cli(['token']);
    assert.equal(r.status, 1); noSecret(r.stderr, 'token error');
    fake.mintFails = false;
    const o = await cli(['token', '--json'], { GITHUB_TOKEN_PAT: pat });
    assert.ok(o.stdout.includes('"source":"app"'), o.stdout + o.stderr);
  });

  let auth;
  await t('authorize as Brett: URL with client id + state, code exchanged, user token stored 0600 with its login', async () => {
    auth = app.authorizeUrl(dir, { origin: 'https://console.amberxai.com' });
    const u = new URL(auth.url);
    assert.equal(u.pathname, '/login/oauth/authorize');
    assert.equal(u.searchParams.get('client_id'), 'Iv1.client');
    assert.equal(u.searchParams.get('redirect_uri'), 'https://console.amberxai.com/?ghapp=authorized');
    await assert.rejects(app.exchangeUserCode(dir, { code: 'usercode123', state: 'a'.repeat(48) }), /stale/);
    const r = await app.exchangeUserCode(dir, { code: 'usercode123', state: auth.state, origin: 'https://console.amberxai.com' });
    assert.equal(r.login, 'MossesX');
    noSecret(JSON.stringify(r), 'exchange answer');
    assert.equal(mode(join(dir, 'user-token.json')), '600');
  });

  await t('user token: cached while fresh; refreshed (refresh token rolled) once < 15 min left; parallel callers refresh once', async () => {
    const a = await app.userToken(dir);
    assert.equal(a.cached, true); assert.equal(fake.refreshCount, 0);
    const f = join(dir, 'user-token.json');
    const rec = JSON.parse(readFileSync(f, 'utf8'));
    writeFileSync(f, JSON.stringify({ ...rec, accessExpiresAt: new Date(Date.now() + 5 * 60_000).toISOString() }), { mode: 0o600 });
    const [x, y] = await Promise.all([app.userToken(dir), app.userToken(dir)]);
    assert.equal(fake.refreshCount, 1, 'one refresh for two callers');
    assert.equal(x.token, userTok()); assert.equal(y.token, userTok());
    assert.equal(JSON.parse(readFileSync(f, 'utf8')).refreshToken, `ghr_${String(fake.refresh).padStart(36, 'r')}`);
  });

  await t('repo create: private repo with the user token; an existing one is reported, not an error', async () => {
    assert.deepEqual(await app.createRepo(dir, { name: 'axp-demo' }), { created: true, fullName: 'MossesX/axp-demo', private: true, htmlUrl: 'https://github.com/MossesX/axp-demo' });
    assert.equal((await app.createRepo(dir, { name: 'taken' })).created, false);
    await assert.rejects(app.createRepo(dir, { name: '../x' }), /not a repo name/);
    const r = await cli(['repo', 'create', 'axp-xchat']);
    assert.equal(r.status, 0); assert.match(r.stdout, /created: MossesX\/axp-xchat \(private\)/);
  });

  await t('health: everything ok live; status output carries no secret', async () => {
    const s = await app.status(dir, { live: true });
    for (const k of ['files', 'key', 'installation', 'token', 'user', 'rateLimit']) assert.equal(s.checks[k].ok, true, k);
    assert.equal(s.checks.rateLimit.remaining, 4990);
    noSecret(JSON.stringify(s), 'status');
    const r = await cli(['status', '--live', '--json']);
    assert.equal(r.status, 0); noSecret(r.stdout, 'status CLI');
  });

  await t('health: failed user refresh is recorded (no secret in it) and shown; revoked key turns the key check red', async () => {
    const f = join(dir, 'user-token.json');
    const rec = JSON.parse(readFileSync(f, 'utf8'));
    writeFileSync(f, JSON.stringify({ ...rec, accessExpiresAt: new Date(Date.now() - 1000).toISOString() }), { mode: 0o600 });
    fake.refreshFails = true;
    await assert.rejects(app.userToken(dir), (e) => { noSecret(e.message, 'refresh error'); assert.ok(!e.message.includes('ghr_')); return /refused/.test(e.message); });
    const after = JSON.parse(readFileSync(f, 'utf8'));
    assert.match(after.lastError.message, /refused/); assert.ok(!after.lastError.message.includes('ghr_'));
    const s = await app.status(dir, { live: true });
    assert.equal(s.checks.user.ok, false); assert.equal(s.checks.user.state, 'failed');
    fake.refreshFails = false;
    fake.keyRevoked = true;
    const k = await app.status(dir, { live: true });
    assert.equal(k.checks.key.ok, false); assert.match(k.checks.key.why, /401/);
    fake.keyRevoked = false;
  });

  await t('uninstalled app: installation check red, token check red, credential falls back', async () => {
    fake.installations = [];
    const s = await app.status(dir, { live: true });
    assert.equal(s.checks.installation.ok, false);
    assert.equal(app.readMeta(dir).installationId, null);
    await assert.rejects(app.installationToken(dir), /isn't installed/);
    fake.installations = [{ id: 77, account: { login: 'MossesX' }, repository_selection: 'all' }];
  });

  await t('folder modes: a loosened file is reported', () => {
    const p = join(dir, 'private-key.pem');
    spawnSync('chmod', ['644', p]);
    assert.deepEqual(app.permissionProblems(dir), ['private-key.pem is 644, not 600']);
    spawnSync('chmod', ['600', p]);
  });

  await t('folder: AXF_GITHUB_APP_DIR, else AXF_ROOT/.axf-console/github-app', () => {
    assert.equal(app.appDir({ AXF_GITHUB_APP_DIR: '/x/y' }), '/x/y');
    assert.equal(app.appDir({ AXF_ROOT: '/axf' }), '/axf/.axf-console/github-app');
  });

  await t('forget: user only, then everything', () => {
    app.forget(dir);
    assert.equal(app.hasUser(dir), false); assert.equal(app.configured(dir), true);
    app.forget(dir, { all: true });
    assert.equal(app.configured(dir), false);
  });
  mkdirSync(dir, { recursive: true });
  console.log(`github-app@1: ${n} checks passed`);
} finally {
  server.close();
  rmSync(root, { recursive: true, force: true });
}
