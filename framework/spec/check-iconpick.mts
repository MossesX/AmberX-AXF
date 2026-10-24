/** Icon picks + the picker's animated catalog (core/engines/iconpick.ts). Run: npx -y tsx framework/spec/check-iconpick.mts */
import { readFileSync } from 'node:fs';
import { ANIMATED_ICONS, ICON_ANIMS, STATIC_ICONS, normalizeStateLook, stateLookFor, animatedIconOf, animatedPick, iconPickMotion, iconPickValue, parseIconPick, setStill, stillIcons } from '../core/engines/iconpick.ts';

let pass = 0, fail = 0;
const ok = (c: unknown, m: string) => { if (c) pass++; else { fail++; console.error('✗', m); } };
const eq = (a: unknown, b: unknown, m: string) => ok(JSON.stringify(a) === JSON.stringify(b), `${m}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`);

const names = new Set([...readFileSync(new URL('../react/components/Icon.tsx', import.meta.url), 'utf8').matchAll(/^  '?([a-z0-9-]+)'?: '/gm)].map((m) => m[1]));
ok(names.size > 50, 'icon names read');
eq(ANIMATED_ICONS.length, 50, '50 animated icons');
eq(new Set(ANIMATED_ICONS.map((a) => a.id)).size, 50, 'ids unique');
for (const a of ANIMATED_ICONS) {
  ok(names.has(a.icon), `${a.id}: icon exists`);
  ok((ICON_ANIMS as readonly string[]).includes(a.anim), `${a.id}: known animation`);
  eq(a.id, `${a.icon}@${a.anim}`, `${a.id}: id is its pick`);
}
eq(parseIconPick('cloud'), { icon: 'cloud', anim: null, still: false }, 'static');
eq(parseIconPick('cloud@pulse'), { icon: 'cloud', anim: 'pulse', still: false }, 'animated');
eq(parseIconPick('cloud@pulse:still'), { icon: 'cloud', anim: 'pulse', still: true }, 'still');
eq(parseIconPick('cloud@nope'), { icon: 'cloud', anim: null, still: false }, 'unknown animation = static');
eq(parseIconPick(undefined), { icon: '', anim: null, still: false }, 'empty');
eq(iconPickValue('cloud', 'pulse', true), 'cloud@pulse:still', 'value still');
eq(iconPickValue('', 'pulse'), '', 'no icon');
eq(iconPickMotion('cloud@pulse'), 'pulse', 'moves');
eq(iconPickMotion('cloud@pulse:still'), null, 'still does not move');
eq(iconPickMotion('cloud@pulse', true), null, 'reduced motion');
eq(animatedIconOf('claude@spin:still')?.id, 'claude@spin', 'catalog entry of a still pick');
eq(animatedIconOf('cloud'), null, 'static has no entry');
eq(stillIcons(['claude@spin', 'claude@spin', 'nope', 3]), ['claude@spin'], 'still list normalised');
eq(setStill(['claude@spin'], 'cloud@float', true), ['claude@spin', 'cloud@float'], 'switch on');
eq(setStill(['claude@spin'], 'claude@spin', false), [], 'switch off');
eq(setStill([], 'nope@spin', true), [], 'unknown id ignored');
eq(animatedPick(ANIMATED_ICONS[0], true), 'claude@spin:still', 'pick honours switch');
eq(STATIC_ICONS.length, 50, '50 static icons');
eq(new Set(STATIC_ICONS).size, 50, 'static icons unique');
for (const n of STATIC_ICONS) ok(names.has(n), `static ${n}: icon exists`);
const d = normalizeStateLook(undefined, 'hub');
eq(d, { mode: 'colors', icon: 'hub', on: 'hub', off: 'hub', onTone: 'success', offTone: 'danger' }, 'look: defaults = one icon, green / red');
eq(normalizeStateLook('cloud@pulse:still', 'hub').icon, 'cloud@pulse:still', 'look: an old single pick reads as colours mode');
const two = normalizeStateLook({ mode: 'icons', on: 'wifi', off: 'wifi-off@blink', onTone: 'accent', offTone: 'nope' }, 'hub');
eq(stateLookFor(two, true), { icon: 'wifi', tone: 'accent' }, 'look: icons mode, on');
eq(stateLookFor(two, false), { icon: 'wifi-off@blink', tone: 'danger' }, 'look: icons mode, off (bad tone falls back)');
const col = normalizeStateLook({ mode: 'colors', icon: 'plug', on: 'x', onTone: 'neutral', offTone: 'warning' }, 'hub');
eq([stateLookFor(col, true), stateLookFor(col, false)], [{ icon: 'plug', tone: 'neutral' }, { icon: 'plug', tone: 'warning' }], 'look: colours mode keeps one icon');
eq(normalizeStateLook({ icon: '<script>' }, 'hub').icon, 'hub', 'look: a bad pick falls back');
console.log(`iconpick: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
