#!/usr/bin/env node
/**
 * Regression: PR PR 816 replayed (Nov 18 2026, build auto-lander-never-wait-missing-ui-review). Brett: "If it recorded the
 * test of the pipeline and didn't merge it on its own, then the test failed."
 *
 *   1. PR 816: CI green, the build claimed a UI Review, the console has no item → every part of the lander lands it:
 *      the gate verdict (gate-rules@1 through the gate plugin's check_pr) passes flagged ui-review-missing, the landing
 *      line's lookup (land.mjs lookupReview against a console answering state none) is no hold (blockReason null), the
 *      merge queue takes it (notReady empty), the server auto-lander decides `land` with reviewFlag missing. A console
 *      that does not answer (the failed lookup that held PR 816) lands it too.
 *   2. Held past the limit: a PR the lander truly holds longer than heldAlertMin → held-prs lists it over, and the systems
 *      check item (held_prs_health.py) is red with a Land now row for it; Land now puts it at the front of the queue with
 *      an override note (never a direct merge).
 *   3. A submit the console does not confirm: review.mjs submit --console against a console that takes the upload but
 *      does not list the item exits 2 (the build step that submits fails instead of carrying on).
 *   node apps/console-web/plugins/gate/test/test.pr-816-replay.mjs
 */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGate } from '../gate.mjs';
import { createStore } from '../gate-store.mjs';
import * as core from '../../push-banner/land/land-core.mjs';
import * as q from '../../push-banner/land/merge-queue-core.mjs';
import { lookupReview } from '../../push-banner/land/land.mjs';
import * as AL from '../../../../../framework/core/auto-lander.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../../../..');
const NOW = '2026-11-18T10:00:00.000Z';
let n = 0;
const t = async (name, fn) => { if (process.env.AXF_TEST_TRACE) console.error(`… ${name}`); try { await fn(); n += 1; } catch (e) { console.error(`✗ ${name}`); throw e; } };
process.env.AXF_CREW_SAY = 'off';
if (process.env.AXF_TEST_TRACE) console.error('… setup');

const TMP = mkdtempSync(join(tmpdir(), 'axf-816-'));
const LAND = join(TMP, 'lander'); const GATE = join(TMP, 'gate'); const FAKE = join(TMP, 'land.mjs');
mkdirSync(LAND, { recursive: true });
const json = (f, v) => writeFileSync(f, `${JSON.stringify(v, null, 1)}\n`);
// a lander CLI that records what it was asked and answers ok (queue add / move / list)
writeFileSync(FAKE, "import { appendFileSync } from 'node:fs'; appendFileSync(process.env.CALLS, JSON.stringify(process.argv.slice(2)) + '\\n'); console.log(JSON.stringify({ ok: true, args: process.argv.slice(2) }));\n");
const CALLS = join(TMP, 'calls.jsonl'); process.env.CALLS = CALLS;
json(join(LAND, 'config.json'), { $axf: 'push-banner-config@1', repos: ['MossesX/AmberX-AXF'], autoLand: false, autoMerge: false, landWaitUi: true, mergeQueue: true, queueMode: 'batch' });
json(join(LAND, 'merge-queue.json'), { $axf: 'merge-queue@1', at: NOW, items: [], waiting: [
  // PR 816 as the queue had it before this build: held on a UI Review whose item was never in the console, for 6 hours
  { pr: 816, title: 'Orchestrator: live demo', build: 'orchestrator-live-demo', branch: 'claude/orchestrator-live-demo', head: 'a816a816a816a816a816a816a816a816a816a816', state: 'held', why: 'its screenshots wait for Brett in UI Review', since: '2026-11-18T04:00:00.000Z', prCi: 'success' },
], merged: [] });
json(join(LAND, 'land.json'), { $axf: 'auto-land@1', items: [{ id: 'orchestrator-live-demo', pr: 816, title: 'Orchestrator: live demo', branch: 'claude/orchestrator-live-demo', head: 'a816a816a816a816a816a816a816a816a816a816', state: 'blocked', ci: 'success', reason: { kind: 'ui', text: 'orchestrator-live-demo: its screenshots are waiting in UI Review. Approve them and it merges by itself.' }, since: '2026-11-18T04:00:00.000Z', reviewFlag: 'missing' }] });
const store = createStore({ dataDir: GATE, landerDir: LAND, landerCli: FAKE, now: () => new Date(NOW) });
const g = createGate({ store });
if (process.env.AXF_TEST_TRACE) console.error('… gate ready');
const SNAP = { number: 816, title: 'Orchestrator: live demo', build: 'orchestrator-live-demo', branch: 'claude/orchestrator-live-demo', head: 'a816a816a816a816a816a816a816a816a816a816', ci: 'success' };
const consoleNoItem = async (method, path) => (path.startsWith('/api/plugins/ui-review/state') ? { $axf: 'ui-review@1', branch: 'claude/orchestrator-live-demo', pr: 816, state: 'none', holds: false, counts: { waiting: 0, changes: 0, rejected: 0, approved: 0 }, items: [] } : null);
const consoleDown = async () => null;

