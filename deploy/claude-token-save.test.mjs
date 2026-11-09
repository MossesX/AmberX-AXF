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
import { accounts, release, snapshot } from './claude-login.mjs';
import { copies, freshen, saveBack, sweep, tokenHash } from './claude-token-save.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
let n = 0; let failed = 0;
const ok = (c, msg) => { n++; if (c) console.log(`  ✓ ${msg}`); else { failed++; console.log(`  ✗ FAIL ${msg}`); } };
const until = async (fn, ms = 8000) => { const t = Date.now() + ms; while (Date.now() < t) { if (fn()) return true; await new Promise((r) => setTimeout(r, 50)); } return false; };

const tmp = mkdtempSync(join(tmpdir(), 'axf-token-save-'));
const A = join(tmp, 'accounts'); const H = join(tmp, 'claude-home'); const K = join(tmp, 'ai-keys');
const LIVE = join(H, '.credentials.json');
const env = { ...process.env, HOME: tmp, AXF_CLAUDE_ACCOUNTS: A, AXF_CLAUDE_HOME: H, AXF_CLAUDE_GLOBAL: join(tmp, 'g.json'), AXF_CLAUDE_SEEN: join(tmp, 'seen.json'), AXF_AI_KEYS_HOST_DIR: K };
delete env.CLAUDE_CONFIG_DIR; delete env.AXF_CLAUDE_ACCOUNT; delete process.env.AXF_CLAUDE_ACCOUNT;
env.AXF_TOKEN_KEEP = 'off';   // these fixtures carry expired fake pairs: the keeper has its own section below
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
rotate(s.dir, 'r1', 2000);
const written = saveBack(s.dir);
ok(written.includes(LIVE) && written.includes(saved('mine')), 'the live login and the saved copy both get it at once');
ok(refresh(saved('mine')) === 'fake-refresh-r1' && get(saved('mine')).claudeAiOauth.accessToken === 'fake-access-r1', 'refresh and access token both saved');
ok(get(saved('mine')).mcpOAuth?.keep === 'me', 'the rest of the file is kept');
ok((statSync(saved('mine')).mode & 0o777) === 0o600, 'still 0600');
ok(refresh(saved('other')) === 'fake-refresh-other-r', 'another account is never touched');
ok(!readdirSync(join(A, 'mine')).some((f) => f.endsWith('.tmp')), 'no temp file left behind');
rotate(s.dir, 'r2', 3000);
rotate(s.dir, 'r3', 4000);
writeFileSync(saved('mine'), JSON.stringify({ claudeAiOauth: pair('r1'), mcpOAuth: { keep: 'me' } }));
saveBack(s.dir);
ok(refresh(saved('mine')) === 'fake-refresh-r3', 'a store left a few tokens behind still catches up');
ok(!readFileSync(join(s.dir, 'token-chain.json'), 'utf8').includes('fake-'), 'the chain file holds hashes, no token');
rotate(s.dir, 'r4', 5000);
ok(release({ dir: build, session: 's1' }).released && refresh(saved('mine')) === 'fake-refresh-r4', 'release saves the last rotation before the copy is deleted');

console.log('same refresh token, new access token');
reset();
s = snapshot({ dir: build, session: 's2', env });
writeFileSync(join(s.dir, '.credentials.json'), JSON.stringify({ claudeAiOauth: { ...pair('r0', 9000), accessToken: 'fake-access-new' } }));
saveBack(s.dir);
ok(get(saved('mine')).claudeAiOauth.accessToken === 'fake-access-new', 'the new access token is saved too');
release({ dir: build, session: 's2' });

console.log('a newer token already saved');
reset();
s = snapshot({ dir: build, session: 's3', env });
put(saved('mine'), 'somebody-newer', 8000);
rotate(s.dir, 'r1', 2000);
saveBack(s.dir);
ok(refresh(saved('mine')) === 'fake-refresh-somebody-newer', 'a token this copy never held is left alone');
release({ dir: build, session: 's3' });

console.log('a crashed run under the same name');
reset();
s = snapshot({ dir: build, session: 's4', env });
rotate(s.dir, 'r1', 2000);
s = snapshot({ dir: build, session: 's4', env });
ok(refresh(saved('mine')) === 'fake-refresh-r1' && refresh(join(s.dir, '.credentials.json')) === 'fake-refresh-r1', 'the old copy is saved back before it is replaced, and the new copy starts on it');
release({ dir: build, session: 's4' });

