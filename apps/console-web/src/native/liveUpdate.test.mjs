// node apps/console-web/src/native/liveUpdate.test.mjs — an open console follows the live deploy
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MIN_GAP_MS, decide, due, entryOf, pathOf } from './liveUpdate.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
let n = 0;
const t = (name, fn) => { fn(); n++; };

t('entry bundle from index.html, either attribute order', () => {
  assert.equal(entryOf('<script type="module" crossorigin src="/assets/index-AbC.js"></script>'), '/assets/index-AbC.js');
  assert.equal(entryOf("<script src='https://c.example/assets/index-9.js?v=1' type='module'>"), '/assets/index-9.js');
  assert.equal(entryOf('<script src="/legacy.js"></script>'), '');
  assert.equal(entryOf(null), '');
  assert.equal(pathOf('/a/b.js#x'), '/a/b.js');
});

t('reload only off screen inside the app; otherwise the reload bar', () => {
  assert.equal(decide({ loaded: '/a.js', live: '/a.js', hidden: true, wrapper: true }), 'none');
  assert.equal(decide({ loaded: '/a.js', live: '', hidden: true, wrapper: true }), 'none');
  assert.equal(decide({ loaded: '/a.js', live: '/b.js', hidden: true, wrapper: true }), 'reload');
  assert.equal(decide({ loaded: '/a.js', live: '/b.js', hidden: false, wrapper: true }), 'notify');
  assert.equal(decide({ loaded: '/a.js', live: '/b.js', hidden: true, wrapper: false }), 'notify');
});

t('checks are spaced unless asked for', () => {
  assert.equal(due(0, 5), true);
  assert.equal(due(1000, 1000 + MIN_GAP_MS - 1), false);
  assert.equal(due(1000, 1000 + MIN_GAP_MS), true);
  assert.equal(due(1000, 1001, true), true);
});

t('the server never caches the page itself, and the console app reads the entry the same way', () => {
  const main = readFileSync(join(ROOT, 'apps/console-web/server/main.py'), 'utf8');
  assert.match(main, /"cache-control": "no-cache"\} if target\.suffix == "\.html"/);
  const java = join(ROOT, 'apps/console-droid/app/src/main/java/ai/amberx/consoleapp/UpdateRules.java');
  try { assert.match(readFileSync(java, 'utf8'), /static String entry\(String html\)/); } catch (e) { if (e.code !== 'ENOENT') throw e; }
});

console.log(`liveUpdate: ${n} checks passed`);
