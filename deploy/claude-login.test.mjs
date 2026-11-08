#!/usr/bin/env node
/**
 * build-own-login: every headless build keeps its own Claude login. Scripted test with fake accounts and a fake
 * `claude` binary; nothing real is read or touched (every path is a temp folder, tmux runs on its own socket).
 *
 *   node deploy/claude-login.test.mjs
 *
 * Covers deploy/claude-login.mjs (which account, the copy, its permissions, release) and, end to end through
 * deploy/claude-headless.sh in tmux: the shared login is logged out and switched to another account while the build
 * runs, and the build keeps its own login; a token refresh is saved back to that login's saved copy and to no other account; an inherited
 * CLAUDE_CODE_OAUTH_TOKEN never reaches the build; a saved token is used when the account has one; the account is in the
 * log; the copy is gone when the session ends; no credential is ever printed. Plus the agent swarm runner's copy.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
let n = 0; let failed = 0;
const ok = (c, msg) => { n++; if (c) console.log(`  ✓ ${msg}`); else { failed++; console.log(`  ✗ FAIL ${msg}`); } };
const sha = (s) => createHash('sha256').update(s).digest('hex');
const mode = (f) => statSync(f).mode & 0o777;
const read = (f) => { try { return readFileSync(f, 'utf8'); } catch { return ''; } };
const until = async (fn, ms = 20_000) => { const t = Date.now() + ms; while (Date.now() < t) { if (fn()) return true; await new Promise((r) => setTimeout(r, 150)); } return false; };

// ── fixture: two saved accounts, a live login, a global config ─────────────────────────────────────────────────────
const tmp = mkdtempSync(join(tmpdir(), 'axf-login-test-'));
const A = join(tmp, 'accounts'); const SH = join(tmp, 'claude-home'); const G = join(tmp, 'claude.json'); const SEEN = join(tmp, 'seen.json');
const SECRET_A = 'fake-secret-A-1111'; const SECRET_B = 'fake-secret-B-2222'; const TOKEN_B = 'fake-token-B-3333'; const INHERITED = 'fake-inherited-4444';
const credsOf = (s) => JSON.stringify({ claudeAiOauth: { accessToken: s, refreshToken: `${s}-r` } });
mkdirSync(join(A, 'account-a'), { recursive: true }); mkdirSync(join(A, 'account-b'), { recursive: true });
writeFileSync(join(A, 'account-a', '.credentials.json'), credsOf(SECRET_A));
writeFileSync(join(A, 'account-b', '.credentials.json'), credsOf(SECRET_B));
writeFileSync(join(A, 'account-b', 'token'), TOKEN_B);
writeFileSync(join(A, '.active'), 'account-a\n');
mkdirSync(join(SH, 'projects'), { recursive: true });
writeFileSync(join(SH, '.credentials.json'), credsOf(SECRET_A));
writeFileSync(join(SH, 'settings.json'), '{"hooks":{}}');
writeFileSync(G, JSON.stringify({ oauthAccount: { emailAddress: 'stale@x' }, mcpServers: { x: { type: 'http', url: 'https://x' } } }));
writeFileSync(SEEN, JSON.stringify({ 'account-a': { email: 'a@example.com' }, 'account-b': { email: 'b@example.com' } }));
const ENV = { AXF_CLAUDE_ACCOUNTS: A, AXF_CLAUDE_HOME: SH, AXF_CLAUDE_GLOBAL: G, AXF_CLAUDE_SEEN: SEEN };
Object.assign(process.env, ENV);
const L = await import('./claude-login.mjs');
const env = { ...process.env, ...ENV };

console.log('which account');
let p = L.pick('active', env);
ok(p.account === 'account-a' && p.source === 'saved' && p.email === 'a@example.com', 'active + live login identical to it = the account\'s home (one home per login), named and emailed from the store');
writeFileSync(join(SH, '.credentials.json'), credsOf('fake-refreshed-A'));
p = L.pick('active', env);
ok(p.account === 'account-a' && p.source === 'saved', 'live login refreshed since the switch: still the home (the sweep / snapshot brings a renewal home first)');
writeFileSync(join(SH, '.credentials.json'), credsOf(SECRET_B));
p = L.pick('active', env);
ok(p.account === 'account-a' && p.source === 'saved', 'live login identical to ANOTHER saved account = the active account\'s saved copy');
ok(L.pick('live', env).account === 'account-b', '"live" is named after the saved account it matches');
rmSync(join(SH, '.credentials.json'));
p = L.pick('active', env);
ok(p.account === 'account-a' && p.source === 'saved', 'logged out (no live login) = the saved copy');
p = L.pick('account-b', env);
ok(p.account === 'account-b' && p.tokenFile && p.email === 'b@example.com', 'a named account, with its saved token');
let err = null; try { L.pick('nobody', env); } catch (e) { err = e; }
ok(err && err.code === 2 && /no saved Claude account "nobody"/.test(err.message), 'unknown account refused (code 2)');
err = null; try { L.pick('../etc', env); } catch (e) { err = e; }
ok(err && err.code === 2, 'a path is never an account name');
const bare = { ...env, AXF_CLAUDE_ACCOUNTS: join(tmp, 'none') };
writeFileSync(join(SH, '.credentials.json'), credsOf(SECRET_A));
p = L.pick('active', bare);
ok(p.account === 'live' && p.source === 'live' && p.email === 'stale@x', 'no saved accounts = the live login, recorded as "live"');
rmSync(join(SH, '.credentials.json'));
err = null; try { L.snapshot({ dir: join(tmp, 'w0'), session: 's', env: bare }); } catch (e) { err = e; }
ok(err && err.code === 4, 'nothing to copy (no store, logged out) = code 4');
writeFileSync(join(SH, '.credentials.json'), credsOf(SECRET_A));

console.log('the copy');
const w = join(tmp, 'w1'); mkdirSync(w);
const s = L.snapshot({ dir: w, session: 'axf-test/one', env });
ok(s.dir === join(w, '.axf-claude', 'axf-test-one'), 'lives in <build>/.axf-claude/<session> (session name made safe)');
ok(mode(join(w, '.axf-claude')) === 0o700 && mode(s.dir) === 0o700, 'both folders 0700');
ok(mode(join(s.dir, '.credentials.json')) === 0o600 && !lstatSync(join(s.dir, '.credentials.json')).isSymbolicLink(), 'credentials: a real 0600 file');
ok(read(join(s.dir, '.credentials.json')) === credsOf(SECRET_A), 'credentials: the active account\'s login');
ok(lstatSync(join(s.dir, 'settings.json')).isSymbolicLink() && lstatSync(join(s.dir, 'projects')).isSymbolicLink(), 'settings + transcripts stay shared (symlinks)');
const g = JSON.parse(read(join(s.dir, '.claude.json')));
ok(!g.oauthAccount && g.mcpServers?.x, 'global config copied, minus the cached (stale) account');
ok(read(join(s.dir, 'token.env')).trim() === 'unset CLAUDE_CODE_OAUTH_TOKEN ANTHROPIC_API_KEY' && mode(join(s.dir, 'token.env')) === 0o600, 'no saved token = token.env unsets the inherited one');
const ce = L.childEnv(s, { PATH: '/bin', CLAUDE_CODE_OAUTH_TOKEN: INHERITED });
ok(ce.CLAUDE_CONFIG_DIR === s.dir && !('CLAUDE_CODE_OAUTH_TOKEN' in ce) && ce.PATH === '/bin', 'childEnv: config dir set, inherited token dropped');
const sb = L.snapshot({ dir: w, session: 'two', account: 'account-b', env });
ok(sb.token && L.childEnv(sb, { CLAUDE_CODE_OAUTH_TOKEN: INHERITED }).CLAUDE_CODE_OAUTH_TOKEN === TOKEN_B, 'account with a saved token: that token, never the inherited one');
ok(/^unset ANTHROPIC_API_KEY\nexport CLAUDE_CODE_OAUTH_TOKEN='/.test(read(join(sb.dir, 'token.env'))), 'token.env exports it and drops any inherited API key (0600 file, never printed)');
// API-key accounts (workers-api-routing, Nov 8 2026): only the key is exported, billed per token
mkdirSync(join(A, 'hulu-api'), { recursive: true }); writeFileSync(join(A, 'hulu-api', 'apikey'), 'fake-api-key-hulu\n');
ok(L.accounts(env).find((a) => a.name === 'hulu-api')?.kind === 'api', 'an apikey file makes an API-key account');
const sk = L.snapshot({ dir: w, session: 'api-one', account: 'hulu-api', env });
ok(sk.kind === 'api' && !existsSync(join(sk.dir, '.credentials.json')), 'no subscription login in its copy');
ok(read(join(sk.dir, 'token.env')) === "unset CLAUDE_CODE_OAUTH_TOKEN\nexport ANTHROPIC_API_KEY='fake-api-key-hulu'\n" && mode(join(sk.dir, 'token.env')) === 0o600, 'token.env exports only the key (0600)');
const ke = L.childEnv(sk, { CLAUDE_CODE_OAUTH_TOKEN: INHERITED });
ok(ke.ANTHROPIC_API_KEY === 'fake-api-key-hulu' && !('CLAUDE_CODE_OAUTH_TOKEN' in ke), 'childEnv: the key, never an inherited subscription token');
ok(!JSON.stringify(L.who({ dir: w, session: 'api-one' })).includes('fake-'), 'its record holds no key');
const kcli = spawnSync(process.execPath, [join(HERE, 'claude-login.mjs'), 'snapshot', '--dir', w, '--session', 'api-two', '--account', 'hulu-api', '--sh'], { env, encoding: 'utf8' });
ok(/ login_kind=api$/.test(kcli.stdout.trim()) && !/fake-/.test(kcli.stdout + kcli.stderr), 'CLI --sh says api and never prints the key');
L.release({ dir: w, session: 'api-one' }); L.release({ dir: w, session: 'api-two' });
rmSync(join(A, 'hulu-api'), { recursive: true, force: true });
ok(L.who({ dir: w, session: 'two' })?.account === 'account-b' && L.describe(L.who({ dir: w, session: 'two' })) === 'account-b (b@example.com)', 'who: account + email, nothing else');
ok(!JSON.stringify(L.who({ dir: w, session: 'two' })).includes('fake-'), 'the record holds no credential');
const cli = spawnSync(process.execPath, [join(HERE, 'claude-login.mjs'), 'snapshot', '--dir', w, '--session', 'three', '--account', 'account-b', '--sh'], { env, encoding: 'utf8' });
ok(/^login_dir='.*' login_account='account-b' login_email='b@example.com' login_source=saved login_token=1 login_kind=subscription$/.test(cli.stdout.trim()), `CLI --sh: one line of names: ${cli.stdout.trim()}`);
ok(!/fake-/.test(cli.stdout + cli.stderr), 'CLI never prints a credential');
mkdirSync(join(w, '.axf-claude', 'foreign'));
ok(!L.release({ dir: w, session: 'foreign' }).released && existsSync(join(w, '.axf-claude', 'foreign')), 'release leaves a folder it didn\'t make alone');
ok(L.release({ dir: w, session: 'axf-test/one' }).released && !existsSync(s.dir), 'release deletes the copy');
ok(existsSync(join(SH, 'settings.json')) && existsSync(join(SH, 'projects')), '…without following its symlinks into the shared config');
const gi = spawnSync('git', ['check-ignore', '-q', '.axf-claude/x/.credentials.json'], { cwd: ROOT });
ok(gi.status === 0, '.axf-claude/ is git-ignored');

// ── end to end: claude-headless.sh in tmux, fake claude, logout + switch mid-run ───────────────────────────────────
const hasTmux = !spawnSync('tmux', ['-V']).error;
if (hasTmux) {
  console.log('end to end (claude-headless.sh, fake claude)');
  const bin = join(tmp, 'bin'); mkdirSync(bin);
  // the fake claude: records what it runs on (hashes only), waits, "refreshes" its token, reads its login again
  writeFileSync(join(bin, 'claude'), `#!/bin/bash
out="$PWD/fake"; mkdir -p "$out"
printf '%s' "\${CLAUDE_CONFIG_DIR:-}" > "$out/config_dir"
printf '%s' "\${CLAUDE_CODE_OAUTH_TOKEN:-}" | sha256sum | cut -c1-64 > "$out/token_sha"
f="\${CLAUDE_CONFIG_DIR:-$HOME/.claude}/.credentials.json"
sha256sum < "$f" 2>/dev/null | cut -c1-64 > "$out/creds1"
touch "$out/started"
while [ ! -f "$PWD/go" ]; do sleep 0.1; done
printf '%s' '${credsOf('fake-refreshed-by-build')}' > "$f.tmp" && mv "$f.tmp" "$f"
sha256sum < "$f" 2>/dev/null | cut -c1-64 > "$out/creds2"
echo '{"type":"result","result":"done"}'
`);
  chmodSync(join(bin, 'claude'), 0o755);
  const sock = mkdtempSync(join(tmpdir(), 'axf-login-tmux-'));
  const runEnv = { ...env, PATH: `${bin}:${process.env.PATH}`, TMUX_TMPDIR: sock, AXF_SLOTS: 'off', AXF_AGENT_BOOK: 'off', AXF_WATCH_LIVE: 'off', AXF_LOOK_GATE: 'off',
    AXF_ORIGIN: 'off', AXF_LOGIN_NOTE: 'off', AXF_ACCOUNT_SWITCHES: '0', AXF_WORKERS: 'off', /* own login of the active account, not worker routing */ AXF_HEADLESS_DIR: join(tmp, 'headless'), CLAUDE_CODE_OAUTH_TOKEN: INHERITED };
  // HOME is a temp folder too: the launcher puts ~/.local/bin first on PATH, where the real claude lives
  runEnv.HOME = join(tmp, 'home'); mkdirSync(runEnv.HOME);
  for (const k of ['TMUX', 'CLAUDE_CONFIG_DIR', 'AXF_AGENT', 'AXF_AGENT_NAME', 'AXF_AGENT_BOOKED', 'AXF_SESSION', 'AXHUB_TOKEN']) delete runEnv[k];
  const launch = (cwd, name, extra = []) => spawnSync('bash', [join(ROOT, 'deploy/claude-headless.sh'), '--name', name, ...extra, '--brief', 'brief.md', '--log', 'run.log', '--'], { cwd, env: runEnv, encoding: 'utf8', timeout: 30_000 });
  const runIn = (name) => { const d = join(tmp, name); mkdirSync(d); writeFileSync(join(d, 'brief.md'), 'hi'); return d; };
  const tag = `logintest-${process.pid}`;

  writeFileSync(join(SH, '.credentials.json'), credsOf(SECRET_A));
  const d1 = runIn('build1');
  const r1 = launch(d1, `${tag}-a`);
  ok(/^started axf-logintest-/m.test(r1.stdout), `build starts: ${r1.stdout.trim()}${r1.stderr.trim()}`);
  ok(await until(() => existsSync(join(d1, 'fake', 'started'))), 'fake claude runs');
  const cfg = read(join(d1, 'fake', 'config_dir'));
  ok(cfg.startsWith(join(d1, '.axf-claude') + '/'), 'claude runs with CLAUDE_CONFIG_DIR = the build\'s own copy');
  ok(read(join(d1, 'fake', 'creds1')).trim() === sha(credsOf(SECRET_A)), 'on the active account\'s login');
  ok(read(join(d1, 'fake', 'token_sha')).trim() === sha(''), 'the inherited CLAUDE_CODE_OAUTH_TOKEN never reaches it');
  // Brett logs the VPS out, then switches the shared login to another account, while the build runs
  rmSync(join(SH, '.credentials.json'));
  writeFileSync(join(A, '.active'), 'account-b\n');
  writeFileSync(join(SH, '.credentials.json'), credsOf(SECRET_B));
  ok(read(join(cfg, '.credentials.json')) === credsOf(SECRET_A), 'logout + switch on the shared login: the build\'s copy is untouched');
  writeFileSync(join(d1, 'go'), '');
  ok(await until(() => existsSync(join(d1, 'fake', 'creds2'))), 'the build carries on');
  ok(read(join(d1, 'fake', 'creds2')).trim() === sha(credsOf('fake-refreshed-by-build')), 'its token refresh landed in its own copy');
  ok(await until(() => read(join(A, 'account-a', '.credentials.json')) === credsOf('fake-refreshed-by-build')), 'and is saved back to the login it came from (a spent token never stays saved)');
  ok(read(join(SH, '.credentials.json')) === credsOf(SECRET_B) && read(join(A, 'account-b', '.credentials.json')) === credsOf(SECRET_B), 'and to no other account (the shared login moved to account-b: untouched)');
  ok(await until(() => !existsSync(cfg)), 'the copy is deleted when the session ends');
  const log1 = read(join(d1, 'run.log'));
  ok(/^# login account-a \(a@example\.com\) · own copy \(saved\)$/m.test(log1), 'the log says which account it ran on (copied from its home)');
  const ev = read(join(tmp, 'headless', 'events.jsonl')).split('\n').filter(Boolean).map((l) => JSON.parse(l));
  ok(ev.some((e) => e.event === 'session-login' && e.account === 'account-a' && e.email === 'a@example.com'), 'session-login event names the account');
  ok(!/fake-secret|fake-token|fake-inherited/.test(log1 + read(join(d1, 'run.jsonl')) + r1.stdout + r1.stderr + JSON.stringify(ev)), 'no credential printed anywhere');

  // the next launch picks up the new active account; --account picks one per launch (with its saved token)
  const d2 = runIn('build2');
  launch(d2, `${tag}-b`);
  ok(await until(() => existsSync(join(d2, 'fake', 'started'))), 'a new launch after the switch runs');
  ok(read(join(d2, 'fake', 'creds1')).trim() === sha(credsOf(SECRET_B)) && read(join(d2, 'fake', 'token_sha')).trim() === sha(TOKEN_B), 'new launches use the new active account (and its saved token)');
  writeFileSync(join(d2, 'go'), '');
  const d3 = runIn('build3');
  launch(d3, `${tag}-c`, ['--account', 'account-a']);
  ok(await until(() => existsSync(join(d3, 'fake', 'started'))), '--account account-a runs');
  ok(read(join(d3, 'fake', 'creds1')).trim() === sha(credsOf('fake-refreshed-by-build')) && read(join(d3, 'fake', 'token_sha')).trim() === sha(''), '--account picks the account per launch (its saved copy, no token)');
  writeFileSync(join(d3, 'go'), '');
  const bad = launch(runIn('build4'), `${tag}-d`, ['--account', '../x']);
  ok(bad.status === 2 && /--account is a saved account name/.test(bad.stderr), 'a bad --account is refused before anything starts');
  ok(await until(() => !existsSync(join(d2, '.axf-claude')) && !existsSync(join(d3, '.axf-claude'))), 'their copies are gone too');
  spawnSync('tmux', ['kill-server'], { env: runEnv });
  rmSync(sock, { recursive: true, force: true });
} else console.log('(tmux missing: skipped the claude-headless.sh end-to-end checks)');

