/**
 * AshesUI pure part: components, owners (which plugin drew it, and which model built that plugin), contrast,
 * tooltip + parameter rows, the parameter tree, the element tree (path, filter, stats), tooltip placement, double tap.
 *
 *   npx -y tsx framework/spec/check-ashes.mts
 */
import {
  componentOf, contrast, contrastGrade, filterTree, isDoubleTap, ownersFrom, ownerText, parameterRows, parameterTree, parseColor,
  pathStep, pathTo, registerComponent, resolveOwner, selectorOf, shortLabel, tipPosition, tooltipRows, treeStats,
  type ElNode, type ElementSnap,
} from '../libs/ashes/core';

let ok = 0, fail = 0;
const check = (cond: unknown, msg: string) => { if (cond) ok++; else { fail++; console.log(`✗ ${msg}`); } };

// --- components
check(componentOf(['fx-btn', 'fx-btn--primary'])?.name === 'Button' && componentOf(['fx-btn', 'fx-btn--primary'])?.variant === 'primary', 'a button with a modifier names its variant');
check(componentOf(['fx-btn'])?.asset === 'button', 'a button is styled by the button asset type');
check(componentOf(['fx-iconbtn', 'fx-btn'])?.name === 'IconButton', 'the more specific component wins (listed first)');
check(componentOf(['my-thing']) === null, 'a plain element is no component');
registerComponent({ cls: 'axf-gizmo', name: 'Gizmo', kind: 'widget' });
check(componentOf(['axf-gizmo'])?.name === 'Gizmo', 'an app can register its own component');

// --- owners
const known = ownersFrom(
  [{ folder: 'claude', name: 'Claude', model: 'sonnet' }, { folder: 'claude-handoff', name: 'Claude handoff', id: 'ai.amberx.axf.console.claude-handoff', model: 'opus', version: '0.2.0' }],
  [{ id: 'ai.amberx.axf.settings', label: 'Settings' }, { id: 'ai.amberx.axf.console.claude-handoff', label: 'dup' }],
);
check(known.length === 3, 'a library already known as a plugin is not listed twice');
check(known.some((k) => k.kind === 'library' && k.prefix === 'axf-settings'), 'a library is known by axf-<last id part>');
let o = resolveOwner([['fx-btn'], ['axp-claude-handoff-files__row'], ['axp-claude']], known);
check(o?.name === 'Claude handoff' && o.model === 'opus' && o.via.includes('ancestor'), `the nearest owner, longest prefix first: ${JSON.stringify(o)}`);
o = resolveOwner([['axp-claude__x']], known);
check(o?.name === 'Claude' && o.model === 'sonnet' && o.via === 'class .axp-claude__x', 'a plugin by its own class, with its model');
o = resolveOwner([['fx-btn'], ['x']], known, [null, 'claude-handoff']);
check(o?.id === 'ai.amberx.axf.console.claude-handoff' && o.via.includes('data-axf-plugin'), 'data-axf-plugin names a plugin');
check(resolveOwner([['fx-btn'], ['fx-card']], known) === null, 'framework classes alone = no plugin');
check(resolveOwner([['axp-unknown']], known) === null, 'an unknown plugin prefix is no owner');
check(ownerText(null) === 'the app (no plugin)', 'no owner says so');
check(ownerText(resolveOwner([['axp-claude']], known)) === 'plugin Claude · built with sonnet', 'the owner text names the plugin and its model');

// --- colours
check(JSON.stringify(parseColor('rgb(1, 2, 3)')) === '[1,2,3,1]', 'rgb parses');
check(parseColor('rgba(1 2 3 / 50%)')?.[3] === 0.5, 'modern rgba parses');
check(JSON.stringify(parseColor('#fff')) === '[255,255,255,1]' && JSON.stringify(parseColor('#000000')) === '[0,0,0,1]', 'hex parses');
check(parseColor('nope') === null, 'garbage is null');
check(contrast('rgb(0, 0, 0)', 'rgb(255, 255, 255)') === 21, 'black on white is 21:1');
check(contrast('#777', '#777') === 1, 'same colour is 1:1');
check(contrastGrade(21) === 'AAA' && contrastGrade(5) === 'AA' && contrastGrade(3.5) === 'AA large' && contrastGrade(3.5, true) === 'AA' && contrastGrade(2) === 'fail' && contrastGrade(null) === '?', 'contrast grades');

// --- a snapshot
const snap: ElementSnap = {
  tag: 'button', id: '', classes: ['fx-btn', 'fx-btn--primary', 'axp-claude-handoff__go', 'is-on'],
  role: null, label: 'Assemble prompt', title: null, text: 'Assemble prompt',
  rect: { x: 10.4, y: 20.6, w: 120, h: 32 },
  attrs: { type: 'button', '--ashes-bg': 'rgb(255, 255, 255)' },
  style: { color: 'rgb(0, 0, 0)', 'background-color': 'rgba(0, 0, 0, 0)', 'font-size': '14px', 'font-weight': '600', 'font-family': '"Inter", sans-serif', display: 'inline-flex', margin: '0px', padding: '4px 8px' },
  inline: { width: '120px' }, tokens: { '--fx-accent': 'rgb(1, 2, 3)' },
  components: ['Button', 'Installer'], handlers: ['onClick'],
  chain: [['fx-btn', 'axp-claude-handoff__go']], pluginAttrs: [null],
  depth: 7, childCount: 1, path: ['body', 'div.fx-frame', 'button.fx-btn.fx-btn--primary:nth-of-type(2)'],
  asset: { type: 'button', id: 'soft', name: 'Soft', data: { radius: 8 } },
  owner: resolveOwner([['fx-btn', 'axp-claude-handoff__go']], known),
  focusable: true, disabled: false, hidden: false,
};
const tip = tooltipRows(snap);
const tv = (k: string) => tip.find((r) => r.key === k);
check(tv('Component')?.value === 'Button · primary' && tv('Component')?.tone === 'accent', 'the tooltip names the component');
check(tv('Belongs to')?.value === 'plugin Claude handoff · built with opus' && tv('Belongs to')?.tone === 'warning', 'the tooltip says which plugin it belongs to');
check(tv('Asset')?.value === 'button / soft', 'the tooltip names the active asset');
check(tv('Size')?.value === '120 × 32 at 10, 21', 'size and position are rounded');
check(tv('Contrast')?.value === '21:1 AAA', 'transparent background → the ancestor background is used for contrast');
check(tv('Font')?.value === '14px / 600 Inter', 'font: size / weight family');
check(tv('Handlers')?.value === 'onClick' && tv('React')?.value === 'Button ‹ Installer', 'React handlers and components');
check(tooltipRows(snap, ['size']).length === 1, 'only the switched-on fields');

