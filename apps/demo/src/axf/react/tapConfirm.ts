/**
 * Tap-to-confirm on every toolbar, tab group, navigation menu, application menu, context menu and banner (web host of
 * core/engines/tapconfirm.ts). Installed once by <AxfProvider>, so every one of them in every app on the framework gets
 * it with no code of its own, existing and new:
 *   toolbar       role="toolbar"
 *   tab-group     role="tablist" (and the More / dropdown list inside it)
 *   nav-menu      <nav> or [data-axf-nav] (not [data-axf-not-nav] previews)
 *   app-menu      role="menubar", or a role="menu" that is not inside a context menu or a tab row
 *   context-menu  a role="menu" inside .fx-ctx
 *   banner        [data-fx-ctx-target="banner" | "axf-banner"]
 * Any button, role="button" or link inside the nearest of those is an item of it.
 *
 * A click whose press was a finger goes through `tapDecide`: the first tap is swallowed, the item lights up
 * (`data-axf-armed`) and a tip says what it is and "Tap again to confirm"; a second tap on it inside the arm window
 * lets the click through. Mouse, pen and keyboard clicks pass untouched. Whether an item taps to confirm is a setting:
 * the item's own choice (its settings dialog → Behaviour → Tap to confirm, the `tapConfirm` field of chrome-settings@1)
 * else the switch for its kind (Settings → Plugins → Toolbars → Tap to confirm). In code, an element can opt out with
 * `data-axf-tap-confirm="off"` and a `data-axf-tap-confirm-reason` (check-toolbars.mjs refuses one without a reason).
 */
import { TAP_HINT, TAP_IDLE, tapConfigFor, tapDecide, tapPointer, toolbarIdOf, type TapKind, type TapState } from '../core/engines/tapconfirm';
import { placeTip } from './placeTip';

const BUTTONS = 'button, [role="button"], a[href]';
/** A click this long after the press that started it is no longer that press (a keyboard or synthetic click). */
const PRESS_MS = 1500;
/** Every element that is a tap-to-confirm surface; the nearest one around an item owns it. */
export const TAP_SURFACES = '[role="toolbar"], [role="tablist"], [role="menubar"], [role="menu"], nav, [data-axf-nav], [data-fx-ctx-target="banner"], [data-fx-ctx-target="axf-banner"]';

/** One surface an item belongs to: its kind, its chrome settings instance id and the element. */
export interface TapSurface { kind: TapKind; instance: string; el: HTMLElement }

/** The context-menu slug of a label (the same as the chrome settings instance id the context menu opens). */
const ctxSlug = (s: string | null | undefined) => (s ? s.toLowerCase().replace(/[^a-z0-9._:/-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120) : '');

/**
 * The surface an element is part of, or null (not in one, a preview, or switched off in code). The instance id is
 * the one the element's context menu opens the settings of, so the dialog's choice is the one the tap reads.
 */
export function tapSurfaceOf(node: Element): TapSurface | null {
  let el = node.closest<HTMLElement>(TAP_SURFACES);
  while (el && el.tagName === 'NAV' && el.hasAttribute('data-axf-not-nav')) el = el.parentElement?.closest<HTMLElement>(TAP_SURFACES) ?? null;
  if (!el || el.dataset.axfTapConfirm === 'off') return null;
  const role = el.getAttribute('role');
  const payload = el.getAttribute('data-fx-ctx-payload');
  const own = (target: string) => (el!.getAttribute('data-fx-ctx-target') === target ? ctxSlug(payload) : '');
  if (role === 'toolbar') return { kind: 'toolbar', instance: own('toolbar') || ctxSlug(el.dataset.axfToolbar ?? el.dataset.axfToolbarAsset ?? el.getAttribute('aria-label')) || toolbarElementId(el), el };
  if (role === 'tablist') return { kind: 'tab-group', instance: own('tab-group') || ctxSlug(el.dataset.axfTabGroup ?? el.getAttribute('aria-label')) || 'app', el };
  if (role === 'menu') {
    if (el.closest('.fx-ctx')) return { kind: 'context-menu', instance: 'app', el };
    const row = el.parentElement?.closest<HTMLElement>('[role="tablist"]');
    if (row) return row.dataset.axfTapConfirm === 'off' ? null : tapSurfaceOf(row);
    return { kind: 'app-menu', instance: 'app', el };
  }
  if (role === 'menubar') return { kind: 'app-menu', instance: ctxSlug(payload) || 'app', el };
  if (el.tagName === 'NAV' || el.hasAttribute('data-axf-nav')) return { kind: 'nav-menu', instance: own('nav') || ctxSlug(el.dataset.axfNav ?? el.getAttribute('aria-label')) || 'app', el };
  return { kind: 'banner', instance: ctxSlug(payload) || 'app', el };
}

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

/** What an item is, for its tip: `data-axf-tip`, else its title, aria-label or text. */
export function tipTextOf(btn: Element): string {
  const el = btn as HTMLElement;
  return (el.dataset?.axfTip || el.getAttribute('title') || el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 160);
}

export interface TapConfirmHost { dispose(): void }

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
    hint.textContent = TAP_HINT;
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
    const surface = tapSurfaceOf(btn);
    if (!surface) return;
    const fresh = press && now() - press.at <= PRESS_MS && press.target instanceof Node && btn.contains(press.target);
    const pointer = tapPointer(fresh && e.detail > 0 ? press!.type : '');
    const cfg = tapConfigFor(get, surface.kind, surface.instance);
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
