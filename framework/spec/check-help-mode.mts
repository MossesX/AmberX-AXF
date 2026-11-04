/**
 * Help mode in a DOM (jsdom; react/components/Help.tsx inside the real AppShell):
 *   switch on / off (? in the menu bar, F1, Ctrl+Shift+H) · every control tagged with a stable help id · hover shows the
 *   tooltip, tapping anywhere dismisses it · long-press shows it and leaves the control untouched, a short tap still
 *   works · the ? badge on a phone · "No help yet" for a control without help · What is this? · the screen intro once
 *   per screen (Skip, Don't show intros again) · off = nothing tagged or drawn.
 *   cd framework && npm install && cd .. && npx -y tsx framework/spec/check-help-mode.mts
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'https://console.example.test/', pretendToBeVisual: true });
const W = dom.window as unknown as Record<string, unknown> & Window;
const g = globalThis as Record<string, unknown>;
for (const k of ['window', 'document', 'navigator', 'HTMLElement', 'HTMLButtonElement', 'Node', 'Element', 'Event', 'CustomEvent', 'MouseEvent', 'KeyboardEvent', 'MutationObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'localStorage', 'matchMedia', 'StorageEvent'] as const) {
  const v = W[k];
  if (v !== undefined) Object.defineProperty(g, k, { value: typeof v === 'function' && !/^[A-Z]/.test(k) ? (v as (...a: unknown[]) => unknown).bind(dom.window) : v, configurable: true, writable: true });
}
let coarse = false;
const mm = (q: string) => ({ matches: q.includes('coarse') ? coarse : false, media: q, addEventListener() {}, removeEventListener() {} });
(W as unknown as { matchMedia: unknown }).matchMedia = mm;
g.matchMedia = mm;
g.IS_REACT_ACT_ENVIRONMENT = true;
const quiet = console.error;
console.error = (...a: unknown[]) => { if (!/not wrapped in act/.test(String(a[0]))) quiet(...a); };
// jsdom lays nothing out: every element is a 120×32 box at the origin, and the topmost thing at a point is the element asked about
(W.Element as unknown as { prototype: Element }).prototype.getBoundingClientRect = function () { return { left: 10, top: 40, right: 130, bottom: 72, width: 120, height: 32, x: 10, y: 40, toJSON() {} } as DOMRect; };
let topAt: Element | null = null;
(W.document as Document).elementFromPoint = () => topAt;

const React = await import('react');
g.React = React;
const { createElement: h, act } = React;
const { createRoot } = await import('react-dom/client');
const { AxfRuntime } = await import('../core/runtime.ts');
const { AxfProvider } = await import('../react/AxfProvider.tsx');
const { AppShell } = await import('../react/AppShell.tsx');
const { Button, IconButton } = await import('../react/components/Controls.tsx');
const { Switch } = await import('../react/components/Forms.tsx');
const { placeTip, describeHelpElement } = await import('../react/components/Help.tsx');

let ok = 0, fail = 0;
const check = (cond: unknown, msg: string) => { if (cond) ok++; else { fail++; console.log(`✗ ${msg}`); } };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const doc = W.document as Document;
const $ = (sel: string) => doc.querySelector<HTMLElement>(sel);
const tip = () => $('.fx-help-tip');

function pointer(type: string, el: Element, pointerType: 'mouse' | 'touch', x = 20, y = 50) {
  const e = new (W.MouseEvent as typeof MouseEvent)(type, { bubbles: true, cancelable: true, clientX: x, clientY: y });
  Object.defineProperty(e, 'pointerType', { value: pointerType });
  el.dispatchEvent(e);
  return e;
}
const click = (el: Element) => { const e = new (W.MouseEvent as typeof MouseEvent)('click', { bubbles: true, cancelable: true }); el.dispatchEvent(e); return e; };
const key = (k: string, mods: Partial<KeyboardEventInit> = {}) => W.dispatchEvent(new (W.KeyboardEvent as typeof KeyboardEvent)('keydown', { key: k, bubbles: true, ...mods }));

/* ---- unit: where a tooltip goes ---- */
{
  const below = placeTip({ left: 100, top: 100, bottom: 130, width: 80 }, { w: 200, h: 60 }, { w: 400, h: 800 });
  check(below.side === 'below' && below.top >= 130, 'tooltip sits below its control when there is room (never over it)');
  const above = placeTip({ left: 100, top: 700, bottom: 730, width: 80 }, { w: 200, h: 60 }, { w: 400, h: 800 });
  check(above.side === 'above' && above.top + 60 <= 700, 'and above it near the bottom of the screen');
  const edge = placeTip({ left: 380, top: 100, bottom: 130, width: 20 }, { w: 200, h: 60 }, { w: 400, h: 800 });
  check(edge.left + 200 <= 400 - 8 && edge.left >= 8, 'and inside the screen at the edges');
}

