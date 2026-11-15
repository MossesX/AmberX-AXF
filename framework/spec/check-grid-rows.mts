/**
 * grid-rows@1 (build every-grid-1-2-rows-per-item-set-skin): every grid shows 1 or 2 lines per item, set by the skin.
 * Replays spec/fixtures/grid-rows.json (gen-fixtures.mts) and pins the contract:
 *   - items: primary + secondary cells and a detail; junk drops out, a repeated id keeps its first row, empty cells vanish;
 *   - collapsed at 1 line: one `inline` line with primary then secondary cells, truncated; at 2: `primary` then `secondary`
 *     (one line when the item has no secondary cells), each truncated;
 *   - a tap or Enter toggles the detail, every other key and a row without a detail leave the state (same object);
 *   - the look decides the lines: the skin's own grid.rowLines, a pick per level folded hub → app → ui → plugin (child
 *     over parent), through the composed look's tokens.style override and the style theme, like every other token; the
 *     root hook data-axf-row-lines follows; no skin = 2;
 *   - resolveGridRowLines: instance → root → theme → 2;
 *   - framework/ui/axf.css carries a rule for every web class and reads only grid family tokens in them.
 * Run: npx -y tsx framework/spec/check-grid-rows.mts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GRID_ROWS_ATTR, GRID_ROWS_CLASSES, GRID_ROWS_CONTRACT, GRID_ROWS_DEFAULT_LINES, GRID_ROWS_TOGGLE_KEYS, GRID_ROWS_VAR, gridRowInput, gridRowOpen, gridRowPlan, gridRowsCollapseAll, gridRowsPlan, gridRowsRootAttrs, normalizeGridRowCell, normalizeGridRowDetail, normalizeGridRowLines, normalizeGridRows, normalizeGridRowsState, resolveGridRowLines, type GridRowItem } from '../core/engines/grid-rows';
import { GRID_ROW_LINES_ATTR, GRID_ROW_LINES_VAR, componentToken } from '../core/engines/component-tokens.mjs';
import { composeLookAt, newAppLook, normalizeSkin, pickSkin, setInheritSkin, setSkinRowLines, setUseSkin, snapshotLook } from '../core/engines/skin';
import { applyTokenOverrides, effectiveTokenOverrides } from '../core/engines/control-tokens.mjs';
import { styleThemeAttrs, styleThemeVars } from '../core/engines/theme';

const root = new URL('../', import.meta.url).pathname;
let n = 0;
const ok = (c: unknown, m: string) => { assert.ok(c, m); n++; };
const eq = (a: unknown, b: unknown, m: string) => { assert.deepEqual(a, b, m); n++; };
const json = <T>(v: T): T => JSON.parse(JSON.stringify(v));

const fx = JSON.parse(readFileSync(join(root, 'spec/fixtures/grid-rows.json'), 'utf8'));
eq(fx.contract, GRID_ROWS_CONTRACT, 'contract id');
eq([fx.var, fx.attr, fx.toggleKeys, fx.classes], [GRID_ROW_LINES_VAR, GRID_ROW_LINES_ATTR, ['Enter'], GRID_ROWS_CLASSES], 'the variable, the root hook, the toggle keys and the web classes are the component-tokens@1 ones');
eq([GRID_ROWS_VAR, GRID_ROWS_ATTR], [GRID_ROW_LINES_VAR, GRID_ROW_LINES_ATTR], 'the engine re-exports the token\'s variable and hook');
eq(componentToken('grid', 'rowLines')?.default, String(GRID_ROWS_DEFAULT_LINES), 'the default is the token\'s default (2)');

/* ---- items ---- */
const items: GridRowItem[] = normalizeGridRows(fx.raw);
eq(json(items), fx.items, 'items = fixture');
eq(items.map((i) => i.id), ['inv-1042', 'inv-1043', 'inv-1044'], 'junk, a repeated id and an item without cells drop out');
eq(items[0]!.secondary[1], { key: 'amount', text: '$1,250.00', title: 'USD 1,250.00' }, 'a cell keeps its key and title');
eq(items[1]!.secondary.map((c) => c.text), ['Globex', 'Due 2 Dec', '480'], 'a number is a cell');
eq(items[1]!.detail, null, 'no detail = null');
eq(items[2]!.detail, { text: 'Paid in full.' }, 'a string detail is text');
eq(items[0]!.detail?.fields, [{ label: 'Owner', value: 'Priya' }, { label: 'Status', value: 'Overdue' }], 'fields from a label → value map');
eq(normalizeGridRowCell('   ', 0), null, 'an empty cell is not a cell');
eq(normalizeGridRowCell({ key: 'bad key!', text: 'y' }, 3), { key: 'c3', text: 'y' }, 'a bad key gets the positional one');
eq(json(fx.normalize.cells.map((c: { in: unknown }, i: number) => normalizeGridRowCell(c.in, i))), fx.normalize.cells.map((c: { out: unknown }) => c.out), 'cells = fixture');
eq(json(fx.normalize.details.map((c: { in: unknown }) => normalizeGridRowDetail(c.in))), fx.normalize.details.map((c: { out: unknown }) => c.out), 'details = fixture');
eq(normalizeGridRowDetail({ fields: { A: 'x', B: '' } }), { fields: [{ label: 'A', value: 'x' }, { label: 'B', value: '' }] }, 'an empty value is still a field; an empty label is not');