const rows = parameterRows(snap);
const rv = (g: string, k: string) => rows.find((r) => r.group === g && r.key === k);
check(rv('Framework', 'Variant')?.value === 'primary' && rv('Framework', 'Styled by asset type')?.value === 'button', 'framework rows');
check(rv('Owner', 'Built with')?.value === 'opus' && rv('Owner', 'Version')?.value === '0.2.0', 'owner rows carry version and model');
check(rv('Asset data', 'radius')?.value === '8', 'asset data rows');
check(rv('Style · Layout', 'display')?.editable === 'style' || rows.some((r) => r.key === 'display' && r.editable === 'style'), 'computed styles are editable');
check(rv('Inline style', 'width')?.value === '120px', 'inline style rows');
check(rv('Attributes', 'type')?.editable === 'attr' && !rows.some((r) => r.key === '--ashes-bg'), 'attributes are editable, internal ones hidden');
check(rv('Theme tokens', '--fx-accent')?.value === 'rgb(1, 2, 3)', 'theme tokens');
check(rv('Accessibility', 'Focusable')?.value === 'yes', 'accessibility rows');

const tree = parameterTree(rows);
const style = tree.find((n) => n.label === 'Style');
check(!!style && style.children.length >= 1 && style.children.every((c) => !c.row), '"Style · X" groups nest under Style');
check(tree.find((n) => n.label === 'Owner')?.children.some((c) => c.label === 'Built with' && c.value === 'opus'), 'tree leaves carry values');

// --- labels + selectors
check(shortLabel(snap) === 'Button (primary) · button.fx-btn “Assemble prompt”', `short label: ${shortLabel(snap)}`);
check(shortLabel({ ...snap, text: 'x'.repeat(40), label: null }).endsWith('…”'), 'long text is cut');
check(selectorOf(snap) === 'body > div.fx-frame > button.fx-btn.fx-btn--primary:nth-of-type(2)', 'selector from the path');
check(selectorOf({ ...snap, id: 'go' }) === '#go' && selectorOf({ ...snap, id: '1bad id' }).startsWith('body'), 'a usable id wins');
check(pathStep('li', '', ['is-on', 'row', 'a', 'b'], 3, 5) === 'li.row.a:nth-of-type(3)' && pathStep('div', '', [], 1, 1) === 'div', 'path steps');

// --- element tree
const T: ElNode[] = [{ key: 1, label: 'div.app', children: [
  { key: 2, label: 'nav', comp: 'Nav menu', children: [{ key: 3, label: 'a home', children: [] }] },
  { key: 4, label: 'section', owner: 'Claude handoff', ownerKind: 'plugin', children: [{ key: 5, label: 'button go', comp: 'Button', owner: 'Claude handoff', ownerKind: 'plugin', children: [] }] },
] }];
check(JSON.stringify(pathTo(T, 5)) === '[1,4]' && JSON.stringify(pathTo(T, 1)) === '[]' && pathTo(T, 99) === null, 'path to a node opens its ancestors');
check(filterTree(T, '').length === 1 && filterTree(T, '')[0] === T[0], 'no filter = the tree');
const f = filterTree(T, 'home');
check(f[0]!.children.length === 1 && f[0]!.children[0]!.children[0]!.key === 3, 'search keeps matches and their ancestors');
const p = filterTree(T, '', 'plugins');
check(p[0]!.children.length === 1 && p[0]!.children[0]!.key === 4, 'plugins only');
const fw = filterTree(T, '', 'framework');
check(fw[0]!.children.map((n) => n.key).join() === '2,4' && fw[0]!.children[1]!.children[0]!.key === 5, 'framework components only');
const st = treeStats(T);
check(st.elements === 5 && st.components['Button'] === 1 && st.owners['Claude handoff'] === 2, 'stats');

// --- placement + taps
check(JSON.stringify(tipPosition(10, 10, 100, 50, 800, 600)) === '{"x":26,"y":26}', 'tooltip next to the pointer');
check(JSON.stringify(tipPosition(780, 590, 100, 50, 800, 600)) === '{"x":664,"y":524}', 'tooltip flips to stay on screen');
check(isDoubleTap({ t: 0, x: 0, y: 0 }, { t: 200, x: 5, y: 5 }) && !isDoubleTap({ t: 0, x: 0, y: 0 }, { t: 500, x: 0, y: 0 }) && !isDoubleTap({ t: 0, x: 0, y: 0 }, { t: 100, x: 80, y: 0 }) && !isDoubleTap(null, { t: 0, x: 0, y: 0 }), 'double tap: time and distance');

console.log(`ashes: ${ok} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
