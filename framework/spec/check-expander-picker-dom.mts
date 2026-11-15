/**
 * expander-picker@1 in a DOM (jsdom): the behaviour Brett asked for, pressed for real (Nov 13 2026: "a row with a name and a
 * little arrow; when you press that arrow it expands a subgrid; you got to press it again to apply it and close it").
 *
 *   cd framework && npm install && cd .. && npx -y tsx framework/spec/check-expander-picker-dom.mts
 *
 *   collapsed   one row: the name, the current value, the arrow; the grid is closed and hidden from focus and readers
 *   open        a press on the row (or the arrow inside it) unfolds the grid in place, in the flow (nothing floats)
 *   one press   on an option highlights it, previews it (onPreview), nothing is applied, the grid stays open
 *   again       the same option again applies it (onChange once) and the grid closes; the row shows the new value
 *   other ways  the row pressed while an option is highlighted applies it; Escape closes without applying and takes the
 *               preview back; first-press assets apply at once; disabled options do nothing
 *   keyboard    arrows / Home / End move the highlight and focus, Enter on the highlighted option applies
 *   API         console-control@1 `setting:<label>`: state reads value / options / open / highlight, set applies and closes
 *               without the UI, press opens and (with a highlight) applies, an unknown value is refused
 */
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://console.example.test/', pretendToBeVisual: true });
const g = globalThis as Record<string, unknown>;
for (const k of ['window', 'document', 'navigator', 'HTMLElement', 'Node', 'Element', 'Event', 'CustomEvent', 'MouseEvent', 'KeyboardEvent', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'localStorage', 'sessionStorage'] as const) {
  const v = (dom.window as unknown as Record<string, unknown>)[k];
  if (v !== undefined) Object.defineProperty(g, k, { value: typeof v === 'function' && !/^[A-Z]/.test(k) ? (v as (...a: unknown[]) => unknown).bind(dom.window) : v, configurable: true, writable: true });
}
(dom.window as unknown as { matchMedia: unknown }).matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
g.matchMedia = (dom.window as unknown as { matchMedia: unknown }).matchMedia;
g.IS_REACT_ACT_ENVIRONMENT = true;

const React = await import('react');
g.React = React;
const { createElement: h, act, useState } = React;
const { createRoot } = await import('react-dom/client');
const { ExpanderPicker } = await import('../react/components/ExpanderPicker.tsx');

let checks = 0;
const ok = (c: unknown, msg: string) => { assert.ok(c, msg); checks++; };
const eq = (a: unknown, b: unknown, msg: string) => { assert.deepEqual(a, b, msg); checks++; };

const OPTIONS = [
  { value: 'dark', label: 'Dark', text: 'Low light', swatch: 'black' },
  { value: 'light', label: 'Light' },
  { value: 'sepia', label: 'Sepia' },
  { value: 'off', label: 'Off', disabled: true },
];

function mount(asset?: Record<string, unknown>) {
  const changes: string[] = [];
  const previews: (string | null)[] = [];
  function Host() {
    const [v, setV] = useState('dark');
    return h('div', null,
      h(ExpanderPicker, { label: 'Theme', value: v, options: OPTIONS, onChange: (x: string) => { changes.push(x); setV(x); }, onPreview: (x: string | null) => previews.push(x), asset: asset ?? null, hint: 'How the app looks' }),
      h('p', { id: 'below' }, 'content below'));
  }
  const el = document.createElement('div');
  document.body.appendChild(el);
  const root = createRoot(el);
  act(() => root.render(h(Host)));
  const q = <T extends Element = HTMLElement>(s: string) => el.querySelector(s) as T;
  const tiles = () => [...el.querySelectorAll<HTMLButtonElement>('.fx-pick__tile')];
  const tile = (label: string) => tiles().find((t) => t.querySelector('.fx-pick__title')?.textContent === label)!;
  const click = (n: Element) => act(() => { (n as HTMLElement).click(); });
  const key = (n: Element, k: string) => act(() => { n.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: k, bubbles: true })); });
  const isOpen = () => q('.fx-pick').getAttribute('data-fx-pick-open') === 'on';
  return { el, root, q, tiles, tile, click, key, isOpen, changes, previews };
}

