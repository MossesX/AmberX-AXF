#!/usr/bin/env node
// retry-runner (Node side of retry-ladder@1): fixes run in ladder order, the ledger records every attempt, and a
// detached run (`retry-runner.mjs run --detach`) finishes after its caller has exited.
//   node framework/spec/check-retry-runner.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = mkdtempSync(join(tmpdir(), 'axf-retry-runner-'));
process.env.AXF_RETRY_DIR = join(dir, 'ledger'); process.env.AXF_RETRY_DELAY_SCALE = '0';
const R = await import('../cli/retry-runner.mjs');
const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'cli', 'retry-runner.mjs');
let n = 0; const t = async (name, fn) => { try { await fn(); n += 1; console.log(`  ✓ ${name}`); } catch (e) { console.error(`✗ ${name}`); throw e; } };

try {
  await t('async: timeout ladder tries a longer timeout, then the caller-supplied background fix, and lands', async () => {
    const seen = [];
    const { job, result } = await R.runWithFixes({
      title: 'slow call', ctx: { timeoutMs: 1000 },
      call: async (ctx) => { seen.push(ctx.timeoutMs); if (!ctx.background) throw Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' }); return 'ok'; },
      fixes: { 'background-job': async (ctx) => { ctx.background = true; } },
    });
    assert.equal(result, 'ok'); assert.equal(job.status, 'fixed'); assert.deepEqual(seen, [1000, 3000, 3000]);
    assert.deepEqual(job.attempts.map((a) => a.fix), ['longer-timeout', 'background-job']);
    assert.equal(R.readJob(job.id).status, 'fixed');
  });
  await t('sync: a fix that cannot run is recorded as missing and the ladder moves on; gave-up has the FYI', () => {
    const { job, error } = R.runWithFixesSync({ title: 'hub call', call: () => { throw Object.assign(new Error('getaddrinfo ENOTFOUND hub'), { code: 'ENOTFOUND' }); } });
    assert.ok(error); assert.equal(job.status, 'gave-up'); assert.deepEqual(job.attempts.map((a) => a.fix), ['retry', 'internal-address']);
    assert.match(job.fyi, /Missing: retrying via the internal address: no automatic fix for this here\./);
  });
  await t('a permanent error is not retried and not logged (the caller has it)', () => {
    const { job } = R.runWithFixesSync({ title: 'open', call: () => { throw Object.assign(new Error('no screen x'), { code: 'not_found' }); } });
    assert.equal(job.status, 'failed'); assert.equal(R.readJob(job.id), null);
  });
  await t('detached: the caller returns at once and exits; the job still retries to success', async () => {
    const counter = join(dir, 'count'); writeFileSync(counter, '0');
    const script = `const fs=require('fs');const n=+fs.readFileSync(${JSON.stringify(counter)},'utf8');fs.writeFileSync(${JSON.stringify(counter)},String(n+1));if(n<2){console.error('503 service unavailable');process.exit(1)}`;
    const out = JSON.parse(execFileSync(process.execPath, [CLI, 'run', '--title', 'detached job', '--detach', '--json', '--', process.execPath, '-e', script], { encoding: 'utf8', env: process.env }));
    assert.equal(out.detached, true);
    let job = null;
    for (let i = 0; i < 150 && job?.status !== 'fixed'; i += 1) { await new Promise((r) => setTimeout(r, 100)); job = R.readJob(out.id); }
    assert.equal(job?.status, 'fixed', JSON.stringify(job)); assert.equal(readFileSync(counter, 'utf8'), '3');
    assert.deepEqual(job.attempts.map((a) => a.fix), ['health-check', 'restart-container']);
  });
  await t('list view + dismiss through the CLI', () => {
    const v = JSON.parse(execFileSync(process.execPath, [CLI, 'list', '--json'], { encoding: 'utf8', env: process.env }));
    assert.equal(v.gaveUp, 1); const g = v.rows.find((r) => r.status === 'gave-up');
    execFileSync(process.execPath, [CLI, 'dismiss', g.id], { env: process.env });
    assert.equal(JSON.parse(execFileSync(process.execPath, [CLI, 'list', '--json'], { encoding: 'utf8', env: process.env })).count, 0);
  });
} finally {
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
}
console.log(`retry-runner: ${n} checks passed`);
