// node framework/cli/check-safe-area.test.mjs — the safe-area CI check catches a bar drawn under the status bar
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { check, checkFrameworkCss, checkPinned, rules } from './check-safe-area.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
let n = 0;
const t = (name, fn) => { fn(); n++; };
const fw = readFileSync(join(ROOT, 'framework/ui/axf.css'), 'utf8');

t('the repo passes', () => assert.deepEqual(check(ROOT), []));

t('a top bar without its inset fails', () => {
  const bad = fw.replace('.fx-frame { padding: var(--fx-safe-top) var(--fx-safe-right) 0 var(--fx-safe-left); }', '.fx-frame { padding: 0; }');
  assert.notEqual(bad, fw);
  assert.ok(checkFrameworkCss(bad).some((f) => /\.fx-frame does not pad --fx-safe-top/.test(f)));
});

t('a bottom nav without its inset fails', () => {
  const bad = fw.replace('calc(var(--fx-dens-gap-md) + var(--fx-safe-bottom)); gap: 0; overflow-x: auto', 'var(--fx-dens-gap-md); gap: 0; overflow-x: auto');
  assert.notEqual(bad, fw);
  assert.ok(checkFrameworkCss(bad).some((f) => /\.fx-nav does not pad --fx-safe-bottom/.test(f)));
});

t('reading env() directly fails; the token declaration does not', () => {
  const bad = `${fw}\n.x { padding-top: env(safe-area-inset-top); }\n`;
  assert.ok(checkFrameworkCss(bad).some((f) => /reads env\(safe-area-inset-\*\) directly/.test(f)));
  assert.ok(!checkFrameworkCss(fw).some((f) => /directly/.test(f)));
});

t('a plugin bar pinned to an edge must read the inset', () => {
  assert.equal(checkPinned('.p { position: fixed; top: 0; left: 0; }', 'p.css').length, 1);
  assert.equal(checkPinned('.p { position: fixed; bottom: var(--fx-dens-gap-xl); }', 'p.css').length, 1);
  assert.equal(checkPinned('.p { position: fixed; top: var(--fx-safe-top); }', 'p.css').length, 0);
  assert.equal(checkPinned('.p { position: fixed; inset: 0; background: var(--fx-bg); }', 'p.css').length, 1);
  assert.equal(checkPinned('.p { position: fixed; inset: 0; z-index: 9 }', 'p.css').length, 0);
});

t('rules() reads selectors and bodies', () => {
  const r = rules('/* c */\n.a, .b { x: 1 }\n@media (x) { .c { y: 2 } }');
  assert.deepEqual(r.map((x) => x.selector), ['.a, .b', '.c']);
});

console.log(`check-safe-area: ${n} checks passed`);
