#!/usr/bin/env node
/**
 * builds-share-one-claude-login-write: two builds on one Claude account, a forced token refresh in one, and the other
 * keeps working. Fake tokens, a fake OAuth server (a JSON file) and a fake `claude` only; nothing real is read or touched.
 *
 *   node deploy/claude-shared-login.test.mjs
 *
 * The fake claude behaves like Claude Code 2.1.322 does with a file login: it keeps its tokens in memory, re-reads
 * $CLAUDE_CONFIG_DIR/.credentials.json when its mtime changes, and renews under a lock in the config dir, re-reading the
 * file after taking it (a renewal another process already made is used, not repeated). The server rotates refresh
 * tokens: renewing spends the old one, and a spent refresh token is refused (what stranded builds before).
 *
 * The control run with private copies (AXF_SHARED_LOGIN=off, the old behaviour) must fail the same scenario, so the
 * test is known to catch the bug it guards.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { childEnv, release, snapshot } from './claude-login.mjs';
import { watchCopy } from './claude-token-save.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
let n = 0; let failed = 0;
const ok = (c, msg) => { n++; if (c) console.log(`  ✓ ${msg}`); else { failed++; console.log(`  ✗ FAIL ${msg}`); } };
const until = async (fn, ms = 10_000) => { const t = Date.now() + ms; while (Date.now() < t) { if (fn()) return true; await new Promise((r) => setTimeout(r, 40)); } return false; };
const readJ = (f) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; } };

const tmp = mkdtempSync(join(tmpdir(), 'axf-shared-login-'));
const SERVER = join(tmp, 'server.json');

// ── the fake claude: one long-lived process per build, driven by command files in its build folder ───────────────────
const FAKE = join(tmp, 'fake-claude.mjs');
writeFileSync(FAKE, String.raw`
import { mkdirSync, readFileSync, renameSync, rmdirSync, statSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const cfg = process.env.CLAUDE_CONFIG_DIR, file = join(cfg, '.credentials.json'), server = process.env.FAKE_SERVER, out = join(process.cwd(), 'out.jsonl');
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const lock = (d) => { for (let i = 0; i < 400; i++) { try { mkdirSync(d); return; } catch { sleep(10); } } throw new Error('lock timeout'); };
const unlock = (d) => { try { rmdirSync(d); } catch {} };
const srv = (fn) => { lock(server + '.lock'); try { const s = JSON.parse(readFileSync(server, 'utf8')); const r = fn(s); writeFileSync(server, JSON.stringify(s)); return r; } finally { unlock(server + '.lock'); } };
const disk = () => JSON.parse(readFileSync(file, 'utf8')).claudeAiOauth;
let mem = disk(), mtime = statSync(file).mtimeMs;
const reloadIfChanged = () => { const m = statSync(file).mtimeMs; if (m !== mtime) { mtime = m; mem = disk(); return true; } return false; };
const refresh = () => {
  lock(join(cfg, '.refresh.lock'));            // Claude Code's refresh lock lives in the config dir
  try {
    const now = disk();
    if (now.accessToken !== mem.accessToken) { mem = now; mtime = statSync(file).mtimeMs; return 'race-resolved'; }
    const fresh = srv((s) => {
      if (!s.refresh.includes(mem.refreshToken)) return null;
      s.n += 1; s.refresh = s.refresh.filter((t) => t !== mem.refreshToken); s.access = [];
      const p = { accessToken: 'fake-access-' + s.n, refreshToken: 'fake-refresh-' + s.n, expiresAt: Date.now() + 3600e3 };
      s.refresh.push(p.refreshToken); s.access.push(p.accessToken); return p;
    });
    if (!fresh) return 'dead-refresh-token';
    const doc = JSON.parse(readFileSync(file, 'utf8')); doc.claudeAiOauth = { ...doc.claudeAiOauth, ...fresh };
    writeFileSync(file + '.tmp', JSON.stringify(doc), { mode: 0o600 }); renameSync(file + '.tmp', file);
    mem = fresh; mtime = statSync(file).mtimeMs; return 'refreshed';
  } finally { unlock(join(cfg, '.refresh.lock')); }
};
const call = () => {
  const valid = () => srv((s) => s.access.includes(mem.accessToken));
  if (valid()) return 'ok';
  if (reloadIfChanged() && valid()) return 'ok-reloaded';
  const r = refresh();
  return r === 'dead-refresh-token' ? 'auth-failed' : valid() ? 'ok-' + r : 'auth-failed';
};
let i = 0;
for (;;) {
  const c = join(process.cwd(), 'cmd-' + i);
  if (!existsSync(c)) { sleep(20); continue; }
  const what = readFileSync(c, 'utf8').trim(); i++;
  if (what === 'exit') process.exit(0);
  const res = what === 'refresh' ? refresh() : call();
  appendFileSync(out, JSON.stringify({ i: i - 1, what, res, access: mem.accessToken.replace(/^fake-access-/, '') }) + '\n');
}
`);

const setup = (tag) => {
  const root = join(tmp, tag);
  const A = join(root, 'accounts'); const SH = join(root, 'claude-home');
  mkdirSync(join(A, 'acct'), { recursive: true }); mkdirSync(SH, { recursive: true });
  const login = { claudeAiOauth: { accessToken: 'fake-access-0', refreshToken: 'fake-refresh-0', expiresAt: Date.now() + 3600e3, subscriptionType: 'max' } };
  writeFileSync(join(A, 'acct', '.credentials.json'), JSON.stringify(login), { mode: 0o600 });
  writeFileSync(join(A, '.active'), 'acct\n');
  writeFileSync(SERVER, JSON.stringify({ n: 0, refresh: ['fake-refresh-0'], access: ['fake-access-0'] }));
  const env = { PATH: process.env.PATH, HOME: root, AXF_CLAUDE_ACCOUNTS: A, AXF_CLAUDE_HOME: SH, AXF_CLAUDE_GLOBAL: join(root, 'g.json'),
    AXF_CLAUDE_SEEN: join(root, 'seen.json'), AXF_AI_KEYS_HOST_DIR: join(root, 'ai-keys'), ...(tag === 'private' ? { AXF_SHARED_LOGIN: 'off' } : {}) };
  return { root, A, env };
};

/** Start one fake build: its login (the same call every launcher makes), the save-back watcher, the fake claude. */
function startBuild(t, name) {
  const dir = join(t.root, name); mkdirSync(dir, { recursive: true });
  const snap = snapshot({ dir, session: name, account: 'acct', env: t.env });
  const child = spawn(process.execPath, [FAKE], { cwd: dir, env: { ...childEnv(snap, t.env), FAKE_SERVER: SERVER }, stdio: 'ignore' });
  watchCopy(snap.dir, child.pid);
  let k = 0;
  const lines = () => (existsSync(join(dir, 'out.jsonl')) ? readFileSync(join(dir, 'out.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
  const send = async (what) => { const want = k + 1; writeFileSync(join(dir, `cmd-${k++}`), what); if (what === 'exit') return null; await until(() => lines().length >= want); return lines()[want - 1]; };
  const done = new Promise((r) => child.on('exit', r));
  return { dir, snap, send, stop: async () => { await send('exit'); await done; release({ dir, session: name }); } };
}

console.log('two builds, one account, one shared login');
{
  const t = setup('shared');
  const a = startBuild(t, 'build-a'); const b = startBuild(t, 'build-b');
  ok(a.snap.config === b.snap.config && a.snap.shared, 'both builds run on the account\'s one shared config dir');
  ok((await a.send('call'))?.res === 'ok' && (await b.send('call'))?.res === 'ok', 'both sign in on the saved login');
  const ra = await a.send('refresh');
  ok(ra?.res === 'refreshed' && ra.access === '1', 'build A is forced to renew: the refresh token rotates (0 → 1)');
  const rb = await b.send('call');
  ok(rb?.res === 'ok-reloaded' && rb.access === '1', `build B keeps working: it picks up A's renewal from the shared file (${rb?.res})`);
  const rb2 = await b.send('refresh');
  ok(rb2?.res === 'refreshed' && rb2.access === '2', 'build B renews next: it spends the token A saved, not a dead one');
  const ra2 = await a.send('call');
  ok(ra2?.res === 'ok-reloaded' && ra2.access === '2', 'build A keeps working on B\'s renewal');
  // both renew at the same moment: one renews, the other sees the result under the lock
  const [x, y] = await Promise.all([a.send('refresh'), b.send('refresh')]);
  const results = [x?.res, y?.res].sort().join(' ');
  ok(/refreshed/.test(results) && !/dead/.test(results) && x?.access === y?.access, `simultaneous renewals never spend a dead token (${results})`);
  ok((await a.send('call'))?.res.startsWith('ok') && (await b.send('call'))?.res.startsWith('ok'), 'both still working afterwards');
  const latest = readJ(join(a.snap.config, '.credentials.json'))?.claudeAiOauth?.refreshToken;
  ok(await until(() => readJ(join(t.A, 'acct', '.credentials.json'))?.claudeAiOauth?.refreshToken === latest), 'the newest token is written back to the saved account login');
  await a.stop();
  ok((await b.send('call'))?.res === 'ok', 'build A ending leaves build B signed in');
  await b.stop();
  ok(existsSync(join(a.snap.config, '.credentials.json')) && !existsSync(join(t.root, 'build-a', '.axf-claude')), 'the shared login stays for the next build; the builds\' folders are gone');
  const c = startBuild(t, 'build-c');
  ok((await c.send('call'))?.res === 'ok', 'the next build on the account starts on the live token');
  await c.stop();
}

console.log('control: private copies (the old behaviour) strand the second build');
{
  const t = setup('private');
  const a = startBuild(t, 'build-a'); const b = startBuild(t, 'build-b');
  ok(a.snap.config !== b.snap.config, 'each build has its own copy');
  await a.send('call'); await b.send('call');
  await a.send('refresh');
  const rb = await b.send('call');
  ok(rb?.res === 'auth-failed', `build B fails on the spent refresh token (${rb?.res}): the scenario reproduces the bug`);
  await a.stop(); await b.stop();
}

rmSync(tmp, { recursive: true, force: true });
console.log(failed ? `\nFAILED ${failed}/${n}` : `\nOK: ${n} checks`);
process.exit(failed ? 1 : 0);
