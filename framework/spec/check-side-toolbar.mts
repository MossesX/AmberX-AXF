/**
 * A toolbar moved to a side is a column beside the content (build toolbars-moved-to-side-become-vertical, Brett,
 * Nov 16 2026: "If I move the toolbar to the left instead of the top, it needs to run down the side like a column
 * instead of pushing all the content down."). Layout toolbarPosition left / right compiles to an `auto` grid column
 * next to main, never a row: the rows above (and below) the content are exactly those of a layout without a
 * toolbar. Top / bottom stay rows. The phone falls back to the toolbar row on top. The Move menu, the control@1
 * token slot and the schemas offer the same four positions, and axf.css draws the column with tokens only.
 *   npx -y tsx framework/spec/check-side-toolbar.mts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compileLayout, layoutVars, LAYOUT_ENUMS } from '../core/engines/layout';
import { CHROME_FIELDS, CHROME_MOVES, chromeCanSwap, chromeHiddenList, normalizeInstanceOverride } from '../core/engines/chrome-settings-rules.mjs';

let n = 0;
const ok = (c: unknown, m: string) => { assert.ok(c, m); n++; };
const eq = (a: unknown, b: unknown, m: string) => { assert.deepEqual(a, b, m); n++; };
const root = new URL('../../', import.meta.url);
const text = (p: string) => readFileSync(new URL(p, root), 'utf8');
const read = (p: string) => JSON.parse(text(p));

const rowsOf = (areas: string) => areas.match(/"[^"]*"/g)!.map((r) => r.slice(1, -1).split(' '));
const mainRow = (areas: string) => rowsOf(areas).findIndex((r) => r.includes('main'));

const bases = [
  {},
  { nav: 'right' },
  { nav: 'top' },
  { inspector: 'left' },
  { nav: 'right', inspector: 'right', showStatusbar: false },
  { showMenubar: false },
];

for (const base of bases) {
  const none = compileLayout({ ...base, showToolbar: false } as never);
  for (const side of ['left', 'right'] as const) {
    const c = compileLayout({ ...base, toolbarPosition: side } as never);
    const label = `${JSON.stringify(base)} toolbar ${side}`;
    // never adds height above (or below) the content: same rows, same row sizes, main row at the same index
    eq(c.rows, none.rows, `${label}: the grid rows equal a layout without a toolbar`);
    eq(mainRow(c.areas), mainRow(none.areas), `${label}: nothing sits between the top chrome and the content`);
    const rows = rowsOf(c.areas);
    ok(rows.every((r, i) => i === mainRow(c.areas) || !r.every((x) => x === 'toolbar')), `${label}: no toolbar row`);
    // a column hugging main on that side, sized to its content
    const cols = c.columnRegions;
    const ti = cols.indexOf('toolbar');
    const mi = cols.indexOf('main');
    ok(ti >= 0, `${label}: the toolbar has its own column`);
    eq(ti, side === 'left' ? mi - 1 : mi + 1, `${label}: the toolbar column sits right beside the content`);
    eq(c.columns.match(/minmax\([^)]*\)|\S+/g)![ti], 'auto', `${label}: the toolbar column sizes to its buttons`);
    ok(c.regions.includes('toolbar'), `${label}: the toolbar region is drawn`);
    eq(rows[mainRow(c.areas)]![ti], 'toolbar', `${label}: the content row holds the toolbar cell`);
    // the grid vars keep the content flexible and the toolbar auto
    const v = layoutVars({ ...base, toolbarPosition: side } as never);
    eq(v['--fx-grid-cols']!.match(/minmax\([^)]*\)|\S+/g)!.length, cols.length, `${label}: grid columns var has one size per column`);
    ok(v['--fx-grid-cols']!.includes('auto'), `${label}: grid columns var keeps the toolbar auto`);
    // phone: the toolbar is a row on top again
    ok(c.mobileAreas.includes('"toolbar"'), `${label}: phone falls back to a toolbar row`);
    ok(c.mobileAreas.indexOf('"toolbar"') < c.mobileAreas.indexOf('"main"'), `${label}: phone row sits above the content`);
  }
  // top / bottom stay rows
  const top = compileLayout({ ...base, toolbarPosition: 'top' } as never);
  const bottom = compileLayout({ ...base, toolbarPosition: 'bottom' } as never);
  ok(!top.columnRegions.includes('toolbar') && !bottom.columnRegions.includes('toolbar'), `${JSON.stringify(base)}: top / bottom toolbars take no column`);
  ok(rowsOf(top.areas).some((r) => r.every((x) => x === 'toolbar')), `${JSON.stringify(base)}: top toolbar is a row`);
  ok(mainRow(top.areas) > mainRow(none.areas), `${JSON.stringify(base)}: top toolbar sits above the content`);
}

/* the same four positions everywhere a toolbar can be moved */
const four = ['top', 'bottom', 'left', 'right'];
eq([...LAYOUT_ENUMS.toolbarPosition].sort(), [...four].sort(), 'layout rules: toolbarPosition top / bottom / left / right');
eq([...CHROME_MOVES.toolbar.positions].sort(), [...four].sort(), 'context menu Move ▸ (chrome.move): the four positions');
eq([...read('framework/schemas/asset-types.json').types.layout.enums.toolbarPosition].sort(), [...four].sort(), 'asset-types.json: the four positions');
const schemaEnum = JSON.stringify(read('framework/schemas/json/layout.schema.json')).match(/"toolbarPosition":\{"enum":(\[[^\]]*\])/);
ok(schemaEnum, 'layout.schema.json carries toolbarPosition');
eq([...(JSON.parse(schemaEnum![1]!) as string[])].sort(), [...four].sort(), 'layout.schema.json: the four positions');
const ctl = JSON.stringify(read('framework/schemas/control.json'));
ok(/"id":"toolbarPosition","token":"--fx-layout-toolbar-position","kind":"enum","options":\["top","bottom","left","right"\]/.test(ctl), 'control.json (REST / MCP / CLI tokens.layout): the four positions');

