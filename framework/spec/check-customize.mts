/** Customize engine (core/engines/customize.ts) + tab-group asset: tokens, 100 icon sets, apply-to-all, CSS. Run: npx -y tsx framework/spec/check-customize.mts */
import { CUSTOM_TARGETS, CUSTOM_TOKENS, ICON_SETS, customizableTypes, customTokensFor, customizeCss, customizeSheet, customEditable, effectiveCustom, normalizeCustomSlot, normalizeCustomValues, setApplyAll, setCustomToken } from '../core/engines/customize';
import { normalizeTabGroup, tabGroupStyle } from '../core/engines/components';
import { hideable } from '../core/engines/hide';
import { ASSET_TYPES } from '../core/types';
import { validateAsset } from '../core/validate';
import { readdirSync, readFileSync } from 'node:fs';

let n = 0, bad = 0;
const ok = (c: unknown, m: string) => { n++; if (!c) { bad++; console.error('✗', m); } };

ok(ICON_SETS.length === 100, '100 icon sets');
ok(new Set(ICON_SETS.map((s) => s.id)).size === 100, 'icon set ids unique');
ok(CUSTOM_TOKENS.length >= 30, '30+ tokens');
ok(customizableTypes().every((t) => (ASSET_TYPES as readonly string[]).includes(t)), 'targets are asset types');
ok(customizableTypes().includes('tab-group') && hideable('tab-group'), 'tab-group customizable + hideable');
ok(customTokensFor('toolbar').some((t) => t.key === 'location') && !customTokensFor('button').some((t) => t.key === 'location'), 'location only for chrome');
ok(customTokensFor('uac-policy').length === 0, 'policy not customizable');
ok(JSON.stringify(normalizeCustomValues({ fontSize: 333, textColor: 'accent', bogus: 1, italic: 'x', iconSet: 'nope', showIcons: true })) === JSON.stringify({ fontSize: 200, textColor: 'accent' }), 'normalize clamps, drops unknown/invalid/defaults');
ok(normalizeCustomSlot(undefined).all === true, 'apply to all defaults on');
const ids = ['a', 'b', 'c'];
let slot = normalizeCustomSlot({});
ok(customEditable(slot, ids, 'a') && !customEditable(slot, ids, 'b'), 'only first editable while all');
slot = setCustomToken(slot, 'a', 'fontSize', 120);
ok(effectiveCustom(slot, 'c').fontSize === 120, 'shared values apply to every asset');
slot = setApplyAll(slot, ids, false);
ok(customEditable(slot, ids, 'b') && effectiveCustom(slot, 'b').fontSize === 120, 'untick: all editable, values copied');
slot = setCustomToken(slot, 'b', 'fontSize', 90);
ok(effectiveCustom(slot, 'a').fontSize === 120 && effectiveCustom(slot, 'b').fontSize === 90, 'per-asset values');
slot = setApplyAll(slot, ids, true);
ok(effectiveCustom(slot, 'b').fontSize === 120, 're-tick takes the first asset');
ok(customizeCss('toolbar', {}) === '', 'no values, no css');
const css = customizeCss('toolbar', { fontSize: 120, textColor: 'accent', iconSet: 'badge-bold', hover: 'lift', click: 'press', location: 'pinned-top', animation: 'fade' });
for (const frag of ['.fx-toolbar', 'var(--fx-accent)', '.fx-toolbtn:hover', ':active', '.fx-icon', 'position:sticky', 'axf-cu-fade', 'stroke-width:2.7']) ok(css.includes(frag), `css has ${frag}`);
ok(!/#[0-9a-f]{3,6}\b|rgb\(/i.test(customizeSheet({ toolbar: { background: 'surface2', hover: 'glow' }, 'tab-group': { iconSet: 'duotone-thin' } })), 'no hard-coded colours');
// text children (customize.json targets[].text, build skins-restyle-everything): the type's text parts reach them, all but the size
const banner = customizeCss('banner', { fontWeight: '300', fontFamily: 'mono', textColor: 'accent', fontSize: 120 });
ok(banner.includes(':root body .fx-banner .fx-banner__logo{font-weight:300;font-family:var(--fx-font-mono);color:var(--fx-accent)}'), 'banner text parts reach the logo, size left to its own step');
ok(banner.includes(':root body .fx-banner .fx-banner__item{font-weight:300;font-family:var(--fx-font-mono);color:var(--fx-accent);font-size:calc(var(--fx-font-size) * 1.2)}'), 'items still take every text part');
ok(!customizeCss('banner', { fontSize: 120 }).includes('.fx-banner__logo'), 'size alone writes nothing on a text child');
ok(!customizeCss('banner', { radius: 'sm', hover: 'lift', background: 'surface2' }).includes('.fx-banner__logo'), 'box and hover parts never touch a text child');
const nav = customizeCss('nav-menu', { textTransform: 'uppercase', letterSpacing: 'tight' });
ok(nav.includes(':root body .fx-nav .fx-nav__header, :root body .fx-nav .fx-nav__label{text-transform:uppercase;letter-spacing:-0.02em}'), 'nav headers and labels follow the nav text parts');
ok(customizeCss('container', { textColor: 'text' }).includes('.fx-card .fx-card__head{color:var(--fx-text)}'), 'card headers follow the container text colour');
ok(customizeCss('counter', { fontWeight: '600' }).includes('.fx-widget-counter .fx-widget-counter__num, :root body .fx-widget-counter .fx-widget-counter__label{font-weight:600}'), 'counter number and label follow the counter weight');
ok(customizeCss('meter', { textColor: 'accent' }).split('\n').length === 1, 'a target without text children writes one rule');
ok(customizeSheet({}) === '' && customizeSheet({ banner: {}, 'nav-menu': {} }) === '', 'no parts (the default look) = an empty sheet, before and after text children');
for (const [type, t] of Object.entries(CUSTOM_TARGETS)) if (t.text) for (const sel of t.text.split(',').map((s) => s.trim())) ok(t.root.split(',').some((r) => sel.startsWith(r.trim().replace(/^\.(fx-[a-z-]+).*$/, '.$1'))) || type === 'tab-group', `${type}: text child ${sel} is an element of the root block`);
for (const s of ICON_SETS.filter((x) => x.id !== 'outline-regular')) ok(customizeCss('button', { iconSet: s.id }).includes('stroke-width'), `icon set ${s.id} compiles`);
ok(tabGroupStyle(null).attrs['data-fx-tabs'] === 'underline', 'missing tab-group = underline');
ok(normalizeTabGroup({ style: 'x' as never, align: 'center' }).align === 'center', 'tab-group normalize');
ok(tabGroupStyle({ style: 'pills', align: 'start' }, true).attrs['data-fx-tabs-hidden'] === 'on', 'hidden attr');
const dir = new URL('../assets/tab-group/', import.meta.url);
for (const f of readdirSync(dir)) {
  const r = validateAsset(JSON.parse(readFileSync(new URL(f, dir), 'utf8')));
  ok(r.ok, `starter ${f} valid ${JSON.stringify((r as { errors?: unknown }).errors ?? '')}`);
}
console.log(bad ? `✗ ${bad}/${n} failed` : `✓ ${n} checks`);
process.exit(bad ? 1 : 0);
