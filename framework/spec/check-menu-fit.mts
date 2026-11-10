/**
 * menu-fit@1 checks (core/engines/menufit.ts): menus stay on screen, flip or shift before they scroll, and scroll
 * (a height cap) only when they don't fit. Run: npx -y tsx framework/spec/check-menu-fit.mts
 */
import { fitMenu, menuBox, menuKey, menuWheel, nextMenuIndex, type FitInput, type FitResult } from '../core/engines/menufit';

let fails = 0, passes = 0;
const is = (name: string, got: unknown, want: unknown) => { if (JSON.stringify(got) === JSON.stringify(want)) { passes++; console.log(`✓ ${name}`); } else { fails++; console.log(`✗ ${name}\n    want ${JSON.stringify(want)} got ${JSON.stringify(got)}`); } };
function check(name: string, got: FitResult, want: Partial<FitResult> & { inside?: FitInput }) {
  const bad: string[] = [];
  for (const k of ['left', 'top', 'maxHeight', 'scroll', 'flip'] as const) if (k in want && want[k] !== got[k]) bad.push(`${k}: want ${want[k]} got ${got[k]}`);
  if (want.inside) {
    const { box, size } = want.inside;
    const h = Math.min(size.height, got.maxHeight);
    if (got.top < box.top || got.top + h > box.bottom + 0.5) bad.push(`off screen vertically: ${got.top}..${got.top + h} not in ${box.top}..${box.bottom}`);
    if (!want.inside.stretch && (got.left < box.left || got.left + size.width > box.right + 0.5)) bad.push(`off screen horizontally: ${got.left}..${got.left + size.width} not in ${box.left}..${box.right}`);
  }
  if (bad.length) { fails++; console.log(`✗ ${name}\n    ${bad.join('\n    ')}`); } else { passes++; console.log(`✓ ${name}`); }
}
const run = (name: string, input: FitInput, want: Partial<FitResult>) => check(name, fitMenu(input), { ...want, inside: input });

// a 412 × 640 phone, 8 px edge inset
const phone = menuBox({ left: 0, top: 0, right: 412, bottom: 640 }, {}, 8);
// a 1280 × 800 desktop
const desk = menuBox({ left: 0, top: 0, right: 1280, bottom: 800 }, {}, 8);

run('long app menu below a menubar on a short phone scrolls in the room below', {
  mode: 'below', anchor: { left: 60, right: 120, top: 40, bottom: 72 }, size: { width: 396, height: 1400 }, box: phone, gap: 4, stretch: true,
}, { top: 76, maxHeight: 632 - 76, scroll: true, flip: '', left: 8 });

run('short app menu fits below: no cap needed, no scroll', {
  mode: 'below', anchor: { left: 60, right: 120, top: 40, bottom: 72 }, size: { width: 230, height: 300 }, box: desk, gap: 4,
}, { top: 76, left: 60, scroll: false, flip: '' });

run('⋯ menu near the bottom flips up when it fits above', {
  mode: 'below', anchor: { left: 360, right: 392, top: 580, bottom: 612 }, size: { width: 200, height: 300 }, box: phone, gap: 4,
}, { top: 580 - 4 - 300, flip: 'up', scroll: false, left: 404 - 200 });

run('⋯ menu near the bottom, too tall for either side, scrolls above (the bigger side)', {
  mode: 'below', anchor: { left: 20, right: 52, top: 500, bottom: 532 }, size: { width: 200, height: 900 }, box: phone, gap: 4,
}, { flip: 'up', scroll: true, top: 8, maxHeight: 500 - 4 - 8 });

run('context menu at the bottom of a phone shifts up over the pointer before scrolling', {
  mode: 'point', anchor: { left: 300, right: 300, top: 400, bottom: 400 }, size: { width: 220, height: 500 }, box: phone,
}, { top: 632 - 500, scroll: false, left: 404 - 220 });

run('context menu taller than the whole screen fills it and scrolls', {
  mode: 'point', anchor: { left: 10, right: 10, top: 300, bottom: 300 }, size: { width: 220, height: 2000 }, box: phone,
}, { top: 8, maxHeight: 624, scroll: true });

run('context menu flips above the pointer when only above has room', {
  mode: 'point', anchor: { left: 100, right: 100, top: 600, bottom: 600 }, size: { width: 220, height: 300 }, box: phone,
}, { top: 300, flip: 'up', scroll: false });

