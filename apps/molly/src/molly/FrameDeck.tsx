import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { useAxfState } from '../axf/react';
import { deepLink, MOLLY_APPS } from './apps';
import { appOfView, mollyHooks, mollyHooksRev, onMollyHooks } from './host';

/**
 * Molly keeps every app it has opened alive. Moving an iframe in the DOM reloads it, so the frames never move: they
 * live in one deck at the end of <body>, and each app's frame is laid exactly over that app's slot (an empty box a view
 * or a pane renders). A slot in a view covers the main region around it; a slot in a pane (`fill="self"`) covers just
 * itself, so several apps can be on screen at once. An app whose slot is gone or hidden only hides its frame, so
 * switching apps never loses their state.
 */

type Rect = { top: number; left: number; width: number; height: number };
type Slot = { el: HTMLElement; fill: 'main' | 'self' };

const slotListeners = new Set<() => void>();
const slots = new Map<string, Slot>();
const notify = () => slotListeners.forEach((f) => f());

/** Reload / reopen requests from the menus and toolbar (actions.ts). */
const reloads = new Map<string, number>();
export function reloadFrame(id: string) {
  reloads.set(id, (reloads.get(id) ?? 0) + 1);
  notify();
}

/** The box a view (or a pane, `fill="self"`) gives its app's frame. */
export function AppSlot({ id, fill = 'main' }: { id: string; fill?: 'main' | 'self' }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    slots.set(id, { el, fill });
    notify();
    return () => {
      if (slots.get(id)?.el === el) slots.delete(id);
      notify();
    };
  }, [id, fill]);
  return <div ref={ref} className="molly-slot" data-app={id} data-fill={fill} />;
}

const same = (a: Rect | undefined, b: Rect) => !!a && a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height;

/** Where each app's frame goes right now: every slot that is on screen (a hidden or zero-size slot has none). */
function useSlotRects(): Map<string, Rect> {
  const [rects, setRects] = useState<Map<string, Rect>>(new Map());
  const [tick, bump] = useState(0);
  useEffect(() => {
    const f = () => bump((n) => n + 1);
    slotListeners.add(f);
    return () => { slotListeners.delete(f); };
  }, []);
  useLayoutEffect(() => {
    const boxes = [...slots.entries()].map(([id, s]) => ({ id, box: s.fill === 'self' ? s.el : ((s.el.closest('.fx-main') as HTMLElement | null) ?? s.el) }));
    const measure = () => {
      setRects((prev) => {
        const next = new Map<string, Rect>();
        for (const { id, box } of boxes) {
          const r = box.getBoundingClientRect();
          if (r.width > 0 && r.height > 0 && box.isConnected) next.set(id, { top: r.top, left: r.left, width: r.width, height: r.height });
        }
        const unchanged = next.size === prev.size && [...next].every(([k, v]) => same(prev.get(k), v));
        return unchanged ? prev : next;
      });
    };
    measure();
    const ro = new ResizeObserver(measure);
    for (const { box } of boxes) ro.observe(box);
    ro.observe(document.body);
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    // panes move without resizing (a splitter drag, a tab dropped elsewhere): measure again after each frame of layout
    let raf = 0;
    const later = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(measure); };
    const mo = new MutationObserver(later);
    mo.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['style', 'class', 'hidden'] });
    return () => { ro.disconnect(); mo.disconnect(); cancelAnimationFrame(raf); window.removeEventListener('resize', measure); window.removeEventListener('scroll', measure, true); };
  }, [tick]);
  return rects;
}

/** Every opened app's frame; mounted once, next to the shell. */
export function FrameDeck() {
  const view = useAxfState().view;
  const active = appOfView(view)?.id ?? null;
  const rects = useSlotRects();
  useSyncExternalStore(onMollyHooks, mollyHooksRev, mollyHooksRev);
  const { frameUrl, onFrame } = mollyHooks();
  // First address per app: a deep link on load (#/<app>/<route>), else the app's own start page.
  const [srcs] = useState(() => {
    const m = new Map<string, string>();
    const link = deepLink(window.location.hash);
    if (link) m.set(link.app.id, link.src);
    return m;
  });
  const [opened, setOpened] = useState<string[]>(() => (active ? [active] : []));
  useEffect(() => {
    const want = [...new Set([...(active ? [active] : []), ...rects.keys()])].filter((id) => !opened.includes(id));
    if (want.length) setOpened((o) => [...o, ...want]);
  }, [active, rects, opened]);

  return createPortal(
    <div className="molly-deck">
      {MOLLY_APPS.filter((a) => opened.includes(a.id)).map((a) => {
        const rect = rects.get(a.id);
        const start = srcs.get(a.id) ?? a.url;
        return (
          <iframe
            key={`${a.id}:${reloads.get(a.id) ?? 0}`}
            ref={(el) => onFrame?.(a.id, el)}
            title={a.label}
            className="molly-frame"
            data-app={a.id}
            data-on={rect ? 'true' : 'false'}
            src={frameUrl ? frameUrl(a, start) : start}
            allow="clipboard-read; clipboard-write; microphone; fullscreen; autoplay"
            style={rect ? { top: rect.top, left: rect.left, width: rect.width, height: rect.height } : undefined}
          />
        );
      })}
    </div>,
    document.body,
  );
}