/* ---- the app ---- */
const root = new URL('../', import.meta.url).pathname;
const assets = readdirSync(join(root, 'assets')).flatMap((t) => readdirSync(join(root, 'assets', t)).filter((n) => n.endsWith('.json')).map((n) => JSON.parse(readFileSync(join(root, 'assets', t, n), 'utf8'))));
const defaults = JSON.parse(readFileSync(join(root, 'defaults.json'), 'utf8'));
const rt = new AxfRuntime({ manifest: { app: { id: 'test', name: 'Test' }, defaults, startView: 'home' } as never, assets, storageKey: 'test:help-mode' });
rt.addHelp('lib:test', { entries: [{ target: 'view:other', title: 'Other', text: 'Another screen.' }], intros: [{ screen: 'home', title: 'Home', steps: [{ say: 'This is home.', target: 'refresh' }, { say: 'That is all.' }] }] });
let refreshed = 0, settings = 0, frob = 0;
const Page = () => h('div', null,
  h(Button, { onClick: () => { refreshed++; } }, 'Refresh (3)'),
  h('button', { type: 'button', 'data-axf-action': 'app.settings', onClick: () => { settings++; }, id: 'settings-btn' }, 'Settings'),
  h(IconButton, { icon: 'star', label: 'Frobnicate', onClick: () => { frob++; } }),
  h(Switch, { label: 'Animations', checked: true, onChange: () => {} }),
);
const views = { home: { title: 'Home', render: () => h(Page) }, other: { title: 'Other', render: () => h('p', null, 'other') } };
const container = doc.getElementById('root')!;
const reactRoot = createRoot(container);
await act(async () => { reactRoot.render(h(AxfProvider, { runtime: rt }, h(AppShell, { views }))); });
await act(async () => { await sleep(20); });

const refreshBtn = () => [...doc.querySelectorAll('button')].find((b) => b.textContent?.includes('Refresh'))!;
check(!!refreshBtn(), 'the page renders');
check(!doc.documentElement.hasAttribute('data-axf-help'), 'off: the root carries no help mode');
check(!doc.querySelector('[data-axf-help-id]'), 'off: no control is tagged');
pointer('pointerover', refreshBtn(), 'mouse');
await act(async () => { await sleep(400); });
check(!tip(), 'off: hovering shows nothing');

// the ? in the menu bar switches it on
const qBtn = $('.fx-helpbtn');
check(!!qBtn && qBtn.getAttribute('aria-pressed') === 'false', 'the ? switch is in the menu bar, not pressed');
await act(async () => { click(qBtn!); await sleep(30); });
check(rt.helpMode(), 'tapping ? turns Help mode on');
check($('.fx-helpbtn')?.classList.contains('is-on') && $('.fx-helpbtn')?.getAttribute('aria-pressed') === 'true', 'the ? lights up');
check(doc.documentElement.getAttribute('data-axf-help') === 'on', 'the root says help mode is on');
check(refreshBtn().getAttribute('data-axf-help-id') === 'refresh', 'a button is named by its label, the count dropped (refresh)');
check($('#settings-btn')?.getAttribute('data-axf-help-id') === 'action:app.settings', 'a control with an action is named by the action');
check($('[aria-label="Frobnicate"]')?.getAttribute('data-axf-help-id') === 'frobnicate', 'an icon button is named by its label');
check($('.fx-switchrow')?.getAttribute('data-axf-help-id') === 'animations', 'a switch is named on its row (its label)');
check(refreshBtn().getAttribute('data-axf-help-has') === 'yes' && $('[aria-label="Frobnicate"]')?.getAttribute('data-axf-help-has') === 'no', 'tagged with whether help exists');
check(describeHelpElement(refreshBtn()).kind === 'button' && describeHelpElement($('.fx-switchrow')!).kind === 'toggle', 'kinds: button, toggle');

// the screen intro, first time on this screen
check(!!$('.fx-help-intro'), 'the screen intro shows the first time');
check($('.fx-help-intro')?.textContent?.includes('This is home.') && $('.fx-help-intro')?.textContent?.includes('1 of 2'), 'step 1 of 2');
await act(async () => { await sleep(40); });
check(!!$('.fx-help-spot'), 'its target is outlined');
const nextBtn = [...doc.querySelectorAll('.fx-help-intro button')].find((b) => b.textContent === 'Next')!;
await act(async () => { click(nextBtn); await sleep(10); });
check($('.fx-help-intro')?.textContent?.includes('2 of 2'), 'Next goes to step 2');
const gotIt = [...doc.querySelectorAll('.fx-help-intro button')].find((b) => b.textContent === 'Got it')!;
await act(async () => { click(gotIt); await sleep(10); });
check(!$('.fx-help-intro'), 'Got it closes the intro');
await act(async () => { rt.navigate('other'); await sleep(10); });
await act(async () => { rt.navigate('home'); await sleep(30); });
check(!$('.fx-help-intro'), 'it never shows again on that screen');

