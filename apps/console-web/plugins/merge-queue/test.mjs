// node apps/console-web/plugins/merge-queue/test.mjs — the merge queue is a read-only view of the builds store.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'mq-'));
const store = join(dir, 'store.json');
const builds = [
  { id: 'a', title: 'A', status: 'running-ci', steps: [{ id: 's1', status: 'in-pr', prNumber: 7, model: 'Opus', slot: 2 }, { id: 's2', status: 'in-pr', prNumber: 7 }] },
  { id: 'b', title: 'B', status: 'failed', attempt: 2, failure: { kind: 'ci-red', status: 'running-ci', why: 'CI is red', retry: 'split' }, steps: [] },
  { id: 'c', title: 'C', status: 'building', steps: [{ id: 's1', status: 'building' }] },
  { id: 'd', title: 'D', status: 'landed', steps: [] },
  { id: 'e', title: 'E', status: 'pending', steps: [] },
];
let n = 0;
const ok = (c, what) => { assert.ok(c, what); n++; };

const { readQueue, FRAME } = await import('./queue.mjs');
const q = readQueue(builds, '2026-11-19T12:00:00Z');
ok(q.$axf === FRAME && FRAME === 'merge-queue@2', 'merge-queue@2');
ok(JSON.stringify(q.rows.map((r) => r.build)) === JSON.stringify(['a', 'b', 'c']), `waiting to land: building up to landed (${q.rows.map((r) => r.build)})`);
ok(q.landing === 'a', 'the build landing now');
ok(q.rows[0].prs[0].pr === 7 && q.rows[0].prs[0].steps.length === 2 && q.rows[0].steps[0].slot === 2, 'PRs and steps (model, slot) from the store rows');
ok(q.rows[1].attempt === 2 && q.rows[1].failure.retry === 'split', 'failed shows the attempt and what happens next');

// the CLI reads the real store module (AXF_BUILDS_STORE = a temp store), and writes nothing
writeFileSync(store, JSON.stringify({ $axf: 'builds@1', rev: 1, builds: [{ id: 'x', title: 'X', status: 'failed', steps: [] }] }));
const before = readFileSync(store, 'utf8');
const r = spawnSync(process.execPath, [join(HERE, 'queue.mjs'), '--json'], { encoding: 'utf8', env: { ...process.env, AXF_BUILDS_STORE: store, AXF_BUILDS_LIVE: '0' } });
ok(r.status === 0, `queue.mjs runs: ${r.stderr}`);
ok(JSON.parse(r.stdout).$axf === FRAME, 'CLI answers merge-queue@2');
ok(readFileSync(store, 'utf8') === before, 'reading the queue writes nothing to the store');

// no state, no actions: the plugin has no write route, no data file and one read-only command
const py = readFileSync(join(HERE, 'server/__init__.py'), 'utf8');
ok(!/@router\.(post|put|patch|delete)/.test(py), 'no write routes');
const man = JSON.parse(readFileSync(join(HERE, 'plugin.json'), 'utf8'));
ok(man.commands.items.every((c) => c.readOnly === true), 'every command is a read');
ok(!man.provides.includes('service:axf.merge-queue@1'), 'not the old stateful merge-queue@1 provider');
const web = readdirSync(join(HERE, 'web')).map((f) => readFileSync(join(HERE, 'web', f), 'utf8')).join('\n');
ok(!/method:\s*'(POST|PUT|PATCH|DELETE)'|<Button/.test(web), 'the view has no buttons and sends no writes');

console.log(`✓ merge queue — ${n} checks`);