/* ---- collapsed: 1 line or 2 ---- */
const state0 = normalizeGridRowsState(null);
eq(json(gridRowsPlan(items, 1, state0)), fx.plans['1'], '1-line plans = fixture');
eq(json(gridRowsPlan(items, 2, state0)), fx.plans['2'], '2-line plans = fixture');
const one = gridRowPlan(items[0]!, 1, state0);
const two = gridRowPlan(items[0]!, 2, state0);
eq(one.collapsed.map((l) => l.role), ['inline'], '1 line: one inline line');
eq(one.collapsed[0]!.cells.map((c) => c.text), ['INV-1042', 'Acme Ltd', 'Due 30 Nov', '$1,250.00'], '1 line: primary then secondary cells');
ok(one.collapsed.every((l) => l.truncate), '1 line: truncated');
eq(two.collapsed.map((l) => l.role), ['primary', 'secondary'], '2 lines: primary, then secondary');
eq([two.collapsed[0]!.cells.map((c) => c.text), two.collapsed[1]!.cells.map((c) => c.text)], [['INV-1042', 'Acme Ltd'], ['Due 30 Nov', '$1,250.00']], '2 lines: the cells split by slot');
ok(two.collapsed.every((l) => l.truncate), '2 lines: each line truncated');
eq(gridRowPlan(items[2]!, 2, state0).collapsed.map((l) => l.role), ['primary'], 'no secondary cells: one line even at 2');
eq(gridRowPlan(items[0]!, 3 as never, state0).lines, 2, 'a bad count reads as 2');
eq([one.attrs[GRID_ROWS_ATTR], two.attrs[GRID_ROWS_ATTR], one.attrs.role, one.attrs['data-fx-row']], ['1', '2', 'row', 'inv-1042'], 'the row carries the lines hook, its role and id');
eq([one.toggles, one.open, one.attrs['aria-expanded'], one.attrs.tabindex, one.detail], [true, false, 'false', '0', null], 'a row with a detail toggles: aria-expanded + tabindex, detail hidden while closed');
const noDetail = gridRowPlan(items[1]!, 2, state0);
eq([noDetail.toggles, 'aria-expanded' in noDetail.attrs, 'tabindex' in noDetail.attrs], [false, false, false], 'a row without a detail never toggles and is not focusable as one');
eq(one.label, 'INV-1042 · Acme Ltd · Due 30 Nov · $1,250.00', 'the label reads primary then secondary');
eq(gridRowsRootAttrs(1), { [GRID_ROW_LINES_ATTR]: '1' }, 'the root hook');

