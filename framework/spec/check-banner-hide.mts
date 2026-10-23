/*
 * Banner hide state (core/engines/bannerhide.ts, Oct 23 2026): Hide, Hide all banners and the hide timer, one state for
 * every interface, last change wins. Also the plugin@1 `banner` check and embed@1 plugin tabs carrying their settings tab.
 * Run: npx -y tsx framework/spec/check-banner-hide.mts
 */
import {
  allBannersHidden, bannerHidden, hideEndsAt, minutesFrom, minutesInput, nextHideEnd, parseBannerHide, setAllBannersHidden,
  setBannerHidden, setBannerTimer, TIMER_DEFAULT,
} from '../core/engines/bannerhide';
import { parsePluginTab } from '../core/engines/embed';
// @ts-expect-error plain .mjs
import { bannerIdsInSource, checkBanner } from '../cli/plugins.mjs';

let n = 0;
const fails: string[] = [];
const eq = (name: string, got: unknown, want: unknown) => { n++; if (JSON.stringify(got) !== JSON.stringify(want)) fails.push(`${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); };

const ids = ['activity', 'build-manager', 'systems-check'];
const t0 = 1_000_000;
const MIN = 60_000;

// parsing: anything odd = nothing hidden, timer off
eq('parse null', parseBannerHide(null), { banners: {}, timer: { on: false, minutes: TIMER_DEFAULT } });
eq('parse junk', parseBannerHide({ banners: { 'Bad Id': { on: true }, ok: { on: 'yes', at: -1 } }, timer: { on: 1, minutes: 500 } }), { banners: { ok: { on: false, at: 0 } }, timer: { on: false, minutes: 99 } });
eq('parse minutes floor', parseBannerHide({ timer: { on: true, minutes: 0 } }).timer, { on: true, minutes: 1 });

// one banner
let s = parseBannerHide(null);
s = setBannerHidden(s, 'activity', true, t0);
eq('hidden', bannerHidden(s, 'activity', t0 + 1), true);
eq('others shown', bannerHidden(s, 'build-manager', t0 + 1), false);
eq('no timer = forever', hideEndsAt(s, 'activity'), Infinity);
eq('hide all off while one shown', allBannersHidden(s, ids, t0), false);

// hide all, then one switched back: the last change wins, hide all reads off
s = setAllBannersHidden(s, ids, true, t0 + 10);
eq('hide all on', allBannersHidden(s, ids, t0 + 11), true);
s = setBannerHidden(s, 'build-manager', false, t0 + 20);
eq('one shown after hide all', bannerHidden(s, 'build-manager', t0 + 21), false);
eq('hide all reads off', allBannersHidden(s, ids, t0 + 21), false);
s = setAllBannersHidden(s, ids, false, t0 + 30);
eq('show all', ids.map((id) => bannerHidden(s, id, t0 + 31)), [false, false, false]);
eq('no banners = hide all off', allBannersHidden(s, [], t0), false);

// timer: a hide lasts N minutes
s = setBannerTimer(parseBannerHide(null), { on: true, minutes: 5 }, t0);
s = setBannerHidden(s, 'activity', true, t0);
eq('timed hide ends', hideEndsAt(s, 'activity'), t0 + 5 * MIN);
eq('hidden inside the time', bannerHidden(s, 'activity', t0 + 5 * MIN - 1), true);
eq('shown after the time', bannerHidden(s, 'activity', t0 + 5 * MIN), false);
eq('next end', nextHideEnd(s, ids, t0), t0 + 5 * MIN);
eq('no next end after it', nextHideEnd(s, ids, t0 + 6 * MIN), null);
eq('hide all reads off once run out', allBannersHidden(setAllBannersHidden(s, ids, true, t0), ids, t0 + 6 * MIN), false);

// switching the timer on restarts the time of a hide that's on now (an old hide doesn't end at once)
let h = setBannerHidden(parseBannerHide(null), 'activity', true, t0);
h = setBannerTimer(h, { on: true, minutes: 10 }, t0 + 60 * MIN);
eq('timer on restarts', hideEndsAt(h, 'activity'), t0 + 70 * MIN);
eq('still hidden after timer on', bannerHidden(h, 'activity', t0 + 60 * MIN + 1), true);
h = setBannerTimer(h, { minutes: 2 }, t0 + 61 * MIN);
eq('new minutes restart', hideEndsAt(h, 'activity'), t0 + 63 * MIN);
h = setBannerTimer(h, { on: false }, t0 + 62 * MIN);
eq('timer off = until shown', hideEndsAt(h, 'activity'), Infinity);
// a run-out hide stays shown when the timer goes off
let r = setBannerTimer(parseBannerHide(null), { on: true, minutes: 1 }, t0);
r = setBannerHidden(r, 'activity', true, t0);
r = setBannerTimer(r, { on: false }, t0 + 2 * MIN);
eq('run-out hide stays shown', bannerHidden(r, 'activity', t0 + 3 * MIN), false);

// the minutes field: two digits only
eq('digits only', minutesInput('1a2b3'), '12');
eq('empty', minutesInput('abc'), '');
eq('minutes from', [minutesFrom('05'), minutesFrom('0'), minutesFrom(''), minutesFrom('99')], [5, null, null, 99]);

// plugin@1 banner
eq('banner false ok', checkBanner({ banner: false }), []);
eq('banner list ok', checkBanner({ banner: ['activity'] }), []);
eq('banner missing', checkBanner({}).length, 1);
eq('banner bad', checkBanner({ banner: true }).length, 1);
eq('banner empty list', checkBanner({ banner: [] }).length, 1);
eq('banner vs source', checkBanner({ banner: ['a'] }, ['a', 'b']).length, 1);
eq('banner extra', checkBanner({ banner: ['a', 'c'] }, ['a']).length, 1);
eq('source ids', bannerIdsInSource(`banners: [\n { id: 'keys', render: () => <K x={{ id: 'no' }} /> },\n { id: "sys", order: 1 } ],\n settingsTabs: [{ id: 'tab' }]`), ['keys', 'sys']);

// embed@1: a plugin tab carries its settings tab
eq('plugin tab settings', parsePluginTab({ view: 'todo-manager', settings: 'todo-manager' }), { view: 'todo-manager', settings: 'todo-manager' });
eq('plugin tab bad settings dropped', parsePluginTab({ view: 'todo', settings: 'Bad Tab!' }), { view: 'todo' });

if (fails.length) { for (const f of fails) console.error(`✗ ${f}`); process.exit(1); }
console.log(`check-banner-hide: ${n} checks passed`);
