#!/usr/bin/env node
/**
 * framework/cli/shapes.mjs (and `axf shape`) on scratch hub files: list, set at every scope, resolve through the chain,
 * Restore previous edit twice, add a corners and a mask shape, refuse a bad mask and an unknown shape. CI:
 *   node framework/spec/check-shapes-cli.mjs
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const T = mkdtempSync(join(tmpdir(), 'axf-shapes-cli-'));
mkdirSync(join(T, 'looks'));
writeFileSync(join(T, 'appearance.json'), JSON.stringify({ $axf: 'appearance@1', settings: {} }));
const env = { ...process.env, AXF_APPEARANCE_FILE: join(T, 'appearance.json'), AXF_LOOKS_DIR: join(T, 'looks'), AXF_SHAPES_DIR: join(T, 'shapes') };
const run = (cli, ...args) => {
  try { return JSON.parse(execFileSync('node', [join(ROOT, cli), ...args, '--json'], { cwd: ROOT, env, encoding: 'utf8' })); }
  catch (e) { return JSON.parse(e.stdout || '{"ok":false}'); }
};
const shapes = (...a) => run('framework/cli/shapes.mjs', ...a);
let n = 0;
const ok = (c, m) => { if (!c) { console.error(`✗ ${m}`); process.exit(1); } n++; };

run('framework/cli/skins.mjs', 'snapshot', 'axf-console');
ok(shapes('list').result.length >= 10, 'every starter is listed');
ok(run('framework/cli/axf.mjs', 'shape', 'list').ok, 'axf shape is the same CLI');
ok(shapes('resolve', 'console').result.level === 'default', 'nothing picked: the banner default');
ok(shapes('set', 'hexagon', '--scope', 'global').result.current === 'hexagon', 'set global');
ok(shapes('resolve', 'console').result.id === 'hexagon', 'global decides');
ok(shapes('set', 'squircle', '--scope', 'app', '--app', 'console').ok, 'set app');
ok(shapes('resolve', 'console').result.level === 'app', 'app beats global');
ok(shapes('set', 'tag', '--scope', 'widget', '--app', 'console', '--widget', 'counter:approvals').ok, 'set one widget');
const w = shapes('resolve', 'console', '--widget', 'counter:approvals').result;
ok(w.id === 'tag' && w.level === 'instance', 'the widget beats the app');
ok(shapes('restore', '--scope', 'app', '--app', 'console').result.current === '', 'restore the app pick');
ok(shapes('restore', '--scope', 'app', '--app', 'console').result.current === 'squircle', 'restore again brings it back');
ok(!shapes('restore', '--scope', 'skin', '--skin', 'atelier').ok, 'nothing to restore on an untouched level');
ok(shapes('set', 'diamond', '--scope', 'skin', '--skin', 'atelier').ok && shapes('get').result.skins.atelier === 'diamond', 'a skin keeps its own pick');
ok(!shapes('set', 'nope', '--scope', 'global').ok, 'unknown shape refused');
ok(!shapes('set', 'pill', '--scope', 'widget', '--app', 'console').ok, 'widget scope needs --widget');
ok(shapes('add', 'leafy', '--corners', 'tl=lg,br=lg').result.data.kind === 'corners', 'add a corners shape');
ok(shapes('add', 'kite', '--mask', 'M 50 0 L 100 40 L 50 100 L 0 40 Z').result.data.kind === 'mask', 'add a mask shape');
const bad = shapes('add', 'evil', '--mask', 'M 0 0 L 9 9 url(x) Z');
ok(!bad.ok && /outside the path/.test(bad.error), 'a mask that references anything outside the path is refused');
ok(!shapes('add', 'big', '--corners', 'tl=12px').ok, 'a length is never a corner');
ok(shapes('set', 'kite', '--scope', 'global').ok, 'an added shape can be picked');
console.log(`check-shapes-cli: ok (${n} checks)`);
