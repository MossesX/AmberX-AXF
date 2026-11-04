// ci-scope@1 self-test (build merge-queue): path filters, light PR mode, main pushes the queue already tested, and the
// workflow wiring (every heavy job waits on the scope job and reads its output). Run: node framework/spec/check-ci-scope.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { KEYS, scopeFor, outputs, sameCode, lightCommands, touchedPlugins, needsOf } from '../cli/ci-scope.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
let n = 0;
const t = (name, fn) => { fn(); n++; console.log(`ok ${name}`); };
const on = (s) => KEYS.filter((k) => s[k]);

t('console-only changes skip Android, AmberX and the other app builds', () => {
  assert.deepEqual(on(scopeFor(['apps/console-web/plugins/demo/server/__init__.py'])), ['engine', 'console']);
});
t('each app runs only its own build', () => {
  assert.deepEqual(on(scopeFor(['apps/molly/src/App.tsx'])), ['engine', 'console', 'molly']);
  assert.deepEqual(on(scopeFor(['apps/axhub-web/src/x.ts'])), ['engine', 'console', 'axhubweb']);
  assert.deepEqual(on(scopeFor(['apps/amberx-droid/src/x.ts'])), ['engine', 'console', 'amberxweb', 'amberx']);
  assert.deepEqual(on(scopeFor(['apps/voicevault/app/x.kt'])), ['engine', 'android']);
  assert.deepEqual(on(scopeFor(['framework/android/axf-kernel/x.kt'])), ['engine', 'android']);
});
t('shared framework, fixtures, CI itself and unknown paths run everything', () => {
  for (const f of ['framework/core/engines/x.ts', 'framework/schemas/asset-types.json', 'framework/spec/fixtures/a.json', '.github/workflows/android.yml', 'something/new.txt', 'apps/new-app/x.ts'])
    assert.deepEqual(on(scopeFor([f])), [...KEYS], f);
});
t('builds data runs the engine sweep only; root docs nothing', () => {
  assert.deepEqual(on(scopeFor(['_claude/builds/store.json', '_claude/THREADS.md'])), ['engine']);
  assert.deepEqual(on(scopeFor(['README.md'])), []);
  assert.equal(needsOf('./tracker.json').join(), 'engine');
});
t('light mode on PRs only while the queue is on; queue branches run full', () => {
  const f = ['apps/console-web/x.ts'];
  assert.equal(outputs({ event: 'pull_request', ref: '', queueOn: true, files: f }).mode, 'light');
  assert.equal(outputs({ event: 'pull_request', ref: '', queueOn: true, files: f }).console, false);
  assert.equal(outputs({ event: 'pull_request', ref: '', queueOn: false, files: f }).console, true);
  const qb = outputs({ event: 'push', ref: 'queue/pr-12', queueOn: true, files: f });
  assert.equal(qb.mode, 'full'); assert.equal(qb.console, true); assert.equal(qb.android, false);
});
t('main push the queue already tested runs nothing again (Android publish only when Android changed)', () => {
  const o = outputs({ event: 'push', ref: 'main', files: ['apps/console-web/x.ts'], tested: true });
  assert.equal(o.mode, 'main-tested'); assert.deepEqual(on(o), []);
  assert.deepEqual(on(outputs({ event: 'push', ref: 'main', files: ['framework/android/a.kt'], tested: true })), ['android']);
  assert.deepEqual(on(outputs({ event: 'push', ref: 'main', files: ['apps/console-web/x.ts'], tested: false })), ['engine', 'console']);
});
t('same code = only _claude/ differs', () => {
  assert.equal(sameCode([]), true); assert.equal(sameCode(['_claude/builds/store.json']), true); assert.equal(sameCode(['_claude/x', 'a.js']), false);
});
t('light checks: validators always, console type-check, the touched plugin tests', () => {
  const files = ['apps/console-web/plugins/demo/land/land.mjs'];
  assert.deepEqual(touchedPlugins([...files, 'apps/console-web/plugins/_template/x']), ['demo']);
  const cmds = lightCommands(files, { exists: (p) => p.endsWith('demo/test.py'), list: () => ['land/land.test.mjs', 'plugin.json'] });
  assert.ok(cmds.some((c) => c.includes('tracker.mjs --check')));
  assert.ok(cmds.some((c) => c.includes('npx tsc --noEmit')));
  assert.ok(cmds.includes('python apps/console-web/plugins/demo/test.py'));
  assert.ok(cmds.includes('node apps/console-web/plugins/demo/land/land.test.mjs'));
  assert.ok(!lightCommands(['_claude/x.md']).some((c) => c.includes('tsc')));
});
t('android.yml: runs on queue/**, every heavy job waits on scope and reads its output', () => {
  const y = readFileSync(join(ROOT, '.github/workflows/android.yml'), 'utf8');
  assert.match(y, /branches: \[main, 'queue\/\*\*'\]/);
  assert.match(y, /node framework\/cli\/ci-scope\.mjs gha/);
  for (const [job, key] of [['engine', 'engine'], ['console', 'console'], ['amberx', 'amberx'], ['android', 'android'], ['light', 'light']]) {
    const block = y.slice(y.indexOf(`\n  ${job}:\n`), y.indexOf('\n    steps:', y.indexOf(`\n  ${job}:\n`)));
    assert.match(block, /needs: (scope|\[scope)/, job);
    assert.match(block, new RegExp(`needs\\.scope\\.outputs\\.${key} == 'true'`), job);
  }
  for (const k of ['axhubweb', 'amberxweb', 'molly', 'walkthrough']) assert.match(y, new RegExp(`needs\\.scope\\.outputs\\.${k} == 'true'`));
});
console.log(`ci-scope: ${n} checks passed`);