// hover → tooltip; tap elsewhere → gone
pointer('pointerover', refreshBtn(), 'mouse');
await act(async () => { await sleep(400); });
check(!!tip(), 'hover shows the tooltip');
check(tip()?.textContent?.includes('Refresh') && tip()?.textContent?.includes('Reloads this from the server'), 'with the framework help text');
check(!tip()?.contains(refreshBtn()), 'the tooltip is not on top of the control');
await act(async () => { pointer('pointerdown', doc.body, 'mouse'); await sleep(10); });
check(!tip(), 'tapping anywhere dismisses it');

// no help yet
pointer('pointerover', $('[aria-label="Frobnicate"]')!, 'mouse');
await act(async () => { await sleep(400); });
check(tip()?.classList.contains('is-missing') && /No help yet/.test(tip()?.textContent ?? '') && tip()?.textContent?.includes('frobnicate'), '"No help yet" with its id');
check(rt.missingHelp().includes('frobnicate'), 'and it is on the run-time missing list');
const what = [...(tip()?.querySelectorAll('button') ?? [])].find((b) => b.textContent?.includes('What is this?'))!;
await act(async () => { click(what); await sleep(10); });
check(!!$('.fx-help-panel') && !tip(), 'What is this? opens the panel (the tooltip closes)');
await act(async () => { click($('.fx-help-panel [aria-label="Close"]')!); await sleep(10); });
check(!$('.fx-help-panel'), 'the panel closes');

// long-press (touch): tooltip, the control is not tapped
const s0 = settings;
const sb = $('#settings-btn')!;
pointer('pointerdown', sb, 'touch');
await act(async () => { await sleep(560); });
check(!!tip() && tip()?.textContent?.includes('Settings') && tip()?.textContent?.includes('Opens Settings'), 'long-press shows the tooltip');
pointer('pointerup', sb, 'touch');
await act(async () => { click(sb); await sleep(10); });
check(settings === s0, 'the control is not tapped by the long-press');
// a short tap still works
await act(async () => { pointer('pointerdown', sb, 'touch'); pointer('pointerup', sb, 'touch'); click(sb); await sleep(10); });
check(settings === s0 + 1, 'a normal tap still does its job in Help mode');
check(!tip(), 'and dismisses the tooltip');

// F1 and Ctrl+Shift+H
await act(async () => { key('F1'); await sleep(20); });
check(!rt.helpMode(), 'F1 switches it off');
check(!doc.querySelector('[data-axf-help-id]') && !doc.documentElement.hasAttribute('data-axf-help'), 'off: every tag is taken away');
await act(async () => { key('H', { ctrlKey: true, shiftKey: true }); await sleep(20); });
check(rt.helpMode(), 'Ctrl+Shift+H switches it on');

// the phone: ? badges
await act(async () => { reactRoot.unmount(); });
coarse = true;
const root2 = createRoot(container);
await act(async () => { root2.render(h(AxfProvider, { runtime: rt }, h(AppShell, { views }))); await sleep(30); });
topAt = refreshBtn();
await act(async () => { W.dispatchEvent(new (W.Event as typeof Event)('resize')); await sleep(40); });
const badge = [...doc.querySelectorAll<HTMLElement>('.fx-help-badge')].find((b) => /Refresh/.test(b.getAttribute('aria-label') ?? ''));
check(!!badge, 'phone: a ? badge for the control you can see');
check(doc.querySelectorAll('.fx-help-badge').length === 1, 'and none for controls covered by something else');
const r0 = refreshed;
await act(async () => { pointer('pointerdown', badge!, 'touch'); click(badge!); await sleep(10); });
check(!!tip() && tip()?.textContent?.includes('Refresh'), 'tapping the badge shows the tooltip');
check(refreshed === r0, 'and leaves the control alone');
await act(async () => { rt.setHelpMode(false); await sleep(20); });
check(!doc.querySelector('.fx-help-badge') && !tip(), 'off: no badges, no tooltip');
await act(async () => { root2.unmount(); });

console.log(fail ? `✗ ${fail} failed, ${ok} passed` : `✓ Help mode in the DOM — ${ok} checks`);
process.exit(fail ? 1 : 0);
