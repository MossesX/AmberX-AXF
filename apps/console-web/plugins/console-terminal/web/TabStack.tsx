/*
 * Tabs on the side (Nov 3 2026, Brett: "a setting in terminal to put all the tabs on the left side in a stack instead
 * of across the top"). Setting Tab position: Top (the Windows strip) · Left stack · Right stack · Bottom. Each device
 * keeps its own pick (tab-position-core.ts); one it hasn't made follows the server default (Settings → Terminal, GET/PUT
 * tab-position, MCP and CLI through plugin commands, action terminal.tabs.position).
 * The stack lives inside the host's body, so the strip above stays the window's title bar (+, ∨, drag, caption).
 *   - a row per tab: status dot or icon, the agent's avatar (initials), title, model and live cost, close
 *   - collapses to icons; the edge drags to resize (arrow keys on it too); a long list scrolls
 *   - drag a row to reorder (hold on touch); right-click a row = the tab menu; right-click empty space = Tab position
 *   - a narrow window (a phone) turns it into a slide-out: the Tabs button or a swipe from the edge opens it
 * Theme tokens only (axp-wt-stack prefix); rows are the framework's fx-tab, buttons fx-iconbtn / fx-menu__item.
 */
import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { Icon, useRuntime } from '@console/axf/react';
import { activate, ctl, move, patchSession, type HostSession } from './hosts';
import { meterOf, modelName, money, statusOf } from './meters';
import { describe, headlessOf, iconFor } from './TerminalHost';
import {
  DEVICE_KEYS, STACK_WIDTH, TAB_POSITIONS, TAB_POSITION_LABELS, clampWidth, dragWidth, effectivePosition, initials, isPosition, isStack, keyWidth, type TabPosition,
} from './tab-position-core';

const P = 'axp-wt-stack';
const ICON: Record<TabPosition, string> = { top: 'chevron-up', left: 'chevron-left', right: 'chevron-right', bottom: 'chevron-down' };

/** This device's tab position, width and fold, live (another window or the action may change them). */
export function useTabPosition(serverDefault: unknown) {
  const rt = useRuntime();
  const read = () => `${rt.settings.get(DEVICE_KEYS.position) ?? ''}|${rt.settings.get(DEVICE_KEYS.width) ?? ''}|${rt.settings.get(DEVICE_KEYS.collapsed) === true}`;
  const snap = useSyncExternalStore((f) => {
    const offs = Object.values(DEVICE_KEYS).map((k) => rt.settings.onChange(k, f));
    return () => offs.forEach((o) => o());
  }, read);
  const [pick, w, folded] = snap.split('|');
  const device = isPosition(pick) ? pick : null;
  const position = effectivePosition(device, serverDefault);
  const width = clampWidth(w ? Number(w) : STACK_WIDTH.default);
  const collapsed = folded === 'true';
  return {
    position, device, width, collapsed,
    /** null = follow the default again */
    setPosition: (p: TabPosition | null) => rt.settings.set(DEVICE_KEYS.position, p ?? ''),
    setWidth: (n: number) => rt.settings.set(DEVICE_KEYS.width, clampWidth(n)),
    setCollapsed: (on: boolean) => rt.settings.set(DEVICE_KEYS.collapsed, on),
    /** the host root's class + the stack width the panes make room for */
    rootClass: `axp-wt--tabs-at-${position}${isStack(position) && collapsed ? ' axp-wt--stack-collapsed' : ''}`,
    rootStyle: isStack(position) ? ({ ['--axp-wt-stack-n' as string]: width } as CSSProperties) : undefined,
  };
}
export type TabPositionState = ReturnType<typeof useTabPosition>;

/** Tab position rows for a menu (the tab menu, the stack's own menu). */
export function positionItems(tp: TabPositionState, done: () => void) {
  return TAB_POSITIONS.map((p) => (
    <button key={p} type="button" role="menuitemradio" aria-checked={tp.position === p} className="fx-menu__item" onClick={() => { tp.setPosition(p); done(); }}>
      <Icon name={tp.position === p ? 'check' : ICON[p]} size={13} /> <span className="fx-grow">{TAB_POSITION_LABELS[p]}</span>
      {tp.device === p && <span className="axp-wt__hint">this device</span>}
    </button>
  ));
}

