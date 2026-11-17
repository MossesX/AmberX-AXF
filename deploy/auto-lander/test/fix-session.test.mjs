// node --test deploy/auto-lander/test/fix-session.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.AXF_AUTO_LANDER_DIR = mkdtempSync(join(tmpdir(), 'al-fix-'));
const { launchFix, fixStepText } = await import('../fix-session.mjs');
const attempts = await import('../attempts.mjs');

function fakes({ live = false, account = 'acct-a', launchThrows = null, status = 'built' } = {}) {
  const b = { id: 'b1', branch: 'claude/b1', pr: '#9', status, steps: [{ id: 's1', done: true }], origin: { said: 'Make it land.' }, pipeline: {} };
  const log = [];
  return {
    log, b,
    deps: {
      build: () => b, rules: () => ({}), worktree: () => '/tmp/none', branchWorktree: () => ({}),
      live: () => ({ live, why: live ? 'b1 already has a live session: tmux axf-b1' : '' }),
      act: (c) => { log.push(['act', c.action]); if (c.action === 'add-step') b.steps.push({ id: `s${b.steps.length + 1}`, text: c.stepData.text, model: c.stepData.model }); return { state: { builds: [b] } }; },
      setPipeline: (id, patch, o) => { log.push(['pipeline', o.status]); b.status = o.status; Object.assign(b.pipeline, patch); },
      route: () => account,
      launch: (bb, l) => { if (launchThrows) throw launchThrows; log.push(['launch', l.account, l.model]); return { session: 'axf-b1', slot: 'hl-1', dir: '/tmp/none' }; },
      attempts,
    },
  };
}

test('the step text carries the summary and Brett\'s words', () => {
  const t = fixStepText({ id: 'b1', branch: 'claude/b1' }, { n: 2, summary: 'Web › tests\n  boom', origin: { said: 'Make it land.' } });
  assert.match(t, /attempt 2/); assert.match(t, /Web › tests/); assert.match(t, /Brett said \(verbatim\): "Make it land\."/);
});

test('launch: fix step, Queue, route, pipeline launch, Running, attempt opened', async () => {
  const f = fakes();
  const r = await launchFix({ id: 'b1', summary: 'CI is red: lint', deps: f.deps });
  assert.equal(r.status, 'launched'); assert.equal(r.account, 'acct-a'); assert.equal(r.step, 's2');
  assert.deepEqual(f.log, [['act', 'add-step'], ['act', 'note'], ['pipeline', 'queued'], ['launch', 'acct-a', 'Opus'], ['pipeline', 'running']]);
  const [a] = attempts.list('b1', { kind: 'red-ci' });
  assert.equal(a.result, 'started'); assert.equal(a.session, 'axf-b1'); assert.equal(a.pr, 9);
});

test('never a second session: an open attempt, a live session or a Running build', async () => {
  let f = fakes();
  assert.equal((await launchFix({ id: 'b1', deps: f.deps })).status, 'running'); // the open attempt from the last test
  assert.deepEqual(f.log, []);
  attempts.reset('b1', { by: 't' });
  f = fakes({ live: true });
  assert.equal((await launchFix({ id: 'b1', deps: f.deps })).status, 'running');
  f = fakes({ status: 'running' }); f.b.pipeline.session = 'axf-b1';
  assert.equal((await launchFix({ id: 'b1', deps: f.deps })).status, 'running');
  assert.deepEqual(f.log, []);
});

test('no account free, or the launch fails: left Queued for the dispatcher', async () => {
  let f = fakes({ account: '' });
  let r = await launchFix({ id: 'b1', deps: f.deps });
  assert.equal(r.status, 'queued'); assert.equal(f.b.status, 'queued');
  f = fakes({ launchThrows: new Error('launcher exit 3') });
  r = await launchFix({ id: 'b1', deps: f.deps });
  assert.equal(r.status, 'queued'); assert.match(r.why, /launcher exit 3/);
});
