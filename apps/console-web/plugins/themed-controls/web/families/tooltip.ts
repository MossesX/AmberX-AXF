/**
 * Themed tooltips (themed-controls@1 family `tooltip`). While active, every `title` attribute on the page moves to
 * `data-axf-tip` (so the browser's own tip never shows) and a token-styled tip (role="tooltip") shows on hover after
 * tooltip.delayMs, on keyboard focus at once, and on a long press (tooltip.longPressMs) on touch; Escape hides it.
 * Screen readers keep the text: it becomes the element's `aria-description` (and its `aria-label` when the element
 * had no name of its own, an icon button), and `aria-describedby` points at the tip while it shows; whatever
 * aria-describedby the element had stays. Switched off: every title comes back as it was.
 */
import type { AxfRuntime } from '@console/axf/core';
import type { GlobalFamily, LiveHost } from '../host';
import { h } from './dom';

const MOVED = 'data-axf-tip-moved';
const ADDED_LABEL = 'data-axf-tip-label';
const ADDED_DESC = 'data-axf-tip-desc';

const ms = (name: string, dflt: number) => { const n = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name)); return Number.isFinite(n) ? n : dflt; };
const skip = (el: Element) => !!el.closest('[data-axf-native], [contenteditable=""], [contenteditable="true"]') || el instanceof HTMLIFrameElement || el.tagName === 'LINK' || el.tagName === 'STYLE';

let visible: { el: Element; text: string } | null = null;

/** Move one element's title onto data-axf-tip (and keep it for screen readers). */
function move(el: Element): void {
  const t = el.getAttribute('title');
  if (t === null || skip(el)) return;
  el.removeAttribute('title');
  if (!t.trim()) return;
  el.setAttribute('data-axf-tip', t);
  el.setAttribute(MOVED, '');
  const named = el.hasAttribute('aria-label') || el.hasAttribute('aria-labelledby') || (el.textContent ?? '').trim() !== '';
  if (!named && !el.hasAttribute(ADDED_LABEL)) { el.setAttribute('aria-label', t); el.setAttribute(ADDED_LABEL, ''); }
  else if (el.hasAttribute(ADDED_LABEL)) el.setAttribute('aria-label', t);
  if (!el.hasAttribute('aria-description') || el.hasAttribute(ADDED_DESC)) { el.setAttribute('aria-description', t); el.setAttribute(ADDED_DESC, ''); }
}

function restore(el: Element): void {
  const t = el.getAttribute('data-axf-tip');
  if (t !== null && !el.hasAttribute('title')) el.setAttribute('title', t);
  el.removeAttribute('data-axf-tip');
  el.removeAttribute(MOVED);
  if (el.hasAttribute(ADDED_LABEL)) { el.removeAttribute('aria-label'); el.removeAttribute(ADDED_LABEL); }
  if (el.hasAttribute(ADDED_DESC)) { el.removeAttribute('aria-description'); el.removeAttribute(ADDED_DESC); }
}

