/**
 * Claude badge: the look model (web/look.ts) and the framework's badge look (core/engines/banner.ts badgeLook).
 *   npx -y tsx apps/console-web/plugins/claude-badge/test.mts
 */
import { ANIM_STATES, DEFAULT_STYLE, LOOK_ASSETS, MOTIONS, badgeData, normalizeStyle } from './web/look.ts';
import { BADGE_LOOKS, BADGE_MOTIONS, badgeLook } from '../../../../framework/core/engines/banner.ts';

let fails = 0;
const ok = (c: unknown, m: string) => { if (!c) { fails += 1; console.log(`✗ ${m}`); } else console.log(`✓ ${m}`); };

ok(LOOK_ASSETS.length >= 15, `at least 15 looks (${LOOK_ASSETS.length})`);
ok(LOOK_ASSETS.filter((l) => l.tags.includes('brand')).length >= 4, 'brand-icon looks');
ok(LOOK_ASSETS.every((l) => l.$axf === 'asset@1' && l.type === 'badge' && ['pill', 'icon', 'dot'].includes(l.data.shape)), 'every look is a valid badge asset');
ok(LOOK_ASSETS.every((l) => (BADGE_LOOKS as readonly string[]).includes(l.data.look)), 'every look is drawn by the framework');
ok(MOTIONS.filter((m) => m.id !== 'none').length >= 10, 'at least 10 animations');
ok(MOTIONS.every((m) => (BADGE_MOTIONS as readonly string[]).includes(m.id)), 'every animation is drawn by the framework');
ok(ANIM_STATES.map((s) => s.id).join() === 'follow,opened,connecting,error', 'four animation states');

const base = { tone: 'success' as const, checking: false, following: false, failed: false, pulse: 0, stateIcon: 'sparkles' };
const off = badgeData(DEFAULT_STYLE, base);
ok(!off.tone2 && !off.motion && off.tone === 'success', 'off = today\'s single colour');
const on = badgeData(DEFAULT_STYLE, { ...base, following: true });
ok(on.tone === 'success' && on.tone2 === 'accent' && on.motion === 'sweep', 'Follow Amber on = connection colour + faded second tone, animated');
ok(badgeLook(on as never).twoTone && badgeLook(on as never).motion === 'sweep', 'framework draws it two-tone with the motion');
ok(badgeLook(off as never).twoTone === false && badgeLook(off as never).motion === 'none', 'framework: no second tone = no motion');
const conn = badgeData(DEFAULT_STYLE, { ...base, checking: true, following: true, tone: 'muted' });
ok(conn.motion === 'breathe', 'connecting animation wins while it checks');
const err = badgeData(normalizeStyle({ animations: { error: { motion: 'heartbeat' } } }), { ...base, failed: true, tone: 'muted' });
ok(err.motion === 'heartbeat' && err.tone2 === 'accent', 'error animation when it has one');
ok(!badgeData(DEFAULT_STYLE, { ...base, failed: true }).motion, 'error with no motion stays plain');
const p = badgeData(DEFAULT_STYLE, { ...base, following: true, pulse: 3 });
ok(p.pulse === 3 && p.pulseMotion === 'glow', 'Amber opened something = one glow pulse');
ok(!badgeData(normalizeStyle({ animations: { opened: { motion: 'none' } } }), { ...base, pulse: 2 }).pulse, 'opened = none: no pulse');
const once = badgeData(normalizeStyle({ animations: { follow: { loop: false, speed: 2, intensity: 0.3 } } }), { ...base, following: true });
ok(once.once === true && once.speed === 2 && once.intensity === 0.3, 'speed, intensity, loop carried');
ok(badgeLook(once as never).vars['--fx-badge-speed'] === '2', 'speed becomes a CSS variable');

const brand = badgeData(normalizeStyle({ look: 'brand' }), base);
ok(brand.mark === 'amberx' && brand.shape === 'icon', 'brand look draws the AmberX mark');
ok(badgeData(normalizeStyle({ icon: 'glyph:amberx-outline/bell' }), base).mark === 'glyph:amberx-outline/bell', 'a picked icon-pack glyph');
ok(badgeData(normalizeStyle({ look: 'monogram', icon: 'anim:amberx-pulse' }), base).mark === 'anim:amberx-pulse', 'a picked animated logo replaces the monogram');
const ic = badgeData(normalizeStyle({ look: 'brand', icon: 'icon:rocket' }), base);
ok(ic.icon === 'rocket' && !ic.mark, 'a built-in icon replaces the mark');
ok(badgeData(DEFAULT_STYLE, { ...base, stateIcon: 'zap' }).icon === 'zap', 'state icon setting still applies');

const n = normalizeStyle({ look: 'nope', tone2: 'pink', color2: 'red', animations: { follow: { motion: 'disco', speed: 'x' } } });
ok(n.look === 'pill' && n.tone2 === 'accent' && n.color2 === '' && n.animations.follow.motion === 'sweep' && n.animations.follow.speed === 4, 'bad input falls back to the defaults');
ok(badgeLook({ tone2: 'accent', color2: '#ff00ff' } as never).vars['--fx-badge-c2'] === '#ff00ff', 'custom second colour');
ok(badgeLook({ tone2: 'warning' } as never).vars['--fx-badge-c2'] === 'var(--fx-warning)', 'second tone is a theme token');
ok(badgeLook({ tone2: 'accent', color2: 'url(x)' } as never).vars['--fx-badge-c2'] === 'var(--fx-accent)', 'a non-colour never reaches CSS');
ok(badgeLook({ look: 'x;y' } as never).look === '', 'a bad look name is dropped');

console.log(fails ? `\n✗ ${fails} failed` : '\n✓ all passed');
(globalThis as { process?: { exit(n: number): void } }).process?.exit(fails ? 1 : 0);