/* ---- s3 collapsed ---- */
{
  const p = mount();
  const row = p.q<HTMLButtonElement>('.fx-pick__row');
  eq([...row.children].map((c) => c.className.trim().split(' ')[0]), ['fx-pick__name', 'fx-pick__value', 'fx-pick__arrow'], 'collapsed row: name, value, arrow');
  eq(p.q('.fx-pick__name').textContent, 'Theme', 'the name is in the row');
  eq(p.q('.fx-pick__value').textContent, 'Dark', 'the row shows the current value');
  ok(!p.el.querySelector('label.fx-field__label'), 'no separate label above the row');
  eq(row.getAttribute('aria-expanded'), 'false', 'collapsed: aria-expanded false');
  const names = row.getAttribute('aria-labelledby')!.split(' ').map((id) => document.getElementById(id)?.textContent);
  eq(names, ['Theme', 'Dark'], 'a reader hears the name and the value');
  eq(document.getElementById(row.getAttribute('aria-describedby')!)?.textContent, 'How the app looks', 'the hint describes the row');
  ok(!p.isOpen() && p.q('.fx-pick__sub').getAttribute('aria-hidden') === 'true', 'the grid starts closed and hidden from readers');
  ok(p.tiles().every((t) => t.tabIndex === -1), 'closed tiles are out of the tab order');

  /* ---- s4 expand ---- */
  p.click(row);
  ok(p.isOpen(), 'a press on the row opens the grid');
  eq(row.getAttribute('aria-expanded'), 'true', 'open: aria-expanded true');
  eq(p.q('.fx-pick__sub').getAttribute('aria-hidden'), 'false', 'open: the grid is exposed');
  eq(p.tiles().length, 4, 'every option is a tile');
  ok(p.q('.fx-pick').nextElementSibling?.matches('.fx-field__hint') && p.el.querySelector('#below'), 'the grid lives in the flow, content below follows it');
  ok(p.tile('Dark').querySelector('.fx-pick__swatch'), 'a swatch previews on its tile');
  eq(p.tiles().filter((t) => t.tabIndex === 0).map((t) => t.textContent?.includes('Dark')), [true], 'the applied option is the one tab stop');
  p.click(row);
  ok(!p.isOpen(), 'a press on the row again with nothing highlighted closes it');
  eq(p.changes, [], 'nothing applied');
  p.click(p.q('.fx-pick__arrow'));
  ok(p.isOpen(), 'a press on the arrow opens it too');

  /* ---- s5 one press highlights ---- */
  p.click(p.tile('Light'));
  ok(p.isOpen(), 'one press keeps the grid open');
  eq(p.changes, [], 'one press applies nothing');
  eq(p.tile('Light').getAttribute('data-armed'), 'on', 'the pressed option is highlighted');
  eq(p.tile('Light').getAttribute('aria-selected'), 'false', 'highlighted is not selected yet');
  eq(p.tile('Dark').getAttribute('aria-selected'), 'true', 'the applied option stays selected');
  eq(p.previews, ['light'], 'the highlight previews through onPreview');
  ok(p.tile('Light').querySelector('.fx-pick__hint')?.textContent === 'Press again to apply', 'the tile says to press again');
  ok(p.q('.fx-pick__pending')?.textContent?.includes('Light'), 'the row shows what is waiting');
  p.click(p.tile('Sepia'));
  eq(p.tile('Sepia').getAttribute('data-armed'), 'on', 'another option moves the highlight');
  eq(p.tile('Light').getAttribute('data-armed'), 'off', 'only one highlight');
  eq(p.previews, ['light', 'sepia'], 'and previews it');

  /* ---- s6 same option again applies and closes ---- */
  p.click(p.tile('Sepia'));
  eq(p.changes, ['sepia'], 'the same option again applies it, once');
  ok(!p.isOpen(), 'and the grid closes');
  eq(p.q('.fx-pick__value').textContent, 'Sepia', 'the row shows the new value');
  ok(!p.q('.fx-pick__pending'), 'nothing waiting');
  eq(document.activeElement, p.q('.fx-pick__row'), 'focus goes back to the row');

  /* row pressed while highlighted applies */
  p.click(p.q('.fx-pick__row'));
  p.click(p.tile('Light'));
  p.click(p.q('.fx-pick__row'));
  eq(p.changes, ['sepia', 'light'], 'the row (arrow) pressed while an option is highlighted applies it');
  ok(!p.isOpen(), 'and closes');

  /* Escape */
  p.click(p.q('.fx-pick__row'));
  p.click(p.tile('Dark'));
  p.key(p.tile('Dark'), 'Escape');
  ok(!p.isOpen(), 'Escape closes');
  eq(p.changes, ['sepia', 'light'], 'Escape applies nothing');
  eq(p.previews.at(-1), null, 'Escape takes the preview back');
  eq(p.q('.fx-pick__value').textContent, 'Light', 'the value is unchanged');

  /* disabled option */
  p.click(p.q('.fx-pick__row'));
  ok(p.tile('Off').disabled, 'a disabled option is a disabled button');
  p.click(p.tile('Off'));
  eq(p.tiles().filter((t) => t.getAttribute('data-armed') === 'on').length, 0, 'a disabled option cannot be highlighted');

  /* keyboard */
  p.key(p.tile('Light'), 'ArrowRight');
  eq(p.tile('Sepia').getAttribute('data-armed'), 'on', 'ArrowRight moves the highlight');
  eq(document.activeElement, p.tile('Sepia'), 'and focus');
  p.key(p.tile('Sepia'), 'ArrowRight');
  eq(p.tile('Dark').getAttribute('data-armed'), 'on', 'disabled options are skipped and the highlight wraps');
  p.key(p.tile('Dark'), 'End');
  eq(p.tile('Sepia').getAttribute('data-armed'), 'on', 'End goes to the last enabled option');
  p.key(p.tile('Sepia'), 'Home');
  eq(p.tile('Dark').getAttribute('data-armed'), 'on', 'Home goes to the first');
  p.click(p.tile('Dark')); // Enter / Space on a focused button is a click
  eq(p.changes, ['sepia', 'light', 'dark'], 'pressing the highlighted option applies it');
  ok(!p.isOpen(), 'and closes');

  /* s7 screen reader + keyboard open */
  const live = p.q('.fx-pick__live');
  eq(live.getAttribute('aria-live'), 'polite', 'a polite live region');
  eq(live.textContent, 'Dark applied', 'it says what was applied');
  p.key(p.q('.fx-pick__row'), 'ArrowDown');
  ok(p.isOpen(), 'ArrowDown on the closed row opens it');
  eq(document.activeElement, p.tile('Dark'), 'opening from the keyboard puts focus on the applied option');
  p.click(p.tile('Light'));
  eq(live.textContent, 'Light highlighted, press again to apply', 'it says what is highlighted and what to do');
  p.key(p.q('.fx-pick__row'), 'Escape');
  ok(!p.isOpen(), 'Escape on the row closes');
  eq(p.changes.at(-1), 'dark', 'without applying');
  act(() => p.q('.fx-pick__row').focus());
  p.click(p.q('.fx-pick__row'));
  ok(document.activeElement === p.q('.fx-pick__row'), 'a pointer press leaves focus where it is');
  p.click(p.q('.fx-pick__row'));
  act(() => p.root.unmount());
}

