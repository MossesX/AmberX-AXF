/*
 * Banner focus (core/engines/bannerfocus.ts, Nov 12 2026): what `banners.focus:<what>` (console_open / console_show
 * focus on the Banners screen, the CLI, voice, `?axf-banner=`) names: a banner or a badge on the banner bar.
 * Run: npx -y tsx framework/spec/check-banner-focus.mts
 */
import { normBannerQuery, resolveBannerFocus } from '../core/engines/bannerfocus';
import { consoleSplitFocus } from '../core/engines/console-commands.mjs';

let n = 0;
const fails: string[] = [];
const eq = (name: string, got: unknown, want: unknown) => { n++; if (JSON.stringify(got) !== JSON.stringify(want)) fails.push(`${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); };

const banners = [
  { id: 'build-status', label: 'Build status', settingsTab: 'main-build-status' },
  { id: 'systems-check' },
  { id: 'approvals', label: 'Approvals waiting' },
  { id: 'clock-strip', label: 'World clocks' },
];
const badges = [
  { key: 'alerts-bell:bell', id: 'bell', label: 'Alerts bell' },
  { key: 'clock:clock', id: 'clock', label: 'Clock', aliases: ['clock'] },
  { key: 'claude-badge:claude', id: 'claude', label: 'Claude badge' },
  { key: 'chip:systems', id: 'systems', label: 'Systems' },
];
const r = (q: string) => resolveBannerFocus(q, banners, badges);

eq('norm', normBannerQuery('  The Build-Status banner '), 'build status');
eq('norm badge suffix', normBannerQuery('Claude badge'), 'claude');

// banners: id, label, settings tab, words
eq('banner id', r('build-status'), { kind: 'banner', id: 'build-status' });
eq('banner label', r('Build status'), { kind: 'banner', id: 'build-status' });
eq('banner said', r('the build status banner'), { kind: 'banner', id: 'build-status' });
eq('banner settings tab', r('main-build-status'), { kind: 'banner', id: 'build-status' });
eq('banner without label', r('Systems check'), { kind: 'banner', id: 'systems-check' });
eq('banner words', r('approvals'), { kind: 'banner', id: 'approvals' });
eq('url-ish case', r('BUILD_STATUS'), { kind: 'banner', id: 'build-status' });

// badges: key, id, label, alias, words
eq('badge key', r('alerts-bell:bell'), { kind: 'badge', key: 'alerts-bell:bell' });
eq('badge label', r('Alerts bell'), { kind: 'badge', key: 'alerts-bell:bell' });
eq('badge words', r('bell'), { kind: 'badge', key: 'alerts-bell:bell' });
eq('badge said', r('the Claude badge'), { kind: 'badge', key: 'claude-badge:claude' });

// an exact name beats a near one of the other kind; prefixes pick the kind
eq('exact badge over near banner', r('clock'), { kind: 'badge', key: 'clock:clock' });
eq('banner: prefix', r('banner:clock'), { kind: 'banner', id: 'clock-strip' });
eq('badge: prefix', r('badge: systems'), { kind: 'badge', key: 'chip:systems' });
eq('widget: prefix', r('widget:bell'), { kind: 'badge', key: 'alerts-bell:bell' });
eq('near banner before near badge', r('systems'), { kind: 'badge', key: 'chip:systems' });
eq('banner: prefix, no such banner', r('banner:bell'), null);
eq('badge: prefix, no such badge', r('badge:approvals'), null);

// nothing / junk
eq('empty', r(''), null);
eq('spaces', r('   '), null);
eq('punctuation only', r('!!!'), null);
eq('too long', r('x'.repeat(201)), null);
eq('no match', r('weather radar'), null);
eq('no banners, no badges', resolveBannerFocus('bell', [], []), null);

// the way in: a console command (CLI, voice, REST, MCP) naming the Banners screen and a banner or badge → focus,
// which the console hands to banners.focus
const screens = [{ kind: 'screen', id: 'banners', label: 'Banners' }, { kind: 'screen', id: 'settings', label: 'Settings' }];
const split = (p: string) => { const x = consoleSplitFocus(screens, p); return x ? [x.item.id, x.focus] : null; };
eq('said: banners + badge', split('banners claude badge'), ['banners', 'claude badge']);
eq('said: show the banners / banner', split('show the banners / build status'), ['banners', 'build status']);
eq('typed: banners:badge:clock', split('banners:badge:clock'), ['banners', 'badge:clock']);
eq('said words resolve', r(split('open the banners alerts bell')![1] as string), { kind: 'badge', key: 'alerts-bell:bell' });

if (fails.length) { console.error(`check-banner-focus: ${fails.length} of ${n} failed\n  ${fails.join('\n  ')}`); process.exit(1); }
console.log(`check-banner-focus: ${n} checks ok`);
