/**
 * Screen map (framework/react/screenMap.ts; build screen-voice-drive, Nov 20 2026): what a console screenshot says can be
 * clicked.
 *
 *   cd framework && npm install && cd .. && npx -y tsx framework/spec/check-screen-map.mts
 *
 * 1. The pure half: words as they read, reading order (top to bottom, left to right, one line = close tops), the id of a
 *    control without an address, what a swept element is.
 * 2. The DOM half in jsdom with a stubbed layout: registered targets and swept controls are merged, placed, split into
 *    on screen / scroll to see, hidden and covered ones left out; a swept control is pressed through console-control@1.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://console.example.test/', pretendToBeVisual: true });
const g = globalThis as Record<string, unknown>;
for (const k of ['window', 'document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'HTMLSelectElement', 'HTMLTextAreaElement', 'HTMLButtonElement', 'Node', 'Element', 'Event', 'CustomEvent', 'MouseEvent', 'MutationObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'localStorage', 'sessionStorage']) {
  const v = (dom.window as unknown as Record<string, unknown>)[k];
  if (v !== undefined) Object.defineProperty(g, k, { value: typeof v === 'function' && !/^[A-Z]/.test(k) ? (v as (...a: unknown[]) => unknown).bind(dom.window) : v, configurable: true, writable: true });
}
(dom.window as unknown as { matchMedia: unknown }).matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
g.matchMedia = (dom.window as unknown as { matchMedia: unknown }).matchMedia;

const { AxfRuntime } = await import('../core/runtime.ts');
const { controlRegistry } = await import('../react/controlTargets.ts');
const { screenMap, screenMapOrder, screenMapRole, screenMapText, seenTargetId, SCREEN_MAP_TEXT_MAX } = await import('../react/screenMap.ts');

let ok = 0, fail = 0;
const check = (cond: unknown, msg: string) => { if (cond) ok++; else { fail++; console.log(`✗ ${msg}`); } };

/* ---- 1. pure half ---- */
check(screenMapText('  Build \n  orchestrator\t ') === 'Build orchestrator', 'words: whitespace collapsed and trimmed');
check(screenMapText('x'.repeat(400)).length === SCREEN_MAP_TEXT_MAX && screenMapText('x'.repeat(400)).endsWith('…'), 'words: capped with an ellipsis');
check(screenMapText(null) === '' && screenMapText(undefined) === '', 'words: nothing is the empty string');
{
  const at = (id: string, x: number, y: number) => ({ id, x, y });
  const got = screenMapOrder([at('d', 10, 100), at('b', 200, 12), at('a', 10, 8), at('c', 400, 5), at('e', 10, 300)]).map((i) => i.id).join('');
  check(got === 'abcde', `reading order: top to bottom, then left to right; tops a few pixels apart share a line (${got})`);
  check(screenMapOrder([]).length === 0, 'reading order: nothing in, nothing out');
}
{
  const taken = new Set<string>();
  check(seenTargetId('Run now', taken) === 'seen.run-now', 'a control without an address is seen.<its words>');
  check(seenTargetId('Run now', taken) === 'seen.run-now.2' && seenTargetId('Run now', taken) === 'seen.run-now.3', 'the same words again are numbered');
  check(seenTargetId('→', taken) === 'seen.control', 'words with no letters still get an id');
  check(/(^|[.:_-])delete([.:_-]|$)/.test(seenTargetId('Delete build', taken)), 'a delete button keeps the word the server guards on');
}
check(screenMapRole('A', null, null) === 'link' && screenMapRole('BUTTON', 'tab', null) === 'tab' && screenMapRole('DIV', 'menuitem', null) === 'menu item', 'role: link, tab, menu item');
check(screenMapRole('INPUT', null, 'text') === 'input' && screenMapRole('INPUT', null, 'checkbox') === 'switch' && screenMapRole('INPUT', null, 'submit') === 'button' && screenMapRole('SELECT', null, null) === 'input', 'role: input, switch, submit button');
check(screenMapRole('BUTTON', null, null) === 'button' && screenMapRole('DIV', 'switch', null) === 'switch', 'role: button, switch');