run('nested submenu at the right edge opens to the left', {
  mode: 'side', anchor: { left: 1050, right: 1270, top: 200, bottom: 232 }, size: { width: 220, height: 200 }, box: desk, gap: 2,
}, { left: 1050 - 2 - 220, flip: 'left', top: 200 });

run('submenu on a compact screen with no room either side shifts inside it', {
  mode: 'side', anchor: { left: 8, right: 300, top: 100, bottom: 132 }, size: { width: 220, height: 200 }, box: phone, gap: 2,
}, { left: 404 - 220, flip: '', top: 100 });

run('submenu near the bottom moves up to fit (flip up)', {
  mode: 'side', anchor: { left: 100, right: 330, top: 700, bottom: 732 }, size: { width: 220, height: 300 }, box: desk, gap: 2,
}, { top: 792 - 300, scroll: false, left: 332, flip: 'up' });

run('submenu taller than the screen is capped and scrolls from the top (flip up)', {
  mode: 'side', anchor: { left: 100, right: 330, top: 300, bottom: 332 }, size: { width: 220, height: 3000 }, box: desk, gap: 2,
}, { top: 8, maxHeight: 784, scroll: true, flip: 'up' });

// the flagship skin (Brett, Nov 10 2026): sub menus expand left if they'd go off screen, and up when the bottom is near
run('submenu at the right edge near the bottom flips left and up', {
  mode: 'side', anchor: { left: 1050, right: 1270, top: 700, bottom: 732 }, size: { width: 220, height: 300 }, box: desk, gap: 2,
}, { left: 1050 - 2 - 220, top: 792 - 300, flip: 'left up', scroll: false });

run('submenu that fits beside its row reports no flip at all', {
  mode: 'side', anchor: { left: 100, right: 330, top: 200, bottom: 232 }, size: { width: 220, height: 300 }, box: desk, gap: 2,
}, { left: 332, top: 200, flip: '', scroll: false });

run('submenu whose row sits at the very bottom edge still lines up with it when it fits', {
  mode: 'side', anchor: { left: 100, right: 330, top: 760, bottom: 792 }, size: { width: 220, height: 32 }, box: desk, gap: 2,
}, { top: 760, flip: '', scroll: false });

run('third-level submenu under a flipped parent with no room either side shifts inside the box (no flip reported)', {
  mode: 'side', anchor: { left: 8, right: 228, top: 100, bottom: 132 }, size: { width: 300, height: 200 }, box: phone, gap: 2,
}, { left: 404 - 300, flip: '', top: 100 });

check('a submenu wider than the whole screen pins to the left edge (the only honest place)', fitMenu({
  mode: 'side', anchor: { left: 8, right: 228, top: 100, bottom: 132 }, size: { width: 400, height: 200 }, box: phone, gap: 2,
}), { left: 8, flip: '', top: 100 });

// the menu scrolls, not the page
const wheelCases: [string, Parameters<typeof menuWheel>[0], ReturnType<typeof menuWheel>][] = [
  ['no menu open: the page scrolls', { open: false, inMenu: false, deltaY: 40 }, 'page'],
  ['wheel outside an open menu: swallowed', { open: true, inMenu: false, deltaY: 40 }, 'block'],
  ['wheel down inside a menu with more below: the menu scrolls', { open: true, inMenu: true, deltaY: 40, scrollTop: 0, scrollHeight: 900, clientHeight: 400 }, 'menu'],
  ['wheel down inside a menu at its end: swallowed, the page stays', { open: true, inMenu: true, deltaY: 40, scrollTop: 500, scrollHeight: 900, clientHeight: 400 }, 'block'],
  ['wheel up inside a menu at its top: swallowed', { open: true, inMenu: true, deltaY: -40, scrollTop: 0, scrollHeight: 900, clientHeight: 400 }, 'block'],
  ['wheel up inside a scrolled menu: the menu scrolls', { open: true, inMenu: true, deltaY: -40, scrollTop: 120, scrollHeight: 900, clientHeight: 400 }, 'menu'],
  ['wheel inside a menu that fits (nothing to scroll): swallowed', { open: true, inMenu: true, deltaY: 40, scrollTop: 0, scrollHeight: 300, clientHeight: 300 }, 'block'],
  ['a sideways wheel inside a menu: swallowed', { open: true, inMenu: true, deltaY: 0, scrollTop: 0, scrollHeight: 900, clientHeight: 400 }, 'block'],
  ['sub-pixel slack at the end counts as the end', { open: true, inMenu: true, deltaY: 40, scrollTop: 499.5, scrollHeight: 900, clientHeight: 400 }, 'block'],
];
for (const [name, input, want] of wheelCases) is(name, menuWheel(input), want);

