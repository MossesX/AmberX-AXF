#!/usr/bin/env node
/**
 * claude-link-emit: event shaping, a fake headless launch mapped to launch / account / limit hand-off / exit / error
 * lines, delivery to a fake console's ingest route with the token, and the spool when the console can't be reached.
 *
 *   node framework/cli/claude-link-emit.test.mjs
 */
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { emit, fromHeadless, shape, target } from './claude-link-emit.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
let passed = 0;
const ok = (v, what) => { if (!v) { console.error(`✗ ${what}`); process.exit(1); } passed += 1; console.log(`  ✓ ${what}`); };
const dir = mkdtempSync(join(tmpdir(), 'axf-claude-link-'));

ok(shape({ kind: 'nope' }) === null, 'an unknown kind is dropped');
ok(shape({ kind: 'mcp', summary: 'a\nb' }).summary === 'a b', 'summary is one line');
ok(target({ AXF_CONSOLE_URL: 'https://c.example/' }) === 'https://c.example/api/claude-link/ingest', 'default target is the console ingest route');
ok(target({ AXF_CLAUDE_LINK_URL: 'http://127.0.0.1:1/x' }) === 'http://127.0.0.1:1/x', 'AXF_CLAUDE_LINK_URL wins');
ok(!/console-terminal/.test(readFileSync(join(HERE, 'claude-link-emit.mjs'), 'utf8')), 'the helper never names the plugin folder');

// a fake launch: the lines claude-headless.sh writes for a run that hit its limit, moved on, then crashed
const log = join(dir, 'run.log');
writeFileSync(log, 'starting\nError: connect ECONNREFUSED 10.0.0.1:443\nsomething else\nfatal: the run failed\n');
const at = new Date().toISOString();
const run = { session: 'axf-demo', name: 'demo', agent: 'Ivy', model: 'claude-opus-5-5', at, cwd: dir, log, surface: 'pipeline' };
const lines = [{ ...run, event: 'session-start' }, { ...run, event: 'session-login', account: 'hulu', email: 'someone@example.com' },
  { ...run, event: 'session-part', account: 'hulu', costUsd: 1.2 }, { ...run, event: 'session-end', exit: 1, kind: 'crash', account: 'zed', costUsd: 2.5 }];
const mapped = lines.flatMap((l) => fromHeadless(l));
ok(mapped.map((e) => e.kind).join(',') === 'launch,account,account,exit,error', 'launch, account pick, limit hand-off, exit and the error line');
ok(mapped[3].level === 'error' && mapped[3].detail.exit === 1, 'a crash exit is an error-level exit line');
ok(mapped[4].detail.lines.length === 2 && /fatal/.test(mapped[4].summary), 'the error lines come from the run log');
ok(!JSON.stringify(mapped).includes('someone@example.com'), 'no email leaves the VPS');
ok(fromHeadless({ ...run, event: 'session-end', exit: 0, kind: 'phase-done' }).length === 1, 'a clean end has no error line');

// delivery: a fake console ingest route
const got = [];
const srv = createServer((req, res) => {
  let b = ''; req.on('data', (c) => { b += c; });
  req.on('end', () => { got.push({ auth: req.headers.authorization, url: req.url, body: JSON.parse(b) }); res.setHeader('content-type', 'application/json'); res.end('{"ok":true,"ids":[1]}'); });
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${srv.address().port}/api/claude-link/ingest`;
const env = { AXF_CLAUDE_LINK_URL: url, AXF_TOKEN: 'tok-123', AXF_CLAUDE_LINK_SPOOL: join(dir, 'spool.jsonl') };
const r1 = await emit(mapped, { env });
ok(r1.ok && r1.sent === 5, 'sent to the console');
ok(got[0].auth === 'Bearer tok-123' && got[0].body.events.length === 5, 'with the console token, as one batch');

// the CLI form, the way claude-headless.sh calls it (detached, one line)
const cli = await new Promise((res) => { let out = ''; const c = spawn(process.execPath, [join(HERE, 'claude-link-emit.mjs'), '--headless', JSON.stringify(lines[0]), '--json'], { env: { ...process.env, ...env, AXF_CLAUDE_LINK: '' } });
  c.stdout.on('data', (d) => { out += d; }); c.on('close', (status) => res({ status, out })); });
ok(cli.status === 0 && JSON.parse(cli.out).sent === 1, 'the CLI exits 0 and sends');
ok(got.length === 2 && got[1].body.events[0].kind === 'launch', 'the CLI sends the launch line');
srv.close();

// the console can't be reached: the line is spooled, never an error
const r2 = await emit({ kind: 'exit', source: 'headless', summary: 'x' }, { env: { ...env, AXF_CLAUDE_LINK_URL: 'http://127.0.0.1:9/none' }, timeoutMs: 500 });
ok(r2.ok && r2.spooled === 1, 'unreachable: spooled');
ok(existsSync(env.AXF_CLAUDE_LINK_SPOOL) && JSON.parse(readFileSync(env.AXF_CLAUDE_LINK_SPOOL, 'utf8').trim()).kind === 'exit', 'the spool holds the line');
const off = await emit({ kind: 'exit' }, { env: { AXF_CLAUDE_LINK: 'off' } });
ok(off.off, 'AXF_CLAUDE_LINK=off sends nothing');
const bad = spawnSync(process.execPath, [join(HERE, 'claude-link-emit.mjs'), '--headless', 'not json'], { encoding: 'utf8' });
ok(bad.status === 0, 'a bad line never fails the caller');
console.log(`claude-link-emit: ${passed} checks passed`);
