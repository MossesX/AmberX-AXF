/** Self-test of web/core.ts: npx -y tsx apps/console-web/plugins/changes-grid/web/core-check.mts (prints JSON last). */
import { buildRows, changeRow, counts, featureAt, featureRow, formatWhen, statusTone } from './core';
import type { ChangeSummary, FeatureLike } from './core';

const out: [string, boolean][] = [];
const check = (name: string, ok: boolean) => out.push([name, ok]);

const changes: ChangeSummary[] = [
  { id: 'chg-20261025-aaaaaa', createdAt: '2026-10-25T16:31:00Z', kind: 'build', title: 'Add changes grid', state: 'running', repos: ['MossesX/AmberX-AXF'], model: 'opus' },
  { id: 'chg-20261020-bbbbbb', createdAt: '2026-10-20T08:05:00Z', kind: 'fix', title: '', asked: 'fix the banner', state: 'done', result: { state: 'failed', summary: 'broke' } },
];
const features: FeatureLike[] = [
  { id: 'x.one', title: 'One', status: 'built', history: [{ at: '2026-10-01', text: 'a' }, { at: '2026-10-22T10:00:00Z', text: 'b' }] },
  { id: 'x.two', title: 'Two', status: 'planned', history: [] },
];

const r0 = changeRow(changes[0]!);
check('change row titled with the request name', r0.title === 'Add changes grid' && r0.source === 'change' && r0.area === 'MossesX/AmberX-AXF');
check('untitled change falls back to what was asked', changeRow(changes[1]!).title === 'fix the banner');
check('result state wins over entry state', changeRow(changes[1]!).status === 'failed');
check('feature date = newest history entry', featureAt(features[0]!) === '2026-10-22T10:00:00Z' && featureAt(features[1]!) === '');
check('feature row', featureRow(features[0]!).title === 'One' && featureRow(features[0]!).status === 'built');
const all = buildRows(changes, features);
check('newest first, undated last', all.map((r) => r.refId).join() === 'chg-20261025-aaaaaa,x.one,chg-20261020-bbbbbb,x.two');
check('oldest first keeps undated last', buildRows(changes, features, { sort: 'oldest' }).map((r) => r.refId).join() === 'chg-20261020-bbbbbb,x.one,chg-20261025-aaaaaa,x.two');
check('title sort', buildRows(changes, features, { sort: 'title' })[0]?.title === 'Add changes grid');
check('changes only', buildRows(changes, features, { show: 'changes' }).every((r) => r.source === 'change'));
check('features only', buildRows(changes, features, { show: 'features' }).length === 2);
check('search', buildRows(changes, features, { q: 'BANNER' }).map((r) => r.refId).join() === 'chg-20261020-bbbbbb');
check('counts', JSON.stringify(counts(all)) === '{"changes":2,"features":2}');
check('bad input skipped', buildRows([{ id: '' } as never, null as never], [null as never]).length === 0);
check('date and time', formatWhen('2026-10-25T16:31:00Z', true) === 'Oct 25 2026, 16:31');
check('date only', formatWhen('2026-10-01', true) === 'Oct 1 2026');
check('missing / bad date', formatWhen('') === 'no date' && formatWhen('nope') === 'no date');
check('tones', statusTone('built') === 'success' && statusTone('failed') === 'danger' && statusTone('running') === 'accent' && statusTone('planned') === undefined);

for (const [n, ok] of out) console.log(`  ${ok ? '✓' : '✗'} ${n}`);
console.log(JSON.stringify({ total: out.length, failed: out.filter(([, ok]) => !ok).map(([n]) => n) }));