// keyboard: the same keys whichever way a submenu flipped
const keyCases: [string, string, { hasSub?: boolean; inSub?: boolean }, ReturnType<typeof menuKey>][] = [
  ['ArrowDown moves on', 'ArrowDown', {}, 'next'], ['ArrowUp moves back', 'ArrowUp', {}, 'prev'],
  ['Home jumps first', 'Home', {}, 'first'], ['End jumps last', 'End', {}, 'last'], ['PageUp jumps first', 'PageUp', {}, 'first'], ['PageDown jumps last', 'PageDown', {}, 'last'],
  ['ArrowRight on a plain row does nothing', 'ArrowRight', {}, null], ['ArrowRight on a submenu row opens it', 'ArrowRight', { hasSub: true }, 'open'],
  ['ArrowRight inside a flipped-left submenu still opens the next level', 'ArrowRight', { hasSub: true, inSub: true }, 'open'],
  ['ArrowLeft at the root does nothing', 'ArrowLeft', {}, null], ['ArrowLeft inside a submenu closes it (focus back on the parent row)', 'ArrowLeft', { inSub: true }, 'close'],
  ['Enter on a plain row activates', 'Enter', {}, 'activate'], ['Space on a plain row activates', ' ', {}, 'activate'], ['Enter on a submenu row opens it', 'Enter', { hasSub: true }, 'open'],
  ['Escape at the root closes the menu', 'Escape', {}, 'escape'], ['Escape inside a submenu closes only that submenu', 'Escape', { inSub: true }, 'close'],
  ['Tab is left to the browser', 'Tab', {}, null], ['a letter is left alone', 'a', { hasSub: true, inSub: true }, null],
];
for (const [name, key, opts, want] of keyCases) is(name, menuKey(key, opts), want);

is('next wraps to the first row', nextMenuIndex(5, 4, 'next'), 0);
is('prev wraps to the last row', nextMenuIndex(5, 0, 'prev'), 4);
is('next from the middle', nextMenuIndex(5, 1, 'next'), 2);
is('next from nowhere is the first row', nextMenuIndex(5, -1, 'next'), 0);
is('prev from nowhere is the last row', nextMenuIndex(5, -1, 'prev'), 4);
is('first / last', [nextMenuIndex(5, 2, 'first'), nextMenuIndex(5, 2, 'last')], [0, 4]);
is('an empty list has no row', [nextMenuIndex(0, -1, 'next'), nextMenuIndex(0, 0, 'first')], [-1, -1]);
is('one row stays put', [nextMenuIndex(1, 0, 'next'), nextMenuIndex(1, 0, 'prev')], [0, 0]);

// on-screen keyboard: the visual viewport is 412 × 340 (the keyboard covers 300 px), scrolled 0
const kb = menuBox({ left: 0, top: 0, right: 412, bottom: 340 }, {}, 8);
run('keyboard open: the drop-down is capped to the room above the keyboard', {
  mode: 'below', anchor: { left: 60, right: 120, top: 40, bottom: 72 }, size: { width: 396, height: 600 }, box: kb, gap: 4, stretch: true,
}, { top: 76, maxHeight: 332 - 76, scroll: true });

// safe areas: a notch (top 32) and a gesture bar (bottom 24)
const notch = menuBox({ left: 0, top: 0, right: 412, bottom: 900 }, { top: 32, bottom: 24 }, 8);
run('safe areas: a context menu stays clear of the notch and the gesture bar', {
  mode: 'point', anchor: { left: 50, right: 50, top: 20, bottom: 20 }, size: { width: 220, height: 2000 }, box: notch,
}, { top: 40, maxHeight: 900 - 24 - 8 - 40, scroll: true });

run('an explicit ceiling caps a menu even with room to spare', {
  mode: 'below', anchor: { left: 60, right: 120, top: 40, bottom: 72 }, size: { width: 230, height: 700 }, box: desk, gap: 4, maxHeight: 400,
}, { top: 76, maxHeight: 400, scroll: true });

console.log(`\n${passes} passed, ${fails} failed`);
if (fails) process.exit(1);
