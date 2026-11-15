/*
 * Inspector / picker mode: while `picking` is on, the element under the pointer is outlined and the next click (or
 * tap) selects it in the UI Manager instead of acting on the console. Escape cancels. The window itself is never
 * picked (web/live.ts OWN_ROOT).
 */
import type { UiElement } from '../../../../../framework/core/engines/ui-manager-rules.mjs';
import { elementAt, OWN_ROOT } from './live';

const HOVER = 'axp-uim-hover';
const PICKING = 'axp-uim-picking';

export function startPicker(elements: () => UiElement[], onPick: (e: UiElement | null) => void): () => void {
  let hovered: Element | null = null;
  const clear = () => { hovered?.classList.remove(HOVER); hovered = null; };
  const over = (ev: PointerEvent) => {
    const t = ev.target instanceof Element ? ev.target : null;
    if (!t || t.closest(OWN_ROOT)) { clear(); return; }
    if (t !== hovered) { clear(); hovered = t; t.classList.add(HOVER); }
  };
  const click = (ev: MouseEvent) => {
    const t = ev.target instanceof Element ? ev.target : null;
    if (!t || t.closest(OWN_ROOT)) return;
    ev.preventDefault(); ev.stopPropagation();
    stop();
    onPick(elementAt(t, elements()));
  };
  const key = (ev: KeyboardEvent) => { if (ev.key === 'Escape') { stop(); onPick(null); } };
  function stop() {
    clear();
    document.documentElement.classList.remove(PICKING);
    removeEventListener('pointerover', over, true); removeEventListener('click', click, true); removeEventListener('keydown', key, true);
  }
  document.documentElement.classList.add(PICKING);
  addEventListener('pointerover', over, true); addEventListener('click', click, true); addEventListener('keydown', key, true);
  return stop;
}
