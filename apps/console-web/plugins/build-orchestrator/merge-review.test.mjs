// Merge review rules (merge-review-core.mjs): node --test apps/console-web/plugins/build-orchestrator/merge-review.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as c from './merge-review-core.mjs';

test('candidates: built only, oldest first, one per branch', () => {
  const store = { builds: [
    { id: 'b', status: 'built', builtAt: '2026-11-05T00:00:00Z', branch: 'claude/b' },
    { id: 'a', status: 'built', builtAt: '2026-11-03T00:00:00Z', branch: 'claude/a' },
    { id: 'a2', status: 'built', builtAt: '2026-11-04T00:00:00Z', branch: 'claude/a' },
    { id: 'x', status: 'complete', builtAt: '2026-11-01T00:00:00Z' },
    { id: 'd', status: 'built', deleted: true },
  ] };
  assert.deepEqual(c.candidates(store).map((b) => b.id), ['a', 'b']);
});

test('bookkeeping paths are never counted as code', () => {
  assert.ok(c.isBookkeeping('_claude/builds/store.json'));
  assert.ok(c.isBookkeeping('_claude/THREADS.md'));
  assert.ok(!c.isBookkeeping('_claude/notes/brett.md'));
  assert.ok(!c.isBookkeeping('apps/console-web/src/App.tsx'));
  assert.ok(c.isGenerated('apps/molly/axf.lock.json'));
  assert.ok(!c.isGenerated('apps/molly/package.json'));
});

test('lostLines: lines main added that the merged file dropped', () => {
  const diff = '+++ b/x.ts\n+const keep = 1;\n+const gone = 2;\n+}\n';
  assert.deepEqual(c.lostLines(diff, 'const keep = 1;\n'), ['const gone = 2;']);
  assert.deepEqual(c.lostLines(diff, 'const keep = 1;\nconst gone = 2;'), []);
});

test('verdict ranks the risk; Brett still decides', () => {
  assert.equal(c.verdict({ missing: true }).risk, 'gone');
  assert.equal(c.verdict({ prState: 'merged', unique: 3 }).risk, 'landed');
  assert.equal(c.verdict({ unique: 0 }).risk, 'landed');
  assert.equal(c.verdict({ unique: 1, prState: 'closed' }).risk, 'closed');
  assert.equal(c.verdict({ unique: 1, conflicts: ['a.ts'] }).advice, 'rebuild');
  assert.equal(c.verdict({ unique: 1, conflicts: [], reverts: [{ file: 'a.ts', lines: 2 }] }).risk, 'reverts');
  assert.equal(c.verdict({ unique: 1, conflicts: [], reverts: [], ci: 'failure' }).risk, 'red');
  assert.match(c.verdict({ unique: 1, conflicts: [], reverts: [], test: { ok: false, tail: 'x\nlight check failed: node framework/cli/check-theme.mjs' } }).why, /check-theme/);
  assert.equal(c.verdict({ unique: 1, conflicts: [], reverts: [], overlap: ['a.ts'] }).risk, 'overlap');
  assert.equal(c.verdict({ unique: 1, conflicts: [], reverts: [], overlap: [] }).advice, 'merge');
});

test('decide records the answer; next skips answered ones', () => {
  const st = { items: [{ id: 'a' }, { id: 'b' }] };
  assert.equal(c.next(st).id, 'a');
  const s2 = c.decide(st, 'a', 'skip', { by: 'Brett', at: 't' });
  assert.equal(s2.items[0].decision, 'skip');
  assert.equal(s2.items[0].decidedBy, 'Brett');
  assert.equal(c.next(s2).id, 'b');
  assert.throws(() => c.decide(st, 'a', 'land'), /merge, skip, rebuild/);
  assert.throws(() => c.decide(st, 'zz', 'merge'), /no build/);
  assert.deepEqual(c.summary(s2), { total: 2, decided: 1, merge: 0, skip: 1, rebuild: 0, risk: { unknown: 2 } });
});

test('card and alert: phone-readable, keyed per build, pushed via the merge-review source', () => {
  const item = { id: 'a', title: 'Thing', pr: '#12', builtAt: '2026-11-03T00:00:00Z', analysis: { unique: 2, ahead: 2, codeFiles: ['M x.ts'], conflicts: [], reverts: [{ file: 'x.ts', lines: 3 }], overlap: ['x.ts'], prState: 'open', ci: 'success' } };
  item.verdict = c.verdict(item.analysis);
  const text = c.card(item, { index: 1, total: 9 });
  assert.match(text, /^1\/9 · Thing \(PR #12\)/);
  assert.match(text, /Would overwrite: x\.ts \(3 lines\)/);
  assert.match(text, /Answer: merge \/ skip \/ rebuild/);
  const al = c.alertFor(item, { index: 1, total: 9 });
  assert.equal(al.source, c.ALERT_SOURCE);
  assert.equal(al.key, 'merge-review:a');
  assert.equal(al.severity, 'warning');
});
