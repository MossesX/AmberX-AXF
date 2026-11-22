#!/usr/bin/env node
/**
 * Root task behind the maintenance host service (run only through bin/axf-task, never directly by axf-host):
 *   maint-docker.mjs cache [--no-restart]   docker builder prune -af + dangling images; when the build cache still shows
 *                                           as in use afterwards (nothing freed, cache left), restart Docker and prune again
 *   maint-docker.mjs restart                systemctl restart docker, wait until the daemon answers and containers are back
 *   maint-docker.mjs status                 disk and Docker space, no change
 * The last stdout line is one JSON object: { ok, op, disk: { before, after }, freedBytes, restarted, steps[] }.
 * Why the restart: on Nov 17 2026 the disk hit 100%; 87 GB of build cache showed as active and prune freed nothing
 * until Docker restarted (96% → 78%).
 */
import { spawnSync } from 'node:child_process';
import { statfsSync } from 'node:fs';

const DOCKER = process.env.AXF_MAINT_DOCKER || '/usr/bin/docker';
const SYSTEMCTL = process.env.AXF_MAINT_SYSTEMCTL || '/usr/bin/systemctl';
const WAIT_MS = Number(process.env.AXF_MAINT_WAIT_MS || 180000);
const STUCK_BYTES = 1024 ** 3; // cache left after a prune that freed nothing: Docker is holding it

const sh = (cmd, args, timeout = 600000) => { const r = spawnSync(cmd, args, { encoding: 'utf8', timeout }); return { ok: r.status === 0, out: `${r.stdout || ''}`.trim(), err: `${r.stderr || r.error?.message || ''}`.trim().slice(-300) }; };
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
export function disk(path = '/') { const s = statfsSync(path); const total = s.blocks * s.bsize; const free = s.bavail * s.bsize; return { total, free, pct: total ? Math.round(((total - free) / total) * 100) : 0 }; }
export function parseSize(text) { const m = /([\d.]+)\s*([kMGT]?)i?B/i.exec(String(text || '')); if (!m) return 0; return Math.round(Number(m[1]) * 1000 ** ['', 'k', 'm', 'g', 't'].indexOf(m[2].toLowerCase())); }
function cacheBytes() { const r = sh(DOCKER, ['system', 'df', '--format', '{{.Type}}\t{{.Size}}'], 60000); const line = r.out.split('\n').find((l) => l.startsWith('Build Cache')); return r.ok && line ? parseSize(line.split('\t')[1]) : -1; }
function containers() { const r = sh(DOCKER, ['ps', '--format', '{{.Names}}'], 30000); return r.ok ? r.out.split('\n').filter(Boolean) : null; }

function prune(steps) {
  for (const [name, args] of [['builder prune', ['builder', 'prune', '-af']], ['image prune', ['image', 'prune', '-f']]]) {
    const r = sh(DOCKER, args);
    steps.push({ step: name, ok: r.ok, ...(r.ok ? {} : { error: r.err }) });
  }
}
function restart(steps) {
  const before = containers() || [];
  const r = sh(SYSTEMCTL, ['restart', 'docker'], 300000);
  steps.push({ step: 'restart docker', ok: r.ok, ...(r.ok ? {} : { error: r.err }) });
  if (!r.ok) return false;
  const end = Date.now() + WAIT_MS;
  let back = null;
  while (Date.now() < end) { back = containers(); if (back && before.every((n) => back.includes(n))) break; sleep(3000); }
  const missing = before.filter((n) => !(back || []).includes(n));
  steps.push({ step: 'containers back', ok: !!back && !missing.length, was: before.length, now: (back || []).length, ...(missing.length ? { missing } : {}) });
  return !!back;
}

function main(argv) {
  const op = argv[0];
  const steps = [];
  const before = disk();
  let restarted = false;
  let ok = true;
  if (op === 'status') { console.log(JSON.stringify({ ok: true, op, disk: { before, after: before }, buildCacheBytes: cacheBytes(), containers: (containers() || []).length })); return 0; }
  if (op === 'cache') {
    prune(steps);
    const left = cacheBytes();
    if (!argv.includes('--no-restart') && disk().free - before.free < STUCK_BYTES / 10 && left > STUCK_BYTES) { restarted = restart(steps); if (restarted) prune(steps); }
  } else if (op === 'restart') { restarted = restart(steps); ok = restarted; } else { console.error('usage: maint-docker.mjs cache [--no-restart] | restart | status'); return 2; }
  const after = disk();
  ok = ok && steps.every((s) => s.ok);
  console.log(JSON.stringify({ ok, op, disk: { before, after }, freedBytes: Math.max(0, after.free - before.free), restarted, steps }));
  return ok ? 0 : 1;
}

if (process.argv[1] && process.argv[1].endsWith('maint-docker.mjs')) process.exit(main(process.argv.slice(2)));