/* ---- tap or Enter toggles the detail ---- */
const open = gridRowInput(state0, items[0]!, { kind: 'tap' });
eq(open, { expanded: ['inv-1042'] }, 'a tap opens');
eq(json(open), fx.inputs.tap, 'tap = fixture');
eq(gridRowInput(state0, items[0]!, { kind: 'key', key: 'Enter' }), fx.inputs.enter, 'Enter = fixture');
eq(fx.inputs.enter, { expanded: ['inv-1042'] }, 'Enter opens');
ok(gridRowInput(state0, items[0]!, { kind: 'key', key: ' ' }) === state0, 'Space leaves the state (same object)');
ok(gridRowInput(open, items[0]!, { kind: 'key', key: 'Escape' }) === open, 'Escape leaves the state (same object)');
eq(fx.inputs.space, { expanded: [] }, 'fixture: space does nothing');
eq(fx.inputs.escape, { expanded: ['inv-1042'] }, 'fixture: escape does nothing');
eq(gridRowInput(open, items[0]!, { kind: 'tap' }), { expanded: [] }, 'a second tap closes');
eq(json(gridRowInput(open, items[0]!, { kind: 'tap' })), fx.inputs.tapAgain, 'tapAgain = fixture');
ok(gridRowInput(state0, items[1]!, { kind: 'tap' }) === state0 && gridRowInput(state0, items[1]!, { kind: 'key', key: 'Enter' }) === state0, 'a row without a detail never opens');
eq(gridRowsCollapseAll(open), { expanded: [] }, 'collapse all');
const openPlan = gridRowPlan(items[0]!, 2, open);
eq([openPlan.open, openPlan.attrs['aria-expanded'], openPlan.detail], [true, 'true', items[0]!.detail], 'open: aria-expanded true and the detail shows');
eq(json(gridRowsPlan(items, 2, open)), fx.open.rows, 'open rows = fixture');
ok(gridRowOpen(open, 'inv-1042') && !gridRowOpen(open, 'inv-1043'), 'gridRowOpen reads one row');
eq(normalizeGridRowsState({ expanded: ['a', 7, '', 'a', 'b'] }), { expanded: ['a', 'b'] }, 'state: unique non-empty ids');
eq(json({ junk: normalizeGridRowsState({ expanded: ['a', 7, '', 'a', 'b'] }), list: normalizeGridRowsState(['x']) }), fx.inputs.state, 'state = fixture');

/* ---- the look decides: the skin's own value, the scope chain, a plugin override, the default ---- */
{
  const load = (type: string, id: string) => JSON.parse(readFileSync(join(root, 'assets', type, `${id}.json`), 'utf8')).data;
  const styleTheme = load('style-theme', 'enterprise');
  const shared = { $axf: 'appearance@1', slots: { layout: 'focus-top', 'color-theme': 'arctic-daylight', 'style-theme': 'enterprise' }, hidden: {}, settings: {} };
  const base = { layoutTheme: 'data-grid', colorTheme: 'slate-steel', styleTheme: 'enterprise', assets: {} };
  const skins = { dense: normalizeSkin({ ...base, grid: { rowLines: 1 } }), airy: normalizeSkin({ ...base, grid: { rowLines: 2 } }), plain: normalizeSkin(base) } as Record<string, ReturnType<typeof normalizeSkin>>;
  const skinOf = (id: string) => skins[id] ?? null;
  const place = { app: 'app', ui: 'home', plugin: 'notes' };
  const look0 = newAppLook('app', snapshotLook(shared as never));
  const linesAt = (look: ReturnType<typeof newAppLook>, scope?: Partial<typeof place>, doc: unknown = shared) => {
    const composed = composeLookAt(doc as never, look, skinOf, scope);
    const setting = composed.doc.settings['axf.tokens.style'] ?? null;
    const data = applyTokenOverrides('tokens.style', styleTheme, effectiveTokenOverrides(setting, 'enterprise')) as typeof styleTheme & { grid?: { rowLines?: unknown } };
    const lines = resolveGridRowLines({ theme: data.grid?.rowLines });
    return { skin: composed.skin, setting, var: styleThemeVars(data)[GRID_ROWS_VAR] ?? null, attrs: styleThemeAttrs(data), lines, rows: gridRowsPlan(items, lines, open) };
  };
  const denseOn = setUseSkin(pickSkin(look0, 'dense'), true);
  const appPick = setSkinRowLines(denseOn, 2);
  const uiPick = setSkinRowLines(appPick, 1, 'ui:home');
  const pluginOverride = setSkinRowLines(uiPick, 2, 'plugin:notes');
  const cases = {
    default: linesAt(look0),
    skinOwn1: linesAt(denseOn),
    skinOwn2: linesAt(setUseSkin(pickSkin(look0, 'airy'), true)),
    skinSaysNothing: linesAt(setUseSkin(pickSkin(look0, 'plain'), true)),
    appPick: linesAt(appPick, { app: 'app' }),
    uiPick: linesAt(uiPick, { app: 'app', ui: 'home' }),
    pluginOverride: linesAt(pluginOverride, place),
    pluginInheritsUi: linesAt(uiPick, place),
    hubWide: linesAt(setInheritSkin(look0, true), place, { ...shared, skin: { id: 'dense', overrides: {}, rowLines: 2 } }),
    hubDefault: linesAt(look0, place, { ...shared, defaultSkin: { id: 'dense' } }),
  };
  eq(json(cases), fx.look, 'the look cases = fixture');
  const lines = Object.fromEntries(Object.entries(cases).map(([k, v]) => [k, v.lines]));
  eq(lines, { default: 2, skinOwn1: 1, skinOwn2: 2, skinSaysNothing: 2, appPick: 2, uiPick: 1, pluginOverride: 2, pluginInheritsUi: 1, hubWide: 2, hubDefault: 1 }, 'default 2; the skin\'s own; app → ui → plugin, child over parent; the hub-wide pick; the hub default skin\'s own');
  eq([cases.default.setting, cases.default.var, cases.default.attrs], [null, null, { [GRID_ROW_LINES_ATTR]: '2' }], 'no skin: nothing written, the root hook says 2');
  eq([cases.skinSaysNothing.setting, cases.skinSaysNothing.var], [null, null], 'a skin without a grid block writes nothing');
  eq([cases.skinOwn1.setting, cases.skinOwn1.var, cases.skinOwn1.attrs], [{ '*': { 'grid.rowLines': 1 } }, '1', { [GRID_ROW_LINES_ATTR]: '1' }], 'the skin\'s 1 line lands as the tokens.style override, the variable and the root hook');
  eq(cases.pluginOverride.skin.rowLines, 2, 'the plugin\'s pick rides the resolved skin');
  eq(cases.uiPick.rows[0]!.collapsed.map((l) => l.role), ['inline'], 'inside the ui: 1 line');
  eq(cases.pluginOverride.rows[0]!.collapsed.map((l) => l.role), ['primary', 'secondary'], 'inside the plugin: 2 lines');
  ok(cases.skinOwn1.rows[0]!.open && cases.skinOwn1.rows[0]!.detail !== null, 'the open row keeps its detail at either count');
}

