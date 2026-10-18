/* Roll engine checks on the framework's real starter assets (run by test.py through tsx, which loads the .ts engine). Prints one JSON line. */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { buildTree, leaves, rollType, readability, contrast, palette, triState, toggle, allLeafIds, PRESETS, getAt } from './web/rollEngine.ts';

const ROOT = process.argv[2];
const spec = JSON.parse(readFileSync(join(ROOT, 'framework/schemas/asset-types.json'), 'utf8')).types;
const assets = {};
for (const t of Object.keys(spec)) {
  const d = join(ROOT, 'framework/assets', t);
  assets[t] = existsSync(d) ? readdirSync(d).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(join(d, f), 'utf8'))) : [];
}
const active = Object.fromEntries(Object.entries(assets).filter(([, a]) => a.length).map(([t, a]) => [t, a[0].data]));
const tree = buildTree(spec, assets, active);
let seed = 7; const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const r = {};
r.types = tree.map((n) => n.type);
r.noUac = !r.types.includes('uac-policy');
const color = tree.find((n) => n.type === 'color-theme');
const ids = new Set(leaves(color).map((l) => l.id));
const locked = new Set([[...ids][0]]);
const before = active['color-theme'];
const after = rollType('color-theme', tree, before, { ticked: ids, locked, rand });
const lockedLeaf = leaves(color)[0].leaf.path;
r.lockKept = JSON.stringify(getAt(after, lockedLeaf)) === JSON.stringify(getAt(before, lockedLeaf));
r.changed = leaves(color).filter((l) => JSON.stringify(getAt(after, l.leaf.path)) !== JSON.stringify(getAt(before, l.leaf.path))).length;
r.sameKeys = JSON.stringify(Object.keys(after).sort()) === JSON.stringify(Object.keys(before).sort());
r.readable = readability(after);
let worst = 99; for (let i = 0; i < 40; i++) { const p = palette(i % 2 ? 'dark' : 'light', rand); worst = Math.min(worst, contrast(p.text, p.bg)); }
r.worstTextContrast = worst;
const style = tree.find((n) => n.type === 'style-theme');
const sIds = new Set(leaves(style).map((l) => l.id));
const sb = active['style-theme']; const sa = rollType('style-theme', tree, sb, { ticked: sIds, locked: new Set(), rand });
r.numbersInRange = leaves(style).filter((l) => l.leaf.kind === 'number').every((l) => { const v = getAt(sa, l.leaf.path); return v >= l.leaf.range[0] && v <= l.leaf.range[1]; });
r.enumsValid = leaves(style).filter((l) => l.leaf.kind === 'enum').every((l) => l.leaf.enum.includes(String(getAt(sa, l.leaf.path))));
const none = rollType('style-theme', tree, sb, { ticked: new Set(), locked: new Set(), rand });
r.untickedUnchanged = JSON.stringify(none) === JSON.stringify(sb);
const t1 = toggle(color, new Set());
r.tri = [triState(color, new Set()), triState(color, t1), triState(color, new Set([[...ids][0]]))];
r.untoggle = toggle(color, t1).size === 0;
r.presetColors = PRESETS['colors only'](tree).length > 0 && PRESETS['colors only'](tree).every((id) => tree.flatMap(leaves).find((l) => l.id === id).leaf.kind === 'color');
r.presetAll = PRESETS.all(tree).length === allLeafIds(tree).length;
r.badContrastFlagged = readability({ ...before, tokens: { ...(before.tokens), text: '#777777', bg: '#808080' } }).length > 0; // theme-ok: test data
console.log(JSON.stringify(r));
