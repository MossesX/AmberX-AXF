/**
 * The pop-up surface every picker and dialog opens on (themed-controls@1 → Phone rule): a popover anchored to the
 * field on a wide screen, a bottom sheet (drag handle, safe-area inset, swipe down to close) on a phone, or a modal
 * (dialogs). Framework surfaces only: `.fx-popover`, `.fx-backdrop` + `.fx-dialog`, so the style theme's
 * transparency, radius and shadow tokens apply. Focus moves in, Tab stays inside, Escape closes, focus goes back.
 */
import type { TcSurface } from '@console/axf/core/engines/themed-controls';
import { h } from './dom';

export interface SurfaceOpts {
  surface: TcSurface;
  /** what the popover sits next to (and focus returns to) */
  anchor: HTMLElement;
  /** accessible name of the surface */
  label: string;
  content: HTMLElement;
  /** family class for the token styles (fx-tc-pop--datetime …) */
  family: string;
  onClose?: (why: 'escape' | 'outside' | 'done' | 'api' | 'swipe') => void;
  /** where focus goes first (default: the first focusable) */
  initialFocus?: () => HTMLElement | null;
  /** modal surfaces close on a backdrop tap unless false (alert / confirm never do) */
  closeOnBackdrop?: boolean;
}

export interface OpenSurface {
  el: HTMLElement;
  close(why?: 'escape' | 'outside' | 'done' | 'api' | 'swipe'): void;
  reposition(): void;
  readonly surface: TcSurface;
}

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const open = new Set<OpenSurface>();
export const openSurfaces = (): OpenSurface[] => [...open];