/* ---- resolve order ---- */
eq(fx.resolve.map((c: { in: Record<string, unknown> }) => resolveGridRowLines(c.in)), fx.resolve.map((c: { out: number }) => c.out), 'resolve = fixture');
eq(fx.resolve.map((c: { out: number }) => c.out), [2, 1, 2, 1, 1, 2], 'instance → root → theme → 2, a bad value skipped');
eq(Object.values(fx.normalize.lines), [1, 2, 1, 2, 2, 2, 2, 2, 2, 2], 'normalizeGridRowLines: 1 | 2 (number or digit), else 2');
eq(normalizeGridRowLines('2'), 2, 'a digit as text');

/* ---- the stylesheet ---- */
const css = readFileSync(join(root, 'ui/axf.css'), 'utf8');
for (const c of Object.values(GRID_ROWS_CLASSES)) ok(css.includes(`.${c}`), `axf.css styles .${c}`);
for (const mod of ['fx-rows__line--secondary', 'fx-rows__line--inline', 'fx-rows__cell--secondary']) ok(css.includes(`.${mod}`), `axf.css styles .${mod}`);
const block = css.slice(css.indexOf('/* grid-rows@1'), css.indexOf('/* ---------------- misc'));
ok(block.length > 200 && !/#[0-9a-fA-F]{3,8}\b|\b\d+px\b/.test(block.replace(/calc\([^)]*\)/g, '')), 'the fx-rows rules carry no literal colour or px');
ok(!/var\(--fx-(?!grid-|border-w\b|dens-|type-|space\b)[a-z0-9-]+\)/.test(block), 'the fx-rows rules read only grid family tokens (plus the border width, density and type scale)');
ok(css.includes('--fx-grid-row-lines: 2;') && css.includes('--fx-grid-secondary-text: var(--fx-muted);'), ':root carries the rowLines and secondaryText defaults');

console.log(`check-grid-rows: ${n} checks passed`);
