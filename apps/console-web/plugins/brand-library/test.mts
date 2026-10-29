// @ts-nocheck: a Node test, not part of the console's build
/**
 * Self-test for the Brand library's web model (filters, facets, the virtual grid window, deriving a brand) against
 * the real framework/brand-library. Run: npx -y tsx apps/console-web/plugins/brand-library/test.mts
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brandingErrors } from '../../../../framework/core/engines/brand.ts';
import { DERIVED_PREFIX, TABS, brandingRefs, cleanConfig, deriveBranding, facetValues, filterItems, gridWindow, roleOf, type LibAsset } from './web/model.ts';

const LIB = fileURLToPath(new URL('../../../../framework/brand-library/', import.meta.url));
const load = (t: string): LibAsset[] => readdirSync(join(LIB, t)).filter((f) => f.endsWith('.json')).map((f) => {
  const a = JSON.parse(readFileSync(join(LIB, t, f), 'utf8')) as LibAsset;
  const d = a.data as Record<string, unknown>;
  const brand = typeof d.brand === 'string' ? d.brand : (d.brand as { name?: string } | undefined)?.name ?? (a.id.startsWith('gizmox') ? 'GizmoX' : a.id.startsWith('amberx') ? 'AmberX' : '');
  return { ...a, facets: { brand, form: String(d.form ?? ''), preset: String(d.preset ?? ''), style: String(d.style ?? '') } };
});
let ok = 0;
const check = (c: boolean, m: string) => { if (!c) { console.error(`FAIL: ${m}`); process.exit(1); } ok++; console.log(`  ✓ ${m}`); };

const logos = load('logo-mark'); const anims = load('animated-logo'); const packs = load('icon-pack'); const brands = load('branding');
check(TABS.length === 4 && TABS.map((t) => t.type).join() === 'logo-mark,animated-logo,icon-pack,branding', 'four tabs: Logos · Animated logos · Icon packs · Branding packages');
check(facetValues(logos, 'brand').join() === 'AmberX,GizmoX', 'brand facet = AmberX, GizmoX');
const giz = filterItems(logos, 'logo-mark', { q: '', brand: 'GizmoX', facet: '' });
check(giz.length > 0 && giz.every((a) => a.facets?.brand === 'GizmoX'), 'brand filter keeps only that brand');
const locks = filterItems(logos, 'logo-mark', { q: '', brand: '', facet: 'lockup' });
check(locks.length > 0 && locks.every((a) => a.data.form === 'lockup'), 'form filter keeps only lockups');
const word = logos[0]!.name.split(' ').slice(-1)[0]!.toLowerCase();
check(filterItems(logos, 'logo-mark', { q: word, brand: '', facet: '' }).every((a) => `${a.name} ${a.id} ${(a.tags ?? []).join(' ')} ${a.description}`.toLowerCase().includes(word)), 'search matches name / id / tags / description');
check(filterItems(logos, 'logo-mark', { q: 'zzzz-nothing', brand: '', facet: '' }).length === 0, 'a search with no match is empty');
check(filterItems(anims, 'animated-logo', { q: '', brand: '', facet: 'spin' }).every((a) => a.data.preset === 'spin'), 'motion filter on animated logos');

const w = gridWindow({ count: 250, width: 800, tile: 120, gap: 8, scrollTop: 0, height: 400, rowHeight: 128 });
check(w.cols === 6 && w.rows === 42 && w.start === 0 && w.end <= 6 * 6, 'window: 6 columns, 42 rows, only the first rows drawn');
const w2 = gridWindow({ count: 250, width: 800, tile: 120, gap: 8, scrollTop: 128 * 20, height: 400, rowHeight: 128 });
check(w2.first === 18 && w2.start === 108 && w2.end - w2.start <= 8 * 6, 'scrolled window draws rows 18… with two rows of overscan');
check(gridWindow({ count: 3, width: 10, tile: 120, gap: 8, scrollTop: 0, height: 0, rowHeight: 128 }).cols === 1, 'never fewer than one column');

const base = brands[0]!;
const lock = logos.find((a) => a.data.form === 'lockup')!;
const d1 = deriveBranding(base, lock);
check(d1.id.startsWith(DERIVED_PREFIX) && (d1.data.marks as Record<string, string>).lockup === lock.id, 'a lockup goes into the brand as its lockup');
check((d1.data.marks as Record<string, string>).mark === (base.data.marks as Record<string, string>).mark, 'the rest of the brand is kept');
check(brandingErrors(d1.data).length === 0, 'a derived brand passes the branding engine');
const d2 = deriveBranding(d1, packs[3]!);
check(d2.data.iconPack === packs[3]!.id && d2.id !== d1.id, 'an icon pack becomes the brand\'s pack, with a new id');
check(deriveBranding(base, lock).id === d1.id, 'derived ids are stable');
const d3 = deriveBranding(base, anims[5]!);
check((d3.data.marks as Record<string, string>).animated === anims[5]!.id && roleOf(anims[5]!) === 'animated', 'an animated logo becomes the animated mark');
check(deriveBranding(base, base) === base, 'a branding package is applied as is');
check(!/· with .* · with /.test(d2.name), 'derived names don\'t stack');
check(brandingRefs(base).length >= 4, 'refs list marks + animated + pack');
check(cleanConfig({ tab: 'nope', tile: 'xl', names: 'yes' }).tab === 'logos' && cleanConfig(null).tile === 'md', 'config cleaning falls back to defaults');
console.log(`all ${ok} checks passed`);
