/**
 * PageToolbar — a toolbar drawn from a page toolbar asset through the engine (page-toolbar@1; react/pageToolbar.ts,
 * core/engines/toolbar-actions.ts). The same element every toolbar on the framework is: role="toolbar" with its
 * settings id (`data-axf-toolbar`), the chrome context menu (Settings… / Change… / Move; `data-fx-ctx-target`),
 * tap-to-confirm on touch (installed on every role="toolbar" by AxfProvider), the chrome overrides' style attributes
 * and vars, dropped hooks (a button the host takes is left out, a locked one greyed with its note), badges, pressed
 * toggles, the danger tone on destructive buttons, and a More menu for what the bar cannot hold (the engine's overflow
 * plan, fed by the measured room). Every colour, size and spacing is a token (framework/ui/axf.css).
 *
 *   <PageToolbar />                       the toolbar of the enclosing view (main slot); nothing when the page has none
 *   <PageToolbar slot="auto-lander" />    one of several on the page
 *   <PageToolbar fallback={<div …>}>     keep the handwritten bar until the page has an asset
 *   <PageToolbar assetId="editor-classic" label="Page toolbar" />   a named asset (what AssetToolbar does)
 * `children` fill the search spot when the asset says showSearch (or sit at the end of the bar).
 */
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { toolbarStyle } from '../../core/engines/components';
import type { ToolbarData } from '../../core/types';
import type { ResolvedToolbar, ResolvedToolbarButton } from '../../core/engines/toolbar-actions';
import { registerLiveToolbar, usePageToolbar, type PageToolbarHook } from '../pageToolbar';
import { Icon } from './Icon';

export interface PageToolbarProps {
  /** the view (default: the enclosing console-control scope's view) */
  view?: string | null;
  /** the place on the page (default main) */
  slot?: string | null;
  /** force one asset by id */
  assetId?: string | null;
  /** accessible name (default: the asset's name) */
  label?: string;
  /** drawn instead when the page has no toolbar asset */
  fallback?: ReactNode;
  /** the search box or extra controls */
  children?: ReactNode;
  className?: string;
}

export function PageToolbar({ view, slot, assetId, label, fallback = null, children, className = '' }: PageToolbarProps) {
  const hook = usePageToolbar(view, slot, assetId);
  const { toolbar } = hook;
  const hookRef = useRef(hook);
  hookRef.current = hook;
  // announce the live toolbar under its settings id (the API lists, reads and presses it through the same hook)
  useEffect(() => (toolbar ? registerLiveToolbar(toolbar.id, { hook: () => hookRef.current, view: hook.page.view ?? null }) : undefined), [toolbar?.id, hook.page.view]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!toolbar) return <>{fallback}</>;
  return <PageToolbarView hook={hook} toolbar={toolbar} label={label} className={className}>{children}</PageToolbarView>;
}