console.log('the watcher (a separate process, its own CLAUDE_CONFIG_DIR pointing at the copy)');
reset();
s = snapshot({ dir: build, session: 's5', env });
const run = (args) => spawn(process.execPath, [join(HERE, 'claude-token-save.mjs'), ...args], { env: { ...env, CLAUDE_CONFIG_DIR: s.dir }, stdio: 'ignore' });
let live = true;
const w = run(['watch', '--copy', s.dir, '--every', '50']); w.on('exit', () => { live = false; });
rotate(s.dir, 'r1', 2000);
ok(await until(() => refresh(saved('mine')) === 'fake-refresh-r1' && refresh(LIVE) === 'fake-refresh-r1'), 'saves a rotation while the build runs');
release({ dir: build, session: 's5' });
ok(await until(() => !live), 'ends when the copy is released');
s = snapshot({ dir: build, session: 's6', env });
const parent = spawn('sleep', ['30']);
let live2 = true;
const w2 = run(['watch', '--copy', s.dir, '--every', '50', '--parent', String(parent.pid)]); w2.on('exit', () => { live2 = false; });
await new Promise((r) => setTimeout(r, 150));
rotate(s.dir, 'r9', 7000);
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
rotate(s.dir, 'r1', 2000);
saveBack(s.dir);
ok(!existsSync(join(K, 'rotations')), 'no saved pair in AI keys: no token is left in a drop file');
writeFileSync(join(K, 'keys.json'), JSON.stringify({ keys: { a: { kind: 'claude-code', refresh: 'fake-refresh-r0' } } }));
saveBack(s.dir);
const drops = readdirSync(join(K, 'rotations'));
ok(drops.length === 1 && drops[0].startsWith('to-console-') && !drops[0].includes('fake'), 'AI keys holds the spent token: it gets a drop file');
release({ dir: build, session: 's7' });

// ── spent-refresh-token (Nov 9 2026): every path where a rotation used to be lost ─────────────────────────────────
// A fake refresh grant that behaves like Anthropic's: each refresh token works once; reusing one fails with invalid_grant.
const FAKE = join(tmp, 'fake-oauth'); mkdirSync(FAKE);
const REFRESHER = join(tmp, 'fake-refresher.mjs');
writeFileSync(REFRESHER, `import { appendFileSync, existsSync, readFileSync, renameSync } from 'node:fs';
const D = ${JSON.stringify(FAKE)};
export async function refresh(t) {
  const used = existsSync(D + '/used') ? readFileSync(D + '/used', 'utf8').split('\\n') : [];
  appendFileSync(D + '/calls', t + '\\n');
  await new Promise((r) => setTimeout(r, 150));   // a slow answer widens any race
  if (existsSync(D + '/drop')) renameSync(D + '/drop', ${JSON.stringify(join(K, 'rotations'))} + '/to-host-' + 'ab'.repeat(16) + '.json');   // AI keys renewed it meanwhile
  if (used.includes(t) || existsSync(D + '/refuse')) throw Object.assign(new Error('refresh refused (400: invalid_grant)'), { dead: true });
  appendFileSync(D + '/used', t + '\\n');
  const n = used.filter(Boolean).length + 1;
  return { accessToken: 'fake-access-k' + n, refreshToken: 'fake-refresh-k' + n, expiresAt: Date.now() + 8 * 3600e3 };
}
`);
const calls = () => { try { return readFileSync(join(FAKE, 'calls'), 'utf8').split('\n').filter(Boolean); } catch { return []; } };
const resetFake = () => { for (const f of ['calls', 'used', 'refuse', 'drop']) rmSync(join(FAKE, f), { force: true }); };
const keep = { ...env, AXF_TOKEN_KEEP: 'on', AXF_TOKEN_REFRESHER: REFRESHER };
const soon = () => Date.now() + 10 * 60e3;   // 10 min left: inside the keeper's window
const later = () => Date.now() + 6 * 3600e3;  // 6 h left: nothing to do

console.log('two builds on one login: a rotation reaches the other running copy');
reset(); put(saved('mine'), 'r0', later()); put(LIVE, 'r0', later());
mkdirSync(join(tmp, 'b2'), { recursive: true });
let a1 = snapshot({ dir: build, session: 'two-a', env });
let a2 = snapshot({ dir: join(tmp, 'b2'), session: 'two-b', env });
ok(copies({ accounts: A }).length === 2, 'both running copies are registered');
rotate(a1.dir, 'r1', later() + 1000);
const w2files = saveBack(a1.dir);
ok(w2files.includes(join(a2.dir, '.credentials.json')) && refresh(join(a2.dir, '.credentials.json')) === 'fake-refresh-r1', 'the second copy is moved onto the new token, so it can never spend the old one');
ok(refresh(saved('mine')) === 'fake-refresh-r1' && refresh(LIVE) === 'fake-refresh-r1', 'the saved login and the live login too');
release({ dir: build, session: 'two-a' }); release({ dir: join(tmp, 'b2'), session: 'two-b' });
ok(copies({ accounts: A }).length === 0, 'a released copy leaves the registry');