export const tooltipFamily: GlobalFamily = {
  family: 'tooltip',
  start(_rt: AxfRuntime, _host: LiveHost) {
    const tip = h('div', { class: 'fx-tc fx-tc-tip', role: 'tooltip', id: 'axf-tc-tip', hidden: '' });
    document.body.append(tip);
    let showT: ReturnType<typeof setTimeout> | null = null;
    let hideT: ReturnType<typeof setTimeout> | null = null;
    let pressT: ReturnType<typeof setTimeout> | null = null;
    const clear = () => { for (const t of [showT, hideT, pressT]) if (t) clearTimeout(t); showT = hideT = pressT = null; };

    const place = (el: Element) => {
      const a = el.getBoundingClientRect();
      const at = el.getAttribute('data-axf-tip-at') || document.documentElement.getAttribute('data-fx-tc-tooltip-placement') || 'top';
      const vw = document.documentElement.clientWidth, vh = document.documentElement.clientHeight;
      const tw = tip.offsetWidth, th = tip.offsetHeight, gap = 6;
      let side = at === 'auto' ? (a.top > th + gap * 2 ? 'top' : 'bottom') : at;
      if (side === 'top' && a.top < th + gap) side = 'bottom';
      if (side === 'bottom' && vh - a.bottom < th + gap) side = 'top';
      const rtl = document.dir === 'rtl';
      if (side === 'start') side = rtl ? 'right' : 'left';
      if (side === 'end') side = rtl ? 'left' : 'right';
      let top = side === 'top' ? a.top - th - gap : side === 'bottom' ? a.bottom + gap : a.top + (a.height - th) / 2;
      let left = side === 'left' ? a.left - tw - gap : side === 'right' ? a.right + gap : a.left + (a.width - tw) / 2;
      left = Math.min(Math.max(4, left), vw - tw - 4);
      top = Math.min(Math.max(4, top), vh - th - 4);
      tip.dataset.side = side;
      tip.style.setProperty('--tc-top', `${Math.round(top)}px`);
      tip.style.setProperty('--tc-left', `${Math.round(left)}px`);
    };
    const show = (el: Element) => {
      const text = el.getAttribute('data-axf-tip');
      if (!text || !el.isConnected) return;
      if (visible && visible.el !== el) hide(true);
      tip.textContent = text;
      tip.hidden = false;
      place(el);
      const d = el.getAttribute('aria-describedby') ?? '';
      if (!d.split(/\s+/).includes(tip.id)) el.setAttribute('aria-describedby', `${d} ${tip.id}`.trim());
      visible = { el, text };
    };
    function hide(now = false) {
      const go = () => {
        if (visible) {
          const d = (visible.el.getAttribute('aria-describedby') ?? '').split(/\s+/).filter((x) => x && x !== tip.id).join(' ');
          if (d) visible.el.setAttribute('aria-describedby', d); else visible.el.removeAttribute('aria-describedby');
        }
        tip.hidden = true;
        visible = null;
      };
      if (now) go(); else { if (hideT) clearTimeout(hideT); hideT = setTimeout(go, ms('--fx-tc-tooltip-hide-ms', 100)); }
    }
    const tipOf = (t: EventTarget | null) => (t instanceof Element ? t.closest('[data-axf-tip]') : null);

    const onOver = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      const el = tipOf(e.target);
      if (!el) return;
      if (hideT) { clearTimeout(hideT); hideT = null; }
      if (visible?.el === el) return;
      if (showT) clearTimeout(showT);
      // moving between tipped elements while one shows: no second wait
      showT = setTimeout(() => show(el), visible ? 0 : ms('--fx-tc-tooltip-delay-ms', 500));
    };
    const onOut = (e: PointerEvent) => {
      const el = tipOf(e.target);
      if (!el || (e.relatedTarget instanceof Node && el.contains(e.relatedTarget))) return;
      if (showT) { clearTimeout(showT); showT = null; }
      if (visible?.el === el) hide();
    };
    const onFocus = (e: FocusEvent) => { const el = tipOf(e.target); if (el && (e.target as Element).matches?.(':focus-visible')) show(el); };
    const onBlur = (e: FocusEvent) => { if (visible && tipOf(e.target) === visible.el) hide(true); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && visible) hide(true); };
    const onDown = (e: PointerEvent) => {
      clear();
      if (visible && e.pointerType !== 'touch') hide(true);
      if (e.pointerType !== 'touch') return;
      const el = tipOf(e.target);
      if (!el) { if (visible) hide(true); return; }
      pressT = setTimeout(() => { show(el); hideT = setTimeout(() => hide(true), 2500); }, ms('--fx-tc-tooltip-long-press-ms', 500));
    };
    const onUp = () => { if (pressT) { clearTimeout(pressT); pressT = null; } };
    const onScroll = () => { if (visible) hide(true); };

    document.querySelectorAll('[title]').forEach(move);
    const obs = new MutationObserver((recs) => {
      for (const r of recs) {
        if (r.type === 'attributes' && r.target instanceof Element && r.target.hasAttribute('title')) move(r.target);
        r.addedNodes.forEach((n) => { if (n instanceof Element) { if (n.hasAttribute('title')) move(n); n.querySelectorAll('[title]').forEach(move); } });
        if (visible && !visible.el.isConnected) hide(true);
      }
    });
    obs.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['title'] });
    document.addEventListener('pointerover', onOver, true);
    document.addEventListener('pointerout', onOut, true);
    document.addEventListener('focusin', onFocus, true);
    document.addEventListener('focusout', onBlur, true);
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('pointerup', onUp, true);
    document.addEventListener('pointercancel', onUp, true);
    globalThis.addEventListener('scroll', onScroll, true);
    return () => {
      obs.disconnect();
      clear();
      hide(true);
      document.removeEventListener('pointerover', onOver, true);
      document.removeEventListener('pointerout', onOut, true);
      document.removeEventListener('focusin', onFocus, true);
      document.removeEventListener('focusout', onBlur, true);
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('pointerup', onUp, true);
      document.removeEventListener('pointercancel', onUp, true);
      globalThis.removeEventListener('scroll', onScroll, true);
      document.querySelectorAll(`[${MOVED}]`).forEach(restore);
      tip.remove();
    };
  },
  report: () => ({ tips: document.querySelectorAll(`[${MOVED}]`).length, showing: visible ? visible.text : null }),
  api: () => ({ showing: () => visible?.text ?? null }),
};