export interface TabStackProps {
  hostId: string;
  sessions: HostSession[];
  frontId: string | null;
  tp: TabPositionState;
  renaming: { id: string; text: string } | null;
  setRenaming(r: { id: string; text: string } | null): void;
  onClose(sid: string): void;
  onMenu(m: { x: number; y: number; id: string }): void;
  onNew(): void;
}

export function TabStack({ hostId, sessions, frontId, tp, renaming, setRenaming, onClose, onMenu, onNew }: TabStackProps) {
  const side = tp.position === 'right' ? 'right' : tp.position === 'bottom' ? 'bottom' : 'left';
  const stack = side !== 'bottom';
  const root = useRef<HTMLElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const probe = useRef<HTMLSpanElement>(null); // as wide as the narrow breakpoint (CSS, from tokens): narrower = slide-out
  const [narrow, setNarrow] = useState(false);
  const [open, setOpen] = useState(false); // the slide-out
  const [own, setOwn] = useState<{ x: number; y: number } | null>(null); // the stack's own menu (Tab position)
  const [drag, setDrag] = useState<{ from: number; over: number } | null>(null);
  const [live, setLive] = useState<number | null>(null); // width while the edge is dragged
  const hold = useRef<{ id: number; x: number; y: number; i: number; timer: ReturnType<typeof setTimeout> | null; on: boolean } | null>(null);

  useEffect(() => {
    const host = root.current?.parentElement; if (!host) return;
    const ro = new ResizeObserver(() => { const w = probe.current?.offsetWidth ?? 0; setNarrow(stack && w > 0 && host.clientWidth > 0 && host.clientWidth < w); });
    ro.observe(host);
    return () => ro.disconnect();
  }, [stack]);
  useEffect(() => { if (!narrow) setOpen(false); }, [narrow]);
  // phone: a swipe in from the stack's edge opens it, a swipe back closes it
  useEffect(() => {
    const host = root.current?.parentElement; if (!host || !narrow) return;
    let x0: number | null = null;
    const start = (e: TouchEvent) => { const t = e.touches[0]; const r = host.getBoundingClientRect(); if (!t) return; const d = side === 'left' ? t.clientX - r.left : r.right - t.clientX; x0 = open || d < 24 ? t.clientX : null; };
    const end = (e: TouchEvent) => { const t = e.changedTouches[0]; if (x0 === null || !t) return; const dx = (t.clientX - x0) * (side === 'left' ? 1 : -1); x0 = null; if (dx > 60) setOpen(true); else if (dx < -60) setOpen(false); };
    host.addEventListener('touchstart', start, { passive: true }); host.addEventListener('touchend', end, { passive: true });
    return () => { host.removeEventListener('touchstart', start); host.removeEventListener('touchend', end); };
  }, [narrow, open, side]);

  const collapsed = stack && !narrow && tp.collapsed;
  const pick = (sid: string) => { activate(hostId, sid); if (narrow) setOpen(false); };

  /* drag to reorder: a mouse drags after a small move, a finger after a short hold */
  const rowAt = (x: number, y: number) => { const el = document.elementFromPoint(x, y)?.closest<HTMLElement>(`.${P}__tab`); const i = el?.dataset.index; return i === undefined ? null : Number(i); };
  const down = (e: React.PointerEvent, i: number) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('button, input, form') || renaming) return;
    const h = { id: e.pointerId, x: e.clientX, y: e.clientY, i, timer: null as ReturnType<typeof setTimeout> | null, on: false };
    if (e.pointerType !== 'mouse') h.timer = setTimeout(() => { h.on = true; setDrag({ from: i, over: i }); navigator.vibrate?.(10); }, 350);
    hold.current = h;
  };
  const moveP = (e: React.PointerEvent) => {
    const h = hold.current; if (!h || h.id !== e.pointerId) return;
    if (!h.on) {
      const far = Math.abs(e.clientX - h.x) + Math.abs(e.clientY - h.y) > 6;
      if (!far) return;
      if (e.pointerType !== 'mouse') { if (h.timer) clearTimeout(h.timer); hold.current = null; return; } // a finger moved first: it scrolls
      h.on = true; (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    }
    const over = rowAt(e.clientX, e.clientY);
    setDrag({ from: h.i, over: over ?? h.i });
  };
  const up = (e: React.PointerEvent) => {
    const h = hold.current; hold.current = null; if (!h || h.id !== e.pointerId) return;
    if (h.timer) clearTimeout(h.timer);
    if (h.on) { const over = rowAt(e.clientX, e.clientY) ?? drag?.over ?? h.i; if (over !== h.i) move(hostId, h.i, over); setDrag(null); }
  };
  // while a finger drags a row, the list doesn't scroll
  useEffect(() => {
    const el = list.current; if (!el || !drag) return;
    const stop = (e: TouchEvent) => e.preventDefault();
    el.addEventListener('touchmove', stop, { passive: false });
    return () => el.removeEventListener('touchmove', stop);
  }, [drag !== null]); // eslint-disable-line react-hooks/exhaustive-deps

  /* resize: drag the edge (or arrow keys on it); the host and its panes follow live, the width is saved on release */
  const step = () => (probe.current?.offsetWidth ?? 0) / 40; // the probe is 40 text-size steps wide
  const edgeDown = (e: React.PointerEvent) => {
    if (side === 'bottom') return;
    e.preventDefault(); const x0 = e.clientX; const w0 = tp.width; const px = step(); const el = e.currentTarget as HTMLElement;
    const hostEl = root.current?.closest<HTMLElement>('.axp-wt');
    el.setPointerCapture?.(e.pointerId);
    const mv = (ev: PointerEvent) => { const n = dragWidth(w0, ev.clientX - x0, px, side); setLive(n); hostEl?.style.setProperty('--axp-wt-stack-n', String(n)); };
    const fin = (ev: PointerEvent) => { el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', fin); el.removeEventListener('pointercancel', fin); const n = dragWidth(w0, ev.clientX - x0, px, side); hostEl?.style.setProperty('--axp-wt-stack-n', String(n)); tp.setWidth(n); setLive(null); };
    el.addEventListener('pointermove', mv); el.addEventListener('pointerup', fin); el.addEventListener('pointercancel', fin);
  };
  const width = live ?? tp.width;

  const commit = (s: HostSession) => { if (!renaming) return; patchSession(s.id, { title: renaming.text.trim() || s.title, renamed: true }); setRenaming(null); };
  const at = (x: number, y: number) => ({ left: Math.max(4, Math.min(x, innerWidth - 240)), top: Math.max(4, Math.min(y, innerHeight - 220)) });

  return (
    <>
      {narrow && !open && (
        <button type="button" className={`fx-iconbtn ${P}__peek ${P}__peek--${side}`} title="Tabs" aria-label={`Show the tabs (${sessions.length})`} aria-expanded={false} onClick={() => setOpen(true)}>
          <Icon name="list" size={14} /><span className={`${P}__count`}>{sessions.length}</span>
        </button>
      )}
      {narrow && open && <div className={`${P}__scrim`} onClick={() => setOpen(false)} />}
      <nav ref={root} className={`${P} ${P}--${side} ${collapsed ? 'is-collapsed' : ''} ${narrow ? 'is-drawer' : ''} ${narrow && open ? 'is-open' : ''} ${drag ? 'is-dragging' : ''}`}
        aria-label="Terminal tabs" data-fx-ctx-ignore
        onContextMenu={(e) => { if ((e.target as HTMLElement).closest(`.${P}__tab`)) return; e.preventDefault(); e.stopPropagation(); setOwn({ x: e.clientX, y: e.clientY }); }}>
        <span ref={probe} className={`${P}__probe`} aria-hidden />
        {stack && (
          <div className={`${P}__head`}>
            {!collapsed && <span className={`${P}__title`}>Tabs <span className={`${P}__count`}>{sessions.length}</span></span>}
            {!narrow && <button type="button" className="fx-iconbtn" title={collapsed ? 'Expand the tabs' : 'Collapse to icons'} aria-label={collapsed ? 'Expand the tabs' : 'Collapse the tabs to icons'} aria-expanded={!collapsed}
              onClick={() => tp.setCollapsed(!collapsed)}><Icon name={(side === 'left') === collapsed ? 'chevron-right' : 'chevron-left'} size={14} /></button>}
            {narrow && <button type="button" className="fx-iconbtn" title="Hide the tabs" aria-label="Hide the tabs" onClick={() => setOpen(false)}><Icon name="x" size={14} /></button>}
          </div>
        )}
        <div ref={list} className={`${P}__list`} role="tablist" aria-orientation={stack ? 'vertical' : 'horizontal'} aria-label="Tabs"
          onKeyDown={(e) => {
            const i = sessions.findIndex((s) => s.id === frontId); const next = stack ? 'ArrowDown' : 'ArrowRight'; const prev = stack ? 'ArrowUp' : 'ArrowLeft';
            if (e.key !== next && e.key !== prev) return;
            e.preventDefault(); const j = i + (e.key === next ? 1 : -1); if (j < 0 || j >= sessions.length) return;
            if (e.altKey) move(hostId, i, j); else activate(hostId, sessions[j]!.id); // Alt+arrow moves the tab
            requestAnimationFrame(() => list.current?.querySelector<HTMLElement>(`[data-index="${j}"]`)?.focus());
          }}>
          {sessions.map((s, i) => {
            const on = s.id === frontId; const sc = ctl(s.id);
            const hl = headlessOf(s); const m = hl ? meterOf(hl) : null; const st = statusOf(m);
            const label = !s.renamed && m?.agent ? m.agent : s.title;
            const tip = `${label}${m ? ` · ${modelName(m.model)} · ${money(m.costUsd)}${m.costEstimated ? ' (estimate)' : ''} · ${st}` : ''} · ${describe(s.open)}`;
            const mark = drag && drag.over === i && drag.from !== i ? (drag.from < i ? 'is-drop-after' : 'is-drop-before') : '';
            return (
              <div key={s.id} role="tab" aria-selected={on} tabIndex={on ? 0 : -1} data-index={i} title={tip}
                className={`fx-tab ${P}__tab ${on ? 'is-active' : ''} ${hl ? 'is-headless' : ''} ${drag?.from === i ? 'is-lifted' : ''} ${mark}`}
                style={s.color ? { ['--axp-wt-tint' as string]: `var(--fx-${s.color})` } : undefined} data-tint={s.color ? '' : undefined}
                onClick={() => { if (!drag) pick(s.id); }}
                onDoubleClick={() => { if (!collapsed) setRenaming({ id: s.id, text: s.title }); }}
                onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); onClose(s.id); } }}
                onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onMenu({ x: e.clientX, y: e.clientY, id: s.id }); }}
                onPointerDown={(e) => down(e, i)} onPointerMove={moveP} onPointerUp={up} onPointerCancel={() => { const h = hold.current; if (h?.timer) clearTimeout(h.timer); hold.current = null; setDrag(null); }}>
                <span className={`${P}__lead`}>
                  {m?.agent ? <span className={`${P}__avatar`} aria-hidden>{initials(m.agent)}</span> : <Icon name={iconFor(s.open)} size={14} />}
                  {st && <span className={`axp-wt__state ${P}__state is-${st}`} role="img" aria-label={st} />}
                </span>
                {!collapsed && (
                  <span className={`${P}__text`}>
                    {renaming?.id === s.id ? (
                      <form onSubmit={(e) => { e.preventDefault(); commit(s); }}>
                        <input className={`fx-input axp-wt__rename`} autoFocus value={renaming.text} onChange={(e) => setRenaming({ id: s.id, text: e.target.value })} onBlur={() => commit(s)} onKeyDown={(e) => { if (e.key === 'Escape') setRenaming(null); }} aria-label="Tab name" />
                      </form>
                    ) : <span className={`axp-wt__name`}>{label}</span>}
                    {m && stack && <span className={`axp-wt__meta ${P}__meta`}>{m.model && <span className="axp-wt__model">{modelName(m.model)}</span>}<span className={`axp-wt__cost ${m.costEstimated ? 'is-estimate' : ''}`} aria-label={`cost ${money(m.costUsd)}`}>{money(m.costUsd)}</span></span>}
                  </span>
                )}
                {!collapsed && m && !stack && <span className="axp-wt__meta"><span className={`axp-wt__cost ${m.costEstimated ? 'is-estimate' : ''}`}>{money(m.costUsd)}</span></span>}
                {sc && sc.conn !== 'live' && <span className={`axp-wt__dot ${P}__conn is-${sc.conn}`} aria-label={sc.conn} />}
                {!collapsed && <button type="button" className={`fx-iconbtn axp-wt__close ${P}__close`} title="Close tab (Ctrl+Shift+W)" aria-label={`Close ${s.title}`} onClick={(e) => { e.stopPropagation(); onClose(s.id); }}><Icon name="x" size={12} /></button>}
              </div>
            );
          })}
        </div>
        {stack && (
          <div className={`${P}__foot`}>
            <button type="button" className={`${collapsed ? 'fx-iconbtn' : 'fx-btn fx-btn--ghost'} ${P}__add`} title="New tab (Ctrl+Shift+T)" aria-label="New tab" onClick={() => { onNew(); if (narrow) setOpen(false); }}><Icon name="plus" size={14} />{!collapsed && <span>New tab</span>}</button>
          </div>
        )}
        {stack && !narrow && !collapsed && (
          <div className={`${P}__edge`} role="separator" aria-orientation="vertical" aria-label="Tab list width" tabIndex={0}
            aria-valuemin={STACK_WIDTH.min} aria-valuemax={STACK_WIDTH.max} aria-valuenow={width}
            onPointerDown={edgeDown} onDoubleClick={() => tp.setWidth(STACK_WIDTH.default)}
            onKeyDown={(e) => { const n = keyWidth(tp.width, e.key, side === 'right' ? 'right' : 'left'); if (n !== null) { e.preventDefault(); tp.setWidth(n); } }} />
        )}
      </nav>
      {own && createPortal(<>
        <div className="axp-wt__scrim" onClick={() => setOwn(null)} onContextMenu={(e) => { e.preventDefault(); setOwn(null); }} />
        <div className="axp-wt__menu fx-popover" role="menu" style={at(own.x, own.y)}>
          <div className="axp-wt__mh">Tab position</div>
          {positionItems(tp, () => setOwn(null))}
          {tp.device && <button type="button" role="menuitem" className="fx-menu__item" onClick={() => { tp.setPosition(null); setOwn(null); }}><Icon name="refresh" size={13} /> <span className="fx-grow">Follow the default</span></button>}
          {stack && !narrow && <>
            <div className="axp-wt__sepline" />
            <button type="button" role="menuitem" className="fx-menu__item" onClick={() => { tp.setCollapsed(!tp.collapsed); setOwn(null); }}><Icon name={tp.collapsed ? 'maximize' : 'minimize'} size={13} /> <span className="fx-grow">{tp.collapsed ? 'Show titles' : 'Collapse to icons'}</span></button>
            <button type="button" role="menuitem" className="fx-menu__item" onClick={() => { tp.setWidth(STACK_WIDTH.default); setOwn(null); }}><Icon name="undo" size={13} /> <span className="fx-grow">Reset the width</span></button>
          </>}
        </div>
      </>, document.body)}
    </>
  );
}
