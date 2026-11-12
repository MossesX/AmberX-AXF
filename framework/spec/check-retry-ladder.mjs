#!/usr/bin/env node
/**
 * CI: retry-ladder@1. The reference engine (framework/core/retry-ladder.mjs) and its Python twin
 * (framework/python/axf_server/retry.py) give the same answers for every case in fixtures/retry-ladder.json.
 *
 *   node framework/spec/check-retry-ladder.mjs           replay the fixture in Node and Python (exit 1 on any difference)
 *   node framework/spec/check-retry-ladder.mjs --write   rewrite the fixture from the reference engine (then review the diff)
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as L from '../core/retry-ladder.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FILE = join(HERE, 'fixtures', 'retry-ladder.json');
const NOW = '2026-11-12T10:00:00.000Z';

const CLASSIFY = [
  { message: 'builds store is locked (/x/store.json.lock)' }, { code: 'store_locked' }, { message: 'database is locked' },
  { code: 'no_console', message: 'no console open' }, { message: 'the console is asleep' },
  { status: 429 }, { message: 'Too Many Requests' }, { message: 'Overloaded' },
  { status: 401 }, { code: 'token_expired' }, { message: 'Claude usage limit reached' },
  { status: 504 }, { code: 'ETIMEDOUT' }, { message: 'request timed out after 30s' },
  { code: 'ENOTFOUND', message: 'getaddrinfo ENOTFOUND hub' }, { message: 'socket hang up' }, { message: '[Errno -2] Name or service not known' },
  { status: 503 }, { code: 'ECONNREFUSED' }, { status: 502 },
  { status: 409 }, { message: 'rev mismatch: changed since read' },
  { status: 500 }, { status: 422 }, { message: 'validation error: missing required field id' },
  { status: 404, message: 'not found' }, { code: 'forbidden' }, 'plain words', {},
];

/** A ladder walk: a sequence of failures (and an optional success); every intermediate job is compared. */
const WALKS = [
  { title: 'store locked to success', steps: [{ fail: { code: 'store_locked' } }, { fail: { code: 'store_locked' } }, { ok: true }] },
  { title: 'store locked gives up', steps: [{ fail: { code: 'store_locked' } }, { fail: { code: 'store_locked' } }, { missing: ['restart-store-writer', 'no writer to restart'] }, { fail: { code: 'store_locked' } }, { fail: { code: 'store_locked' } }] },
  { title: 'console asleep ladder', steps: [{ fail: { code: 'no_console' } }, { fail: { code: 'no_console' } }, { fail: { code: 'no_console' } }, { fail: { code: 'no_console' } }, { fail: { code: 'no_console' } }] },
  { title: 'kind changes mid-ladder', steps: [{ fail: { status: 503 } }, { fail: { status: 429 } }, { fail: { status: 503 } }, { ok: true }] },
  { title: 'permanent fails at once', steps: [{ fail: { status: 404, message: 'not found' } }] },
  { title: 'timeout then background', steps: [{ fail: { code: 'timeout' } }, { fail: { code: 'timeout' } }, { fail: { code: 'timeout' } }] },
];

function walk(w) {
  let job = L.newJob({ id: 'job-1', title: w.title, source: 'fixture', now: NOW }); const out = [];
  for (const s of w.steps) {
    if (s.ok) job = L.onSuccess(job, NOW);
    else if (s.missing) job = L.fixUnavailable(job, s.missing[0], s.missing[1], NOW);
    else { const r = L.onFailure(job, s.fail, NOW); job = r.job; out.push({ next: r.next }); }
    out.push({ job, text: L.stepText(job) });
  }
  return out;
}

const reference = () => ({
  $axf: 'fixture', about: 'retry-ladder@1: framework/core/retry-ladder.mjs = framework/python/axf_server/retry.py',
  kinds: L.KINDS, fixes: L.FIXES,
  classify: CLASSIFY.map((input) => ({ input, kind: L.classify(input) })),
  walks: WALKS.map((w) => ({ ...w, out: walk(w) })),
  view: L.view(WALKS.map((w, i) => ({ ...walk(w).at(-1).job, id: `job-${i}`, updatedAt: `2026-11-12T10:0${i}:00.000Z` })).concat([{ ...L.newJob({ id: 'gone', title: 'x', now: NOW }), status: 'dismissed' }])),
});

if (process.argv.includes('--write')) { writeFileSync(FILE, `${JSON.stringify(reference(), null, 1)}\n`); console.log(`wrote ${FILE}`); process.exit(0); }

const fx = JSON.parse(readFileSync(FILE, 'utf8'));
let ok = 0, fail = 0;
const eq = (name, a, b) => { if (JSON.stringify(a) === JSON.stringify(b)) ok++; else { fail++; console.error(`✗ ${name}\n  want ${JSON.stringify(b)}\n  got  ${JSON.stringify(a)}`); } };
const ref = reference();
eq('node: kinds', ref.kinds, fx.kinds); eq('node: fixes', ref.fixes, fx.fixes);
fx.classify.forEach((c, i) => eq(`node: classify ${JSON.stringify(c.input)}`, ref.classify[i].kind, c.kind));
fx.walks.forEach((w, i) => eq(`node: walk ${w.title}`, ref.walks[i].out, w.out));
eq('node: view', ref.view, fx.view);

// the Python twin, on the same fixture
const py = `
import json, sys
sys.path.insert(0, ${JSON.stringify(join(HERE, '..', 'python'))})
from axf_server import retry as R
fx = json.load(open(${JSON.stringify(FILE)}))
NOW = ${JSON.stringify(NOW)}
def walk(w):
    job = R.new_job('job-1', w['title'], 'fixture', NOW); out = []
    for s in w['steps']:
        if s.get('ok'): job = R.on_success(job, NOW)
        elif s.get('missing'): job = R.fix_unavailable(job, s['missing'][0], s['missing'][1], NOW)
        else:
            job, nxt = R.on_failure(job, s['fail'], NOW); out.append({'next': nxt})
        out.append({'job': job, 'text': R.step_text(job)})
    return out
jobs = []
for i, w in enumerate(fx['walks']):
    j = dict(walk(w)[-1]['job']); j['id'] = 'job-%d' % i; j['updatedAt'] = '2026-11-12T10:0%d:00.000Z' % i; jobs.append(j)
gone = R.new_job('gone', 'x', '', NOW); gone['status'] = 'dismissed'; jobs.append(gone)
print(json.dumps({'kinds': R.KINDS, 'fixes': R.FIXES, 'classify': [R.classify(c['input']) for c in fx['classify']],
                  'walks': [walk(w) for w in fx['walks']], 'view': R.view(jobs)}))
`;
const norm = (v) => JSON.parse(JSON.stringify(v)); // key order is not part of the contract: compare sorted
const sortKeys = (v) => Array.isArray(v) ? v.map(sortKeys) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])])) : v;
const p = JSON.parse(execFileSync('python3', ['-c', py], { encoding: 'utf8' }));
const peq = (name, a, b) => eq(name, sortKeys(norm(a)), sortKeys(norm(b)));
peq('python: kinds', p.kinds, fx.kinds); peq('python: fixes', p.fixes, fx.fixes);
fx.classify.forEach((c, i) => eq(`python: classify ${JSON.stringify(c.input)}`, p.classify[i], c.kind));
fx.walks.forEach((w, i) => peq(`python: walk ${w.title}`, p.walks[i], w.out));
peq('python: view', p.view, fx.view);

console.log(`retry-ladder: ${ok} checks passed${fail ? `, ${fail} FAILED` : ''}`);
process.exit(fail ? 1 : 0);