/* ---- 2. DOM half: a stubbed layout (jsdom draws nothing) ---- */
{
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const assets = ['color-theme', 'style-theme', 'layout', 'app-menu', 'toolbar', 'nav-menu', 'context-menu', 'dialog', 'popup', 'button', 'slider', 'container', 'uac-policy']
    .flatMap((t) => readdirSync(join(root, 'assets', t)).map((f) => JSON.parse(readFileSync(join(root, 'assets', t, f), 'utf8'))));
  const defaults = JSON.parse(readFileSync(join(root, 'defaults.json'), 'utf8'));
  const rt = new AxfRuntime({ manifest: { app: { id: 'test', name: 'Test' }, defaults: defaults.defaults ?? defaults, startView: 'builds' } as never, assets, storageKey: 'test:screen-map' });
  const reg = controlRegistry(rt);
  const view = rt.getState().view;
  Object.defineProperty(dom.window, 'innerWidth', { value: 1000, configurable: true });
  Object.defineProperty(dom.window, 'innerHeight', { value: 600, configurable: true });
  g.window = dom.window;

  const boxes = new Map<Element, [number, number, number, number]>();
  const el = (tag: string, text: string, box: [number, number, number, number], attrs: Record<string, string> = {}, parent: Element = document.body) => {
    const e = document.createElement(tag);
    if (text) e.textContent = text;
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    parent.appendChild(e);
    boxes.set(e, box);
    return e;
  };
  (dom.window.Element.prototype as unknown as { getBoundingClientRect: () => unknown }).getBoundingClientRect = function (this: Element) {
    const [x, y, w, h] = boxes.get(this) ?? [0, 0, 0, 0];
    return { left: x, top: y, right: x + w, bottom: y + h, width: w, height: h, x, y };
  };
  let cover: Element | null = null;
  const hit = (x: number, y: number): Element | null => {
    if (cover) { const [cx, cy, cw, ch] = boxes.get(cover)!; if (x >= cx && x <= cx + cw && y >= cy && y <= cy + ch) return cover; }
    let best: Element | null = null;
    for (const [e, [bx, by, bw, bh]] of boxes) if (e.isConnected && e !== cover && x >= bx && x <= bx + bw && y >= by && y <= by + bh && (!best || best.contains(e))) best = e;
    return best;
  };
  (document as unknown as { elementFromPoint: unknown }).elementFromPoint = hit;

  const pane = el('div', '', [0, 50, 1000, 550], { style: 'overflow-y: auto' });
  const tabPending = el('button', 'Pending', [20, 10, 80, 30], { role: 'tab', 'aria-selected': 'true' });
  const tabShipped = el('button', 'Shipped', [110, 12, 80, 30], { role: 'tab' });
  const save = el('button', 'Save', [20, 100, 60, 30], {}, pane);
  const retry = el('button', 'Retry', [300, 100, 60, 30], {}, pane);            // no address: swept
  const link = el('a', 'Open report', [20, 200, 100, 20], { href: '/report' }, pane);
  const icon = el('button', '', [400, 100, 30, 30], { 'aria-label': 'Settings' }, pane);
  const below = el('button', 'Delete build', [20, 900, 100, 30], {}, pane);     // scrolled out of the pane
  el('button', 'Hidden', [0, 0, 0, 0], {}, pane);                               // display: none (no box)
  const name = el('input', '', [500, 100, 200, 30], { type: 'text', placeholder: 'Build name' }, pane);
  (name as HTMLInputElement).value = 'nightly';
  const row = el('div', 'nightly build failed 2 of 9', [20, 300, 900, 40], {}, pane);
  const inRow = el('button', 'Logs', [800, 305, 60, 30], {}, row);
  // a tab's own target, its inner label must not be listed again
  const offs = [
    reg.register({ address: `view:${view}/tab:q=pending`, kind: 'tab', label: 'Pending', element: () => tabPending, get: () => true }),
    reg.register({ address: `view:${view}/tab:q=shipped`, kind: 'tab', label: 'Shipped', element: () => tabShipped, get: () => false }),
    reg.register({ address: `view:${view}/tab:q`, kind: 'tab', label: 'Queue tabs', element: () => document.body }),
    reg.register({ address: `view:${view}/button:save`, kind: 'button', label: 'Save changes', element: () => save, invoke: () => undefined }),
    reg.register({ address: `view:${view}/grid:queue`, kind: 'grid', label: 'Queue', element: () => pane }),
    reg.register({ address: `view:${view}/grid:queue/row:nightly`, kind: 'row', label: 'nightly', element: () => row }),
  ];

  const map = screenMap(rt);
  const by = (text: string) => map.items.find((i) => i.text === text);
  const seen = map.items.filter((i) => i.on === 'screen').map((i) => i.text);
  check(map.view === view && map.width === 1000 && map.height === 600, 'the map says which screen and how big the viewport is');
  check(JSON.stringify(seen) === JSON.stringify(['Pending', 'Shipped', 'Save', 'Retry', 'Settings', 'Build name', 'Open report', 'nightly build failed 2 of 9Logs', 'Logs']), `on screen, in reading order (${JSON.stringify(seen)})`);
  check(by('Pending')?.address === `view:${view}/tab:q=pending` && by('Pending')?.role === 'tab' && by('Pending')?.value === true && by('Shipped')?.value === undefined, 'a registered tab keeps its address and says it is the open one');
  check(!map.items.some((i) => i.address === `view:${view}/tab:q` || i.kind === 'grid'), 'a tab row and a grid are containers, not something to click');
  check(by('Save')?.address === `view:${view}/button:save` && by('Save')?.label === 'Save changes', 'a registered button shows its words, with its label when that differs');
  check(by('Retry')?.address === `view:${view}/button:seen.retry` && by('Retry')?.kind === 'button', 'a plain button gets a seen.<words> address');
  check(by('Open report')?.role === 'link' && by('Settings')?.address.endsWith('button:seen.settings'), 'a link is a link; an icon button is named by its aria-label');
  check(by('Build name')?.role === 'input' && by('Build name')?.value === 'nightly', 'an input is named by its placeholder and shows its text');
  check(by('Logs')?.address.endsWith('button:seen.logs') && map.items.some((i) => i.kind === 'row' && i.address.endsWith('row:nightly')), 'a row is listed, and so is a button inside it');
  check(by('Delete build')?.on === 'scroll' && by('Delete build')?.destructive === true, 'a control scrolled out of its pane is "scroll to see"; a delete button is marked');
  check(map.items[map.items.length - 1]?.text === 'Delete build', 'scroll-to-see items come after the visible ones');
  check(!by('Hidden'), 'a control with no box is left out');
  check(map.items.every((i) => i.w > 0 && i.h > 0), 'every item has a size');

  // the swept button is a real console-control@1 target: press = its click
  let clicks = 0;
  retry.addEventListener('click', () => { clicks++; });
  const pressed = await reg.run({ verb: 'press', address: `view:${view}/button:seen.retry` });
  check(pressed.ok && clicks === 1, `press on a seen.<words> address clicks the element (${JSON.stringify(pressed).slice(0, 200)})`);
  const del = await reg.run({ verb: 'press', address: `view:${view}/button:seen.delete-build` });
  check(!del.ok && del.code === 'confirmation_required', 'a swept delete button needs confirm');

  // covered by a dialog: not clickable, so not listed; the next map replaces the swept targets
  cover = el('div', '', [0, 0, 1000, 600], { role: 'dialog' });
  const close = el('button', 'Close', [450, 280, 80, 30], {}, cover);
  const under = screenMap(rt);
  check(under.items.filter((i) => i.on === 'screen').map((i) => i.text).join() === 'Close', `under a dialog only the dialog's controls are on screen (${under.items.map((i) => `${i.text}:${i.on}`).join()})`);
  check(!(await reg.run({ verb: 'press', address: `view:${view}/button:seen.retry` })).ok, 'the swept targets of the map before are gone');
  cover.remove(); close.remove(); cover = null;

  // one panel only
  const within = screenMap(rt, row);
  check(within.items.map((i) => i.text).join('|') === 'nightly build failed 2 of 9Logs|Logs', `a map of one element lists only what is inside it (${within.items.map((i) => i.text).join('|')})`);

  // a removed element answers not_found, not a click on nothing
  screenMap(rt);
  retry.remove();
  const gone = await reg.run({ verb: 'press', address: `view:${view}/button:seen.retry` });
  check(!gone.ok, 'pressing a swept control that left the screen fails');
  void link; void icon; void below; void inRow;
  for (const off of offs) off();
}

console.log(fail ? `screen map: ${fail} FAILED, ${ok} passed` : `screen map: ${ok} checks passed`);
process.exit(fail ? 1 : 0);
