// @ts-nocheck — a Node script run with tsx (test.py); the console typecheck has no Node types
/** Installer look checks (pure part): tree, marks, roll, document. `npx -y tsx apps/console-web/plugins/claude-handoff/look-check.mts` */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LAYOUT_DEFAULT, buildTree, isMarked, leaves, markState, normalizeLayout, parseDoc, roll, toggleMark } from './web/look-core.ts';

const here = dirname(fileURLToPath(import.meta.url));
const fw = join(here, '../../../../framework');
let ok = 0;
const check = (c, m) => { if (!c) { console.error(`FAIL: ${m}`); process.exit(1); } ok++; };
const spec = JSON.parse(readFileSync(join(fw, 'schemas/asset-types.json'), 'utf8')).types;
const load = (t) => readdirSync(join(fw, 'assets', t)).map((f) => JSON.parse(readFileSync(join(fw, 'assets', t, f), 'utf8')));
const assets = Object.fromEntries(['style-theme', 'color-theme', 'gauge', 'meter'].map((t) => [t, load(t)]));
const cur = (t, id) => assets[t].find((a) => a.id === id).data;
const inp = {
  current: { 'style-theme': cur('style-theme', 'glass-orbit'), 'color-theme': cur('color-theme', 'arctic-daylight'), gauge: cur('gauge', 'classic-arc'), meter: cur('meter', 'striped-pill'), 'installer-layout': { ...LAYOUT_DEFAULT } },
  options: Object.fromEntries(Object.entries(assets).map(([t, xs]) => [t, xs.map((a) => a.data)])),
  spec,
};
let seed = 7; const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

const tree = buildTree(inp);
check(tree.map((n) => n.label).join() === 'Style,Color,Layout', 'tree: Style, Color, Layout');
const ls = leaves(tree);
check(ls.some((l) => l.id === 'color-theme:tokens.accent' && l.field.kind === 'color'), 'colour tokens are colour leaves');
check(ls.some((l) => l.id === 'gauge:shape' && l.field.kind === 'enum' && l.field.values.includes('ring')), 'gauge shape enum from asset-types.json');
check(ls.some((l) => l.id === 'meter:height' && l.field.kind === 'number' && l.field.max === 24), 'meter height range');
check(ls.some((l) => l.id === 'installer-layout:variant' && l.field.values.length === 4), 'four installer layouts');
check(ls.every((l) => isMarked({}, l.id)), 'every leaf rolls by default');

const color = tree[1];
let marks = toggleMark(color, {});
check(markState(color, marks) === 'none' && leaves([color]).every((l) => marks[l.id] === false), 'a parent switch turns every child off');
marks = toggleMark(color, marks);
check(markState(color, marks) === 'all', '…and back on');
marks = { ...marks, 'color-theme:tokens.accent': false };
check(markState(color, marks) === 'some', 'one child off = some');
check(markState(color, toggleMark(color, marks)) === 'all', 'a parent with some children on turns them all on');

// roll only what is marked
const onlyGauge = Object.fromEntries(ls.map((l) => [l.id, l.type === 'gauge']));
const r1 = roll(tree, onlyGauge, inp, rng);
check(Object.keys(r1.data).join() === 'gauge' && r1.changed > 0, 'roll changes only the marked type');
const onlyAccent = Object.fromEntries(ls.map((l) => [l.id, l.id === 'color-theme:tokens.accent']));
const r2 = roll(tree, onlyAccent, inp, rng);
const c2 = r2.data['color-theme'];
check(c2 && JSON.stringify({ ...c2.tokens, accent: 0 }) === JSON.stringify({ ...inp.current['color-theme'].tokens, accent: 0 }), 'only the accent token changes');
check(c2.scheme === 'light', 'a partial colour roll keeps the light/dark scheme');
const allColor = Object.fromEntries(ls.map((l) => [l.id, l.type === 'color-theme']));
const r3 = roll(tree, allColor, inp, rng);
check(r3.whole['color-theme'] !== undefined, 'every colour leaf marked = switch to a whole theme');
const none = Object.fromEntries(ls.map((l) => [l.id, false]));
check(roll(tree, none, inp, rng).changed === 0, 'nothing marked, nothing rolled');
const lay = roll(tree, Object.fromEntries(ls.map((l) => [l.id, l.type === 'installer-layout'])), inp, rng).data['installer-layout'];
check(JSON.stringify(normalizeLayout(lay)) === JSON.stringify(lay), 'rolled layout stays valid');
for (let i = 0; i < 50; i++) { const g = roll(tree, onlyGauge, inp, rng).data.gauge; check(g.thickness >= 4 && g.thickness <= 16 && g.ticks >= 0 && g.ticks <= 10 && ['arc', 'ring', 'bar', 'digital'].includes(g.shape), 'rolled gauge within the type rules'); }

// light and dark themes on offer
check(assets['color-theme'].filter((a) => a.data.scheme === 'light').length >= 3 && assets['color-theme'].filter((a) => a.data.scheme === 'dark').length >= 3, 'at least three light and three dark colour themes');

// saved document
const d = parseDoc({ layout: { variant: 'focus', logLines: 99 }, marks: { a: true, b: 'x' }, custom: { gauge: { shape: 'ring' }, evil: { x: 1 } } });
check(d.layout.variant === 'focus' && d.layout.logLines === 12 && d.marks.a === true && !('b' in d.marks) && d.custom.gauge && !('evil' in d.custom), 'document parsing keeps only known, valid fields');
check(parseDoc(null).treeOpen === true, 'tree column open by default');
console.log(`look-check: ${ok} checks passed`);
