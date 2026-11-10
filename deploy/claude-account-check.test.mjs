#!/usr/bin/env node
/**
 * test-button-on-every-claude-account-subscription: what Claude's answers mean (alive, expired, bad key, out of credits,
 * limit, model unavailable), the account-wide stop after one call, the login copy released afterwards, and the CLI
 * end to end with a fake claude. No real Claude call.
 *
 *   node deploy/claude-account-check.test.mjs
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { check, classify, overall } from './claude-account-check.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
let passed = 0;
const ok = (v, what) => { if (!v) { console.error(`✗ ${what}`); process.exit(1); } passed += 1; console.log(`  ✓ ${what}`); };

const res = (o) => JSON.stringify({ type: 'result', ...o });
ok(classify({ status: 0, stdout: res({ is_error: false, result: 'OK' }) }).result === 'ok', 'a clean answer is ok');
ok(classify({ status: 1, stdout: res({ is_error: true, result: 'Failed to authenticate: OAuth session expired and could not be refreshed' }) }).result === 'expired', 'an expired subscription login is expired');
ok(classify({ status: 1, stderr: 'Invalid API key · Please run /login' }, 'api').result === 'bad-key', 'a refused API key is bad-key');
ok(classify({ status: 1, stdout: res({ is_error: true, result: 'Credit balance is too low' }) }, 'api').result === 'no-credit', 'an API key out of credit is no-credit');
ok(classify({ status: 1, stdout: res({ is_error: true, result: "You've hit your limit · resets 3pm (UTC)" }) }).result === 'limit', 'a usage limit is limit');
ok(classify({ status: 1, stdout: res({ is_error: true, result: 'API Error: 404 {"type":"error","error":{"type":"not_found_error","message":"model: fable"}}' }) }).result === 'unavailable', 'a missing model is unavailable');
ok(classify({ timedOut: true }).result === 'error', 'a timeout is error');
ok(overall({ opus: { result: 'ok' }, fable: { result: 'unavailable' } }) === 'alive', 'one model working = alive');
ok(overall({ opus: { result: 'limit' }, fable: { result: 'limit' } }) === 'limit', 'every model limited = limit');

// accounts on disk, a fake claude via `run`
const tmp = mkdtempSync(join(tmpdir(), 'axf-check-test-'));
const A = join(tmp, 'accounts'); const SH = join(tmp, 'claude-home'); const CK = join(tmp, 'check');
mkdirSync(SH, { recursive: true });
const creds = (s) => JSON.stringify({ claudeAiOauth: { accessToken: `fake-${s}`, refreshToken: `fake-${s}-r` } });
for (const n of ['good', 'dead', 'hit']) { mkdirSync(join(A, n), { recursive: true }); writeFileSync(join(A, n, '.credentials.json'), creds(n)); }
mkdirSync(join(A, 'key'), { recursive: true }); writeFileSync(join(A, 'key', 'apikey'), 'fake-api-key');
writeFileSync(join(A, '.active'), 'good\n');
writeFileSync(join(SH, '.credentials.json'), creds('good'));
const env = { ...process.env, AXF_CLAUDE_ACCOUNTS: A, AXF_CLAUDE_HOME: SH, AXF_CLAUDE_GLOBAL: join(tmp, 'g.json'), AXF_CLAUDE_SEEN: join(tmp, 'seen.json'), AXF_CHECK_DIR: CK };

const calls = [];
const fake = (answers) => (model, e) => { calls.push({ model, key: e.ANTHROPIC_API_KEY ?? '', dir: e.CLAUDE_CONFIG_DIR }); return answers[model]; };
const good = { status: 0, stdout: res({ is_error: false, result: 'OK' }) };

let r = check('good', { env, run: fake({ opus: good, fable: good }) });
ok(r.state === 'alive' && r.models.opus === 'ok' && r.models.fable === 'ok' && r.$axf === 'account-check@1', 'a working login is alive on Opus and Fable');
ok(calls.every((c) => c.dir && c.dir.startsWith(CK)), 'the check runs on a private copy of the login');
ok(!readdirSync(join(CK, 'good')).some((n) => n === '.axf-claude'), 'the login copy is released afterwards');

calls.length = 0;
r = check('dead', { env, run: fake({ opus: { status: 1, stdout: res({ is_error: true, result: 'Failed to authenticate: OAuth session expired' }) } }) });
ok(r.state === 'expired' && calls.length === 1 && !('fable' in r.models), 'an expired login costs one call, not two');
ok(!JSON.stringify(r).includes('fake-dead'), 'no credential in the answer');

r = check('hit', { env, now: () => Date.UTC(2026, 10, 10, 9), run: fake({ opus: { status: 1, stdout: res({ is_error: true, result: "You've hit your limit · resets 3pm (UTC)" }) }, fable: good }) });
ok(r.state === 'alive' && r.models.opus === 'limit' && r.models.fable === 'ok', 'Opus limited but Fable working = alive, per-model results kept');

calls.length = 0;
r = check('key', { env, run: fake({ opus: { status: 1, stdout: res({ is_error: true, result: 'Credit balance is too low' }) } }) });
ok(r.kind === 'api' && r.state === 'no-credit' && calls[0].key === 'fake-api-key', 'an API key account runs on its key and reports out of credits');
ok(!JSON.stringify(r).includes('fake-api-key'), 'the key never appears in the answer');

ok(check('nobody', { env }).state === 'unknown-account', 'an unknown name says so without calling Claude');
let threw = false; try { check('../etc', { env }); } catch { threw = true; }
ok(threw, 'a bad name is refused');

// CLI end to end with a fake claude binary
const bin = join(tmp, 'fake-claude.sh');
writeFileSync(bin, `#!/bin/sh\nfor a in "$@"; do [ "$prev" = --model ] && m="$a"; prev="$a"; done\n[ "$m" = fable ] && { echo '{"type":"result","is_error":true,"result":"API Error: 404 not_found_error model: fable"}'; exit 1; }\necho '{"type":"result","is_error":false,"result":"OK"}'\n`);
chmodSync(bin, 0o755);
const p = spawnSync('node', [join(HERE, 'claude-account-check.mjs'), 'check', 'good', '--json'], { env: { ...env, AXF_CHECK_CLAUDE: bin }, encoding: 'utf8' });
const out = JSON.parse(p.stdout || '{}');
ok(p.status === 0 && out.state === 'alive' && out.models.opus === 'ok' && out.models.fable === 'unavailable', 'CLI: Opus works, Fable unavailable');
ok(spawnSync('node', [join(HERE, 'claude-account-check.mjs'), 'check', 'Bad Name'], { env, encoding: 'utf8' }).status === 2, 'CLI: bad name exits 2');

rmSync(tmp, { recursive: true, force: true });
ok(!existsSync(tmp), 'cleaned up');
console.log(`claude-account-check: ${passed} passed`);
