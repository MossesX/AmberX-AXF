#!/usr/bin/env node
/**
 * refresh-token-save: a rotated Claude token reaches every store of that login at once. Fake tokens and temp folders only.
 *
 *   node deploy/claude-token-save.test.mjs
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { release, snapshot } from './claude-login.mjs';
import { saveBack, sweep, tokenHash } from './claude-token-save.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
let n = 0; let failed = 0;
const ok = (c, msg) => { n++; if (c) console.log(`  ✓ ${msg}`); else { failed++; console.log(`  ✗ FAIL ${msg}`); } };
const until = async (fn, ms = 8000) => { const t = Date.now() + ms; while (Date.now() < t) { if (fn()) return true; await new Promise((r) => setTimeout(r, 50)); } return false; };

const tmp = mkdtempSync(join(tmpdir(), 'axf-token-save-'));
const A = join(tmp, 'accounts'); const H = join(tmp, 'claude-home'); const K = join(tmp, 'ai-keys');
const LIVE = join(H, '.credentials.json');
const env = { ...process.env, HOME: tmp, AXF_CLAUDE_ACCOUNTS: A, AXF_CLAUDE_HOME: H, AXF_CLAUDE_GLOBAL: join(tmp, 'g.json'), AXF_CLAUDE_SEEN: join(tmp, 'seen.json'), AXF_AI_KEYS_HOST_DIR: K };
delete env.CLAUDE_CONFIG_DIR; delete env.AXF_CLAUDE_ACCOUNT;
mkdirSync(H, { recursive: true }); mkdirSync(K, { recursive: true });
const pair = (r, exp = 1000, extra = {}) => ({ accessToken: `fake-access-${r}`, refreshToken: `fake-refresh-${r}`, expiresAt: exp, ...extra });
const put = (f, r, exp) => { mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, JSON.stringify({ claudeAiOauth: pair(r, exp, { subscriptionType: 'max' }), mcpOAuth: { keep: 'me' } }), { mode: 0o600 }); };
const saved = (name) => join(A, name, '.credentials.json');
const get = (f) => JSON.parse(readFileSync(f, 'utf8'));
const refresh = (f) => get(f).claudeAiOauth.refreshToken;
const rotate = (dir, r, exp) => put(join(dir, '.credentials.json'), r, exp);
const reset = () => {
  rmSync(A, { recursive: true, force: true }); rmSync(join(K, 'rotations'), { recursive: true, force: true }); rmSync(join(K, 'keys.json'), { force: true });
  put(saved('mine'), 'r0'); put(saved('other'), 'other-r'); put(LIVE, 'r0'); writeFileSync(join(A, '.active'), 'mine\n');
};

ok(tokenHash('abc') === 'ba7816bf8f01cfea414140de5dae2223', 'token hash: the value AI keys computes too');
console.log('a build rotates its token');
reset();
const build = join(tmp, 'b1');
mkdirSync(build);
let s = snapshot({ dir: build, session: 's1', env });
rotate(s.config, 'r1', 2000);
const written = saveBack(s.dir);
ok(written.includes(LIVE) && written.includes(saved('mine')), 'the live login and the saved copy both get it at once');
ok(refresh(saved('mine')) === 'fake-refresh-r1' && get(saved('mine')).claudeAiOauth.accessToken === 'fake-access-r1', 'refresh and access token both saved');
ok(get(saved('mine')).mcpOAuth?.keep === 'me', 'the rest of the file is kept');
ok((statSync(saved('mine')).mode & 0o777) === 0o600, 'still 0600');
ok(refresh(saved('other')) === 'fake-refresh-other-r', 'another account is never touched');
ok(!readdirSync(join(A, 'mine')).some((f) => f.endsWith('.tmp')), 'no temp file left behind');
rotate(s.config, 'r2', 3000);
rotate(s.config, 'r3', 4000);
writeFileSync(saved('mine'), JSON.stringify({ claudeAiOauth: pair('r1'), mcpOAuth: { keep: 'me' } }));
saveBack(s.dir);
ok(refresh(saved('mine')) === 'fake-refresh-r3', 'a store left a few tokens behind still catches up');
ok(!readFileSync(join(s.config, 'token-chain.json'), 'utf8').includes('fake-'), 'the chain file holds hashes, no token');
rotate(s.config, 'r4', 5000);
ok(release({ dir: build, session: 's1' }).released && refresh(saved('mine')) === 'fake-refresh-r4', 'release saves the last rotation before the copy is deleted');

console.log('same refresh token, new access token');
reset();
s = snapshot({ dir: build, session: 's2', env });
writeFileSync(join(s.config, '.credentials.json'), JSON.stringify({ claudeAiOauth: { ...pair('r0', 9000), accessToken: 'fake-access-new' } }));
saveBack(s.dir);
ok(get(saved('mine')).claudeAiOauth.accessToken === 'fake-access-new', 'the new access token is saved too');
release({ dir: build, session: 's2' });

console.log('a newer token already saved');
reset();
s = snapshot({ dir: build, session: 's3', env });
put(saved('mine'), 'somebody-newer', 8000);
rotate(s.config, 'r1', 2000);
saveBack(s.dir);
ok(refresh(saved('mine')) === 'fake-refresh-somebody-newer', 'a token this copy never held is left alone');
release({ dir: build, session: 's3' });

console.log('a crashed run under the same name');
reset();
s = snapshot({ dir: build, session: 's4', env });
rotate(s.config, 'r1', 2000);
s = snapshot({ dir: build, session: 's4', env });
ok(refresh(saved('mine')) === 'fake-refresh-r1' && refresh(join(s.config, '.credentials.json')) === 'fake-refresh-r1', 'the old copy is saved back before it is replaced, and the new copy starts on it');
release({ dir: build, session: 's4' });

console.log('the watcher (a separate process, its own CLAUDE_CONFIG_DIR pointing at the copy)');
reset();
s = snapshot({ dir: build, session: 's5', env });
const run = (args) => spawn(process.execPath, [join(HERE, 'claude-token-save.mjs'), ...args], { env: { ...env, CLAUDE_CONFIG_DIR: s.config }, stdio: 'ignore' });
let live = true;
const w = run(['watch', '--copy', s.dir, '--every', '50']); w.on('exit', () => { live = false; });
rotate(s.config, 'r1', 2000);
ok(await until(() => refresh(saved('mine')) === 'fake-refresh-r1' && refresh(LIVE) === 'fake-refresh-r1'), 'saves a rotation while the build runs');
release({ dir: build, session: 's5' });
ok(await until(() => !live), 'ends when the copy is released');
s = snapshot({ dir: build, session: 's6', env });
const parent = spawn('sleep', ['30']);
let live2 = true;
const w2 = run(['watch', '--copy', s.dir, '--every', '50', '--parent', String(parent.pid)]); w2.on('exit', () => { live2 = false; });
await new Promise((r) => setTimeout(r, 150));
rotate(s.config, 'r9', 7000);
parent.kill('SIGKILL');
ok(await until(() => !live2) && refresh(saved('mine')) === 'fake-refresh-r9', 'a killed build: one last pass, then it ends');
release({ dir: build, session: 's6' });

console.log('the sweep: the live login and AI keys');
reset();
sweep(env);
ok(refresh(saved('mine')) === 'fake-refresh-r0', 'first pass only learns the live token');
put(LIVE, 'r1', 2000);
ok(sweep(env).fromLive === 1 && refresh(saved('mine')) === 'fake-refresh-r1', 'the live login renewed itself: its saved copy follows');
ok(refresh(saved('other')) === 'fake-refresh-other-r', 'another account is never touched');
rmSync(LIVE);
sweep(env);
ok(refresh(saved('mine')) === 'fake-refresh-r1', 'logged out: the saved copy keeps the last login');
put(LIVE, 'r1', 2000);
mkdirSync(join(K, 'rotations'), { recursive: true });
const drop = join(K, 'rotations', `to-host-${tokenHash('fake-refresh-r1')}.json`);
writeFileSync(drop, JSON.stringify({ $axf: 'token-rotation@1', old: [tokenHash('fake-refresh-r1')], fresh: pair('from-keys', 6000) }));
ok(sweep(env).fromAiKeys === 2 && refresh(saved('mine')) === 'fake-refresh-from-keys' && refresh(LIVE) === 'fake-refresh-from-keys', 'a pair AI keys renewed reaches the login holding its old token');
ok(!existsSync(drop), 'the drop file is deleted');

reset();
s = snapshot({ dir: build, session: 's7', env });
rotate(s.config, 'r1', 2000);
saveBack(s.dir);
ok(!existsSync(join(K, 'rotations')), 'no saved pair in AI keys: no token is left in a drop file');
writeFileSync(join(K, 'keys.json'), JSON.stringify({ keys: { a: { kind: 'claude-code', refresh: 'fake-refresh-r0' } } }));
saveBack(s.dir);
const drops = readdirSync(join(K, 'rotations'));
ok(drops.length === 1 && drops[0].startsWith('to-console-') && !drops[0].includes('fake'), 'AI keys holds the spent token: it gets a drop file');
release({ dir: build, session: 's7' });

console.log('the token lock: parallel builds never clobber each other');
reset();
const { LOCK, withTokenLock } = await import('./claude-token-save.mjs');
s = snapshot({ dir: build, session: 's8', env });
const s9 = snapshot({ dir: join(tmp, 'b2'), session: 's9', env });
ok(s9.config === s.config, 'two builds on one account: one shared config dir');
ok(withTokenLock(A, () => existsSync(join(A, LOCK))) === true && !existsSync(join(A, LOCK)), 'held while the write runs, gone after');
ok(withTokenLock(A, () => withTokenLock(A, () => 7)) === 7, 're-entrant within one process');
// another process holds the lock: a save-back waits for it instead of writing in between
const holder = spawn(process.execPath, [join(HERE, 'claude-token-save.mjs'), 'hold-lock', '--accounts', A, '--ms', '600'], { env, stdio: ['ignore', 'pipe', 'ignore'] });
await new Promise((r) => holder.stdout.once('data', r));
rotate(s.config, 'r1', 2000);
const t0 = Date.now(); saveBack(s.dir); const waited = Date.now() - t0;
ok(waited >= 300 && refresh(saved('mine')) === 'fake-refresh-r1', `a save-back waits for the lock another process holds (${waited} ms), then writes`);
await new Promise((r) => (holder.exitCode !== null ? r() : holder.once('exit', r)));
// a holder that died leaves its lock behind: taken over at once
mkdirSync(join(A, LOCK)); writeFileSync(join(A, LOCK, 'pid'), '999999');
const t1 = Date.now(); withTokenLock(A, () => 0);
ok(Date.now() - t1 < 2000 && !existsSync(join(A, LOCK)), 'a dead holder\'s lock is taken over at once');
// eight save-backs at once from separate processes (two builds' watchers + the sweep), while the token rotates
const many = async (k) => Promise.all(Array.from({ length: k }, (_, i) => new Promise((r) => spawn(process.execPath, [join(HERE, 'claude-token-save.mjs'), i % 4 === 3 ? 'sweep' : 'save-back', '--copy', i % 2 ? s9.dir : s.dir], { env, stdio: 'ignore' }).on('exit', r))));
rotate(s.config, 'r2', 3000);
const burst = many(8);
rotate(s.config, 'r3', 4000);
await burst; saveBack(s.dir);
const chainNow = get(join(s.config, 'token-chain.json')).chain;
ok(refresh(saved('mine')) === 'fake-refresh-r3' && refresh(LIVE) === 'fake-refresh-r3', 'parallel save-backs end on the newest token everywhere');
ok(['r0', 'r1', 'r3'].every((r) => chainNow.includes(tokenHash(`fake-refresh-${r}`))), 'the chain lost no token it held');
ok(!readdirSync(join(A, 'mine')).some((f) => f.endsWith('.tmp')) && !existsSync(join(A, LOCK)), 'no temp file or lock left behind');
// a saved login older than the shared one is never copied back over it
put(saved('mine'), 'r1', 2000);
snapshot({ dir: join(tmp, 'b3'), session: 's10', env });
ok(refresh(join(s.config, '.credentials.json')) === 'fake-refresh-r3', 'a spent saved token never replaces the shared one');
rmSync(LIVE); put(saved('mine'), 'relogin', 9000);   // signed in again on the account's own folder (the live login moved on)
snapshot({ dir: join(tmp, 'b3'), session: 's10', env });
ok(refresh(join(s.config, '.credentials.json')) === 'fake-refresh-relogin', 'a fresh sign-in on the account is taken up by the shared login');
for (const [d, n2] of [[build, 's8'], [join(tmp, 'b2'), 's9'], [join(tmp, 'b3'), 's10']]) release({ dir: d, session: n2 });

rmSync(tmp, { recursive: true, force: true });
console.log(failed ? `\nFAILED ${failed}/${n}` : `\nOK: ${n} checks`);
process.exit(failed ? 1 : 0);
