/**
 * Banner strip (react/bannerStrip.ts, web only): the strip ⇄ host messages and the strip → app channel parse what they
 * should and drop the rest, the strip's address is an embed@1 view page every app reads back the same way, and a page
 * mode never skips a banner plugin (so the strip holds every banner the app has).
 *   npx -y tsx framework/spec/check-banner-strip.mts
 */
import assert from 'node:assert/strict';
import { BANNER_STRIP_LIMITS, BANNER_STRIP_MESSAGE, BANNER_STRIP_PAGE, BANNER_STRIP_VIEW, bannerStripUrl, parseBannerStripChannel, parseBannerStripMessage } from '../react/bannerStrip';
import { detectEmbedFull, embedPageView, embedSkipReason } from '../core/engines/embed';

let checks = 0;
const eq = (a: unknown, b: unknown, msg: string) => { assert.deepEqual(a, b, msg); checks++; };
const M = BANNER_STRIP_MESSAGE;

// ---- strip ⇄ host ----
eq(parseBannerStripMessage({ $axf: M, type: 'size', height: 120.4, overlay: true }), { $axf: M, type: 'size', height: 120, overlay: true }, 'size rounds');
eq(parseBannerStripMessage({ $axf: M, type: 'size', height: -5 }), { $axf: M, type: 'size', height: 0, overlay: false }, 'size floors at 0, overlay only when true');
eq(parseBannerStripMessage({ $axf: M, type: 'size', height: 'x' }), null, 'size needs a number');
eq(parseBannerStripMessage({ $axf: M, type: 'size', height: 1e9, overlay: 1 }), { $axf: M, type: 'size', height: BANNER_STRIP_LIMITS.px, overlay: false }, 'size capped');
eq(parseBannerStripMessage({ $axf: M, type: 'open', view: 'build-manager' }), { $axf: M, type: 'open', view: 'build-manager' }, 'open');
eq(parseBannerStripMessage({ $axf: M, type: 'open', view: '<script>' }), null, 'open: bad view');
eq(parseBannerStripMessage({ $axf: M, type: 'inset', top: 40, left: 0, width: 800 }), { $axf: M, type: 'inset', top: 40, left: 0, width: 800 }, 'inset');
eq(parseBannerStripMessage({ $axf: M, type: 'inset', top: 40 }), null, 'inset needs all three');
eq(parseBannerStripMessage({ $axf: M, type: 'set-hidden', id: 'push-banner', hidden: true }), { $axf: M, type: 'set-hidden', id: 'push-banner', hidden: true }, 'set-hidden');
eq(parseBannerStripMessage({ $axf: M, type: 'set-hidden', id: 'a b' }), null, 'set-hidden: bad id');
eq(parseBannerStripMessage({ $axf: M, type: 'banners-request' }), { $axf: M, type: 'banners-request' }, 'banners-request');
eq(parseBannerStripMessage({ $axf: 'embed@1', type: 'size', height: 1 }), null, 'other envelope');
eq(parseBannerStripMessage({ $axf: M, type: 'run', id: 'x' }), null, 'unknown type');
eq(parseBannerStripMessage('{"$axf":"banner-strip@1"}'), null, 'text is not a message');
eq(parseBannerStripMessage({ $axf: M, type: 'banners', banners: [
  { id: 'systems-check', label: 'Systems check', icon: 'shield', hidden: false },
  { id: 'systems-check', label: 'dup' },
  { id: 'push-banner', label: '  Branches\u0000 not on main ', hidden: true },
  { id: 'bad id' }, 'x', { id: 'activity' },
] }), { $axf: M, type: 'banners', banners: [
  { id: 'systems-check', label: 'Systems check', icon: 'shield', hidden: false },
  { id: 'push-banner', label: 'Branches  not on main', hidden: true },
  { id: 'activity', label: 'activity', hidden: false },
] }, 'banners: cleaned, deduped, label falls back to id');
eq((parseBannerStripMessage({ $axf: M, type: 'banners', banners: Array.from({ length: 200 }, (_, i) => ({ id: `b${i}` })) }) as { banners: unknown[] }).banners.length, BANNER_STRIP_LIMITS.banners, 'banners capped');

// ---- strip → app channel ----
eq(parseBannerStripChannel({ type: 'navigate', view: 'settings', tab: 'push-banner', n: 3 }), { type: 'navigate', view: 'settings', tab: 'push-banner', n: 3 }, 'navigate with tab');
eq(parseBannerStripChannel({ type: 'navigate', view: 'builds', tab: 'a b', n: 1 }), { type: 'navigate', view: 'builds', n: 1 }, 'navigate: bad tab dropped');
eq(parseBannerStripChannel({ type: 'navigate', view: 'builds' }), null, 'navigate needs n');
eq(parseBannerStripChannel({ type: 'ack', n: 3 }), { type: 'ack', n: 3 }, 'ack');
eq(parseBannerStripChannel({ type: 'hello' }), { type: 'hello' }, 'hello');
eq(parseBannerStripChannel({ type: 'run' }), null, 'unknown channel type');

// ---- the address ----
eq(BANNER_STRIP_PAGE, `view:${BANNER_STRIP_VIEW}`, 'page names the view');
const url = bannerStripUrl('https://console.amberxai.com', 'molly');
const e = detectEmbedFull(new URL(url).search, '');
eq(e?.host, 'molly', 'host read back');
eq(e?.page, BANNER_STRIP_PAGE, 'page read back');
eq(embedPageView(e?.page), BANNER_STRIP_VIEW, 'AppShell picks the strip view');
eq(e?.hidden.includes('banner'), true, 'a page hides the app chrome (the strip draws the banners itself)');
eq(embedSkipReason(e, ['hidden:banner']), null, 'banner plugins (bell, Claude badge) still load in the strip');
eq(embedSkipReason(e, ['embedded']), null, 'nothing is skipped in a page');

console.log(`✓ banner strip — ${checks} checks`);
