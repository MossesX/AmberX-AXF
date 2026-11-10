/**
 * Inline edit — the right-click capture layer (build inline-element-editing-plugin-right-click-any-el s3, Fable).
 *
 * Active only while inline edit mode is on (the master switch, `INLINE_EDIT_MODE_KEY`, a device setting in the main
 * application settings). On: ONE `contextmenu` listener in the capture phase on `document`. It hit-tests to the deepest
 * addressed element (inline-edit-tokens@1: `elementFromPoint`, else the event target, then the nearest element with a
 * path of its own), builds the parent chain from the path and emits `axf:inline-edit-open`. Off: the listener is not
 * attached at all, so the framework's own context menu (react/components/Overlays.tsx), the chrome menu (Settings /
 * Change / Move) and the browser's menu behave exactly as before.
 *
 * It leaves native and app context menus alone whenever it has nothing to say: a hit outside every framework root,
 * inside a text field / contenteditable, inside an open context menu (`.fx-ctx`), on `[data-axf-inline-ignore]`, or
 * with Alt held (the escape hatch to the native menu while the mode is on) passes through untouched.
 *
 * No React, no runtime import: `createInlineEditCapture({ doc, onOpen })` works on any document-like object (a browser
 * document, jsdom, a test fake with addEventListener / removeEventListener / elementFromPoint / dispatchEvent).
 * `bindInlineEditMode(capture, settings)` ties it to the master switch. Kotlin twin deferred (framework/spec/PORTING.md).
 */
import { addressOf, chainOf } from '../tokens/element-map.mjs';

export const INLINE_EDIT_MODE_KEY = 'axf.inline-edit.mode';
export const INLINE_EDIT_OPEN_EVENT = 'axf:inline-edit-open';
export const INLINE_EDIT_IGNORE_ATTR = 'data-axf-inline-ignore';
/** Elements a right-click must keep for themselves (text editing, an open menu, anything that asked to be left alone). */
export const INLINE_EDIT_PASS_SELECTOR = `input, textarea, select, [contenteditable=""], [contenteditable="true"], .fx-ctx, [${INLINE_EDIT_IGNORE_ATTR}]`;

const closest = (el, sel) => (el && typeof el.closest === 'function' ? el.closest(sel) : null);

/**
 * The address the right-click lands on, or null when the layer must pass: `{ path, chain, root, role, element, owners,
 * target }`. `target` is the deepest DOM element under the pointer (what was hit), `element` the owner of the path.
 */
export function hitTest(doc, ev) {
  const x = Number(ev?.clientX);
  const y = Number(ev?.clientY);
  let target = (Number.isFinite(x) && Number.isFinite(y) && typeof doc?.elementFromPoint === 'function' ? doc.elementFromPoint(x, y) : null) ?? ev?.target ?? null;
  if (!target || typeof target.getAttribute !== 'function') return null;
  if (closest(target, INLINE_EDIT_PASS_SELECTOR)) return null;
  const a = addressOf(target);
  if (!a) return null;
  return { path: a.path, chain: chainOf(a.path), root: a.rootText, role: a.role, element: a.element, owners: a.owners, target, own: a.own, x, y };
}

/**
 * `createInlineEditCapture({ doc, onOpen, emit = true })` → `{ enable(), disable(), enabled, handle(ev) }`.
 * `onOpen(detail)` is called for every capture (the plugin opens its dialog); with `emit` the same detail is also
 * dispatched as a `CustomEvent(INLINE_EDIT_OPEN_EVENT)` on the document, so anything else can listen without a handle.
 */
export function createInlineEditCapture({ doc = globalThis.document, onOpen, emit = true } = {}) {
  if (!doc || typeof doc.addEventListener !== 'function') throw new Error('createInlineEditCapture: a document');
  let on = false;
  const handle = (ev) => {
    if (!on) return false;
    if (ev?.altKey) return false; // Alt + right-click: the native menu, even in inline edit mode
    if (ev?.defaultPrevented) return false; // someone before us (a window drag, a long-press) owns this one
    const hit = hitTest(doc, ev);
    if (!hit) return false;
    ev.preventDefault?.();
    ev.stopImmediatePropagation?.();
    const detail = { $axf: 'inline-edit-open@1', ...hit };
    if (typeof onOpen === 'function') onOpen(detail);
    if (emit && typeof doc.dispatchEvent === 'function') {
      const Ctor = globalThis.CustomEvent;
      if (typeof Ctor === 'function') doc.dispatchEvent(new Ctor(INLINE_EDIT_OPEN_EVENT, { detail, bubbles: false, cancelable: false }));
    }
    return true;
  };
  return {
    get enabled() { return on; },
    handle,
    enable() {
      if (on) return;
      on = true;
      doc.addEventListener('contextmenu', handle, true); // capture phase: before the framework's bubble-phase listener
    },
    disable() {
      if (!on) return;
      on = false;
      doc.removeEventListener('contextmenu', handle, true);
    },
  };
}

/** Is the master switch on? Accepts the saved value in any shape a settings store may hand back. */
export const inlineEditModeOn = (value) => value === true || value === 'true' || value === 'on' || value === 1;

/**
 * Tie a capture to the master switch: enabled while `settings.get(INLINE_EDIT_MODE_KEY)` is on, following changes
 * through `settings.onChange(key, fn)` (the runtime's settings) or `settings.subscribe(fn)`. Returns an unbind that also
 * disables the capture. The capture is attached only while the switch is on: off = nothing listens.
 */
export function bindInlineEditMode(capture, settings) {
  const apply = () => { if (inlineEditModeOn(settings.get(INLINE_EDIT_MODE_KEY))) capture.enable(); else capture.disable(); };
  apply();
  let off = () => {};
  if (typeof settings.onChange === 'function') off = settings.onChange(INLINE_EDIT_MODE_KEY, apply);
  else if (typeof settings.subscribe === 'function') off = settings.subscribe(apply);
  return () => { off(); capture.disable(); };
}
