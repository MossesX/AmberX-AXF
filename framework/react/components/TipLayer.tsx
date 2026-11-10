import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { placeTip } from '../placeTip';

/**
 * Styled tooltips for chrome (menus, menu bar, toolbars, context menus, nav): every icon, status slot and value there
 * carries a `title` (menu-item@2: "hover explains icons"); this layer shows it as a themed tip instead of the browser's
 * plain one. On hover (after a short delay) or keyboard focus, the element's `title` moves to `data-fx-tip` so the
 * native tooltip never shows twice, and comes back when the pointer or focus leaves; the DOM keeps its `title` at rest,
 * so screen readers, tests and anything outside these surfaces are unchanged. Opt any other region in with
 * `data-fx-tips`. Placement: below the element, above when there is no room, clamped inside the window.
 */
const SCOPE = '.fx-menu, .fx-menubar, .fx-toolbar, .fx-ctx, .fx-dropdown, .fx-nav, .fx-banner, [data-fx-tips]';
const DELAY_MS = 380;

interface Tip { text: string; rect: { left: number; top: number; bottom: number; width: number } }

function tipTarget(node: EventTarget | null): HTMLElement | null {
  if (!(node instanceof Element)) return null;
  const el = node.closest<HTMLElement>('[title], [data-fx-tip]');
  if (!el || !el.closest(SCOPE)) return null;
  return el;
}

function take(el: HTMLElement): string {
  const t = el.getAttribute('title');
  if (t) { el.setAttribute('data-fx-tip', t); el.removeAttribute('title'); return t; }
  return el.getAttribute('data-fx-tip') ?? '';
}

function giveBack(el: HTMLElement) {
  const t = el.getAttribute('data-fx-tip');
  el.removeAttribute('data-fx-tip');
  // the app may have set a new title while the tip was up: keep that one
  if (t && !el.hasAttribute('title')) el.setAttribute('title', t);
}

export function TipLayer() {
  const [tip, setTip] = useState<Tip | null>(null);
  const cur = useRef<HTMLElement | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const box = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const hide = () => {
      window.clearTimeout(timer.current);
      if (cur.current) giveBack(cur.current);
      cur.current = null;
      setTip(null);
    };
    const show = (el: HTMLElement, delay: number) => {
      if (cur.current === el) return;
      hide();
      const text = take(el).trim();
      if (!text) { giveBack(el); return; }
      cur.current = el;
      timer.current = window.setTimeout(() => {
        if (cur.current !== el || !el.isConnected) return;
        const r = el.getBoundingClientRect();
        setTip({ text, rect: { left: r.left, top: r.top, bottom: r.bottom, width: r.width } });
      }, delay);
    };
    const over = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      const el = tipTarget(e.target);
      if (el) show(el, DELAY_MS);
      else if (cur.current) hide();
    };
    const out = (e: PointerEvent) => {
      if (cur.current && !(e.relatedTarget instanceof Node && cur.current.contains(e.relatedTarget))) hide();
    };
    const focus = (e: FocusEvent) => {
      const el = tipTarget(e.target);
      if (el && (e.target as Element).matches?.(':focus-visible')) show(el, DELAY_MS);
      else if (cur.current) hide();
    };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape' && cur.current) hide(); };
    document.addEventListener('pointerover', over, true);
    document.addEventListener('pointerout', out, true);
    document.addEventListener('focusin', focus, true);
    document.addEventListener('focusout', hide, true);
    document.addEventListener('pointerdown', hide, true);
    document.addEventListener('keydown', key, true);
    window.addEventListener('scroll', hide, true);
    window.addEventListener('blur', hide);
    return () => {
      hide();
      document.removeEventListener('pointerover', over, true);
      document.removeEventListener('pointerout', out, true);
      document.removeEventListener('focusin', focus, true);
      document.removeEventListener('focusout', hide, true);
      document.removeEventListener('pointerdown', hide, true);
      document.removeEventListener('keydown', key, true);
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('blur', hide);
    };
  }, []);

  // place it once its size is known: below the element, above when there is no room, inside the window
  useLayoutEffect(() => {
    const el = box.current;
    if (!el || !tip) return;
    const p = placeTip(tip.rect, { w: el.offsetWidth, h: el.offsetHeight }, { w: window.innerWidth, h: window.innerHeight });
    el.style.setProperty('--fx-tip-x', `${Math.round(p.left)}px`);
    el.style.setProperty('--fx-tip-y', `${Math.round(p.top)}px`);
    el.dataset.fxSide = p.side;
    el.dataset.fxReady = 'on';
  }, [tip]);

  if (!tip) return null;
  return (
    <div ref={box} className="fx-tip" role="tooltip">
      {tip.text}
    </div>
  );
}
