/**
 * menu-fit@1 checks (core/engines/menufit.ts): menus stay on screen, flip or shift before they scroll, and scroll
 * (a height cap) only when they don't fit. Run: npx -y tsx framework/spec/check-menu-fit.mts
 */
import { fitMenu, menuBox, type FitInput, type FitResult } from '../core/engines/menufit';

let fails = 0, passes = 0;
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

run('submenu near the bottom moves up to fit', {
  mode: 'side', anchor: { left: 100, right: 330, top: 700, bottom: 732 }, size: { width: 220, height: 300 }, box: desk, gap: 2,
}, { top: 792 - 300, scroll: false, left: 332 });

run('submenu taller than the screen is capped and scrolls from the top', {
  mode: 'side', anchor: { left: 100, right: 330, top: 300, bottom: 332 }, size: { width: 220, height: 3000 }, box: desk, gap: 2,
}, { top: 8, maxHeight: 784, scroll: true });

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