function PageToolbarView({ hook, toolbar: t, label, className, children }: { hook: PageToolbarHook; toolbar: ResolvedToolbar; label?: string; className: string; children?: ReactNode }) {
  const bar = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState(false);
  const out = toolbarStyle(t.look as ToolbarData);
  const variant = t.look.variant;
  useFit(bar, hook, t);
  useEffect(() => {
    if (!more) return undefined;
    const close = (e: Event) => { if (!(e.target instanceof Node) || !bar.current?.contains(e.target)) setMore(false); };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Escape') setMore(false); }, { once: true });
    return () => document.removeEventListener('pointerdown', close);
  }, [more]);
  const name = label ?? t.label;
  return (
    <div className="fx-toolbar-scope" style={out.vars as CSSProperties} {...out.attrs}>
      <div
        ref={bar}
        className={`fx-toolbar fx-toolbar--${variant} fx-toolbar--page ${className}`.trim()}
        data-align={t.look.align}
        role="toolbar"
        aria-label={name}
        data-axf-toolbar={t.id}
        data-axf-toolbar-asset={t.asset}
        data-axf-toolbar-scope={`${t.scope.kind}${t.scope.id ? `:${t.scope.id}` : ''}`}
        data-fx-ctx-target="toolbar"
        data-fx-ctx-payload={t.id}
      >
        {t.groups.filter((g) => g.visible && g.buttons.some((b) => b.visible && t.bar.some((x) => x.key === b.key))).map((g) => (
          <div key={g.id} className="fx-toolbar__group" role="group" aria-label={g.label ?? undefined} data-axf-provider={g.provider ?? undefined}>
            {g.buttons.filter((b) => t.bar.some((x) => x.key === b.key)).map((b) => <PageToolbarButton key={b.key} button={b} variant={variant} onPress={() => void hook.press(b)} />)}
          </div>
        ))}
        {t.more.length > 0 && (
          <div className="fx-toolbar__group fx-toolbar__more" role="group" aria-label={t.moreLabel}>
            <button type="button" className={`fx-toolbtn${more ? ' is-on' : ''}`} aria-haspopup="menu" aria-expanded={more} aria-label={`${t.moreLabel} (${t.more.length})`} title={t.moreLabel} data-axf-toolbar-more="" data-axf-target={`button:toolbar.${t.id}.more`} onClick={() => setMore((o) => !o)}>
              <Icon name="more" size={16} />
              {variant !== 'icons' && <span>{t.moreLabel}</span>}
              {t.more.some((b) => b.badge) && <span className="fx-toolbtn__badge" aria-hidden="true">{t.more.filter((b) => b.badge).length}</span>}
            </button>
            {more && (
              <ul className="fx-menu fx-toolbar__menu" role="menu" aria-label={t.moreLabel}>
                {t.more.map((b) => (
                  <li key={b.key} role="none">
                    <button type="button" role="menuitem" className={`fx-menu__item${b.pressed ? ' is-on' : ''}${b.destructive ? ' is-danger' : ''}`} disabled={!b.enabled} aria-pressed={b.pressed === null ? undefined : b.pressed} title={b.title} data-axf-action={b.ref ? `${b.ref.kind}:${b.ref.id}` : undefined} data-axf-toolbar-button={b.id} onClick={() => { setMore(false); void hook.press(b); }}>
                      <Icon name={b.enabled ? b.icon : 'lock'} size={14} />
                      <span>{b.label}</span>
                      {b.badge && <span className="fx-menu__badge" aria-hidden="true">{b.badge}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

/** One ready button: tone, badge, pressed state and the reason in the title; the click goes through the engine. */
export function PageToolbarButton({ button: b, variant, onPress }: { button: ResolvedToolbarButton; variant: ToolbarData['variant']; onPress: () => void }) {
  return (
    <button
      type="button"
      className={`fx-toolbtn${b.pressed ? ' is-on' : ''}${b.destructive ? ' fx-toolbtn--danger' : ''}`}
      disabled={!b.enabled}
      aria-pressed={b.pressed === null ? undefined : b.pressed}
      aria-label={b.badge ? `${b.label} (${b.badge})` : b.label}
      title={b.title}
      data-axf-action={b.ref ? `${b.ref.kind}:${b.ref.id}` : undefined}
      data-axf-toolbar-button={b.id}
      data-axf-origin={b.origin}
      onClick={onPress}
    >
      {variant !== 'labels' && <Icon name={b.enabled ? b.icon : 'lock'} size={16} />}
      {variant !== 'icons' && <span className="fx-toolbtn__label">{b.label}</span>}
      {b.badge && <span className="fx-toolbtn__badge" aria-hidden="true">{b.badge}</span>}
    </button>
  );
}

/**
 * Measure the room on the bar and tell the hook how many buttons fit: when the bar overflows, one fewer; when it has
 * room for one more button's worth, one more (never past the total). The engine folds by priority from that count.
 */
function useFit(bar: { current: HTMLDivElement | null }, hook: PageToolbarHook, t: ResolvedToolbar) {
  const total = t.buttons.length;
  const onBar = t.bar.length;
  useLayoutEffect(() => {
    const el = bar.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    let raf = 0;
    const measure = () => {
      raf = 0;
      const buttons = Array.from(el.querySelectorAll<HTMLElement>(':scope > .fx-toolbar__group > .fx-toolbtn'));
      const widest = buttons.reduce((w, b) => Math.max(w, b.offsetWidth), 0);
      const overflowing = el.scrollWidth > el.clientWidth + 1;
      if (overflowing && onBar > 0) hook.setFit(onBar - 1);
      else if (!overflowing && onBar < total && widest > 0 && el.scrollWidth + widest * 1.5 < el.clientWidth) hook.setFit(onBar + 1);
    };
    const schedule = () => { if (!raf) raf = requestAnimationFrame(measure); };
    schedule();
    const ro = new ResizeObserver(schedule);
    ro.observe(el);
    return () => { ro.disconnect(); if (raf) cancelAnimationFrame(raf); };
  }, [bar, hook, onBar, total, t.look.variant]);
}
