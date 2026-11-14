/** Small DOM helpers for the themed controls (no styling here: every look is a framework class + --fx-tc-* token). */

type Child = Node | string | null | undefined | false;

/** Create an element with attributes and children. */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string | null | undefined> = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined) el.setAttribute(k, v);
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

/** Set or remove attributes (null removes). */
export function aria(el: Element, attrs: Record<string, string | null | undefined>): void {
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === '') el.removeAttribute(k);
    else if (el.getAttribute(k) !== v) el.setAttribute(k, v);
  }
}

/** A framework button (fx-btn / fx-iconbtn), so the button asset styles it. */
export function button(label: string, opts: { cls?: string; icon?: string; tone?: string; text?: string; title?: string } = {}): HTMLButtonElement {
  const b = h('button', { type: 'button', class: `${opts.icon && !opts.text ? 'fx-iconbtn' : 'fx-btn'}${opts.tone ? ` fx-btn--${opts.tone}` : ''}${opts.cls ? ` ${opts.cls}` : ''}`, 'aria-label': label, title: opts.title ?? null });
  b.textContent = opts.text ?? label;
  return b;
}

/** Repeat while held (stepper buttons): one call at once, then after `delay` every `every` ms until released. */
export function holdRepeat(el: HTMLElement, fn: () => void, timing: () => { delay: number; every: number }): void {
  let t: ReturnType<typeof setTimeout> | null = null;
  const stop = () => { if (t !== null) { clearTimeout(t); t = null; } };
  const tick = (wait: number) => { t = setTimeout(() => { fn(); tick(timing().every); }, wait); };
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    el.setPointerCapture?.(e.pointerId);
    fn();
    tick(timing().delay);
  });
  for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture', 'blur']) el.addEventListener(ev, stop);
  // keyboard / assistive tech: a plain click (detail 0) steps once
  el.addEventListener('click', (e) => { if ((e as MouseEvent).detail === 0) fn(); });
}

/** A root token read as a number (ms, px14 sizes are not numbers): `--fx-tc-number-repeat-ms` → 80. */
export function tokenMs(name: string, dflt: number): number {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : dflt;
}