console.log('the keeper: one refresh per login, under the lock, for every copy');
reset(); resetFake(); put(saved('mine'), 'r0', soon()); put(LIVE, 'r0', soon());
a1 = snapshot({ dir: build, session: 'keep-a', env });
a2 = snapshot({ dir: join(tmp, 'b2'), session: 'keep-b', env });
const fr = (dir) => spawn(process.execPath, [join(HERE, 'claude-token-save.mjs'), 'freshen', '--file', join(dir, '.credentials.json'), '--min-left', String(30 * 60e3)], { env: keep, stdio: 'ignore' });
const exits = await Promise.all([fr(a1.dir), fr(a2.dir), fr(a1.dir)].map((c) => new Promise((r) => c.on('exit', r))));
ok(calls().length === 1, `three keepers at once, one refresh (Anthropic saw ${calls().length})`);
ok(exits.every((c) => c === 0), 'every keeper reports the login alive');
ok([saved('mine'), LIVE, join(a1.dir, '.credentials.json'), join(a2.dir, '.credentials.json')].every((f) => refresh(f) === 'fake-refresh-k1'), 'the new pair is in the saved login, the live login and both copies');
ok(get(saved('mine')).mcpOAuth?.keep === 'me' && get(saved('mine')).claudeAiOauth.subscriptionType === 'max', 'the rest of the file is kept');
const chainA = JSON.parse(readFileSync(join(a1.dir, 'token-chain.json'), 'utf8')).chain;
ok(chainA.includes(tokenHash('fake-refresh-k1')), "the copy's chain learns the renewed token");
ok((await freshen(join(a1.dir, '.credentials.json'), { env: keep, minLeft: 30 * 60e3 })).refreshed === false && calls().length === 1, 'a fresh pair is left alone (no refresh)');
release({ dir: build, session: 'keep-a' }); release({ dir: join(tmp, 'b2'), session: 'keep-b' });

console.log('the watcher keeps a running copy ahead of Claude Code');
reset(); resetFake(); put(saved('mine'), 'r0', soon()); put(LIVE, 'r0', soon());
s = snapshot({ dir: build, session: 'kw', env });
const kw = spawn(process.execPath, [join(HERE, 'claude-token-save.mjs'), 'watch', '--copy', s.dir, '--every', '50'], { env: keep, stdio: 'ignore' });
let kwLive = true; kw.on('exit', () => { kwLive = false; });
ok(await until(() => refresh(saved('mine')) === 'fake-refresh-k1' && refresh(join(s.dir, '.credentials.json')) === 'fake-refresh-k1'), 'renewed before it ran out, and saved everywhere');
await new Promise((r) => setTimeout(r, 300));
ok(calls().length === 1, 'and only once');
release({ dir: build, session: 'kw' });
ok(await until(() => !kwLive), 'the watcher ends with the copy');

console.log('a crash: the watcher died and nobody released the copy');
reset(); put(saved('mine'), 'r0', later()); put(LIVE, 'r0', later());
s = snapshot({ dir: build, session: 'crash', env });
rotate(s.dir, 'r1', later() + 1000);   // Claude Code refreshed, then the box went down
ok(sweep(env).fromCopies >= 1 && refresh(saved('mine')) === 'fake-refresh-r1', 'the next sweep saves the orphaned copy back');
rmSync(s.dir, { recursive: true, force: true });
sweep(env);
ok(copies({ accounts: A }).length === 0, 'a copy deleted by hand leaves the registry on the next sweep');

console.log('a store that missed several rotations catches up through the lineage');
reset(); put(saved('mine'), 'r0', later()); put(LIVE, 'r0', later());
put(join(A, 'mine-old', '.credentials.json'), 'r0', later());   // e.g. a second saved name for the same login
s = snapshot({ dir: build, session: 'lin', account: 'mine', env });
rotate(s.dir, 'r1', later() + 1); saveBack(s.dir); release({ dir: build, session: 'lin' });
put(join(A, 'mine-old', '.credentials.json'), 'r0', later());   // restored from a backup: two tokens behind
s = snapshot({ dir: build, session: 'lin2', account: 'mine', env });
rotate(s.dir, 'r2', later() + 2); saveBack(s.dir);   // this copy never held r0
ok(refresh(join(A, 'mine-old', '.credentials.json')) === 'fake-refresh-r2', 'r0 → r1 → r2: the old store is moved to r2');
ok(!readFileSync(join(A, '.lineage.json'), 'utf8').includes('fake-'), 'the lineage holds hashes, no token');
release({ dir: build, session: 'lin2' });