export function openSurface(o: SurfaceOpts): OpenSurface {
  const returnTo = document.activeElement instanceof HTMLElement ? document.activeElement : o.anchor;
  const kind = o.surface === 'sheet' ? 'sheet' : o.surface === 'modal' ? 'modal' : 'popover';
  const panel = h('div', { class: `fx-tc fx-tc-pop fx-tc-pop--${o.family}`, role: 'dialog', 'aria-label': o.label, 'data-fx-tc-surface': kind, tabindex: '-1' });
  let root: HTMLElement;
  if (kind === 'popover') {
    panel.classList.add('fx-popover');
    root = panel;
  } else {
    panel.classList.add('fx-dialog');
    panel.setAttribute('aria-modal', 'true');
    if (kind === 'sheet') panel.append(h('div', { class: 'fx-tc-pop__handle', 'aria-hidden': 'true' }));
    root = h('div', { class: `fx-backdrop fx-tc-backdrop fx-tc-backdrop--${kind}`, 'data-fx-tc-surface': kind }, panel);
  }
  panel.append(o.content);
  document.body.append(root);

  const reposition = () => {
    if (kind !== 'popover') return;
    const a = o.anchor.getBoundingClientRect();
    const vw = document.documentElement.clientWidth, vh = document.documentElement.clientHeight;
    const pw = panel.offsetWidth, ph = panel.offsetHeight;
    const below = vh - a.bottom, above = a.top;
    const top = below >= ph + 8 || below >= above ? Math.min(a.bottom + 4, Math.max(4, vh - ph - 4)) : Math.max(4, a.top - ph - 4);
    const left = Math.min(Math.max(4, document.dir === 'rtl' ? a.right - pw : a.left), Math.max(4, vw - pw - 4));
    panel.style.setProperty('--tc-top', `${Math.round(top)}px`);
    panel.style.setProperty('--tc-left', `${Math.round(left)}px`);
  };

  let closed = false;
  const s: OpenSurface = {
    el: panel,
    surface: o.surface,
    reposition,
    close(why = 'api') {
      if (closed) return;
      closed = true;
      open.delete(s);
      document.removeEventListener('pointerdown', onOutside, true);
      document.removeEventListener('keydown', onKey, true);
      globalThis.removeEventListener('resize', reposition);
      globalThis.removeEventListener('scroll', onScroll, true);
      root.remove();
      if (returnTo.isConnected) returnTo.focus({ preventScroll: true });
      o.onClose?.(why);
    },
  };
  const onOutside = (e: PointerEvent) => {
    const t = e.target as Node;
    if (panel.contains(t) || o.anchor.contains(t)) return;
    if (kind !== 'popover' && o.closeOnBackdrop === false) return;
    if (kind !== 'popover' && t !== root) return;
    s.close('outside');
  };
  const onKey = (e: KeyboardEvent) => {
    if ([...open].pop() !== s) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); s.close('escape'); return; }
    if (e.key !== 'Tab') return;
    const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((x) => x.offsetParent !== null || x === document.activeElement);
    if (!items.length) { e.preventDefault(); return; }
    const first = items[0]!, last = items[items.length - 1]!;
    if (e.shiftKey && (document.activeElement === first || !panel.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && (document.activeElement === last || !panel.contains(document.activeElement))) { e.preventDefault(); first.focus(); }
  };
  const onScroll = (e: Event) => { if (!panel.contains(e.target as Node)) reposition(); };
  document.addEventListener('pointerdown', onOutside, true);
  document.addEventListener('keydown', onKey, true);
  globalThis.addEventListener('resize', reposition);
  globalThis.addEventListener('scroll', onScroll, true);

  // sheet: swipe the handle down to close
  if (kind === 'sheet') {
    const handle = panel.querySelector<HTMLElement>('.fx-tc-pop__handle')!;
    let y0: number | null = null;
    handle.addEventListener('pointerdown', (e) => { y0 = e.clientY; handle.setPointerCapture?.(e.pointerId); });
    handle.addEventListener('pointermove', (e) => { if (y0 !== null) panel.style.setProperty('--tc-drag', `${Math.max(0, e.clientY - y0)}px`); });
    handle.addEventListener('pointerup', (e) => { const d = y0 === null ? 0 : e.clientY - y0; y0 = null; panel.style.removeProperty('--tc-drag'); if (d > 60) s.close('swipe'); });
  }

  open.add(s);
  reposition();
  requestAnimationFrame(() => {
    reposition();
    const f = o.initialFocus?.() ?? panel.querySelector<HTMLElement>(FOCUSABLE) ?? panel;
    f.focus({ preventScroll: true });
  });
  return s;
}

/* ---------------- icons (framework icon set's stroke glyphs, drawn in currentColor) ---------------- */

const ICONS: Record<string, string> = {
  'chevron-left': 'M15 18l-6-6 6-6',
  'chevron-right': 'M9 18l6-6-6-6',
  'chevron-up': 'M18 15l-6-6-6 6',
  'chevron-down': 'M6 9l6 6 6-6',
  calendar: 'M3 5h18v16H3zM3 10h18M8 3v4M16 3v4',
  clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2',
  x: 'M18 6 6 18M6 6l12 12',
  upload: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12',
  file: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6',
  check: 'M20 6 9 17l-5-5',
  info: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 16v-4M12 8h.01',
  alert: 'M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01',
  help: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01',
  palette: 'M12 22a10 10 0 1 1 10-10c0 2.8-2.2 4-4 4h-2a2 2 0 0 0-1 3.7c.6.4 1 1 1 1.6 0 .4-.4.7-1 .7z',
};

/** An icon as inline SVG (aria-hidden), sized by the CSS (1em). */
export function icon(name: string): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'fx-tc-icon');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', ICONS[name] ?? ICONS.info!);
  svg.append(path);
  return svg;
}

/** A framework icon button (fx-iconbtn) with an SVG glyph. */
export function iconButton(label: string, name: string, cls = ''): HTMLButtonElement {
  const b = h('button', { type: 'button', class: `fx-iconbtn${cls ? ` ${cls}` : ''}`, 'aria-label': label });
  b.append(icon(name));
  return b;
}
