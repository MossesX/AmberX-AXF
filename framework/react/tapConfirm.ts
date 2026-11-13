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
 *
 * The same reaches tab groups (role="tablist"), navigation menus (nav[data-axf-nav]) and the application menu bar
 * (role="menubar"; its open drop-downs, role="menu", are left alone). By default it follows label visibility: on where
 * the labels are hidden (`data-axf-labels="hidden"`, set by the renderers; a scope without the mark counts as hidden
 * when none of its buttons carries any text), off where they show. Manual settings win (core/engines/tapconfirm.ts).
 */
import { TAP_IDLE, tapConfig, tapDecide, tapPointer, toolbarIdOf, type TapChromeType, type TapScope, type TapState } from '../core/engines/tapconfirm';
import { placeTip } from './placeTip';

const BUTTONS = 'button, [role="button"], a[href]';
/** A click this long after the press that started it is no longer that press (a keyboard or synthetic click). */
const PRESS_MS = 1500;

export interface TapConfirmHost { dispose(): void }

/** The chrome scopes tap-to-confirm reaches. */
const SCOPES = '[role="toolbar"], [role="tablist"], [role="menubar"], nav[data-axf-nav]';

/** The toolbar / tab group / nav / menu bar a button belongs to, or null when none (or it opted out in code). */
export function toolbarOf(btn: Element): HTMLElement | null {
  const bar = btn.closest<HTMLElement>(SCOPES);
  if (!bar || bar.dataset.axfTapConfirm === 'off') return null;
  // an open drop-down of the menu bar is a menu, not the bar: its items run on the first tap
  const menu = btn.closest<HTMLElement>('[role="menu"]');
  if (menu && bar.contains(menu)) return null;
  return bar;
}

/** Which chrome kind a scope element is. */
export function scopeTypeOf(bar: HTMLElement): TapChromeType {
  const role = bar.getAttribute('role');
  if (role === 'tablist') return 'tab-group';
  if (role === 'menubar') return 'app-menu';
  if (role === 'toolbar') return 'toolbar';
  return bar.dataset.axfNav !== undefined ? 'nav-menu' : 'toolbar';
}

/** Whether a scope hides its labels: `data-axf-labels`, else no button in it carries any text. */
export function labelsHiddenOf(bar: HTMLElement): boolean {
  const mark = bar.dataset.axfLabels;
  if (mark === 'hidden') return true;
  // the nav region folded to icons (nav style "collapsed") hides every label whatever the nav itself says
  if (bar.dataset.axfNav !== undefined && bar.closest?.('[data-fx-navs-collapsed="on"]')) return true;
  if (mark === 'shown') return false;
  const buttons = Array.from((bar as unknown as { querySelectorAll?: (s: string) => ArrayLike<Element> }).querySelectorAll?.(BUTTONS) ?? []);
  return buttons.length > 0 && buttons.every((b) => !(b.textContent ?? '').trim());
}

/** The scope a tap landed in: its kind, chrome instance (for its settings field) and label visibility. */
export function scopeOf(bar: HTMLElement): TapScope & { id: string } {
  const type = scopeTypeOf(bar);
  const instance = type === 'tab-group' ? bar.dataset.axfTabGroup || '' : type === 'nav-menu' ? bar.dataset.axfNav || 'app' : type === 'app-menu' ? bar.dataset.fxCtxPayload || 'app' : bar.dataset.axfToolbar || '';
  return { type, instance: instance || undefined, labelsHidden: labelsHiddenOf(bar), id: type === 'toolbar' ? toolbarElementId(bar) : '' };
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
    const scope = scopeOf(bar);
    const cfg = tapConfig(get, scope.id, scope);
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
