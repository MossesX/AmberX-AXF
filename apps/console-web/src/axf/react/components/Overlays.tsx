/** Overlay engines: dialogs, toasts/popups, and the context menu. */
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { useAsset, useAxfState, useRuntime } from '../AxfProvider';
import { Icon } from './Icon';
import { BrandMark, BrandWatermark, brandHostProps } from './Brand';
import { useScopeId } from './InterfaceScope';
import { MenuList, MenuScroll } from './MenuList';
import { useMenuFit } from './menuFit';

export interface DialogDef {
  title: string;
  icon?: string;
  render: (props: Record<string, unknown>, close: () => void) => ReactNode;
  /** false keeps it out of search (dialogs that only make sense with props, e.g. asset-json) */
  searchable?: boolean;
}
export type DialogMap = Record<string, DialogDef>;

/* ---------------- DialogHost (dialog asset) ---------------- */

export function DialogHost({ dialogs }: { dialogs: DialogMap }) {
  const rt = useRuntime();
  const state = useAxfState();
  const d = useAsset('dialog').data;
  const panelRef = useRef<HTMLDivElement>(null);
  const scope = useScopeId();
  // a dialog belongs to the interface scope it was opened in; every other scope's host leaves it alone
  const mine = !state.dialog || (state.dialog.scope ?? '') === scope;
  const def = state.dialog && mine ? dialogs[state.dialog.id] : undefined;

  useEffect(() => {
    if (def) panelRef.current?.focus();
  }, [def]);

  // Android back (and the browser's back) closes the dialog: one history entry while any dialog is open here. Keyed on
  // open / shut, not the id, so going from one dialog straight to another keeps the one entry.
  const isOpen = !!def;
  useEffect(() => {
    if (!isOpen) return;
    history.pushState({ axfDialog: true }, '');
    let popped = false;
    const onPop = () => { popped = true; rt.closeDialog(); };
    addEventListener('popstate', onPop);
    return () => {
      removeEventListener('popstate', onPop);
      // shut some other way (X, outside tap, Escape, swipe, a console command): drop the entry it pushed
      if (!popped && (history.state as { axfDialog?: boolean } | null)?.axfDialog) history.back();
    };
  }, [isOpen, rt]);

  // Swipe down on the title bar (touch) closes it: the dialog follows the finger, and past a quarter of its height it goes.
  const [pull, setPull] = useState(0);
  const swipe = useRef<{ id: number; y: number } | null>(null);
  const onHeadDown = (e: ReactPointerEvent<HTMLElement>) => {
    if (e.pointerType !== 'touch' || (e.target as Element).closest('button')) return;
    swipe.current = { id: e.pointerId, y: e.clientY };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onHeadMove = (e: ReactPointerEvent<HTMLElement>) => {
    if (swipe.current?.id === e.pointerId) setPull(Math.max(0, e.clientY - swipe.current.y));
  };
  const onHeadUp = (e: ReactPointerEvent<HTMLElement>) => {
    if (swipe.current?.id !== e.pointerId) return;
    const h = panelRef.current?.offsetHeight ?? 400;
    const go = e.type === 'pointerup' && Math.max(0, e.clientY - swipe.current.y) > Math.max(rt.behavior().interaction.dragThreshold * 4, h / 4);
    swipe.current = null;
    setPull(0);
    if (go) rt.closeDialog();
  };

  if (!state.dialog || !mine) return null;
  if (!def) {
    queueMicrotask(() => {
      rt.closeDialog();
      rt.toast(`No dialog is registered as "${state.dialog?.id}".`, 'warning');
    });
    return null;
  }
  const close = () => rt.closeDialog();
  const brand = rt.brandPlace('dialog', 16);
  const brandHost = brandHostProps(brand);
  return (
    <div className="fx-backdrop" onPointerDown={(e) => d.closeOnBackdrop && rt.behavior().windows.closeOnBackdrop && e.target === e.currentTarget && close()}>
      <div className={`fx-dialog ${brandHost.className}`.trim()} role="dialog" aria-modal="true" aria-label={def.title} tabIndex={-1} ref={panelRef} data-fx-brand-mode={brandHost['data-fx-brand-mode']} style={pull ? { transform: `translateY(${pull}px)` } : undefined}>
        <header className="fx-dialog__head" onPointerDown={onHeadDown} onPointerMove={onHeadMove} onPointerUp={onHeadUp} onPointerCancel={onHeadUp}>
          {brand?.svg && <BrandMark slot="dialog" height={16} className="fx-dialog__brand" />}
          {def.icon && <Icon name={def.icon} size={18} />}
          <h2>{def.title}</h2>
          <button type="button" className="fx-iconbtn" onClick={close} aria-label="Close dialog">
            <Icon name="x" size={16} />
          </button>
        </header>
        <div className="fx-dialog__body">{def.render(state.dialog.props ?? {}, close)}<BrandWatermark slot="dialog" /></div>
      </div>
    </div>
  );
}

/* ---------------- ToastHost (popup asset) ---------------- */

const TOAST_ICON = { info: 'info', success: 'check-circle', warning: 'alert', danger: 'x-circle' } as const;

export function ToastHost() {
  const rt = useRuntime();
  const state = useAxfState();
  const p = useAsset('popup').data;
  const scope = useScopeId();
  return (
    <div className="fx-toasts" aria-live="polite">
      {state.toasts.filter((t) => (t.scope ?? '') === scope).map((t) => (
        <div key={t.id} className={`fx-toast fx-toast--${t.kind}`} role="status">
          {p.showIcon && <Icon name={TOAST_ICON[t.kind]} size={18} className="fx-toast__icon" />}
          <div className="fx-toast__text">
            {t.title && <strong>{t.title}</strong>}
            <span>{t.message}</span>
          </div>
          <button type="button" className="fx-iconbtn" onClick={() => rt.dismissToast(t.id)} aria-label="Dismiss">
            <Icon name="x" size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}

/* ---------------- ContextMenuHost (context-menu asset) ---------------- */

export function ContextMenuHost() {
  const rt = useRuntime();
  const state = useAxfState();
  const cm = useAsset('context-menu').data;
  const ref = useRef<HTMLDivElement>(null);
  const scope = useScopeId();

  useEffect(() => {
    const open = (target: Element | null, x: number, y: number) => {
      // one host per interface scope: only the host of the scope the pointer is in opens the menu
      if ((target?.closest('[data-fx-scope]')?.getAttribute('data-fx-scope') ?? '') !== scope) return;
      // chrome-settings@1 (Nov 4 2026): a toolbar, a tab row or a nav that names no target is still one, so every
      // toolbar / tab group / navigation menu gets Settings / Change / Move without an attribute of its own
      const el = target?.closest('[data-fx-ctx-target], [role="toolbar"], [role="tablist"], nav');
      const own = el?.getAttribute('data-fx-ctx-target');
      const name = own ?? (el?.getAttribute('role') === 'toolbar' ? 'toolbar' : el?.getAttribute('role') === 'tablist' ? 'tab-group' : el?.tagName === 'NAV' && el.getAttribute('data-axf-not-nav') === null ? 'nav' : 'default');
      if (own) { rt.openContext(x, y, name, el?.getAttribute('data-fx-ctx-payload') ?? undefined); return; }
      // an implicit target's instance id: its settings id, else its accessible name as a slug
      const label = name === 'toolbar' ? el?.getAttribute('data-axf-toolbar') ?? el?.getAttribute('data-axf-toolbar-asset') ?? el?.getAttribute('aria-label') : name === 'tab-group' ? el?.getAttribute('data-axf-tab-group') ?? el?.getAttribute('aria-label') : name === 'nav' ? el?.getAttribute('data-axf-nav') ?? el?.getAttribute('aria-label') : null;
      const slug = label ? label.toLowerCase().replace(/[^a-z0-9._:/-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120) : '';
      rt.openContext(x, y, name, slug || undefined);
    };
    const onCtx = (e: MouseEvent) => {
      // A touch long-press also fires the browser's own contextmenu: the long-press timer handles it, once.
      if (start) { e.preventDefault(); return; }
      const t = e.target as Element;
      // A banner (outside the shell, in a box that otherwise ignores the menu) is always a target: Banner settings.
      const banner = !!t.closest('[data-fx-ctx-target="axf-banner"], [data-fx-ctx-target="banner"]') && !t.closest('input, textarea, .fx-ctx');
      if (!banner && t.closest('input, textarea, .fx-ctx, [data-fx-ctx-ignore]')) return;
      if (!banner && !t.closest('.fx-shell')) return;
      // hidden: the browser's own menu, unless a host that took the context menu shows it (embed@1, rt.openContext forwards)
      if (rt.slotHidden('context-menu') && !rt.hostTakes('context-menu')) return;
      e.preventDefault();
      open(t, e.clientX, e.clientY);
    };
    // Long-press for touch devices
    let timer: ReturnType<typeof setTimeout> | undefined;
    let start: { x: number; y: number } | null = null;
    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== 'touch' || (rt.slotHidden('context-menu') && !rt.hostTakes('context-menu'))) return;
      const t = e.target as Element;
      const banner = !!t.closest('[data-fx-ctx-target="axf-banner"], [data-fx-ctx-target="banner"]') && !t.closest('input, textarea, .fx-ctx');
      if (!banner && (t.closest('input, textarea, .fx-ctx, [data-fx-ctx-ignore]') || !t.closest('.fx-shell'))) return;
      start = { x: e.clientX, y: e.clientY };
      timer = setTimeout(() => open(t, e.clientX, e.clientY), rt.behavior().interaction.longPressMs); // behaviour theme (was 550 ms)
    };
    const cancel = (e: Event) => {
      const p = e as PointerEvent;
      if (start && e.type === 'pointermove' && Math.hypot(p.clientX - start.x, p.clientY - start.y) < Math.max(1, rt.behavior().interaction.dragThreshold)) return;
      clearTimeout(timer);
      start = null;
    };
    const onAway = (e: PointerEvent) => {
      if (!(e.target as Element).closest('.fx-ctx')) rt.closeContext();
    };
    document.addEventListener('contextmenu', onCtx);
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('pointermove', cancel);
    document.addEventListener('pointerup', cancel);
    // Scrolling on a phone ends the touch with pointercancel (no move/up), so the timer must stop there too.
    document.addEventListener('pointercancel', cancel);
    document.addEventListener('scroll', cancel, true);
    document.addEventListener('pointerdown', onAway, true);
    window.addEventListener('blur', () => rt.closeContext());
    return () => {
      document.removeEventListener('contextmenu', onCtx);
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('pointermove', cancel);
      document.removeEventListener('pointerup', cancel);
      document.removeEventListener('pointercancel', cancel);
      document.removeEventListener('scroll', cancel, true);
      document.removeEventListener('pointerdown', onAway, true);
    };
  }, [rt, scope]);

  // On screen: below-right of the pointer, flipped or shifted to fit, scrolling inside when taller than the room (menu-fit@1)
  useMenuFit(ref, 'point', () => state.context && { left: state.context.x, right: state.context.x, top: state.context.y, bottom: state.context.y }, {}, [state.context]);

  if (!state.context || (state.context.scope ?? '') !== scope) return null;
  const ctx = state.context;
  // `contributions: false`: a target the asset defines shows only the asset's own items (e.g. context-menu/amber)
  const own = cm.contributions === false && !!(cm.targets[ctx.target] ?? (!ctx.target || ctx.target === 'default' ? cm.targets.default : undefined));
  const contributed = own ? [] : rt.contributedContext(ctx.target);
  const extra = own ? [] : [...(rt.contextExtras.get(ctx.target)?.(ctx.target, ctx.payload) ?? []), ...contributed];
  // chrome-settings@1: the shared Settings / Change / Move block of a tab group, toolbar, banner, nav or menu bar is
  // that element's own menu (right after the kind's items), never a tail item under the whole default menu
  const chrome = own ? [] : rt.contextExtras.get('*:chrome')?.(ctx.target, ctx.payload) ?? [];
  const everywhere = own ? [] : [...rt.contextExtras.entries()].filter(([k]) => (k === '*' || k.startsWith('*:')) && k !== '*:chrome').flatMap(([, f]) => f(ctx.target, ctx.payload));
  const base = cm.targets[ctx.target] ?? (extra.length || chrome.length ? [] : cm.targets.default ?? []);
  // An element naming a target the asset doesn't know still gets the default menu's contributions (e.g. a plugin link).
  const fallback = !own && !cm.targets[ctx.target] && !extra.length && !chrome.length ? rt.contributedContext('default') : [];
  const chromeSep = extra.length && chrome.length ? [{ id: 'chrome-sep', separator: true }] : [];
  const more = [...extra, ...chromeSep, ...chrome, ...fallback] as unknown as typeof base;
  const sep = base.length && more.length && !base[base.length - 1]?.separator ? [{ id: 'x-sep', separator: true } as unknown as (typeof base)[number]] : [];
  const tail = everywhere.length ? [{ id: 'ctx-everywhere-sep', separator: true }, ...everywhere] : [];
  const items = [...base, ...sep, ...more, ...(tail as unknown as typeof base)];
  return (
    <div
      ref={ref}
      className="fx-ctx fx-popover"
      style={{ left: state.context.x, top: state.context.y }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <MenuScroll box={ref}>
        <MenuList
          items={items}
          payload={state.context.payload}
          onDone={() => rt.closeContext()}
          showIcons={cm.showIcons}
          showShortcuts={cm.showShortcuts}
        />
      </MenuScroll>
    </div>
  );
}
