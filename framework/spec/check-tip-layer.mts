/**
 * Styled tooltips on chrome (components/TipLayer.tsx, build molly-flagship-skin s6), in a DOM (jsdom): hovering an
 * element with a `title` inside a menu, menu bar, toolbar, context menu, nav or banner shows a themed tip after a short
 * delay, the native title is held back while it shows (no double tooltip) and comes back when the pointer leaves;
 * nothing outside those surfaces is touched; Escape and a press hide it; touch never shows one.
 *
 *   cd framework && npm install && cd .. && npx -y tsx framework/spec/check-tip-layer.mts
 */
import { JSDOM, VirtualConsole } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://console.example.test/', pretendToBeVisual: true, virtualConsole: new VirtualConsole().sendTo(console) });
const g = globalThis as Record<string, unknown>;
for (const k of ['window', 'document', 'navigator', 'HTMLElement', 'Node', 'Element', 'Event', 'MouseEvent', 'KeyboardEvent', 'FocusEvent', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame'] as const) {
  const v = (dom.window as unknown as Record<string, unknown>)[k];
  if (v !== undefined) Object.defineProperty(g, k, { value: typeof v === 'function' && !/^[A-Z]/.test(k) ? (v as (...a: unknown[]) => unknown).bind(dom.window) : v, configurable: true, writable: true });
}
// jsdom has no PointerEvent: a MouseEvent with a pointerType is what the layer reads
class PointerEvt extends dom.window.MouseEvent { pointerType: string; constructor(type: string, init: MouseEventInit & { pointerType?: string } = {}) { super(type, init); this.pointerType = init.pointerType ?? 'mouse'; } }
g.IS_REACT_ACT_ENVIRONMENT = true;

const React = await import('react');
g.React = React;
const { createElement: h, act } = React;
const { createRoot } = await import('react-dom/client');
const { TipLayer } = await import('../react/components/TipLayer.tsx');

let ok = 0, fail = 0;
const check = (cond: unknown, msg: string) => { if (cond) ok++; else { fail++; console.log(`✗ ${msg}`); } };
const wait = (ms: number) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const ptr = (type: string, el: Element, init: { pointerType?: string; relatedTarget?: Element | null } = {}) => act(() => { el.dispatchEvent(new PointerEvt(type, { bubbles: true, ...init })); });

document.body.innerHTML = `
  <ul class="fx-menu"><li><button id="row" title="Opens axHub">axHub <span id="icon" title="axHub connection: Connected">●</span></button></li></ul>
  <main><button id="plain" title="A plain button">Plain</button></main>
  <div id="host"></div>`;
const root = createRoot(document.getElementById('host')!);
await act(() => { root.render(h(TipLayer)); });
const tip = () => document.querySelector('.fx-tip');
const icon = document.getElementById('icon')!;
const row = document.getElementById('row')!;
const plain = document.getElementById('plain')!;

/* hover inside a menu → a tip after the delay, the native title held back */
await ptr('pointerover', icon);
check(!tip(), 'no tip before the delay');
check(icon.getAttribute('title') === null && icon.getAttribute('data-fx-tip') === 'axHub connection: Connected', 'the title moves to data-fx-tip while hovered (no native tooltip)');
await wait(450);
check(tip()?.textContent === 'axHub connection: Connected', 'the tip shows the title text after the delay');
check(tip()?.getAttribute('role') === 'tooltip', 'the tip is a role=tooltip');
check(tip()?.getAttribute('data-fx-ready') === 'on' && /px$/.test((tip() as HTMLElement).style.getPropertyValue('--fx-tip-x')), 'the tip is placed (position as CSS variables) and fades in');

/* leaving gives the title back */
await ptr('pointerout', icon, { relatedTarget: plain });
check(!tip(), 'leaving hides the tip');
check(icon.getAttribute('title') === 'axHub connection: Connected' && !icon.hasAttribute('data-fx-tip'), 'leaving gives the title back');

/* the innermost titled element wins: the icon's title, not the row's */
await ptr('pointerover', row);
await wait(450);
check(tip()?.textContent === 'Opens axHub', 'the row explains itself too');
await ptr('pointerover', icon);
await wait(450);
check(tip()?.textContent === 'axHub connection: Connected', 'moving onto the icon switches to its tip');
check(row.getAttribute('title') === 'Opens axHub', 'the row got its title back when the icon took over');

/* Escape and a press hide it */
await act(() => { document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
check(!tip() && icon.getAttribute('title') === 'axHub connection: Connected', 'Escape hides the tip and restores the title');
await ptr('pointerover', icon);
await wait(450);
await ptr('pointerdown', icon);
check(!tip(), 'a press hides the tip');

/* outside chrome nothing happens; touch never shows one */
await ptr('pointerover', plain);
await wait(450);
check(!tip() && plain.getAttribute('title') === 'A plain button', 'an element outside chrome keeps its native title and gets no tip');
await ptr('pointerover', icon, { pointerType: 'touch' });
await wait(450);
check(!tip() && icon.getAttribute('title') === 'axHub connection: Connected', 'touch never shows a tip');

/* the app changing the title while the tip is up: the new one stays */
await ptr('pointerover', icon);
await wait(450);
icon.setAttribute('title', 'axHub connection: axHub unreachable');
await ptr('pointerout', icon, { relatedTarget: plain });
check(icon.getAttribute('title') === 'axHub connection: axHub unreachable', 'a title the app set while hovered is kept');

await act(() => { root.unmount(); });
console.log(`check-tip-layer: ${ok} ok, ${fail} failed`);
process.exit(fail ? 1 : 0);