/* the column look is in axf.css, tokens only, with a phone fallback */
const css = text('framework/ui/axf.css');
ok(/\.fx-region--toolbar:is\(\[data-pos='left'\], \[data-pos='right'\]\) \.fx-toolbar,[\s\S]*?flex-direction: column/.test(css), 'axf.css: a side toolbar stacks its buttons');
ok(/:where\(\[data-fx-narrow\]\) \.fx-region--toolbar:is\(\[data-pos='left'\], \[data-pos='right'\]\) \.fx-toolbar \{ flex-direction: row/.test(css), 'axf.css: phone draws it as a row');
ok(/:where\(\[data-fx-medium\]\)[^{]*\.fx-toolbtn:has\(> svg\) > span:not\(\.fx-toolbtn__badge\)[^{]*\{ display: none/.test(css), 'axf.css: a side toolbar drops to icons when the window is narrow');
ok(/aria-orientation=\{orientation\}/.test(text('framework/react/components/Chrome.tsx')), 'Toolbar announces aria-orientation vertical at the side');

/* Nov 16 extras: tab groups at the side, Position everywhere, no whole-asset swap for toolbars, Hide + the hidden list */
eq([...CHROME_MOVES['tab-group'].positions].sort(), [...four].sort(), 'tab group Move ▸: the four positions');
for (const t of ['toolbar', 'tab-group'] as const) {
  const pos = CHROME_FIELDS[t].find((f) => f.key === 'position');
  eq([...(pos?.options ?? [])].sort(), [...four].sort(), `${t} settings: a Position field with the four positions`);
  ok(CHROME_FIELDS[t].some((f) => f.key === 'hidden' && f.kind === 'toggle'), `${t} settings: a Hide switch`);
}
ok(!chromeCanSwap('toolbar'), 'toolbars are never swapped as a whole asset (Change asset removed)');
ok(chromeCanSwap('tab-group') && chromeCanSwap('nav-menu'), 'other kinds keep their asset picker');
const ctx = text('framework/react/components/ChromeContext.tsx');
ok(/if \(chromeCanSwap\(type\)\) items\.push\(\{ id: `chrome-pick-/.test(ctx), 'context menu: Change … only for kinds that swap');
ok(/t\.id !== 'asset' \|\| chromeCanSwap\(type\)/.test(ctx), 'settings dialog: no Asset tab for toolbars');
ok(/'chrome\.pick'[^\n]*!chromeCanSwap\(ty\)/.test(ctx) && /'chrome\.swap'[^\n]*!chromeCanSwap\(ty\)/.test(ctx), 'chrome.pick / chrome.swap (REST, MCP, CLI, voice) refuse toolbars');
ok(/rt\.actions\.register\('chrome\.hide'/.test(ctx), 'chrome.hide action (REST, MCP, CLI, voice)');
eq(chromeHiddenList({ 'axf.chrome.tab-group.settings.tabs': { hidden: true }, 'axf.chrome.toolbar.ws-main': { hidden: true }, 'axf.chrome.tab-group.other': { style: 'pills' } }), [{ type: 'tab-group', instance: 'settings.tabs' }, { type: 'toolbar', instance: 'ws-main' }].sort((a, b) => (a.type === b.type ? 0 : a.type === 'tab-group' ? -1 : 1)), 'hidden list: every hidden tab row / toolbar instance, nothing else');
eq(normalizeInstanceOverride('tab-group', { hidden: true, position: 'left' }), { position: 'left', hidden: true }, 'tab group Hide and Position are instance settings');
ok(/:where\(:has\(> \.fx-tabs--group:is\(\[data-fx-tabs-position='left'\], \[data-fx-tabs-position='right'\]\)\)\):not\(\.fx-tabframe\) \{\s*display: grid/.test(css), 'axf.css: a row-only tab group at the side is a column beside its siblings');
ok(/\.fx-tabframe\[data-fx-tabs-position='left'\] \{ flex-direction: row; \}/.test(css), 'axf.css: a tab group with a panel sits beside it');
ok(/data-axf-tab-group-hidden/.test(text('framework/react/components/TabGroup.tsx')), 'TabGroup: a hidden row goes, its panel stays');
ok(/chromeHiddenList\(rt\.settings\.savedValues\(\)\)/.test(text('framework/libs/settings/index.tsx')), 'Settings → Appearance → Visible parts lists the hidden rows to bring back');

console.log(`check-side-toolbar: ${n} checks passed`);
