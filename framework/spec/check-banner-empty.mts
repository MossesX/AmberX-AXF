/*
 * All banners hide when empty (react/bannerEmpty.ts, components/BannerBase.tsx): an empty banner is not drawn, it
 * appears when an entry arrives and hides again when the last one is cleared. Also checks the framework's banner frame,
 * the banner strip and the banner group all use the rule, and every baked copy of the framework carries it.
 * Run: npx -y tsx framework/spec/check-banner-empty.mts
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BANNER_EMPTY_ATTR, bannerEntryCount, bannerFrameEmpty, bannerNodeEmpty, type BannerNodeLike } from '../react/bannerEmpty';

let n = 0;
const fails: string[] = [];
const eq = (name: string, got: unknown, want: unknown) => { n++; if (JSON.stringify(got) !== JSON.stringify(want)) fails.push(`${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); };

/* ---- a tiny DOM: enough for the rule ---- */
type El = BannerNodeLike & { childNodes: BannerNodeLike[]; attrs: Record<string, string> };
const text = (s: string): BannerNodeLike => ({ nodeType: 3, nodeValue: s });
const el = (tag: string, attrs: Record<string, string> = {}, ...kids: BannerNodeLike[]): El => ({
  nodeType: 1, tagName: tag.toUpperCase(), hidden: 'hidden' in attrs, attrs, childNodes: kids,
  getAttribute(k: string) { return k in this.attrs ? this.attrs[k]! : null; },
});
const comment: BannerNodeLike = { nodeType: 8, nodeValue: 'x' };

/* the rule */
eq('nothing', bannerNodeEmpty(null), true);
eq('blank text', bannerNodeEmpty(text('  \n ')), true);
eq('text', bannerNodeEmpty(text('1 approval waiting')), false);
eq('comment', bannerNodeEmpty(comment), true);
eq('empty div', bannerNodeEmpty(el('div')), true);
eq('shell: title bar with only an icon', bannerNodeEmpty(el('div', { class: 'x-banner' }, el('span', {}, el('svg')), el('ul'))), true);
eq('shell: aria-hidden decoration', bannerNodeEmpty(el('div', {}, el('span', { 'aria-hidden': 'true' }, text('•')))), true);
eq('row with text', bannerNodeEmpty(el('div', {}, el('ul', {}, el('li', {}, text('Build failed'))))), false);
eq('icon-only button counts', bannerNodeEmpty(el('div', {}, el('button', {}, el('svg')))), false);
eq('hidden input does not', bannerNodeEmpty(el('div', {}, el('input', { type: 'hidden' }))), true);
eq('iframe counts (a host strip)', bannerNodeEmpty(el('div', {}, el('iframe'))), false);
eq('hidden element', bannerNodeEmpty(el('div', { hidden: '' }, text('stale'))), true);
eq('marked empty on purpose', bannerNodeEmpty(el('div', { [BANNER_EMPTY_ATTR]: 'on' }, text('No items'))), true);
eq('style tag only', bannerNodeEmpty(el('div', {}, el('style', {}, text('.a{}')))), true);

/* a banner frame over its life: empty → entry arrives → cleared */
const list = el('ul');
const shell = el('div', { class: 'axp-x-banner' }, el('span', {}, el('svg')), list);
const frame = el('div', { class: 'fx-banner-frame', hidden: '' }, shell);
eq('frame: empty banner is not drawn', bannerFrameEmpty(frame), true);
list.childNodes.push(el('li', {}, text('Deploy waiting')));
eq('frame: appears when an entry arrives (own hidden ignored)', bannerFrameEmpty(frame), false);
list.childNodes.length = 0;
eq('frame: hides when cleared', bannerFrameEmpty(frame), true);
eq('frame: banner that drew nothing', bannerFrameEmpty(el('div', { class: 'fx-banner-frame' })), true);

/* BannerBase's entries */
eq('entries: none', bannerEntryCount(undefined), 0);
eq('entries: false', bannerEntryCount(false), 0);
eq('entries: 0', bannerEntryCount(0), 0);
eq('entries: NaN', bannerEntryCount(Number.NaN), 0);
eq('entries: negative', bannerEntryCount(-3), 0);
eq('entries: []', bannerEntryCount([]), 0);
eq('entries: list', bannerEntryCount(['a', 'b']), 2);
eq('entries: count', bannerEntryCount(3), 3);

/* the framework (and every baked copy) uses the rule */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const must: Array<[string, RegExp, string]> = [
  ['react/components/BannerSettings.tsx', /hidden=\{[^}]*\bempty\b[^}]*\}/, 'the banner frame hides itself while empty'],
  ['react/components/BannerSettings.tsx', /bannerFrameEmpty\(/, 'the banner frame uses the empty rule'],
  ['react/components/Slots.tsx', /bannerFrameEmpty\(/, 'the banner strip uses the empty rule'],
  ['react/components/BannerGroup.tsx', /bannerFrameEmpty\(/, 'the banner group counts only banners with content'],
  ['react/components/BannerBase.tsx', /if \(!bannerEntryCount\(entries\)\) return null;/, 'BannerBase draws nothing without entries'],
];
const roots = ['framework', ...['console-web', 'molly', 'amberx-droid', 'axhub-web'].map((a) => `apps/${a}/src/axf`)];
for (const r of roots) {
  for (const [file, re, what] of must) {
    const p = join(ROOT, r, file);
    n++;
    if (!existsSync(p)) { fails.push(`${r}/${file}: missing (${what})`); continue; }
    if (!re.test(readFileSync(p, 'utf8'))) fails.push(`${r}/${file}: ${what}`);
  }
}

if (fails.length) { console.error(`check-banner-empty: ${fails.length} of ${n} failed\n  ${fails.join('\n  ')}`); process.exit(1); }
console.log(`check-banner-empty: ${n} checks pass`);
