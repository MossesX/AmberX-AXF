/**
 * Tap-to-confirm on every toolbar (web host of core/engines/tapconfirm.ts). Installed once by <AxfProvider>, so every
 * toolbar in every app on the framework gets it with no code of its own: any element with role="toolbar" is a toolbar,
 * and any button, role="button" or link inside it is a toolbar button.
 *
 * A click whose press was a finger goes through `tapDecide`: the first tap is swallowed, the button lights up
 * (`data-axf-armed`) and a tip says what it does; a second tap on it inside the arm window lets the click through.
 * Mouse, pen and keyboard clicks pass untouched. A toolbar is left alone only when its settings switch it off
 * (Settings → Plugins → Toolbars, or that toolbar's own settings) or, in code, when it carries
 * `data-axf-tap-confirm="off"` with a `data-axf-tap-confirm-reason` (check-toolbars.mjs refuses one without a reason).
 */
import { TAP_IDLE, tapConfig, tapDecide, tapPointer, toolbarIdOf, type TapState } from '../core/engines/tapconfirm';
import { placeTip } from './placeTip';

const BUTTONS = 'button, [role="button"], a[href]';
/** A click this long after the press that started it is no longer that press (a keyboard or synthetic click). */
const PRESS_MS = 1500;

export interface TapConfirmHost { dispose(): void }

/** The toolbar element a button belongs to, or null when it isn't in one (or that toolbar opted out in code). */
export function toolbarOf(btn: Element): HTMLElement | null {
  const bar = btn.closest<HTMLElement>('[role="toolbar"]');
  if (!bar || bar.dataset.axfTapConfirm === 'off') return null;
  return bar;
}

/** The settings id of a toolbar element (`data-axf-toolbar`, `data-axf-toolbar-asset`, else its aria-label). */
export function toolbarElementId(bar: HTMLElement): string {
  return toolbarIdOf({ id: bar.dataset.axfToolbar, asset: bar.dataset.axfToolbarAsset, label: bar.getAttribute('aria-label') });
}

/** What a button does, for its tip: `data-axf-tip`, else its title, aria-label or text. */
export function tipTextOf(btn: Element): string {
  const el = btn as HTMLElement;
  return (el.dataset?.axfTip || el.getAttribute('title') || el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 160);
}

/**
 * Install the behaviour on a document. `get` reads a setting (the runtime's SettingsRegistry). Returns a handle whose
 * `dispose` removes every listener, the tip and any lit button.
 */
export function installTapConfirm(doc: Document, get: (key: string) => unknown, now: () => number = () => Date.now()): TapConfirmHost {
  const ids = new WeakMap<Element, string>();
  let seq = 0;
  const keyOf = (el: Element) => { let k = ids.get(el); if (!k) { k = `b${++seq}`; ids.set(el, k); } return k; };
  let press: { type: string; at: number; target: EventTarget | null } | null = null;
  let state: TapState = TAP_IDLE;
  let lit: HTMLElement | null = null;
  let tip: HTMLDivElement | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const clear = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    lit?.removeAttribute('data-axf-armed');
    lit?.style.removeProperty('--fx-tap-arm-ms');
    lit = null;
    tip?.remove();
    tip = null;
    state = TAP_IDLE;
  };

  const showTip = (btn: HTMLElement) => {
    const text = tipTextOf(btn);
    tip = doc.createElement('div');
    tip.className = 'fx-taptip';
    tip.setAttribute('role', 'status');
    tip.setAttribute('aria-live', 'polite');
    if (text) { const t = doc.createElement('span'); t.className = 'fx-taptip__text'; t.textContent = text; tip.appendChild(t); }
    const hint = doc.createElement('span');
    hint.className = 'fx-taptip__hint';
    hint.textContent = 'Tap again to run';
    tip.appendChild(hint);
    doc.body.appendChild(tip);
    const view = doc.defaultView;
    const at = placeTip(btn.getBoundingClientRect(), { w: tip.offsetWidth, h: tip.offsetHeight }, { w: view?.innerWidth ?? 0, h: view?.innerHeight ?? 0 });
    tip.dataset.side = at.side;
    tip.style.left = `${at.left}px`;
    tip.style.top = `${at.top}px`;
  };

  const onPress = (e: PointerEvent) => { press = { type: e.pointerType, at: now(), target: e.target }; };

  const onClick = (e: MouseEvent) => {
    const btn = (e.target as Element | null)?.closest?.<HTMLElement>(BUTTONS);
    if (!btn || (btn as HTMLButtonElement).disabled || btn.getAttribute('aria-disabled') === 'true') return;
    const bar = toolbarOf(btn);
    if (!bar) return;
    const fresh = press && now() - press.at <= PRESS_MS && press.target instanceof Node && btn.contains(press.target);
    const pointer = tapPointer(fresh && e.detail > 0 ? press!.type : '');
    const cfg = tapConfig(get, toolbarElementId(bar));
    const d = tapDecide(state, { pointer, target: keyOf(btn), now: now() }, cfg);
    if (d.outcome === 'run') { clear(); return; }
    e.preventDefault();
    e.stopImmediatePropagation();
    clear();
    state = d.state;
    lit = btn;
    btn.setAttribute('data-axf-armed', '');
    btn.style.setProperty('--fx-tap-arm-ms', `${cfg.armMs}ms`);
    showTip(btn);
    timer = setTimeout(clear, cfg.armMs);
  };

  // Capture on the document runs before React's root listener, so a swallowed tap never reaches the button's onClick.
  doc.addEventListener('pointerdown', onPress, true);
  doc.addEventListener('click', onClick, true);
  return {
    dispose() {
      doc.removeEventListener('pointerdown', onPress, true);
      doc.removeEventListener('click', onClick, true);
      clear();
    },
  };
}