try {
  // ---------------------------------------------------------------- 1. PR 816 lands
  await t('PR 816: the live gate rules pass a green PR whose review item is missing, flagged ui-review-missing', () => {
    const v = g.run('check_pr', { snapshot: { ...SNAP, ui: 'missing' } });
    assert.equal(v.ok, true); assert.equal(v.pass, true); assert.equal(v.held, false); assert.equal(v.blockedBy, ''); assert.equal(v.flagged, true); assert.deepEqual(v.flags, ['ui-review-missing']); assert.equal(v.reviewFlag, 'missing');
    assert.match(v.notes[0], /not in the console.*lands.*flagged/);
    const unk = g.run('check_pr', { snapshot: { ...SNAP, ui: 'unknown' } }); assert.equal(unk.pass, true); assert.equal(unk.reviewFlag, 'missing');
    const wait = g.run('check_pr', { snapshot: { ...SNAP, ui: 'waiting' } }); assert.equal(wait.pass, false); assert.equal(wait.held, true); assert.equal(wait.blockedBy, 'ui-review');
  });
  await t('PR 816: the landing line looks the item up in the console, finds none, and nothing holds it (the lookup that fails is no hold either)', async () => {
    const rv = await lookupReview({ api: consoleNoItem, branch: SNAP.branch, pr: 816, claimed: true });
    assert.equal(rv.ui, 'missing'); assert.equal(rv.reviewFlag, 'missing'); assert.deepEqual(rv.items, []);
    assert.equal(core.blockReason(SNAP.build, { ci: 'success', ui: rv.ui, waitUi: true }), null);
    assert.equal(core.reviewFlagOf({ ui: rv.ui, reviewFlag: rv.reviewFlag }), 'missing');
    const down = await lookupReview({ api: consoleDown, branch: SNAP.branch, pr: 816, claimed: true });
    assert.equal(down.ui, 'unknown'); assert.equal(core.blockReason(SNAP.build, { ci: 'success', ui: down.ui }), null, 'a failed lookup is never a hold');
    // what held it before this build: the same facts, under the old reading, held (kept here as the fixed point)
    assert.equal(core.UI_HOLDS.includes('unknown'), false); assert.ok(core.UI_FLAGGED.includes('unknown'));
  });
  await t('PR 816: the merge queue takes it (notReady is empty) and the record carries the flag, not a hold', () => {
    const fact = { number: 816, head: SNAP.head, draft: false, fork: false, ci: 'success', ui: 'missing' };
    assert.equal(q.notReady(fact, {}, { waitUi: true, redJoins: true }), '');
    assert.equal(q.notReady({ ...fact, ui: 'unknown' }, {}, { waitUi: true, redJoins: true }), '');
    assert.equal(q.reviewFlagOf(fact), 'missing');
    assert.match(q.notReady({ ...fact, ui: 'waiting' }, {}, { waitUi: true, redJoins: true }), /UI Review/);
    const flagged = q.flaggedLandings([], [{ ...fact, build: SNAP.build, branch: SNAP.branch, title: SNAP.title }], new Set([816]), NOW);
    assert.deepEqual(flagged.map((f) => [f.pr, f.reviewFlag, f.build]), [[816, 'missing', 'orchestrator-live-demo']]);
  });
  await t('PR 816: the server auto-lander decides land (reviewFlag missing), never wait', () => {
    const b = { build: SNAP.build, pr: 816, branch: SNAP.branch, head: SNAP.head, state: 'waiting', since: NOW, attempts: [] };
    const d = AL.decide(b, { ...SNAP, ui: 'missing' }, [], AL.normPolicy({}), { at: NOW });
    assert.equal(d.action, 'land'); assert.equal(d.reviewFlag, 'missing'); assert.match(d.reason, /missing from the console.*flagged/);
    assert.equal(AL.decide(b, { ...SNAP, ui: 'unknown' }, [], AL.normPolicy({}), { at: NOW }).action, 'land');
    assert.equal(AL.decide(b, { ...SNAP, ui: 'waiting' }, [], AL.normPolicy({}), { at: NOW }).waitReason, 'ui-review');
  });

  // ---------------------------------------------------------------- 2. held past the limit → red with Land now
  await t('held past the limit: held-prs lists PR 816 over the 60 min limit with since when and why, and the systems check item is red with a Land now row', () => {
    const hp = g.run('held_prs');
    assert.equal(hp.ok, true); assert.deepEqual(hp.over, [816]);
    const row = hp.items.find((x) => x.pr === 816);
    assert.equal(row.state, 'held'); assert.equal(row.heldMin, 360); assert.equal(row.heldSince, '2026-11-18T04:00:00.000Z'); assert.match(row.holdReason, /wait for Brett in UI Review/); assert.equal(row.link, 'grid:held-prs/row:816'); assert.equal(row.landNow.cli, 'axf gate land-now 816');
    const py = spawnSync('python3', ['-c', `
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location("hp", ${JSON.stringify(join(HERE, '..', 'server', 'held_prs_health.py'))}); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
print(json.dumps(m.check(json.loads(sys.stdin.read()))))`], { input: JSON.stringify(hp), encoding: 'utf8' });
    assert.equal(py.status, 0, py.stderr);
    const item = JSON.parse(py.stdout.trim());
    assert.equal(item.status, 'error'); assert.match(item.summary, /PR 816 \(orchestrator-live-demo\) has been held 6 h 00, longer than the 60 min limit/); assert.match(item.summary, /Land now/);
    assert.equal(item.fix.type, 'prs'); assert.equal(item.fix.label, 'Land now'); assert.equal(item.fix.items[0].pr, 816); assert.equal(item.fix.items[0].action, 'gate.land-now:816'); assert.equal(item.fix.items[0].target, 'grid:held-prs/row:816'); assert.equal(item.fix.items[0].route, 'POST /api/plugins/gate/land-now');
    assert.equal(g.run('held_prs', { limitMin: 600 }).over.length, 0, 'under a higher limit nothing is over');
  });
  await t('Land now: confirm first, then the front of the merge queue with an override note in History; never a direct merge', () => {
    process.env.AXF_GATE_NO_BUILD_NOTES = '1';
    const first = g.run('land_now', { pr: 816, by: 'systems-check' });
    assert.equal(first.code, 'confirmation_required'); assert.equal(first.held.state, 'held'); assert.match(first.held.holdReason, /UI Review/);
    const done = g.run('land_now', { pr: 816, by: 'systems-check', confirm: first.confirm });
    assert.equal(done.ok, true); assert.equal(done.via, 'merge-queue'); assert.equal(done.position, 0); assert.match(done.override.note, /Land now pressed by systems-check/);
    const calls = spawnSync('cat', [CALLS], { encoding: 'utf8' }).stdout.trim().split('\n').map((l) => JSON.parse(l));
    assert.deepEqual(calls.map((c) => c.slice(0, 2)), [['queue', 'add'], ['queue', 'move']]); assert.deepEqual(calls[1].slice(0, 4), ['queue', 'move', '816', '0']);
    assert.ok(!calls.some((c) => /merge/.test(c[0]) && c[0] !== 'queue'), 'nothing merged directly');
    const h = g.run('history', { kind: 'lander', pr: 816 }); assert.equal(h.items[0].action, 'land-now'); assert.match(h.items[0].after.override, /ahead of its hold/);
  });

  // ---------------------------------------------------------------- 3. a submit the console does not confirm fails the step
  await t('a submit the console takes but does not list exits 2: the build step that submits fails instead of carrying on', async () => {
    const shot = join(TMP, 'shot-phone.png'); writeFileSync(shot, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    const seen = [];
    const server = createServer((req, res) => {
      seen.push(`${req.method} ${req.url}`);
      let body = ''; req.on('data', (c) => { body += c; }); req.on('end', () => {
        res.setHeader('content-type', 'application/json');
        if (req.url === '/api/plugins/ui-review/submit') return res.end(JSON.stringify({ ok: true, item: { id: 'rv-ghost', name: JSON.parse(body).title, section: 'screen', files: { after: [{ src: 'x' }], before: [] }, group: { name: 'g' } } }));
        if (req.url === '/api/plugins/ui-review/items') return res.end(JSON.stringify({ items: [], groups: [] })); // the console never kept it
        res.statusCode = 404; res.end('{}');
      });
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const url = `http://127.0.0.1:${server.address().port}`;
    const env = { ...process.env, AXF_CONSOLE_URL: url, AXF_TOKEN: 't', CLAUDECODE: '1', CLAUDE_CODE_SESSION_ID: 'replay816', CLAUDE_CODE_SESSION_ATTENDED: '0' };
    // async spawn: the server above lives in this process, so a spawnSync would block the answers it has to give
    const r = await new Promise((done) => {
      const c = spawn(process.execPath, [join(ROOT, 'apps/console-web/plugins/ui-review/review.mjs'), 'submit', '--name', 'Ghost item', '--app', 'Console', '--screen', '/gate', '--shots', shot, '--branch', 'claude/orchestrator-live-demo', '--pr', '816', '--group', 'replay', '--single-option', 'regression replay', '--console'], { env, cwd: ROOT });
      let stdout = ''; let stderr = '';
      c.stdout.on('data', (d) => { stdout += d; }); c.stderr.on('data', (d) => { stderr += d; });
      c.on('close', (status) => done({ status, stdout, stderr }));
    });
    server.closeAllConnections?.(); server.close(); server.unref();
    assert.equal(r.status, 2, `${r.stdout}\n${r.stderr}`); assert.match(r.stderr, /not confirmed by the console: the console did not confirm item rv-ghost/); assert.match(r.stderr, /fails here instead of carrying on/);
    assert.deepEqual(seen, ['POST /api/plugins/ui-review/submit', 'GET /api/plugins/ui-review/items']);
  });
} finally { rmSync(TMP, { recursive: true, force: true }); }
console.log(`✓ pr-816 replay — ${n} checks`);
process.exit(0);
