/**
 * grid-columns@1 checks (libs/datagrid/columns.ts): every grid's column visibility — fixed columns never hide,
 * default-hidden columns start hidden, saved changes survive a column added later, toggle / show all / reset, and
 * grids + columns named loosely for voice ("the cost column in Build manager").
 * Run: npx -y tsx framework/spec/check-grid-columns.mts
 */
import { columnsChanged, gridColumnsKey, hiddenColumns, matchByName, normalizeColumnChanges, setColumn, showAllColumns } from '../libs/datagrid/columns';

let fails = 0, passes = 0;
const eq = (name: string, got: unknown, want: unknown) => {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a === b) { passes++; console.log(`✓ ${name}`); } else { fails++; console.log(`✗ ${name}\n    want ${b}\n    got  ${a}`); }
};

const cols = [
  { id: 'title', label: 'Title', fixed: true },
  { id: 'status', label: 'Status' },
  { id: 'cost', label: 'Cost' },
  { id: 'notes', label: 'Notes', hidden: true },
];

eq('key', gridColumnsKey('build-manager'), 'axf.grid.build-manager.columns');
eq('defaults: default-hidden column hidden', hiddenColumns(cols, null), ['notes']);
eq('defaults + extra hidden from the app', hiddenColumns(cols, undefined, ['cost']), ['cost', 'notes']);
eq('junk saved value ignored', hiddenColumns(cols, 'nope'), ['notes']);
eq('normalize: last change per column wins, junk dropped', normalizeColumnChanges(['-cost', 7, 'x', '+cost', '-status']), ['+cost', '-status']);

let s = setColumn(cols, null, 'cost', false);
eq('hide cost saves -cost', s, ['-cost']);
eq('… and cost is hidden', hiddenColumns(cols, s), ['cost', 'notes']);
s = setColumn(cols, s, 'notes', true);
eq('show a default-hidden column saves +notes', s, ['-cost', '+notes']);
eq('… and only cost is hidden', hiddenColumns(cols, s), ['cost']);
s = setColumn(cols, s, 'cost');
eq('toggle cost back drops the change', s, ['+notes']);
eq('fixed column never hides', setColumn(cols, s, 'title', false), ['+notes']);
eq('unknown column changes nothing', setColumn(cols, s, 'nope', false), ['+notes']);
eq('saved -title cannot hide a fixed column', hiddenColumns(cols, ['-title']), ['notes']);

const later = [...cols, { id: 'model', label: 'Model', hidden: true }];
eq('a column added later starts as declared', hiddenColumns(later, ['-cost', '+notes']), ['cost', 'model']);

eq('show all', hiddenColumns(cols, showAllColumns(cols)), []);
eq('show all with app extras', hiddenColumns(cols, showAllColumns(cols, ['cost']), ['cost']), []);
eq('changed?', [columnsChanged(null), columnsChanged([]), columnsChanged(['-cost'])], [false, false, true]);

const grids = [{ id: 'build-manager', label: 'Build manager' }, { id: 'builds.steps', label: 'Steps' }, { id: 'builds.builds', label: 'Builds' }];
eq('grid by id', matchByName(grids, 'build-manager')?.id, 'build-manager');
eq('grid by label', matchByName(grids, 'Build manager')?.id, 'build-manager');
eq('grid by loose words', matchByName(grids, 'the build manager grid')?.id, 'build-manager');
eq('whole word beats a prefix', matchByName(grids, 'build')?.id, 'build-manager');
eq('a tie → nothing', matchByName(grids, 'ui'), null);
eq('column by words', matchByName(cols, 'the cost column')?.id, 'cost');
eq('no match', matchByName(cols, 'colour'), null);

console.log(`\n${passes} passed, ${fails} failed`);
if (fails) process.exit(1);