/* ---- first-press asset ---- */
{
  const p = mount({ tiles: 'chips', arrow: 'chevron', apply: 'first-press' });
  p.click(p.q('.fx-pick__row'));
  p.click(p.tile('Sepia'));
  eq(p.changes, ['sepia'], 'first-press: one press applies');
  ok(!p.isOpen(), 'first-press: and closes');
  act(() => p.root.unmount());
}

/* ---- preview off ---- */
{
  const p = mount({ tiles: 'cards', arrow: 'chevron', preview: false });
  p.click(p.q('.fx-pick__row'));
  p.click(p.tile('Sepia'));
  eq(p.previews, [], 'preview off: onPreview is not called');
  act(() => p.root.unmount());
}

/* ---- s6 the same through the API (console-control@1: REST, MCP console actions, axf control, voice all run this) ---- */
{
  const { readdirSync, readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { AxfRuntime } = await import('../core/runtime.ts');
  const { AxfProvider } = await import('../react/AxfProvider.tsx');
  const { controlRegistry } = await import('../react/controlTargets.ts');
  const assetsDir = new URL('../assets/', import.meta.url).pathname;
  const assets = readdirSync(assetsDir).flatMap((t) => readdirSync(join(assetsDir, t)).filter((x) => x.endsWith('.json')).map((x) => JSON.parse(readFileSync(join(assetsDir, t, x), 'utf8'))));
  const defaults = JSON.parse(readFileSync(new URL('../defaults.json', import.meta.url), 'utf8'));
  const rt = new AxfRuntime({ manifest: { app: { id: 'pick-test', name: 'Test' }, defaults } as never, assets, storageKey: 'test:pick' });
  const reg = controlRegistry(rt);
  const changes: string[] = [];
  function Host() {
    const [v, setV] = useState('dark');
    return h(ExpanderPicker, { label: 'Theme', value: v, options: OPTIONS, onChange: (x: string) => { changes.push(x); setV(x); } });
  }
  const el = document.createElement('div');
  document.body.appendChild(el);
  const root = createRoot(el);
  act(() => root.render(h(AxfProvider, { runtime: rt }, h(Host))));
  const run = async (cmd: Record<string, unknown>) => { let r: unknown; await act(async () => { r = await reg.run(cmd); }); return r as { ok: boolean; state?: Record<string, unknown>; error?: unknown }; };
  const isOpen = () => el.querySelector('.fx-pick')!.getAttribute('data-fx-pick-open') === 'on';

  ok(reg.entry('setting:theme'), 'every picker is the target setting:<label slug>');
  const st = await run({ verb: 'state', address: 'setting:theme' });
  ok(st.ok, 'state answers');
  const s0 = JSON.stringify(st);
  ok(s0.includes('"dark"') && s0.includes('"sepia"') && s0.includes('"expanded":false'), 'state reads the value, the options and that it is closed');
  const set = await run({ verb: 'set', address: 'setting:theme', value: 'sepia' });
  ok(set.ok, 'set applies without the UI');
  eq(changes, ['sepia'], 'set calls onChange once');
  eq(el.querySelector('.fx-pick__value')!.textContent, 'Sepia', 'the row shows it');
  const byLabel = await run({ verb: 'set', address: 'setting:theme', value: 'Light' });
  ok(byLabel.ok && changes.at(-1) === 'light', 'set takes the option label too (voice says names)');
  const bad = await run({ verb: 'set', address: 'setting:theme', value: 'neon' });
  ok(!bad.ok && changes.length === 2, 'an unknown value is refused, nothing applied');
  const off = await run({ verb: 'set', address: 'setting:theme', value: 'off' });
  ok(!off.ok && changes.length === 2, 'a disabled option is refused');
  await run({ verb: 'press', address: 'setting:theme' });
  ok(isOpen(), 'press opens the grid');
  ok(JSON.stringify(await run({ verb: 'state', address: 'setting:theme' })).includes('"expanded":true'), 'state says it is open');
  act(() => { (el.querySelector('.fx-pick__tile:nth-child(3)') as HTMLElement).click(); });
  ok(JSON.stringify(await run({ verb: 'state', address: 'setting:theme' })).includes('"highlighted":"sepia"'), 'state reads the highlight');
  await run({ verb: 'press', address: 'setting:theme' });
  ok(!isOpen() && changes.at(-1) === 'sepia', 'press again applies the highlighted option and closes (the arrow, without the UI)');
  act(() => root.unmount());
}

console.log(`✓ expander-picker@1 DOM: ${checks} checks`);