console.log('exit 1 / a save-back that fails: the copy is kept, never deleted with the only live token');
reset(); put(saved('mine'), 'r0', later()); put(LIVE, 'r0', later());
s = snapshot({ dir: build, session: 'stuck', env });
rotate(s.dir, 'r1', later() + 1);
const holder = spawn('sleep', ['30']);
writeFileSync(join(A, '.token-save.lock'), `${holder.pid} ${Date.now()}`);
process.env.AXF_TOKEN_LOCK_WAIT_MS = '300';
const stuck = release({ dir: build, session: 'stuck' });
delete process.env.AXF_TOKEN_LOCK_WAIT_MS;
ok(!stuck.released && existsSync(join(s.dir, '.credentials.json')), `the copy stays (${stuck.why})`);
holder.kill('SIGKILL'); await new Promise((r) => holder.on('exit', r));
ok(release({ dir: build, session: 'stuck' }).released && refresh(saved('mine')) === 'fake-refresh-r1', 'a lock left by a dead process is taken over; the token is saved, then the copy goes');

console.log('a dead login: skipped before launch, flagged until it is signed in again');
reset(); resetFake(); put(saved('mine'), 'r0', soon()); put(LIVE, 'other-r', later()); writeFileSync(join(A, '.active'), 'other\n');
writeFileSync(join(FAKE, 'refuse'), '1');
let code = 0; try { snapshot({ dir: build, session: 'dead', account: 'mine', env: keep }); } catch (e) { code = e.code; }
ok(code === 5, 'the launch is refused with exit code 5 (no run burned on it)');
ok(!existsSync(join(build, '.axf-claude', 'dead')), 'no copy was made');
ok(accounts(keep).find((a) => a.name === 'mine')?.dead === true && accounts(keep).find((a) => a.name === 'other')?.dead === false, 'accounts() says which one is dead');
const callsBefore = calls().length;
code = 0; try { snapshot({ dir: build, session: 'dead', account: 'mine', env: keep }); } catch (e) { code = e.code; }
ok(code === 5 && calls().length === callsBefore, 'the next launch is refused without asking Anthropic again');
rmSync(join(FAKE, 'refuse')); put(saved('mine'), 'fresh-login', later());   // signed in again
ok(accounts(keep).find((a) => a.name === 'mine')?.dead === false, 'signing in again clears it');
s = snapshot({ dir: build, session: 'dead', account: 'mine', env: keep });
ok(refresh(join(s.dir, '.credentials.json')) === 'fake-refresh-fresh-login', 'and launches run on it again');
release({ dir: build, session: 'dead' });

console.log('AI keys renews the same login: the host never spends what AI keys already spent');
reset(); resetFake(); put(saved('mine'), 'r0', soon()); put(LIVE, 'r0', soon());
mkdirSync(join(K, 'rotations'), { recursive: true });
writeFileSync(join(K, 'rotations', `to-host-${tokenHash('fake-refresh-r0')}.json`), JSON.stringify({ $axf: 'token-rotation@1', old: [tokenHash('fake-refresh-r0')], fresh: pair('from-keys', later()) }));
let fz = await freshen(saved('mine'), { env: keep });
ok(fz.ok && calls().length === 0 && refresh(saved('mine')) === 'fake-refresh-from-keys', 'a pending AI keys renewal is taken in first: no second refresh of a spent token');
reset(); resetFake(); put(saved('mine'), 'r0', soon()); put(LIVE, 'r0', soon());
mkdirSync(join(K, 'rotations'), { recursive: true });
writeFileSync(join(FAKE, 'refuse'), '1');
writeFileSync(join(FAKE, 'drop'), JSON.stringify({ $axf: 'token-rotation@1', old: [tokenHash('fake-refresh-r0')], fresh: pair('keys-race', later()) }));
fz = await freshen(saved('mine'), { env: keep });
ok(!fz.dead && refresh(saved('mine')) === 'fake-refresh-keys-race' && !accounts(keep).find((a) => a.name === 'mine').dead, 'refused because AI keys renewed it at the same moment: not marked dead, the new pair is taken');

console.log('a short pair is renewed before launch, so the build never refreshes on its own');
reset(); resetFake(); put(saved('mine'), 'r0', soon()); put(LIVE, 'r0', soon());
s = snapshot({ dir: build, session: 'pre', env: keep });
ok(calls().length === 1 && refresh(join(s.dir, '.credentials.json')) === 'fake-refresh-k1' && refresh(saved('mine')) === 'fake-refresh-k1' && refresh(LIVE) === 'fake-refresh-k1', 'renewed once, copy and stores on the new pair');
ok(get(join(s.dir, '.credentials.json')).claudeAiOauth.expiresAt - Date.now() > 90 * 60e3, 'the copy starts with hours left');
release({ dir: build, session: 'pre' });

rmSync(tmp, { recursive: true, force: true });
console.log(failed ? `\nFAILED ${failed}/${n}` : `\nOK: ${n} checks`);
process.exit(failed ? 1 : 0);