// ── the agent swarm runner gets its own copy too ─────────────────────────────────────────────────────────────────
console.log('agent swarm runner');
let runner = null;
runner = await import('../apps/console-web/plugins/agent-swarm/runner.mjs');  // axf-plugin:agent-swarm
if (runner) {
const sbin = join(tmp, 'sbin'); mkdirSync(sbin);
writeFileSync(join(sbin, 'claude'), '#!/bin/bash\nprintf "%s" "${CLAUDE_CONFIG_DIR:-}" > "$PWD/cfg"; [ -f "$CLAUDE_CONFIG_DIR/.credentials.json" ] && echo yes > "$PWD/had"; printf "%s" "${CLAUDE_CODE_OAUTH_TOKEN:-}" > "$PWD/tok"; echo \'{"type":"result","result":"ok"}\'\n');
chmodSync(join(sbin, 'claude'), 0o755);
writeFileSync(join(A, '.active'), 'account-a\n');
const wd = join(tmp, 'swarm-wt'); mkdirSync(wd);
process.env.CLAUDE_CODE_OAUTH_TOKEN = INHERITED;
const { spawn } = await import('node:child_process');
await runner.runJob({ id: 'j1', buildId: 'b', stepId: 's1', model: 'opus', estimate: '5m', budget: { tokens: 1e6, maxTurns: 1 } }, { id: 'paulie', tools: ['Read'] }, { prompt: 'hi', system: 'test' }, { cwd: wd, bin: join(sbin, 'claude'), spawn, ownLogin: true, timeoutMin: 1 });
ok(read(join(wd, 'cfg')).startsWith(join(wd, '.axf-claude') + '/') && read(join(wd, 'had')).trim() === 'yes', 'a swarm job runs on its own login copy');
ok(read(join(wd, 'tok')) === '', '…without the inherited token');
ok(!existsSync(join(wd, '.axf-claude')), '…deleted when the job ends');
delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
} else console.log('(agent swarm not installed: skipped)');

rmSync(tmp, { recursive: true, force: true });
console.log(`claude-login: ${n - failed}/${n} checks passed`);
if (failed) process.exit(1);
