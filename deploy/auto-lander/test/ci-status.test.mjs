// node --test deploy/auto-lander/test/ci-status.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ciStatus, classify, firstErrors } from '../ci-status.mjs';

const S = { slug: 'o/r' };
const fake = (routes) => { const gh = async (m, p) => { gh.seen.push(p); for (const [re, v] of routes) if (re.test(p)) return typeof v === 'function' ? v(p) : v; throw Object.assign(new Error(`404 ${p}`), { status: 404 }); }; gh.seen = []; gh.calls = 0; return gh; };

test('classify: Actions only, skipped ignored', () => {
  assert.equal(classify([]).ci, 'none');
  assert.equal(classify([{ status: 'in_progress' }]).ci, 'running');
  assert.equal(classify([{ status: 'completed', conclusion: 'success' }, { status: 'completed', conclusion: 'skipped', app: { slug: 'coderabbit' } }]).ci, 'success');
  assert.equal(classify([{ status: 'completed', conclusion: 'failure', name: 'x' }]).ci, 'failure');
});

test('firstErrors prefers code blocks and error lines', () => {
  assert.deepEqual(firstErrors('### x\n```\nok line\nError: boom\n    at foo\nnot ok 3 - y\n```'), ['Error: boom', 'not ok 3 - y']);
});

test('red CI: job, failing step, annotations and the CI build errors issue', async () => {
  const gh = fake([
    [/^\/rate_limit$/, {}],
    [/check-runs\?/, { check_runs: [{ id: 5, name: 'Web Dev Console', status: 'completed', conclusion: 'failure', html_url: 'u5' }, { id: 6, name: 'Gradle', status: 'completed', conclusion: 'success' }] }],
    [/actions\/jobs\/5$/, { steps: [{ name: 'Checkout', conclusion: 'success' }, { name: 'Python route tests', conclusion: 'failure' }] }],
    [/check-runs\/5\/annotations/, [{ annotation_level: 'failure', path: 'a/b.py', start_line: 9, message: 'AssertionError: 404 != 200' }, { annotation_level: 'failure', path: '.github', message: 'Process completed with exit code 1.' }]],
    [/\/issues\?state=open/, [{ number: 40, title: 'CI build errors', comments: 2, html_url: 'i40' }]],
    [/issues\/40\/comments/, [{ body: 'other' }, { body: '### Web/Python tests failed on `claude/x` — abc123\n\n```\nFAILED test_x\n```', html_url: 'c2' }]],
  ]);
  const r = await ciStatus({ head: 'abc123', branch: 'claude/x', gh, s: S });
  assert.equal(r.ci, 'failure');
  assert.deepEqual(r.jobs, [{ job: 'Web Dev Console', step: 'Python route tests', conclusion: 'failure', url: 'u5', errors: ['a/b.py:9: AssertionError: 404 != 200'] }]);
  assert.deepEqual(r.issue, { number: 40, url: 'c2', errors: ['FAILED test_x'] });
  assert.match(r.text, /Web Dev Console › Python route tests/);
  assert.ok(r.text.length <= 2000);
});

test('green CI reads no jobs and no issue; PR number resolves the head', async () => {
  const gh = fake([[/^\/rate_limit$/, {}], [/pulls\/7$/, { head: { sha: 'def', ref: 'claude/y' } }], [/check-runs\?/, { check_runs: [{ status: 'completed', conclusion: 'success' }] }]]);
  const r = await ciStatus({ pr: 7, gh, s: S });
  assert.equal(r.ci, 'success'); assert.equal(r.head, 'def'); assert.equal(r.branch, 'claude/y');
  assert.ok(!gh.seen.some((p) => p.includes('issues')));
});
